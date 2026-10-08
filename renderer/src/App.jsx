import { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './util/AuthContext';
import { ThemeProvider } from './util/ThemeContext';
import ProtectedRoute from './util/ProtectedRoute';
import AdminRoute from './util/AdminRoute';
import Sidebar from './components/Sidebar';
import NotificationCenter from './components/NotificationCenter';
import ServerErrorBanner from './components/ServerErrorBanner';

import './App.css';

const LoginPage = lazy(() => import('./pages/login'));
const RegisterPage = lazy(() => import('./pages/register'));
const OverviewPage = lazy(() => import('./pages/overview'));
const AccountOverview = lazy(() => import('./pages/accounts_overview'));
const MonthlySpendingPage = lazy(() => import('./pages/monthly_spending'));
const SettingsPage = lazy(() => import('./pages/settings'));
const CategoryBrowserPage = lazy(() => import('./pages/category_browser'));
const DetectedSubscriptionsPage = lazy(() => import('./pages/detected_subscriptions'));
const AdminDashboard = lazy(() => import('./pages/admin_dashboard'));

const MOBILE_MEDIA_QUERY = '(max-width: 768px)';
const STALE_PAGE_DATA_MS = 5 * 60 * 1000;
const VISIBLE_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

function RoleLanding() {
  const { user } = useAuth();
  return <Navigate to={user?.role === 'admin' ? '/admin' : '/overview'} replace />;
}

function AppRoutes() {
  const { user } = useAuth();
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_MEDIA_QUERY).matches);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dataRefreshKey, setDataRefreshKey] = useState(0);
  const lastDataRefreshAt = useRef(Date.now());

  const refreshVisiblePage = useCallback((force = false) => {
    if (!user || document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (!force && now - lastDataRefreshAt.current < STALE_PAGE_DATA_MS) return;
    lastDataRefreshAt.current = now;
    setDataRefreshKey(key => key + 1);
  }, [user]);

  useEffect(() => {
    lastDataRefreshAt.current = Date.now();
  }, [user?.accountId]);

  useEffect(() => {
    if (!user) return undefined;
    const refreshIfStale = () => refreshVisiblePage(false);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refreshIfStale();
    };
    const interval = window.setInterval(() => refreshVisiblePage(true), VISIBLE_REFRESH_INTERVAL_MS);
    window.addEventListener('focus', refreshIfStale);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshIfStale);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [user, refreshVisiblePage]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY);
    const handleResize = (event) => {
      const mobile = event.matches;
      setIsMobile(mobile);
      if (!mobile) setSidebarOpen(false); // close sidebar on desktop resize
    };
    mediaQuery.addEventListener('change', handleResize);
    return () => mediaQuery.removeEventListener('change', handleResize);
  }, []);

  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [sidebarOpen]);

  const toggleSidebar = () => setSidebarOpen(prev => !prev);
  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className="page-grid">
      <ServerErrorBanner />
      {/* Hamburger button — mobile only */}
      {user && isMobile && !sidebarOpen && (
        <button
          className="hamburger-btn"
          onClick={toggleSidebar}
          aria-label="Open menu"
        >
          ☰
        </button>
      )}

      {/* Desktop sidebar — always visible */}
      {!isMobile && user && <Sidebar key={`sidebar-${dataRefreshKey}`} />}

      {/* Mobile sidebar drawer — slides from left */}
      {user && isMobile && (
        <>
          <div
            className={`sidebar-backdrop${sidebarOpen ? ' active' : ''}`}
            onClick={closeSidebar}
          />
          {sidebarOpen && (
            <button className="sidebar-drawer-close" onClick={closeSidebar}>✕</button>
          )}
          <div className={`sidebar-drawer${sidebarOpen ? ' open' : ''}`}>
            <Sidebar key={`mobile-sidebar-${dataRefreshKey}`} isMobile onClose={closeSidebar} />
          </div>
        </>
      )}

      <div className={`main-content${user ? '' : ' public-content'}`}>
        {user && <NotificationCenter key={`notifications-${dataRefreshKey}`} />}
        <Suspense fallback={<div className="route-loading" role="status">Loading…</div>}>
          <Routes key={`routes-${dataRefreshKey}`}>
            {/* Public */}
            <Route path="/login"    element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />

            {/* Protected */}
            <Route path="/" element={<ProtectedRoute><RoleLanding /></ProtectedRoute>} />
            <Route path="/overview" element={<ProtectedRoute><OverviewPage /></ProtectedRoute>} />
            <Route path="/accounts_overview" element={<ProtectedRoute><AccountOverview /></ProtectedRoute>} />
            <Route path="/monthly-spending"  element={<ProtectedRoute><MonthlySpendingPage /></ProtectedRoute>} />
            <Route path="/category-browser"  element={<ProtectedRoute><CategoryBrowserPage /></ProtectedRoute>} />
            <Route path="/detected-subscriptions" element={<ProtectedRoute><DetectedSubscriptionsPage /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
            <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
            <Route path="/admin/accounts" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
            <Route path="/admin/site-identity" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
            <Route path="/admin/icons" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
            <Route path="/admin/categories" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
            <Route path="/admin/security" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
            <Route path="/admin/telemetry" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
          </Routes>
        </Suspense>
      </div>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <Router>
          <AppRoutes />
        </Router>
      </ThemeProvider>
    </AuthProvider>
  );
}

export default App;
