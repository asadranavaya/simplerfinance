import { useEffect, useState } from 'react';
import { Eye, EyeOff, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAccount } from '../util/AccountContext';
import { api } from '../util/api';
import { usePurchaseNavigation } from '../util/purchaseNavigation';
import NetWorthChart from './NetWorthChart';
import PurchaseRow from './PurchaseRow';
import { purchaseMoney } from '../util/formatting';
import UpcomingEvents from './UpcomingEvents';

export default function OverviewSummary({ profile, spending }) {
  const { account } = useAccount();
  const [netWorth, setNetWorth] = useState(null);
  const [issues, setIssues] = useState([]);
  const [error, setError] = useState('');
  const privacyKey = `budget:hide-net-worth:${account?.id}`;
  const [hidden, setHidden] = useState(() => localStorage.getItem(privacyKey) === 'true');
  const openPurchase = usePurchaseNavigation();
  useEffect(() => {
    let active = true;
    const load = async () => {
      const results = await Promise.allSettled([api.getNetWorth(), api.getCreditCards(), api.getBankAccounts(), api.getTradingAccounts()]);
      if (!active) return;
      if (results[0].status === 'fulfilled') { setNetWorth(results[0].value); setError(''); } else setError('Unable to load net worth. Please try again.');
      setIssues(results.slice(1).flatMap(result => result.status === 'fulfilled' ? result.value : []).filter(item => item.isActive !== false && (item.simplefin?.issue || item.simplefin?.isStale)));
    };
    const syncPrivacy = () => setHidden(localStorage.getItem(privacyKey) === 'true');
    load();
    window.addEventListener('budget:net-worth-updated', load);
    window.addEventListener('budget:privacy-updated', syncPrivacy);
    return () => { active = false; window.removeEventListener('budget:net-worth-updated', load); window.removeEventListener('budget:privacy-updated', syncPrivacy); };
  }, [account?.id, privacyKey]);
  const currency = profile?.reportingCurrency || netWorth?.reportingCurrency || 'USD';
  const now = new Date();
  const current = spending.filter(record => record.year === now.getFullYear() && record.month === now.getMonth() + 1).flatMap(record => record.expenses || []);
  const total = current.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const recent = spending.flatMap(record => record.expenses || []).sort((a, b) => String(b.transactionTime || b.date).localeCompare(String(a.transactionTime || a.date))).slice(0, 4);
  const limit = Number(profile?.monthlySpendLimit) || 0;
  return <>
    <div className="ux-overview-metrics">
      <section className="ux-card ux-net-worth-hero"><div className="ux-section-line"><h2>Net worth</h2><button type="button" className="ux-icon-button" aria-label={hidden ? 'Show balances' : 'Hide balances'} aria-pressed={hidden} onClick={() => { const value = !hidden; localStorage.setItem(privacyKey, String(value)); setHidden(value); window.dispatchEvent(new Event('budget:privacy-updated')); }}>{hidden ? <EyeOff size={19} /> : <Eye size={19} />}</button></div>
        {error && <p className="ux-error" role="alert">{error}</p>}
        <strong className="ux-hero-amount">{hidden ? '••••••' : netWorth ? purchaseMoney(netWorth.value, currency) : 'Loading…'}</strong>
        {!hidden && netWorth?.hasComparison && <p className="ux-helper">{netWorth.changePercent == null ? 'No percentage comparison available' : `${netWorth.changePercent > 0 ? '+' : ''}${netWorth.changePercent.toFixed(1)}% this month`}</p>}
        {!hidden && netWorth?.history?.length > 0 && <NetWorthChart history={netWorth.history} positive={(netWorth.changePercent || 0) >= 0} />}
        {netWorth?.hasUntrackedAccounts && <p className="ux-tracked-total"><span>Tracked accounts</span><strong>{hidden ? '••••••' : purchaseMoney(netWorth.trackedValue, currency)}</strong></p>}
        {!hidden && netWorth?.excludedCurrencies?.length > 0 && <p className="ux-helper">Excludes {netWorth.excludedCurrencies.join(', ')} without available exchange rates.</p>}
      </section>
      <section className="ux-card ux-overview-budget"><div><span className="ux-eyebrow">{now.toLocaleDateString(undefined, { month: 'long' })} spending</span><strong>{purchaseMoney(total, currency)}</strong><small>{current.length} purchases this month</small></div><div><span className="ux-eyebrow">Budget remaining</span><strong>{limit ? purchaseMoney(limit - total, currency) : 'Not set'}</strong>{limit ? <small>of {purchaseMoney(limit, currency)} monthly limit</small> : <Link className="ux-text-button" to="/settings?panel=financial">Set a monthly budget</Link>}</div>{limit > 0 && <progress aria-label="Monthly budget used" max={limit} value={Math.max(0, Math.min(limit, total))} />}</section>
    </div>
    {issues.length > 0 && <Link to="/settings?panel=simplefin" className="ux-connection-alert"><TriangleAlert size={21} /><span><strong>{issues.length === 1 ? `${issues[0].nickname || issues[0].bankName || issues[0].name || 'An account'} needs attention` : `${issues.length} accounts need attention`}</strong><small>Review connections to resume updates.</small></span><span>Review →</span></Link>}
    <div className="ux-overview-lists"><section className="ux-card"><div className="ux-section-line"><h2>Recent purchases</h2><Link className="ux-text-button" to="/monthly-spending">View all →</Link></div>{recent.length ? recent.map(expense => <PurchaseRow key={expense.id} expense={expense} onOpen={() => openPurchase(expense.id)} onTags={() => openPurchase(expense.id, 'tags')} />) : <p className="ux-empty">No purchases yet. Connect an account or add your first expense.</p>}</section><section className="ux-card"><div className="ux-section-line"><h2>Coming up</h2><Link className="ux-text-button" to="/activity?tab=upcoming">View all →</Link></div><UpcomingEvents limit={2} /><Link className="ux-text-button" to="/detected-subscriptions?view=calendar">View estimated subscription payments →</Link></section></div>
  </>;
}
