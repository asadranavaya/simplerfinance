const test = require('node:test');
const assert = require('node:assert/strict');
const { locationFromRecord, normalizedIp } = require('../server/lib/ipGeolocation');

test('normalizes valid forwarded IP addresses and rejects arbitrary input', () => {
  assert.equal(normalizedIp('::ffff:198.51.100.20'), '198.51.100.20');
  assert.equal(normalizedIp('not-an-ip'), null);
});

test('returns a privacy-conscious approximate location without coordinates', () => {
  assert.deepEqual(locationFromRecord({
    city: { names: { en: 'Seattle' } },
    subdivisions: [{ names: { en: 'Washington' }, iso_code: 'WA' }],
    country: { names: { en: 'United States' }, iso_code: 'US' },
    location: { latitude: 47.6, longitude: -122.3, time_zone: 'America/Los_Angeles', accuracy_radius: 20 },
  }), {
    label: 'Seattle, Washington, US', city: 'Seattle', region: 'Washington', country: 'United States',
    countryCode: 'US', timeZone: 'America/Los_Angeles', accuracyRadiusKm: 20,
  });
});
