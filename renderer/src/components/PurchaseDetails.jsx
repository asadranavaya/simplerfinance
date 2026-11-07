import { useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { ArrowLeft, Bell, Check, Plus, Search } from 'lucide-react';
import Sheet from './Sheet';
import SplitPurchaseFields from './SplitPurchaseFields';
import { purchaseMoney } from '../util/formatting';
import { api } from '../util/api';
import { announcePurchaseUpdate } from '../util/purchaseNavigation';

const localTime = value => { if (!value) return ''; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const savedDraft = purchase => ({ notes: purchase.notes || '', categories: purchase.tags || [], mainCategory: purchase.mainCategory || purchase.category || '', reminderEnabled: Boolean(purchase.reminder), dueAt: localTime(purchase.reminder?.dueAt), description: purchase.description, amount: String(purchase.originalAmount ?? purchase.amount), date: purchase.date || '' });

export default function PurchaseDetails({ expenseId, initialMode, onClose }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [mode, setMode] = useState(initialMode || 'details');
  const [categories, setCategories] = useState([]);
  const [people, setPeople] = useState([]);
  const [split, setSplit] = useState(null);
  const [splitBaseline, setSplitBaseline] = useState('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const allowNavigation = useRef(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    Promise.all([api.getExpenseDiagnostics(expenseId), api.getCategories(), api.getSplitPeople()]).then(([result, tags, members]) => {
      if (!active) return;
      const value = savedDraft(result.purchase);
      setData(result); setDraft(value); setBaseline(value); setCategories(tags); setPeople(members);
      const splitDraft = { expense: result.purchase, mode: result.purchase.split?.mode || 'percent', allocations: result.purchase.split?.allocations || [] };
      setSplit(splitDraft); setSplitBaseline(JSON.stringify({ mode: splitDraft.mode, allocations: splitDraft.allocations }));
    }).catch(error => { if (active) setError(error.message || 'Unable to load purchase.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [expenseId]);
  const splitValue = split ? JSON.stringify({ mode: split.mode, allocations: split.allocations }) : '';
  const dirty = Boolean(draft && (JSON.stringify(draft) !== JSON.stringify(baseline) || splitValue !== splitBaseline));
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !allowNavigation.current && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search));
  const navigationBlocked = blocker.state === 'blocked';
  useEffect(() => { if (navigationBlocked) setConfirmClose(true); }, [navigationBlocked]);
  const keepEditing = () => { if (navigationBlocked) blocker.reset(); setConfirmClose(false); };
  const discard = () => { allowNavigation.current = true; if (navigationBlocked) blocker.proceed(); else onClose(); };
  useEffect(() => {
    if (!dirty) return;
    const preventLoss = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [dirty]);
  const close = () => { if (saving) return; if (dirty) setConfirmClose(true); else onClose(); };
  const change = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  const toggleTag = name => {
    const selected = draft.categories.includes(name);
    if (!selected && draft.categories.length >= 20) { setError('Choose at most 20 categories.'); return; }
    const next = selected ? draft.categories.filter(tag => tag !== name) : [...draft.categories, name];
    setDraft(current => ({ ...current, categories: next, mainCategory: next.includes(current.mainCategory) ? current.mainCategory : next[0] || '' }));
  };
  const createCategory = async () => {
    if (!filter.trim() || saving) return;
    setSaving(true); setError('');
    try { const list = await api.addCategory(filter.trim()); setCategories(list); const match = list.find(tag => (typeof tag === 'string' ? tag : tag.name).toLocaleLowerCase() === filter.trim().toLocaleLowerCase()); const name = (typeof match === 'string' ? match : match?.name) || filter.trim(); if (!draft.categories.includes(name)) toggleTag(name); setFilter(''); }
    catch (error) { setError(error.message); }
    finally { setSaving(false); }
  };
  const maximum = split?.mode === 'percent' ? 100 : Math.abs(Number(draft?.amount || 0));
  const assigned = split?.allocations.reduce((sum, item) => sum + Number(item.value || 0), 0) || 0;
  const save = async () => {
    if (saving || !draft) return;
    setError('');
    const reminderChanged = draft.reminderEnabled !== baseline.reminderEnabled || draft.dueAt !== baseline.dueAt;
    if (reminderChanged && draft.reminderEnabled && (!draft.dueAt || new Date(draft.dueAt) <= new Date() || !Number.isFinite(new Date(draft.dueAt).getTime()))) { setError('Choose a future reminder date and time, or turn the reminder off.'); return; }
    if (!draft.description.trim() || !draft.date || !Number.isFinite(Number(draft.amount))) { setError('Enter a valid description, date, and amount.'); return; }
    if (assigned > maximum || split.allocations.some(item => !(Number(item.value) > 0))) { setError('Enter valid split values within the purchase total.'); return; }
    setSaving(true);
    let completed = '';
    try {
      const update = {};
      for (const key of ['notes', 'description']) if (draft[key] !== baseline[key]) update[key] = draft[key];
      if (JSON.stringify(draft.categories) !== JSON.stringify(baseline.categories) || draft.mainCategory !== baseline.mainCategory) { update.categories = draft.categories; update.mainCategory = draft.mainCategory; }
      if (data.purchase.source !== 'simplefin') {
        if (draft.amount !== baseline.amount) update.amount = Number(draft.amount);
        if (draft.date !== baseline.date) update.date = draft.date;
      }
      if (Object.keys(update).length) {
        const updated = await api.updateExpense(null, data.purchase.year, data.purchase.month, data.purchase.cardId, expenseId, update);
        if (!updated?.id) throw new Error('This purchase is no longer available.');
        announcePurchaseUpdate(updated);
        completed = 'Purchase changes saved. ';
      }
      setBaseline(current => ({ ...current, notes: draft.notes, categories: draft.categories, mainCategory: draft.mainCategory, description: draft.description, amount: draft.amount, date: draft.date }));
      if (splitValue !== splitBaseline) { const result = await api.updateExpenseSplit(expenseId, split.mode, split.allocations); setSplitBaseline(splitValue); announcePurchaseUpdate(result); completed = 'Purchase and split changes saved. '; }
      if (reminderChanged) {
        await api.setPurchaseReminder(expenseId, draft.reminderEnabled ? new Date(draft.dueAt).toISOString() : null);
        announcePurchaseUpdate({ id: expenseId });
      }
      allowNavigation.current = true;
      onClose();
    } catch (error) { setError(completed + (error.message || 'Unable to save. Please try again.')); }
    finally { setSaving(false); }
  };
  const names = [...new Set([...draft?.categories || [], ...categories.map(category => typeof category === 'string' ? category : category.name)])].filter(name => name.toLocaleLowerCase() !== 'uncategorized');
  return <Sheet title={mode === 'tags' ? 'Categories & tags' : 'Purchase details'} subtitle={data?.purchase.description} onClose={close} className="ux-purchase-inspector" footer={draft && <>
    {confirmClose ? <div className="ux-confirm-close" role="alert"><p>Discard your unsaved changes?</p><button type="button" className="ux-secondary" onClick={keepEditing}>Keep editing</button><button type="button" className="ux-danger" onClick={discard}>Discard changes</button></div> : <button type="button" className="ux-primary" onClick={mode === 'tags' ? () => setMode('details') : save} disabled={saving}>{saving ? 'Saving…' : mode === 'tags' ? `Done · ${draft.categories.length} selected` : 'Save changes'}</button>}
    <p className="ux-helper" role="status">{mode === 'tags' ? 'Selections are saved with the purchase.' : dirty ? 'You have unsaved changes.' : 'Your purchase is up to date.'}</p>
  </>}>
    {loading && <p role="status">Loading purchase…</p>}{error && <p className="ux-error" role="alert">{error}</p>}
    {!loading && !draft && <button type="button" className="ux-secondary" onClick={onClose}>Close</button>}
    {draft && mode === 'tags' && <>
      <button type="button" className="ux-text-button" onClick={() => setMode('details')}><ArrowLeft size={16} /> Purchase details</button>
      <label className="ux-search"><Search size={18} /><input aria-label="Search or create a category" placeholder="Search or create a category" maxLength={80} value={filter} onChange={event => setFilter(event.target.value)} /></label>
      <p className="ux-helper">Choose tags. Your primary category is used in charts.</p>
      <div className="ux-category-options">{names.filter(name => name.toLocaleLowerCase().includes(filter.toLocaleLowerCase())).map(name => <div key={name} className="ux-category-option">
        <label><input type="checkbox" checked={draft.categories.includes(name)} onChange={() => toggleTag(name)} /><span>{name}</span></label>
        {draft.categories.includes(name) && <button type="button" className="ux-text-button" aria-pressed={draft.mainCategory === name} onClick={() => change('mainCategory', name)}>{draft.mainCategory === name ? <><Check size={14} /> Primary</> : 'Set primary'}</button>}
      </div>)}</div>
      {filter.trim() && !names.some(name => name.toLocaleLowerCase() === filter.trim().toLocaleLowerCase()) && <button type="button" className="ux-text-button" onClick={createCategory} disabled={saving}><Plus size={17} /> Create “{filter.trim()}”</button>}
      <details className="ux-advanced"><summary>Category colors</summary>{categories.filter(category => typeof category !== 'string').map(category => <label className="ux-color-option" key={category.name}>{category.name}<input type="color" aria-label={`Color for ${category.name}`} value={category.color || '#6950cc'} onChange={async event => { try { setCategories(await api.updateCategory(category.name, event.target.value)); announcePurchaseUpdate({ id: expenseId }); } catch (error) { setError(error.message); } }} /></label>)}</details>
    </>}
    {draft && mode !== 'tags' && <>
      <div className="ux-purchase-summary">{data.purchase.icon?.url && <img className="ux-vendor-icon" src={data.purchase.icon.url} alt="" />}<strong>{data.purchase.description}</strong></div>
      <p className="ux-detail-amount">{purchaseMoney(data.purchase.paidAmount ?? data.purchase.amount, data.purchase.reportingCurrency)}</p>
      <p className="ux-helper">{data.purchase.date} · {data.purchase.source === 'simplefin' ? 'Synced purchase' : 'Manual purchase'}{data.purchase.split ? ` · Original ${purchaseMoney(data.purchase.originalAmount, data.purchase.reportingCurrency)}` : ''}</p>
      <div className="ux-section-line"><h3>Categories</h3><button type="button" className="ux-text-button" onClick={() => setMode('tags')}>Edit tags</button></div>
      <div className="ux-wrapping-tags">{draft.categories.map(name => <span className={`ux-chip ${name === draft.mainCategory ? '' : 'secondary'}`} key={name}>{name}</span>)}</div>
      <div className="ux-field"><label htmlFor="purchase-note">Purchase note</label><textarea id="purchase-note" value={draft.notes} onChange={event => change('notes', event.target.value)} maxLength={2000} rows={4} placeholder="Add a private note…" /></div>
      <div className="ux-section-line"><label className="ux-reminder-label" htmlFor="purchase-reminder-enabled"><Bell size={18} /> Remind me</label><input id="purchase-reminder-enabled" type="checkbox" className="ux-switch" checked={draft.reminderEnabled} onChange={event => change('reminderEnabled', event.target.checked)} /></div>
      {draft.reminderEnabled && <label className="ux-field">Reminder date and time<input type="datetime-local" value={draft.dueAt} onChange={event => change('dueAt', event.target.value)} /><small>{data.purchase.reminder?.deliveredAt ? 'This reminder has been delivered. Change the date to schedule it again.' : 'Appears in Activity at the scheduled time, in your local time zone.'}</small></label>}
      <details className="ux-advanced"><summary>Split purchase</summary><SplitPurchaseFields people={people} draft={split} setDraft={setSplit} maximum={maximum} assigned={assigned} saving={saving} formatMoney={purchaseMoney} showSubmit={false} /></details>
      <details className="ux-advanced"><summary>Edit purchase</summary><label className="ux-field">Description<input value={draft.description} maxLength={500} onChange={event => change('description', event.target.value)} /></label><label className="ux-field">Amount<input type="number" step="0.01" value={draft.amount} disabled={data.purchase.source === 'simplefin'} onChange={event => change('amount', event.target.value)} /></label><label className="ux-field">Date<input type="date" value={draft.date} disabled={data.purchase.source === 'simplefin'} onChange={event => change('date', event.target.value)} /></label>{data.purchase.source === 'simplefin' && <p className="ux-helper">Amount and date are supplied by your financial institution.</p>}</details>
      {data.diagnosticsEnabled && <details className="ux-advanced"><summary>Application metadata & SimpleFIN data</summary><h3>Application metadata</h3><pre>{JSON.stringify(data.purchase.metadata, null, 2)}</pre><h3>SimpleFIN data</h3><pre>{JSON.stringify(data.simplefin || 'No provider payload for this purchase.', null, 2)}</pre></details>}
    </>}
  </Sheet>;
}
