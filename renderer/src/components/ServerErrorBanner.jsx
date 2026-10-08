import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

export default function ServerErrorBanner() {
  const [failure, setFailure] = useState(null);

  useEffect(() => {
    const showFailure = (event) => setFailure({
      requestId: event.detail?.requestId || '',
      occurrence: Date.now(),
    });
    window.addEventListener('budget:server-error', showFailure);
    return () => window.removeEventListener('budget:server-error', showFailure);
  }, []);

  if (!failure) return null;

  return (
    <div className="server-error-banner" role="alert" aria-live="assertive">
      <span>
        <strong>Something went wrong on our server.</strong>
        {failure.requestId
          ? <> Please try again. Request ID: <code>{failure.requestId}</code></>
          : <> Please try again.</>}
      </span>
      <button type="button" onClick={() => setFailure(null)} aria-label="Dismiss server error"><X size={15} /></button>
    </div>
  );
}
