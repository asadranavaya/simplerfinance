import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, Link2, X } from 'lucide-react';
import { useAccount } from '../util/AccountContext';
import { api } from '../util/api';
import { nextEstimatedPayment, projectedDateForMonth, utcDate } from '../util/subscriptionCalendar';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function money(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value) || 0);
}

function displayDate(value) {
  if (!value) return 'N/A';
  return new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export default function DetectedSubscriptionsPage() {
  const { account } = useAccount();
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastDetection, setLastDetection] = useState(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => utcDate(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const [selectedDay, setSelectedDay] = useState(null);
  const [linkTarget, setLinkTarget] = useState(null);
  const [linkSourceId, setLinkSourceId] = useState('');
  const [linkSaving, setLinkSaving] = useState(false);
  const [linkError, setLinkError] = useState('');

  useEffect(() => {
    if (account?.id) loadSubscriptions();
  // The active account is the only dependency that changes the subscription owner.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id]);

  const loadSubscriptions = async () => {
    if (!account?.id) return;
    setLoading(true);
    try {
      setSubscriptions(await api.getDetectedSubscriptions());
    } catch (error) {
      console.error('Error loading subscriptions:', error);
    } finally {
      setLoading(false);
    }
  };

  const runDetection = async () => {
    if (!account?.id) return;
    setLoading(true);
    try {
      setSubscriptions(await api.detectSubscriptions());
      setLastDetection(new Date());
    } catch (error) {
      console.error('Error detecting subscriptions:', error);
    } finally {
      setLoading(false);
    }
  };

  const removeSubscription = async (subscriptionId) => {
    try {
      if (await api.removeSubscription(account.id, subscriptionId)) await loadSubscriptions();
    } catch (error) {
      console.error('Error removing subscription:', error);
    }
  };

  const openLinkDialog = (subscription) => {
    setLinkTarget(subscription);
    setLinkSourceId('');
    setLinkError('');
  };

  const linkSubscription = async () => {
    if (!linkTarget || !linkSourceId) return;
    setLinkSaving(true);
    setLinkError('');
    try {
      setSubscriptions(await api.linkSubscription(linkTarget.id, linkSourceId));
      setLinkTarget(null);
      setLinkSourceId('');
    } catch (error) {
      setLinkError(error.message || 'The subscriptions could not be linked.');
    } finally {
      setLinkSaving(false);
    }
  };

  const unlinkSubscription = async (sourceId) => {
    try {
      setSubscriptions(await api.unlinkSubscription(sourceId));
    } catch (error) {
      console.error('Error unlinking subscription:', error);
    }
  };

  const activeSubscriptions = useMemo(() => subscriptions.filter(subscription => subscription.isActive), [subscriptions]);
  const monthlyTotal = activeSubscriptions.reduce((total, subscription) => total + Number(subscription.averageAmount || 0), 0);
  const upcoming = useMemo(() => activeSubscriptions.map(subscription => ({
    ...subscription,
    nextPayment: nextEstimatedPayment(subscription.lastPayment),
  })).filter(subscription => subscription.nextPayment).sort((left, right) => left.nextPayment - right.nextPayment), [activeSubscriptions]);

  const monthEvents = useMemo(() => {
    const year = calendarMonth.getUTCFullYear();
    const month = calendarMonth.getUTCMonth();
    return activeSubscriptions.map(subscription => {
      const firstUpcoming = nextEstimatedPayment(subscription.lastPayment);
      const projected = projectedDateForMonth(subscription.lastPayment, year, month);
      if (!firstUpcoming || !projected || projected < firstUpcoming) return null;
      return { ...subscription, projected };
    }).filter(Boolean);
  }, [activeSubscriptions, calendarMonth]);

  const calendarDays = useMemo(() => {
    const year = calendarMonth.getUTCFullYear();
    const month = calendarMonth.getUTCMonth();
    const firstGridDate = utcDate(year, month, 1 - utcDate(year, month, 1).getUTCDay());
    return Array.from({ length: 42 }, (_, index) => new Date(firstGridDate.getTime() + index * DAY_MS));
  }, [calendarMonth]);

  const selectedEvents = selectedDay
    ? monthEvents.filter(event => event.projected.toISOString().slice(0, 10) === selectedDay)
    : [];
  const currentMonthKey = `${calendarMonth.getUTCFullYear()}-${calendarMonth.getUTCMonth()}`;
  const todayKey = new Date().toISOString().slice(0, 10);

  const changeMonth = (offset) => {
    setCalendarMonth(current => utcDate(current.getUTCFullYear(), current.getUTCMonth() + offset, 1));
    setSelectedDay(null);
  };

  if (!account) {
    return <div className="no-account-message"><h2>No Account Selected</h2><p>Please go back and select a profile to continue.</p></div>;
  }

  return (
    <div className="page-container subscriptions-page">
      <section className={`subscriptions-workspace${calendarOpen ? ' showing-calendar' : ''}`}>
        <div className="subscriptions-workspace-slider">
          <div className="subscriptions-overview-panel">
            <div className="header-row subscriptions-header">
              <div><span className="page-eyebrow">Recurring spending</span><h1>Detected Monthly Subscriptions</h1></div>
              <button onClick={runDetection} className="btn-primary" disabled={loading}>{loading ? 'Detecting…' : 'Run Detection'}</button>
            </div>

            <button type="button" className="subscription-calendar-launcher" onClick={() => setCalendarOpen(true)}>
              <span className="subscription-calendar-icon"><CalendarDays size={23} /></span>
              <span className="subscription-calendar-copy">
                <small>Upcoming payments</small>
                <strong>Subscription calendar</strong>
                <span>{upcoming.length ? `${upcoming.length} active payment${upcoming.length === 1 ? '' : 's'} mapped by estimated date` : 'Run detection to map upcoming payments'}</span>
              </span>
              <span className="subscription-calendar-preview" aria-hidden="true">
                {upcoming.slice(0, 3).map(item => <i key={item.id} title={item.description}>{item.nextPayment.getUTCDate()}</i>)}
              </span>
              <ChevronRight className="subscription-calendar-arrow" size={20} />
            </button>

            <div className="content-row subscription-summary-grid">
              <div className="content-card"><h3>Active Subscriptions</h3><div className="subscription-stat-value active">{activeSubscriptions.length}</div></div>
              <div className="content-card"><h3>Monthly Total</h3><div className="subscription-stat-value monthly">{money(monthlyTotal)}</div></div>
              <div className="content-card"><h3>Total Subscriptions</h3><div className="subscription-stat-value total">{subscriptions.length}</div></div>
            </div>

            {lastDetection && <div className="subscription-last-run">Last detection run: {lastDetection.toLocaleString()}</div>}

            <div className="content-card subscriptions-list-card">
              <h2>Detected Subscriptions</h2>
              {loading ? <p>Loading subscriptions...</p> : subscriptions.length === 0 ? (
                <div className="table-empty-state"><p>No subscriptions detected yet.</p><p className="table-empty-hint">Run detection to analyze your expenses for recurring payments.</p></div>
              ) : (
                <div className="data-table-wrap">
                  <table className="data-table subscriptions-table">
                    <thead><tr><th>Subscription</th><th className="numeric">Monthly Cost</th><th>Next Payment</th><th className="numeric">Total Paid</th><th>First Detected</th><th className="centered">Status</th><th className="centered no-divider">Actions</th></tr></thead>
                    <tbody>{[...subscriptions].sort((a, b) => Number(b.isActive) - Number(a.isActive) || b.averageAmount - a.averageAmount).map(subscription => {
                      const nextPayment = subscription.isActive ? nextEstimatedPayment(subscription.lastPayment) : null;
                      const linkedNames = new Set((subscription.linkedSubscriptions || []).map(item => item.description));
                      const automaticVariants = (subscription.variants || []).filter(value => value !== subscription.description && !linkedNames.has(value));
                      return <tr key={subscription.id} className={subscription.isActive ? '' : 'inactive'}>
                        <td className="subscription-name">{subscription.description}{automaticVariants.length > 0 && <div className="subscription-variants">Also appears as: {automaticVariants.join(', ')}</div>}{subscription.linkedSubscriptions?.length > 0 && <div className="subscription-linked-variants"><span>Also appears as:</span>{subscription.linkedSubscriptions.map(item => <span className="subscription-linked-chip" key={item.id}>{item.description}<button type="button" title={`Unlink ${item.description}`} aria-label={`Unlink ${item.description}`} onClick={() => unlinkSubscription(item.id)}><X size={11}/></button></span>)}</div>}<div className="subscription-frequency">{subscription.occurrences} payments • {subscription.consecutiveMonths} consecutive months</div></td>
                        <td className="numeric strong">{money(subscription.averageAmount)}</td>
                        <td>{displayDate(nextPayment)}</td>
                        <td className="numeric strong">{money(subscription.totalPaid)}</td>
                        <td>{displayDate(subscription.firstDetected)}</td>
                        <td className="centered"><span className={`subscription-status ${subscription.isActive ? 'active' : 'cancelled'}`}>{subscription.isActive ? 'ACTIVE' : 'CANCELLED'}</span></td>
                        <td className="centered no-divider"><div className="subscription-row-actions"><button type="button" onClick={() => openLinkDialog(subscription)} className="subscription-link-button" disabled={subscriptions.length < 2} title={subscriptions.length < 2 ? 'No other subscriptions are available to link' : 'Fold another detected entry into this subscription'}><Link2 size={13}/> Link</button><button onClick={() => removeSubscription(subscription.id)} className="subscription-remove-button">Remove</button></div></td>
                      </tr>;
                    })}</tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="content-card subscription-detection-card"><h3>How Detection Works</h3><ul className="detection-info-list"><li>Analyzes your expenses to find recurring patterns</li><li>Identifies expenses that appear in 3+ consecutive months with amounts staying within $3 month to month</li><li>Groups similar descriptions and estimates the next payment from the last observed payment day</li><li><strong>Link duplicates:</strong> Choose the subscription to keep, then link another detected entry into it</li><li>Marks subscriptions as cancelled if no payment appears for two months</li><li><strong>Remove false positives:</strong> Remove an item to exclude it from future detection</li></ul></div>
          </div>

          <div className="subscriptions-calendar-panel" aria-hidden={!calendarOpen}>
            <div className="subscription-calendar-toolbar">
              <button type="button" className="subscription-calendar-back" onClick={() => setCalendarOpen(false)}><ArrowLeft size={17} /> Back to subscriptions</button>
              <div><span className="page-eyebrow">Estimated schedule</span><h1>Subscription calendar</h1><p>Dates are projected from each subscription’s latest observed payment day.</p></div>
            </div>

            <div className="subscription-calendar-layout">
              <section className="content-card subscription-calendar-card">
                <header className="subscription-calendar-month-header">
                  <button type="button" aria-label="Previous month" onClick={() => changeMonth(-1)}><ChevronLeft size={19} /></button>
                  <div><strong>{calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</strong><span>{monthEvents.length} estimated payment{monthEvents.length === 1 ? '' : 's'} · {money(monthEvents.reduce((sum, event) => sum + event.averageAmount, 0))}</span></div>
                  <button type="button" aria-label="Next month" onClick={() => changeMonth(1)}><ChevronRight size={19} /></button>
                </header>
                <div className="subscription-calendar-weekdays">{WEEKDAYS.map(day => <span key={day}>{day}</span>)}</div>
                <div className="subscription-calendar-grid">
                  {calendarDays.map(day => {
                    const dayKey = day.toISOString().slice(0, 10);
                    const dayEvents = monthEvents.filter(event => event.projected.toISOString().slice(0, 10) === dayKey);
                    const outside = `${day.getUTCFullYear()}-${day.getUTCMonth()}` !== currentMonthKey;
                    return <button type="button" key={dayKey} className={`subscription-calendar-day${outside ? ' outside' : ''}${dayKey === todayKey ? ' today' : ''}${selectedDay === dayKey ? ' selected' : ''}${dayEvents.length ? ' has-events' : ''}`} onClick={() => setSelectedDay(dayKey)}>
                      <span>{day.getUTCDate()}</span>
                      <div className="subscription-calendar-icon-stack" aria-label={dayEvents.map(event => event.description).join(', ')}>{dayEvents.slice(0, 4).map(event => <span key={event.id} title={`${event.description} · ${money(event.averageAmount)}`}>{event.icon ? <img src={event.icon.url} alt=""/> : <b>{event.description.slice(0,1).toUpperCase()}</b>}</span>)}{dayEvents.length > 4 && <small title={`${dayEvents.length - 4} additional payments`}>+{dayEvents.length - 4}</small>}</div>
                    </button>;
                  })}
                </div>
              </section>

              <aside className="content-card subscription-calendar-agenda">
                <div className="subscription-agenda-heading"><small>{selectedDay ? displayDate(`${selectedDay}T00:00:00Z`) : 'Next estimated payments'}</small><strong>{selectedDay ? money(selectedEvents.reduce((sum, item) => sum + item.averageAmount, 0)) : money(upcoming.slice(0, 5).reduce((sum, item) => sum + item.averageAmount, 0))}</strong></div>
                <div className="subscription-agenda-list">
                  {(selectedDay ? selectedEvents : upcoming.slice(0, 5)).map(item => {
                    const paymentDate = item.projected || item.nextPayment;
                    return <article key={item.id}><span className="subscription-agenda-date"><b>{paymentDate.getUTCDate()}</b><small>{paymentDate.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}</small></span><div><strong>{item.description}</strong><small>Estimated monthly payment</small></div><b>{money(item.averageAmount)}</b></article>;
                  })}
                  {!(selectedDay ? selectedEvents : upcoming).length && <div className="subscription-agenda-empty"><CalendarDays size={24} /><strong>No estimated payments</strong><span>{selectedDay ? 'Select another date to view its schedule.' : 'Run subscription detection to create a schedule.'}</span></div>}
                </div>
                <p className="subscription-calendar-disclaimer">Estimated dates may differ from the merchant’s actual billing date. They do not initiate or authorize payments.</p>
              </aside>
            </div>
          </div>
        </div>
      </section>
      {linkTarget && <div className="modal-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !linkSaving) setLinkTarget(null); }}>
        <div className="modal-content subscription-link-modal" role="dialog" aria-modal="true" aria-labelledby="subscription-link-title">
          <div className="modal-header"><div><span className="page-eyebrow">Manual grouping</span><h2 id="subscription-link-title">Link a duplicate subscription</h2><p>Choose an entry that should be folded into <strong>{linkTarget.description}</strong>. The underlying purchases remain unchanged.</p></div><button type="button" className="modal-close" aria-label="Close" disabled={linkSaving} onClick={() => setLinkTarget(null)}>×</button></div>
          <div className="subscription-link-selection">
            <label htmlFor="subscription-link-source">Subscription to fold in</label>
            <select id="subscription-link-source" value={linkSourceId} onChange={event => setLinkSourceId(event.target.value)} disabled={linkSaving}>
              <option value="">Choose a detected subscription</option>
              {subscriptions.filter(item => item.id !== linkTarget.id).map(item => <option key={item.id} value={item.id}>{item.description} · {money(item.averageAmount)}</option>)}
            </select>
            {linkError && <div className="form-error">{linkError}</div>}
          </div>
          <div className="modal-actions"><button type="button" className="btn-secondary" disabled={linkSaving} onClick={() => setLinkTarget(null)}>Cancel</button><button type="button" className="btn-primary" disabled={!linkSourceId || linkSaving} onClick={linkSubscription}><Link2 size={15}/>{linkSaving ? 'Linking…' : 'Link subscriptions'}</button></div>
        </div>
      </div>}
    </div>
  );
}
