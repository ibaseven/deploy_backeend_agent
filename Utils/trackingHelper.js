/**
 * Utils/trackingHelper.js
 * Helpers pour la géolocalisation IP et le parsing User-Agent.
 * Compatible Traefik (X-Forwarded-For transmis automatiquement).
 */

let geoip;
let UAParser;

try {
  geoip = require('geoip-lite');
} catch {
  console.warn('⚠️  geoip-lite non disponible — géolocalisation désactivée');
}

try {
  UAParser = require('ua-parser-js');
} catch {
  console.warn('⚠️  ua-parser-js non disponible — parsing UA désactivé');
}

// ─── IP ──────────────────────────────────────────────────────────────────────
/**
 * Extraire la vraie IP du client.
 * Traefik transmet X-Forwarded-For automatiquement (pas de config nécessaire).
 * On active app.set('trust proxy', 1) dans index.js → req.ip est déjà correct.
 */
function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || null;
}

// ─── GEO ─────────────────────────────────────────────────────────────────────
const PRIVATE_PREFIXES = ['192.168.', '10.', '172.16.', '172.17.', '172.18.',
  '172.19.', '172.20.', '172.21.', '172.22.', '172.23.', '172.24.',
  '172.25.', '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.'];

function isPrivateIP(ip) {
  if (!ip) return true;
  if (ip === '::1' || ip === '127.0.0.1') return true;
  const clean = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  return PRIVATE_PREFIXES.some(p => clean.startsWith(p));
}

function getGeoLocation(ip) {
  if (isPrivateIP(ip)) return { country: 'Local', city: 'Local' };
  if (!geoip) return { country: null, city: null };
  try {
    const clean = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
    const geo = geoip.lookup(clean);
    return { country: geo?.country || null, city: geo?.city || null };
  } catch {
    return { country: null, city: null };
  }
}

// ─── UA ──────────────────────────────────────────────────────────────────────
function parseUserAgent(userAgent) {
  if (!userAgent || !UAParser) return { browser: null, os: null, device: 'desktop' };
  try {
    const parser = new UAParser(userAgent);
    const result = parser.getResult();
    return {
      browser: result.browser?.name || null,
      os:      result.os?.name     || null,
      device:  result.device?.type || 'desktop', // 'mobile' | 'tablet' | 'desktop'
    };
  } catch {
    return { browser: null, os: null, device: 'desktop' };
  }
}

// ─── Agrégateur ──────────────────────────────────────────────────────────────
function collectTrackingInfo(req) {
  const ip  = getClientIP(req);
  const geo = getGeoLocation(ip);
  const ua  = parseUserAgent(req.headers['user-agent']);
  return {
    ipAddress: ip,
    country:   geo.country,
    city:      geo.city,
    browser:   ua.browser,
    os:        ua.os,
    device:    ua.device,
    userAgent: req.headers['user-agent'] || null,
  };
}

module.exports = { getClientIP, getGeoLocation, parseUserAgent, collectTrackingInfo };
