import { useSearchParams } from 'react-router-dom';

export function usePurchaseNavigation() {
  const [params, setParams] = useSearchParams();
  return (expenseId, mode = 'details') => {
    const next = new URLSearchParams(params);
    next.set('purchase', expenseId);
    if (mode === 'tags') next.set('edit', 'tags'); else next.delete('edit');
    setParams(next);
  };
}

export function announcePurchaseUpdate(purchase) {
  window.dispatchEvent(new CustomEvent('budget:purchases-updated', { detail: purchase }));
}
