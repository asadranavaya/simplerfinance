const fs   = require('fs');
const path = require('path');

// Load .env manually to avoid dotenvx interference
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const [key, ...vals] = line.split('=');
    if (key && key.trim() && !key.startsWith('#')) {
      process.env[key.trim()] = process.env[key.trim()] || vals.join('=').trim();
    }
  });
}

// ── SMTP Configuration Check ──────────────────────────────────────────────────
if (!process.env.SMTP_HOST) {
  console.warn('[email] Warning: SMTP_HOST is not set — registration verification and MFA email delivery will not function');
}

const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const cookieParser = require('cookie-parser');

const { requireAuth }     = require('./middleware/auth');
const authRouter          = require('./routes/auth');
const accountsRouter      = require('./routes/accounts');
const cardsRouter         = require('./routes/cards');
const spendingRouter      = require('./routes/spending');
const profileRouter       = require('./routes/profile');
const categoriesRouter    = require('./routes/categories');
const subscriptionsRouter = require('./routes/subscriptions');
const adminRouter         = require('./routes/admin');
const netWorthRouter      = require('./routes/netWorth');
const simplefinRouter     = require('./routes/simplefin');
const fxRouter            = require('./routes/fx');
const notificationsRouter = require('./routes/notifications');
const splitPeopleRouter    = require('./routes/splitPeople');
const travelPlansRouter    = require('./routes/travelPlans');
const iconsRouter          = require('./routes/icons');
const { startSimplefinScheduler } = require('./lib/simplefinScheduler');
const { startFxScheduler } = require('./lib/fxScheduler');
const { startOperationsMaintenance } = require('./lib/operationsMaintenance');
const { validateJsonBody } = require('./middleware/inputValidation');
const { sqlite } = require('./db');
const { migrateCustomerData } = require('./lib/customerDataMigration');
const { requestIdMiddleware, serviceTelemetryMiddleware } = require('./lib/serviceTelemetry');

// Migrate legacy plaintext opaque fields and globally encrypted SimpleFIN
// credentials before accepting traffic. The migration is atomic and idempotent.
const encryptedRecordCount = migrateCustomerData(sqlite);
if (encryptedRecordCount) console.log(`[encryption] Protected ${encryptedRecordCount} existing customer record${encryptedRecordCount === 1 ? '' : 's'}.`);

const app    = express();
const PORT   = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';

// nginx is the single trusted reverse proxy in production. This makes req.ip
// use its X-Forwarded-For value without trusting arbitrary proxy chains.
if (isProd) app.set('trust proxy', 1);

// ── Security middleware ───────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'"],
      styleSrc:    ["'self'", "'unsafe-inline'"], // unsafe-inline needed for React inline styles
      imgSrc:      ["'self'", 'data:'],
      connectSrc:  ["'self'"],
      fontSrc:     ["'self'"],
      objectSrc:   ["'none'"],
      frameSrc:    ["'none'"],
      baseUri:     ["'self'"],
      formAction:  ["'self'"],
    },
  },
}));
app.use(cors({
  origin: isProd ? false : 'http://localhost:5173',
  credentials: true,
  exposedHeaders: ['X-Request-ID'],
}));
app.use(cookieParser());
app.use(express.json({ limit: '50kb' })); // prevent large payload attacks
app.use(validateJsonBody);
app.use('/api', requestIdMiddleware);

// ── Public routes ─────────────────────────────────────────────────────────────
app.use('/api/auth',          authRouter);
app.get('/api/health',        (req, res) => res.json({ ok: true }));

// ── Protected routes ──────────────────────────────────────────────────────────
app.use('/api', requireAuth);
app.use('/api', serviceTelemetryMiddleware);
app.use('/api/accounts',      accountsRouter);
app.use('/api',               cardsRouter);
app.use('/api/spending',      spendingRouter);
app.use('/api/profiles',      profileRouter);
app.use('/api/categories',    categoriesRouter);
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/api/admin',         adminRouter);
app.use('/api/net-worth',     netWorthRouter);
app.use('/api/simplefin',     simplefinRouter);
app.use('/api/fx',            fxRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/split-people',  splitPeopleRouter);
app.use('/api/travel-plans',  travelPlansRouter);
app.use('/api/icons',         iconsRouter);

// Normalize parser failures instead of delegating them to Express' default
// error handler, which logs an internal stack trace for an expected 413.
app.use((error, req, res, next) => {
  if (error?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Icon uploads must be 1 MB or smaller.' });
  if (error?.name === 'MulterError') return res.status(400).json({ error: 'Invalid icon upload.' });
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large.' });
  }
  if (error instanceof SyntaxError && error?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body contains invalid JSON.' });
  }
  return next(error);
});

// ── Serve built React frontend (production only) ──────────────────────────────
const distPath = path.join(__dirname, '../dist');
if (isProd && fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('/{*path}', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Budget API running on http://localhost:${PORT}`);
    startSimplefinScheduler();
    startFxScheduler();
    startOperationsMaintenance();
  });
}

module.exports = app;
