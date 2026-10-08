const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSvg } = require('../server/lib/safeSvg');

test('accepts a self-contained vector icon', () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g"><stop stop-color="#fff"/></linearGradient></defs><path fill="url(#g)" d="M0 0h32v32H0z"/></svg>');
  assert.match(validateSvg(svg), /<svg/);
});

test('rejects executable and externally referenced SVG content', () => {
  for (const svg of [
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg/>',
    '<svg onload="alert(1)"><script>alert(1)</script></svg>',
    '<svg><image href="https://example.com/tracker.png"/></svg>',
    '<svg><path fill="url(https://example.com/a.svg#paint)"/></svg>',
  ]) assert.throws(() => validateSvg(Buffer.from(svg)), /SVG/);
});
