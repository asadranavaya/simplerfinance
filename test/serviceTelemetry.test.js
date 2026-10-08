const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  SERVICE_LOG_QUERY_ROW_LIMIT,
  recordServiceRequest,
  recordImpersonatedServiceOperation,
  purgeExpiredServiceLogs,
  queryServiceLogs,
  getLatencyPercentiles,
} = require('../server/lib/serviceTelemetry');

function telemetryEntry(overrides = {}) {
  return {
    requestId: crypto.randomUUID(),
    subscriberId: `subscriber-${crypto.randomUUID()}`,
    startTime: new Date().toISOString(),
    latencyMs: 12.345,
    statusCode: 200,
    userType: 'user',
    method: 'GET',
    dataPlaneCall: '/api/categories',
    counters: [],
    ...overrides,
  };
}

test('service telemetry is queryable and exposes the documented dimensions', () => {
  const entry = telemetryEntry();
  recordServiceRequest(entry);

  const result = queryServiceLogs(`
    SELECT request_id, subscriber_id, start_time, latency_ms, status_code, user_type, method, data_plane_call, counters
    FROM service_request_logs
    WHERE request_id = '${entry.requestId}'
  `);

  assert.equal(result.rowCount, 1);
  assert.deepEqual(result.rows[0], {
    request_id: entry.requestId,
    subscriber_id: entry.subscriberId,
    start_time: entry.startTime,
    latency_ms: entry.latencyMs,
    status_code: entry.statusCode,
    user_type: entry.userType,
    method: entry.method,
    data_plane_call: entry.dataPlaneCall,
    counters: '[]',
  });
});

test('service telemetry stores bounded counters as a deduplicated JSON string-set', () => {
  const entry = telemetryEntry({ counters: ['simplefin_sync=1', 'simplefin_sync=1', 'expenses_imported=12', 'not valid'] });
  recordServiceRequest(entry);
  const result = queryServiceLogs(`SELECT counters FROM service_request_logs WHERE request_id = '${entry.requestId}'`);
  assert.deepEqual(JSON.parse(result.rows[0].counters), ['simplefin_sync=1', 'expenses_imported=12']);
});

test('impersonated operations share the main telemetry dataset', async () => {
  const subscriberId = `subscriber-${crypto.randomUUID()}`;
  const result = await recordImpersonatedServiceOperation({
    subscriberId,
    dataPlaneCall: '/api/simplefin/connections/:id/sync',
    counters: ['simplefin_sync=1'],
    resultCounters: syncResult => [`pending_transactions_retired=${syncResult.pendingTransactionsRetired}`],
  }, async requestId => ({ requestId, synced: true, pendingTransactionsRetired: 2 }));

  const stored = queryServiceLogs(`SELECT * FROM service_request_logs WHERE request_id = '${result.requestId}'`).rows[0];
  assert.equal(stored.subscriber_id, subscriberId);
  assert.equal(stored.user_type, 'impersonated_user');
  assert.equal(stored.method, 'POST');
  assert.equal(stored.status_code, 200);
  assert.deepEqual(JSON.parse(stored.counters), ['simplefin_sync=1', 'pending_transactions_retired=2']);
});

test('latency telemetry calculates hourly p50, p90, and p99 by method', () => {
  const subscriberId = `subscriber-${crypto.randomUUID()}`;
  const now = new Date('2026-08-18T12:34:00.000Z');
  for (const [method, latencyMs] of [['GET', 10], ['GET', 20], ['GET', 30], ['POST', 80]]) {
    recordServiceRequest(telemetryEntry({ subscriberId, method, latencyMs, startTime: '2026-08-18T12:10:00.000Z' }));
  }
  const result = getLatencyPercentiles(24, now);
  const point = result.points.find(item => item.bucketStart === '2026-08-18T12:00:00.000Z');
  assert.equal(result.bucketMinutes, 60);
  assert.ok(result.methods.includes('GET'));
  assert.deepEqual(point.methods.GET, { samples: 3, p50: 20, p90: 28, p99: 29.8 });
  assert.deepEqual(point.methods.POST, { samples: 1, p50: 80, p90: 80, p99: 80 });
});

test('service telemetry permits read-only aggregation and rejects unsafe SQL', () => {
  const aggregate = queryServiceLogs('SELECT method, COUNT(*) AS request_count FROM service_request_logs GROUP BY method');
  assert.ok(Array.isArray(aggregate.rows));
  assert.equal(aggregate.maxRows, SERVICE_LOG_QUERY_ROW_LIMIT);

  for (const query of [
    'DELETE FROM service_request_logs',
    'PRAGMA table_info(service_request_logs)',
    'SELECT * FROM service_request_logs; SELECT 1',
    'WITH RECURSIVE counter(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM counter) SELECT x FROM counter',
  ]) assert.throws(() => queryServiceLogs(query), /one SQL statement|read-only SELECT/i, query);
});

test('service telemetry purges entries older than seven days', () => {
  const now = new Date('2026-08-18T12:00:00.000Z');
  const expired = telemetryEntry({ startTime: '2026-08-11T11:59:59.999Z' });
  const retained = telemetryEntry({ startTime: '2026-08-11T12:00:00.001Z' });
  recordServiceRequest(expired);
  recordServiceRequest(retained);

  assert.equal(purgeExpiredServiceLogs(now), 1);
  assert.equal(queryServiceLogs(`SELECT request_id FROM service_request_logs WHERE request_id = '${expired.requestId}'`).rowCount, 0);
  assert.equal(queryServiceLogs(`SELECT request_id FROM service_request_logs WHERE request_id = '${retained.requestId}'`).rowCount, 1);
});
