/**
 * Device-origin types — pure TypeScript interfaces, no Mongoose
 * decorators. Mirrored as @Prop classes in `libs/db/src/mongo/model/keys.model.ts`
 * for the actual MongoDB schema, but consumers that only need the
 * TYPE (controllers, gRPC payload mappers) should import from here.
 *
 * Why split: classes decorated with `@Prop` from @nestjs/mongoose carry
 * runtime metadata. Some IDE TS servers / typescript-eslint
 * configurations refuse to resolve those classes as type-only imports
 * (treat them as `error type → any`), polluting downstream type
 * inference. Plain interfaces here avoid that entirely.
 */

/**
 * Geo-IP lookup result. All fields optional — lookup may fail for
 * private IPs / unmapped ranges, and offline DBs don't always carry
 * every attribute (e.g. ISP/ASN).
 */
export interface DeviceLocation {
  /** ISO-3166-1 alpha-2: 'VN', 'US' */
  country?: string;
  /** Full country name: 'Vietnam', 'United States' */
  countryName?: string;
  /** Admin region: 'Hồ Chí Minh', 'California' */
  region?: string;
  city?: string;
  lat?: number;
  lng?: number;
  /** IANA timezone: 'Asia/Ho_Chi_Minh' */
  timezone?: string;
  /** ISP / ASN name — useful for suspicious-login detection */
  isp?: string;
}

/**
 * Parsed User-Agent. All fields optional; UA parsing fails frequently
 * for embedded webviews and bots.
 */
export interface DeviceInfo {
  browser?: string;
  browserVersion?: string;
  os?: string;
  osVersion?: string;
  deviceType?: string;
  deviceVendor?: string;
  deviceModel?: string;
}

/**
 * Bundle forwarded from the api-gateway to auth.service for persistence
 * on the Keys model.
 */
export interface DeviceContext {
  ip?: string | null;
  userAgent?: string | null;
  location?: DeviceLocation | null;
  /**
   * Parsed User-Agent (browser/os/deviceType etc). Populated by
   * `parseUserAgent` in libs/helpers/src/device-context.helper. May be
   * null when the UA is missing or unrecognisable; consumers should
   * fall back to displaying the raw `userAgent` in that case.
   */
  deviceInfo?: DeviceInfo | null;
}
