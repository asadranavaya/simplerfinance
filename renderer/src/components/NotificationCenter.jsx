import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import Sheet from './Sheet';
import NotificationList from './NotificationList';
import UpcomingEvents from './UpcomingEvents';
import { useNotifications } from '../util/NotificationContext';

export default function NotificationCenter() {
  const { unreadCount } = useNotifications();
  const [open, setOpen] = useState(false);
  const [upcoming, setUpcoming] = useState(false);
  return <><button type="button" className="ux-icon-button ux-notification-trigger" onClick={() => setOpen(true)} aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}><Bell size={21} />{unreadCount > 0 && <span className="ux-notification-dot">{unreadCount > 99 ? '99+' : unreadCount}</span>}</button>
    {open && <Sheet title="Activity" subtitle="Reminders and account updates" onClose={() => setOpen(false)} footer={<Link className="ux-secondary" to={upcoming ? '/activity?tab=upcoming' : '/activity'} onClick={() => setOpen(false)}>Open activity center</Link>}>
      <div className="ux-tabs"><button type="button" aria-pressed={!upcoming} onClick={() => setUpcoming(false)}>Inbox</button><button type="button" aria-pressed={upcoming} onClick={() => setUpcoming(true)}>Upcoming</button></div>{upcoming ? <UpcomingEvents onNavigate={() => setOpen(false)} /> : <NotificationList onNavigate={() => setOpen(false)} />}
    </Sheet>}
  </>;
}
