const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveSubscriptionIcon } = require('../server/lib/subscriptionIcons');

test('subscription icons prefer a merchant rule over the matching purchase category', () => {
  const categories = new Map([['discord', 'Entertainment']]);
  const matcher = (type, value) => type === 'merchant' && value === 'Discord'
    ? { source: 'merchant', alt: 'Discord' }
    : type === 'category' && value === 'Entertainment' ? { source: 'category' } : null;
  assert.equal(resolveSubscriptionIcon({ description: 'Discord', variants: [] }, categories, matcher).source, 'merchant');
});

test('subscription icons fall back to the primary category of a matching purchase', () => {
  const categories = new Map([['monthly service 123', 'Entertainment']]);
  const matcher = (type, value) => type === 'category' && value === 'Entertainment'
    ? { source: 'category', alt: 'Entertainment' }
    : null;
  const icon = resolveSubscriptionIcon({ description: 'Monthly Service #123', variants: [] }, categories, matcher);
  assert.deepEqual(icon, { source: 'category', alt: 'Entertainment' });
});
