import React, { useState, useEffect, useCallback } from 'react';
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
    } catch (err) {
      setAccountError(err.message || `Unable to ${isActive ? 'reactivate' : 'close'} this account.`);
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
          <h1 className="page-title">Accounts Overview</h1>
          <p className="page-subtitle">
            Track your accounts and net worth
          </p>
        </div>
        <div className={`metric-chip accounts-net-worth ${currentNetWorth >= 0 ? 'positive' : 'negative'}`}>
          <div className="metric-label">Net Worth</div>
          <div className="metric-value">
            ${currentNetWorth.toLocaleString()}
          </div>
          {!!netWorth?.excludedCurrencies?.length && <small className="net-worth-exclusion">Excludes {netWorth.excludedCurrencies.join(', ')}</small>}
        </div>
      </div>

      {accountError && <div className="accounts-projection-alert error" role="alert">{accountError}</div>}
      {!!netWorth?.staleAccounts?.length && (
        <div className="accounts-projection-alert warning">Some connected balances are stale: {netWorth.staleAccounts.join(', ')}</div>
      )}

      {/* Credit Cards */}
      <div className="full-width-card">
        <div className="section-header">
          <h2 className="section-title">💳 Credit Cards</h2>
          <button onClick={() => handleAddAccount('credit')} className="btn-primary">➕ Add Card</button>
        </div>
        {activeCreditCards.map((card) => (
          <div key={card.id} className="account-item">
            <div className="account-projected-copy">
              <strong className="account-item-name">{card.icon && <img className="entity-icon" src={card.icon.url} alt="" />} {card.nickname || card.name}</strong>
              <span className="account-item-detail">• {card.institution || card.simplefin?.institutionName || 'Institution'}</span>
              <ConnectionBadge simplefin={card.simplefin} />
            </div>
            <div className="account-row-actions">
              <div className="account-item-balance">
                {card.simplefin?.connected
                  ? formatAccountMoney(card.simplefin.balance, card.simplefin.currency)
                  : `$${(cardSpending[card.id] || 0).toFixed(2)}`}
                <small className="account-balance-caption">{card.simplefin?.connected ? 'Provider balance' : 'This month'}</small>
              </div>
              <button type="button" onClick={() => setAccountStatus('credit_card', card, false)} className="account-close-button" disabled={updatingStatusId === card.id}>Close</button>
            </div>
          </div>
        ))}
        {activeCreditCards.length === 0 && (
          <p className="account-empty-state">
            No credit cards added yet. Click "Add Card" to get started! 💳
          </p>
        )}
      </div>

      {/* Bank Accounts */}
      <div className="full-width-card">
        <div className="section-header">
          <h2 className="section-title">🏦 Bank Accounts</h2>
          <button onClick={() => handleAddAccount('bank')} className="btn-primary">➕ Add Account</button>
        </div>
        {activeBankAccounts.map((bank) => (
          <div key={bank.id} className="account-item">
            <div className="account-item-copy">
              <strong className="account-item-name">{bank.icon && <img className="entity-icon" src={bank.icon.url} alt="" />} {bank.bankName || bank.name}</strong>
              <span className="account-item-detail">• {formatAccountMoney(bank.balance, bank.simplefin?.currency || 'USD')}</span>
              <ConnectionBadge simplefin={bank.simplefin} />
            </div>
            <div className="expense-actions">
              <button
                onClick={() => handleUpdateAccount('bank', bank)}
                className="goal-icon-btn"
                title="Edit account"
              >
                ✏️
              </button>
              <button
                onClick={() => setAccountStatus('bank', bank, false)}
                className="account-close-button"
                title="Close account"
                disabled={updatingStatusId === bank.id}
              >
                Close
              </button>
            </div>
          </div>
        ))}
        {activeBankAccounts.length === 0 && (
          <p className="account-empty-state">
            No bank accounts added yet. Click "Add Account" to get started! 🏦
          </p>
        )}
      </div>

      {/* Trading Accounts */}
      <div className="full-width-card">
        <div className="section-header">
          <h2 className="section-title">📈 Trading Accounts</h2>
          <button onClick={() => handleAddAccount('trading')} className="btn-primary">➕ Add Account</button>
        </div>
        {activeTradingAccounts.map((trading) => (
          <div key={trading.id} className="account-item">
            <div className="account-item-copy">
              <strong className="account-item-name">{trading.brokerName || trading.name}</strong>
              <span className="account-item-detail">• {formatAccountMoney(trading.balance, trading.simplefin?.currency || 'USD')}</span>
              <ConnectionBadge simplefin={trading.simplefin} />
            </div>
            <div className="expense-actions">
              <button
                onClick={() => handleUpdateAccount('trading', trading)}
                className="goal-icon-btn"
                title="Edit account"
              >
                ✏️
              </button>
              <button
                onClick={() => setAccountStatus('trading', trading, false)}
                className="account-close-button"
                title="Close account"
                disabled={updatingStatusId === trading.id}
              >
                Close
              </button>
            </div>
          </div>
        ))}
        {activeTradingAccounts.length === 0 && (
          <p className="account-empty-state">
            No trading accounts added yet. Click "Add Account" to get started! 📈
          </p>
        )}
      </div>

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
    </div>
  );
}

function ConnectionBadge({ simplefin }) {
  if (!simplefin?.connected) return null;
  return (
    <span className={`account-connection-badge${simplefin.isStale ? ' stale' : ''}`} title={`Last sync: ${simplefin.lastSyncSucceededAt ? new Date(simplefin.lastSyncSucceededAt).toLocaleString() : 'Never'}`}>
      <i /> {simplefin.isStale ? 'Stale' : 'Connected'}
    </span>
  );
}

function formatAccountMoney(value, currency = 'USD') {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'Unavailable';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(number); }
  catch { return `${number.toLocaleString()} ${currency}`; }
}
