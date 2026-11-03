import { useEffect, useState } from 'react';
import { isNativeApp, loadNativeIcon } from '../util/appRuntime';

export default function VendorIcon({ src, alt = '', className, ...props }) {
  const [image, setImage] = useState(null);
  useEffect(() => {
    if (!isNativeApp || !src) return;
    let active = true;
    loadNativeIcon(src).then(value => { if (active) setImage({ src, value }); }).catch(() => { if (active) setImage({ src, value: null }); });
    return () => { active = false; };
  }, [src]);
  const resolved = isNativeApp ? image?.src === src ? image.value : null : src;
  if (!resolved) return <span className={`${className || ''} ux-vendor-fallback`} aria-hidden="true">{alt.slice(0, 1)}</span>;
  return <img {...props} className={className} src={resolved} alt={alt} />;
}
