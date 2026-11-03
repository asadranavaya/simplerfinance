import React, { lazy, Suspense, useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import PurchaseRow from '../components/PurchaseRow';
import SpendingPie from '../components/SpendingPie';
import { usePurchaseNavigation } from '../util/purchaseNavigation';
import { useAccount } from '../util/AccountContext';
import { api } from '../util/api';

import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { ChevronLeft, ChevronRight, Search, Upload } from "lucide-react";
import { FILE_UPLOADS_ENABLED } from '../util/appFeatures';
import VendorIcon from '../components/VendorIcon';
const ImportModal = FILE_UPLOADS_ENABLED ? lazy(() => import('../util/ImportCsv')) : null;
import SplitPurchaseFields from '../components/SplitPurchaseFields';

ChartJS.register(ArcElement, Tooltip, Legend, ChartDataLabels);

const FIRST_SPENDING_YEAR = 2020;
const LAST_SPENDING_YEAR = 2099;

export default function MonthlySpendingPage() {
  const { account } = useAccount();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const openPurchase = usePurchaseNavigation();
  const [query, setQuery] = useState('');
  const [financialProfile, setFinancialProfile] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [currentView, setCurrentView] = useState('years');
  const [selectedYear, setSelectedYear] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [creditCards, setCreditCards] = useState([]);
  const [monthlySpending, setMonthlySpending] = useState([]);
  const [expandedCards, setExpandedCards] = useState(new Set());
  const monthlyCardRefs = useRef(new Map());
  const previousExpandedCardId = useRef(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [categories, setCategories] = useState([]);
  const [modalForm, setModalForm] = useState({ cardId: '', description: '', amount: '', originalAmount: '', categories: [], updateId: '', source: '' });
  const [expenseFormError, setExpenseFormError] = useState('');
  const [savingExpense, setSavingExpense] = useState(false);
  const [rememberingExpenseId, setRememberingExpenseId] = useState(null);
  const [rememberedExpenseIds, setRememberedExpenseIds] = useState(new Set());
  const [categoryRuleError, setCategoryRuleError] = useState('');
  const [categoryRuleNotice, setCategoryRuleNotice] = useState('');
  const [expenseActionError, setExpenseActionError] = useState(null);
  const [deletingExpenseId, setDeletingExpenseId] = useState(null);
  const [merchantRuleDraft, setMerchantRuleDraft] = useState(null);
  const [reportingCurrency, setReportingCurrency] = useState('USD');
  const [splitPeople, setSplitPeople] = useState([]);
  const [splitDraft, setSplitDraft] = useState(null);
  const [splitError, setSplitError] = useState('');
  const [savingSplit, setSavingSplit] = useState(false);
  const [iconDraft, setIconDraft] = useState(null);
  const [iconSubmissionError, setIconSubmissionError] = useState('');
  const [changingPeriod, setChangingPeriod] = useState(false);

  useEffect(() => {
    loadCreditCards().catch(error => setLoadError(error.message || 'Unable to load accounts.'));
    loadCategories().catch(error => setLoadError(error.message || 'Unable to load categories.'));
    api.getSplitPeople().then(setSplitPeople).catch(() => {});

    const today = new Date();
    const requestedMonthIndex = months.indexOf(location.state?.month);
    const requestedDate = params.get('period');
    const validPeriod = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedDate || '') && Number(requestedDate.slice(0, 4)) >= FIRST_SPENDING_YEAR && Number(requestedDate.slice(0, 4)) <= LAST_SPENDING_YEAR;
    const hasRequestedPeriod = location.state?.year && requestedMonthIndex !== -1;
    const year = validPeriod ? Number(requestedDate.slice(0, 4)) : hasRequestedPeriod ? Number(location.state.year) : today.getFullYear();
    const monthIndex = validPeriod ? Number(requestedDate.slice(5)) - 1 : hasRequestedPeriod ? requestedMonthIndex : today.getMonth();

    setSelectedYear(year);
    setSelectedMonth(monthIndex);
    setCurrentView('spending');
    loadMonthlySpending(year, monthIndex + 1);
  // Initial route state is consumed once; subsequent navigation is handled by this page's controls.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const expandedCardId = [...expandedCards][0] ?? null;
    const previousCardId = previousExpandedCardId.current;
    previousExpandedCardId.current = expandedCardId;
    if (previousCardId == null || expandedCardId == null || previousCardId === expandedCardId) return;
    const frame = requestAnimationFrame(() => {
      monthlyCardRefs.current.get(expandedCardId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [expandedCards]);

  useEffect(() => {
    const refresh = () => { if (selectedYear && selectedMonth !== null) loadMonthlySpending(selectedYear, selectedMonth + 1); loadCategories().catch(error => setLoadError(error.message)); };
    window.addEventListener('budget:purchases-updated', refresh);
    return () => window.removeEventListener('budget:purchases-updated', refresh);
  // Refresh the current period after a shared purchase sheet is saved.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear, selectedMonth]);

  const loadCreditCards = async () => {
    if (api && account?.id) {
      const [cards, banks, profile] = await Promise.all([
        api.getCreditCards(account.id),
        api.getBankAccounts(account.id),
        api.getFinancialProfile(),
      ]);
      setReportingCurrency(profile?.reportingCurrency || 'USD');
      setFinancialProfile(profile);
      const linkedBanks = (banks || []).filter(bank => bank.simplefin?.connected).map(bank => ({
        ...bank,
        name: bank.bankName || bank.name || 'Bank account',
        institution: bank.simplefin?.institutionName || 'Bank account',
        accountKind: 'Bank account',
      }));
      setCreditCards([
        ...(cards || []).map(card => ({ ...card, accountKind: 'Credit card' })),
        ...linkedBanks,
      ]);
    }
  };

  const loadCategories = async () => {
    if (api) {
      const cats = await api.getCategories();
      setCategories(cats);
    }
  };

  const loadMonthlySpending = async (year, month) => {
    if (api && account?.id) {
      try { const spending = await api.getMonthlySpending(account.id, year, month); setMonthlySpending(spending); setLoadError(''); }
      catch (error) { setLoadError(error.message || 'Unable to load purchases.'); }
    }
  };

  if (!account) {
    return (
      <div className="no-account-message">
        <h2>No Account Selected</h2>
        <p>Please go back and select a profile to continue.</p>
      </div>
    );
  }

  const years = Array.from({ length: LAST_SPENDING_YEAR - FIRST_SPENDING_YEAR + 1 }, (_, i) => FIRST_SPENDING_YEAR + i);
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const formatMoney = (value, currency = reportingCurrency) => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
  }).format(Number(value) || 0);

  const activeAccounts = creditCards.filter(card => card.isActive !== false);
  const accountsWithTransactions = new Set(monthlySpending.filter(record => record.expenses?.length).map(record => String(record.cardId)));
  const visibleMonthlyAccounts = creditCards.filter(card => card.isActive !== false || accountsWithTransactions.has(String(card.id)));

  const handleYearClick = (year) => {
    setSelectedYear(year);
    setCurrentView('months');
  };

  const openSpendingPeriod = async (year, monthIndex) => {
    if (changingPeriod) return;
    setChangingPeriod(true);
    const next = new URLSearchParams(params); next.set('period', `${year}-${String(monthIndex + 1).padStart(2, '0')}`); setParams(next, { replace: true });
    setExpandedCards(new Set());
    setSelectedYear(year);
    setSelectedMonth(monthIndex);
    setCurrentView('spending');
    try { await loadMonthlySpending(year, monthIndex + 1); }
    finally { setChangingPeriod(false); }
  };

  const handleMonthClick = async (monthIndex) => {
    await openSpendingPeriod(selectedYear, monthIndex);
  };

  const changeSelectedYear = delta => {
    const nextYear = selectedYear + delta;
    if (nextYear < FIRST_SPENDING_YEAR || nextYear > LAST_SPENDING_YEAR) return;
    setSelectedYear(nextYear);
  };

  const changeSelectedMonth = async delta => {
    const periodIndex = selectedYear * 12 + selectedMonth + delta;
    const nextYear = Math.floor(periodIndex / 12);
    const nextMonth = periodIndex % 12;
    if (nextYear < FIRST_SPENDING_YEAR || nextYear > LAST_SPENDING_YEAR) return;
    await openSpendingPeriod(nextYear, nextMonth);
  };

  const handleAddExpense = async (cardId, description, amount, categories, updateId, year = selectedYear, month = selectedMonth) => {
    if (!api || !account?.id) return;

    // Check for duplicates, but exclude the expense being updated
    const duplicate = monthlySpending.some(cardSpending =>
      cardSpending.expenses?.some(
        expense =>
          expense.description.trim().toLowerCase() ===
          description.trim().toLowerCase() &&
          expense.id !== updateId // Exclude the expense being updated
      )
    );

    if (duplicate) {
      throw new Error('An expense with this description already exists for the selected month.');
    }

    const expenseData = {
        description,
        categories: categories || [],
        mainCategory: categories?.[0] || ""
    };
    if (!updateId || modalForm.source !== 'simplefin') {
      expenseData.amount = parseFloat(amount);
      expenseData.date = new Date().toISOString().split("T")[0];
    }
    if (updateId) {
      await api.updateExpense(account.id, year, month + 1, cardId, updateId, expenseData);
    } else {
      await api.addExpense(account.id, year, month + 1, cardId, expenseData);
    }

    await loadMonthlySpending(selectedYear, selectedMonth + 1);
  };

  const toggleCardExpansion = (cardId) => {
    setExpandedCards(current => current.has(cardId) ? new Set() : new Set([cardId]));
  };

  const openMerchantRule = async (expense) => {
    const category = expense.mainCategory || expense.category || expense.categories?.[0];
    if (!category || category.toLocaleLowerCase() === 'uncategorized') return;
    setRememberingExpenseId(expense.id);
    setCategoryRuleError('');
    setCategoryRuleNotice('');
    try {
      const suggestion = await api.getMerchantRuleSuggestion(expense.id);
      setMerchantRuleDraft({ expenseId: expense.id, category, categories: expense.categories || [category], merchant: suggestion.merchant, effectiveFrom: suggestion.effectiveFrom });
    } catch (err) {
      setCategoryRuleError(err.message || 'Unable to prepare this merchant rule.');
    } finally {
      setRememberingExpenseId(null);
    }
  };

  const rememberCategoryForMerchant = async (event) => {
    event.preventDefault();
    if (!merchantRuleDraft) return;
    setRememberingExpenseId(merchantRuleDraft.expenseId);
    setCategoryRuleError('');
    setCategoryRuleNotice('');
    try {
      const result = await api.rememberExpenseCategory(
        merchantRuleDraft.expenseId,
        merchantRuleDraft.category,
        merchantRuleDraft.merchant,
        merchantRuleDraft.effectiveFrom,
      );
      setRememberedExpenseIds(current => new Set([...current, merchantRuleDraft.expenseId]));
      setMerchantRuleDraft(null);
      await loadMonthlySpending(selectedYear, selectedMonth + 1);
      setCategoryRuleNotice(`Applied this rule to ${result.appliedCount || 0} purchase${result.appliedCount === 1 ? '' : 's'}.`);
    } catch (err) {
      setCategoryRuleError(err.message || 'Unable to remember this merchant category.');
    } finally {
      setRememberingExpenseId(null);
    }
  };

  const handleModalSubmit = async (e) => {
    e.preventDefault();
    if (modalForm.cardId && modalForm.description && modalForm.amount && !savingExpense) {
      setExpenseFormError('');
      if (modalForm.source === 'simplefin' && Number(modalForm.amount) !== Number(modalForm.originalAmount)) {
        setExpenseFormError('Amount and date are controlled by SimpleFIN for synced expenses. Change the transaction through your financial institution and sync again.');
        return false;
      }
      setSavingExpense(true);
      try {
      if (modalForm.updateId.length >= 3) {
        await handleAddExpense(modalForm.cardId, modalForm.description, modalForm.amount, modalForm.categories, modalForm.updateId);
      } else {
        await handleAddExpense(modalForm.cardId, modalForm.description, modalForm.amount, modalForm.categories, undefined);
      }
      setModalForm({ cardId: modalForm.cardId, description: '', amount: '', originalAmount: '', categories: [], updateId: '', source: '' });
      return true;
      } catch (error) {
        setExpenseFormError(error.message || 'Unable to save this expense.');
        return false;
      } finally {
        setSavingExpense(false);
      }
    }
    return false;
  };

  const removeCategory = (categoryToRemove) => {
    setModalForm({ ...modalForm, categories: modalForm.categories.filter(cat => cat !== categoryToRemove) });
  };

  const getCategoryColor = (categoryName) => {
    const category = categories.find(cat => (typeof cat === 'string' ? cat : cat.name) === categoryName);
    if (!category) return '#e9ecef';
    return typeof category === 'string' ? '#e9ecef' : category.color;
  };

  const deleteExpense = async (expense, cardId) => {
    if (!expense?.id || deletingExpenseId) return;
    setExpenseActionError(null);
    setDeletingExpenseId(expense.id);
    try {
      await api.deleteExpense(account.id, selectedYear, selectedMonth + 1, cardId, expense.id);
      await loadMonthlySpending(selectedYear, selectedMonth + 1);
    } catch (error) {
      setExpenseActionError({ expenseId: expense.id, message: error.message || 'Unable to delete this expense.' });
    } finally {
      setDeletingExpenseId(null);
    }
  };

  const openExpenseEditor = (expense, cardId) => {
    setExpenseFormError('');
    setModalForm({
      cardId,
      description: expense.description,
      amount: expense.originalAmount ?? expense.amount,
      originalAmount: expense.originalAmount ?? expense.amount,
      categories: expense.categories || [],
      updateId: expense.id,
      source: expense.source || '',
    });
    setShowUpdateModal(true);
  };

  const openSplitPurchase = (expense) => {
    setSplitError('');
    setSplitDraft({
      expense,
      mode: expense.split?.mode || 'percent',
      allocations: expense.split?.allocations?.map(allocation => ({ ...allocation })) || [],
    });
  };

  const saveSplitPurchase = async (event) => {
    event.preventDefault(); if (!splitDraft || savingSplit) return;
    setSavingSplit(true); setSplitError('');
    try {
      await api.updateExpenseSplit(splitDraft.expense.id, splitDraft.mode, splitDraft.allocations);
      setSplitDraft(null);
      await loadMonthlySpending(selectedYear, selectedMonth + 1);
    } catch (error) { setSplitError(error.message || 'Unable to save this split.'); }
    finally { setSavingSplit(false); }
  };

  const splitAssigned = splitDraft?.allocations.reduce((sum, allocation) => sum + (Number(allocation.value) || 0), 0) || 0;
  const splitMaximum = splitDraft?.mode === 'percent' ? 100 : Math.abs(Number(splitDraft?.expense.originalAmount ?? splitDraft?.expense.amount) || 0);
  const submitIconSuggestion = async (event) => {
    event.preventDefault(); setIconSubmissionError('');
    try {
      const form = new FormData(event.currentTarget);
      await api.submitIcon(form); setIconDraft(null);
    } catch (error) { setIconSubmissionError(error.message); }
  };

  const getCategoryChartData = () => {
    const categoryTotals = {};

    monthlySpending.forEach(cardSpending => {
      cardSpending.expenses?.forEach(expense => {
        if (expense.mainCategory) {
          categoryTotals[expense.mainCategory] = (categoryTotals[expense.mainCategory] || 0) + expense.amount;
        } else {
          categoryTotals['Uncategorized'] = (categoryTotals['Uncategorized'] || 0) + expense.amount;
        }
      });
    });

    const labels = Object.keys(categoryTotals);
    const data = Object.values(categoryTotals);
    const colors = labels.map(label =>
      label === 'Uncategorized' ? '#6c757d' : getCategoryColor(label)
    );

    return {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderWidth: 1
      }]
    };
  };



  const renderBreadcrumb = () => (
    <div className="breadcrumb">
      <span
        onClick={() => setCurrentView('years')}
        className="breadcrumb-link"
      >
        Years
      </span>
      {selectedYear && (
        <>
          <span> &gt; </span>
          <span
            onClick={() => setCurrentView('months')}
            className="breadcrumb-link"
          >
            {selectedYear}
          </span>
        </>
      )}
      {currentView === 'spending' && selectedMonth !== null && (
        <>
          <span> &gt; </span>
          <span>{months[selectedMonth]}</span>
        </>
      )}
    </div>
  );

  const renderYearsView = () => (
    <div>
      <h2 className="page-title">Select Year</h2>
      <div className="grid-4-col">
        {years.map(year => (
          <div
            key={year}
            onClick={() => handleYearClick(year)}
            className="grid-item"
          >
            {year}
          </div>
        ))}
      </div>
    </div>
  );

  const renderMonthsView = () => (
    <div>
      <div className="monthly-period-navigation monthly-year-navigation">
        <button type="button" onClick={() => changeSelectedYear(-1)} disabled={selectedYear <= FIRST_SPENDING_YEAR} aria-label={`Show months in ${selectedYear - 1}`}>
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <h2 className="page-title">Select Month - {selectedYear}</h2>
        <button type="button" onClick={() => changeSelectedYear(1)} disabled={selectedYear >= LAST_SPENDING_YEAR} aria-label={`Show months in ${selectedYear + 1}`}>
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </div>
      <div className="grid-4-col">
        {months.map((month, index) => (
          <div
            key={month}
            onClick={() => handleMonthClick(index)}
            className="grid-item"
          >
            {month}
          </div>
        ))}
      </div>
    </div>
  );

  const renderMonthlyCategorySummary = () => {
    const chart = getCategoryChartData();
    const total = monthlySpending.reduce((sum, record) => sum + (record.expenses || []).reduce((value, expense) => value + expense.amount, 0), 0);
    return <section className="ux-month-summary ux-card">
      <div className="ux-month-metrics"><div className="ux-month-total"><span className="ux-eyebrow">Selected month</span><strong>{formatMoney(total)}</strong><small>{monthlySpending.reduce((sum, record) => sum + (record.expenses?.length || 0), 0)} purchases across your accounts</small></div>
      <div className="ux-month-budget">{financialProfile?.monthlySpendLimit > 0 ? <><span className="ux-eyebrow">Budget remaining</span><strong>{formatMoney(financialProfile.monthlySpendLimit - total)}</strong><small>of {formatMoney(financialProfile.monthlySpendLimit)} monthly limit</small></> : <Link className="ux-text-button" to="/settings?panel=financial">Set a monthly budget</Link>}</div>
      <Link className="ux-text-button" to={`/category-browser?range=custom&start=${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-01&end=${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${new Date(selectedYear, selectedMonth + 1, 0).getDate()}&section=overview`}>Explore in Analytics</Link></div>
      <SpendingPie labels={chart.labels} values={chart.datasets[0].data} colors={chart.datasets[0].backgroundColor} total={total} currency={reportingCurrency} title="Spending by category" />
    </section>;
  };

  const renderSpendingView = () => (
    <div className="monthly-spending-view">
      <div className="section-header">
        <div className="monthly-period-navigation monthly-month-navigation">
          <button type="button" onClick={() => changeSelectedMonth(-1)} disabled={changingPeriod || (selectedYear === FIRST_SPENDING_YEAR && selectedMonth === 0)} aria-label="Show previous month">
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <h2 className="section-title">{months[selectedMonth]} {selectedYear}</h2>
          <button type="button" onClick={() => changeSelectedMonth(1)} disabled={changingPeriod || (selectedYear === LAST_SPENDING_YEAR && selectedMonth === 11)} aria-label="Show next month">
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="monthly-header-actions">

          {FILE_UPLOADS_ENABLED && <button
            onClick={() => setShowImportModal(true)}
            className="btn-primary"
            disabled={!activeAccounts.length}
            title={!activeAccounts.length ? 'Reactivate an account before importing expenses' : undefined}
          >
            <div className="import-button-copy">Import <Upload size={24} /></div>
          </button>}
          <button
            onClick={() => { setExpenseFormError(''); setShowAddModal(true); }}
            className="btn-primary"
            disabled={!activeAccounts.length}
            title={!activeAccounts.length ? 'Reactivate an account before adding expenses' : undefined}
          >
            Add Expense
          </button>
        </div>
      </div>

      {loadError && <p className="ux-error" role="alert">{loadError} <button type="button" className="ux-text-button" onClick={() => loadMonthlySpending(selectedYear, selectedMonth + 1)}>Try again</button></p>}
      {renderMonthlyCategorySummary()}
      <label className="ux-search"><Search size={18} /><input aria-label="Search purchases" placeholder="Search merchant, note, tag, or amount" value={query} onChange={event => setQuery(event.target.value)} /></label>
      {query.trim() && !monthlySpending.some(record => record.expenses?.some(expense => [expense.description, expense.notes, expense.amount, formatMoney(expense.amount), ...(expense.categories || [])].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))) && <div className="ux-card ux-empty"><strong>No matching purchases</strong><p>Try another merchant, note, tag, or amount.</p><button type="button" className="ux-text-button" onClick={() => setQuery('')}>Clear search</button></div>}

      {visibleMonthlyAccounts.map(card => {
        const cardSpending = monthlySpending.find(s => s.cardId.toString() === card.id.toString());
        const allExpenses = cardSpending?.expenses || [];
        const expenses = allExpenses.filter(expense => [expense.description, expense.notes, expense.amount, formatMoney(expense.amount), ...(expense.categories || [])].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
        if (query.trim() && !expenses.length) return null;
        const total = expenses.reduce((sum, exp) => sum + exp.amount, 0);
        const isExpanded = Boolean(query.trim()) || expandedCards.has(card.id);

        return (
          <div key={card.id} ref={node => { if (node) monthlyCardRefs.current.set(card.id, node); else monthlyCardRefs.current.delete(card.id); }} className={`expandable-card monthly-account-card${isExpanded ? ' is-expanded' : ''}`}>
            <div
              className="expandable-header monthly-account-row"
              onClick={() => toggleCardExpansion(card.id)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
                event.preventDefault();
                toggleCardExpansion(card.id);
              }}
              role="button"
              tabIndex={0}
              aria-expanded={isExpanded}
            >
              <div className="monthly-account-identity">
                <div className="monthly-account-icon">
                  {card.icon ? (
                    <VendorIcon className="entity-icon" src={card.icon.url} alt="" />
                  ) : (
                    <button
                      type="button"
                      className="entity-icon-fallback"
                      title="Suggest an account icon"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!FILE_UPLOADS_ENABLED) return;
                        const name = card.institution || card.nickname || card.name;
                        setIconSubmissionError('');
                        setIconDraft({ entityType:'institution', displayName:name, pattern:name, exampleText:`${card.nickname || card.name} - ${card.institution || ''}` });
                      }}
                      disabled={!FILE_UPLOADS_ENABLED}
                    >
                      {(card.institution || card.nickname || card.name).slice(0,1).toUpperCase()}
                    </button>
                  )}
                </div>
                <div className="monthly-account-copy">
                  <h3 className="text-black account-card-title">
                    <span>{card.nickname || card.name}</span>
                    {card.institution && <span className="monthly-account-institution"> — {card.institution}</span>}
                  </h3>
                  <p className="monthly-account-transaction-count">
                    {expenses.length} {expenses.length === 1 ? 'transaction' : 'transactions'}
                  </p>
                </div>
              </div>
              <div className="monthly-account-total">
                <span>{query.trim() ? 'Matching purchases' : 'Monthly total'}</span>
                <strong>{formatMoney(total)}</strong>
              </div>
              <button
                type="button"
                className="btn-icon monthly-account-chevron"
                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${card.nickname || card.name}`}
                tabIndex={-1}
              >
                <ChevronRight size={20} aria-hidden="true" />
              </button>
            </div>

            {isExpanded && (
              <div className="expandable-content">
                <h4 className="text-black expenses-heading">Expenses:</h4>
                {expenses.length === 0 ? (
                  <p className="text-black text-italic">No expenses added yet</p>
                ) : (
                  expenses.map(expense => (
                    <PurchaseRow key={expense.id} expense={expense} onOpen={() => openPurchase(expense.id)} onTags={() => openPurchase(expense.id, 'tags')} error={expenseActionError?.expenseId === expense.id ? expenseActionError.message : ''} actions={[
                      { label: 'Purchase details', onClick: () => openPurchase(expense.id) },
                      { label: 'Edit categories', onClick: () => openPurchase(expense.id, 'tags') },
                      { label: 'Remember merchant', onClick: () => openMerchantRule({ ...expense, cardId: card.id }), disabled: rememberingExpenseId === expense.id || rememberedExpenseIds.has(expense.id) || !expense.mainCategory || expense.mainCategory.toLocaleLowerCase() === 'uncategorized' },
                      { label: 'Split purchase', onClick: () => openSplitPurchase(expense) },
                      { label: 'Edit purchase', onClick: () => openExpenseEditor(expense, card.id) },
                      ...(FILE_UPLOADS_ENABLED ? [{ label: 'Suggest vendor icon', onClick: () => { setIconSubmissionError(''); setIconDraft({ entityType: 'merchant', displayName: expense.description, pattern: expense.providerDescription || expense.description, exampleText: expense.providerDescription || expense.description }); } }] : []),
                      { label: expense.source === 'simplefin' ? 'Hide expense' : 'Delete expense', onClick: () => deleteExpense(expense, card.id), disabled: deletingExpenseId === expense.id, danger: true },
                    ]} />
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
      {categoryRuleError && <p className="category-rule-error" role="alert">{categoryRuleError}</p>}
      {categoryRuleNotice && <p className="category-rule-notice" role="status">{categoryRuleNotice}</p>}

      {merchantRuleDraft && createPortal(
        <div className="modal-overlay merchant-rule-overlay" role="presentation" onMouseDown={() => setMerchantRuleDraft(null)}>
          <form className="modal-content merchant-rule-modal" onSubmit={rememberCategoryForMerchant} onMouseDown={event => event.stopPropagation()}>
            <button type="button" onClick={() => setMerchantRuleDraft(null)} className="btn-close" aria-label="Close">×</button>
            <h3 className="modal-title">Remember merchant</h3>
            <p className="merchant-rule-help">Purchases containing this merchant pattern will use <strong>{merchantRuleDraft.categories.join(', ')}</strong> from the selected date onward.</p>
            <div className="form-group">
              <label className="form-label" htmlFor="merchant-rule-pattern">Merchant pattern</label>
              <input id="merchant-rule-pattern" className="form-input" value={merchantRuleDraft.merchant} maxLength={80} required autoFocus onChange={event => setMerchantRuleDraft(current => ({ ...current, merchant: event.target.value }))} />
              <small>For example, “Amazon” matches changing Amazon order references.</small>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="merchant-rule-date">Apply from</label>
              <input id="merchant-rule-date" type="date" className="form-input" value={merchantRuleDraft.effectiveFrom} required onChange={event => setMerchantRuleDraft(current => ({ ...current, effectiveFrom: event.target.value }))} />
              <small>Matching purchases on or after this date will use exactly the saved tags, replacing their previous tags.</small>
            </div>
            <div className="form-actions-center"><button type="submit" className="btn-success" disabled={rememberingExpenseId === merchantRuleDraft.expenseId}>{rememberingExpenseId === merchantRuleDraft.expenseId ? 'Applying…' : 'Save and apply rule'}</button></div>
          </form>
        </div>, document.body
      )}

      {splitDraft && createPortal(<div className="modal-overlay" onMouseDown={() => setSplitDraft(null)}>
        <form className="modal-content split-purchase-modal" onSubmit={saveSplitPurchase} onMouseDown={event => event.stopPropagation()}>
          <button type="button" className="btn-close" onClick={() => setSplitDraft(null)}>×</button>
          <h3 className="modal-title">Split purchase</h3>
          <p>{splitDraft.expense.description} · Original {formatMoney(splitDraft.expense.originalAmount ?? splitDraft.expense.amount, splitDraft.expense.reportingCurrency)}</p>
          {splitError && <p className="category-rule-error" role="alert">{splitError}</p>}
          <SplitPurchaseFields people={splitPeople} draft={splitDraft} setDraft={setSplitDraft} maximum={splitMaximum} assigned={splitAssigned} saving={savingSplit} formatMoney={formatMoney} />
        </form>
      </div>, document.body)}
      {FILE_UPLOADS_ENABLED && iconDraft && createPortal(<div className="modal-overlay" onMouseDown={() => setIconDraft(null)}><form className="modal-content" onSubmit={submitIconSuggestion} onMouseDown={event => event.stopPropagation()}>
        <button type="button" className="btn-close" onClick={() => setIconDraft(null)}>×</button><h3 className="modal-title">Suggest company icon</h3>
        <p>The icon will appear only after admin review and approval.</p>{iconSubmissionError && <p className="category-rule-error">{iconSubmissionError}</p>}
        <input type="hidden" name="entityType" value={iconDraft.entityType} /><input type="hidden" name="exampleText" value={iconDraft.exampleText} />
        <label className="form-group">{iconDraft.entityType === 'merchant' ? 'Company name' : 'Institution name'}<input className="form-input" name="displayName" maxLength="80" defaultValue={iconDraft.displayName} required /></label>
        <label className="form-group">Matching pattern<input className="form-input" name="pattern" maxLength="100" defaultValue={iconDraft.pattern} required /></label>
        <label className="form-group">PNG, JPEG, WebP, or SVG (maximum 1 MB; SVG 256 KB)<input className="form-input" type="file" name="icon" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" required /></label>
        <button type="submit">Submit for review</button>
      </form></div>, document.body)}

      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <button
              onClick={() => setShowAddModal(false)}
              className="btn-close"
            >
              ×
            </button>

            <h3 className="modal-title">Add Expense</h3>
            <form onSubmit={handleModalSubmit}>
              {expenseFormError && <p className="category-rule-error" role="alert">{expenseFormError}</p>}
              <div className="form-group">
                <label className="form-label">Card:</label>
                <select
                  value={modalForm.cardId}
                  onChange={(e) => setModalForm({ ...modalForm, cardId: e.target.value })}
                  className="form-select"
                  required
                >
                  <option value="">Select a card</option>
                  {activeAccounts.map(card => (
                    <option key={card.id} value={card.id}>
                      {card.nickname || card.name} - {card.institution}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Description:</label>
                <input
                  type="text"
                  value={modalForm.description}
                  onChange={(e) => setModalForm({ ...modalForm, description: e.target.value })}
                  maxLength={500}
                  className="form-input"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Categories:</label>
                <div className="category-edit-row">
                  <select
                    onChange={(e) => { api.addCategory(e.target.value); e.target.value = ''; }}
                    className="form-select category-edit-select"
                  >
                    <option value="">Select category</option>
                    {categories.filter(cat => (typeof cat === 'string' ? cat : cat.name).toLocaleLowerCase() !== 'uncategorized').map(cat => {
                      const categoryName = typeof cat === 'string' ? cat : cat.name;
                      return <option key={categoryName} value={categoryName}>{categoryName}</option>;
                    })}
                  </select>
                  <input
                    type="text"
                    placeholder="Or type new category"
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        api.addCategory(e.target.value);
                        e.target.value = '';
                      }
                    }}
                    className="form-input category-edit-select"
                  />
                </div>
                {modalForm.categories.length > 0 && (
                  <div className="editable-category-tags">
                    {modalForm.categories.map(cat => (
                      <span key={cat} className="editable-category-tag">
                        {cat}
                        <button
                          type="button"
                          onClick={() => removeCategory(cat)}
                          className="editable-category-remove"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Amount:</label>
                <input
                  type="number"
                  step="0.01"
                  value={modalForm.amount}
                  onChange={(e) => setModalForm({ ...modalForm, amount: e.target.value })}
                  min="-1000000000000"
                  max="1000000000000"
                  className="form-input"
                  required
                />
              </div>
              <div className="form-actions-center">
                <button type="submit" className="btn-success" disabled={savingExpense}>
                  {savingExpense ? 'Saving…' : 'Add Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showUpdateModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <button
              onClick={() => setShowUpdateModal(false)}
              className="btn-close"
            >
              ×
            </button>

            <h3 className="modal-title">Update Expense</h3>
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (await handleModalSubmit(e)) setShowUpdateModal(false);
            }}>
              {expenseFormError && <p className="category-rule-error" role="alert">{expenseFormError}</p>}
              <div className="form-group">
                <label className="form-label">Card:</label>
                <select
                  value={modalForm.cardId}
                  onChange={(e) => setModalForm({ ...modalForm, cardId: e.target.value })}
                  className="form-select"
                  required
                >
                  <option value="">Select a card</option>
                  {visibleMonthlyAccounts.map(card => (
                    <option key={card.id} value={card.id}>
                      {card.nickname || card.name} - {card.institution}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Description:</label>
                <input
                  type="text"
                  value={modalForm.description}
                  onChange={(e) => setModalForm({ ...modalForm, description: e.target.value })}
                  maxLength={500}
                  className="form-input"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Categories:</label>
                <div className="category-edit-row">
                  <select
                    onChange={(e) => { api.addCategory(e.target.value); e.target.value = ''; }}
                    className="form-select category-edit-select"
                  >
                    <option value="">Select category</option>
                    {categories.filter(cat => (typeof cat === 'string' ? cat : cat.name).toLocaleLowerCase() !== 'uncategorized').map(cat => {
                      const categoryName = typeof cat === 'string' ? cat : cat.name;
                      return <option key={categoryName} value={categoryName}>{categoryName}</option>;
                    })}
                  </select>
                  <input
                    type="text"
                    placeholder="Or type new category"
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        api.addCategory(e.target.value);
                        e.target.value = '';
                      }
                    }}
                    className="form-input category-edit-select"
                  />
                </div>
                {modalForm.categories.length > 0 && (
                  <div className="editable-category-tags">
                    {modalForm.categories.map(cat => (
                      <span key={cat} className="editable-category-tag">
                        {cat}
                        <button
                          type="button"
                          onClick={() => removeCategory(cat)}
                          className="editable-category-remove"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Amount:</label>
                <input
                  type="number"
                  step="0.01"
                  value={modalForm.amount}
                  onChange={(e) => setModalForm({ ...modalForm, amount: e.target.value })}
                  min="-1000000000000"
                  max="1000000000000"
                  className="form-input"
                  required
                />
                {modalForm.source === 'simplefin' && <small className="form-help">This amount comes from SimpleFIN. Changing it here will be rejected.</small>}
              </div>
              <div className="form-actions-center">
                <button type="submit" className="btn-success" disabled={savingExpense}>
                  {savingExpense ? 'Saving…' : 'Update Expense'}
                </button>
              </div>
            </form>
          </div>
        </div >
      )
      }

      {FILE_UPLOADS_ENABLED && showImportModal && <Suspense fallback={<p role="status">Loading import tools…</p>}><ImportModal
        showImportModal={showImportModal}
        setShowImportModal={setShowImportModal}
        creditCards={activeAccounts}
        handleImport={async ({ csvData, amountColumn, descriptionColumn, dateColumn, cardId, discardNegatives /* True by default */, addMultipleMonths /* True by default */ }) => {
          // First pass: Check if majority of expenses are negative
          const validAmounts = csvData
            .map(row => parseFloat(row[amountColumn]))
            .filter(amount => !isNaN(amount));

          const negativeCount = validAmounts.filter(amount => amount < 0).length;
          const shouldFlipSigns = negativeCount > validAmounts.length / 2;

          if (shouldFlipSigns) {
            console.log(`Detected ${negativeCount}/${validAmounts.length} negative amounts. Flipping all signs.`);
          }

          csvData.forEach(async row => {
            console.log("Row: ", row);
            const description = row[descriptionColumn];
            let amount = parseFloat(row[amountColumn]);

            // Flip sign if majority were negative
            if (shouldFlipSigns) {
              amount = amount * -1;
            }

            const transaction_date = new Date(row[dateColumn]);
            if (description != null && !isNaN(amount)) {
              if (!addMultipleMonths && transaction_date.getMonth() === selectedMonth) {
                if ((discardNegatives && amount >= 0) || !discardNegatives) {
                  await handleAddExpense(cardId, description, amount, [], undefined);
                }
              } else {
                if ((discardNegatives && amount >= 0) || !discardNegatives) {
                  await handleAddExpense(cardId, description, amount, [], undefined, transaction_date.getFullYear(), transaction_date.getMonth());
                }
              }
            } else {
              console.warn(`Skipping row ${row}: invalid amount "${row[amountColumn]}"`);
            }
          });
        }}
      /></Suspense>}

    </div >
  );

  return (
    <div className="page-container text-black monthly-spending-page">
      <h1 className="page-title">Spending</h1>
      {renderBreadcrumb()}

      {currentView === 'years' && renderYearsView()}
      {currentView === 'months' && renderMonthsView()}
      {currentView === 'spending' && renderSpendingView()}
    </div>
  );
}
