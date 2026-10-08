export default function SplitPurchaseFields({ people, draft, setDraft, maximum, assigned, saving, formatMoney }) {
  if (!people.length) return <p className="category-rule-notice">Add people under Settings → Split purchases first.</p>;
  const selectedIds = new Set(draft.allocations.map(allocation => allocation.personId));
  const eligible = people.filter(person => !selectedIds.has(person.id));
  const incomplete = draft.allocations.some(allocation => !(Number(allocation.value) > 0));

  const changeMode = mode => setDraft(current => ({
    ...current,
    mode,
    choosingPerson: false,
    allocations: current.allocations.map(allocation => ({ ...allocation, value: '' })),
  }));
  const addPerson = personId => {
    if (!personId || selectedIds.has(personId)) return;
    setDraft(current => ({
      ...current,
      choosingPerson: false,
      allocations: [...current.allocations, { personId, value: '' }],
    }));
  };
  const splitEvenly = () => setDraft(current => {
    const participantCount = current.allocations.length + 1;
    if (participantCount <= 1) return current;
    const equalPercent = Math.round((100 / participantCount) * 100) / 100;
    return {
      ...current,
      mode: 'percent',
      choosingPerson: false,
      allocations: current.allocations.map(allocation => ({ ...allocation, value: equalPercent })),
    };
  });

  return <>
    <div className="split-mode-toggle">
      <button type="button" className={draft.mode === 'percent' ? 'active' : ''} onClick={() => changeMode('percent')}>Percent</button>
      <button type="button" className={draft.mode === 'amount' ? 'active' : ''} onClick={() => changeMode('amount')}>Amount</button>
    </div>
    <div className="split-allocation-list">
      {draft.allocations.map(allocation => {
        const person = people.find(candidate => candidate.id === allocation.personId);
        if (!person) return null;
        return <label key={person.id}>
          <span>{person.name}</span>
          <input type="number" min="0.01" max={maximum} step="0.01" value={allocation.value} placeholder="0" onChange={event => {
            const value = event.target.value;
            setDraft(current => ({ ...current, allocations: current.allocations.map(item => item.personId === person.id ? { ...item, value: value === '' ? '' : Number(value) } : item) }));
          }} />
          <small>{draft.mode === 'percent' ? '%' : draft.expense.reportingCurrency || 'USD'}</small>
          <button type="button" className="split-person-remove" aria-label={`Remove ${person.name} from split`} onClick={() => setDraft(current => ({ ...current, allocations: current.allocations.filter(item => item.personId !== person.id) }))}>×</button>
        </label>;
      })}
      {eligible.length > 0 && (draft.choosingPerson
        ? <div className="split-person-picker">
          <select value="" autoFocus onChange={event => addPerson(event.target.value)}>
            <option value="" disabled>Select a person…</option>
            {eligible.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
          <button type="button" onClick={() => setDraft(current => ({ ...current, choosingPerson: false }))}>Cancel</button>
        </div>
        : <button type="button" className="split-add-person" onClick={() => setDraft(current => ({ ...current, choosingPerson: true }))}><span>+</span> Add person</button>)}
      {!draft.allocations.length && !draft.choosingPerson && <p className="split-empty-selection">Choose someone to split this purchase with.</p>}
    </div>
    {draft.allocations.length > 0 && <button type="button" className="split-evenly-button" onClick={splitEvenly}>
      Split evenly across {draft.allocations.length + 1} people (including you)
    </button>}
    <div className={`split-summary${assigned > maximum ? ' invalid' : ''}`}>
      <span>Others: {draft.mode === 'percent' ? `${assigned.toFixed(2)}%` : formatMoney(assigned, draft.expense.reportingCurrency)}</span>
      <strong>Your share: {draft.mode === 'percent' ? `${Math.max(0, 100 - assigned).toFixed(2)}%` : formatMoney(Math.max(0, maximum - assigned), draft.expense.reportingCurrency)}</strong>
    </div>
    <button type="submit" disabled={saving || incomplete || assigned > maximum}>{saving ? 'Saving…' : 'Save split'}</button>
  </>;
}
