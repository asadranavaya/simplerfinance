import { Bell, CalendarDays, ChevronRight, Landmark, Settings, Tag } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createElement } from 'react';

export default function MorePage() {
  return <div className="page-container ux-more-page"><h1 className="page-title">More</h1><p className="ux-page-description">Your finances, connections, and preferences.</p><div className="ux-settings-group">{[
    ['/activity', Bell, 'Activity', 'Notifications and purchase reminders'],
    ['/activity?tab=upcoming', CalendarDays, 'Upcoming events', 'Review scheduled purchase reminders'],
    ['/detected-subscriptions', CalendarDays, 'Subscriptions', 'Recurring spending and calendar'],
    ['/settings?panel=simplefin', Landmark, 'Connections', 'Financial institutions and sync status'],
    ['/settings?panel=categorization', Tag, 'Categories & rules', 'Keep your spending organized'],
    ['/settings', Settings, 'Settings', 'Profile, appearance, and security'],
  ].map(([to, Icon, title, detail]) => <Link className="ux-setting-row" key={to} to={to}>{createElement(Icon, { size: 20 })}<span><strong>{title}</strong><small>{detail}</small></span><ChevronRight size={17} /></Link>)}</div></div>;
}
