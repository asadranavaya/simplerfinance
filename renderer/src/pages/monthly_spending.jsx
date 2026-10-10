import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useAccount } from '../util/AccountContext';
import { api } from '../util/api';

import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { externalCategoryTooltip, ExternalTooltipCleanupPlugin } from '../util/externalChartTooltip';
import { Doughnut } from 'react-chartjs-2';
import { Bell, ChevronLeft, ChevronRight, StickyNote, Upload } from "lucide-react";
import ImportModal from '../util/ImportCsv';
import SplitPurchaseFields from '../components/SplitPurchaseFields';

ChartJS.register(ArcElement, Tooltip, Legend, ChartDataLabels, ExternalTooltipCleanupPlugin);

const FIRST_SPENDING_YEAR = 2020;
const LAST_SPENDING_YEAR = 2099;

export default function MonthlySpendingPage() {
  const { account } = useAccount();
  const location = useLocation();
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
  const [categoryDropdown, setCategoryDropdown] = useState({ expenseId: null, isOpen: false });
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [colorPicker, setColorPicker] = useState({ categoryName: null, isOpen: false, color: '#007bff' });
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
  const [openExpenseMenuId, setOpenExpenseMenuId] = useState(null);
  const [betaFeatures, setBetaFeatures] = useState([]);
  const [purchaseDiagnostics, setPurchaseDiagnostics] = useState(null);
  const [purchaseNotesDraft, setPurchaseNotesDraft] = useState('');
  const [savingPurchaseNotes, setSavingPurchaseNotes] = useState(false);
  const [purchaseNotesError, setPurchaseNotesError] = useState('');
  const [purchaseNotesSaved, setPurchaseNotesSaved] = useState(false);
  const [reminderDraft, setReminderDraft] = useState('');
  const [reminderError, setReminderError] = useState('');
  const [savingReminder, setSavingReminder] = useState(false);
  const [changingPeriod, setChangingPeriod] = useState(false);

  useEffect(() => {
    loadCreditCards();
    loadCategories();
    api.getSplitPeople().then(setSplitPeople).catch(() => {});
    api.getBetaFeatures().then(result => setBetaFeatures(result.features || [])).catch(() => {});

    const today = new Date();
    const requestedMonthIndex = months.indexOf(location.state?.month);
    const hasRequestedPeriod = location.state?.year && requestedMonthIndex !== -1;
    const year = hasRequestedPeriod ? Number(location.state.year) : today.getFullYear();
    const monthIndex = hasRequestedPeriod ? requestedMonthIndex : today.getMonth();

    setSelectedYear(year);
    setSelectedMonth(monthIndex);
    setCurrentView('spending');
    loadMonthlySpending(year, monthIndex + 1);
  // Initial route state is consumed once; subsequent navigation is handled by this page's controls.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const purchaseInspectorEnabled = betaFeatures.includes('purchase_data_inspector');
  const showDiagnosticMetadata = purchaseDiagnostics?.data?.diagnosticsEnabled ?? purchaseInspectorEnabled;
  const openPurchaseDiagnostics = async (expense) => {
    setReminderDraft('');
    setReminderError('');
    setPurchaseNotesDraft(expense.notes || '');
    setPurchaseNotesError('');
    setPurchaseNotesSaved(false);
    setPurchaseDiagnostics({ expense, loading: true, error: '', data: null });
    try {
      const data = await api.getExpenseDiagnostics(expense.id);
      if (data.purchase?.reminder) {
        const date = new Date(data.purchase.reminder.dueAt);
        setReminderDraft(new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
      }
      setPurchaseNotesDraft(data.purchase?.notes || '');
      setPurchaseDiagnostics({ expense, loading: false, error: '', data });
    } catch (error) {
      setPurchaseDiagnostics({ expense, loading: false, error: error.message, data: null });
    }
  };

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
    const handleClickOutside = (event) => {
      if (categoryDropdown.isOpen && !event.target.closest('.category-dropdown-container')) {
        setCategoryDropdown({ expenseId: null, isOpen: false });
        setNewCategoryInput('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [categoryDropdown.isOpen]);

  useEffect(() => {
    if (!openExpenseMenuId) return undefined;
    const closeMenu = event => {
      if (!event.target.closest('.expense-mobile-menu-wrap')) setOpenExpenseMenuId(null);
    };
    document.addEventListener('pointerdown', closeMenu);
    return () => document.removeEventListener('pointerdown', closeMenu);
  }, [openExpenseMenuId]);

  useEffect(() => {
    if (!categoryDropdown.isOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [categoryDropdown.isOpen]);

  const loadCreditCards = async () => {
    if (api && account?.id) {
      const [cards, banks, profile] = await Promise.all([
        api.getCreditCards(account.id),
        api.getBankAccounts(account.id),
        api.getFinancialProfile(),
      ]);
      setReportingCurrency(profile?.reportingCurrency || 'USD');
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
      const spending = await api.getMonthlySpending(account.id, year, month);
      setMonthlySpending(spending);
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

  const visibleCategories = categories.filter((category) => {
    const name = typeof category === 'string' ? category : category.name;
    return name.toLocaleLowerCase() !== 'uncategorized'
      && name.toLocaleLowerCase().includes(newCategoryInput.trim().toLocaleLowerCase());
  });

  const handleYearClick = (year) => {
    setSelectedYear(year);
    setCurrentView('months');
  };

  const openSpendingPeriod = async (year, monthIndex) => {
    if (changingPeriod) return;
    setChangingPeriod(true);
    setExpandedCards(new Set());
    setOpenExpenseMenuId(null);
    setCategoryDropdown({ expenseId: null, isOpen: false });
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
    setOpenExpenseMenuId(null);
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

  const toggleCategoryDropdown = (expenseId) => {
    setCategoryDropdown(prev => ({
      expenseId: prev.expenseId === expenseId && prev.isOpen ? null : expenseId,
      isOpen: prev.expenseId === expenseId ? !prev.isOpen : true
    }));
    setNewCategoryInput('');
  };

  const replaceMonthlyExpense = updated => {
    if (!updated?.id) return;
    setMonthlySpending(records => records.map(record => ({
      ...record,
      expenses: (record.expenses || []).map(expense => expense.id === updated.id ? { ...expense, ...updated } : expense),
    })));
  };

  const savePurchaseNotes = async event => {
    event.preventDefault();
    if (!purchaseDiagnostics?.expense || savingPurchaseNotes) return;
    setSavingPurchaseNotes(true);
    setPurchaseNotesError('');
    setPurchaseNotesSaved(false);
    try {
      const updated = await api.updateExpense(
        account.id,
        selectedYear,
        selectedMonth + 1,
        purchaseDiagnostics.expense.cardId,
        purchaseDiagnostics.expense.id,
        { notes: purchaseNotesDraft },
      );
      replaceMonthlyExpense(updated);
      setPurchaseDiagnostics(current => current ? {
        ...current,
        expense: { ...current.expense, notes: updated.notes || '' },
        data: current.data ? {
          ...current.data,
          purchase: { ...current.data.purchase, notes: updated.notes || '' },
        } : current.data,
      } : current);
      setPurchaseNotesDraft(updated.notes || '');
      setPurchaseNotesSaved(true);
    } catch (error) {
      setPurchaseNotesError(error.message || 'Unable to save these notes.');
    } finally {
      setSavingPurchaseNotes(false);
    }
  };

  const savePurchaseReminder = async (remove = false) => {
    if (!purchaseDiagnostics || savingReminder) return;
    setSavingReminder(true);
    setReminderError('');
    try {
      const date = new Date(reminderDraft);
      if (!remove && (!reminderDraft || !Number.isFinite(date.getTime()))) throw new Error('Choose a reminder date and time.');
      const { reminder } = await api.setPurchaseReminder(purchaseDiagnostics.expense.id, remove ? null : date.toISOString());
      const updated = { ...purchaseDiagnostics.expense, reminder };
      replaceMonthlyExpense(updated);
      setPurchaseDiagnostics(current => current ? { ...current, expense: updated, data: { ...current.data, purchase: { ...current.data.purchase, reminder } } } : current);
      if (remove) setReminderDraft('');
    } catch (error) {
      setReminderError(error.message || 'Unable to save this reminder.');
    } finally { setSavingReminder(false); }
  };

  const addCategoryToExpense = async (expense, category) => {
    if (!category || category.toLocaleLowerCase() === 'uncategorized' || expense.categories?.includes(category)) return;
    // Add category as main expense on first entry if it doesnt already exist
    const updatedCategories = [...(expense.categories || []).filter(item => item.toLocaleLowerCase() !== 'uncategorized'), category];
    setCategoryDropdown({ expenseId: null, isOpen: false });
    setNewCategoryInput('');
    setExpenseActionError(null);
    try {
      const updated = !expense.mainCategory
        ? await api.updateExpense(account.id, selectedYear, selectedMonth + 1, expense.cardId || categoryDropdown.cardId, expense.id, { categories: updatedCategories, mainCategory: category })
        : await api.updateExpense(account.id, selectedYear, selectedMonth + 1, expense.cardId || categoryDropdown.cardId, expense.id, { categories: updatedCategories });
      replaceMonthlyExpense(updated);
    } catch (error) {
      setExpenseActionError({ expenseId: expense.id, message: error.message || 'Unable to add this tag. Please try again.' });
    }
  };

  const updateMainExpenseCategory = async (expense, mainCategory) => {
    if (!mainCategory || mainCategory.toLocaleLowerCase() === 'uncategorized') return;
    const categories = [mainCategory, ...(expense.categories || []).filter(category => category !== mainCategory && category.toLocaleLowerCase() !== 'uncategorized')];
    setExpenseActionError(null);
    try {
      const updated = await api.updateExpense(account.id, selectedYear, selectedMonth + 1, expense.cardId || categoryDropdown.cardId, expense.id, { mainCategory, categories });
      replaceMonthlyExpense(updated);
    } catch (error) {
      setExpenseActionError({ expenseId: expense.id, message: error.message || 'Unable to change the primary tag. Please try again.' });
    }
  };

  const handleNewCategorySubmit = async (expense) => {
    if (newCategoryInput.trim()) {
      const newCategoryName = newCategoryInput.trim();
      if (newCategoryName.toLocaleLowerCase() === 'uncategorized') return;
      const categoryExists = categories.find(cat => (typeof cat === 'string' ? cat : cat.name).toLocaleLowerCase() === newCategoryName.toLocaleLowerCase());
      if (!categoryExists) {
        const updatedCategories = await api.addCategory(newCategoryName);
        setCategories(updatedCategories);
      }
      const resolvedName = categoryExists ? (typeof categoryExists === 'string' ? categoryExists : categoryExists.name) : newCategoryName;
      await addCategoryToExpense(expense, resolvedName);
    }
  };

  const openColorPicker = (categoryName) => {
    const category = categories.find(cat => (typeof cat === 'string' ? cat : cat.name) === categoryName);
    const currentColor = typeof category === 'string' ? '#007bff' : category.color;
    setCategoryDropdown({ expenseId: null, isOpen: false });
    setColorPicker({ categoryName, isOpen: true, color: currentColor });
  };

  const updateCategoryColor = async () => {
    if (colorPicker.categoryName) {
      const updatedCategories = await api.updateCategory(colorPicker.categoryName, colorPicker.color);
      setCategories(updatedCategories);
      setColorPicker({ categoryName: null, isOpen: false, color: '#007bff' });
    }
  };

  const getCategoryColor = (categoryName) => {
    const category = categories.find(cat => (typeof cat === 'string' ? cat : cat.name) === categoryName);
    if (!category) return '#e9ecef';
    return typeof category === 'string' ? '#e9ecef' : category.color;
  };

  const removeCategoryFromExpense = async (expense, categoryToRemove) => {
    setExpenseActionError(null);
    try {
      const updatedCategories = (expense.categories || []).filter(cat => cat !== categoryToRemove);
      const mainCategory = expense.mainCategory === categoryToRemove
        ? updatedCategories[0] || ''
        : expense.mainCategory || updatedCategories[0] || '';
      const updated = await api.updateExpense(
        account.id,
        selectedYear,
        selectedMonth + 1,
        expense.cardId || categoryDropdown.cardId,
        expense.id,
        { categories: updatedCategories, mainCategory },
      );
      replaceMonthlyExpense(updated);
    } catch (error) {
      setExpenseActionError({ expenseId: expense.id, message: error.message || 'Unable to remove this tag. Please try again.' });
    }
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
    if (!monthlySpending.length) return null;

    const categoryChartData = getCategoryChartData();
    const categoryTotal = categoryChartData.datasets[0].data.reduce((sum, value) => sum + value, 0);

    return (
      <div className="category-full-row monthly-category-row">
        <div className="donut-chart-container spending-category-card content-card">
          <h2 className="card-title monthly-category-title">🏷️ Spending by Category</h2>

          <div className="category-visual-layout">
            <div className="category-donut-chart chart-container">
              <Doughnut data={categoryChartData} options={{
                responsive: true,
                maintainAspectRatio: false,
                cutout: '66%',
                radius: '92%',
                animation: { duration: 900, easing: 'easeOutQuart' },
                elements: {
                  arc: {
                    borderWidth: 3,
                    borderColor: 'transparent',
                    borderRadius: 7,
                    spacing: 2,
                    hoverOffset: 8
                  }
                },
                plugins: {
                  legend: { display: false },
                  datalabels: { display: false },
                  tooltip: {
                    enabled: false,
                    external: externalCategoryTooltip,
                  }
                }
              }} />
              <div className="donut-center-text">
                <div className="donut-center-label">Total</div>
                <div className="donut-center-value">${categoryTotal.toLocaleString()}</div>
              </div>
            </div>

            <div className="category-breakdown">
              <div className="category-breakdown-heading">
                <span>Category breakdown</span>
                <small>{categoryChartData.labels.length} categories</small>
              </div>
              <div className="donut-pills-row">
                {categoryChartData.labels.map((label, index) => {
                  const value = categoryChartData.datasets[0].data[index] || 0;
                  const color = categoryChartData.datasets[0].backgroundColor[index];
                  return (
                    <div className="category-breakdown-item" key={label}>
                      <span className="category-breakdown-label"><i style={{ background: color }} />{label}</span>
                      <strong>${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderSpendingView = () => (
    <div className="monthly-spending-view">
      <div className="section-header">
        <div className="monthly-period-navigation monthly-month-navigation">
          <button type="button" onClick={() => changeSelectedMonth(-1)} disabled={changingPeriod || (selectedYear === FIRST_SPENDING_YEAR && selectedMonth === 0)} aria-label="Show previous month">
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <h2 className="section-title">Monthly Spending - {months[selectedMonth]} {selectedYear}</h2>
          <button type="button" onClick={() => changeSelectedMonth(1)} disabled={changingPeriod || (selectedYear === LAST_SPENDING_YEAR && selectedMonth === 11)} aria-label="Show next month">
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="monthly-header-actions">

          <button
            onClick={() => setShowImportModal(true)}
            className="btn-primary"
            disabled={!activeAccounts.length}
            title={!activeAccounts.length ? 'Reactivate an account before importing expenses' : undefined}
          >
            <div className="import-button-copy">Import <Upload size={24} /></div>
          </button>
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

      {renderMonthlyCategorySummary()}

      {visibleMonthlyAccounts.map(card => {
        const cardSpending = monthlySpending.find(s => s.cardId.toString() === card.id.toString());
        const expenses = cardSpending?.expenses || [];
        const total = expenses.reduce((sum, exp) => sum + exp.amount, 0);
        const isExpanded = expandedCards.has(card.id);

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
                    <img className="entity-icon" src={card.icon.url} alt="" />
                  ) : (
                    <button
                      type="button"
                      className="entity-icon-fallback"
                      title="Suggest an account icon"
                      onClick={(event) => {
                        event.stopPropagation();
                        const name = card.institution || card.nickname || card.name;
                        setIconSubmissionError('');
                        setIconDraft({ entityType:'institution', displayName:name, pattern:name, exampleText:`${card.nickname || card.name} - ${card.institution || ''}` });
                      }}
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
                <span>Monthly total</span>
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
                    <div
                      key={expense.id}
                      className="expense-item expense-inspectable"
                      onClick={event => {
                        if (event.target.closest('.expense-actions, .category-picker-overlay, .category-dropdown, button, input, select, a')) return;
                        openPurchaseDiagnostics({ ...expense, cardId: card.id });
                      }}
                      onKeyDown={event => {
                        if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return;
                        event.preventDefault();
                        openPurchaseDiagnostics({ ...expense, cardId: card.id });
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`View purchase details for ${expense.description}`}
                    >
                      <div className="expense-primary-copy">
<span className="expense-merchant-copy">{expense.icon ? <img className="entity-icon" src={expense.icon.url} alt="" /> : <button type="button" className="entity-icon-fallback" title="Suggest a company icon" onClick={() => { setIconSubmissionError(''); setIconDraft({ entityType:'merchant', displayName:expense.description, pattern:expense.providerDescription || expense.description, exampleText:expense.providerDescription || expense.description }); }}>{expense.description.slice(0,1).toUpperCase()}</button>}<span className="text-black">{expense.description}</span>{Boolean(expense.notes?.trim()) && <span className="expense-note-indicator" title="This purchase has notes" aria-label="This purchase has notes"><StickyNote size={14} strokeWidth={2.2} aria-hidden="true" /></span>}{expense.reminder && <span className="expense-note-indicator" title={`Purchase reminder: ${new Date(expense.reminder.dueAt).toLocaleString()}`} aria-label="This purchase has a reminder"><Bell size={14} strokeWidth={2.2} aria-hidden="true" /></span>}</span>
                        {(expense.transactionTime || expense.pending) && <small className="expense-transaction-meta">
                          {expense.transactionTime && <time dateTime={expense.transactionTime}>{expense.transactionTimePrecision === 'time'
                            ? new Date(expense.transactionTime).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                            : new Date(expense.transactionTime).toLocaleDateString([], { month: 'short', day: 'numeric' })}</time>}
                          {expense.pending && <span className="expense-pending-badge">Pending</span>}
                        </small>}
                        {expenseActionError?.expenseId === expense.id && <small className="expense-inline-error" role="alert">{expenseActionError.message}</small>}
                      </div>
                      <div className="expense-mobile-amount">
                        <strong>{formatMoney(expense.amount, expense.reportingCurrency)}</strong>
                        {expense.split && <small title={`Original purchase ${formatMoney(expense.originalAmount, expense.reportingCurrency)}`}>Your share</small>}
                      </div>
                      <div className="expense-actions">
                        {expense.categories && expense.categories.length > 0 && (
                          <div className="category-tags expense-category-tags">
                            {expense.categories.map(cat => (
                              <span
                                key={cat}
                                className={expense.mainCategory == cat ? 'category-tag-main' : 'category-tag'}
                                style={{ '--category-color': getCategoryColor(cat) }}
                                onClick={(e) => {
                                  const clicked = e.currentTarget;
                                  updateMainExpenseCategory({ ...expense, cardId: card.id }, cat);
                                  // Get all category tags within the same container
                                  const allTags = clicked.parentElement.querySelectorAll('.category-tag, .category-tag-main');

                                  // Reset them
                                  allTags.forEach(tag => {
                                    tag.classList.remove('category-tag-main');
                                    tag.classList.add('category-tag');
                                  });

                                  // Set the clicked one as main
                                  clicked.classList.remove('category-tag');
                                  clicked.classList.add('category-tag-main');
                                }}
                              >
                                {cat}
                                <button
                                  type="button"
                                  aria-label={`Remove ${cat} tag`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    removeCategoryFromExpense({ ...expense, cardId: card.id }, cat);
                                  }}
                                  className="category-x category-tag-remove">×</button>
                              </span>
                            )).reverse()}
                          </div>
                        )}
                        <div className="category-dropdown-container">
                          <button
                            onClick={() => toggleCategoryDropdown(expense.id)}
                            className="category-button"
                          >
                            <span className="category-button-desktop-label">Category ➕</span>
                            <span className="category-button-mobile-label">+ Category</span>
                          </button>
                          {categoryDropdown.expenseId === expense.id && categoryDropdown.isOpen && createPortal((
                            <div
                              className="category-picker-overlay"
                              role="presentation"
                              onMouseDown={() => setCategoryDropdown({ expenseId: null, isOpen: false })}
                              onClick={event => event.stopPropagation()}
                            >
                              <div
                                className="dropdown-menu category-dropdown"
                                role="dialog"
                                aria-modal="true"
                                aria-label={`Choose a category for ${expense.description}`}
                                onMouseDown={event => event.stopPropagation()}
                                onClick={event => event.stopPropagation()}
                              >
                                <div className="category-picker-heading">
                                  <div><strong>Choose category</strong><span>{expense.description}</span></div>
                                  <button type="button" aria-label="Close category picker" onClick={() => setCategoryDropdown({ expenseId: null, isOpen: false })}>×</button>
                                </div>
                                <div className="category-dropdown-items">
                                  {visibleCategories.map(cat => {
                                    const categoryName = typeof cat === 'string' ? cat : cat.name;
                                    const categoryColor = typeof cat === 'string' ? '#007bff' : cat.color;
                                    return (
                                      <div key={categoryName} className="category-dropdown-item category-dropdown-row">
                                        <span onClick={event => { event.stopPropagation(); addCategoryToExpense({ ...expense, cardId: card.id }, categoryName); }} className="category-dropdown-label">
                                          {categoryName}
                                        </span>
                                        <div
                                          onClick={event => { event.stopPropagation(); openColorPicker(categoryName); }}
                                          className="category-color-swatch"
                                          style={{ '--category-color': categoryColor }}
                                        ></div>
                                      </div>
                                    );
                                  })}
                                  {!visibleCategories.length && (
                                    <div className="category-filter-empty">{newCategoryInput.trim()
                                      ? <>No matching categories. Press Enter to create “{newCategoryInput.trim()}”.</>
                                      : 'No categories have been created yet.'}</div>
                                  )}
                                </div>
                                <div className="category-dropdown-separator">
                                  <input
                                    type="text"
                                    placeholder="Filter or create a category"
                                    value={newCategoryInput}
                                    onChange={(e) => setNewCategoryInput(e.target.value)}
                                    maxLength={80}
                                    onKeyPress={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleNewCategorySubmit({ ...expense, cardId: card.id });
                                      }
                                    }}
                                    className="form-input category-dropdown-input"
                                    autoFocus
                                  />
                                </div>
                              </div>
                            </div>
                          ), document.body)}
                        </div>
                        {(expense.mainCategory || expense.category)
                          && String(expense.mainCategory || expense.category).toLocaleLowerCase() !== 'uncategorized' && (
                          <button
                            type="button"
                            className={`remember-category-rule${rememberedExpenseIds.has(expense.id) ? ' remembered' : ''}`}
                            disabled={rememberingExpenseId === expense.id || rememberedExpenseIds.has(expense.id)}
                            onClick={() => openMerchantRule(expense)}
                            title="Automatically use this category for future transactions from this merchant"
                          >
                            {rememberingExpenseId === expense.id ? 'Saving…' : rememberedExpenseIds.has(expense.id) ? '✓ Remembered' : 'Remember merchant'}
                          </button>
                        )}
                        <span className="text-black expense-amount">{formatMoney(expense.amount, expense.reportingCurrency)}</span>
                        {expense.split && <small className="expense-split-label" title={`Original purchase ${formatMoney(expense.originalAmount, expense.reportingCurrency)}`}>Your share</small>}
                        <button type="button" className="expense-row-action split" onClick={() => openSplitPurchase(expense)} title="Split purchase">⇄</button>
                        <button
                          type="button"
                          onClick={() => openExpenseEditor(expense, card.id)}
                          className="expense-row-action edit"
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteExpense(expense, card.id)}
                          disabled={deletingExpenseId === expense.id}
                          className="expense-row-action delete"
                          title={expense.source === 'simplefin' ? 'Hide this synchronized expense' : 'Delete expense'}
                          aria-label={`Delete ${expense.description}`}
                        >
                          {deletingExpenseId === expense.id ? '…' : '×'}
                        </button>
                        <div className="expense-mobile-menu-wrap">
                          <button
                            type="button"
                            className="expense-mobile-menu-trigger"
                            aria-label={`More actions for ${expense.description}`}
                            aria-expanded={openExpenseMenuId === expense.id}
                            onClick={() => setOpenExpenseMenuId(current => current === expense.id ? null : expense.id)}
                          >
                            ⋮
                          </button>
                          {openExpenseMenuId === expense.id && (
                            <div className="expense-mobile-menu" role="menu">
                              {(expense.mainCategory || expense.category)
                                && String(expense.mainCategory || expense.category).toLocaleLowerCase() !== 'uncategorized'
                                && !rememberedExpenseIds.has(expense.id) && (
                                <button type="button" role="menuitem" disabled={rememberingExpenseId === expense.id} onClick={() => { setOpenExpenseMenuId(null); openMerchantRule(expense); }}>
                                  Remember merchant
                                </button>
                              )}
                              <button type="button" role="menuitem" onClick={() => { setOpenExpenseMenuId(null); openSplitPurchase(expense); }}>Split purchase</button>
                              <button type="button" role="menuitem" onClick={() => { setOpenExpenseMenuId(null); openExpenseEditor(expense, card.id); }}>Edit expense</button>
                              <button type="button" role="menuitem" className="danger" disabled={deletingExpenseId === expense.id} onClick={() => { setOpenExpenseMenuId(null); deleteExpense(expense, card.id); }}>
                                {expense.source === 'simplefin' ? 'Hide expense' : 'Delete expense'}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
      {categoryRuleError && <p className="category-rule-error" role="alert">{categoryRuleError}</p>}
      {categoryRuleNotice && <p className="category-rule-notice" role="status">{categoryRuleNotice}</p>}

      {purchaseDiagnostics && createPortal(
        <div className="modal-overlay purchase-diagnostics-overlay" role="presentation" onMouseDown={() => setPurchaseDiagnostics(null)}>
          <div className="modal-content purchase-diagnostics-modal" role="dialog" aria-modal="true" aria-labelledby="purchase-diagnostics-title" onMouseDown={event => event.stopPropagation()}>
            <div className="purchase-diagnostics-header">
              <div><span>{showDiagnosticMetadata ? 'Beta · Purchase data inspector' : 'Purchase details'}</span><h2 id="purchase-diagnostics-title">{purchaseDiagnostics.expense.description}</h2><p>{showDiagnosticMetadata ? 'Purchase details, application metadata, and the original SimpleFIN response when available.' : 'Review this purchase and keep private notes for your records.'}</p></div>
              <button type="button" className="modal-close" aria-label="Close purchase details" onClick={() => setPurchaseDiagnostics(null)}>×</button>
            </div>
            {purchaseDiagnostics.loading && <div className="purchase-diagnostics-state">Loading purchase data…</div>}
            {purchaseDiagnostics.error && <div className="purchase-diagnostics-error" role="alert">{purchaseDiagnostics.error}</div>}
            {purchaseDiagnostics.data && <div className="purchase-diagnostics-content">
              <section>
                <h3>Purchase</h3>
                <dl className="purchase-diagnostics-grid">
                  <div><dt>Description</dt><dd>{purchaseDiagnostics.data.purchase.description}</dd></div>
                  <div><dt>Amount</dt><dd>{formatMoney(purchaseDiagnostics.data.purchase.amount, purchaseDiagnostics.data.purchase.reportingCurrency)}</dd></div>
                  <div><dt>Date</dt><dd>{purchaseDiagnostics.data.purchase.date || 'Unavailable'}</dd></div>
                  <div><dt>Primary category</dt><dd>{purchaseDiagnostics.data.purchase.category || 'Uncategorized'}</dd></div>
                </dl>
                <div className="purchase-diagnostics-tags"><strong>Tags</strong><div>{(purchaseDiagnostics.data.purchase.tags || []).map(tag => <span key={tag}>{tag}</span>)}</div></div>
              </section>
              <section className="purchase-notes-section">
                <form onSubmit={savePurchaseNotes}>
                  <div className="purchase-notes-heading"><div><h3>Notes</h3><p>Add context or reminders about this purchase.</p></div><small>{purchaseNotesDraft.length}/2000</small></div>
                  <textarea value={purchaseNotesDraft} onChange={event => { setPurchaseNotesDraft(event.target.value); setPurchaseNotesSaved(false); }} maxLength={2000} rows={4} placeholder="Add a private note…" aria-label="Purchase notes" />
                  <div className="purchase-notes-actions">
                    <span>{purchaseNotesError ? <b role="alert">{purchaseNotesError}</b> : purchaseNotesSaved ? <em role="status">Notes saved</em> : null}</span>
                    <button type="submit" disabled={savingPurchaseNotes}>{savingPurchaseNotes ? 'Saving…' : 'Save notes'}</button>
                  </div>
                </form>
              </section>
              <section className="purchase-notes-section">
                <form onSubmit={event => { event.preventDefault(); savePurchaseReminder(); }}>
                  <h3>Purchase reminder</h3>
                  <p>Check back for a refund, return, or anything else. The reminder will appear in your notifications.</p>
                  <label>Remind me on <input type="datetime-local" value={reminderDraft} onChange={event => setReminderDraft(event.target.value)} required /></label>
                  <p><small>Times use your local time zone. Add details in the purchase notes above.</small></p>
                  {purchaseDiagnostics.data.purchase.reminder && <p role="status">{purchaseDiagnostics.data.purchase.reminder.deliveredAt ? 'Reminder delivered' : 'Reminder set'} for {new Date(purchaseDiagnostics.data.purchase.reminder.dueAt).toLocaleString()}.</p>}
                  <div className="purchase-notes-actions">
                    <span>{reminderError && <b role="alert">{reminderError}</b>}</span>
                    {purchaseDiagnostics.data.purchase.reminder && <button type="button" disabled={savingReminder} onClick={() => savePurchaseReminder(true)}>Remove reminder</button>}
                    <button type="submit" disabled={savingReminder}>{savingReminder ? 'Saving…' : purchaseDiagnostics.data.purchase.reminder ? 'Update reminder' : 'Set reminder'}</button>
                  </div>
                </form>
              </section>
              {showDiagnosticMetadata && <section>
                <h3>Application metadata</h3>
                <pre>{JSON.stringify(purchaseDiagnostics.data.purchase.metadata, null, 2)}</pre>
              </section>}
              {showDiagnosticMetadata && <section>
                <h3>SimpleFIN data</h3>
                {purchaseDiagnostics.data.simplefin ? <>
                  <h4>Normalized transaction</h4><pre>{JSON.stringify(purchaseDiagnostics.data.simplefin.transaction, null, 2)}</pre>
                  <h4>Linked provider account</h4><pre>{JSON.stringify(purchaseDiagnostics.data.simplefin.account, null, 2)}</pre>
                  <h4>Original provider payload</h4><pre>{JSON.stringify(purchaseDiagnostics.data.simplefin.providerPayload, null, 2)}</pre>
                </> : <p className="purchase-diagnostics-empty">This is a manual purchase, so there is no SimpleFIN payload.</p>}
              </section>}
            </div>}
          </div>
        </div>, document.body
      )}

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
      {iconDraft && createPortal(<div className="modal-overlay" onMouseDown={() => setIconDraft(null)}><form className="modal-content" onSubmit={submitIconSuggestion} onMouseDown={event => event.stopPropagation()}>
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

      <ImportModal
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
      />

      {
        colorPicker.isOpen && (
          <div className="modal-overlay">
            <div className="modal-content">
              <button onClick={() => setColorPicker({ categoryName: null, isOpen: false, color: '#007bff' })} className="btn-close">×</button>
              <h3 className="modal-title">Change Color - {colorPicker.categoryName}</h3>
              <div className="form-group">
                <input
                  type="color"
                  value={colorPicker.color}
                  onChange={(e) => setColorPicker({ ...colorPicker, color: e.target.value })}
                  className="form-input"
                />
              </div>
              <div className="form-actions-center">
                <button onClick={updateCategoryColor} className="btn-success">Update Color</button>
              </div>
            </div>
          </div>
        )
      }
    </div >
  );

  return (
    <div className="page-container text-black monthly-spending-page">
      <h1 className="page-title">Monthly Spending</h1>
      {renderBreadcrumb()}

      {currentView === 'years' && renderYearsView()}
      {currentView === 'months' && renderMonthsView()}
      {currentView === 'spending' && renderSpendingView()}
    </div>
  );
}
