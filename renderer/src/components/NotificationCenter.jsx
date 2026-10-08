import { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCheck, ShieldAlert, X } from 'lucide-react';
import { api } from '../util/api';

const typeIcon = (type) => type === 'security' ? <ShieldAlert size={18} /> : type === 'success' ? '✓' : type === 'warning' ? '!' : 'i';

function formatNotificationTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const elapsed = Date.now() - date.getTime();
  if (elapsed < 60_000) return 'Just now';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export default function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadNotifications = useCallback(async () => {
    try {
      const data = await api.getNotifications();
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
      setError('');
    } catch (requestError) {
      setError(requestError.message || 'Unable to load notifications.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
    const events = new EventSource('/api/notifications/stream', { withCredentials: true });
    const receiveNotification = (event) => {
      try {
        const notification = JSON.parse(event.data);
        setNotifications(current => current.some(item => item.id === notification.id) ? current : [notification, ...current].slice(0, 100));
        if (!notification.readAt) setUnreadCount(count => count + 1);
      } catch { /* Ignore malformed server events and keep the stream alive. */ }
    };
    events.addEventListener('notification', receiveNotification);
    return () => {
      events.removeEventListener('notification', receiveNotification);
      events.close();
    };
  }, [loadNotifications]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const closeOnEscape = (event) => { if (event.key === 'Escape') setIsOpen(false); };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  const markRead = async (notification) => {
    try {
      await api.markNotificationRead(notification.id);
      setNotifications(current => current.filter(item => item.id !== notification.id));
      setUnreadCount(count => Math.max(0, count - 1));
    } catch (requestError) {
      setError(requestError.message || 'Unable to update the notification.');
    }
  };

  const markAllRead = async () => {
    try {
      await api.markAllNotificationsRead();
      setNotifications([]);
      setUnreadCount(0);
    } catch (requestError) {
      setError(requestError.message || 'Unable to update notifications.');
    }
  };

  return (
    <>
      <button type="button" className="notification-trigger" onClick={() => setIsOpen(true)} aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}>
        <Bell size={21} />
        {unreadCount > 0 && <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>

      {isOpen && <div className="notification-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsOpen(false); }}>
        <section className="notification-modal" role="dialog" aria-modal="true" aria-labelledby="notification-center-title">
          <header className="notification-header">
            <div><span>Activity center</span><h2 id="notification-center-title">Notifications</h2></div>
            <button type="button" className="notification-close" onClick={() => setIsOpen(false)} aria-label="Close notifications"><X size={20} /></button>
          </header>
          <div className="notification-toolbar">
            <span>{unreadCount ? `${unreadCount} unread` : 'You’re all caught up'}</span>
            {unreadCount > 0 && <button type="button" onClick={markAllRead}><CheckCheck size={15} /> Acknowledge all</button>}
          </div>
          {error && <p className="notification-error" role="alert">{error}</p>}
          <div className="notification-list">
            {loading ? <div className="notification-empty">Loading notifications…</div> : notifications.length ? notifications.map(notification => (
              <button type="button" className={`notification-item ${notification.type}${notification.readAt ? '' : ' unread'}`} key={notification.id} onClick={() => markRead(notification)}>
                <span className="notification-type-icon">{typeIcon(notification.type)}</span>
                <span className="notification-copy"><strong>{notification.title}</strong><span>{notification.message}</span><time dateTime={notification.createdAt}>{formatNotificationTime(notification.createdAt)}</time></span>
                {!notification.readAt && <i aria-label="Unread" />}
              </button>
            )) : <div className="notification-empty"><Bell size={28} /><strong>No notifications yet</strong><span>Account and server updates will appear here.</span></div>}
          </div>
        </section>
      </div>}
    </>
  );
}
