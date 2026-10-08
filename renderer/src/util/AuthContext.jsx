/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect } from 'react';
import { api } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);   // { email, accountId, name }
  const [loading, setLoading] = useState(true);   // true while checking session

  // On mount, check if a session cookie already exists
  useEffect(() => {
    api.me()
      .then(data => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const endInactiveSession = () => setUser(null);
    window.addEventListener('budget:session-ended', endInactiveSession);
    return () => window.removeEventListener('budget:session-ended', endInactiveSession);
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    const checkSession = () => {
      if (document.visibilityState === 'visible') api.me().catch(() => {});
    };
    const interval = window.setInterval(checkSession, 30_000);
    window.addEventListener('focus', checkSession);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', checkSession);
    };
  }, [user]);

  const login = async (email, password) => {
    const data = await api.login(email, password);
    setUser(data.user);
    return data.user;
  };

  const register = async (email, password, name) => {
    const data = await api.register(email, password, name);
    return data;
  };

  const logout = async () => {
    await api.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, setUser, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
