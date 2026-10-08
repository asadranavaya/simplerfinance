const { desc } = require('drizzle-orm');
const { db } = require('../db');
const { fxRateSnapshots } = require('../db/schema');
const { fetchEcbDailyRates } = require('./fxRates');
async function refreshRatesIfStale() {
  const latest = db.select().from(fxRateSnapshots).orderBy(desc(fxRateSnapshots.fetchedAt)).get();
  if (latest && Date.now() - new Date(latest.fetchedAt).getTime() < 20 * 60 * 60 * 1000) return null;
  try { return await fetchEcbDailyRates(); }
  catch (error) { console.error('[FX] ECB refresh failed:', String(error?.message || error).slice(0, 200)); return null; }
}
function startFxScheduler() {
  const startupTimer = setTimeout(refreshRatesIfStale, 20000); startupTimer.unref?.();
  const timer = setInterval(refreshRatesIfStale, 6 * 60 * 60 * 1000); timer.unref?.();
  return timer;
}
module.exports = { refreshRatesIfStale, startFxScheduler };
