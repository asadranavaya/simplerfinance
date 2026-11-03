import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

let openSheets = 0;
let originalOverflow = '';

// One focus/scroll lifecycle for mobile sheets and desktop inspectors.
export default function Sheet({ title, subtitle, children, footer, onClose, className = '' }) {
  const headingId = useId();
  const panel = useRef(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const previousFocus = document.activeElement;
    if (openSheets === 0) originalOverflow = document.body.style.overflow;
    openSheets += 1;
    document.body.style.overflow = 'hidden';
    const workspace = document.querySelector('.app-shell');
    if (workspace) workspace.inert = true;
    panel.current?.focus();
    const keyboard = event => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const targets = [...panel.current.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter(el => el.getClientRects().length);
      const first = targets[0]; const last = targets.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
    };
    const element = panel.current;
    element.addEventListener('keydown', keyboard);
    return () => {
      openSheets -= 1;
      if (openSheets === 0) { document.body.style.overflow = originalOverflow; if (workspace) workspace.inert = false; }
      element.removeEventListener('keydown', keyboard);
      if (previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus();
    };
  }, []);
  return createPortal(<div className={`ux-sheet-overlay ${className}`} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panel} className="ux-sheet" role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1}>
      <div className="ux-sheet-grabber" />
      <header className="ux-sheet-heading"><div><h2 id={headingId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" className="ux-icon-button" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`}><X size={20} /></button></header>
      <div className="ux-sheet-body">{children}</div>
      {footer && <footer className="ux-sheet-footer">{footer}</footer>}
    </section>
  </div>, document.body);
}
