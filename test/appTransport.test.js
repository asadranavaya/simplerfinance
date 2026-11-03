const test = require('node:test');
const assert = require('node:assert/strict');
const transport = import('../renderer/src/util/apiTransport.js');

test('app server validation accepts only an HTTPS origin without embedded credentials', async () => {
  const { validateServerOrigin } = await transport;
  assert.equal(validateServerOrigin('https://finance.example.com/'), 'https://finance.example.com');
  for (const value of ['', 'http://finance.example.com', 'https://user:secret@finance.example.com', 'https://finance.example.com/api', 'https://finance.example.com?x=1', 'https://finance.example.com/#x']) assert.throws(() => validateServerOrigin(value));
});

test('native API transport preserves JSON errors, isolates cookie handling, and refuses path escapes', async () => {
  const { createApiTransport } = await transport;
  const calls = [];
  const request = createApiTransport({ native: true, origin: 'https://finance.example.com', http: { request: async options => {
    calls.push(options);
    return { status: 401, data: '{"error":"MFA required","mfaRequired":true}', headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'request-1', 'Set-Cookie': 'token=private; HttpOnly; Secure' } };
  } } });
  const response = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'test@example.invalid', password: 'test-only' }) });
  assert.equal(response.status, 401);
  assert.equal(response.ok, false);
  assert.equal((await response.json()).mfaRequired, true);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('x-request-id'), 'request-1');
  assert.equal(calls[0].url, 'https://finance.example.com/api/auth/login');
  assert.equal(calls[0].disableRedirects, true);
  assert.equal(calls[0].data.password, 'test-only');
  assert.equal('Cookie' in calls[0].headers, false);
  for (const path of ['https://other.invalid/api/auth', '//other.invalid/api/auth', '/api/../auth', '/api/%2e%2e/auth', '/api\\other', '/other']) await assert.rejects(() => request(path));
  assert.equal(calls.length, 1, 'Rejected destinations must never reach the native network bridge');
});

test('website API transport stays same-origin and sends HttpOnly session cookies', async () => {
  const { createApiTransport } = await transport;
  const calls = [];
  const request = createApiTransport({ fetchImpl: async (...args) => { calls.push(args); return new Response('{}', { status: 200 }); } });
  await request('/api/auth/me');
  assert.equal(calls[0][0], '/api/auth/me');
  assert.equal(calls[0][1].credentials, 'include');
});
