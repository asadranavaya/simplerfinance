/**
 * API client — all requests include credentials (httpOnly JWT cookie).
 * userId is derived server-side from the JWT; no need to pass it here.
 */

const BASE = '/api';

function exposeServerFailure(response) {
  if (response.status !== 500 || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('budget:server-error', {
    detail: { requestId: response.headers.get('x-request-id') || '' },
  }));
}

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    exposeServerFailure(res);
    const responseText = await res.text().catch(() => '');
    let data = {};
    if (responseText && res.headers.get('content-type')?.includes('application/json')) {
      try { data = JSON.parse(responseText); } catch { /* Use the status-based fallback below. */ }
    }
    const temporaryGatewayFailure = [502, 503, 504].includes(res.status);
    const err = new Error(data.error || (temporaryGatewayFailure
      ? 'The service is temporarily unavailable. Please wait a moment and try again.'
      : `API error ${res.status}`));
    err.status = res.status;
    err.data   = data; // full response body available as err.data
    err.requestId = res.headers.get('x-request-id') || '';
    if (['ACCOUNT_INACTIVE', 'SESSION_REVOKED'].includes(data.code) && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('budget:session-ended', { detail: data }));
    }
    throw err;
  }
  const responseText = await res.text();
  return responseText ? JSON.parse(responseText) : null;
}

const get  = (path)       => req('GET',    path);
const post = (path, body) => req('POST',   path, body);
const patch= (path, body) => req('PATCH',  path, body);
const put  = (path, body) => req('PUT',    path, body);
const del  = (path, body) => req('DELETE', path, body);

export const api = {
  // ── Auth ──────────────────────────────────────────────────────────────────
  me:             ()                              => get('/auth/me'),
  login:          (email, password)              => post('/auth/login',    { email, password }),
  register:       (email, password, name)        => post('/auth/register', { email, password, name }),
  verifyRegistration: (otp)                     => post('/auth/register/verify', { otp }),
  resendRegistrationCode: ()                    => post('/auth/register/resend'),
  logout:         ()                             => post('/auth/logout'),
  revokeAllSessions: ()                          => post('/auth/sessions/revoke-all'),
  changePassword: (currentPassword, newPassword) => put('/auth/password',  { currentPassword, newPassword }),
  requestPasswordReset: (email)                  => post('/auth/password/forgot', { email }),
  verifyPasswordReset: (otp)                     => post('/auth/password/forgot/verify', { otp }),
  completePasswordReset: (newPassword)           => put('/auth/password/forgot/reset', { newPassword }),
  changeEmail:    (newEmail, password)            => put('/auth/email',     { newEmail, password }),
  verifyEmailChange: (otp)                        => post('/auth/email/verify', { otp }),
  verifyMfa:      (otp, rememberDevice = false)  => post('/auth/mfa/verify',  { otp, rememberDevice }),
  sendMfaCode:    ()                             => post('/auth/mfa/send'),
  toggleMfa:      (enable, otp)                  => post('/auth/mfa/toggle',  { enable, otp }),
  getMfaStatus:   ()                             => get('/auth/mfa/status'),

  // ── Administration ───────────────────────────────────────────────────────
  getAdminUsers:       ()                 => get('/admin/users'),
  getAdminUser:        (id)               => get(`/admin/users/${id}`),
  removeAdminTrustedDevice: (userId, deviceId) => del(`/admin/users/${userId}/trusted-devices/${encodeURIComponent(deviceId)}`),
  setUserActiveStatus: (id, isActive)     => patch(`/admin/users/${id}/status`, { isActive }),
  deleteAdminUser:     (id)               => del(`/admin/users/${id}`),
  resetUserSimplefinSyncCooldown: (id)     => patch(`/admin/users/${id}/simplefin/reset-sync-cooldown`),
  setAdminUserBetaFeature: (id, featureKey, enabled) => patch(`/admin/users/${id}/beta-features/${encodeURIComponent(featureKey)}`, { enabled }),
  getSecurityActivity: ()                  => get('/admin/security-activity'),
  getAdminCategories: ()                   => get('/admin/categories'),
  addAdminDefaultCategory: (name, color)   => post('/admin/categories/defaults', { name, color }),
  removeAdminDefaultCategory: (id)         => del(`/admin/categories/defaults/${encodeURIComponent(id)}`),
  unblockSecurityActivity: (id)            => post(`/admin/security-activity/${id}/unblock`),
  queryServiceTelemetry: (query)            => post('/admin/telemetry/query', { query }),
  getServiceLatency: (hours = 24)           => get(`/admin/telemetry/latency?hours=${hours === 168 ? 168 : 24}`),
  getIconSubmissions: ()                    => get('/admin/icon-submissions'),
  reviewIconSubmission: (id, status, reason = '') => patch(`/admin/icon-submissions/${id}`, { status, reason }),
  getApprovedIconRules: ()                  => get('/admin/icon-rules'),
  updateApprovedIconRule: async (id, formData) => {
    const icon = formData.get('icon');
    if (icon instanceof File && icon.size > 1024 * 1024) throw new Error('Icon uploads must be 1 MB or smaller.');
    if (icon instanceof File && (icon.type === 'image/svg+xml' || icon.name.toLowerCase().endsWith('.svg')) && icon.size > 256 * 1024) throw new Error('SVG icon uploads must be 256 KB or smaller.');
    const response = await fetch(`/api/icons/admin-rules/${encodeURIComponent(id)}`, { method: 'PATCH', credentials: 'include', body: formData });
    exposeServerFailure(response);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to update icon.');
    return data;
  },

  // ── Net worth history ────────────────────────────────────────────────────
  getNetWorth: () => get('/net-worth'),
  getFxStatus: () => get('/fx'),

  // ── Notifications ────────────────────────────────────────────────────────
  getNotifications: () => get('/notifications'),
  markNotificationRead: (id) => patch(`/notifications/${encodeURIComponent(id)}/read`),
  markAllNotificationsRead: () => patch('/notifications/read-all'),

  getSplitPeople: () => get('/split-people'),
  addSplitPerson: (name) => post('/split-people', { name }),
  deleteSplitPerson: (id) => del(`/split-people/${encodeURIComponent(id)}`),
  getTravelPlans: () => get('/travel-plans'),
  addTravelPlan: (plan) => post('/travel-plans', plan),
  updateTravelPlan: (id, plan) => put(`/travel-plans/${encodeURIComponent(id)}`, plan),
  deleteTravelPlan: (id) => del(`/travel-plans/${encodeURIComponent(id)}`),
  getTravelPreferences: () => get('/travel-plans/preferences'),
  updateTravelPreferences: (excludedCategoryIds) => put('/travel-plans/preferences', { excludedCategoryIds }),
  getBetaFeatures: () => get('/spending/beta-features'),
  getExpenseDiagnostics: (id) => get(`/spending/expense/${encodeURIComponent(id)}/diagnostics`),
  submitIcon: async (formData) => {
    const icon = formData.get('icon');
    if (icon instanceof File && icon.size > 1024 * 1024) throw new Error('Icon uploads must be 1 MB or smaller.');
    if (icon instanceof File && (icon.type === 'image/svg+xml' || icon.name.toLowerCase().endsWith('.svg')) && icon.size > 256 * 1024) throw new Error('SVG icon uploads must be 256 KB or smaller.');
    const response = await fetch('/api/icons/submissions', { method: 'POST', credentials: 'include', body: formData });
    exposeServerFailure(response);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to submit icon.');
    return data;
  },

  // ── SimpleFIN ────────────────────────────────────────────────────────────
  getSimplefinConnections: ()             => get('/simplefin/connections'),
  getSimplefinAccounts:    ()             => get('/simplefin/accounts'),
  getSimplefinSyncRuns:    ()             => get('/simplefin/sync-runs?limit=50'),
  connectSimplefin:        (setupToken)   => post('/simplefin/connections', { setupToken }),
  discoverSimplefin:       (connectionId) => post(`/simplefin/connections/${connectionId}/discover`),
  syncSimplefin:           (connectionId) => post(`/simplefin/connections/${connectionId}/sync`),
  setSimplefinAutoSync:    (connectionId, enabled) => patch(`/simplefin/connections/${connectionId}/auto-sync`, { enabled }),
  disconnectSimplefin:     (connectionId) => del(`/simplefin/connections/${connectionId}`),
  deleteSimplefinConnectionData: (connectionId, confirmation) => del(`/simplefin/connections/${connectionId}/data`, { confirmation }),
  reconnectSimplefin:      (connectionId, setupToken) => post(`/simplefin/connections/${connectionId}/reconnect`, { setupToken }),
  linkSimplefinAccount:     (accountId, localAccount, importFrom) => post(`/simplefin/accounts/${accountId}/link`, { localAccount, importFrom }),
  createAndLinkSimplefinAccount: (accountId, type, importFrom) => post(`/simplefin/accounts/${accountId}/create-and-link`, { type, importFrom }),
  setSimplefinImportRange:  (accountId, importFrom) => patch(`/simplefin/accounts/${accountId}/import-range`, { importFrom }),
  unlinkSimplefinAccount:   (accountId) => del(`/simplefin/accounts/${accountId}/link`),
  getSimplefinDuplicates:   () => get('/simplefin/duplicates'),
  getSimplefinClassificationReviews: () => get('/simplefin/classification-reviews'),
  resolveSimplefinClassification: (transactionId, classification) => patch(`/simplefin/classification-reviews/${transactionId}`, { classification }),
  resolveSimplefinDuplicate: (candidateId, action) => post(`/simplefin/duplicates/${candidateId}/resolve`, { action }),

  // ── Accounts ──────────────────────────────────────────────────────────────
  getAccounts:   ()             => get('/accounts'),
  addAccount:    (account)      => post('/accounts', account),
  updateAccount: (id, data)     => patch(`/accounts/${id}`, data),
  deleteAccount: (id)           => del(`/accounts/${id}`),

  // ── Credit Cards ──────────────────────────────────────────────────────────
  getCreditCards: ()            => get('/credit-cards'),
  addCreditCard:  (card)        => post('/credit-cards', card),

  // ── Bank Accounts ─────────────────────────────────────────────────────────
  getBankAccounts:   ()                   => get('/bank-accounts'),
  addBankAccount:    (account, updateId)  => post('/bank-accounts', { ...account, updateId }),
  deleteBankAccount: (account)            => del(`/bank-accounts/${account.id}`),

  // ── Trading Accounts ──────────────────────────────────────────────────────
  getTradingAccounts:   ()                  => get('/trading-accounts'),
  addTradingAccount:    (account, updateId) => post('/trading-accounts', { ...account, updateId }),
  deleteTradingAccount: (account)           => del(`/trading-accounts/${account.id}`),
  setFinancialAccountStatus: (type, id, isActive) => patch(`/financial-accounts/${type}/${encodeURIComponent(id)}/status`, { isActive }),
  setFinancialAccountNetWorthInclusion: (type, id, included) => patch(`/financial-accounts/${type}/${encodeURIComponent(id)}/net-worth`, { included }),

  // ── Spending & Expenses ───────────────────────────────────────────────────
  getAllSpending: ()                           => get('/spending'),
  getMonthlySpending: (userId, year, month)   => get(`/spending?year=${year}&month=${month}`),
  addExpense:    (userId, year, month, cardId, expenseData, updateId) =>
    post('/spending/expense', { year, month, cardId, expenseData, updateId }),
  updateExpense: (userId, year, month, cardId, expenseId, updateData) =>
    patch(`/spending/expense/${expenseId}`, { year, month, cardId, updateData }),
  deleteExpense: (userId, year, month, cardId, expenseId) =>
    del(`/spending/expense/${expenseId}`),
  updateExpenseSplit: (expenseId, mode, allocations) => put(`/spending/expense/${encodeURIComponent(expenseId)}/split`, { mode, allocations }),

  // ── Financial Profile & Goals ─────────────────────────────────────────────
  getFinancialProfile:    ()              => get('/profiles/me'),
  updateFinancialProfile: (userId, data)  => put('/profiles/me', data),
  addGoal:    (userId, goalData)          => post('/profiles/me/goals', goalData),
  updateGoal: (userId, goalId, goalData)  => patch(`/profiles/me/goals/${goalId}`, goalData),
  deleteGoal: (userId, goalId)            => del(`/profiles/me/goals/${goalId}`),

  // ── Categories ────────────────────────────────────────────────────────────
  getCategories:  ()                  => get('/categories'),
  addCategory:    (category)          => post('/categories', { name: category }),
  updateCategory: (name, color)       => patch(`/categories/${encodeURIComponent(name)}`, { color }),
  deleteCategory: (name)              => del(`/categories/${encodeURIComponent(name)}`),
  getCategoryRules: ()                => get('/categories/rules'),
  getMerchantRuleSuggestion: (expenseId) => get(`/categories/rules/from-expense/${encodeURIComponent(expenseId)}/suggestion`),
  rememberExpenseCategory: (expenseId, category, merchant, effectiveFrom) => post('/categories/rules/from-expense', { expenseId, category, merchant, effectiveFrom }),
  updateCategoryRule: (ruleId, merchant, effectiveFrom, category) => patch(`/categories/rules/${encodeURIComponent(ruleId)}`, { merchant, effectiveFrom, category }),
  deleteCategoryRule: (ruleId)        => del(`/categories/rules/${ruleId}`),

  // ── Subscriptions ─────────────────────────────────────────────────────────
  getDetectedSubscriptions: ()        => get('/subscriptions'),
  detectSubscriptions:      ()        => post('/subscriptions/detect'),
  removeSubscription:       (userId, id) => del(`/subscriptions/${id}`),
  linkSubscription:         (targetId, sourceId) => post(`/subscriptions/${targetId}/link`, { sourceId }),
  unlinkSubscription:       (sourceId) => del(`/subscriptions/links/${sourceId}`),
};
