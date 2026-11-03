import { useSearchParams } from 'react-router-dom';
import NotificationList from '../components/NotificationList';
import UpcomingEvents from '../components/UpcomingEvents';

export default function ActivityPage() {
  const [params, setParams] = useSearchParams();
  const upcoming = params.get('tab') === 'upcoming';
  const selectTab = tab => { const next = new URLSearchParams(params); next.set('tab', tab); setParams(next); };
  return <div className="page-container ux-activity-page"><h1 className="page-title">Activity</h1><p className="ux-page-description">Reminders and account updates.</p><div className="ux-tabs" aria-label="Activity views"><button type="button" aria-pressed={!upcoming} onClick={() => selectTab('inbox')}>Inbox</button><button type="button" aria-pressed={upcoming} onClick={() => selectTab('upcoming')}>Upcoming events</button></div>{upcoming ? <UpcomingEvents /> : <NotificationList />}</div>;
}
