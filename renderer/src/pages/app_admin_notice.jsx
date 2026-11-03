import { useAuth } from '../util/AuthContext';

export default function AppAdminNotice() {
  const { logout } = useAuth();
  return <div className="page-container ux-empty"><h1>Use the website for administration</h1><p>This app currently includes customer finance features. Sign in with a customer account to continue.</p><button className="ux-secondary" onClick={logout}>Sign out</button></div>;
}
