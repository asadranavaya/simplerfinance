const jwt = require('jsonwebtoken');
const { eq } = require('drizzle-orm');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be configured with at least 32 characters in production');
}

function requireAuth(req, res, next) {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const { db } = require('../db');
    const { users } = require('../db/schema');
    const user = db.select().from(users).where(eq(users.id, payload.userId)).get();
    if (!user || !user.isActive) {
      res.clearCookie('token', { httpOnly: true, sameSite: 'strict' });
      return res.status(403).json({ error: 'This account is inactive', code: 'ACCOUNT_INACTIVE' });
    }
    const tokenSessionVersion = Number.isInteger(payload.sessionVersion) ? payload.sessionVersion : 0;
    if (tokenSessionVersion !== user.sessionVersion) {
      res.clearCookie('token', { httpOnly: true, sameSite: 'strict' });
      return res.status(401).json({
        error: 'Your session ended because the account password changed.',
        code: 'SESSION_REVOKED',
      });
    }
    req.user = {
      userId:    user.id,
      accountId: user.accountId,
      email:     user.email,
      role:      user.role,
    };
    const { trustedDeviceFromCookie, recordRequestDeviceActivity } = require('../lib/trustedDeviceActivity');
    const deviceId = payload.trustedDeviceId || trustedDeviceFromCookie(req, user.id);
    if (deviceId) {
      recordRequestDeviceActivity(req, deviceId);
      // Bind older sessions on their next auth fetch, where the legacy device
      // cookie is available. Preserve the original session expiry.
      if (!payload.trustedDeviceId) {
        res.cookie('token', jwt.sign({ ...payload, trustedDeviceId: deviceId }, JWT_SECRET), {
          httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict',
          maxAge: Math.max(0, payload.exp * 1000 - Date.now()),
        });
      }
    }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Administrator access required' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, JWT_SECRET };
