const { Router } = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { eq, and, lt, isNull, desc } = require('drizzle-orm');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { db, sqlite } = require('../db');
const { users, accounts, mfaTokens, trustedDevices } = require('../db/schema');
const { JWT_SECRET, requireAuth } = require('../middleware/auth');
const { createAuthDeviceMiddleware } = require('../middleware/authDevice');
const { loginLockout, recordLoginFailure, clearLoginFailures } = require('../middleware/loginLockout');
const { sendEmailChangeCode, sendMfaCode, sendPasswordResetCode, sendRegistrationCode } = require('../lib/email');
const { validateAccountName } = require('../lib/accountName');
const { getRequestIp, recordSecurityBlock, registerSecurityResetter } = require('../lib/securityActivity');
const { expireTrustedDevices } = require('../lib/trustedDeviceActivity');
const { SqliteRateLimitStore, hashRateLimitIdentity } = require('../lib/sqliteRateLimitStore');

const router = Router();
router.use(createAuthDeviceMiddleware(JWT_SECRET));
const SALT_ROUNDS = 12;
const OTP_SALT_ROUNDS = 10;
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
const TRUSTED_DEVICE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days
const EMAIL_CHANGE_COOLDOWN_MS = 365 * 24 * 60 * 60 * 1000;

function hashDeviceToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function describeDevice(userAgent = '') {
  const browser = /Edg\//.test(userAgent) ? 'Edge'
    : /Chrome\//.test(userAgent) ? 'Chrome'
      : /Firefox\//.test(userAgent) ? 'Firefox'
        : /Safari\//.test(userAgent) ? 'Safari' : 'Browser';
  const platform = /iPhone|iPad/.test(userAgent) ? 'iOS'
    : /Android/.test(userAgent) ? 'Android'
      : /Windows/.test(userAgent) ? 'Windows'
        : /Mac OS X/.test(userAgent) ? 'macOS'
          : /Linux/.test(userAgent) ? 'Linux' : 'Unknown device';
  return `${browser} on ${platform}`;
}

function findTrustedDevice(req, userId) {
  const [id, token, extra] = (req.cookies?.trusted_device || '').split('.');
  if (!id || !token || extra) return null;
  const record = db.select().from(trustedDevices)
    .where(and(eq(trustedDevices.id, id), eq(trustedDevices.userId, userId))).get();
  if (!record || record.revokedAt || record.expiresAt <= new Date().toISOString()) return null;
  const supplied = Buffer.from(hashDeviceToken(token), 'hex');
  const expected = Buffer.from(record.tokenHash, 'hex');
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  return record;
}

function rememberTrustedDevice(req, res, userId) {
  const id = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + TRUSTED_DEVICE_MAX_AGE).toISOString();
  const userAgent = (req.get('user-agent') || '').slice(0, 500);
  db.insert(trustedDevices).values({
    id,
    userId,
    tokenHash: hashDeviceToken(token),
    deviceName: describeDevice(userAgent),
    userAgent,
    createdAt: now,
    lastUsedAt: now,
    lastIp: getRequestIp(req),
    expiresAt,
  }).run();
  res.cookie('trusted_device', `${id}.${token}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: TRUSTED_DEVICE_MAX_AGE,
    path: '/api/auth',
  });
  require('../lib/trustedDeviceActivity').recordDeviceActivity(id, userId, getRequestIp(req), 'login');
  return id;
}

function trackedRateLimiter({ reason, keyType, message, ...options }) {
  const prefix = `auth-${hashRateLimitIdentity(`${reason}:${keyType}`).slice(0, 16)}`;
  const limiter = rateLimit({
    ...options,
    store: new SqliteRateLimitStore(prefix),
    keyGenerator: keyType === 'device'
      ? req => req.authDeviceId
      : keyType === 'email'
        ? req => hashRateLimitIdentity(req.body?.email)
        : req => ipKeyGenerator(getRequestIp(req)),
    message: { error: message },
    handler: (req, res) => {
      recordSecurityBlock({ req, reason, lockMs: options.windowMs });
      res.status(429).json({ error: message });
    },
  });
  registerSecurityResetter(event => {
    if (keyType === 'email') {
      try {
        for (const email of JSON.parse(event.attemptedEmails || '[]')) limiter.resetKey(hashRateLimitIdentity(email));
      } catch { /* retain the event while still clearing its other limiter dimensions */ }
      return;
    }
    const key = keyType === 'device' ? event.deviceId : ipKeyGenerator(event.ipAddress);
    if (key) limiter.resetKey(key);
  });
  return limiter;
}

// Separate limiter for registration — tighter window, fewer attempts
const registerLimiter = trackedRateLimiter({
  reason: 'Excessive account registration attempts',
  keyType: 'ip',
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: 'Too many registration attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});
const registerDeviceLimiter = trackedRateLimiter({
  reason: 'Excessive account registration attempts',
  keyType: 'device',
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many registration attempts from this device, please try again later',
  standardHeaders: false,
  legacyHeaders: false,
});
const registerEmailLimiter = trackedRateLimiter({
  reason: 'Excessive account registration attempts', keyType: 'email',
  windowMs: 60 * 60 * 1000, max: 5,
  message: 'Too many registration attempts for this email, please try again later',
  standardHeaders: false, legacyHeaders: false,
});

// Limiter for OTP send requests — max 3 per 10 minutes
const otpSendLimiter = trackedRateLimiter({
  reason: 'Excessive email-code requests',
  keyType: 'ip',
  windowMs: 10 * 60 * 1000,
  max: 3,
  message: 'Too many code requests, please wait before requesting another.',
  standardHeaders: true,
  legacyHeaders: false,
});
const otpSendDeviceLimiter = trackedRateLimiter({
  reason: 'Excessive email-code requests',
  keyType: 'device',
  windowMs: 10 * 60 * 1000,
  max: 3,
  message: 'Too many code requests from this device, please wait before requesting another.',
  standardHeaders: false,
  legacyHeaders: false,
});

// Limiter for OTP verification attempts — max 10 per 10 minutes
const otpVerifyLimiter = trackedRateLimiter({
  reason: 'Excessive verification-code attempts',
  keyType: 'ip',
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: 'Too many verification attempts.',
  standardHeaders: true,
  legacyHeaders: false,
});
const otpVerifyDeviceLimiter = trackedRateLimiter({
  reason: 'Excessive verification-code attempts',
  keyType: 'device',
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: 'Too many verification attempts from this device.',
  standardHeaders: false,
  legacyHeaders: false,
});

function issueToken(res, user, trustedDeviceId = null) {
  const payload = {
    userId:    user.id,
    accountId: user.accountId,
    email:     user.email,
    role:      user.role,
    sessionVersion: user.sessionVersion,
    ...(trustedDeviceId ? { trustedDeviceId } : {}),
  };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   COOKIE_MAX_AGE,
  });
  return payload;
}

function issuePreAuthToken(res, userId) {
  const payload = { userId, stage: 'mfa' };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '10m' });
  res.cookie('preauth', token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   10 * 60 * 1000,
  });
}

function issueRegistrationToken(res, userId) {
  const token = jwt.sign({ userId, stage: 'registration' }, JWT_SECRET, { expiresIn: '15m' });
  res.cookie('registration_pending', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 15 * 60 * 1000,
    path: '/api/auth',
  });
}

function pendingRegistration(req) {
  try {
    const payload = jwt.verify(req.cookies?.registration_pending || '', JWT_SECRET);
    return payload.stage === 'registration' ? payload : null;
  } catch {
    return null;
  }
}

async function createRegistrationCode(userId) {
  const code = crypto.randomInt(100000, 1000000).toString();
  const now = new Date().toISOString();
  const tokenHash = await bcrypt.hash(code, OTP_SALT_ROUNDS);
  const result = db.insert(mfaTokens).values({
    userId, tokenHash, purpose: 'registration', createdAt: now,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  }).returning().get();
  return { code, tokenId: result?.id };
}

function clearRegistrationToken(res) {
  res.clearCookie('registration_pending', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth',
  });
}

function setShortLivedAuthCookie(res, name, payload) {
  res.cookie(name, jwt.sign(payload, JWT_SECRET, { expiresIn: '10m' }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 10 * 60 * 1000,
    path: '/api/auth',
  });
}

function readStagedToken(req, cookieName, stage) {
  try {
    const payload = jwt.verify(req.cookies?.[cookieName] || '', JWT_SECRET);
    return payload.stage === stage ? payload : null;
  } catch {
    return null;
  }
}

// POST /api/auth/register
router.post('/register', registerLimiter, registerDeviceLimiter, registerEmailLimiter, async (req, res) => {
  // Registration is disabled unless explicitly enabled via env var.
  // Set ALLOW_REGISTRATION=true in .env to enable.
  if (process.env.ALLOW_REGISTRATION !== 'true') {
    return res.status(403).json({ error: 'Registration is not open' });
  }

  const { email, password, name } = req.body;

  if (typeof email !== 'string' || typeof password !== 'string' || typeof name !== 'string'
      || !email.trim() || !password || !name.trim()) {
    return res.status(400).json({ error: 'email, password and name are required' });
  }
  const validatedName = validateAccountName(name);
  if (validatedName.error) return res.status(400).json({ error: validatedName.error });
  if (Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ error: 'Password must be 72 UTF-8 bytes or fewer' });
  }
  const normalisedEmail = email.toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalisedEmail)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const existing = db.select().from(users).where(eq(users.email, normalisedEmail)).get();
  if (existing) {
    if (existing.emailVerifiedAt || existing.isActive) {
      issueRegistrationToken(res, 0);
      return res.status(202).json({ verificationRequired: true, email: normalisedEmail });
    }
    const validPendingPassword = await bcrypt.compare(password, existing.passwordHash);
    if (!validPendingPassword) {
      issueRegistrationToken(res, 0);
      return res.status(202).json({ verificationRequired: true, email: normalisedEmail });
    }
    const pendingCode = await createRegistrationCode(existing.id);
    try {
      await sendRegistrationCode(existing.email, pendingCode.code);
    } catch (emailError) {
      if (pendingCode.tokenId) db.delete(mfaTokens).where(eq(mfaTokens.id, pendingCode.tokenId)).run();
      console.error('[registration] Email send failed:', emailError.message);
      return res.status(503).json({ error: 'Unable to send the verification email. Please try again later.' });
    }
    issueRegistrationToken(res, existing.id);
    return res.status(202).json({ verificationRequired: true, email: existing.email });
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const accountId = crypto.randomUUID();
  const now = new Date().toISOString();
  let newUser;
  sqlite.transaction(() => {
    db.insert(accounts).values({ id: accountId, name: validatedName.name, avatar: null }).run();
    newUser = db.insert(users).values({
      email: normalisedEmail, passwordHash, accountId, createdAt: now,
      isActive: false, emailVerifiedAt: null,
    }).returning().get();
  })();

  const pendingCode = await createRegistrationCode(newUser.id);
  try {
    await sendRegistrationCode(newUser.email, pendingCode.code);
  } catch (emailError) {
    db.delete(users).where(eq(users.id, newUser.id)).run();
    db.delete(accounts).where(eq(accounts.id, accountId)).run();
    console.error('[registration] Email send failed:', emailError.message);
    return res.status(503).json({ error: 'Unable to send the verification email. Please try again later.' });
  }
  issueRegistrationToken(res, newUser.id);
  res.status(202).json({ verificationRequired: true, email: newUser.email });
});

// POST /api/auth/register/verify — activate a pending account after proving
// control of its email address.
router.post('/register/verify', otpVerifyLimiter, otpVerifyDeviceLimiter, async (req, res) => {
  const pending = pendingRegistration(req);
  if (!pending) return res.status(401).json({ error: 'Verification session expired. Please register again to receive a new code.' });

  const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';
  if (!/^\d{6}$/.test(otp)) return res.status(400).json({ error: 'A 6-digit code is required' });

  const user = db.select().from(users).where(eq(users.id, pending.userId)).get();
  if (!user || user.emailVerifiedAt) return res.status(401).json({ error: 'Invalid or expired verification code' });

  const now = new Date().toISOString();
  const record = db.select().from(mfaTokens).where(and(
    eq(mfaTokens.userId, user.id),
    eq(mfaTokens.purpose, 'registration'),
    isNull(mfaTokens.usedAt),
    lt(now, mfaTokens.expiresAt),
  )).orderBy(desc(mfaTokens.createdAt)).get();
  if (!record || !(await bcrypt.compare(otp, record.tokenHash))) {
    const attemptsRemaining = recordLoginFailure(req);
    return res.status(401).json({ error: 'Invalid or expired code', attemptsRemaining });
  }

  sqlite.transaction(() => {
    db.update(mfaTokens).set({ usedAt: now }).where(eq(mfaTokens.id, record.id)).run();
    db.update(users).set({ emailVerifiedAt: now, isActive: true }).where(eq(users.id, user.id)).run();
  })();
  const account = db.select().from(accounts).where(eq(accounts.id, user.accountId)).get();
  const activatedUser = { ...user, emailVerifiedAt: now, isActive: true };
  clearLoginFailures(req);
  issueToken(res, activatedUser);
  clearRegistrationToken(res);
  res.json({ user: { email: user.email, accountId: user.accountId, name: account?.name, role: user.role } });
});

// POST /api/auth/register/resend — send a fresh one-time code for the current
// pending registration without accepting an email address from the client.
router.post('/register/resend', otpSendLimiter, otpSendDeviceLimiter, async (req, res) => {
  const pending = pendingRegistration(req);
  if (!pending) return res.status(401).json({ error: 'Verification session expired. Please register again.' });
  const user = db.select().from(users).where(eq(users.id, pending.userId)).get();
  if (!user || user.emailVerifiedAt) return res.json({ ok: true });

  const pendingCode = await createRegistrationCode(user.id);
  try {
    await sendRegistrationCode(user.email, pendingCode.code);
  } catch (emailError) {
    if (pendingCode.tokenId) db.delete(mfaTokens).where(eq(mfaTokens.id, pendingCode.tokenId)).run();
    console.error('[registration] Resend failed:', emailError.message);
    return res.status(503).json({ error: 'Unable to send the verification email. Please try again later.' });
  }
  issueRegistrationToken(res, user.id);
  res.json({ ok: true, email: user.email });
});

const PASSWORD_RESET_REQUEST_MESSAGE = 'If an account exists for that email, a password reset code will be sent.';
const passwordResetEmailLimiter = trackedRateLimiter({
  reason: 'Excessive password-reset requests', keyType: 'email',
  windowMs: 10 * 60 * 1000, max: 3,
  message: 'Too many password-reset requests. Please wait before trying again.',
  standardHeaders: false, legacyHeaders: false,
});

// POST /api/auth/password/forgot — always returns the same response so callers
// cannot use password recovery to discover registered email addresses.
router.post('/password/forgot', otpSendLimiter, otpSendDeviceLimiter, passwordResetEmailLimiter, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase().trim() : '';
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }
  const user = db.select().from(users).where(eq(users.email, email)).get();
  const stagedUserId = user?.isActive && user.emailVerifiedAt ? user.id : 0;
  setShortLivedAuthCookie(res, 'password_reset_pending', { userId: stagedUserId, stage: 'password_reset_pending' });

  // Perform the same expensive hash for known and unknown addresses, then
  // respond before SMTP delivery so response timing does not reveal existence.
  const code = crypto.randomInt(100000, 1000000).toString();
  const tokenHash = await bcrypt.hash(code, OTP_SALT_ROUNDS);
  if (stagedUserId) {
    const now = new Date().toISOString();
    db.delete(mfaTokens).where(and(eq(mfaTokens.userId, user.id), eq(mfaTokens.purpose, 'password_reset'))).run();
    const inserted = db.insert(mfaTokens).values({
      userId: user.id, tokenHash, purpose: 'password_reset', createdAt: now,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }).returning().get();
    sendPasswordResetCode(user.email, code).catch(emailError => {
      if (inserted?.id) db.delete(mfaTokens).where(eq(mfaTokens.id, inserted.id)).run();
      console.error('[Password reset] Email send failed:', emailError.message);
    });
  }
  res.status(202).json({ ok: true, message: PASSWORD_RESET_REQUEST_MESSAGE });
});

// POST /api/auth/password/forgot/verify — prove access to the recovery email
// before accepting any replacement password.
router.post('/password/forgot/verify', otpVerifyLimiter, otpVerifyDeviceLimiter, async (req, res) => {
  const staged = readStagedToken(req, 'password_reset_pending', 'password_reset_pending');
  const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';
  if (!/^\d{6}$/.test(otp)) return res.status(400).json({ error: 'Enter a valid 6-digit code' });
  if (!staged?.userId) return res.status(401).json({ error: 'Invalid or expired verification code' });
  const now = new Date().toISOString();
  const record = db.select().from(mfaTokens).where(and(
    eq(mfaTokens.userId, staged.userId), eq(mfaTokens.purpose, 'password_reset'),
    isNull(mfaTokens.usedAt), lt(now, mfaTokens.expiresAt),
  )).orderBy(desc(mfaTokens.createdAt)).get();
  if (!record || !(await bcrypt.compare(otp, record.tokenHash))) {
    recordLoginFailure(req);
    return res.status(401).json({ error: 'Invalid or expired verification code' });
  }
  db.update(mfaTokens).set({ usedAt: now }).where(eq(mfaTokens.id, record.id)).run();
  setShortLivedAuthCookie(res, 'password_reset_authorized', { userId: staged.userId, stage: 'password_reset_authorized' });
  res.clearCookie('password_reset_pending', { httpOnly: true, sameSite: 'strict', path: '/api/auth' });
  res.json({ ok: true });
});

// PUT /api/auth/password/forgot/reset — the password is supplied only after
// the emailed code has been successfully verified.
router.put('/password/forgot/reset', async (req, res) => {
  const staged = readStagedToken(req, 'password_reset_authorized', 'password_reset_authorized');
  const newPassword = req.body?.newPassword;
  if (!staged?.userId) return res.status(401).json({ error: 'Password reset session expired. Request a new code.' });
  if (typeof newPassword !== 'string' || newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  if (Buffer.byteLength(newPassword, 'utf8') > 72) return res.status(400).json({ error: 'New password must be 72 UTF-8 bytes or fewer' });
  const user = db.select().from(users).where(eq(users.id, staged.userId)).get();
  if (!user?.isActive) return res.status(401).json({ error: 'Password reset session expired. Request a new code.' });
  if (await bcrypt.compare(newPassword, user.passwordHash)) return res.status(400).json({ error: 'New password must be different from current password' });

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  db.transaction(() => {
    db.update(users).set({ passwordHash, sessionVersion: user.sessionVersion + 1 }).where(eq(users.id, user.id)).run();
    expireTrustedDevices(user.id);
    db.delete(mfaTokens).where(eq(mfaTokens.userId, user.id)).run();
  });
  for (const name of ['token', 'trusted_device', 'password_reset_authorized']) {
    res.clearCookie(name, { httpOnly: true, sameSite: 'strict', ...(name === 'token' ? {} : { path: '/api/auth' }) });
  }
  res.json({ ok: true });
});

// POST /api/auth/login
router.post('/login', loginLockout, async (req, res) => {
  const { email, password } = req.body;

  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  if (email.length > 254 || password.length > 1024) return res.status(400).json({ error: 'Invalid email or password' });

  const user = db.select().from(users).where(eq(users.email, email.toLowerCase())).get();
  if (!user) {
    // Constant-time response to prevent user enumeration
    await bcrypt.compare(password, '$2b$12$invalidhashplaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
    const attemptsRemaining = recordLoginFailure(req);
    return res.status(401).json({ error: 'Invalid email or password', attemptsRemaining });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const attemptsRemaining = recordLoginFailure(req);
    return res.status(401).json({ error: 'Invalid email or password', attemptsRemaining });
  }

  if (!user.emailVerifiedAt) {
    issueRegistrationToken(res, user.id);
    return res.status(403).json({
      error: 'Verify your email before signing in. Return to registration to request a new code.',
      verificationRequired: true,
    });
  }

  if (!user.isActive) {
    return res.status(403).json({ error: 'This account has been deactivated. Contact an administrator.' });
  }

  // Password is correct — branch on MFA state
  if (!user.mfaEnabled) {
    // MFA disabled: existing behaviour
    clearLoginFailures(req);
    const account = db.select().from(accounts).where(eq(accounts.id, user.accountId)).get();
    issueToken(res, user);
    res.json({ user: { email: user.email, accountId: user.accountId, name: account?.name, role: user.role } });
  } else {
    const trustedDevice = findTrustedDevice(req, user.id);
    if (trustedDevice) {
      const account = db.select().from(accounts).where(eq(accounts.id, user.accountId)).get();
      require('../lib/trustedDeviceActivity').recordDeviceActivity(trustedDevice.id, user.id, getRequestIp(req), 'login');
      clearLoginFailures(req);
      issueToken(res, user, trustedDevice.id);
      return res.json({
        user: { email: user.email, accountId: user.accountId, name: account?.name, role: user.role },
        trustedDevice: true,
      });
    }

    // MFA enabled: generate OTP and send email
    // 1. Delete expired tokens
    db.delete(mfaTokens)
      .where(and(
        eq(mfaTokens.userId, user.id),
        lt(mfaTokens.expiresAt, new Date().toISOString())
      ))
      .run();

    // 2. Generate OTP (6 digits, zero-padded)
    const otp = crypto.randomInt(100000, 999999);
    const otpStr = otp.toString().padStart(6, '0');

    // 3. Hash OTP and insert into mfa_tokens
    const tokenHash = await bcrypt.hash(otpStr, OTP_SALT_ROUNDS);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const createdAt = new Date().toISOString();

    db.insert(mfaTokens).values({
      userId: user.id,
      tokenHash,
      purpose: 'mfa',
      expiresAt,
      createdAt,
    }).run();

    // 4. Send MFA code via email (don't block on failure)
    try {
      await sendMfaCode(user.email, otpStr);
    } catch (emailError) {
      console.error('[MFA] Email send failed:', emailError.message);
      // Continue anyway — user can resend via the frontend
    }

    // 5. Issue pre-auth token and return mfaRequired
    issuePreAuthToken(res, user.id);
    res.json({ mfaRequired: true });
  }
});

// POST /api/auth/mfa/verify
router.post('/mfa/verify', otpVerifyLimiter, otpVerifyDeviceLimiter, async (req, res) => {
  const { otp, rememberDevice = false } = req.body;

  // 1. Check for preauth cookie
  const preauthCookie = req.cookies.preauth;
  if (!preauthCookie) {
    return res.status(401).json({ error: 'No MFA session in progress' });
  }

  // 2. Verify the preauth JWT
  let payload;
  try {
    payload = jwt.verify(preauthCookie, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'MFA session expired, please log in again' });
  }

  // 3. Check stage
  if (payload.stage !== 'mfa') {
    return res.status(401).json({ error: 'Invalid session type' });
  }

  // 4. Validate OTP format
  if (!otp || otp.length !== 6 || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({ error: 'A 6-digit code is required' });
  }

  // 5. Query for latest unused unexpired token
  const now = new Date().toISOString();
  const record = db.select()
    .from(mfaTokens)
    .where(and(
      eq(mfaTokens.userId, payload.userId),
      eq(mfaTokens.purpose, 'mfa'),
      isNull(mfaTokens.usedAt),
      lt(now, mfaTokens.expiresAt)
    ))
    .orderBy(mfaTokens.createdAt)
    .all()
    .pop(); // Get the latest one (DESC ordering not directly supported, so get all and pop)

  if (!record) {
    return res.status(401).json({ error: 'Code expired or already used, please request a new one' });
  }

  // 6. Compare OTP
  const match = await bcrypt.compare(otp, record.tokenHash);
  if (!match) {
    const attemptsRemaining = recordLoginFailure(req);
    return res.status(401).json({ error: 'Invalid or expired code', attemptsRemaining });
  }

  // 7. On match: consume token, clear failures, issue session JWT
  db.update(mfaTokens)
    .set({ usedAt: new Date().toISOString() })
    .where(eq(mfaTokens.id, record.id))
    .run();

  const user = db.select().from(users).where(eq(users.id, payload.userId)).get();
  const account = db.select().from(accounts).where(eq(accounts.id, user.accountId)).get();

  clearLoginFailures(req);
  const trustedDeviceId = rememberDevice === true ? rememberTrustedDevice(req, res, user.id) : null;
  issueToken(res, user, trustedDeviceId);
  res.clearCookie('preauth', { httpOnly: true, sameSite: 'strict' });

  res.json({ user: { email: user.email, accountId: user.accountId, name: account?.name, role: user.role } });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token', { httpOnly: true, sameSite: 'strict' });
  res.json({ ok: true });
});

// POST /api/auth/sessions/revoke-all — remove every remembered MFA device and
// invalidate every JWT, including the browser making this request.
router.post('/sessions/revoke-all', requireAuth, (req, res) => {
  const user = db.select().from(users).where(eq(users.id, req.user.userId)).get();
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.transaction(() => {
    expireTrustedDevices(user.id);
    db.update(users).set({ sessionVersion: user.sessionVersion + 1 }).where(eq(users.id, user.id)).run();
  });
  res.clearCookie('token', { httpOnly: true, sameSite: 'strict' });
  res.clearCookie('trusted_device', { httpOnly: true, sameSite: 'strict', path: '/api/auth' });
  res.json({ ok: true });
});

// PUT /api/auth/email  — change login email (requires auth)
router.put('/email', requireAuth, otpSendLimiter, otpSendDeviceLimiter, async (req, res) => {
  const { newEmail, password } = req.body;

  if (typeof newEmail !== 'string' || typeof password !== 'string' || !newEmail || !password) {
    return res.status(400).json({ error: 'newEmail and password are required' });
  }

  const normalised = newEmail.toLowerCase().trim();
  if (normalised.length > 254 || password.length > 1024) return res.status(400).json({ error: 'Invalid email address or password' });
  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalised)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  const user = db.select().from(users).where(eq(users.id, req.user.userId)).get();
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (normalised === user.email) return res.status(400).json({ error: 'New email must be different from the current email' });

  if (user.lastEmailChangedAt) {
    const nextAllowedAt = new Date(new Date(user.lastEmailChangedAt).getTime() + EMAIL_CHANGE_COOLDOWN_MS);
    if (nextAllowedAt.getTime() > Date.now()) {
      return res.status(429).json({
        error: `Email can only be changed once per year. You can change it again after ${nextAllowedAt.toISOString().slice(0, 10)}.`,
        nextAllowedAt: nextAllowedAt.toISOString(),
      });
    }
  }

  // Confirm password before allowing sensitive change
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Password is incorrect' });

  // Check the new email isn't already taken
  const conflict = db.select().from(users).where(eq(users.email, normalised)).get();
  if (conflict) return res.status(409).json({ error: 'That email is already in use' });

  const code = crypto.randomInt(100000, 1000000).toString();
  const now = new Date().toISOString();
  const tokenHash = await bcrypt.hash(code, OTP_SALT_ROUNDS);
  db.delete(mfaTokens).where(and(eq(mfaTokens.userId, user.id), eq(mfaTokens.purpose, 'email_change'))).run();
  db.insert(mfaTokens).values({
    userId: user.id,
    tokenHash,
    purpose: 'email_change',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    createdAt: now,
  }).run();
  db.update(users).set({ pendingEmail: normalised }).where(eq(users.id, user.id)).run();

  try {
    await sendEmailChangeCode(normalised, code);
  } catch (emailError) {
    db.update(users).set({ pendingEmail: null }).where(eq(users.id, user.id)).run();
    db.delete(mfaTokens).where(and(eq(mfaTokens.userId, user.id), eq(mfaTokens.purpose, 'email_change'))).run();
    console.error('[Email change] Verification email failed:', emailError.message);
    return res.status(500).json({ error: 'Failed to send verification email. Check SMTP settings.' });
  }

  res.json({ ok: true, verificationRequired: true, pendingEmail: normalised });
});

// POST /api/auth/email/verify — complete a pending email change.
router.post('/email/verify', requireAuth, otpVerifyLimiter, otpVerifyDeviceLimiter, async (req, res) => {
  const { otp } = req.body;
  if (typeof otp !== 'string' || !/^\d{6}$/.test(otp)) return res.status(400).json({ error: 'Enter a valid 6-digit code' });

  const user = db.select().from(users).where(eq(users.id, req.user.userId)).get();
  if (!user?.pendingEmail) return res.status(400).json({ error: 'No email change is awaiting verification' });
  const now = new Date().toISOString();
  const record = db.select().from(mfaTokens).where(and(
    eq(mfaTokens.userId, user.id),
    eq(mfaTokens.purpose, 'email_change'),
    isNull(mfaTokens.usedAt),
    lt(now, mfaTokens.expiresAt),
  )).orderBy(desc(mfaTokens.createdAt)).get();
  if (!record || !(await bcrypt.compare(otp, record.tokenHash))) {
    return res.status(401).json({ error: 'Invalid or expired verification code' });
  }
  const conflict = db.select().from(users).where(eq(users.email, user.pendingEmail)).get();
  if (conflict && conflict.id !== user.id) return res.status(409).json({ error: 'That email is already in use' });

  const nextSessionVersion = user.sessionVersion + 1;
  db.transaction(() => {
    db.update(mfaTokens).set({ usedAt: now }).where(eq(mfaTokens.id, record.id)).run();
    db.update(users).set({
      email: user.pendingEmail,
      pendingEmail: null,
      emailVerifiedAt: now,
      lastEmailChangedAt: now,
      sessionVersion: nextSessionVersion,
    }).where(eq(users.id, user.id)).run();
    expireTrustedDevices(user.id);
  });
  res.clearCookie('trusted_device', { httpOnly: true, sameSite: 'strict', path: '/api/auth' });
  const updated = db.select().from(users).where(eq(users.id, user.id)).get();
  issueToken(res, updated);
  res.json({ ok: true, email: updated.email });
});

// PUT /api/auth/password  — change password (requires auth)
router.put('/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  if (currentPassword.length > 1024 || Buffer.byteLength(newPassword, 'utf8') > 72) {
    return res.status(400).json({ error: 'New password must be 72 UTF-8 bytes or fewer' });
  }

  const user = db.select().from(users).where(eq(users.id, req.user.userId)).get();
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'New password must be different from current password' });
  }

  const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  const nextSessionVersion = user.sessionVersion + 1;
  db.update(users).set({ passwordHash: newHash, sessionVersion: nextSessionVersion }).where(eq(users.id, req.user.userId)).run();
  expireTrustedDevices(req.user.userId);
  res.clearCookie('trusted_device', { httpOnly: true, sameSite: 'strict', path: '/api/auth' });

  // Keep only this browser signed in; every previously issued token now has an
  // older session version and will be rejected by requireAuth and /auth/me.
  issueToken(res, { ...user, passwordHash: newHash, sessionVersion: nextSessionVersion });

  res.json({ ok: true });
});

// GET /api/auth/mfa/status  — return current MFA enabled state for the authenticated user
router.get('/mfa/status', requireAuth, (req, res) => {
  const user = db.select().from(users).where(eq(users.id, req.user.userId)).get();
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ mfaEnabled: !!user.mfaEnabled });
});

// GET /api/auth/me  — called on app load to restore session
router.get('/me', requireAuth, (req, res) => {
  const account = db.select().from(accounts).where(eq(accounts.id, req.user.accountId)).get();
  res.json({ user: { email: req.user.email, accountId: req.user.accountId, name: account?.name, role: req.user.role } });
});

// POST /api/auth/mfa/send  — send OTP to authenticated user (settings enable flow)
router.post('/mfa/send', requireAuth, otpSendLimiter, otpSendDeviceLimiter, async (req, res) => {
  // 1. Delete expired tokens for this user
  db.delete(mfaTokens)
    .where(and(
      eq(mfaTokens.userId, req.user.userId),
      lt(mfaTokens.expiresAt, new Date().toISOString())
    ))
    .run();

  // 2. Generate OTP (6 digits, zero-padded)
  const otp = crypto.randomInt(100000, 999999);
  const otpStr = otp.toString().padStart(6, '0');

  // 3. Hash OTP and insert into mfa_tokens
  const tokenHash = await bcrypt.hash(otpStr, OTP_SALT_ROUNDS);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const createdAt = new Date().toISOString();

  db.insert(mfaTokens).values({
    userId: req.user.userId,
    tokenHash,
    purpose: 'mfa',
    expiresAt,
    createdAt,
  }).run();

  // 4. Send OTP via email — on failure return 500
  try {
    await sendMfaCode(req.user.email, otpStr);
  } catch (emailError) {
    console.error('[MFA] Email send failed:', emailError.message);
    return res.status(500).json({ error: 'Failed to send verification email. Check SMTP settings.' });
  }

  res.json({ ok: true });
});

// POST /api/auth/mfa/toggle  — enable or disable MFA for the authenticated user
router.post('/mfa/toggle', requireAuth, async (req, res) => {
  const { enable, otp } = req.body;

  // Validate: enable must be a boolean
  if (typeof enable !== 'boolean') {
    return res.status(400).json({ error: 'enable (boolean) is required' });
  }

  if (enable === true) {
    // Enabling MFA requires OTP verification
    if (!otp || !/^\d{6}$/.test(otp.toString())) {
      return res.status(400).json({ error: 'A 6-digit code is required to enable MFA' });
    }

    // Query for the latest unused unexpired token for this user
    const now = new Date().toISOString();
    const record = db.select()
      .from(mfaTokens)
      .where(and(
        eq(mfaTokens.userId, req.user.userId),
        eq(mfaTokens.purpose, 'mfa'),
        isNull(mfaTokens.usedAt),
        lt(now, mfaTokens.expiresAt)
      ))
      .orderBy(mfaTokens.createdAt)
      .all()
      .pop(); // get the latest one

    if (!record) {
      return res.status(401).json({ error: 'Code expired. Request a new one.' });
    }

    const match = await bcrypt.compare(otp.toString(), record.tokenHash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid code' });
    }

    // Consume the token and enable MFA
    db.update(mfaTokens)
      .set({ usedAt: new Date().toISOString() })
      .where(eq(mfaTokens.id, record.id))
      .run();

    db.update(users)
      .set({ mfaEnabled: true })
      .where(eq(users.id, req.user.userId))
      .run();

    return res.json({ ok: true, mfaEnabled: true });

  } else {
    // Disabling MFA — no OTP required (user is already authenticated via session JWT)
    db.update(users)
      .set({ mfaEnabled: false })
      .where(eq(users.id, req.user.userId))
      .run();

    db.delete(mfaTokens)
      .where(eq(mfaTokens.userId, req.user.userId))
      .run();

    expireTrustedDevices(req.user.userId);
    res.clearCookie('trusted_device', { httpOnly: true, sameSite: 'strict', path: '/api/auth' });

    return res.json({ ok: true, mfaEnabled: false });
  }
});

module.exports = router;
