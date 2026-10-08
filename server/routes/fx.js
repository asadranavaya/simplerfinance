const { Router } = require('express');
const { desc } = require('drizzle-orm');
const { db } = require('../db');
const { fxRateSnapshots } = require('../db/schema');
const router = Router();
router.get('/', (_req, res) => {
  const rows = db.select().from(fxRateSnapshots).orderBy(desc(fxRateSnapshots.rateDate)).all();
  const rateDate = rows[0]?.rateDate || null;
  const latest = rateDate ? rows.filter(row => row.rateDate === rateDate) : [];
  res.json({ source: 'European Central Bank', rateDate, fetchedAt: latest[0]?.fetchedAt || null, currencies: [...new Set(['USD', ...latest.map(row => row.currency)])].sort() });
});
module.exports = router;
