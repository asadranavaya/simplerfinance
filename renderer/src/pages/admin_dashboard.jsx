import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ShieldCheck, ShieldAlert, LockOpen, Users, UserCheck, UserX, Search, ArrowLeft, Monitor, Fingerprint, Globe2, Clock3, RefreshCcw, Trash2, TriangleAlert, Pencil, Images, ChevronRight, Database, Play, FlaskConical, Tags, Palette } from 'lucide-react';
import { api } from '../util/api';
import LatencyTelemetryDashboard from '../components/LatencyTelemetryDashboard';

export default function AdminDashboard() {
  const location = useLocation();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [updatingId, setUpdatingId] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [userDetails, setUserDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [resettingSync, setResettingSync] = useState(false);
  const [syncResetMessage, setSyncResetMessage] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletingUser, setDeletingUser] = useState(false);
  const [securityEvents, setSecurityEvents] = useState([]);
  const [securityLoading, setSecurityLoading] = useState(true);
  const [unblockingEventId, setUnblockingEventId] = useState(null);
  const [removingDeviceId, setRemovingDeviceId] = useState(null);
  const [updatingBetaFeature, setUpdatingBetaFeature] = useState(null);
  const [iconSubmissions, setIconSubmissions] = useState([]);
  const [reviewingIconId, setReviewingIconId] = useState(null);
  const [creatingIconRule, setCreatingIconRule] = useState(false);
  const [approvedIconRules, setApprovedIconRules] = useState([]);
  const [editingIconRule, setEditingIconRule] = useState(null);
  const [savingIconRule, setSavingIconRule] = useState(false);
  const [approvedIconsOpen, setApprovedIconsOpen] = useState(false);
  const [telemetryQuery, setTelemetryQuery] = useState('SELECT start_time, method, data_plane_call, status_code, latency_ms, subscriber_id, user_type, counters, request_id\nFROM service_request_logs\nORDER BY start_time DESC\nLIMIT 100');
  const [telemetryResult, setTelemetryResult] = useState(null);
  const [telemetryLoading, setTelemetryLoading] = useState(false);
  const [telemetryError, setTelemetryError] = useState('');
  const [adminCategories, setAdminCategories] = useState({ defaults: [], candidates: [] });
  const [categorySelection, setCategorySelection] = useState('');
  const [updatingCategory, setUpdatingCategory] = useState(false);
  const adminView = ({
    '/admin/accounts': 'accounts',
    '/admin/site-identity': 'siteIdentity',
    '/admin/icons': 'icons',
    '/admin/categories': 'categories',
    '/admin/security': 'security',
    '/admin/telemetry': 'telemetry',
  })[location.pathname] || 'hub';

  useEffect(() => {
    setSelectedUser(null);
    setUserDetails(null);
    setConfirmingDelete(false);
    setApprovedIconsOpen(false);
    setEditingIconRule(null);
  }, [adminView]);

  useEffect(() => {
    api.getAdminUsers()
      .then(({ users: rows }) => setUsers(rows))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);
  const loadAdminCategories = () => api.getAdminCategories().then(setAdminCategories);
  useEffect(() => { loadAdminCategories().catch(err => setError(err.message)); }, []);

  const promoteDefaultCategory = async () => {
    const candidate = adminCategories.candidates.find(item => item.name === categorySelection);
    if (!candidate) return;
    setUpdatingCategory(true); setError('');
    try { await api.addAdminDefaultCategory(candidate.name, candidate.color); setCategorySelection(''); await loadAdminCategories(); }
    catch (err) { setError(err.message); }
    finally { setUpdatingCategory(false); }
  };
  const removeDefaultCategory = async (category) => {
    setUpdatingCategory(true); setError('');
    try { await api.removeAdminDefaultCategory(category.id); await loadAdminCategories(); }
    catch (err) { setError(err.message); }
    finally { setUpdatingCategory(false); }
  };
  const loadApprovedIcons = () => api.getApprovedIconRules().then(({ rules }) => setApprovedIconRules(rules));
  useEffect(() => {
    Promise.all([
      api.getIconSubmissions().then(({ submissions }) => setIconSubmissions(submissions)),
      loadApprovedIcons(),
    ]).catch(err => setError(err.message));
  }, []);

  const reviewIcon = async (id, status) => {
    setReviewingIconId(id);
    try { await api.reviewIconSubmission(id, status); setIconSubmissions(current => current.filter(item => item.id !== id)); if (status === 'approved') await loadApprovedIcons(); }
    catch (err) { setError(err.message); } finally { setReviewingIconId(null); }
  };
  const saveApprovedIcon = async (event) => {
    event.preventDefault(); setSavingIconRule(true); setError('');
    try {
      await api.updateApprovedIconRule(editingIconRule.id, new FormData(event.currentTarget));
      await loadApprovedIcons();
      setEditingIconRule(null);
    } catch (err) { setError(err.message); }
    finally { setSavingIconRule(false); }
  };
  const createIconRule = async (event) => {
    event.preventDefault(); setCreatingIconRule(true); setError('');
    try { await api.submitIcon(new FormData(event.currentTarget)); const result = await api.getIconSubmissions(); setIconSubmissions(result.submissions); event.currentTarget.reset(); }
    catch (err) { setError(err.message); } finally { setCreatingIconRule(false); }
  };

  useEffect(() => {
    api.getSecurityActivity()
      .then(({ events }) => setSecurityEvents(events))
      .catch((err) => setError(err.message))
      .finally(() => setSecurityLoading(false));
  }, []);

  const unblockSecurityEvent = async (eventId) => {
    setUnblockingEventId(eventId);
    setError('');
    try {
      const result = await api.unblockSecurityActivity(eventId);
      setSecurityEvents(current => current.map(event => event.id === eventId
        ? { ...event, isActive: false, clearedAt: result.clearedAt }
        : event));
    } catch (err) {
      setError(err.message);
    } finally {
      setUnblockingEventId(null);
    }
  };

  const stats = useMemo(() => ({
    total: users.length,
    active: users.filter((user) => user.isActive).length,
    inactive: users.filter((user) => !user.isActive).length,
  }), [users]);

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((user) =>
      [user.name, user.email, user.role].some((value) => value?.toLowerCase().includes(needle))
    );
  }, [query, users]);

  const toggleStatus = async (user) => {
    setUpdatingId(user.id);
    setError('');
    try {
      const nextStatus = !user.isActive;
      await api.setUserActiveStatus(user.id, nextStatus);
      setUsers((current) => current.map((item) =>
        item.id === user.id ? { ...item, isActive: nextStatus } : item
      ));
    } catch (err) {
      setError(err.message);
    } finally {
      setUpdatingId(null);
    }
  };

  const openUser = async (user) => {
    setSelectedUser(user);
    setUserDetails(null);
    setDetailsLoading(true);
    setError('');
    setSyncResetMessage('');
    try {
      const { user: details } = await api.getAdminUser(user.id);
      setUserDetails(details);
    } catch (err) {
      setError(err.message);
    } finally {
      setDetailsLoading(false);
    }
  };

  const closeUser = () => {
    setSelectedUser(null);
    setUserDetails(null);
    setConfirmingDelete(false);
  };

  const deleteUser = async () => {
    setDeletingUser(true);
    setError('');
    try {
      await api.deleteAdminUser(userDetails.id);
      setUsers(current => current.filter(user => user.id !== userDetails.id));
      closeUser();
    } catch (err) {
      setError(err.message);
      setConfirmingDelete(false);
    } finally {
      setDeletingUser(false);
    }
  };

  const resetSimplefinSyncCooldown = async () => {
    setResettingSync(true);
    setError('');
    setSyncResetMessage('');
    try {
      const result = await api.resetUserSimplefinSyncCooldown(userDetails.id);
      setUserDetails(current => ({
        ...current,
        simplefin: { ...current.simplefin, cooldownCount: 0 },
      }));
      setSyncResetMessage(result.connectionsUpdated
        ? `Sync cooldown cleared for ${result.connectionsUpdated} connection${result.connectionsUpdated === 1 ? '' : 's'}.`
        : 'No SimpleFIN connections required a reset.');
    } catch (err) {
      setError(err.message);
    } finally {
      setResettingSync(false);
    }
  };

  const removeTrustedDevice = async (deviceId) => {
    setRemovingDeviceId(deviceId);
    setError('');
    try {
      await api.removeAdminTrustedDevice(userDetails.id, deviceId);
      setUserDetails(current => ({
        ...current,
        trustedDevices: current.trustedDevices.filter(device => device.id !== deviceId),
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setRemovingDeviceId(null);
    }
  };

  const toggleBetaFeature = async (featureKey, enabled) => {
    setUpdatingBetaFeature(featureKey);
    setError('');
    try {
      const result = await api.setAdminUserBetaFeature(userDetails.id, featureKey, enabled);
      setUserDetails(current => ({ ...current, betaFeatures: result.betaFeatures }));
    } catch (err) {
      setError(err.message);
    } finally {
      setUpdatingBetaFeature(null);
    }
  };

  const formatDateTime = (value) => value
    ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : 'Never';
  const accountStatus = (user) => !user.emailVerifiedAt ? 'Pending verification' : user.isActive ? 'Active' : 'Inactive';
  const activeSecurityEvents = securityEvents.filter(event => event.isActive).length;
  const runTelemetryQuery = async (event) => {
    event?.preventDefault(); setTelemetryLoading(true); setTelemetryError('');
    try { setTelemetryResult(await api.queryServiceTelemetry(telemetryQuery)); }
    catch (err) { setTelemetryError(err.message); setTelemetryResult(null); }
    finally { setTelemetryLoading(false); }
  };
  const viewCopy = {
    hub: ['Admin control center', 'Choose a workspace to manage accounts, global assets, or application security.'],
    accounts: ['Account management', 'Review membership, access, trusted devices, and SimpleFIN controls.'],
    siteIdentity: ['Site identity', 'Manage the shared visual assets and category taxonomy used throughout the application.'],
    icons: ['Icon management', 'Review submissions and maintain global merchant, category, and institution icons.'],
    categories: ['Default categories', 'Choose privacy-neutral category names that every customer can use.'],
    security: ['Security operations', 'Review malicious activity and remove active server rate limits.'],
    telemetry: ['Service telemetry', 'Query the last seven days of authenticated data-plane request metrics.'],
  }[adminView];
  const returnToHub = () => {
    closeUser();
    setApprovedIconsOpen(false);
    setEditingIconRule(null);
    navigate('/admin');
  };
  const returnToParent = () => {
    if (['icons', 'categories'].includes(adminView)) navigate('/admin/site-identity');
    else returnToHub();
  };

  return (
    <main className="admin-dashboard dashboard-page">
      <header className="admin-header">
        <div>
          <div className="admin-eyebrow"><ShieldCheck size={16} /> Administration</div>
          <h1>{viewCopy[0]}</h1>
          <p>{viewCopy[1]}</p>
        </div>
        {adminView !== 'hub' && <button type="button" className="admin-workspace-back" onClick={returnToParent}><ArrowLeft size={17}/> {['icons', 'categories'].includes(adminView) ? 'Site identity' : 'Admin home'}</button>}
      </header>

      {error && adminView !== 'accounts' && <div className="admin-error admin-workspace-error" role="alert">{error}</div>}

      {adminView === 'hub' && <section className="admin-hub-grid" aria-label="Administration workspaces">
        <button type="button" className="admin-hub-card accounts" onClick={() => navigate('/admin/accounts')}>
          <span className="admin-hub-icon"><Users size={27}/></span><span className="admin-hub-copy"><small>Membership</small><strong>Accounts</strong><p>Manage access, account status, trusted devices, and SimpleFIN sync controls.</p></span><span className="admin-hub-metric"><b>{stats.total}</b> total</span><ChevronRight size={22}/>
        </button>
        <button type="button" className="admin-hub-card site-identity" onClick={() => navigate('/admin/site-identity')}>
          <span className="admin-hub-icon"><Palette size={27}/></span><span className="admin-hub-copy"><small>Global presentation</small><strong>Site identity</strong><p>Manage the shared icon library and default category taxonomy from one workspace.</p></span><span className="admin-hub-metric"><b>2</b> tools</span><ChevronRight size={22}/>
        </button>
        <button type="button" className="admin-hub-card security" onClick={() => navigate('/admin/security')}>
          <span className="admin-hub-icon"><ShieldAlert size={27}/></span><span className="admin-hub-copy"><small>Protection</small><strong>Security</strong><p>Investigate malicious activity, targeted identities, devices, and blocked sources.</p></span><span className="admin-hub-metric"><b>{activeSecurityEvents}</b> active</span><ChevronRight size={22}/>
        </button>
        <button type="button" className="admin-hub-card telemetry" onClick={() => navigate('/admin/telemetry')}>
          <span className="admin-hub-icon"><Database size={27}/></span><span className="admin-hub-copy"><small>Observability</small><strong>Service telemetry</strong><p>Query request latency, status codes, subscribers, roles, methods, and data-plane calls.</p></span><span className="admin-hub-metric"><b>7</b> days</span><ChevronRight size={22}/>
        </button>
      </section>}

      {adminView === 'siteIdentity' && <section className="admin-hub-grid admin-site-identity-grid" aria-label="Site identity workspaces">
        <button type="button" className="admin-hub-card icons" onClick={() => navigate('/admin/icons')}>
          <span className="admin-hub-icon"><Images size={27}/></span><span className="admin-hub-copy"><small>Visual assets</small><strong>Icon management</strong><p>Moderate customer submissions and maintain the approved global icon library.</p></span><span className="admin-hub-metric"><b>{iconSubmissions.length}</b> pending</span><ChevronRight size={22}/>
        </button>
        <button type="button" className="admin-hub-card categories" onClick={() => navigate('/admin/categories')}>
          <span className="admin-hub-icon"><Tags size={27}/></span><span className="admin-hub-copy"><small>Shared taxonomy</small><strong>Default categories</strong><p>Promote existing category names into the shared library without exposing who created them.</p></span><span className="admin-hub-metric"><b>{adminCategories.defaults.length}</b> defaults</span><ChevronRight size={22}/>
        </button>
      </section>}

      {adminView === 'accounts' && <div className="admin-workspace-view" key="accounts">
      <section className="admin-stat-grid" aria-label="Account summary">
        <article className="admin-stat-card admin-stat-total"><Users /><div><span>Total accounts</span><strong>{stats.total}</strong></div></article>
        <article className="admin-stat-card admin-stat-active"><UserCheck /><div><span>Active accounts</span><strong>{stats.active}</strong></div></article>
        <article className="admin-stat-card admin-stat-inactive"><UserX /><div><span>Inactive accounts</span><strong>{stats.inactive}</strong></div></article>
      </section>

      <section className={`admin-users-card admin-users-viewport${selectedUser ? ' showing-details' : ''}`}>
        <div className="admin-users-slider">
          <div className="admin-users-pane admin-list-pane">
            <div className="admin-users-toolbar">
              <div><h2>All accounts</h2><p>{filteredUsers.length} account{filteredUsers.length === 1 ? '' : 's'} shown · Select an account for details</p></div>
              <label className="admin-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search accounts" aria-label="Search accounts" /></label>
            </div>

            {error && !selectedUser && <div className="admin-error" role="alert">{error}</div>}
            {loading ? <div className="admin-empty">Loading accounts…</div> : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr><th>Account</th><th>Role</th><th>Joined</th><th>MFA</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {filteredUsers.map((user) => (
                      <tr key={user.id} className="admin-clickable-row" tabIndex={0} onClick={() => openUser(user)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') openUser(user); }}>
                        <td><div className="admin-account-cell"><span className="admin-account-avatar">{(user.name || user.email)[0].toUpperCase()}</span><div><strong>{user.name || 'Unnamed account'}</strong><span>{user.email}</span></div></div></td>
                        <td><span className={`admin-role admin-role-${user.role}`}>{user.role}</span></td>
                        <td>{new Date(user.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                        <td>{user.mfaEnabled ? 'Enabled' : 'Off'}</td>
                        <td><span className={`admin-status ${user.isActive ? 'is-active' : 'is-inactive'}`}><i />{accountStatus(user)}</span></td>
                        <td><button className={`admin-status-button ${user.isActive ? 'deactivate' : 'activate'}`} disabled={updatingId === user.id || !user.emailVerifiedAt} title={!user.emailVerifiedAt ? 'The user must verify their email first' : undefined} onClick={(event) => { event.stopPropagation(); toggleStatus(user); }}>{updatingId === user.id ? 'Saving…' : !user.emailVerifiedAt ? 'Awaiting email' : user.isActive ? 'Deactivate' : 'Activate'}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filteredUsers.length && <div className="admin-empty">No accounts match your search.</div>}
              </div>
            )}
          </div>

          <div className="admin-users-pane admin-details-pane" aria-hidden={!selectedUser}>
            <div className="admin-detail-toolbar">
              <button type="button" className="admin-back-button" onClick={closeUser}><ArrowLeft size={18} /> All accounts</button>
              <span>Account details</span>
            </div>
            {error && selectedUser && <div className="admin-error" role="alert">{error}</div>}
            {detailsLoading || !userDetails ? <div className="admin-empty">Loading account details…</div> : (
              <div className="admin-detail-content">
                <div className="admin-detail-profile">
                  <span className="admin-detail-avatar">{(userDetails.name || userDetails.email)[0].toUpperCase()}</span>
                  <div><h2>{userDetails.name || 'Unnamed account'}</h2><p>{userDetails.email}</p></div>
                  <span className={`admin-status ${userDetails.isActive ? 'is-active' : 'is-inactive'}`}><i />{accountStatus(userDetails)}</span>
                </div>
                <div className="admin-detail-facts">
                  <div><span>Role</span><strong>{userDetails.role}</strong></div>
                  <div><span>MFA</span><strong>{userDetails.mfaEnabled ? 'Enabled' : 'Off'}</strong></div>
                  <div><span>Member since</span><strong>{formatDateTime(userDetails.createdAt)}</strong></div>
                  <div><span>Email verified</span><strong>{formatDateTime(userDetails.emailVerifiedAt)}</strong></div>
                  <div><span>Trusted devices</span><strong>{userDetails.trustedDevices.length}</strong></div>
                </div>

                <div className="admin-simplefin-control">
                  <div className="admin-simplefin-control-icon"><RefreshCcw size={20} /></div>
                  <div>
                    <h3>SimpleFIN sync access</h3>
                    <p>{userDetails.simplefin.connectionCount
                      ? `${userDetails.simplefin.connectionCount} connection${userDetails.simplefin.connectionCount === 1 ? '' : 's'} · Last successful sync ${formatDateTime(userDetails.simplefin.lastSuccessfulSyncAt)}`
                      : 'This account has no SimpleFIN connections.'}</p>
                    {syncResetMessage && <span className="admin-simplefin-success" role="status">{syncResetMessage}</span>}
                  </div>
                  <button
                    type="button"
                    className="admin-reset-sync-button"
                    disabled={resettingSync || !userDetails.simplefin.connectionCount}
                    onClick={resetSimplefinSyncCooldown}
                  >
                    {resettingSync ? 'Clearing…' : 'Clear sync cooldown'}
                  </button>
                </div>

                <section className="admin-beta-features" aria-labelledby="admin-beta-features-heading">
                  <div className="admin-beta-heading">
                    <span><FlaskConical size={20} /></span>
                    <div><h3 id="admin-beta-features-heading">Beta features</h3><p>Opt this customer into experimental capabilities. Features are disabled by default.</p></div>
                  </div>
                  <label className="admin-beta-option">
                    <span><strong>Purchase data inspector</strong><small>Clicking a purchase opens a formatted view of local metadata, tags, and the complete stored SimpleFIN transaction payload.</small></span>
                    <span className="simplefin-switch">
                      <input
                        type="checkbox"
                        checked={(userDetails.betaFeatures || []).includes('purchase_data_inspector')}
                        disabled={updatingBetaFeature === 'purchase_data_inspector'}
                        onChange={event => toggleBetaFeature('purchase_data_inspector', event.target.checked)}
                      />
                      <span aria-hidden="true" />
                    </span>
                  </label>
                </section>

                <div className="admin-devices-heading"><div><h3>Trusted devices</h3><p>Device tokens are hashed. Only safe signature fingerprints are shown.</p></div><ShieldCheck size={22} /></div>
                {userDetails.trustedDevices.length ? (
                  <div className="admin-device-list">
                    {userDetails.trustedDevices.map((device) => (
                      <article className="admin-device-card" key={device.id}>
                        <div className="admin-device-title"><span><Monitor size={19} /></span><div><strong>{device.deviceName}</strong><small className={device.isExpired ? 'expired' : ''}>{device.isExpired ? 'Expired' : 'Trusted until ' + formatDateTime(device.expiresAt)}</small></div><button type="button" className="admin-device-remove" disabled={removingDeviceId === device.id} onClick={() => removeTrustedDevice(device.id)} title="Remove trusted device"><Trash2 size={15} />{removingDeviceId === device.id ? 'Removing…' : 'Remove'}</button></div>
                        <dl>
                          <div><dt><Fingerprint size={15} /> Signature</dt><dd><code>{device.signature}</code></dd></div>
                          <div><dt><Globe2 size={15} /> Last used IP</dt><dd>{device.lastIp || 'Unavailable'}<small className="admin-ip-location">{device.approximateLocation?.label || 'Approximate location unavailable'}</small></dd></div>
                          <div><dt><Clock3 size={15} /> First connection</dt><dd>{formatDateTime(device.createdAt)}</dd></div>
                          <div><dt><Clock3 size={15} /> Last connection</dt><dd>{formatDateTime(device.lastUsedAt)}</dd></div>
                        </dl>
                      </article>
                    ))}
                  </div>
                ) : <div className="admin-no-devices"><Monitor size={28} /><strong>No trusted devices</strong><span>This user must verify with email at each MFA login.</span></div>}

                {!userDetails.isActive && userDetails.role !== 'admin' && (
                  <div className="admin-delete-zone">
                    <div className="admin-delete-copy">
                      <span><TriangleAlert size={20} /></span>
                      <div><h3>Permanently delete account</h3><p>This removes the login and all financial, spending, category, device, and SimpleFIN data. This cannot be undone.</p></div>
                    </div>
                    {confirmingDelete ? (
                      <div className="admin-delete-confirm">
                        <strong>Delete {userDetails.email} permanently?</strong>
                        <button type="button" className="admin-delete-cancel" disabled={deletingUser} onClick={() => setConfirmingDelete(false)}>Cancel</button>
                        <button type="button" className="admin-delete-button" disabled={deletingUser} onClick={deleteUser}>{deletingUser ? 'Deleting…' : 'Yes, delete account'}</button>
                      </div>
                    ) : (
                      <button type="button" className="admin-delete-button" onClick={() => setConfirmingDelete(true)}><Trash2 size={16} /> Delete account</button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
      </div>}

      {adminView === 'icons' && <div className="admin-workspace-view" key="icons">
      <section className="admin-security-card admin-icon-review-card">
        <div className="admin-security-header"><div><h2>Icon review queue</h2><p>Approve curated merchant and institution rules for every customer.</p></div><strong>{iconSubmissions.length} / 50 pending</strong></div>
        <form className="admin-icon-create" onSubmit={createIconRule}><select name="entityType" defaultValue="category"><option value="category">Category</option><option value="merchant">Merchant</option><option value="institution">Institution</option><option value="financial_product">Financial product</option></select><input name="displayName" maxLength="80" placeholder="Display name" required/><input name="pattern" maxLength="100" placeholder="Match pattern" required/><input name="icon" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" required/><button type="submit" disabled={creatingIconRule}>{creatingIconRule?'Uploading…':'Add to review'}</button></form>
        {iconSubmissions.length ? <div className="admin-icon-review-grid">{iconSubmissions.map(item => <article key={item.id}><img src={item.iconUrl} alt="" /><div><strong>{item.displayName}</strong><span>{item.entityType} · contains “{item.pattern}”</span><small>{item.exampleText || 'No example supplied'} · {Math.ceil(item.byteSize/1024)} KB normalized</small></div><div><button type="button" disabled={reviewingIconId === item.id} onClick={() => reviewIcon(item.id,'rejected')}>Reject</button><button type="button" disabled={reviewingIconId === item.id} onClick={() => reviewIcon(item.id,'approved')}>Approve</button></div></article>)}</div> : <div className="admin-security-empty"><ShieldCheck size={25}/><div><strong>Queue is empty</strong><span>Customer icon proposals will appear here.</span></div></div>}

        <div className={`admin-icon-library-viewport${approvedIconsOpen ? ' showing-library' : ''}`}>
          <div className="admin-icon-library-slider">
            <div className="admin-icon-library-pane admin-icon-library-launch-pane">
              <button type="button" className="admin-icon-library-launcher" onClick={() => setApprovedIconsOpen(true)}>
                <span className="admin-icon-library-symbol"><Images size={22}/></span>
                <span><strong>Approved icon library</strong><small>Edit matching rules or replace an existing image.</small></span>
                <span className="admin-icon-library-count">{approvedIconRules.length} active</span>
                <ChevronRight size={18}/>
              </button>
            </div>
            <div className="admin-icon-library-pane admin-icon-library-detail-pane" aria-hidden={!approvedIconsOpen}>
              <div className="admin-approved-icons-header"><button type="button" className="admin-back-button" onClick={() => setApprovedIconsOpen(false)}><ArrowLeft size={16}/> Back</button><div><h3>Approved icons</h3><p>Edit matching behavior or replace an existing image.</p></div><strong>{approvedIconRules.length} active</strong></div>
              {approvedIconRules.length ? <div className="admin-icon-review-grid admin-approved-icon-grid">{approvedIconRules.map(rule => (
                <article key={rule.id}>
                  <img src={`${rule.iconUrl}?v=${encodeURIComponent(rule.updatedAt || '')}`} alt="" />
                  <div><strong>{rule.displayName}</strong><span>{rule.entityType} · {rule.matchType} “{rule.pattern}”</span><small>Priority {rule.priority}</small></div>
                  <div><button type="button" onClick={() => setEditingIconRule(rule)}><Pencil size={13}/> Edit</button></div>
                </article>
              ))}</div> : <div className="admin-security-empty"><ShieldCheck size={25}/><div><strong>No approved icons</strong><span>Approved submissions will be available to edit here.</span></div></div>}
            </div>
          </div>
        </div>
      </section>

      {editingIconRule && <div className="modal-overlay" onMouseDown={() => !savingIconRule && setEditingIconRule(null)}>
        <form className="modal-content admin-icon-edit-modal" onSubmit={saveApprovedIcon} onMouseDown={event => event.stopPropagation()}>
          <div className="modal-header"><div><h2>Edit approved icon</h2><p>Changes take effect globally as soon as they are saved.</p></div><button type="button" className="modal-close" aria-label="Close" onClick={() => setEditingIconRule(null)}>×</button></div>
          <div className="admin-icon-edit-preview"><img src={editingIconRule.iconUrl} alt=""/><span>Current image</span></div>
          <label className="form-group">Type<select className="form-input" name="entityType" defaultValue={editingIconRule.entityType}><option value="category">Category</option><option value="merchant">Merchant</option><option value="institution">Institution</option><option value="financial_product">Financial product</option></select></label>
          <label className="form-group">Display name<input className="form-input" name="displayName" maxLength="80" defaultValue={editingIconRule.displayName} required/></label>
          <label className="form-group">Match pattern<input className="form-input" name="pattern" maxLength="100" defaultValue={editingIconRule.pattern} minLength="3" required/></label>
          <div className="admin-icon-edit-row"><label className="form-group">Match method<select className="form-input" name="matchType" defaultValue={editingIconRule.matchType}><option value="contains">Contains</option><option value="exact">Exact</option></select></label><label className="form-group">Priority<input className="form-input" name="priority" type="number" min="-100" max="100" defaultValue={editingIconRule.priority} required/></label></div>
          <label className="form-group">Replacement image <span className="input-hint">Optional · PNG, JPEG, WebP, or SVG · max 1 MB (SVG 256 KB)</span><input className="form-input" name="icon" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"/></label>
          <div className="modal-actions"><button type="button" className="btn-secondary" disabled={savingIconRule} onClick={() => setEditingIconRule(null)}>Cancel</button><button type="submit" className="btn-primary" disabled={savingIconRule}>{savingIconRule ? 'Saving…' : 'Save changes'}</button></div>
        </form>
      </div>}
      </div>}

      {adminView === 'categories' && <div className="admin-workspace-view" key="categories">
        <section className="admin-category-card">
          <div className="admin-category-heading"><div><span><Tags size={21}/></span><div><h2>Shared default library</h2><p>Names are deduplicated across customer-created categories. Customer identity and provenance are never displayed or stored with a default.</p></div></div><strong>{adminCategories.defaults.length} default{adminCategories.defaults.length === 1 ? '' : 's'}</strong></div>
          <div className="admin-category-promote">
            <label htmlFor="admin-category-candidate">Existing category</label>
            <div><select id="admin-category-candidate" className="form-input" value={categorySelection} onChange={event => setCategorySelection(event.target.value)}><option value="">Select a category name…</option>{adminCategories.candidates.map(category => <option key={category.name} value={category.name}>{category.name}</option>)}</select><button type="button" disabled={!categorySelection || updatingCategory} onClick={promoteDefaultCategory}>Make default</button></div>
            <small>Only the category name and color are shown. No customer attribution or usage counts are exposed.</small>
          </div>
          <div className="admin-default-category-list">
            {adminCategories.defaults.map(category => <article key={category.id}><span style={{ '--admin-category-color': category.color }} /><div><strong>{category.name}</strong><small>Available to every customer</small></div><button type="button" disabled={updatingCategory} onClick={() => removeDefaultCategory(category)}>Remove default</button></article>)}
            {!adminCategories.defaults.length && <div className="admin-security-empty"><Tags size={25}/><div><strong>No default categories yet</strong><span>Select a privacy-neutral category name above to make it available to all accounts.</span></div></div>}
          </div>
        </section>
      </div>}

      {adminView === 'security' && <div className="admin-workspace-view" key="security">
      <section className="admin-security-card" aria-labelledby="security-activity-heading">
        <div className="admin-security-header">
          <div className="admin-security-title"><span><ShieldAlert size={21} /></span><div><h2 id="security-activity-heading">Malicious activity</h2><p>Authentication sources currently or previously blocked by server rate limits.</p></div></div>
          <strong>{securityEvents.filter(event => event.isActive).length} active block{securityEvents.filter(event => event.isActive).length === 1 ? '' : 's'}</strong>
        </div>
        {securityLoading ? <div className="admin-empty">Loading security activity…</div> : securityEvents.length ? (
          <div className="admin-security-table-wrap">
            <table className="admin-security-table">
              <thead><tr><th>Reason</th><th>Emails attempted</th><th>Source</th><th>Activity</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{securityEvents.map(event => (
                <tr key={event.id}>
                  <td><strong>{event.reason}</strong></td>
                  <td>{event.attemptedEmails.length ? <div className="admin-security-emails">{event.attemptedEmails.map(email => <code key={email}>{email}</code>)}</div> : <span className="admin-security-muted">Not available</span>}</td>
                  <td><div className="admin-security-source"><span><Globe2 size={14} /> {event.ipAddress}</span><small className="admin-ip-location">{event.approximateLocation?.label || 'Approximate location unavailable'}</small><span><Fingerprint size={14} /> {event.deviceFingerprint || 'No signed device'}</span></div></td>
                  <td><div className="admin-security-source"><span>{event.hitCount} blocked request{event.hitCount === 1 ? '' : 's'}</span><span>Last: {formatDateTime(event.lastSeenAt)}</span></div></td>
                  <td><span className={`admin-security-status ${event.isActive ? 'active' : 'cleared'}`}>{event.isActive ? `Blocked until ${formatDateTime(event.blockedUntil)}` : event.clearedAt ? `Cleared ${formatDateTime(event.clearedAt)}` : 'No longer active'}</span></td>
                  <td>{event.isActive && <button type="button" className="admin-unblock-button" disabled={unblockingEventId === event.id} onClick={() => unblockSecurityEvent(event.id)}><LockOpen size={15} /> {unblockingEventId === event.id ? 'Removing…' : 'Remove limit'}</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <div className="admin-security-empty"><ShieldCheck size={25} /><div><strong>No rate-limit events recorded</strong><span>Blocked login, registration, and verification activity will appear here.</span></div></div>}
      </section>
      </div>}

      {adminView === 'telemetry' && <div className="admin-workspace-view" key="telemetry">
        <LatencyTelemetryDashboard />
        <section className="admin-telemetry-card">
          <div className="admin-telemetry-heading"><div className="admin-security-title"><span><Database size={21}/></span><div><h2>Service log SQL</h2><p>Read-only access to <code>service_request_logs</code>. Results are capped at 500 rows.</p></div></div><strong>7-day retention</strong></div>
          <div className="admin-telemetry-schema" aria-label="Available telemetry columns">
            {['request_id TEXT', 'subscriber_id TEXT', 'start_time TEXT', 'latency_ms REAL', 'status_code INTEGER', 'user_type TEXT', 'method TEXT', 'data_plane_call TEXT', 'counters JSON string-set'].map(column => <code key={column}>{column}</code>)}
          </div>
          <form className="admin-telemetry-query" onSubmit={runTelemetryQuery}>
            <label htmlFor="telemetry-sql">SQL query</label>
            <textarea id="telemetry-sql" value={telemetryQuery} maxLength={4000} spellCheck="false" onChange={event => setTelemetryQuery(event.target.value)} />
            <div><small>Only a single read-only SELECT or non-recursive WITH query is accepted.</small><button type="submit" disabled={telemetryLoading}><Play size={15}/>{telemetryLoading ? 'Running…' : 'Run query'}</button></div>
          </form>
          {telemetryError && <div className="admin-error admin-telemetry-error" role="alert">{telemetryError}</div>}
          {telemetryResult && <div className="admin-telemetry-results">
            <div><strong>{telemetryResult.rowCount} row{telemetryResult.rowCount === 1 ? '' : 's'}</strong>{telemetryResult.truncated && <span>Showing first {telemetryResult.maxRows} rows</span>}</div>
            {telemetryResult.columns.length ? <div className="admin-table-wrap"><table className="admin-table admin-telemetry-table"><thead><tr>{telemetryResult.columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{telemetryResult.rows.map((row, index) => <tr key={index}>{telemetryResult.columns.map(column => <td key={column}>{row[column] == null ? <span className="admin-security-muted">NULL</span> : typeof row[column] === 'object' ? JSON.stringify(row[column]) : String(row[column])}</td>)}</tr>)}</tbody></table></div> : <div className="admin-empty">The query returned no columns.</div>}
          </div>}
        </section>
      </div>}
    </main>
  );
}
