/**
 * AccountContext now derives account from the authenticated user.
 * Kept for backward compatibility with pages that use useAccount().
 */
/* eslint-disable react-refresh/only-export-components */
import { useMemo } from 'react';
import { useAuth } from './AuthContext';

export function AccountProvider({ children }) {
  return <>{children}</>;
}

export function useAccount() {
  const { user } = useAuth();
  const account = useMemo(
    () => user ? { id: user.accountId, name: user.name || user.email } : null,
    [user]
  );
  return { account, setAccount: () => {} };
}
