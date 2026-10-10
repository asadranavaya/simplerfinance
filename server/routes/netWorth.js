const { Router } = require('express');
const { eq, and } = require('drizzle-orm');
const { db } = require('../db');
const { netWorthSnapshots } = require('../db/schema');
const { refreshCurrentNetWorth } = require('../lib/netWorthProjection');

const router = Router();

router.get('/', (req, res) => {
  const projection = refreshCurrentNetWorth(req.user.accountId);
  const history = db.select().from(netWorthSnapshots)
    .where(and(
      eq(netWorthSnapshots.userId, req.user.accountId),
      eq(netWorthSnapshots.reportingCurrency, projection.reportingCurrency)
    ))
    .orderBy(netWorthSnapshots.period).all().slice(-12);
  const previous = history.length > 1 ? history[history.length - 2].value : null;
  const changeAmount = previous === null ? null : projection.value - previous;
  const changePercent = previous === null || previous === 0 ? null : (changeAmount / Math.abs(previous)) * 100;

  res.json({
    value: projection.value,
    trackedValue: projection.trackedValue,
    hasUntrackedAccounts: projection.hasUntrackedAccounts,
    untrackedAccountCount: projection.untrackedAccountCount,
    changeAmount,
    changePercent,
    hasComparison: previous !== null,
    excludedCurrencies: projection.excludedCurrencies,
    staleAccounts: projection.staleAccounts,
    reportingCurrency: projection.reportingCurrency,
    fxRateDate: projection.fxRateDate,
    history: history.map((snapshot) => ({
      period: snapshot.period,
      label: new Date(Date.UTC(snapshot.year, snapshot.month - 1, 1)).toLocaleString('en-US', { month: 'short' }),
      value: snapshot.value,
      isFinal: snapshot.isFinal,
      capturedAt: snapshot.capturedAt,
    })),
  });
});

module.exports = router;
