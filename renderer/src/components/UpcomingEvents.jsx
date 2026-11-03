import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { useAccount } from '../util/AccountContext';
import { useUpcomingEvents } from '../util/useUpcomingEvents';
import { usePurchaseNavigation } from '../util/purchaseNavigation';

export default function UpcomingEvents({ limit, onNavigate }) {
  const { account } = useAccount();
  const upcoming = useUpcomingEvents(account?.id);
  const openPurchase = usePurchaseNavigation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [undo, setUndo] = useState(null);
  useEffect(() => { if (!undo) return; const timer = setTimeout(() => setUndo(null), 10000); return () => clearTimeout(timer); }, [undo]);
  const cancel = async event => {
    setBusy(true); setError('');
    try { await upcoming.removeReminder(event.expenseId); setUndo(event); }
    catch (error) { setError(error.message || 'Unable to cancel reminder.'); }
    finally { setBusy(false); }
  };
  const restore = async () => {
    setBusy(true); setError('');
    try { await upcoming.restoreReminder(undo); setUndo(null); }
    catch (error) { setError(error.message || 'Unable to restore this reminder.'); }
    finally { setBusy(false); }
  };
  return <div className="ux-upcoming-events">
    {(error || upcoming.error) && <p className="ux-error" role="alert">{error || upcoming.error}</p>}
    {undo && <div className="ux-undo" role="status">Reminder canceled. Your note is safe.<button type="button" className="ux-text-button" disabled={busy} onClick={restore}>Undo</button></div>}
    {upcoming.loading && <p role="status">Loading upcoming events…</p>}
    {!upcoming.loading && !upcoming.error && !upcoming.events.length && <div className="ux-empty"><Bell size={25} /><strong>No upcoming reminders</strong><p>Open a purchase to schedule a reminder.</p></div>}
    {(limit ? upcoming.events.slice(0, limit) : upcoming.events).map(event => <article className="ux-event" key={event.expenseId}>
      <div className="ux-event-date"><strong>{new Date(event.dueAt).getDate()}</strong><span>{new Date(event.dueAt).toLocaleDateString(undefined, { month: 'short' })}</span></div>
      <button type="button" className="ux-event-open" onClick={() => { openPurchase(event.expenseId); onNavigate?.(); }}><strong>{event.description}</strong><time dateTime={event.dueAt}>{new Date(event.dueAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>{event.notes?.trim() && <small>{event.notes}</small>}</button>
      <button type="button" className="ux-icon-button" disabled={busy} onClick={() => cancel(event)} aria-label={`Cancel reminder for ${event.description}`} title="Cancel scheduled reminder (keeps purchase and note)"><X size={16} /></button>
    </article>)}
    {!limit && <p className="ux-helper">Times use your local time zone. Canceling a reminder keeps the purchase and its note.</p>}
  </div>;
}
