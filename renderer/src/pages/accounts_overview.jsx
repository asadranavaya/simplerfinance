import React, { useState, useEffect, useCallback, useId } from 'react';
import { ChevronRight, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import Sheet from '../components/Sheet';
import { useAccount } from '../util/AccountContext';
import { api } from '../util/api';



export default function AccountOverview() {
  const { account } = useAccount();
  const [creditCards, setCreditCards] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [tradingAccounts, setTradingAccounts] = useState([]);
  const [cardSpending, setCardSpending] = useState({});
  const [showModal, setShowModal] = useState(null);
  const [updateId, setUpdateId] = useState("");
  const [formData, setFormData] = useState({});
  const [netWorth, setNetWorth] = useState(null);
  const [accountError, setAccountError] = useState('');
  const [closedPanelOpen, setClosedPanelOpen] = useState(false);
  const [updatingStatusId, setUpdatingStatusId] = useState(null);
  const [netWorthAccount, setNetWorthAccount] = useState(null);
  const [updatingNetWorth, setUpdatingNetWorth] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const loadCurrentMonthSpending = useCallback(async (cards) => {
    if (api && account?.id && cards.length > 0) {
      const currentDate = new Date();
      const currentYear = currentDate.getFullYear();
      const currentMonth = currentDate.getMonth() + 1;

      const spendingData = {};
      const monthData = await api.getMonthlySpending(account.id, currentYear, currentMonth);
      for (const card of cards) {
        const cardData = monthData.find(s => s.cardId.toString() === card.id.toString());
        const total = cardData?.expenses?.reduce((sum, exp) => sum + exp.amount, 0) || 0;
        spendingData[card.id] = total;
      }
      setCardSpending(spendingData);
    }
  }, [account?.id]);

  const loadAccounts = useCallback(async () => {
    if (api && account?.id) {
      const [cards, banks, trading, worth] = await Promise.all([
        api.getCreditCards(account.id),
        api.getBankAccounts(account.id),
        api.getTradingAccounts(account.id),
        api.getNetWorth(),
      ]);
      setCreditCards(cards);
      setBankAccounts(banks);
      setTradingAccounts(trading);
      setNetWorth(worth);
      await loadCurrentMonthSpending(cards);
    }
  }, [account?.id, loadCurrentMonthSpending]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  if (!account) {
    console.log("Accounts Overview page account: ", account);
    return (
      <div className="no-account-message">
        <h2>No Account Selected</h2>
        <p>Please go back and select a profile to continue.</p>
      </div>
    );
  }

  const handleAddAccount = (type) => {
    setShowModal(type);
    setFormData({});
  };

  const setAccountStatus = async (type, financialAccount, isActive) => {
    setAccountError('');
    setUpdatingStatusId(financialAccount.id);
    try {
      await api.setFinancialAccountStatus(type, financialAccount.id, isActive);
      await loadAccounts();
      return true;
    } catch (err) {
      setAccountError(err.message || `Unable to ${isActive ? 'reactivate' : 'close'} this account.`);
      return false;
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const handleUpdateAccount = (type, account) => {
    setShowModal(type);
    if (type === 'bank') {
      console.log("Account: ", account);
      console.log("Form Data: ", formData);
      setFormData({ ...formData, bankName: account.bankName || account.name, balance: account.balance, simplefin: account.simplefin });
      console.log("Account id from handle update: ", account.id);
      setUpdateId(account.id);
    } else if (type === 'trading') {
      setFormData({ ...formData, brokerName: account.brokerName || account.name, balance: account.balance, simplefin: account.simplefin });
      setUpdateId(account.id);
    }
  };

  const openNetWorthPreference = (type, financialAccount) => {
    setAccountError('');
    setConfirmClose(false);
    setNetWorthAccount({
      financialAccount,
      type,
      id: financialAccount.id,
      name: financialAccount.nickname || financialAccount.bankName || financialAccount.brokerName || financialAccount.name,
      included: financialAccount.includeInNetWorth !== false,
    });
  };

  const setNetWorthInclusion = async (included) => {
    if (!netWorthAccount || updatingNetWorth) return;
    setUpdatingNetWorth(true);
    setAccountError('');
    try {
      await api.setFinancialAccountNetWorthInclusion(netWorthAccount.type, netWorthAccount.id, included);
      setNetWorthAccount(current => current ? { ...current, included } : current);
      await loadAccounts();
      window.dispatchEvent(new CustomEvent('budget:net-worth-updated'));
    } catch (err) {
      setAccountError(err.message || 'Unable to update net worth tracking.');
    } finally {
      setUpdatingNetWorth(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (api && account?.id) {
      const editableFormData = { ...formData };
      delete editableFormData.simplefin;
      const dataWithUserId = { ...editableFormData, userId: account.id };
      if (showModal === 'credit') {
        await api.addCreditCard(dataWithUserId);
      } else if (showModal === 'bank') {
        console.log("UpdateId from handleSubmit: ", updateId);
        await api.addBankAccount(dataWithUserId, updateId);
      } else if (showModal === 'trading') {
        await api.addTradingAccount(dataWithUserId, updateId);
      }
      await loadAccounts();
    }
    setShowModal(null);
    setFormData({});
    setUpdateId("");
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const currentNetWorth = netWorth?.value ?? 0;
  const activeCreditCards = creditCards.filter(card => card.isActive !== false);
  const activeBankAccounts = bankAccounts.filter(bank => bank.isActive !== false);
  const activeTradingAccounts = tradingAccounts.filter(trading => trading.isActive !== false);
  const closedAccounts = [
    ...creditCards.filter(card => card.isActive === false).map(card => ({ ...card, accountType: 'credit_card', typeLabel: 'Credit card', displayName: card.nickname || card.name, detail: card.institution || card.simplefin?.institutionName })),
    ...bankAccounts.filter(bank => bank.isActive === false).map(bank => ({ ...bank, accountType: 'bank', typeLabel: 'Bank account', displayName: bank.bankName || bank.name, detail: formatAccountMoney(bank.balance, bank.simplefin?.currency || 'USD') })),
    ...tradingAccounts.filter(trading => trading.isActive === false).map(trading => ({ ...trading, accountType: 'trading', typeLabel: 'Trading account', displayName: trading.brokerName || trading.name, detail: formatAccountMoney(trading.balance, trading.simplefin?.currency || 'USD') })),
  ].sort((a, b) => String(b.closedAt || '').localeCompare(String(a.closedAt || '')));



  const issues = [...activeCreditCards, ...activeBankAccounts, ...activeTradingAccounts].filter(item => item.simplefin?.issue || item.simplefin?.isStale);
  const accountBalance = (type, item) => type === 'credit_card'
    ? item.simplefin?.connected ? formatAccountMoney(item.simplefin.balance, item.simplefin.currency) : formatAccountMoney(cardSpending[item.id] || 0)
    : formatAccountMoney(item.balance, item.simplefin?.currency || netWorth?.reportingCurrency || 'USD');
  const renderGroup = (title, type, items) => <section className="full-width-card ux-account-group"><div className="section-header"><h2 className="section-title">{title}</h2><button type="button" className="ux-secondary" onClick={() => handleAddAccount(type === 'credit_card' ? 'credit' : type)}>+ Add account</button></div>
    {items.map(item => <button type="button" className="ux-account-open" key={item.id} onClick={() => openNetWorthPreference(type, item)}>
      {item.icon?.url ? <img className="ux-vendor-icon" src={item.icon.url} alt="" /> : <span className="ux-vendor-icon ux-vendor-fallback">{(item.institution || item.bankName || item.brokerName || item.name || '?').slice(0, 1)}</span>}
      <span className="ux-account-copy"><strong>{item.nickname || item.bankName || item.brokerName || item.name}</strong><small>{item.institution || item.simplefin?.institutionName || (item.simplefin?.connected ? 'Synchronized account' : 'Manual account')}</small><ConnectionBadge simplefin={item.simplefin} /></span>
      <span className="ux-account-balance"><strong>{accountBalance(type, item)}</strong><small>{item.simplefin?.connected ? 'Provider balance' : type === 'credit_card' ? 'This month' : 'Balance'}</small></span><ChevronRight size={17} />
    </button>)}
    {!items.length && <p className="ux-empty">No {title.toLocaleLowerCase()} yet. Add an account to get started.</p>}
  </section>;

  const renderModal = (title, children) => (
    <div className="modal-overlay">
      <div className="modal-content">
        <h3 className="modal-title">{title}</h3>
        <form onSubmit={handleSubmit}>
          {children}
          <div className="form-actions">
            <button type="submit">{updateId ? "Update Account" : "Add Account"}</button>
            <button type="button" onClick={() => { setShowModal(null); setUpdateId(""); }}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );

  return (
    <div className="page-container accounts-overview-page">
      <div className="header-row">
        <div>
          <h1 className="page-title">Accounts</h1>
          <p className="page-subtitle">
            Track your accounts and net worth
          </p>
        </div>
        <div className={`metric-chip accounts-net-worth ${currentNetWorth >= 0 ? 'positive' : 'negative'}`}>
          <div className="metric-label">Net Worth</div>
          <div className="metric-value">
            ${currentNetWorth.toLocaleString()}
          </div>
          {netWorth?.hasUntrackedAccounts && <small className="ux-tracked-total">Tracked accounts · {formatAccountMoney(netWorth.trackedValue, netWorth.reportingCurrency)}</small>}
          {!!netWorth?.excludedCurrencies?.length && <small className="net-worth-exclusion">Excludes {netWorth.excludedCurrencies.join(', ')}</small>}
        </div>
      </div>

      {accountError && <div className="accounts-projection-alert error" role="alert">{accountError}</div>}
      {!!netWorth?.staleAccounts?.length && (
        <div className="accounts-projection-alert warning">Some connected balances are stale: {netWorth.staleAccounts.join(', ')}</div>
      )}

      {issues.length > 0 && <Link className="ux-connection-alert" to="/settings?panel=simplefin"><TriangleAlert size={20} /><span><strong>{issues.length} account{issues.length === 1 ? '' : 's'} need attention</strong><small>Review connection issues and resume updates.</small></span><ChevronRight size={18} /></Link>}
      {renderGroup('Bank accounts', 'bank', activeBankAccounts)}
      {renderGroup('Investments', 'trading', activeTradingAccounts)}
      {renderGroup('Credit cards', 'credit_card', activeCreditCards)}
      <section className={`closed-accounts-workspace${closedPanelOpen ? ' showing-detail' : ''}`}>
        <div className="closed-accounts-slider">
          <button type="button" className="closed-accounts-summary" onClick={() => setClosedPanelOpen(true)}>
            <span className="closed-accounts-icon">▣</span>
            <span><strong>Closed accounts</strong><small>Historical accounts remain available without appearing in future months.</small></span>
            <span className="closed-accounts-count">{closedAccounts.length}</span>
            <span className="closed-accounts-arrow">→</span>
          </button>
          <div className="closed-accounts-detail" aria-hidden={!closedPanelOpen}>
            <div className="closed-accounts-toolbar"><button type="button" onClick={() => setClosedPanelOpen(false)}>← Accounts</button><div><strong>Closed accounts</strong><span>{closedAccounts.length} archived</span></div></div>
            <div className="closed-accounts-list">
              {closedAccounts.length ? closedAccounts.map(closed => <article key={`${closed.accountType}-${closed.id}`} className="closed-account-row">
                <span className="closed-account-type-icon">{closed.accountType === 'credit_card' ? '💳' : closed.accountType === 'bank' ? '🏦' : '📈'}</span>
                <div><strong>{closed.displayName}</strong><span>{closed.typeLabel}{closed.detail ? ` · ${closed.detail}` : ''}</span><small>{closed.closedAt ? `Closed ${new Date(closed.closedAt).toLocaleDateString()}` : 'Closed account'}</small></div>
                <button type="button" onClick={() => setAccountStatus(closed.accountType, closed, true)} disabled={updatingStatusId === closed.id}>{updatingStatusId === closed.id ? 'Restoring…' : 'Reactivate'}</button>
              </article>) : <div className="closed-accounts-empty"><strong>No closed accounts</strong><span>Accounts you close will be preserved here.</span></div>}
            </div>
          </div>
        </div>
      </section>

      {/* Modals */}
      {showModal === 'credit' && renderModal('Add Credit Card', [
        <input
          key="institution"
          type="text"
          placeholder="Institution"
          value={formData.institution || ''}
          onChange={(e) => handleInputChange('institution', e.target.value)}
          className="form-input"
          maxLength={100}
          required
        />,
        <input
          key="name"
          type="text"
          placeholder="Card Name"
          value={formData.name || ''}
          onChange={(e) => handleInputChange('name', e.target.value)}
          className="form-input"
          maxLength={100}
          required
        />,
        <input
          key="nickname"
          type="text"
          placeholder="Nickname (optional)"
          value={formData.nickname || ''}
          onChange={(e) => handleInputChange('nickname', e.target.value)}
          className="form-input"
          maxLength={100}
        />
      ])}

      {showModal === 'bank' && renderModal(updateId ? 'Update Bank Account' : 'Add Bank Account', [
        <input
          key="bankName"
          type="text"
          placeholder="Bank Name"
          value={formData.bankName || ''}
          onChange={(e) => handleInputChange('bankName', e.target.value)}
          className="form-input"
          maxLength={100}
          required
        />,
        <input
          key="balance"
          type="number"
          placeholder="Account Balance"
          value={formData.balance ?? ''}
          onChange={(e) => handleInputChange('balance', e.target.value)}
          className="form-input"
          min="-1000000000000000"
          max="1000000000000000"
          step="0.01"
          disabled={Boolean(formData.simplefin?.connected)}
          required
        />,
        formData.simplefin?.connected && <p key="balance-source" className="account-provider-note">Balance is synchronized by SimpleFIN. You can still edit the account name.</p>
      ])}

      {showModal === 'trading' && renderModal(updateId ? 'Update Trading Account' : 'Add Trading Account', [
        <input
          key="brokerName"
          type="text"
          placeholder="Broker Name"
          value={formData.brokerName || ''}
          onChange={(e) => handleInputChange('brokerName', e.target.value)}
          className="form-input"
          maxLength={100}
          required
        />,
        <input
          key="balance"
          type="number"
          placeholder="Account Balance"
          value={formData.balance ?? ''}
          onChange={(e) => handleInputChange('balance', e.target.value)}
          className="form-input"
          min="-1000000000000000"
          max="1000000000000000"
          step="0.01"
          disabled={Boolean(formData.simplefin?.connected)}
          required
        />,
        formData.simplefin?.connected && <p key="balance-source" className="account-provider-note">Balance is synchronized by SimpleFIN. You can still edit the account name.</p>
      ])}

      {netWorthAccount && <Sheet title="Account details" subtitle={netWorthAccount.name} onClose={() => { if (!updatingNetWorth) setNetWorthAccount(null); }} footer={<button type="button" className="ux-primary" onClick={() => setNetWorthAccount(null)} disabled={updatingNetWorth}>Done</button>}>
        {accountError && <p className="ux-error" role="alert">{accountError}</p>}
        <p className="ux-detail-amount">{accountBalance(netWorthAccount.type, netWorthAccount.financialAccount)}</p>
        <p className="ux-helper">{netWorthAccount.financialAccount.simplefin?.connected ? 'Provider balance' : netWorthAccount.type === 'credit_card' ? 'This month’s spending' : 'Manual balance'}</p>
        <ConnectionBadge simplefin={netWorthAccount.financialAccount.simplefin} />
        <div className="net-worth-preference-control"><div><strong>Include in tracked net worth</strong><small>The main net worth figure still shows every active account. The tracked total is a live number.</small></div><label className="appearance-switch"><input type="checkbox" checked={netWorthAccount.included} disabled={updatingNetWorth} onChange={event => setNetWorthInclusion(event.target.checked)} aria-label="Include in tracked net worth" /><span aria-hidden="true" /><em>{netWorthAccount.included ? 'On' : 'Off'}</em></label></div>
        {netWorthAccount.financialAccount.simplefin?.issue && <div className="ux-connection-alert"><TriangleAlert size={20} /><span>{netWorthAccount.financialAccount.simplefin.issue}<Link className="ux-text-button" to="/settings?panel=simplefin">Review connection →</Link></span></div>}
        {netWorthAccount.financialAccount.simplefin?.lastSyncSucceededAt && <p className="ux-helper">Updated {new Date(netWorthAccount.financialAccount.simplefin.lastSyncSucceededAt).toLocaleString()}</p>}
        {netWorthAccount.type !== 'credit_card' && <button type="button" className="ux-secondary" onClick={() => { const selected = netWorthAccount; setNetWorthAccount(null); handleUpdateAccount(selected.type, selected.financialAccount); }}>Edit account</button>}
        <details className="ux-advanced"><summary>More account options</summary><p className="ux-helper">Closing stops new activity while preserving history. You can reactivate it later.</p>
          {confirmClose ? <div role="alert"><p>Close {netWorthAccount.name}?</p><button type="button" className="ux-secondary" onClick={() => setConfirmClose(false)}>Keep account open</button><button type="button" className="ux-danger" disabled={Boolean(updatingStatusId)} onClick={async () => { if (await setAccountStatus(netWorthAccount.type, netWorthAccount.financialAccount, false)) setNetWorthAccount(null); }}>Close account</button></div> : <button type="button" className="ux-danger" onClick={() => setConfirmClose(true)}>Close account</button>}
        </details>
      </Sheet>}

    </div>
  );
}

function ConnectionBadge({ simplefin }) {
  const tooltipId = useId();
  if (!simplefin?.connected) return null;
  const issue = simplefin.issue || (simplefin.isStale ? 'This account has not completed a recent SimpleFIN sync.' : null);
  if (issue) {
    return (
      <span className="account-connection-badge issue" tabIndex={0} aria-describedby={tooltipId}>
        <TriangleAlert size={13} strokeWidth={2.5} aria-hidden="true" />
        Issue
        <span className="account-connection-tooltip" id={tooltipId} role="tooltip">{issue}</span>
      </span>
    );
  }
  return (
    <span className="account-connection-badge" title={`Last sync: ${simplefin.lastSyncSucceededAt ? new Date(simplefin.lastSyncSucceededAt).toLocaleString() : 'Never'}`}>
      <i /> Connected
    </span>
  );
}

function formatAccountMoney(value, currency = 'USD') {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'Unavailable';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(number); }
  catch { return `${number.toLocaleString()} ${currency}`; }
}
