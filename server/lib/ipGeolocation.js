const fs = require('fs');
const path = require('path');
const net = require('net');
const maxmind = require('maxmind');

let readerPromise;

function databasePath() {
  return path.resolve(process.env.MAXMIND_CITY_DB_PATH || '/usr/share/GeoIP/GeoLite2-City.mmdb');
}

function normalizedIp(value) {
  const candidate = String(value || '').trim().replace(/^::ffff:/, '');
  return net.isIP(candidate) ? candidate : null;
}

async function reader() {
  if (readerPromise !== undefined) return readerPromise;
  const file = databasePath();
  readerPromise = fs.existsSync(file) ? maxmind.open(file).catch(() => null) : Promise.resolve(null);
  return readerPromise;
}

function locationFromRecord(record) {
  if (!record) return null;
  const city = record.city?.names?.en || null;
  const subdivision = record.subdivisions?.[0];
  const region = subdivision?.names?.en || subdivision?.iso_code || null;
  const country = record.country?.names?.en || record.registered_country?.names?.en || null;
  const countryCode = record.country?.iso_code || record.registered_country?.iso_code || null;
  const parts = [city, region, countryCode || country].filter(Boolean);
  if (!parts.length) return null;
  return {
    label: parts.join(', '),
    city,
    region,
    country,
    countryCode,
    timeZone: record.location?.time_zone || null,
    accuracyRadiusKm: Number.isFinite(record.location?.accuracy_radius) ? record.location.accuracy_radius : null,
  };
}

async function lookupIpLocation(value) {
  const ip = normalizedIp(value);
  if (!ip) return null;
  const lookup = await reader();
  if (!lookup) return null;
  try { return locationFromRecord(lookup.get(ip)); } catch { return null; }
}

module.exports = { locationFromRecord, lookupIpLocation, normalizedIp };
