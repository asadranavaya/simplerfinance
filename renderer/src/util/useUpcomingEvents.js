import { useEffect, useState } from 'react';
import { api } from './api';
import { announcePurchaseUpdate } from './purchaseNavigation';

export function useUpcomingEvents(accountId) {
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setEvents([]);
    setLoading(Boolean(accountId));
    setError('');
    const refresh = async () => {
      if (!accountId) return;
      try {
        const result = await api.getUpcomingEvents();
        if (active) { setEvents(result.events || []); setError(''); }
      } catch (requestError) {
        if (active) setError(requestError.message || 'Unable to load upcoming events.');
      } finally { if (active) setLoading(false); }
    };
    refresh();
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    window.addEventListener('budget:purchases-updated', refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('budget:purchases-updated', refresh); };
  }, [accountId]);
  const removeReminder = async expenseId => {
    await api.setPurchaseReminder(expenseId, null);
    setEvents(current => current.filter(event => event.expenseId !== expenseId));
    announcePurchaseUpdate({ id: expenseId });
  };
  const restoreReminder = async event => {
    await api.setPurchaseReminder(event.expenseId, event.dueAt);
    setEvents(current => [...current.filter(item => item.expenseId !== event.expenseId), event].sort((a, b) => a.dueAt.localeCompare(b.dueAt)));
    announcePurchaseUpdate({ id: event.expenseId });
  };
  return { events, error, loading, removeReminder, restoreReminder };
}
