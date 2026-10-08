const MAX_SVG_BYTES = 256 * 1024;
const MAX_SVG_ELEMENTS = 5000;

function validateSvg(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_SVG_BYTES) throw new Error('SVG source is too large');
  const source = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  if (!/<svg\b/i.test(source) || (source.match(/<svg\b/gi) || []).length !== 1) throw new Error('Invalid SVG document');
  if ((source.match(/</g) || []).length > MAX_SVG_ELEMENTS) throw new Error('SVG is too complex');
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet|<script\b|<foreignObject\b|<iframe\b|<object\b|<embed\b|<image\b/i.test(source)) throw new Error('Unsafe SVG content');
  if (/\son[a-z][a-z0-9:_-]*\s*=/i.test(source) || /javascript\s*:|data\s*:\s*text\/html|@import/i.test(source)) throw new Error('Unsafe SVG behavior');
  for (const match of source.matchAll(/(?:href|xlink:href)\s*=\s*(["'])(.*?)\1/gi)) {
    if (!match[2].trim().startsWith('#')) throw new Error('External SVG references are not allowed');
  }
  for (const match of source.matchAll(/url\s*\(\s*(["']?)(.*?)\1\s*\)/gi)) {
    if (!match[2].trim().startsWith('#')) throw new Error('External SVG resources are not allowed');
  }
  return source;
}

module.exports = { MAX_SVG_BYTES, validateSvg };
