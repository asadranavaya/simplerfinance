import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, MoreHorizontal, StickyNote } from 'lucide-react';

import { purchaseMoney } from '../util/formatting';
import { useMediaQuery } from '../util/useMediaQuery';
import VendorIcon from './VendorIcon';

export default function PurchaseRow({ expense, onOpen, onTags, actions = [], error }) {
  const [menu, setMenu] = useState(false);
  const container = useRef(null);
  const menuPanel = useRef(null);
  const desktop = useMediaQuery('(min-width: 769px)');
  const [position, setPosition] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    if (!menu) return;
    const place = () => {
      const trigger = container.current?.querySelector('.ux-row-menu-trigger');
      if (!trigger || !menuPanel.current) return;
      const anchor = trigger.getBoundingClientRect();
      const panel = menuPanel.current.getBoundingClientRect();
      const top = anchor.bottom + panel.height + 6 <= window.innerHeight - 8 ? anchor.bottom + 6 : anchor.top - panel.height - 6;
      setPosition({ top: Math.max(8, Math.min(top, window.innerHeight - panel.height - 8)), left: Math.max(8, Math.min(anchor.right - panel.width, window.innerWidth - panel.width - 8)) });
    };
    place();
    menuPanel.current?.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const close = event => { if (!container.current?.contains(event.target) && !menuPanel.current?.contains(event.target)) setMenu(false); };
    const escape = event => { if (event.key === 'Escape') { setMenu(false); container.current?.querySelector('.ux-row-menu-trigger')?.focus(); } };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [menu]);
  const tags = [...new Set(expense.categories || expense.tags || [])];
  const primary = expense.displayCategory || expense.mainCategory || expense.category || tags[0] || 'Uncategorized';
  const otherCount = tags.filter(tag => tag !== primary).length;
  const date = expense.transactionTime || expense.date;
  return <article className="ux-purchase-row" ref={container}>
    <button type="button" className="ux-purchase-open" onClick={onOpen} aria-label={`View purchase details for ${expense.description}`}>
      {expense.icon?.url ? <VendorIcon className="ux-vendor-icon" src={expense.icon.url} alt="" loading="lazy" /> : <span className="ux-vendor-icon ux-vendor-fallback" aria-hidden="true">{(expense.description || '?').slice(0, 1).toUpperCase()}</span>}
      <span className="ux-purchase-copy"><strong>{expense.description}</strong><span className="ux-purchase-meta">
        {date && <time dateTime={date}>{new Date(date.length === 10 ? `${date}T12:00:00` : date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>}
        {expense.pending && <span className="ux-status warning">Pending</span>}
        {Boolean(expense.notes?.trim()) && <StickyNote size={14} aria-label="Has notes" />}
        {expense.reminder && <Bell size={14} aria-label="Has reminder" />}
      </span></span>
      <span className="ux-purchase-amount">{purchaseMoney(expense.amount, expense.reportingCurrency)}{expense.split && <small>Your share</small>}</span>
    </button>
    {desktop ? <div className="ux-tag-summary ux-expanded-tags" aria-label="Purchase categories"><span className="ux-chip">{primary}</span>{tags.filter(tag => tag !== primary).map(tag => <span className="ux-chip secondary" key={tag}>{tag}</span>)}</div> : <button type="button" className="ux-tag-summary" onClick={onTags || onOpen} aria-label={`Edit categories for ${expense.description}`}><span className="ux-chip">{primary}</span>{otherCount > 0 && <span className="ux-chip secondary">+{otherCount}</span>}</button>}
    {actions.length > 0 && <div className="ux-row-menu"><button type="button" className="ux-icon-button ux-row-menu-trigger" onClick={() => setMenu(!menu)} aria-label={`More actions for ${expense.description}`} aria-expanded={menu}><MoreHorizontal size={19} /></button>
      {menu && createPortal(<div ref={menuPanel} className="ux-row-menu-items ux-purchase-menu" style={position}>{actions.map(action => <button type="button" key={action.label} disabled={action.disabled} className={action.danger ? 'danger' : ''} onClick={() => { setMenu(false); container.current?.querySelector('.ux-row-menu-trigger')?.focus({ preventScroll: true }); action.onClick(); }}>{action.label}</button>)}</div>, document.body)}
    </div>}
    {error && <p className="ux-error" role="alert">{error}</p>}
  </article>;
}
