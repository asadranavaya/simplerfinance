const test = require('node:test');
const assert = require('node:assert/strict');
const { convertCurrency, parseEcbRates, validCurrency } = require('../server/lib/fxRates');

test('parses dated ECB reference-rate observations', () => {
  const parsed = parseEcbRates(`<Cube><Cube time='2026-08-07'><Cube currency='USD' rate='1.20'/><Cube currency='GBP' rate='0.80'/></Cube></Cube>`);
  assert.equal(parsed.date, '2026-08-07');
  assert.equal(parsed.rates.get('EUR'), 1);
  assert.equal(parsed.rates.get('USD'), 1.2);
});

test('converts through reproducible EUR reference rates', () => {
  const rates = new Map([['EUR', 1], ['USD', 1.2], ['GBP', 0.8]]);
  assert.equal(convertCurrency(120, 'USD', 'GBP', rates), 80);
  assert.equal(convertCurrency(10, 'CAD', 'USD', rates), null);
  assert.equal(validCurrency('usd'), 'USD');
  assert.equal(validCurrency('US'), null);
});
