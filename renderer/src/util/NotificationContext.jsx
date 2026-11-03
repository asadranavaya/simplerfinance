/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { api } from './api';
import { IS_APP_BUILD } from './appFeatures';

const Context = createContext(null);
export function NotificationProvider({ children }) {
  const { user } = useAuth();
  const [state, setState] = useState({ notifications: [], unreadCount: 0, loading: true, error: '' });
  const accountId = user?.accountId;
  const email = user?.email;
  useEffect(() => {
    let active = true;
    setState({ notifications: [], unreadCount: 0, loading: Boolean(accountId), error: '' });
    if (!accountId) return;
    const refresh = () => api.getNotifications().then(result => { if (active) setState({ ...result, loading: false, error: '' }); }).catch(error => { if (active) setState(current => ({ ...current, loading: false, error: error.message })); });
    refresh();
    const events = IS_APP_BUILD ? null : new EventSource('/api/notifications/stream', { withCredentials: true });
    const poll = IS_APP_BUILD ? window.setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 30000) : null;
    const receive = event => {
      try { const item = JSON.parse(event.data); setState(current => current.notifications.some(row => row.id === item.id) ? current : { ...current, notifications: [item, ...current.notifications].slice(0, 100), unreadCount: current.unreadCount + (item.readAt ? 0 : 1) }); }
      catch { /* Keep the stream alive for a malformed event. */ }
    };
    events?.addEventListener('notification', receive);
    events?.addEventListener('connected', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('budget:purchases-updated', refresh);
    return () => { active = false; events?.close(); if (poll) window.clearInterval(poll); window.removeEventListener('focus', refresh); window.removeEventListener('budget:purchases-updated', refresh); };
  }, [accountId, email]);
  const acknowledge = async id => {
    if (id) await api.markNotificationRead(id); else await api.markAllNotificationsRead();
    setState(current => ({ ...current, notifications: id ? current.notifications.filter(item => item.id !== id) : [], unreadCount: id ? Math.max(0, current.unreadCount - (current.notifications.find(item => item.id === id)?.readAt ? 0 : 1)) : 0 }));
  };
  return <Context.Provider value={{ ...state, acknowledge }}>{children}</Context.Provider>;
}
export const useNotifications = () => useContext(Context);
