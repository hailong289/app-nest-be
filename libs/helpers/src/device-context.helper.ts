import type { Request } from 'express';
import * as geoip from 'geoip-lite';
import { UAParser } from 'ua-parser-js';
import type {
  DeviceContext,
  DeviceInfo,
  DeviceLocation,
} from 'libs/types';

/**
 * Detect private / loopback / link-local IPv4 + IPv6 ranges. Public
 * geo-IP lookups return useless data (or errors) for these — skip the
 * call entirely.
 */
export function isPrivateOrLocalIp(ip: string): boolean {
  if (!ip) return true;
  // IPv4-mapped IPv6 → strip prefix to expose the embedded IPv4.
  const stripped = ip.replace(/^::ffff:/, '');
  if (
    stripped === '127.0.0.1' ||
    stripped === '::1' ||
    stripped === '0.0.0.0' ||
    stripped.startsWith('10.') ||
    stripped.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(stripped) ||
    stripped.startsWith('169.254.') || // link-local
    stripped.startsWith('fc') || // ULA
    stripped.startsWith('fd') ||
    stripped.startsWith('fe80:') // IPv6 link-local
  ) {
    return true;
  }
  return false;
}

/**
 * Geo-IP lookup via offline `geoip-lite` (MaxMind GeoLite2 embedded).
 * 100% free, sync, < 1ms typical latency.
 *
 * Trade-offs vs paid (MaxMind GeoIP2 / ip-api Pro):
 *   - Country accuracy ~99.8%, city ~80% (fine for audit + suspicious-
 *     login detection)
 *   - DB refreshes monthly — bump `geoip-lite` package periodically
 *   - No ISP/ASN field (use commercial DB if you need this)
 */
export function lookupLocationByIp(ip: string): DeviceLocation | null {
  if (isPrivateOrLocalIp(ip)) return null;
  const normalized = ip.replace(/^::ffff:/, '');
  try {
    const geo = geoip.lookup(normalized);
    if (!geo) return null;
    const [lat, lng] = geo.ll ?? [];
    return {
      country: geo.country,
      region: geo.region,
      city: geo.city,
      lat,
      lng,
      timezone: geo.timezone,
    };
  } catch (err) {
    console.warn('[geoip-lite] lookup failed for', ip, err);
    return null;
  }
}

/**
 * Parse a raw User-Agent header into structured device info via
 * `ua-parser-js`. Returns null when the UA is missing OR when the
 * parser couldn't recognise anything meaningful (very old UAs / bot
 * masquerade strings) — caller can then keep the raw UA + show
 * "Unknown device" in the UI rather than half-populated data.
 *
 * Trade-offs vs ad-hoc regex:
 *   - ~5KB gzipped, zero runtime deps.
 *   - Covers Chrome / Edge / Firefox / Safari / Opera / Brave plus
 *     rare browsers our regexes wouldn't catch (Vivaldi, Yandex…).
 *   - Maintained DB ships with the package; bump `ua-parser-js`
 *     periodically to keep up with new UA strings (Chrome > 130,
 *     iPhone 16, etc.).
 */
export function parseUserAgent(
  userAgent: string | null | undefined,
): DeviceInfo | null {
  if (!userAgent) return null;
  try {
    const parsed = new UAParser(userAgent).getResult();
    const info: DeviceInfo = {
      browser: parsed.browser?.name,
      browserVersion: parsed.browser?.version,
      os: parsed.os?.name,
      osVersion: parsed.os?.version,
      // ua-parser-js returns 'mobile' | 'tablet' | 'smarttv' | 'wearable'
      // | 'embedded' | 'console'; missing field implies desktop.
      deviceType: parsed.device?.type ?? (parsed.browser?.name ? 'desktop' : undefined),
      deviceVendor: parsed.device?.vendor,
      deviceModel: parsed.device?.model,
    };
    // Drop the result if literally nothing got resolved — UI behaves
    // better with "Unknown device" than an object full of undefineds.
    const hasAnyField = Object.values(info).some(
      (v) => v !== undefined && v !== '',
    );
    return hasAnyField ? info : null;
  } catch (err) {
    console.warn('[ua-parser] parse failed for', userAgent, err);
    return null;
  }
}

/**
 * Extract device-origin context from an inbound HTTP request. Reuse from
 * any controller that needs to forward `ip / userAgent / location` to a
 * downstream service (auth login/register/refresh, audit logging, etc.).
 *
 * IP resolution priority (most accurate first):
 *   1. CF-Connecting-IP — Cloudflare always sets this with the real
 *      client IP, even with multiple proxy hops.
 *   2. X-Forwarded-For first hop — generic for any reverse proxy.
 *   3. req.ip — Express, requires `app.set('trust proxy', ...)`.
 *   4. req.socket.remoteAddress — raw connection peer (last resort,
 *      typically the proxy IP if behind one).
 */
export function extractDeviceContext(req: Request): DeviceContext {
  const headers: Record<string, string | string[] | undefined> =
    req.headers ?? {};
  const pickHeader = (name: string): string | null => {
    const raw = headers[name];
    if (Array.isArray(raw)) return raw[0] ?? null;
    if (typeof raw === 'string') return raw.split(',')[0]?.trim() || null;
    return null;
  };
  const ip =
    pickHeader('cf-connecting-ip') ||
    pickHeader('x-forwarded-for') ||
    req.ip ||
    req.socket?.remoteAddress ||
    null;
  const userAgent = pickHeader('user-agent');
  const location = ip ? lookupLocationByIp(ip) : null;
  const deviceInfo = parseUserAgent(userAgent);
  return { ip, userAgent, location, deviceInfo };
}
