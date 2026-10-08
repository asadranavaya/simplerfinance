const dns = require('dns').promises;
const https = require('https');
const net = require('net');

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

class SimplefinHttpError extends Error {
  constructor(message, { statusCode = 502, providerStatus = null, code = 'provider_error' } = {}) {
    super(message);
    this.name = 'SimplefinHttpError';
    this.statusCode = statusCode;
    this.providerStatus = providerStatus;
    this.code = code;
  }
}

function isPublicIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 198 && (b === 18 || b === 19 || b === 51))
    || (a === 203 && b === 0 && c === 113)
  );
}

function isPublicIp(address) {
  const family = net.isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family !== 6) return false;

  const normalized = address.toLowerCase();
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice(7);
    return net.isIP(mapped) === 4 ? isPublicIpv4(mapped) : false;
  }
  return !(
    normalized === '::' || normalized === '::1'
    || normalized.startsWith('fc') || normalized.startsWith('fd')
    || /^fe[89ab]/.test(normalized)
    || normalized.startsWith('ff')
    || normalized.startsWith('2001:') || normalized.startsWith('2002:')
  );
}

function parseHttpsUrl(value, { allowCredentials = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new SimplefinHttpError('SimpleFIN supplied an invalid URL', { statusCode: 400, code: 'invalid_url' });
  }

  if (url.protocol !== 'https:') {
    throw new SimplefinHttpError('SimpleFIN URLs must use HTTPS', { statusCode: 400, code: 'https_required' });
  }
  if (!url.hostname || url.hostname.endsWith('.local')) {
    throw new SimplefinHttpError('SimpleFIN URL hostname is not allowed', { statusCode: 400, code: 'invalid_host' });
  }
  if (!allowCredentials && (url.username || url.password)) {
    throw new SimplefinHttpError('Setup-token URLs must not contain credentials', { statusCode: 400, code: 'invalid_claim_url' });
  }
  return url;
}

async function resolvePublicAddress(hostname) {
  let results;
  try {
    results = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SimplefinHttpError('Could not resolve the SimpleFIN server', { code: 'dns_failed' });
  }

  if (!results.length || results.some(({ address }) => !isPublicIp(address))) {
    throw new SimplefinHttpError('SimpleFIN server resolved to a disallowed network address', {
      statusCode: 400,
      code: 'private_address',
    });
  }
  return results[0];
}

function authorizationHeader(url) {
  if (!url.username && !url.password) return null;
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

async function requestOnce(url, { method, maxBytes, timeoutMs }) {
  const pinned = await resolvePublicAddress(url.hostname);
  const auth = authorizationHeader(url);

  return new Promise((resolve, reject) => {
    const request = https.request({
      protocol: 'https:',
      hostname: url.hostname,
      port: url.port || 443,
      method,
      path: `${url.pathname}${url.search}`,
      servername: url.hostname,
      rejectUnauthorized: true,
      headers: {
        Accept: 'application/json, text/plain;q=0.9',
        'Content-Length': 0,
        'User-Agent': 'SimplerFinance-SimpleFIN/1.0',
        ...(auth ? { Authorization: auth } : {}),
      },
      lookup: (_hostname, options, callback) => {
        const family = typeof options === 'object' && options?.all ? undefined : pinned.family;
        if (typeof options === 'object' && options?.all) {
          callback(null, [{ address: pinned.address, family: pinned.family }]);
        } else {
          callback(null, pinned.address, family);
        }
      },
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          request.destroy(new SimplefinHttpError('SimpleFIN response was too large', { code: 'response_too_large' }));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({
        status: response.statusCode || 0,
        location: response.headers.location,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });

    request.setTimeout(timeoutMs, () => request.destroy(new SimplefinHttpError('SimpleFIN request timed out', { code: 'timeout' })));
    request.on('error', (error) => reject(error instanceof SimplefinHttpError
      ? error
      : new SimplefinHttpError('Unable to contact the SimpleFIN server', { code: 'network_error' })));
    request.end();
  });
}

async function requestText(value, options = {}) {
  let url = parseHttpsUrl(value, { allowCredentials: options.allowCredentials });
  let method = options.method || 'GET';
  const originalOrigin = url.origin;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await requestOnce(url, {
      method,
      maxBytes: options.maxBytes || 1024 * 1024,
      timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    });
    if (![301, 302, 303, 307, 308].includes(response.status) || !response.location) return response;
    if (redirects === MAX_REDIRECTS) throw new SimplefinHttpError('Too many SimpleFIN redirects', { code: 'too_many_redirects' });

    const next = parseHttpsUrl(new URL(response.location, url).toString(), { allowCredentials: options.allowCredentials });
    if (next.origin !== originalOrigin && (next.username || next.password)) {
      throw new SimplefinHttpError('SimpleFIN redirected credentials to another server', { code: 'unsafe_redirect' });
    }
    if (next.origin !== url.origin && !next.username && !next.password) {
      // Never copy Basic credentials across origins; a legitimate destination
      // must provide its own credentials in the new access URL.
      next.username = '';
      next.password = '';
    }
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) method = 'GET';
    url = next;
  }
  throw new SimplefinHttpError('Too many SimpleFIN redirects', { code: 'too_many_redirects' });
}

function decodeSetupToken(setupToken) {
  const token = typeof setupToken === 'string' ? setupToken.trim() : '';
  if (!token || token.length > 8192 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(token)) {
    throw new SimplefinHttpError('Enter a valid SimpleFIN setup token', { statusCode: 400, code: 'invalid_setup_token' });
  }

  let decoded;
  try {
    decoded = Buffer.from(token.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    throw new SimplefinHttpError('Enter a valid SimpleFIN setup token', { statusCode: 400, code: 'invalid_setup_token' });
  }
  if (!decoded || decoded.includes('\uFFFD') || Buffer.byteLength(decoded) > 4096) {
    throw new SimplefinHttpError('Enter a valid SimpleFIN setup token', { statusCode: 400, code: 'invalid_setup_token' });
  }
  return parseHttpsUrl(decoded).toString();
}

async function claimSetupToken(setupToken) {
  const claimUrl = decodeSetupToken(setupToken);
  const response = await requestText(claimUrl, { method: 'POST', maxBytes: 4096 });
  if (response.status === 403) {
    throw new SimplefinHttpError('This setup token was already claimed or may be compromised. Disable it in SimpleFIN and create a new token.', {
      statusCode: 400,
      providerStatus: 403,
      code: 'claim_rejected',
    });
  }
  if (response.status !== 200) {
    throw new SimplefinHttpError('SimpleFIN could not claim this setup token', { providerStatus: response.status, code: 'claim_failed' });
  }

  const accessUrl = parseHttpsUrl(response.body.trim(), { allowCredentials: true });
  if (!accessUrl.username && !accessUrl.password) {
    throw new SimplefinHttpError('SimpleFIN returned an invalid access URL', { code: 'invalid_access_url' });
  }
  return accessUrl.toString().replace(/\/$/, '');
}

async function fetchAccountSet(accessUrl, {
  balancesOnly = true,
  startDate,
  endDate,
  includePending = false,
  accountIds = [],
} = {}) {
  const base = parseHttpsUrl(accessUrl, { allowCredentials: true });
  base.pathname = `${base.pathname.replace(/\/$/, '')}/accounts`;
  base.search = '';
  base.searchParams.set('version', '2');
  if (balancesOnly) base.searchParams.set('balances-only', '1');
  if (startDate != null) base.searchParams.set('start-date', String(startDate));
  if (endDate != null) base.searchParams.set('end-date', String(endDate));
  if (includePending) base.searchParams.set('pending', '1');
  for (const accountId of accountIds) base.searchParams.append('account', String(accountId));

  const response = await requestText(base.toString(), { allowCredentials: true, maxBytes: 25 * 1024 * 1024 });
  if (response.status === 401 || response.status === 403) {
    throw new SimplefinHttpError('SimpleFIN access was revoked. Reconnect to continue syncing.', {
      statusCode: 400,
      providerStatus: response.status,
      code: 'access_revoked',
    });
  }
  if (response.status === 402) {
    throw new SimplefinHttpError('SimpleFIN requires attention to the Bridge subscription.', {
      statusCode: 400,
      providerStatus: 402,
      code: 'payment_required',
    });
  }
  if (response.status !== 200) {
    throw new SimplefinHttpError('SimpleFIN account discovery failed', { providerStatus: response.status, code: 'discovery_failed' });
  }

  let accountSet;
  try {
    accountSet = JSON.parse(response.body);
  } catch {
    throw new SimplefinHttpError('SimpleFIN returned an invalid account response', { code: 'invalid_response' });
  }
  if (!accountSet || !Array.isArray(accountSet.accounts)) {
    throw new SimplefinHttpError('SimpleFIN response did not contain an account list', { code: 'invalid_response' });
  }
  return accountSet;
}

module.exports = {
  SimplefinHttpError,
  isPublicIp,
  parseHttpsUrl,
  decodeSetupToken,
  claimSetupToken,
  fetchAccountSet,
};
