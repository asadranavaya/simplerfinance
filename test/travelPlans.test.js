const test = require('node:test');
const assert = require('node:assert/strict');
const { isRoutineExpense, recordTravelTagSuppressions, travelTagAssignment } = require('../server/lib/travelPlans');

test('travel tagging excludes explicit monthly expenses and detected subscriptions', () => {
  assert.equal(isRoutineExpense({ description: 'Rent' }, { categories: ['Housing', 'Monthly Expense'] }, new Set(), new Set(['monthly expense'])), true);
  assert.equal(isRoutineExpense({ description: 'Rent' }, { categories: ['Housing', 'Monthly Expense'] }, new Set(), new Set()), false);
  assert.equal(isRoutineExpense({ description: 'NETFLIX' }, { categories: ['Entertainment'] }, new Set(['netflix'])), true);
  assert.equal(isRoutineExpense({ description: 'Museum' }, { categories: ['Entertainment'] }, new Set(['netflix'])), false);
});

test('trip names are additive within inclusive dates and removed when dates change', () => {
  const plan = { id: 'trip-1', name: 'Japan 2027', startDate: '2027-04-01', endDate: '2027-04-10' };
  const tagged = travelTagAssignment(
    { description: 'Museum', date: '2027-04-01' },
    { categories: ['Entertainment'], mainCategory: 'Entertainment' },
    [plan], new Set()
  );
  assert.deepEqual(tagged.categories, ['Entertainment', 'Travel', 'Japan 2027']);
  assert.equal(tagged.mainCategory, 'Entertainment');
  assert.deepEqual(tagged.travelTags, { 'trip-1': 'Japan 2027' });
  const removed = travelTagAssignment(
    { description: 'Museum', date: '2027-03-31' }, tagged, [plan], new Set()
  );
  assert.deepEqual(removed.categories, ['Entertainment']);
  assert.deepEqual(removed.travelTags, {});
});

test('a manually removed trip tag stays suppressed during later travel-plan passes', () => {
  const plan = { id: 'trip-1', name: 'Japan 2027', startDate: '2027-04-01', endDate: '2027-04-10' };
  const previouslyTagged = {
    categories: ['Entertainment', 'Japan 2027'],
    mainCategory: 'Entertainment',
    travelTags: { 'trip-1': 'Japan 2027' },
  };
  const travelTagSuppressions = recordTravelTagSuppressions(previouslyTagged, ['Entertainment']);
  assert.deepEqual(travelTagSuppressions, { 'trip-1': true });

  const reapplied = travelTagAssignment(
    { description: 'Museum', date: '2027-04-05' },
    { ...previouslyTagged, categories: ['Entertainment'], travelTagSuppressions },
    [plan], new Set()
  );
  assert.deepEqual(reapplied.categories, ['Entertainment']);
  assert.deepEqual(reapplied.travelTags, {});
  assert.deepEqual(reapplied.travelTagSuppressions, { 'trip-1': true });
});

test('manually restoring a trip tag clears its suppression', () => {
  const metadata = {
    categories: ['Entertainment'],
    travelTags: { 'trip-1': 'Japan 2027' },
    travelTagSuppressions: { 'trip-1': true },
  };
  assert.deepEqual(recordTravelTagSuppressions(metadata, ['Entertainment', 'Japan 2027']), {});
});

test('Travel becomes primary when a trip is detected without another primary tag', () => {
  const plan = { id: 'trip-1', name: 'Japan 2027', startDate: '2027-04-01', endDate: '2027-04-10' };
  const tagged = travelTagAssignment(
    { description: 'Dinner', date: '2027-04-05' },
    { categories: ['Food'], mainCategory: '' },
    [plan], new Set()
  );
  assert.deepEqual(tagged.categories, ['Food', 'Travel', 'Japan 2027']);
  assert.equal(tagged.mainCategory, 'Travel');
});

test('an existing non-travel primary tag takes precedence over a trip', () => {
  const plan = { id: 'trip-1', name: 'Japan 2027', startDate: '2027-04-01', endDate: '2027-04-10' };
  const tagged = travelTagAssignment(
    { description: 'Dinner', date: '2027-04-05' },
    { categories: ['Food'], mainCategory: 'Food' },
    [plan], new Set()
  );
  assert.equal(tagged.mainCategory, 'Food');
  assert.deepEqual(tagged.categories, ['Food', 'Travel', 'Japan 2027']);
});
