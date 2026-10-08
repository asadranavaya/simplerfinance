const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SERVICE_LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SERVICE_LOG_QUERY_ROW_LIMIT = 500;
const serviceLogPath = process.env.SERVICE_LOG_DB_PATH
  ? path.resolve(process.env.SERVICE_LOG_DB_PATH)
  : path.join(process.env.BUDGET_DB_PATH ? path.dirname(path.resolve(process.env.BUDGET_DB_PATH)) : path.join(__dirname, '../../data'), 'service-logs.db');

fs.mkdirSync(path.dirname(serviceLogPath), { recursive: true });
const serviceLogDb = new Database(serviceLogPath);
serviceLogDb.pragma('journal_mode = WAL');
serviceLogDb.pragma('synchronous = NORMAL');
serviceLogDb.exec(`
  CREATE TABLE IF NOT EXISTS service_request_logs (
    request_id TEXT PRIMARY KEY,
    subscriber_id TEXT NOT NULL,
    start_time TEXT NOT NULL,
    latency_ms REAL NOT NULL,
    status_code INTEGER NOT NULL,
    user_type TEXT NOT NULL,
    method TEXT NOT NULL,
    data_plane_call TEXT NOT NULL,
    counters TEXT NOT NULL DEFAULT '[]'
  );
  CREATE INDEX IF NOT EXISTS service_request_logs_start_time_idx ON service_request_logs(start_time);
  CREATE INDEX IF NOT EXISTS service_request_logs_subscriber_idx ON service_request_logs(subscriber_id, start_time);
  CREATE INDEX IF NOT EXISTS service_request_logs_call_idx ON service_request_logs(data_plane_call, method, start_time);
  CREATE INDEX IF NOT EXISTS service_request_logs_status_idx ON service_request_logs(status_code, start_time);
`);

const serviceLogColumns = new Set(serviceLogDb.pragma('table_info(service_request_logs)').map(column => column.name));
if (!serviceLogColumns.has('counters')) {
  serviceLogDb.exec("ALTER TABLE service_request_logs ADD COLUMN counters TEXT NOT NULL DEFAULT '[]'");
}

const insertLog = serviceLogDb.prepare(`INSERT INTO service_request_logs
  (request_id, subscriber_id, start_time, latency_ms, status_code, user_type, method, data_plane_call, counters)
  VALUES (@requestId, @subscriberId, @startTime, @latencyMs, @statusCode, @userType, @method, @dataPlaneCall, @counters)`);
const purgeLogs = serviceLogDb.prepare('DELETE FROM service_request_logs WHERE start_time < ?');
let nextPurgeAt = 0;

function purgeExpiredServiceLogs(now = new Date()) {
  const cutoff = new Date(now.getTime() - SERVICE_LOG_RETENTION_MS).toISOString();
  return purgeLogs.run(cutoff).changes;
}

function recordServiceRequest(entry) {
  const counters = [...new Set(Array.from(entry.counters || []).map(value => String(value).trim())
    .filter(value => /^[a-z][a-z0-9_.-]{0,47}=\d{1,12}$/i.test(value)).slice(0, 50))];
  insertLog.run({ ...entry, counters: JSON.stringify(counters) });
  const now = Date.now();
  if (now >= nextPurgeAt) {
    purgeExpiredServiceLogs(new Date(now));
    nextPurgeAt = now + 60 * 60 * 1000;
  }
}

function routeLabel(req) {
  if (req.route?.path) return `${req.baseUrl || '/api'}${req.route.path}`.replace(/\/+/g, '/');
  return String(req.originalUrl || req.path || '/api').split('?')[0].split('/').map(segment => {
    if (/^(?:\d+|[0-9a-f]{8}-[0-9a-f-]{27,})$/i.test(segment) || segment.length > 48) return ':id';
    return segment;
  }).join('/').slice(0, 300);
}

function requestIdMiddleware(req, res, next) {
  const requestId = crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
}

function serviceTelemetryMiddleware(req, res, next) {
  if (req.path === '/admin' || req.path.startsWith('/admin/')) return next();
  const requestId = req.requestId || crypto.randomUUID();
  const startTime = new Date();
  const started = process.hrtime.bigint();
  req.telemetryCounters = new Set();
  req.requestId = requestId;
  if (!res.hasHeader('X-Request-ID')) res.setHeader('X-Request-ID', requestId);
  res.once('finish', () => {
    if (!req.user?.accountId) return;
    try {
      recordServiceRequest({
        requestId,
        subscriberId: String(req.user.accountId),
        startTime: startTime.toISOString(),
        latencyMs: Math.round(Number(process.hrtime.bigint() - started) / 1e3) / 1000,
        statusCode: res.statusCode,
        userType: String(req.user.role || 'user').slice(0, 30),
        method: String(req.method || 'GET').toUpperCase().slice(0, 10),
        dataPlaneCall: routeLabel(req),
        counters: req.telemetryCounters,
      });
    } catch (error) {
      console.error('[telemetry] unable to persist request metric:', error.message);
    }
  });
  next();
}

async function recordImpersonatedServiceOperation({ subscriberId, dataPlaneCall, method = 'POST', counters = [], resultCounters }, operation) {
  const requestId = crypto.randomUUID();
  const startTime = new Date();
  const started = process.hrtime.bigint();
  let statusCode = 200;
  let result;
  try {
    result = await operation(requestId);
    return result;
  } catch (error) {
    const candidate = Number(error?.statusCode);
    statusCode = Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : 500;
    throw error;
  } finally {
    try {
      recordServiceRequest({
        requestId,
        subscriberId: String(subscriberId),
        startTime: startTime.toISOString(),
        latencyMs: Math.round(Number(process.hrtime.bigint() - started) / 1e3) / 1000,
        statusCode,
        userType: 'impersonated_user',
        method: String(method).toUpperCase().slice(0, 10),
        dataPlaneCall: String(dataPlaneCall).slice(0, 300),
        counters: [
          ...counters,
          ...(typeof resultCounters === 'function' ? resultCounters(result) : []),
        ],
      });
    } catch (telemetryError) {
      console.error('[telemetry] unable to persist background operation metric:', telemetryError.message);
    }
  }
}

const FORBIDDEN_SQL = /\b(?:attach|detach|pragma|vacuum|insert|update|delete|replace|create|alter|drop|reindex|analyze|load_extension|recursive)\b/i;

function queryServiceLogs(query) {
  if (typeof query !== 'string' || !query.trim() || query.length > 4000) throw new Error('Enter a query between 1 and 4,000 characters.');
  const sql = query.trim().replace(/;\s*$/, '');
  if (sql.includes(';')) throw new Error('Only one SQL statement may be executed at a time.');
  if (!/^(?:select|with)\b/i.test(sql) || FORBIDDEN_SQL.test(sql)) throw new Error('Only read-only SELECT queries are allowed.');
  const statement = serviceLogDb.prepare(`SELECT * FROM (${sql}) AS telemetry_query LIMIT ${SERVICE_LOG_QUERY_ROW_LIMIT + 1}`);
  if (!statement.reader || !statement.readonly) throw new Error('Only read-only SELECT queries are allowed.');
  const rows = statement.all();
  const truncated = rows.length > SERVICE_LOG_QUERY_ROW_LIMIT;
  if (truncated) rows.length = SERVICE_LOG_QUERY_ROW_LIMIT;
  return { columns: statement.columns().map(column => column.name), rows, rowCount: rows.length, truncated, maxRows: SERVICE_LOG_QUERY_ROW_LIMIT };
}

function percentile(sortedValues, quantile) {
  if (!sortedValues.length) return null;
  const position = (sortedValues.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const value = lower === upper
    ? sortedValues[lower]
    : sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (position - lower);
  return Math.round(value * 1000) / 1000;
}

function getLatencyPercentiles(hours = 24, now = new Date()) {
  const rangeHours = hours === 168 ? 168 : 24;
  const end = new Date(now);
  end.setUTCMinutes(0, 0, 0);
  const start = new Date(end.getTime() - (rangeHours - 1) * 60 * 60 * 1000);
  const samples = serviceLogDb.prepare(`
    SELECT start_time, method, latency_ms
    FROM service_request_logs
    WHERE start_time >= ? AND start_time < ?
    ORDER BY start_time ASC
  `).all(start.toISOString(), new Date(end.getTime() + 60 * 60 * 1000).toISOString());
  const buckets = new Map();
  const methods = new Set();
  for (const sample of samples) {
    const sampleTime = new Date(sample.start_time);
    if (Number.isNaN(sampleTime.getTime())) continue;
    sampleTime.setUTCMinutes(0, 0, 0);
    const bucketStart = sampleTime.toISOString();
    const method = String(sample.method || 'UNKNOWN').toUpperCase();
    methods.add(method);
    if (!buckets.has(bucketStart)) buckets.set(bucketStart, new Map());
    const byMethod = buckets.get(bucketStart);
    if (!byMethod.has(method)) byMethod.set(method, []);
    byMethod.get(method).push(Number(sample.latency_ms));
  }
  const orderedMethods = [...methods].sort();
  const points = [];
  for (let time = start.getTime(); time <= end.getTime(); time += 60 * 60 * 1000) {
    const bucketStart = new Date(time).toISOString();
    const point = { bucketStart, methods: {} };
    for (const method of orderedMethods) {
      const values = buckets.get(bucketStart)?.get(method) || [];
      values.sort((a, b) => a - b);
      if (values.length) point.methods[method] = {
        samples: values.length,
        p50: percentile(values, 0.5),
        p90: percentile(values, 0.9),
        p99: percentile(values, 0.99),
      };
    }
    points.push(point);
  }
  return {
    rangeHours,
    bucketMinutes: 60,
    generatedAt: new Date(now).toISOString(),
    methods: orderedMethods,
    sampleCount: samples.length,
    points,
  };
}

purgeExpiredServiceLogs();

module.exports = {
  SERVICE_LOG_RETENTION_MS,
  SERVICE_LOG_QUERY_ROW_LIMIT,
  serviceLogPath,
  requestIdMiddleware,
  serviceTelemetryMiddleware,
  recordImpersonatedServiceOperation,
  recordServiceRequest,
  purgeExpiredServiceLogs,
  queryServiceLogs,
  getLatencyPercentiles,
};
