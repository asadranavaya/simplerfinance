import { useEffect, useState } from 'react';
import { App } from '@capacitor/app';
import { isNativeApp } from '../util/appRuntime';

export default function AppLifecycle() {
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    let stopped = false;
    let listener;
    if (isNativeApp) App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) { update(); window.dispatchEvent(new Event('focus')); }
    }).then(handle => { if (stopped) handle.remove(); else listener = handle; });
    return () => { stopped = true; listener?.remove(); window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  return offline ? <div className="app-connectivity-notice" role="status">You’re offline. Connect to the internet to load or save your finances.</div> : null;
}
