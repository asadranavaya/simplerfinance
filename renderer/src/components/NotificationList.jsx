import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, ShieldAlert, TriangleAlert } from 'lucide-react';
import { useNotifications } from '../util/NotificationContext';
import { usePurchaseNavigation } from '../util/purchaseNavigation';

export default function NotificationList({ onNavigate }) {
  const { notifications, unreadCount, loading, error, acknowledge } = useNotifications();
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const openPurchase = usePurchaseNavigation();
  const dismiss = async id => {
    setBusy(true); setActionError('');
    try { await acknowledge(id); } catch (error) { setActionError(error.message); } finally { setBusy(false); }
  };
  return <>
    <div className="ux-section-line"><span className="ux-helper">{unreadCount} unread</span>{notifications.length > 0 && <button type="button" className="ux-text-button" disabled={busy} onClick={() => dismiss()}>Acknowledge all</button>}</div>
    {(error || actionError) && <p className="ux-error" role="alert">{error || actionError}</p>}
    {loading ? <p role="status">Loading notifications…</p> : !notifications.length && <div className="ux-empty"><Bell size={26} /><strong>You’re all caught up</strong><p>Account updates and due reminders will appear here.</p></div>}
    {notifications.map(notification => <article className={`ux-notice ${notification.type}`} key={notification.id}>
      <div className="ux-section-line"><span className="ux-chip">{notification.type === 'security' ? <ShieldAlert size={14} /> : notification.type === 'warning' ? <TriangleAlert size={14} /> : <Bell size={14} />}{notification.title}</span><time dateTime={notification.createdAt}>{new Date(notification.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time></div>
      {notification.metadata?.purchaseDescription && <h3>{notification.metadata.purchaseDescription}</h3>}
      <p>{notification.message}</p>
      <div className="ux-notice-actions">{notification.metadata?.expenseId && <button type="button" className="ux-secondary" onClick={() => { openPurchase(notification.metadata.expenseId); onNavigate?.(); }}>Open purchase</button>}
        {notification.type === 'warning' && !notification.metadata?.expenseId && <Link to="/settings?panel=simplefin" className="ux-secondary" onClick={onNavigate}>Review connections</Link>}
        <button type="button" className="ux-text-button" disabled={busy} onClick={() => dismiss(notification.id)}>Acknowledge</button>
      </div>
    </article>)}
  </>;
}
