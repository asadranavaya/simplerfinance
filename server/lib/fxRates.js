const { eq, lte, desc } = require('drizzle-orm');
const { db, sqlite } = require('../db');
const { fxRateSnapshots } = require('../db/schema');

const ECB_DAILY_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function parseEcbRates(xml) {
  const date = xml.match(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/i)?.[1];
  if (!date) throw new Error('ECB response did not include an observation date');
  const rates = new Map([['EUR', 1]]);
  const pattern = /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9]+(?:\.[0-9]+)?)['"]\s*\/>/gi;
  for (const match of xml.matchAll(pattern)) {
    const rate = Number(match[2]);
    if (Number.isFinite(rate) && rate > 0) rates.set(match[1], rate);
  }
  if (rates.size < 2) throw new Error('ECB response did not include exchange rates');
  return { date, rates };
}

function convertCurrency(amount, sourceCurrency, targetCurrency, rates) {
  const source = String(sourceCurrency || '').toUpperCase();
  const target = String(targetCurrency || '').toUpperCase();
  const value = Number(amount);
  const sourceRate = rates.get(source);
  const targetRate = rates.get(target);
  if (!Number.isFinite(value) || !sourceRate || !targetRate) return null;
  return value / sourceRate * targetRate;
}

function ratesForDate(rateDate) {
  const rows = db.select().from(fxRateSnapshots)
    .where(lte(fxRateSnapshots.rateDate, rateDate))
    .orderBy(desc(fxRateSnapshots.rateDate)).all();
  if (!rows.length) return { date: null, rates: new Map() };
  const selectedDate = rows[0].rateDate;
  return {
    date: selectedDate,
    rates: new Map(rows.filter(row => row.rateDate === selectedDate).map(row => [row.currency, Number(row.perEur)])),
  };
}

async function fetchEcbDailyRates() {
  const response = await fetch(ECB_DAILY_URL, { signal: AbortSignal.timeout(10000), headers: { Accept: 'application/xml' } });
  if (!response.ok) throw new Error(`ECB rate request failed with status ${response.status}`);
  const text = await response.text();
  if (text.length > 250000) throw new Error('ECB rate response exceeded the size limit');
  const parsed = parseEcbRates(text);
  const fetchedAt = new Date().toISOString();
  sqlite.transaction(() => {
    for (const [currency, rate] of parsed.rates) {
      const existing = db.select().from(fxRateSnapshots).where(eq(fxRateSnapshots.id, `${parsed.date}:${currency}`)).get();
      const values = { id: `${parsed.date}:${currency}`, rateDate: parsed.date, currency, perEur: String(rate), source: 'ECB', fetchedAt };
      if (existing) db.update(fxRateSnapshots).set(values).where(eq(fxRateSnapshots.id, existing.id)).run();
      else db.insert(fxRateSnapshots).values(values).run();
    }
  })();
  return { date: parsed.date, currencies: parsed.rates.size, fetchedAt };
}

function validCurrency(value) {
  const currency = String(value || '').toUpperCase();
  return CURRENCY_PATTERN.test(currency) ? currency : null;
}

module.exports = { ECB_DAILY_URL, convertCurrency, fetchEcbDailyRates, parseEcbRates, ratesForDate, validCurrency };
