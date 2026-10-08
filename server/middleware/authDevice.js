const crypto = require('crypto');

const COOKIE_NAME = 'auth_device';
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60 * 1000;

function signatureFor(id, secret) {
  return crypto.createHmac('sha256', secret).update(id).digest('base64url');
}

function createDeviceToken(secret, id = crypto.randomUUID()) {
  return `${id}.${signatureFor(id, secret)}`;
}

function verifyDeviceToken(value, secret) {
  const [id, signature, extra] = String(value || '').split('.');
  if (!id || !signature || extra || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const expected = Buffer.from(signatureFor(id, secret));
  const supplied = Buffer.from(signature);
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
  return id;
}

function createAuthDeviceMiddleware(secret) {
  if (!secret) throw new Error('A signing secret is required for auth device identifiers');
  return (req, res, next) => {
    let id = verifyDeviceToken(req.cookies?.[COOKIE_NAME], secret);
    if (!id) {
      const token = createDeviceToken(secret);
      id = token.slice(0, token.indexOf('.'));
      res.cookie(COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: COOKIE_MAX_AGE,
        path: '/api/auth',
      });
    }
    req.authDeviceId = id;
    next();
  };
}

module.exports = { COOKIE_NAME, createAuthDeviceMiddleware, createDeviceToken, verifyDeviceToken };
