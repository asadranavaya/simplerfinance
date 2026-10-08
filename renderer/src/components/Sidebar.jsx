import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Eye, LogOut } from 'lucide-react';
import { useAuth } from '../util/AuthContext';
import { useAccount } from '../util/AccountContext';
import { api } from '../util/api';
import NetWorthChart from './NetWorthChart';

const NAV_LINKS = [
  { to: '/overview', label: 'Overview', icon: '📊' },
  { to: '/monthly-spending', label: 'Spending', icon: '📉' },
  { to: '/accounts_overview', label: 'Accounts', icon: '💳' },
  { to: '/category-browser', label: 'Analytics', icon: '◒' },
  { to: '/detected-subscriptions', label: 'Subscriptions', icon: '🔄' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

export default function Sidebar({ isMobile, onClose }) {
  const { user, logout } = useAuth();
  const { account } = useAccount();
  const location = useLocation();
  const navigate = useNavigate();
  const [netWorthData, setNetWorthData] = useState({ value: 0, changePercent: null, hasComparison: false, history: [] });
  const [signingOut, setSigningOut] = useState(false);
  const netWorthPrivacyKey = account?.id ? `budget:hide-net-worth:${account.id}` : null;
  const [netWorthHidden, setNetWorthHidden] = useState(false);
  const isAdmin = user?.role === 'admin';

  const isActive = (to) => location.pathname === to
    || (to === '/admin/site-identity' && ['/admin/icons', '/admin/categories'].includes(location.pathname));
  const navLinks = isAdmin
    ? [
        { to: '/admin', label: 'Dashboard', icon: '▦' },
        { to: '/admin/accounts', label: 'Accounts', icon: '👥' },
        { to: '/admin/site-identity', label: 'Site Identity', icon: '◇' },
        { to: '/admin/security', label: 'Security', icon: '🛡️' },
        { to: '/admin/telemetry', label: 'Telemetry', icon: '⌁' },
        { to: '/settings', label: 'Settings', icon: '⚙️' },
      ]
    : NAV_LINKS;

  useEffect(() => {
    if (!account?.id || isAdmin) return;
    let cancelled = false;
    const loadNetWorth = async () => {
      try {
        const data = await api.getNetWorth();
        if (cancelled) return;
        setNetWorthData(data);
      } catch (e) {
        console.error('[sidebar] failed to load net worth:', e);
      }
    };
    loadNetWorth();
    const refreshInterval = window.setInterval(loadNetWorth, 5 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(refreshInterval); };
  }, [account, isAdmin, location.pathname]);

  useEffect(() => {
    setNetWorthHidden(netWorthPrivacyKey ? window.localStorage.getItem(netWorthPrivacyKey) === 'true' : false);
  }, [netWorthPrivacyKey]);

  const calculateNetWorth = () => {
    return netWorthData.value;
  };
  const change = netWorthData.changePercent;
  const isPositive = change === null || change >= 0;
  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout();
      onClose?.();
      navigate('/login', { replace: true });
    } catch (error) {
      console.error('[sidebar] failed to sign out:', error);
      setSigningOut(false);
    }
  };
  const toggleNetWorthVisibility = () => {
    setNetWorthHidden(hidden => {
      const next = !hidden;
      if (netWorthPrivacyKey) window.localStorage.setItem(netWorthPrivacyKey, String(next));
      return next;
    });
  };

  return (
    <aside className="sidebar">
      {/* User Profile Section */}
      <div className="sidebar-section">
        <div className="user-profile">
          <div className="user-avatar">
            {account?.name?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="user-info">
            <div className="user-name">{account?.name || 'User'}</div>
            <div className="user-email">{user?.email}</div>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="sidebar-signout"
            title="Sign out"
            aria-label="Sign out"
            disabled={signingOut}
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>

      {/* Navigation Menu */}
      <nav className="sidebar-section">
        {navLinks.map(({ to, label, icon }) => (
          <Link
            key={to}
            to={to}
            className={`nav-link${isActive(to) ? ' nav-link-active' : ''}`}
            onClick={() => isMobile && onClose && onClose()}
          >
            <span className="nav-icon">{icon}</span>
            <span className="nav-label">{label}</span>
          </Link>
        ))}
      </nav>

      {/* Spacer */}
      <div className="sidebar-spacer"></div>

      {/* Net Worth Widget */}
      {!isAdmin && (
        <div className="sidebar-section">
          <div className="net-worth-widget">
          <div className="net-worth-header">
            <span className="net-worth-label">Net Worth</span>
            <button type="button" className={`net-worth-visibility${netWorthHidden ? ' hidden' : ''}`} onClick={toggleNetWorthVisibility} aria-label={netWorthHidden ? 'Show net worth' : 'Hide net worth'} aria-pressed={netWorthHidden} title={netWorthHidden ? 'Show net worth' : 'Hide net worth'}><Eye size={16}/></button>
          </div>
          <div className={`net-worth-value${netWorthHidden ? ' hidden' : ''}`} aria-hidden={netWorthHidden}>
            {new Intl.NumberFormat('en-US', { style: 'currency', currency: netWorthData.reportingCurrency || 'USD', maximumFractionDigits: 0 }).format(calculateNetWorth())}
          </div>
          <div className={`net-worth-change ${isPositive ? 'positive' : 'negative'}`}>
            {netWorthData.hasComparison ? (
              <><span>{isPositive ? '↑' : '↓'}</span> {Math.abs(change).toFixed(1)}% this month</>
            ) : 'Monthly tracking started'}
          </div>
          <NetWorthChart history={netWorthData.history} positive={isPositive} />
          </div>
        </div>
      )}
    </aside>
  );
}
