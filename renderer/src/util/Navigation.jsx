import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

const NAV_LINKS = [
  { to: '/overview',               label: 'Overview' },
  { to: '/monthly-spending',       label: 'Spending' },
  { to: '/accounts_overview',      label: 'Accounts' },
  { to: '/category-browser',       label: 'Categories' },
  { to: '/detected-subscriptions', label: 'Subscriptions' },
  { to: '/settings',               label: 'Settings' },
];

export default function Navigation() {
  const { user, logout } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
    navigate('/login');
  };

  const isActive = (to) => location.pathname === to;

  return (
    <nav className="nav-container">
      {/* Left: back/forward/home */}
      <div className="nav-buttons">
        <button onClick={() => navigate(-1)} className="nav-btn">←</button>
        <button onClick={() => navigate(1)}  className="nav-btn">→</button>
        <button onClick={() => navigate('/overview')} className="nav-btn-home">🏠</button>
      </div>

      {/* Centre: tabs (desktop) */}
      <div className="nav-tabs nav-tabs-desktop">
        {NAV_LINKS.map(({ to, label }) => (
          <Link
            key={to}
            to={to}
            className={`nav-tab${isActive(to) ? ' nav-tab-active' : ''}`}
          >
            {label}
          </Link>
        ))}
      </div>

      {/* Right: email + logout (desktop) / hamburger (mobile) */}
      <div className="nav-close">
        {user && (
          <span className="nav-email">{user.email}</span>
        )}
        <button onClick={handleLogout} className="nav-btn nav-btn-desktop" title="Sign out">⇥</button>

        {/* Hamburger button — mobile only */}
        <button
          className="nav-hamburger"
          onClick={() => setMenuOpen(o => !o)}
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
        >
          {menuOpen ? '✕' : '☰'}
        </button>
      </div>

      {/* Dropdown menu — mobile only */}
      {menuOpen && (
        <div className="nav-mobile-menu" onClick={() => setMenuOpen(false)}>
          {NAV_LINKS.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className={`nav-mobile-link${isActive(to) ? ' nav-mobile-link-active' : ''}`}
            >
              {label}
            </Link>
          ))}
          <button onClick={handleLogout} className="nav-mobile-logout">
            Sign out
          </button>
        </div>
      )}
    </nav>
  );
}
