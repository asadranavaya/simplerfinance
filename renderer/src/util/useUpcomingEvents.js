import { useEffect, useState } from 'react';
import { api } from './api';

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
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [accountId]);
  const removeReminder = async expenseId => {
    await api.setPurchaseReminder(expenseId, null);
    setEvents(current => current.filter(event => event.expenseId !== expenseId));
  };
  return { events, error, loading, removeReminder };
}
