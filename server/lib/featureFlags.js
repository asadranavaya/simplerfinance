const { and, eq } = require('drizzle-orm');
const { db } = require('../db');
const { accountFeatureFlags } = require('../db/schema');

const FEATURES = Object.freeze({
  PURCHASE_DATA_INSPECTOR: 'purchase_data_inspector',
});
const FEATURE_KEYS = new Set(Object.values(FEATURES));

function isKnownFeature(featureKey) {
  return FEATURE_KEYS.has(featureKey);
}

function enabledFeatures(accountId) {
  if (!accountId) return [];
  return db.select({ featureKey: accountFeatureFlags.featureKey })
    .from(accountFeatureFlags)
    .where(eq(accountFeatureFlags.accountId, accountId)).all()
    .map(row => row.featureKey)
    .filter(isKnownFeature);
}

function hasFeature(accountId, featureKey) {
  if (!accountId || !isKnownFeature(featureKey)) return false;
  return Boolean(db.select({ featureKey: accountFeatureFlags.featureKey })
    .from(accountFeatureFlags)
    .where(and(eq(accountFeatureFlags.accountId, accountId), eq(accountFeatureFlags.featureKey, featureKey))).get());
}

function setFeature(accountId, featureKey, enabled, adminUserId) {
  if (!isKnownFeature(featureKey)) throw new Error('Unknown beta feature.');
  const where = and(eq(accountFeatureFlags.accountId, accountId), eq(accountFeatureFlags.featureKey, featureKey));
  if (!enabled) {
    db.delete(accountFeatureFlags).where(where).run();
    return false;
  }
  if (!hasFeature(accountId, featureKey)) {
    db.insert(accountFeatureFlags).values({
      accountId,
      featureKey,
      enabledAt: new Date().toISOString(),
      enabledBy: adminUserId,
    }).run();
  }
  return true;
}

module.exports = { FEATURES, enabledFeatures, hasFeature, isKnownFeature, setFeature };
