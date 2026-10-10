function expenseCategories(expense) {
  const values = [
    ...(Array.isArray(expense?.categories) ? expense.categories : []),
    expense?.mainCategory,
    expense?.category,
  ];
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

export function displayCategoryForExpense(expense, selectedCategories) {
  const selected = new Set((selectedCategories || []).map(value => String(value || '').trim()).filter(Boolean));
  if (!selected.size) return null;
  const categories = expenseCategories(expense);
  const mainCategory = String(expense?.mainCategory || expense?.category || '').trim();
  if (mainCategory && selected.has(mainCategory) && categories.includes(mainCategory)) return mainCategory;
  return categories.find(category => selected.has(category)) || null;
}

export function selectCategoryExpenses(expenses, selectedCategories) {
  const seen = new Set();
  const selected = [];
  for (const expense of expenses || []) {
    const displayCategory = displayCategoryForExpense(expense, selectedCategories);
    if (!displayCategory) continue;
    const identity = expense.browserKey || `${expense.cardId || ''}:${expense.id || ''}:${expense.date || ''}:${expense.description || ''}:${expense.amount || ''}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    selected.push({ ...expense, displayCategory });
  }
  return selected;
}
