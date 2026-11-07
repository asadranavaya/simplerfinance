import { NavLink, useLocation } from 'react-router-dom';
import { createElement } from 'react';
import { ChartNoAxesCombined, CreditCard, House, Landmark, MoreHorizontal } from 'lucide-react';

export default function MobileNavigation() {
  const { pathname } = useLocation();
  const items = [
    ['/overview', 'Home', House], ['/monthly-spending', 'Spending', CreditCard],
    ['/accounts_overview', 'Accounts', Landmark], ['/category-browser', 'Analytics', ChartNoAxesCombined],
    ['/more', 'More', MoreHorizontal],
  ];
  const moreActive = ['/more', '/settings', '/activity', '/detected-subscriptions'].includes(pathname);
  return <nav className="ux-bottom-nav" aria-label="Main navigation">{items.map(([to, label, Icon]) => <NavLink key={to} to={to} className={({ isActive }) => isActive || (to === '/more' && moreActive) ? 'is-active' : ''}>{createElement(Icon, { size: 21 })}<span>{label}</span></NavLink>)}</nav>;
}
