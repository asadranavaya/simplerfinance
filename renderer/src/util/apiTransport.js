export function validateServerOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('The app server must be an HTTPS origin, such as https://finance.example.com.');
  }
  return url.origin;
}

// Native requests use the OS cookie jar. Session tokens never go into web storage.
export function createApiTransport({ native = false, origin = '', http, fetchImpl = (...args) => fetch(...args) } = {}) {
  const server = native ? validateServerOrigin(origin) : '';
  return async (path, options = {}) => {
    if (!path.startsWith('/api/') || path.includes('\\') || new URL(path, 'https://local.invalid').pathname !== path.split('?')[0]) {
      throw new Error('Only application API paths are supported.');
    }
    if (!native) return fetchImpl(path, { ...options, credentials: 'include' });
    const result = await http.request({
      url: `${server}${path}`,
      method: options.method || 'GET',
      headers: options.headers || {},
      ...(options.body !== undefined ? { data: JSON.parse(options.body) } : {}),
      responseType: 'text',
      connectTimeout: 15000,
      readTimeout: 15000,
      disableRedirects: true,
    });
    // Hide transport-only response headers, including Set-Cookie, from callers.
    const headers = {};
    for (const [key, value] of Object.entries(result.headers || {})) {
      if (['content-type', 'x-request-id'].includes(key.toLowerCase())) headers[key] = value;
    }
    return new Response([204, 205, 304].includes(result.status) ? null : typeof result.data === 'string' ? result.data : JSON.stringify(result.data), { status: result.status, headers });
  };
}
