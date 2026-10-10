import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from '../util/AccountContext';
import { useAuth } from '../util/AuthContext';
import { api } from '../util/api';
import { useTheme } from '../util/ThemeContext';
import { useUpcomingEvents } from '../util/useUpcomingEvents';
import { ArrowLeft, ChevronDown, History, Link2, Unlink, X } from 'lucide-react';

export default function SettingsPage() {
  const navigate = useNavigate();
  const { account } = useAccount();
  const upcomingEvents = useUpcomingEvents(account?.id);
  const [removingReminderId, setRemovingReminderId] = useState(null);
  const [reminderRemovalError, setReminderRemovalError] = useState('');
  const removeUpcomingReminder = async expenseId => {
    setRemovingReminderId(expenseId);
    setReminderRemovalError('');
    try { await upcomingEvents.removeReminder(expenseId); }
    catch (error) { setReminderRemovalError(error.message || 'Unable to remove this reminder.'); }
    finally { setRemovingReminderId(null); }
  };
  const { user, setUser, logout } = useAuth();
  const { isDarkMode, toggleTheme, colorTheme, setColorTheme } = useTheme();

  // Profile name
  const [profileName, setProfileName]   = useState(account?.name || '');
  const [profileMsg, setProfileMsg]     = useState(null);

  // Email change
  const [newEmail, setNewEmail]             = useState('');
  const [emailPassword, setEmailPassword]   = useState('');
  const [emailMsg, setEmailMsg]             = useState(null);
  const [emailLoading, setEmailLoading]     = useState(false);
  const [emailStep, setEmailStep]           = useState('request');
  const [emailOtp, setEmailOtp]             = useState('');

  // Password change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword]         = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMsg, setPasswordMsg]         = useState(null);
  const [passwordLoading, setPasswordLoading] = useState(false);

  // MFA
  const [mfaEnabled, setMfaEnabled]   = useState(false);
  const [mfaStep, setMfaStep]         = useState('idle'); // 'idle' | 'pending_otp'
  const [mfaOtp, setMfaOtp]           = useState('');
  const [mfaMsg, setMfaMsg]           = useState(null);
  const [mfaLoading, setMfaLoading]   = useState(false);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const [revokingAllSessions, setRevokingAllSessions] = useState(false);

  // SimpleFIN
  const [simplefinConnections, setSimplefinConnections] = useState([]);
  const [simplefinAccounts, setSimplefinAccounts] = useState([]);
  const [simplefinToken, setSimplefinToken] = useState('');
  const [simplefinLoading, setSimplefinLoading] = useState(true);
  const [simplefinConnecting, setSimplefinConnecting] = useState(false);
  const [simplefinRetrying, setSimplefinRetrying] = useState(null);
  const [simplefinMsg, setSimplefinMsg] = useState(null);
  const [simplefinWizardOpen, setSimplefinWizardOpen] = useState(false);
  const [manualAccounts, setManualAccounts] = useState([]);
  const [linkSelections, setLinkSelections] = useState({});
  const [linkingAccountId, setLinkingAccountId] = useState(null);
  const [createAccountTargetId, setCreateAccountTargetId] = useState(null);
  const [newAccountType, setNewAccountType] = useState('');
  const [creatingManualAccountId, setCreatingManualAccountId] = useState(null);
  const [unlinkingAccountId, setUnlinkingAccountId] = useState(null);
  const [simplefinDuplicates, setSimplefinDuplicates] = useState([]);
  const [resolvingDuplicateId, setResolvingDuplicateId] = useState(null);
  const [updatingAutoSyncId, setUpdatingAutoSyncId] = useState(null);
  const [disconnectConfirmId, setDisconnectConfirmId] = useState(null);
  const [disconnectingId, setDisconnectingId] = useState(null);
  const [reconnectTokens, setReconnectTokens] = useState({});
  const [reconnectingId, setReconnectingId] = useState(null);
  const [simplefinRuns, setSimplefinRuns] = useState([]);
  const [expandedAuditIds, setExpandedAuditIds] = useState([]);
  const [deleteConnectionId, setDeleteConnectionId] = useState(null);
  const [deleteConnectionConfirmation, setDeleteConnectionConfirmation] = useState('');
  const [deletingConnectionId, setDeletingConnectionId] = useState(null);
  const [activeSettingsPanel, setActiveSettingsPanel] = useState(null);
  const [importRangePresets, setImportRangePresets] = useState({});
  const [customImportDates, setCustomImportDates] = useState({});
  const [linkedImportDates, setLinkedImportDates] = useState({});
  const [savingImportRangeId, setSavingImportRangeId] = useState(null);
  const [classificationReviews, setClassificationReviews] = useState([]);
  const [resolvingClassificationId, setResolvingClassificationId] = useState(null);
  const [categoryRules, setCategoryRules] = useState([]);
  const [deletingCategoryRuleId, setDeletingCategoryRuleId] = useState(null);
  const [editingCategoryRule, setEditingCategoryRule] = useState(null);
  const [savingCategoryRuleId, setSavingCategoryRuleId] = useState(null);
  const [reportingCurrency, setReportingCurrency] = useState('USD');
  const [financialProfile, setFinancialProfile] = useState(null);
  const [financialForm, setFinancialForm] = useState({ yearlyIncome: '', percentToSave: 0, percentToContribute: 0 });
  const [financialMessage, setFinancialMessage] = useState(null);
  const [savingFinancialProfile, setSavingFinancialProfile] = useState(false);
  const [fxStatus, setFxStatus] = useState({ currencies: ['USD'], rateDate: null, source: 'European Central Bank' });
  const [savingCurrency, setSavingCurrency] = useState(false);
  const [splitPeople, setSplitPeople] = useState([]);
  const [splitPersonName, setSplitPersonName] = useState('');
  const [splitPeopleMessage, setSplitPeopleMessage] = useState(null);
  const [travelPlans, setTravelPlans] = useState([]);
  const [travelDraft, setTravelDraft] = useState({ id: null, name: '', startDate: '', endDate: '' });
  const [travelMessage, setTravelMessage] = useState(null);
  const [savingTravelPlan, setSavingTravelPlan] = useState(false);
  const [travelCategories, setTravelCategories] = useState([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryMessage, setCategoryMessage] = useState(null);
  const [deletingCategoryId, setDeletingCategoryId] = useState(null);
  const [travelExcludedCategoryIds, setTravelExcludedCategoryIds] = useState([]);
  const [savingTravelPreferences, setSavingTravelPreferences] = useState(false);

  useEffect(() => {
    api.getMfaStatus().then(res => setMfaEnabled(res.mfaEnabled)).catch(() => {});
    Promise.all([api.getFinancialProfile(), api.getFxStatus()]).then(([profile, status]) => {
      setFinancialProfile(profile);
      setFinancialForm({
        yearlyIncome: String(profile.yearlyIncome || ''),
        percentToSave: profile.percentToSave || 0,
        percentToContribute: profile.percentToContribute || 0,
      });
      setReportingCurrency(profile.reportingCurrency || 'USD');
      setFxStatus(status);
    }).catch(() => {});
    if (user?.role !== 'admin') {
      api.getSplitPeople().then(setSplitPeople).catch(() => {});
      Promise.all([api.getTravelPlans(), api.getTravelPreferences(), api.getCategories()]).then(([plans, preferences, categoryList]) => {
        setTravelPlans(plans);
        setTravelExcludedCategoryIds(preferences.excludedCategoryIds || []);
        setTravelCategories(categoryList || []);
      }).catch(() => {});
    }
  // Settings bootstrap is repeated only when the page remounts for a new session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveTravelPlan = async (event) => {
    event.preventDefault(); setTravelMessage(null); setSavingTravelPlan(true);
    try {
      const payload = { name: travelDraft.name, startDate: travelDraft.startDate, endDate: travelDraft.endDate };
      const result = travelDraft.id ? await api.updateTravelPlan(travelDraft.id, payload) : await api.addTravelPlan(payload);
      setTravelPlans(current => [...current.filter(plan => plan.id !== result.plan.id), result.plan].sort((a, b) => b.startDate.localeCompare(a.startDate)));
      setTravelDraft({ id: null, name: '', startDate: '', endDate: '' });
      setTravelMessage({ type: 'success', text: `${result.plan.name} saved. ${result.taggedExpenses} expense${result.taggedExpenses === 1 ? '' : 's'} updated.` });
    } catch (error) { setTravelMessage({ type: 'error', text: error.message }); }
    finally { setSavingTravelPlan(false); }
  };

  const deleteTravelPlan = async (plan) => {
    setTravelMessage(null);
    try {
      await api.deleteTravelPlan(plan.id);
      setTravelPlans(current => current.filter(item => item.id !== plan.id));
      if (travelDraft.id === plan.id) setTravelDraft({ id: null, name: '', startDate: '', endDate: '' });
      setTravelMessage({ type: 'success', text: `${plan.name} removed from travel plans and its derived expense tags.` });
    } catch (error) { setTravelMessage({ type: 'error', text: error.message }); }
  };

  const saveTravelPreferences = async () => {
    setTravelMessage(null); setSavingTravelPreferences(true);
    try {
      const result = await api.updateTravelPreferences(travelExcludedCategoryIds);
      setTravelExcludedCategoryIds(result.excludedCategoryIds || []);
      setTravelMessage({ type: 'success', text: `Travel exclusions saved. ${result.taggedExpenses} expense${result.taggedExpenses === 1 ? '' : 's'} updated.` });
    } catch (error) { setTravelMessage({ type: 'error', text: error.message }); }
    finally { setSavingTravelPreferences(false); }
  };

  const addSplitPerson = async (event) => {
    event.preventDefault(); setSplitPeopleMessage(null);
    try { const person = await api.addSplitPerson(splitPersonName); setSplitPeople(current => [...current, person].sort((a, b) => a.name.localeCompare(b.name))); setSplitPersonName(''); }
    catch (error) { setSplitPeopleMessage({ type: 'error', text: error.message }); }
  };

  const deleteSplitPerson = async (person) => {
    setSplitPeopleMessage(null);
    try { await api.deleteSplitPerson(person.id); setSplitPeople(current => current.filter(item => item.id !== person.id)); }
    catch (error) { setSplitPeopleMessage({ type: 'error', text: error.message }); }
  };

  const loadSimplefin = async () => {
    if (user?.role === 'admin') return;
    try {
      const [connectionResult, accountResult, duplicateResult, reviewResult, runResult, ruleResult, cards, banks, trading] = await Promise.all([
        api.getSimplefinConnections(),
        api.getSimplefinAccounts(),
        api.getSimplefinDuplicates(),
        api.getSimplefinClassificationReviews(),
        api.getSimplefinSyncRuns(),
        api.getCategoryRules(),
        api.getCreditCards(),
        api.getBankAccounts(),
        api.getTradingAccounts(),
      ]);
      setSimplefinConnections(connectionResult.connections || []);
      setSimplefinAccounts(accountResult.accounts || []);
      setLinkedImportDates(current => Object.fromEntries((accountResult.accounts || [])
        .filter(row => row.link)
        .map(row => [row.id, current[row.id] || row.link.transactionImportFrom || isoDateOffset(0)])));
      setSimplefinDuplicates(duplicateResult.duplicates || []);
      setClassificationReviews(reviewResult.reviews || []);
      setSimplefinRuns(runResult.runs || []);
      setCategoryRules(ruleResult || []);
      setManualAccounts([
        ...(cards || []).filter(row => row.isActive !== false).map(row => ({
          type: 'credit_card', id: String(row.id), name: row.nickname || row.name || 'Credit card',
          kind: 'Credit card', institution: row.institution || row.simplefin?.institutionName,
          balance: row.simplefin?.balance, currency: row.simplefin?.currency || 'USD',
        })),
        ...(banks || []).filter(row => row.isActive !== false).map(row => ({
          type: 'bank', id: String(row.id), name: row.bankName || row.name || 'Bank account',
          kind: 'Bank account', institution: row.institution || row.simplefin?.institutionName,
          balance: row.balance, currency: row.simplefin?.currency || 'USD',
        })),
        ...(trading || []).filter(row => row.isActive !== false).map(row => ({
          type: 'trading', id: String(row.id), name: row.brokerName || row.name || 'Trading account',
          kind: 'Trading account', institution: row.institution || row.simplefin?.institutionName,
          balance: row.balance, currency: row.simplefin?.currency || 'USD',
        })),
      ]);
    } catch (err) {
      setSimplefinMsg({ type: 'error', text: err.message || 'Unable to load SimpleFIN status.' });
    } finally {
      setSimplefinLoading(false);
    }
  };

  useEffect(() => {
    loadSimplefin();
  // The signed-in role determines whether this user has financial settings.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  if (!account) {
    return (
      <div className="no-account-message">
        <h2>No Account Selected</h2>
        <p>Please go back and select a profile to continue.</p>
      </div>
    );
  }

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    setProfileMsg(null);
    if (profileName.trim().length > 50) {
      setProfileMsg({ type: 'error', text: 'Display name must be 50 characters or fewer.' });
      return;
    }
    try {
      await api.updateAccount(account.id, { name: profileName.trim() });
      setProfileMsg({ type: 'success', text: 'Profile name updated.' });
    } catch (err) {
      setProfileMsg({ type: 'error', text: err.message || 'Failed to update profile.' });
    }
  };

  const handleChangeEmail = async (e) => {
    e.preventDefault();
    setEmailMsg(null);

    if (!newEmail.trim()) {
      setEmailMsg({ type: 'error', text: 'Please enter a new email address.' });
      return;
    }
    if (newEmail.trim().toLowerCase() === user?.email?.toLowerCase()) {
      setEmailMsg({ type: 'error', text: 'New email is the same as your current email.' });
      return;
    }

    setEmailLoading(true);
    try {
      await api.changeEmail(newEmail.trim(), emailPassword);
      setEmailStep('verify');
      setEmailMsg({ type: 'success', text: `A verification code was sent to ${newEmail.trim()}.` });
      setEmailPassword('');
    } catch (err) {
      setEmailMsg({ type: 'error', text: err.message || 'Failed to update email.' });
    } finally {
      setEmailLoading(false);
    }
  };

  const handleVerifyEmailChange = async (e) => {
    e.preventDefault();
    setEmailLoading(true);
    setEmailMsg(null);
    try {
      const result = await api.verifyEmailChange(emailOtp);
      setUser(u => ({ ...u, email: result.email }));
      setEmailMsg({ type: 'success', text: 'Email updated successfully. Other sessions and trusted devices were signed out.' });
      setNewEmail('');
      setEmailOtp('');
      setEmailStep('request');
    } catch (err) {
      setEmailMsg({ type: 'error', text: err.message || 'Failed to verify email.' });
    } finally {
      setEmailLoading(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordMsg(null);

    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: 'error', text: 'New passwords do not match.' });
      return;
    }
    if (newPassword.length < 8) {
      setPasswordMsg({ type: 'error', text: 'New password must be at least 8 characters.' });
      return;
    }

    setPasswordLoading(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setPasswordMsg({ type: 'success', text: 'Password updated successfully.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      const text = err.status === 401
        ? 'Current password is incorrect.'
        : err.message || 'Failed to update password.';
      setPasswordMsg({ type: 'error', text });
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleMfaToggleOn = async () => {
    setMfaMsg(null);
    try {
      await api.sendMfaCode();
      setMfaStep('pending_otp');
    } catch (err) {
      setMfaMsg({ type: 'error', text: err.message });
    }
  };

  const handleMfaConfirm = async () => {
    setMfaMsg(null);
    setMfaLoading(true);
    try {
      await api.toggleMfa(true, mfaOtp);
      setMfaEnabled(true);
      setMfaStep('idle');
      setMfaOtp('');
      setMfaMsg({ type: 'success', text: 'Two-factor authentication enabled.' });
      setTimeout(() => setMfaMsg(null), 3000);
    } catch (err) {
      setMfaMsg({ type: 'error', text: err.message });
    } finally {
      setMfaLoading(false);
    }
  };

  const handleMfaToggleOff = async () => {
    setMfaMsg(null);
    try {
      await api.toggleMfa(false);
      setMfaEnabled(false);
      setMfaStep('idle');
      setMfaOtp('');
      setMfaMsg({ type: 'success', text: 'Two-factor authentication disabled.' });
    } catch (err) {
      setMfaMsg({ type: 'error', text: err.message });
    }
  };

  const handleDeleteAccount = async () => {
    if (api?.deleteAccount) {
      await api.deleteAccount(account.id);
      navigate('/');
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    setSignOutError('');
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch (err) {
      setSignOutError(err.message || 'Unable to sign out. Please try again.');
      setSigningOut(false);
    }
  };

  const handleRevokeAllSessions = async () => {
    if (!window.confirm('Remove every trusted device and sign out every active session, including this one?')) return;
    setRevokingAllSessions(true);
    setSignOutError('');
    try {
      await api.revokeAllSessions();
      setUser(null);
      navigate('/login', { replace: true });
    } catch (err) {
      setSignOutError(err.message || 'Unable to revoke sessions. Please try again.');
      setRevokingAllSessions(false);
    }
  };

  const handleSimplefinConnect = async (event) => {
    event.preventDefault();
    if (!simplefinToken.trim()) {
      setSimplefinMsg({ type: 'error', text: 'Paste your SimpleFIN setup token first.' });
      return;
    }

    setSimplefinConnecting(true);
    setSimplefinMsg(null);
    try {
      const result = await api.connectSimplefin(simplefinToken.trim());
      setSimplefinToken('');
      setSimplefinMsg({
        type: result.warnings?.length ? 'warning' : 'success',
        text: `Connected successfully. Found ${result.accountsDiscovered ?? 0} account${result.accountsDiscovered === 1 ? '' : 's'}.`,
      });
      await loadSimplefin();
    } catch (err) {
      // A setup token is single-use. If the server safely stored the claimed
      // credential before discovery failed, clear it from browser memory.
      if (err.data?.connection) {
        setSimplefinToken('');
        await loadSimplefin();
      }
      setSimplefinMsg({ type: 'error', text: err.message || 'Unable to connect SimpleFIN.' });
    } finally {
      setSimplefinConnecting(false);
    }
  };

  const handleSimplefinDiscovery = async (connectionId) => {
    setSimplefinRetrying(connectionId);
    setSimplefinMsg(null);
    try {
      const result = await api.syncSimplefin(connectionId);
      setSimplefinMsg({
        type: result.warnings?.length ? 'warning' : 'success',
        text: `Sync complete. ${result.transactionsInserted ?? 0} new transaction${result.transactionsInserted === 1 ? '' : 's'} staged, ${result.expensesMaterialized ?? 0} expense${result.expensesMaterialized === 1 ? '' : 's'} imported${result.duplicateCandidates ? `, and ${result.duplicateCandidates} possible duplicate${result.duplicateCandidates === 1 ? '' : 's'} need review` : ''}.`,
      });
      await loadSimplefin();
    } catch (err) {
      const retryTime = err.data?.nextSyncAllowedAt
        ? ` Next available: ${formatSimplefinDate(err.data.nextSyncAllowedAt)}.` : '';
      setSimplefinMsg({ type: 'error', text: `${err.message || 'Discovery failed.'}${retryTime}` });
      await loadSimplefin();
    } finally {
      setSimplefinRetrying(null);
    }
  };

  const handleSimplefinLink = async (simplefinAccountId) => {
    const key = linkSelections[simplefinAccountId];
    const manualAccount = manualAccounts.find(row => `${row.type}:${row.id}` === key);
    if (!manualAccount) {
      setSimplefinMsg({ type: 'error', text: 'Choose a manual account to link.' });
      return;
    }
    setLinkingAccountId(simplefinAccountId);
    setSimplefinMsg(null);
    try {
      const importFrom = importDateForPreset(importRangePresets[simplefinAccountId] || 'today', customImportDates[simplefinAccountId]);
      if (!importFrom) {
        setSimplefinMsg({ type: 'error', text: 'Choose a valid custom import date.' });
        setLinkingAccountId(null);
        return;
      }
      await api.linkSimplefinAccount(simplefinAccountId, { type: manualAccount.type, id: manualAccount.id }, importFrom);
      setLinkSelections(current => {
        const next = { ...current };
        delete next[simplefinAccountId];
        return next;
      });
      setSimplefinMsg({ type: 'success', text: `${manualAccount.name} is now linked.` });
      await loadSimplefin();
    } catch (err) {
      setSimplefinMsg({ type: 'error', text: err.message || 'Unable to link these accounts.' });
      await loadSimplefin();
    } finally {
      setLinkingAccountId(null);
    }
  };

  const handleCreateAndLinkAccount = async (accountRow) => {
    if (!newAccountType) {
      setSimplefinMsg({ type: 'error', text: 'Choose the type of manual account to create.' });
      return;
    }
    const importFrom = importDateForPreset(importRangePresets[accountRow.id] || 'today', customImportDates[accountRow.id]);
    if (!importFrom) {
      setSimplefinMsg({ type: 'error', text: 'Choose a valid custom import date.' });
      return;
    }
    setCreatingManualAccountId(accountRow.id);
    setSimplefinMsg(null);
    try {
      const result = await api.createAndLinkSimplefinAccount(accountRow.id, newAccountType, importFrom);
      setCreateAccountTargetId(null);
      setNewAccountType('');
      setSimplefinMsg({ type: 'success', text: `${result.account.name} was created and linked.` });
      await loadSimplefin();
    } catch (err) {
      setSimplefinMsg({ type: 'error', text: err.message || 'Unable to create and link this account.' });
      await loadSimplefin();
    } finally {
      setCreatingManualAccountId(null);
    }
  };

  const handleImportRangeUpdate = async (accountRow) => {
    const importFrom = linkedImportDates[accountRow.id];
    setSavingImportRangeId(accountRow.id);
    setSimplefinMsg(null);
    try {
      const result = await api.setSimplefinImportRange(accountRow.id, importFrom);
      setSimplefinMsg({
        type: 'success',
        text: result.backfillRequested
          ? 'Import start date moved earlier. Use Sync now to backfill the additional history.'
          : 'Import start date updated. Future syncs will use this range.',
      });
      await loadSimplefin();
    } catch (err) {
      setSimplefinMsg({ type: 'error', text: err.message || 'Unable to update the import range.' });
    } finally {
      setSavingImportRangeId(null);
    }
  };

  const handleClassificationResolution = async (review, classification) => {
    setResolvingClassificationId(review.id);
    setSimplefinMsg(null);
    try {
      await api.resolveSimplefinClassification(review.id, classification);
      setSimplefinMsg({ type: 'success', text: `Transaction classified as ${classificationLabel(classification).toLowerCase()}.` });
      await loadSimplefin();
    } catch (err) {
      setSimplefinMsg({ type: 'error', text: err.message || 'Unable to classify this transaction.' });
    } finally {
      setResolvingClassificationId(null);
    }
  };

  const handleDeleteCategoryRule = async (rule) => {
    setDeletingCategoryRuleId(rule.id);
    try {
      await api.deleteCategoryRule(rule.id);
      setCategoryRules(current => current.filter(item => item.id !== rule.id));
    } catch (err) {
      setSimplefinMsg({ type: 'error', text: err.message || 'Unable to delete this category rule.' });
    } finally {
      setDeletingCategoryRuleId(null);
    }
  };

  const addCustomCategory = async (event) => {
    event.preventDefault();
    setCategoryMessage(null);
    try {
      const categoryList = await api.addCategory(newCategoryName);
      setTravelCategories(categoryList || []);
      setNewCategoryName('');
      setCategoryMessage({ type: 'success', text: 'Category added.' });
    } catch (error) { setCategoryMessage({ type: 'error', text: error.message }); }
  };

  const deleteCustomCategory = async (category) => {
    if (!window.confirm(`Remove “${category.name}”? This also removes it from your purchases and categorization rules.`)) return;
    setDeletingCategoryId(category.id); setCategoryMessage(null);
    try {
      const result = await api.deleteCategory(category.name);
      setTravelCategories(result.categories || []);
      const rules = await api.getCategoryRules();
      setCategoryRules(rules || []);
      setTravelExcludedCategoryIds(current => current.filter(id => id !== category.id));
      setCategoryMessage({ type: 'success', text: `${category.name} was removed from your categories and purchases.` });
    } catch (error) { setCategoryMessage({ type: 'error', text: error.message }); }
    finally { setDeletingCategoryId(null); }
  };

  const handleUpdateCategoryRule = async (event) => {
    event.preventDefault();
    if (!editingCategoryRule) return;
    setSavingCategoryRuleId(editingCategoryRule.id);
    setSimplefinMsg(null);
    try {
      const result = await api.updateCategoryRule(
        editingCategoryRule.id,
        editingCategoryRule.merchant,
        editingCategoryRule.effectiveFrom,
        editingCategoryRule.category.name,
      );
      setCategoryRules(current => current.map(rule => rule.id === result.rule.id ? result.rule : rule));
      setEditingCategoryRule(null);
      setSimplefinMsg({ type: 'success', text: `Categorization rule updated and applied to ${result.appliedCount || 0} matching transaction${result.appliedCount === 1 ? '' : 's'}.` });
    } catch (err) {
      setSimplefinMsg({ type: 'error', text: err.message || 'Unable to update this category rule.' });
    } finally {
      setSavingCategoryRuleId(null);
    }
  };

  const handleReportingCurrency = async (currency) => {
    setReportingCurrency(currency);
    setSavingCurrency(true);
    try {
      await api.updateFinancialProfile(account.id, { reportingCurrency: currency });
    } catch (err) {
      setSimplefinMsg({ type: 'error', text: err.message || 'Unable to update reporting currency.' });
    } finally {
      setSavingCurrency(false);
    }
  };

  const handleFinancialProfile = async (event) => {
    event.preventDefault();
    const yearlyIncome = Number(financialForm.yearlyIncome);
    const percentToSave = Number(financialForm.percentToSave);
    const percentToContribute = Number(financialForm.percentToContribute);
    if (!Number.isFinite(yearlyIncome) || yearlyIncome < 0) {
      setFinancialMessage({ type: 'error', text: 'Yearly income must be a valid non-negative amount.' });
      return;
    }

    setSavingFinancialProfile(true);
    setFinancialMessage(null);
    try {
      const yearlyIncomeAfterContributions = yearlyIncome * (1 - (percentToContribute / 100));
      const yearlyIncomeAfterTax = federalIncomeAfterTax(yearlyIncomeAfterContributions);
      const monthlySavingTarget = yearlyIncomeAfterTax * (percentToSave / 100) / 12;
      const updated = await api.updateFinancialProfile(account.id, {
        yearlyIncome,
        monthlyIncome: yearlyIncomeAfterContributions / 12,
        percentToSave,
        percentToContribute,
        yearlyIncomeAfterTax,
        monthlySavingTarget,
        monthlySpendLimit: (yearlyIncomeAfterTax / 12) - monthlySavingTarget,
        budgetCategories: financialProfile?.budgetCategories || [],
        reportingCurrency: financialProfile?.reportingCurrency || reportingCurrency,
      });
      setFinancialProfile(updated?.profile || updated || { ...financialProfile, yearlyIncome, percentToSave, percentToContribute });
      setFinancialMessage({ type: 'success', text: 'Financial profile updated.' });
    } catch (error) {
      setFinancialMessage({ type: 'error', text: error.message || 'Unable to update your financial profile.' });
    } finally {
      setSavingFinancialProfile(false);
    }
  };

  const handleSimplefinUnlink = async (accountRow) => {
    setUnlinkingAccountId(accountRow.id);
    setSimplefinMsg(null);
    try {
      await api.unlinkSimplefinAccount(accountRow.id);
      setSimplefinMsg({ type: 'success', text: `${accountRow.remoteName} was unlinked and is available in the linking wizard again.` });
      await loadSimplefin();
    } catch (err) {
      setSimplefinMsg({ type: 'error', text: err.message || 'Unable to unlink this account.' });
    } finally {
      setUnlinkingAccountId(null);
    }
  };

  const handleDuplicateResolution = async (candidate, action) => {
    setResolvingDuplicateId(candidate.id);
    setSimplefinMsg(null);
    try {
      await api.resolveSimplefinDuplicate(candidate.id, action);
      setSimplefinMsg({
        type: 'success',
        text: action === 'keep_manual'
          ? 'The existing manual expense was kept and associated with the provider transaction.'
          : 'The SimpleFIN transaction was imported as a separate expense.',
      });
      await loadSimplefin();
    } catch (err) {
      setSimplefinMsg({ type: 'error', text: err.message || 'Unable to resolve this duplicate.' });
      await loadSimplefin();
    } finally {
      setResolvingDuplicateId(null);
    }
  };

  const handleAutoSyncToggle = async (connection, enabled) => {
    setUpdatingAutoSyncId(connection.id);
    setSimplefinMsg(null);
    try {
      await api.setSimplefinAutoSync(connection.id, enabled);
      setSimplefinMsg({ type: 'success', text: `Automatic sync ${enabled ? 'enabled' : 'paused'}.` });
      await loadSimplefin();
    } catch (err) {
      setSimplefinMsg({ type: 'error', text: err.message || 'Unable to update automatic sync.' });
    } finally {
      setUpdatingAutoSyncId(null);
    }
  };

  const handleSimplefinDisconnect = async (connection) => {
    setDisconnectingId(connection.id);
    setSimplefinMsg(null);
    try {
      await api.disconnectSimplefin(connection.id);
      setDisconnectConfirmId(null);
      setSimplefinMsg({
        type: 'success',
        text: 'SimpleFIN disconnected. Local accounts and imported history were preserved. Revoke the old token in SimpleFIN Bridge as well.',
      });
      await loadSimplefin();
    } catch (err) {
      setSimplefinMsg({ type: 'error', text: err.message || 'Unable to disconnect SimpleFIN.' });
    } finally {
      setDisconnectingId(null);
    }
  };

  const handleSimplefinReconnect = async (connection) => {
    const setupToken = reconnectTokens[connection.id]?.trim();
    if (!setupToken) {
      setSimplefinMsg({ type: 'error', text: 'Paste a new SimpleFIN setup token first.' });
      return;
    }
    setReconnectingId(connection.id);
    setSimplefinMsg(null);
    try {
      const result = await api.reconnectSimplefin(connection.id, setupToken);
      setReconnectTokens(current => ({ ...current, [connection.id]: '' }));
      setSimplefinMsg({
        type: result.warnings?.length ? 'warning' : 'success',
        text: `SimpleFIN reconnected. Found ${result.accountsDiscovered ?? 0} account${result.accountsDiscovered === 1 ? '' : 's'} and preserved matching links.`,
      });
      await loadSimplefin();
    } catch (err) {
      if (err.data?.connection) setReconnectTokens(current => ({ ...current, [connection.id]: '' }));
      setSimplefinMsg({ type: 'error', text: err.message || 'Unable to reconnect SimpleFIN.' });
      await loadSimplefin();
    } finally {
      setReconnectingId(null);
    }
  };

  const handleDeleteSimplefinConnection = async (connection) => {
    if (deleteConnectionConfirmation !== 'DELETE') return;
    setDeletingConnectionId(connection.id);
    setSimplefinMsg(null);
    try {
      const result = await api.deleteSimplefinConnectionData(connection.id, deleteConnectionConfirmation);
      const counts = result.counts || {};
      setDeleteConnectionId(null);
      setDeleteConnectionConfirmation('');
      setExpandedAuditIds(current => current.filter(id => id !== connection.id));
      setSimplefinMsg({
        type: 'success',
        text: `Connection permanently deleted with ${counts.accounts || 0} account${counts.accounts === 1 ? '' : 's'}, ${counts.transactions || 0} transaction${counts.transactions === 1 ? '' : 's'}, and ${counts.importedExpenses || 0} imported expense${counts.importedExpenses === 1 ? '' : 's'}.`,
      });
      await loadSimplefin();
    } catch (err) {
      setSimplefinMsg({ type: 'error', text: err.message || 'Unable to permanently delete this connection.' });
    } finally {
      setDeletingConnectionId(null);
    }
  };

  return (
    <div className="page-container">
      <h1 className="page-title">Settings</h1>

      <div className={`settings-workspace${activeSettingsPanel ? ' showing-detail' : ''}`}>
        <div className="settings-workspace-slider">
          <section className="settings-hub" aria-hidden={Boolean(activeSettingsPanel)}>
            <div className="settings-hub-heading">
              <span>Account preferences</span>
              <h2>What would you like to manage?</h2>
              <p>Choose a setting to open its controls.</p>
            </div>
            <div className="settings-hub-grid">
              <SettingsMenuCard icon="👤" title="Profile name" detail={account?.name || 'Set your display name'} onClick={() => setActiveSettingsPanel('profile')} />
              <SettingsMenuCard icon="🔔" title="Upcoming events" detail={`${upcomingEvents.events.length} purchase reminder${upcomingEvents.events.length === 1 ? '' : 's'}`} onClick={() => setActiveSettingsPanel('upcoming')} />
              {user?.role !== 'admin' && <SettingsMenuCard icon="💼" title="Financial profile" detail={financialProfile?.yearlyIncome ? `$${Number(financialProfile.yearlyIncome).toLocaleString()} yearly income` : 'Set income and savings targets'} onClick={() => setActiveSettingsPanel('financial')} />}
              <SettingsMenuCard icon="✉️" title="Email address" detail={user?.email || 'Manage your sign-in email'} onClick={() => setActiveSettingsPanel('email')} />
              <SettingsMenuCard icon="🔒" title="Password" detail="Update your account password" onClick={() => setActiveSettingsPanel('password')} />
              <SettingsMenuCard icon="🔐" title="Two-factor authentication" detail={mfaEnabled ? 'Enabled' : 'Not enabled'} tone={mfaEnabled ? 'success' : ''} onClick={() => setActiveSettingsPanel('security')} />
              <SettingsMenuCard icon="◐" title="Appearance" detail={`${colorTheme[0].toUpperCase()}${colorTheme.slice(1)} · ${isDarkMode ? 'Dark' : 'Light'}`} onClick={() => setActiveSettingsPanel('appearance')} />
              {user?.role !== 'admin' && <SettingsMenuCard icon="⌁" title="Categorization rules" detail={categoryRules.length ? `${categoryRules.length} remembered merchant${categoryRules.length === 1 ? '' : 's'}` : 'No remembered merchants yet'} onClick={() => setActiveSettingsPanel('categorization')} />}
              {user?.role !== 'admin' && <SettingsMenuCard icon="👥" title="Split purchases" detail={splitPeople.length ? `${splitPeople.length} people` : 'Add people to split costs with'} onClick={() => setActiveSettingsPanel('splits')} />}
              {user?.role !== 'admin' && <SettingsMenuCard icon="✈️" title="Travel" detail={travelPlans.length ? `${travelPlans.length} planned or past trip${travelPlans.length === 1 ? '' : 's'}` : 'Tag spending by trip dates'} onClick={() => setActiveSettingsPanel('travel')} />}
              {user?.role !== 'admin' && <SettingsMenuCard icon="S" title="SimpleFIN Bridge" detail={simplefinConnections.length ? `${simplefinConnections.length} connection${simplefinConnections.length === 1 ? '' : 's'}` : 'Connect financial institutions'} tone={simplefinConnections.some(row => row.status === 'active') ? 'success' : ''} onClick={() => setActiveSettingsPanel('simplefin')} />}
            </div>
          </section>

          <div className="settings-detail-pane" aria-hidden={!activeSettingsPanel}>
            <div className="settings-detail-toolbar">
              <button type="button" onClick={() => { setActiveSettingsPanel(null); setSimplefinWizardOpen(false); }}><ArrowLeft size={17} /> All settings</button>
              <span>{settingsPanelTitle(activeSettingsPanel)}</span>
            </div>

      {/* Profile Settings */}
      {activeSettingsPanel === 'profile' && <div className="full-width-card settings-focus-card">
        <h2>👤 Profile Settings</h2>
        <form onSubmit={handleUpdateProfile}>
          <div className="form-group">
            <label className="form-label">Display Name:</label>
            <input
              type="text"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              className="form-input"
              maxLength={50}
              required
            />
            <small className="form-character-count">{profileName.length}/50</small>
          </div>
          {profileMsg && (
            <p className={`form-message ${profileMsg.type}`}>
              {profileMsg.text}
            </p>
          )}
          <div className="form-actions">
            <button type="submit" className="btn-primary">Update Name</button>
          </div>
        </form>
      </div>}

      {user?.role !== 'admin' && activeSettingsPanel === 'financial' && <div className="full-width-card settings-focus-card">
        <h2>💼 Financial Profile</h2>
        <p className="settings-panel-description">Set the income and savings assumptions used throughout your dashboard.</p>
        <form onSubmit={handleFinancialProfile}>
          <div className="form-group">
            <label className="form-label" htmlFor="financial-yearly-income">Yearly income</label>
            <input id="financial-yearly-income" type="number" min="0" step="0.01" className="form-input" value={financialForm.yearlyIncome} onChange={event => setFinancialForm(current => ({ ...current, yearlyIncome: event.target.value }))} required />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="financial-save-percent">Percent to save: {financialForm.percentToSave}%</label>
            <input id="financial-save-percent" type="range" min="0" max="100" step="1" className="form-slider" value={financialForm.percentToSave} onChange={event => setFinancialForm(current => ({ ...current, percentToSave: event.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="financial-contribution-percent">Percent to contribute to 401k: {financialForm.percentToContribute}%</label>
            <input id="financial-contribution-percent" type="range" min="0" max="100" step="0.1" className="form-slider" value={financialForm.percentToContribute} onChange={event => setFinancialForm(current => ({ ...current, percentToContribute: event.target.value }))} />
          </div>
          {financialMessage && <p className={`form-message ${financialMessage.type}`}>{financialMessage.text}</p>}
          <div className="form-actions"><button type="submit" className="btn-primary" disabled={savingFinancialProfile}>{savingFinancialProfile ? 'Saving…' : 'Update Financial Profile'}</button></div>
        </form>
      </div>}

      {/* Change Email */}
      {activeSettingsPanel === 'email' && <div className="full-width-card settings-focus-card">
        <h2>✉️ Change Email</h2>
        <p className="settings-panel-description">
          Current email: <strong>{user?.email}</strong>
        </p>
        {emailStep === 'request' ? <form onSubmit={handleChangeEmail}>
          <div className="form-group">
            <label className="form-label">New Email Address:</label>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="form-input"
              autoComplete="email"
              maxLength={254}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Confirm Password:</label>
            <input
              type="password"
              value={emailPassword}
              onChange={(e) => setEmailPassword(e.target.value)}
              className="form-input"
              autoComplete="current-password"
              maxLength={1024}
              required
            />
          </div>
          {emailMsg && (
            <p className={`form-message ${emailMsg.type}`}>
              {emailMsg.text}
            </p>
          )}
          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={emailLoading}>
              {emailLoading ? 'Sending…' : 'Send Verification Code'}
            </button>
          </div>
        </form> : <form onSubmit={handleVerifyEmailChange}>
          <p className="settings-panel-description">
            Enter the six-digit code sent to <strong>{newEmail}</strong>. The code expires in 10 minutes.
          </p>
          <div className="form-group">
            <label className="form-label">Verification Code:</label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={emailOtp}
              onChange={(e) => setEmailOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="form-input"
              autoComplete="one-time-code"
              required
            />
          </div>
          {emailMsg && (
            <p className={`form-message ${emailMsg.type}`}>{emailMsg.text}</p>
          )}
          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={() => { setEmailStep('request'); setEmailOtp(''); setEmailMsg(null); }} disabled={emailLoading}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={emailLoading || emailOtp.length !== 6}>
              {emailLoading ? 'Verifying…' : 'Verify and Change Email'}
            </button>
          </div>
        </form>}
      </div>}

      {/* Change Password */}
      {activeSettingsPanel === 'password' && <div className="full-width-card settings-focus-card">
        <h2>🔒 Change Password</h2>
        <form onSubmit={handleChangePassword}>
          <div className="form-group">
            <label className="form-label">Current Password:</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="form-input"
              autoComplete="current-password"
              maxLength={1024}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">New Password:</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="form-input"
              autoComplete="new-password"
              minLength={8}
              maxLength={72}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Confirm New Password:</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="form-input"
              autoComplete="new-password"
              minLength={8}
              maxLength={72}
              required
            />
          </div>
          {passwordMsg && (
            <p className={`form-message ${passwordMsg.type}`}>
              {passwordMsg.text}
            </p>
          )}
          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={passwordLoading}>
              {passwordLoading ? 'Updating…' : 'Change Password'}
            </button>
          </div>
        </form>
      </div>}

      {/* Security */}
      {activeSettingsPanel === 'security' && <div className="full-width-card settings-focus-card">
        <h2>🔐 Security</h2>
        <p className="settings-panel-description">
          Two-factor authentication adds an extra layer of security to your account.
        </p>

        {mfaStep === 'idle' && (
          <div className="form-group">
            <label className="form-label">
              <input
                type="checkbox"
                checked={mfaEnabled}
                onChange={e => e.target.checked ? handleMfaToggleOn() : handleMfaToggleOff()}
                className="form-checkbox"
              />
              {mfaEnabled ? 'Two-factor authentication is active' : 'Enable two-factor authentication'}
            </label>
          </div>
        )}

        {mfaStep === 'pending_otp' && (
          <div>
            <p className="settings-verification-copy">
              Enter the verification code sent to your email to confirm.
            </p>
            <div className="form-group">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={mfaOtp}
                onChange={e => setMfaOtp(e.target.value.replace(/\D/g, ''))}
                className="form-input"
                placeholder="000000"
                autoFocus
              />
            </div>
            <div className="form-actions">
              <button className="btn-primary" onClick={handleMfaConfirm} disabled={mfaLoading}>
                {mfaLoading ? 'Confirming...' : 'Confirm'}
              </button>
              <button
                className="btn-secondary settings-cancel-button"
                onClick={() => { setMfaStep('idle'); setMfaOtp(''); setMfaMsg(null); }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {mfaMsg && (
          <p className={`form-message top-spaced ${mfaMsg.type}`}>
            {mfaMsg.text}
          </p>
        )}

        <div className="settings-mfa-revoke">
          <div>
            <h3>Trusted devices and active sessions</h3>
            <p>Remove every remembered MFA device and require every signed-in browser, including this one, to authenticate again.</p>
          </div>
          <button type="button" className="settings-revoke-button" onClick={handleRevokeAllSessions} disabled={revokingAllSessions}>
            {revokingAllSessions ? 'Revoking…' : 'Revoke All Devices & Sessions'}
          </button>
          {signOutError && <p className="settings-signout-error" role="alert">{signOutError}</p>}
        </div>
      </div>}

      {/* App Settings */}
      {activeSettingsPanel === 'appearance' && <div className="full-width-card settings-focus-card">
        <h2>🎨 Appearance</h2>
        <div className="appearance-mode-row">
          <div><strong>Dark mode</strong><span>Use the dark variant of your selected color theme.</span></div>
          <label className="appearance-switch">
            <input
              type="checkbox"
              checked={isDarkMode}
              onChange={toggleTheme}
            />
            <span aria-hidden="true" />
            <em>{isDarkMode ? 'On' : 'Off'}</em>
          </label>
        </div>
        <fieldset className="appearance-theme-picker">
          <legend>Color gradient</legend>
          <p>Each palette includes coordinated light and dark surfaces.</p>
          <div className="appearance-theme-grid">
            {[
              { id: 'violet', label: 'Violet', colors: ['#667eea', '#764ba2'] },
              { id: 'ocean', label: 'Ocean', colors: ['#0ea5e9', '#2563eb'] },
              { id: 'emerald', label: 'Emerald', colors: ['#10b981', '#047857'] },
              { id: 'sunset', label: 'Sunset', colors: ['#f97316', '#db2777'] },
              { id: 'rose', label: 'Rose', colors: ['#f43f5e', '#9333ea'] },
            ].map(theme => (
              <button
                type="button"
                key={theme.id}
                className={`appearance-theme-option${colorTheme === theme.id ? ' selected' : ''}`}
                onClick={() => setColorTheme(theme.id)}
                aria-pressed={colorTheme === theme.id}
              >
                <span className="appearance-theme-preview" style={{ '--theme-start': theme.colors[0], '--theme-end': theme.colors[1] }} />
                <strong>{theme.label}</strong>
                <span className="appearance-theme-check" aria-hidden="true">✓</span>
              </button>
            ))}
          </div>
        </fieldset>
        <div className="form-group settings-currency-control">
          <label className="form-label" htmlFor="reporting-currency">Reporting currency</label>
          <select id="reporting-currency" className="form-select" value={reportingCurrency} disabled={savingCurrency} onChange={event => handleReportingCurrency(event.target.value)}>
            {(fxStatus.currencies?.length ? fxStatus.currencies : ['USD']).map(currency => <option value={currency} key={currency}>{currency}</option>)}
          </select>
          <small>Net worth converts using the latest stored ECB daily rate{fxStatus.rateDate ? ` from ${fxStatus.rateDate}` : '; non-USD balances remain excluded until rates are available'}.</small>
        </div>
      </div>}

      {user?.role !== 'admin' && activeSettingsPanel === 'categorization' && (
        <section className="full-width-card settings-focus-card category-rules-card">
          <div className="settings-category-library">
            <div className="category-rules-heading"><div><h2>Categories</h2><p>Default categories are available to everyone. Your custom categories stay private to your account.</p></div><strong>{travelCategories.length}</strong></div>
            {categoryMessage && <p className={categoryMessage.type === 'error' ? 'category-rule-error' : 'category-rule-notice'}>{categoryMessage.text}</p>}
            <form className="settings-category-create" onSubmit={addCustomCategory}>
              <input className="form-input" maxLength={80} required value={newCategoryName} placeholder="New custom category" onChange={event => setNewCategoryName(event.target.value)} />
              <button type="submit">Add category</button>
            </form>
            <div className="settings-category-list">
              {travelCategories.filter(category => category.name.toLocaleLowerCase() !== 'uncategorized').map(category => <div key={category.id}>
                <span className="settings-category-dot" style={{ '--settings-category-color': category.color }} />
                <strong>{category.name}</strong>
                <small>{category.isDefault ? 'Default' : 'Custom'}</small>
                {!category.isDefault && <button type="button" disabled={deletingCategoryId === category.id} onClick={() => deleteCustomCategory(category)}>{deletingCategoryId === category.id ? 'Removing…' : 'Remove'}</button>}
              </div>)}
            </div>
          </div>
          <hr className="settings-category-divider" />
          <div className="category-rules-heading">
            <div><h2>⌁ Categorization Rules</h2><p>Matching expenses receive exactly the complete saved tag set; tags from an older categorization are replaced.</p></div>
            <strong>{categoryRules.length}</strong>
          </div>
          {categoryRules.length ? (
            <div className="category-rules-list">
              {categoryRules.map(rule => (
                <article key={rule.id}>
                  {editingCategoryRule?.id === rule.id ? (
                    <form className="category-rule-edit" onSubmit={handleUpdateCategoryRule}>
                      <label>Merchant pattern<input className="form-input" maxLength={80} required value={editingCategoryRule.merchant} onChange={event => setEditingCategoryRule(current => ({ ...current, merchant: event.target.value }))} /></label>
                      <label>Apply from<input className="form-input" type="date" required value={editingCategoryRule.effectiveFrom} onChange={event => setEditingCategoryRule(current => ({ ...current, effectiveFrom: event.target.value }))} /></label>
                      <div><button type="button" onClick={() => setEditingCategoryRule(null)}>Cancel</button><button type="submit" disabled={savingCategoryRuleId === rule.id}>{savingCategoryRuleId === rule.id ? 'Applying…' : 'Save and apply'}</button></div>
                    </form>
                  ) : <>
                    <div><strong>{rule.merchant}</strong><span>Applies from {rule.effectiveFrom} · matched {rule.matchCount || 0} time{rule.matchCount === 1 ? '' : 's'}</span></div>
                    <div>{(rule.categories?.length ? rule.categories : [rule.category]).map(category => <span key={category.id} className="category-rule-category" style={{ '--category-rule-color': category.color }}>{category.name}</span>)}</div>
                    <div className="category-rule-actions"><button type="button" onClick={() => setEditingCategoryRule({ ...rule })}>Edit</button><button type="button" disabled={deletingCategoryRuleId === rule.id} onClick={() => handleDeleteCategoryRule(rule)}>{deletingCategoryRuleId === rule.id ? 'Removing…' : 'Remove'}</button></div>
                  </>}
                </article>
              ))}
            </div>
          ) : (
            <div className="category-rules-empty"><strong>No rules yet</strong><p>Categorize a synchronized expense, then choose “Remember merchant” on its monthly spending row.</p></div>
          )}
        </section>
      )}

      {activeSettingsPanel === 'upcoming' && <section className="full-width-card settings-focus-card">
        <h2>Upcoming events</h2>
        <p>Scheduled purchase reminders, shown in your local time zone.</p>
        {upcomingEvents.error && <p role="alert">{upcomingEvents.error}</p>}
        {reminderRemovalError && <p role="alert">{reminderRemovalError}</p>}
        {upcomingEvents.loading ? <p>Loading upcoming events…</p> : !upcomingEvents.error && !upcomingEvents.events.length ? <p>No upcoming purchase reminders. Set one by clicking a purchase.</p> : null}
        <div className="travel-plan-list">{upcomingEvents.events.map(event => <article className="travel-plan-link upcoming-event" key={event.expenseId}>
          <div className="upcoming-event-copy"><strong>🔔 {event.description}</strong><time dateTime={event.dueAt}>{new Date(event.dueAt).toLocaleString()}</time>{event.notes?.trim() && <small className="upcoming-event-note">{event.notes}</small>}</div>
          <button type="button" className="upcoming-event-remove" title="Remove scheduled reminder (keeps purchase notes)" aria-label={`Remove reminder for ${event.description}`} disabled={removingReminderId !== null} onClick={() => removeUpcomingReminder(event.expenseId)}><X size={16} aria-hidden="true" /></button>
        </article>)}</div>
      </section>}
      {user?.role !== 'admin' && activeSettingsPanel === 'splits' && <section className="full-width-card settings-focus-card split-people-card">
        <h2>👥 Split purchases</h2>
        <p>Add people you commonly share purchases with. Names are encrypted with your customer key.</p>
        {splitPeopleMessage && <p className={splitPeopleMessage.type === 'error' ? 'category-rule-error' : 'category-rule-notice'}>{splitPeopleMessage.text}</p>}
        <form className="split-person-form" onSubmit={addSplitPerson}>
          <input className="form-input" value={splitPersonName} maxLength={80} required placeholder="Person's name" onChange={event => setSplitPersonName(event.target.value)} />
          <button type="submit">Add person</button>
        </form>
        <div className="split-people-list">{splitPeople.map(person => <div key={person.id}><strong>{person.name}</strong><button type="button" onClick={() => deleteSplitPerson(person)}>Remove</button></div>)}</div>
      </section>}

      {user?.role !== 'admin' && activeSettingsPanel === 'travel' && <section className="full-width-card settings-focus-card travel-plans-card">
        <div className="travel-plans-heading"><div><h2>✈️ Travel</h2><p>Create a date range to add the trip name alongside each eligible expense’s existing tags.</p></div><strong>{travelPlans.length}</strong></div>
        <p className="settings-panel-description">Choose which of your categories represent routine spending. Automatically detected subscriptions remain excluded. Trips may be past, active, or in the future.</p>
        {travelMessage && <p className={travelMessage.type === 'error' ? 'category-rule-error' : 'category-rule-notice'}>{travelMessage.text}</p>}
        <div className="travel-exclusions">
          <div><strong>Categories excluded from trips</strong><span>An expense is excluded when it has any selected category.</span></div>
          <select className="form-input travel-exclusion-select" value="" onChange={event => { if (!event.target.value) return; const id = Number(event.target.value); if (Number.isInteger(id)) setTravelExcludedCategoryIds(current => [...new Set([...current, id])]); }}>
            <option value="">Add an excluded category…</option>
            {travelCategories.filter(category => category.name.toLocaleLowerCase() !== 'uncategorized' && !travelPlans.some(plan => plan.name.toLocaleLowerCase() === category.name.toLocaleLowerCase()) && !travelExcludedCategoryIds.includes(category.id)).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
          {!!travelExcludedCategoryIds.length && <div className="travel-exclusion-tags">{travelExcludedCategoryIds.map(id => travelCategories.find(category => category.id === id)).filter(Boolean).map(category => <span key={category.id} style={{ '--travel-category-color': category.color }}><i className="travel-exclusion-dot" />{category.name}<button type="button" aria-label={`Remove ${category.name} from travel exclusions`} onClick={() => setTravelExcludedCategoryIds(current => current.filter(id => id !== category.id))}>×</button></span>)}</div>}
          {!travelCategories.some(category => category.name.toLocaleLowerCase() !== 'uncategorized') && <small>Create expense categories first, then return here to select exclusions.</small>}
          <button type="button" disabled={savingTravelPreferences} onClick={saveTravelPreferences}>{savingTravelPreferences ? 'Applying…' : 'Save exclusions'}</button>
        </div>
        <form className="travel-plan-form" onSubmit={saveTravelPlan}>
          <label>Trip name<input className="form-input" maxLength={80} required placeholder="Japan 2027" value={travelDraft.name} onChange={event => setTravelDraft(current => ({ ...current, name: event.target.value }))} /></label>
          <label>Start date<input className="form-input" type="date" required value={travelDraft.startDate} onChange={event => setTravelDraft(current => ({ ...current, startDate: event.target.value }))} /></label>
          <label>End date<input className="form-input" type="date" required min={travelDraft.startDate || undefined} value={travelDraft.endDate} onChange={event => setTravelDraft(current => ({ ...current, endDate: event.target.value }))} /></label>
          <div className="travel-plan-form-actions">{travelDraft.id && <button type="button" onClick={() => setTravelDraft({ id: null, name: '', startDate: '', endDate: '' })}>Cancel</button>}<button type="submit" disabled={savingTravelPlan}>{savingTravelPlan ? 'Applying…' : travelDraft.id ? 'Save changes' : 'Add trip'}</button></div>
        </form>
        <div className="travel-plan-list">{travelPlans.map(plan => <article key={plan.id} className="travel-plan-link" role="link" tabIndex={0} onClick={() => navigate(`/category-browser?category=${encodeURIComponent(plan.name)}&start=${plan.startDate}&end=${plan.endDate}&section=browser`)} onKeyDown={event => { if (event.target === event.currentTarget && event.key === 'Enter') navigate(`/category-browser?category=${encodeURIComponent(plan.name)}&start=${plan.startDate}&end=${plan.endDate}&section=browser`); }}><div><strong>{plan.name}</strong><span>{new Date(`${plan.startDate}T12:00:00`).toLocaleDateString()} – {new Date(`${plan.endDate}T12:00:00`).toLocaleDateString()}</span></div><div><button type="button" onClick={event => { event.stopPropagation(); setTravelDraft({ ...plan }); }}>Edit</button><button type="button" className="danger" onClick={event => { event.stopPropagation(); deleteTravelPlan(plan); }}>Remove</button></div></article>)}</div>
      </section>}

      {/* SimpleFIN is a customer financial-data feature, not an admin tool. */}
      {user?.role !== 'admin' && activeSettingsPanel === 'simplefin' && (
        <section className="full-width-card simplefin-settings-card" aria-labelledby="simplefin-settings-title">
          <div className="simplefin-heading">
            <div className="simplefin-heading-copy">
              <span className="simplefin-mark" aria-hidden="true">S</span>
              <div>
                <h2 id="simplefin-settings-title">SimpleFIN Bridge</h2>
                <p>Connect read-only balances and transactions without sharing bank credentials with this app.</p>
              </div>
            </div>
            <div className="simplefin-heading-actions">
              {!!simplefinAccounts.length && (
                <button type="button" className="simplefin-link-wizard-button" onClick={() => setSimplefinWizardOpen(true)}>
                  <Link2 size={16} /> Link accounts
                  <span>{simplefinAccounts.filter(row => row.isActive && !row.link).length}</span>
                </button>
              )}
              <a
                className="simplefin-external-link"
                href="https://beta-bridge.simplefin.org/simplefin/create"
                target="_blank"
                rel="noreferrer"
              >
                Get setup token <span aria-hidden="true">↗</span>
              </a>
            </div>
          </div>

          {simplefinLoading ? (
            <div className="simplefin-loading" aria-live="polite">
              <span className="simplefin-spinner" aria-hidden="true" />
              Loading connection status…
            </div>
          ) : (
            <div className={`simplefin-link-viewport${simplefinWizardOpen ? ' showing-wizard' : ''}`}>
              <div className="simplefin-link-slider">
                <div className="simplefin-link-pane simplefin-main-pane" aria-hidden={simplefinWizardOpen}>
                  {simplefinConnections.length > 0 && (
                    <div className="simplefin-connections">
                      {simplefinConnections.map((connection, index) => {
                        const discovered = simplefinAccounts.filter(accountRow => accountRow.connectionId === connection.id);
                        const retryBlocked = connection.nextSyncAllowedAt
                          && new Date(connection.nextSyncAllowedAt).getTime() > Date.now();
                        const connectionRuns = simplefinRuns.filter(run => run.connectionId === connection.id);
                        const auditExpanded = expandedAuditIds.includes(connection.id);
                        return (
                          <article className="simplefin-connection" key={connection.id}>
                            <div className="simplefin-connection-topline">
                              <div>
                                <span className={`simplefin-status ${connection.status}`}>
                                  <i aria-hidden="true" />
                                  {simplefinStatusLabel(connection.status)}
                                </span>
                                <h3>Connection {simplefinConnections.length > 1 ? index + 1 : ''}</h3>
                              </div>
                              <button
                                type="button"
                                className="simplefin-sync-button"
                                onClick={() => handleSimplefinDiscovery(connection.id)}
                                disabled={simplefinRetrying === connection.id || retryBlocked || connection.status !== 'active'}
                                title={retryBlocked ? `Available ${formatSimplefinDate(connection.nextSyncAllowedAt)}` : 'Refresh balances and transactions'}
                              >
                                <span className={simplefinRetrying === connection.id ? 'simplefin-rotating' : ''} aria-hidden="true">↻</span>
                                {simplefinRetrying === connection.id ? 'Syncing…' : 'Sync now'}
                              </button>
                            </div>

                            <div className="simplefin-metadata">
                              <span><small>Last successful sync</small>{formatSimplefinDate(connection.lastSyncSucceededAt)}</span>
                              <span><small>Connected</small>{formatSimplefinDate(connection.createdAt)}</span>
                              <span><small>Accounts found</small>{discovered.length}</span>
                            </div>

                            <div className="simplefin-auto-sync-row">
                              <div>
                                <strong>Automatic sync</strong>
                                <span>{connection.autoSyncEnabled
                                  ? <><span>Next run {formatSimplefinDate(connection.nextScheduledSyncAt)}</span><SyncCountdown value={connection.nextScheduledSyncAt} syncing={connection.status === 'syncing'} /></>
                                  : 'Scheduled synchronization is paused'}</span>
                              </div>
                              <label className="simplefin-switch">
                                <input
                                  type="checkbox"
                                  checked={Boolean(connection.autoSyncEnabled)}
                                  disabled={updatingAutoSyncId === connection.id || connection.status !== 'active'}
                                  onChange={event => handleAutoSyncToggle(connection, event.target.checked)}
                                  aria-label={`Automatic sync for connection ${index + 1}`}
                                />
                                <span aria-hidden="true" />
                              </label>
                            </div>

                            {['disabled', 'reconnect_required', 'revoked'].includes(connection.status) ? (
                              <div className="simplefin-reconnect-panel">
                                <div className="simplefin-reconnect-copy">
                                  <strong>Reconnect with a new token</strong>
                                  <span>Your local account links and imported history will be retained when remote account IDs match.</span>
                                </div>
                                <textarea
                                  className="form-input simplefin-token-input"
                                  value={reconnectTokens[connection.id] || ''}
                                  onChange={event => setReconnectTokens(current => ({ ...current, [connection.id]: event.target.value }))}
                                  placeholder="Paste a new one-time setup token"
                                  maxLength={4096}
                                  rows={2}
                                  autoComplete="off"
                                  autoCapitalize="none"
                                  spellCheck={false}
                                  disabled={reconnectingId === connection.id}
                                  aria-label={`New setup token for connection ${index + 1}`}
                                />
                                <div className="simplefin-reconnect-actions">
                                  <a href="https://beta-bridge.simplefin.org/simplefin/create" target="_blank" rel="noreferrer">Get a new token ↗</a>
                                  <button
                                    type="button"
                                    className="btn-primary"
                                    disabled={!reconnectTokens[connection.id]?.trim() || reconnectingId === connection.id}
                                    onClick={() => handleSimplefinReconnect(connection)}
                                  >
                                    {reconnectingId === connection.id ? 'Reconnecting securely…' : 'Reconnect'}
                                  </button>
                                </div>
                                {connection.status === 'disabled' && (
                                  <div className="simplefin-delete-zone">
                                    {deleteConnectionId === connection.id ? (
                                      <div className="simplefin-delete-confirm" role="alert">
                                        <strong>Permanently delete all connection data?</strong>
                                        <p>This removes its accounts, links, staged transactions, imported SimpleFIN expenses, duplicate reviews, and sync history. Manual accounts and manually created expenses are retained. This cannot be undone.</p>
                                        <label htmlFor={`simplefin-delete-${connection.id}`}>Type <b>DELETE</b> to confirm</label>
                                        <input
                                          id={`simplefin-delete-${connection.id}`}
                                          className="form-input"
                                          value={deleteConnectionConfirmation}
                                          onChange={event => setDeleteConnectionConfirmation(event.target.value)}
                                          autoComplete="off"
                                          disabled={deletingConnectionId === connection.id}
                                        />
                                        <div>
                                          <button type="button" className="simplefin-cancel-delete" onClick={() => { setDeleteConnectionId(null); setDeleteConnectionConfirmation(''); }}>Cancel</button>
                                          <button
                                            type="button"
                                            className="simplefin-confirm-delete"
                                            disabled={deleteConnectionConfirmation !== 'DELETE' || deletingConnectionId === connection.id}
                                            onClick={() => handleDeleteSimplefinConnection(connection)}
                                          >
                                            {deletingConnectionId === connection.id ? 'Deleting permanently…' : 'Delete permanently'}
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <button type="button" className="simplefin-open-delete" onClick={() => { setDeleteConnectionId(connection.id); setDeleteConnectionConfirmation(''); }}>
                                        Delete connection data permanently
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            ) : disconnectConfirmId === connection.id ? (
                              <div className="simplefin-disconnect-confirm" role="alert">
                                <div>
                                  <strong>Disconnect this connection?</strong>
                                  <span>Automatic sync will stop. Accounts, links, categories, and imported history will stay.</span>
                                </div>
                                <div>
                                  <button type="button" className="simplefin-cancel-disconnect" onClick={() => setDisconnectConfirmId(null)}>Cancel</button>
                                  <button
                                    type="button"
                                    className="simplefin-confirm-disconnect"
                                    disabled={disconnectingId === connection.id}
                                    onClick={() => handleSimplefinDisconnect(connection)}
                                  >
                                    {disconnectingId === connection.id ? 'Disconnecting…' : 'Disconnect'}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="simplefin-lifecycle-row">
                                <span>To fully revoke access, also disable the token in SimpleFIN Bridge.</span>
                                <button type="button" onClick={() => setDisconnectConfirmId(connection.id)}>Disconnect</button>
                              </div>
                            )}

                            {connection.lastError && (
                              <p className="simplefin-connection-warning" role="status">
                                <span aria-hidden="true">!</span>
                                {friendlySimplefinMessage(connection.lastError)}
                              </p>
                            )}
                            {connection.needsAttention && (
                              <p className="simplefin-connection-warning" role="alert"><span aria-hidden="true">!</span>{connection.status === 'reconnect_required' ? 'Reconnect this connection to resume synchronization.' : `${connection.consecutiveFailures} consecutive synchronization attempts failed. Review sync history or reconnect if failures continue.`}</p>
                            )}

                            <section className="simplefin-audit" aria-labelledby={`simplefin-audit-${connection.id}`}>
                              <button
                                type="button"
                                className="simplefin-audit-toggle"
                                aria-expanded={auditExpanded}
                                aria-controls={`simplefin-audit-list-${connection.id}`}
                                onClick={() => setExpandedAuditIds(current => current.includes(connection.id)
                                  ? current.filter(id => id !== connection.id)
                                  : [...current, connection.id])}
                              >
                                <span><History size={15} /><span><strong id={`simplefin-audit-${connection.id}`}>Sync history</strong><small>{connectionRuns.length ? `${connectionRuns.length} recent run${connectionRuns.length === 1 ? '' : 's'}` : 'No runs recorded yet'}</small></span></span>
                                <ChevronDown size={16} className={auditExpanded ? 'is-open' : ''} />
                              </button>
                              {auditExpanded && (
                                <div className="simplefin-audit-list" id={`simplefin-audit-list-${connection.id}`}>
                                  {connectionRuns.length ? connectionRuns.map(run => (
                                    <article className={`simplefin-audit-run ${run.status}`} key={run.id}>
                                      <span className="simplefin-audit-dot" aria-hidden="true" />
                                      <div className="simplefin-audit-run-body">
                                        <div className="simplefin-audit-run-heading">
                                          <div><strong>{simplefinRunStatus(run.status)}</strong><span>{simplefinTriggerLabel(run.trigger)}</span></div>
                                          <time dateTime={run.startedAt}>{formatSimplefinDate(run.startedAt)}</time>
                                        </div>
                                        <div className="simplefin-audit-metrics">
                                          <span><strong>{run.accountsReceived}</strong> accounts</span>
                                          <span><strong>{run.transactionsInserted}</strong> new</span>
                                          <span><strong>{run.transactionsUpdated}</strong> updated</span>
                                          <span><strong>{run.expensesMaterialized}</strong> imported</span>
                                          <span><strong>{run.duplicateCandidates}</strong> reviews</span>
                                        </div>
                                        {run.error && <p className="simplefin-audit-error">{run.error.message}</p>}
                                        {!!run.warnings?.length && <p className="simplefin-audit-warning">{run.warnings.map(item => item.message).join(' · ')}</p>}
                                      </div>
                                    </article>
                                  )) : <p className="simplefin-audit-empty">Sync activity will appear here after discovery or synchronization.</p>}
                                </div>
                              )}
                            </section>

                            {discovered.length > 0 ? (
                              <div className="simplefin-account-grid">
                                {discovered.map(accountRow => (
                                  <div className={`simplefin-account-preview${accountRow.link ? ' is-linked' : ''}${!accountRow.isActive ? ' is-inactive' : ''}`} key={accountRow.id}>
                                    <div className="simplefin-account-icon" aria-hidden="true">
                                      {accountRow.remoteName?.slice(0, 1).toUpperCase() || '$'}
                                    </div>
                                    <div className="simplefin-account-copy">
                                      <strong>{accountRow.remoteName}</strong>
                                      <span>{accountRow.institutionName || 'Financial institution'} · {accountRow.currency}</span>
                                      {!accountRow.isActive && <span className="simplefin-inactive-label">No longer reported by institution</span>}
                                      {accountRow.link ? (
                                        <>
                                          <span className="simplefin-linked-label"><Link2 size={12} /> Linked to {accountRow.link.localAccount.name}</span>
                                          <span className="simplefin-import-caption">Imports from {formatSimplefinDate(accountRow.link.transactionImportFrom, true)}</span>
                                          <span className="simplefin-import-caption">Synced through {formatSimplefinDate(accountRow.link.transactionSyncedThrough, true)}</span>
                                        </>
                                      ) : (
                                        <span className="simplefin-unlinked-label">Not linked to a manual account</span>
                                      )}
                                    </div>
                                    <div className="simplefin-account-balance">
                                      <strong>{formatSimplefinMoney(accountRow.balance, accountRow.currency)}</strong>
                                      <span>as of {formatSimplefinDate(accountRow.balanceDate, true)}</span>
                                    </div>
                                    {accountRow.link && (
                                      <div className="simplefin-linked-import-control">
                                        <label htmlFor={`simplefin-import-${accountRow.id}`}>Import from</label>
                                        <div>
                                          <input
                                            id={`simplefin-import-${accountRow.id}`}
                                            type="date"
                                            className="form-input"
                                            min={isoDateOffset(-730)}
                                            max={isoDateOffset(0)}
                                            value={linkedImportDates[accountRow.id] || accountRow.link.transactionImportFrom || isoDateOffset(0)}
                                            onChange={event => setLinkedImportDates(current => ({ ...current, [accountRow.id]: event.target.value }))}
                                          />
                                          <button
                                            type="button"
                                            disabled={savingImportRangeId === accountRow.id || (linkedImportDates[accountRow.id] || accountRow.link.transactionImportFrom) === accountRow.link.transactionImportFrom}
                                            onClick={() => handleImportRangeUpdate(accountRow)}
                                          >
                                            {savingImportRangeId === accountRow.id ? 'Saving…' : 'Save'}
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                    {accountRow.transactionSummary?.total > 0 && (
                                      <div className="simplefin-transaction-summary" title={`Staged history ${formatSimplefinDate(accountRow.transactionSummary.earliestPostedAt, true)} through ${formatSimplefinDate(accountRow.transactionSummary.latestPostedAt, true)}`}>
                                        <span><strong>{accountRow.transactionSummary.postedOutflows}</strong> posted</span>
                                        <span><strong>{accountRow.transactionSummary.pending}</strong> pending</span>
                                        <span><strong>{accountRow.transactionSummary.positive}</strong> credits</span>
                                        <span><strong>{accountRow.transactionSummary.imported}</strong> imported</span>
                                      </div>
                                    )}
                                    {accountRow.link && (
                                      <button
                                        type="button"
                                        className="simplefin-unlink-button"
                                        onClick={() => handleSimplefinUnlink(accountRow)}
                                        disabled={unlinkingAccountId === accountRow.id}
                                        aria-label={`Unlink ${accountRow.remoteName} from ${accountRow.link.localAccount.name}`}
                                        title="Break account link"
                                      >
                                        <Unlink size={17} />
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="simplefin-empty-accounts">
                                No accounts have been discovered yet. Retry discovery when the connection is available.
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  )}

                  {classificationReviews.length > 0 && (
                    <section className="simplefin-classification-review" aria-labelledby="simplefin-classification-title">
                      <div className="simplefin-duplicate-heading">
                        <div>
                          <span>Classification needed</span>
                          <h3 id="simplefin-classification-title">Review uncertain transactions</h3>
                          <p>These could be spending or account movement. Choose how each should affect your budget.</p>
                        </div>
                        <strong>{classificationReviews.length}</strong>
                      </div>
                      <div className="simplefin-classification-list">
                        {classificationReviews.map(review => (
                          <article className="simplefin-classification-row" key={review.id}>
                            <div>
                              <small>{review.account.name} · {formatSimplefinDate(review.postedAt, true)}</small>
                              <strong>{review.description}</strong>
                              <span>{review.reason || 'This transaction needs review.'}</span>
                            </div>
                            <strong>{formatSimplefinMoney(review.amount, review.account.currency)}</strong>
                            <select
                              className="form-select"
                              defaultValue=""
                              disabled={resolvingClassificationId === review.id}
                              onChange={event => event.target.value && handleClassificationResolution(review, event.target.value)}
                              aria-label={`Classify ${review.description}`}
                            >
                              <option value="" disabled>Choose treatment…</option>
                              <option value="expense">Spending expense</option>
                              <option value="refund">Refund / spending credit</option>
                              <option value="income">Income / deposit</option>
                              <option value="transfer">Account transfer</option>
                              <option value="card_payment">Credit-card payment</option>
                              <option value="ignored">Ignore for reporting</option>
                            </select>
                          </article>
                        ))}
                      </div>
                    </section>
                  )}

                  {simplefinDuplicates.length > 0 && (
                    <section className="simplefin-duplicate-review" aria-labelledby="simplefin-duplicate-title">
                      <div className="simplefin-duplicate-heading">
                        <div>
                          <span>Review required</span>
                          <h3 id="simplefin-duplicate-title">Possible duplicate expenses</h3>
                          <p>These provider transactions look like expenses you entered manually. Nothing is merged without your confirmation.</p>
                        </div>
                        <strong>{simplefinDuplicates.length}</strong>
                      </div>
                      <div className="simplefin-duplicate-list">
                        {simplefinDuplicates.map(candidate => (
                          <article className="simplefin-duplicate-card" key={candidate.id}>
                            <div className="simplefin-duplicate-account">
                              <span>{candidate.account.name}</span>
                              <small>Linked to {candidate.account.linkedTo} · {Math.round(candidate.score * 100)}% match</small>
                            </div>
                            <div className="simplefin-duplicate-comparison">
                              <div>
                                <small>SimpleFIN transaction</small>
                                <strong>{candidate.providerTransaction.description}</strong>
                                <span>{formatSimplefinMoney(candidate.providerTransaction.amount, candidate.providerTransaction.currency)} · {formatSimplefinDate(candidate.providerTransaction.date, true)}</span>
                              </div>
                              <span className="simplefin-duplicate-versus">≈</span>
                              <div>
                                <small>Manual expense</small>
                                {candidate.possibleManualExpense ? (
                                  <>
                                    <strong>{candidate.possibleManualExpense.description}</strong>
                                    <span>{formatSimplefinMoney(candidate.possibleManualExpense.amount, candidate.providerTransaction.currency)} · {formatSimplefinDate(candidate.possibleManualExpense.date, true)}</span>
                                  </>
                                ) : <strong className="simplefin-missing-expense">Manual expense no longer exists</strong>}
                              </div>
                            </div>
                            <div className="simplefin-duplicate-actions">
                              <button
                                type="button"
                                className="simplefin-keep-manual"
                                disabled={!candidate.possibleManualExpense || resolvingDuplicateId === candidate.id}
                                onClick={() => handleDuplicateResolution(candidate, 'keep_manual')}
                              >
                                Keep manual expense
                              </button>
                              <button
                                type="button"
                                className="btn-primary simplefin-import-separate"
                                disabled={resolvingDuplicateId === candidate.id}
                                onClick={() => handleDuplicateResolution(candidate, 'import_separately')}
                              >
                                {resolvingDuplicateId === candidate.id ? 'Saving…' : 'Import separately'}
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  )}

                  <form className="simplefin-connect-form" onSubmit={handleSimplefinConnect}>
                    <div className="simplefin-connect-copy">
                      <h3>{simplefinConnections.length ? 'Add another connection' : 'Connect your first institution'}</h3>
                      <p>Generate a one-time token in SimpleFIN Bridge, then paste it below. It is claimed securely and never saved in your browser.</p>
                    </div>
                    <label className="form-label" htmlFor="simplefin-token">One-time setup token</label>
                    <textarea
                      id="simplefin-token"
                      className="form-input simplefin-token-input"
                      value={simplefinToken}
                      onChange={(event) => setSimplefinToken(event.target.value)}
                      placeholder="Paste the token from SimpleFIN Bridge"
                      maxLength={4096}
                      rows={3}
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      disabled={simplefinConnecting}
                    />
                    <div className="simplefin-form-footer">
                      <span>Read-only access · encrypted at rest · revocable anytime</span>
                      <button type="submit" className="btn-primary simplefin-connect-button" disabled={simplefinConnecting || !simplefinToken.trim()}>
                        {simplefinConnecting ? 'Connecting securely…' : 'Connect SimpleFIN'}
                      </button>
                    </div>
                  </form>
                </div>

                <div className="simplefin-link-pane simplefin-wizard-pane" aria-hidden={!simplefinWizardOpen}>
                  <div className="simplefin-wizard-toolbar">
                    <button type="button" className="simplefin-wizard-back" onClick={() => setSimplefinWizardOpen(false)}>
                      <ArrowLeft size={17} /> SimpleFIN overview
                    </button>
                    <div><strong>Linking wizard</strong><span>One SimpleFIN account ↔ one manual account</span></div>
                  </div>

                  <div className="simplefin-wizard-intro">
                    <span><Link2 size={22} /></span>
                    <div><h3>Match your accounts</h3><p>Choose the manual account that represents each discovered account. Linked accounts disappear from this list automatically.</p></div>
                  </div>

                  {simplefinAccounts.filter(row => row.isActive && !row.link).length ? (
                    <div className="simplefin-wizard-list">
                      {simplefinAccounts.filter(row => row.isActive && !row.link).map(accountRow => {
                        const usedKeys = new Set(simplefinAccounts.filter(row => row.link).map(row => `${row.link.localAccount.type}:${row.link.localAccount.id}`));
                        const availableManualAccounts = manualAccounts.filter(row => !usedKeys.has(`${row.type}:${row.id}`));
                        const selectedManualAccount = availableManualAccounts.find(row => `${row.type}:${row.id}` === linkSelections[accountRow.id]);
                        return (
                          <article className="simplefin-wizard-row" key={accountRow.id}>
                            <div className="simplefin-wizard-remote">
                              <span>{accountRow.remoteName?.slice(0, 1).toUpperCase() || '$'}</span>
                              <div><strong>{accountRow.remoteName}</strong><small>{accountRow.institutionName || 'Financial institution'} · {formatSimplefinMoney(accountRow.balance, accountRow.currency)}</small></div>
                            </div>
                            <Link2 className="simplefin-wizard-chain" size={20} aria-hidden="true" />
                            <div className="simplefin-wizard-choice">
                              <div className="simplefin-wizard-select-wrap">
                                <select
                                  className="form-select"
                                  value={linkSelections[accountRow.id] || ''}
                                  onChange={event => setLinkSelections(current => ({ ...current, [accountRow.id]: event.target.value }))}
                                  aria-label={`Manual account for ${accountRow.remoteName}`}
                                >
                                  <option value="">Choose a manual account…</option>
                                  {['credit_card', 'bank', 'trading'].map(type => {
                                    const rows = availableManualAccounts.filter(row => row.type === type);
                                    return rows.length ? (
                                      <optgroup label={rows[0].kind} key={type}>
                                        {rows.map(row => (
                                          <option value={`${row.type}:${row.id}`} key={`${row.type}:${row.id}`}>{manualAccountOptionLabel(row)}</option>
                                        ))}
                                      </optgroup>
                                    ) : null;
                                  })}
                                </select>
                                {selectedManualAccount && (
                                  <small className="simplefin-wizard-selected-detail">
                                    <span>{selectedManualAccount.kind}</span>
                                    {selectedManualAccount.institution && <span>{selectedManualAccount.institution}</span>}
                                    {selectedManualAccount.balance != null && <strong>{formatSimplefinMoney(selectedManualAccount.balance, selectedManualAccount.currency)}</strong>}
                                    <span>Ref …{selectedManualAccount.id.slice(-4)}</span>
                                  </small>
                                )}
                                <div className="simplefin-import-choice">
                                  <label htmlFor={`simplefin-history-${accountRow.id}`}>Transaction history</label>
                                  <select
                                    id={`simplefin-history-${accountRow.id}`}
                                    className="form-select"
                                    value={importRangePresets[accountRow.id] || 'today'}
                                    onChange={event => setImportRangePresets(current => ({ ...current, [accountRow.id]: event.target.value }))}
                                  >
                                    <option value="today">Start today</option>
                                    <option value="month">Start of this month</option>
                                    <option value="30">Last 30 days</option>
                                    <option value="60">Last 60 days</option>
                                    <option value="90">Last 90 days</option>
                                    <option value="custom">Custom date</option>
                                  </select>
                                  {(importRangePresets[accountRow.id] || 'today') === 'custom' && (
                                    <input
                                      type="date"
                                      className="form-input"
                                      min={isoDateOffset(-730)}
                                      max={isoDateOffset(0)}
                                      value={customImportDates[accountRow.id] || ''}
                                      onChange={event => setCustomImportDates(current => ({ ...current, [accountRow.id]: event.target.value }))}
                                      aria-label={`Custom import date for ${accountRow.remoteName}`}
                                    />
                                  )}
                                </div>
                              </div>
                              {createAccountTargetId === accountRow.id && (
                                <div className="simplefin-create-account-choice">
                                  <label htmlFor={`simplefin-new-type-${accountRow.id}`}>What kind of account is this?</label>
                                  <select
                                    id={`simplefin-new-type-${accountRow.id}`}
                                    className="form-select"
                                    value={newAccountType}
                                    onChange={event => setNewAccountType(event.target.value)}
                                    autoFocus
                                  >
                                    <option value="">Choose account type…</option>
                                    <option value="bank">Bank account</option>
                                    <option value="credit_card">Credit card</option>
                                    <option value="trading">Trading or investment account</option>
                                  </select>
                                  <small>The new account will use the SimpleFIN name and synchronized balance.</small>
                                </div>
                              )}
                              <div className="simplefin-wizard-actions">
                                <button
                                  type="button"
                                  className="simplefin-create-account-button"
                                  disabled={creatingManualAccountId === accountRow.id || linkingAccountId === accountRow.id}
                                  onClick={() => {
                                    if (createAccountTargetId === accountRow.id) {
                                      handleCreateAndLinkAccount(accountRow);
                                    } else {
                                      setCreateAccountTargetId(accountRow.id);
                                      setNewAccountType('');
                                      setSimplefinMsg(null);
                                    }
                                  }}
                                >
                                  {creatingManualAccountId === accountRow.id
                                    ? 'Creating…'
                                    : createAccountTargetId === accountRow.id ? 'Create and link' : 'Create account'}
                                </button>
                                {createAccountTargetId === accountRow.id && (
                                  <button type="button" className="simplefin-create-cancel" onClick={() => { setCreateAccountTargetId(null); setNewAccountType(''); }}>Cancel</button>
                                )}
                                <button
                                  type="button"
                                  className="btn-primary simplefin-wizard-link"
                                  disabled={!linkSelections[accountRow.id] || linkingAccountId === accountRow.id || creatingManualAccountId === accountRow.id}
                                  onClick={() => handleSimplefinLink(accountRow.id)}
                                >
                                  {linkingAccountId === accountRow.id ? 'Linking…' : 'Link account'}
                                </button>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="simplefin-wizard-complete">
                      <span><Link2 size={28} /></span><h3>Everything is linked</h3><p>All discovered SimpleFIN accounts are connected to manual accounts.</p>
                      <button type="button" className="btn-primary" onClick={() => setSimplefinWizardOpen(false)}>Return to overview</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {simplefinMsg && (
            <p className={`simplefin-message ${simplefinMsg.type}`} role="status" aria-live="polite">
              {simplefinMsg.text}
            </p>
          )}
        </section>
      )}

          </div>
        </div>
      </div>

      {/* Session */}
      <div className="full-width-card settings-session-card">
        <div>
          <h2>↪️ Sign Out</h2>
          <p>End your current session on this device.</p>
        </div>
        <button type="button" className="settings-signout-button" onClick={handleSignOut} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign Out'}</button>
        {signOutError && <p className="settings-signout-error" role="alert">{signOutError}</p>}
      </div>

      {/* Administrators are intentionally protected from account deletion. */}
      {user?.role !== 'admin' && (
        <div className="full-width-card settings-danger-card">
          <div>
            <h2 className="danger-zone-title">🚨 Danger Zone</h2>
            <p>Permanently delete this account and all associated data.</p>
          </div>
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="danger-button settings-delete-button"
          >
            Delete Account
          </button>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {user?.role !== 'admin' && showDeleteConfirm && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 className="modal-title">Confirm Account Deletion</h3>
            <p className="text-black">
              Are you sure you want to delete "{account.name}"? This action cannot be undone and will permanently remove all data.
            </p>
            <div className="form-actions">
              <button
                onClick={handleDeleteAccount}
                className="btn-primary danger-button"
              >
                Yes, Delete Account
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="btn-primary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatSimplefinDate(value, dateOnly = false) {
  if (!value) return 'Not yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unavailable';
  return new Intl.DateTimeFormat('en-US', dateOnly
    ? { month: 'short', day: 'numeric', year: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }
  ).format(date);
}

function SyncCountdown({ value, syncing = false }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (syncing) return <span className="simplefin-sync-countdown">Sync in progress</span>;
  const target = new Date(value).getTime();
  if (!value || Number.isNaN(target)) return <span className="simplefin-sync-countdown">Awaiting schedule</span>;

  const remaining = Math.max(0, target - now);
  if (remaining === 0) return <span className="simplefin-sync-countdown due">Due now</span>;
  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [
    days > 0 ? `${days}d` : null,
    days > 0 || hours > 0 ? `${hours}h` : null,
    `${minutes}m`,
    `${String(seconds).padStart(2, '0')}s`,
  ].filter(Boolean);
  return <span className="simplefin-sync-countdown">Starts in {parts.join(' ')}</span>;
}

function formatSimplefinMoney(value, currency) {
  const number = Number(value);
  if (!Number.isFinite(number)) return `${value ?? '—'} ${currency || ''}`.trim();
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(number);
  } catch {
    return `${number.toLocaleString()} ${currency || ''}`.trim();
  }
}

function simplefinStatusLabel(status) {
  return ({
    active: 'Connected',
    syncing: 'Discovering',
    reconnect_required: 'Reconnect required',
    revoked: 'Revoked',
    disabled: 'Disconnected',
  })[status] || 'Needs attention';
}

function friendlySimplefinMessage(value) {
  try {
    const warnings = JSON.parse(value);
    if (Array.isArray(warnings) && warnings.length) return warnings.map(item => item.message).join(' · ');
  } catch {
    // Plain sanitized backend error.
  }
  return value;
}

function simplefinRunStatus(status) {
  return ({ running: 'In progress', succeeded: 'Successful', partial: 'Completed with warnings', failed: 'Failed' })[status] || 'Completed';
}

function simplefinTriggerLabel(trigger) {
  return ({ automatic: 'Automatic sync', manual: 'Manual sync', discovery: 'Account discovery', reconnect: 'Reconnection' })[trigger] || 'Manual sync';
}

function manualAccountOptionLabel(account) {
  const details = [account.name];
  if (account.institution && account.institution !== account.name) details.push(account.institution);
  if (account.balance != null) details.push(formatSimplefinMoney(account.balance, account.currency));
  details.push(`Ref …${account.id.slice(-4)}`);
  return details.join(' · ');
}

function classificationLabel(value) {
  return ({ expense: 'Spending expense', refund: 'Refund', income: 'Income', transfer: 'Account transfer', card_payment: 'Credit-card payment', ignored: 'Ignored' })[value] || value;
}

function settingsPanelTitle(panel) {
  return ({
    upcoming: 'Upcoming events',
    profile: 'Profile name', financial: 'Financial profile', email: 'Email address', password: 'Password',
    security: 'Two-factor authentication', appearance: 'Appearance', categorization: 'Categorization rules', splits: 'Split purchases', travel: 'Travel', simplefin: 'SimpleFIN Bridge',
  })[panel] || 'Settings';
}

function federalIncomeAfterTax(yearlyIncomeBeforeTax) {
  const brackets = [
    { rate: .1, upTo: 11600 }, { rate: .12, upTo: 47150 }, { rate: .22, upTo: 100525 },
    { rate: .24, upTo: 191950 }, { rate: .32, upTo: 243725 }, { rate: .35, upTo: 609350 },
    { rate: .37, upTo: Number.MAX_SAFE_INTEGER },
  ];
  let afterTax = 0;
  let previousLimit = 0;
  for (const bracket of brackets) {
    if (bracket.upTo <= yearlyIncomeBeforeTax) {
      afterTax += (1 - bracket.rate) * (bracket.upTo - previousLimit);
      previousLimit = bracket.upTo;
    } else {
      afterTax += (yearlyIncomeBeforeTax - previousLimit) * (1 - bracket.rate);
      break;
    }
  }
  return afterTax;
}

function SettingsMenuCard({ icon, title, detail, tone = '', onClick }) {
  return (
    <button type="button" className={`settings-hub-card${tone ? ` ${tone}` : ''}`} onClick={onClick}>
      <span className="settings-hub-icon" aria-hidden="true">{icon}</span>
      <span className="settings-hub-copy"><strong>{title}</strong><small>{detail}</small></span>
      <span className="settings-hub-arrow" aria-hidden="true">→</span>
    </button>
  );
}

function isoDateOffset(days) {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function importDateForPreset(preset, customDate) {
  if (preset === 'custom') return customDate || null;
  if (preset === 'month') {
    const date = new Date();
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }
  if (preset === '30') return isoDateOffset(-30);
  if (preset === '60') return isoDateOffset(-60);
  if (preset === '90') return isoDateOffset(-90);
  return isoDateOffset(0);
}
