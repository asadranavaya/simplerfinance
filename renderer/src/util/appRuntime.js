import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { createApiTransport, validateServerOrigin } from './apiTransport';

export const isNativeApp = Capacitor.isNativePlatform();
const serverOrigin = isNativeApp ? validateServerOrigin(import.meta.env.VITE_API_ORIGIN || '') : '';
export const apiFetch = createApiTransport({ native: isNativeApp, origin: serverOrigin, http: CapacitorHttp });
const icons = new Map();

async function fetchNativeIcon(path) {
  // Asset paths come from the API, never accept an arbitrary remote destination.
  if (!/^\/api\/icons\/assets\/[a-zA-Z0-9_-]+\/\d+$/.test(path)) throw new Error('Unsupported icon path.');
  const result = await CapacitorHttp.get({ url: `${serverOrigin}${path}`, responseType: 'arraybuffer', connectTimeout: 15000, readTimeout: 15000, disableRedirects: true });
  if (result.status !== 200 || typeof result.data !== 'string') throw new Error('Unable to load icon.');
  const contentType = Object.entries(result.headers || {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1]?.split(';')[0];
  if (!['image/png', 'image/webp', 'image/jpeg'].includes(contentType)) throw new Error('Unsupported icon format.');
  return `data:${contentType};base64,${result.data}`;
}

export function loadNativeIcon(path) {
  if (!icons.has(path)) {
    if (icons.size >= 128) icons.delete(icons.keys().next().value);
    icons.set(path, fetchNativeIcon(path).catch(error => { icons.delete(path); throw error; }));
  }
  return icons.get(path);
}
