/**
 * Web-Crypto SHA-256 PII hashing for Meta CAPI.
 * Meta requires email / first_name / last_name / city / state / country
 * to be lowercase-trimmed then SHA-256 hashed before transmission.
 *
 * Runs in both Node (>=19, where webcrypto is global) and Edge.
 */

const enc = new TextEncoder();

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Normalize then hash. Returns null for empty input so we never send empty hashes. */
export async function hashField(value: unknown): Promise<string | null> {
  if (value === null || value === undefined) return null;
  const s = String(value).toLowerCase().trim();
  if (!s) return null;
  return sha256Hex(s);
}

export interface UserDataInput {
  email?:      string | null;
  firstName?:  string | null;
  lastName?:   string | null;
  phone?:      string | null;
  clientIp?:   string | null;
  userAgent?:  string | null;
  fbc?:        string | null;
  fbp?:        string | null;
  externalId?: string | null;  // fingerprint or our internal contact id
  city?:       string | null;
  state?:      string | null;  // 2-letter region code preferred (e.g. "ON", "CA")
  country?:    string | null;  // 2-letter ISO code (e.g. "us", "ca")
  zip?:        string | null;
}

export interface BuildUserDataResult {
  userData:  Record<string, unknown>;
  /**
   * Meta field names actually included in user_data (e.g. "em", "ph", "fbc").
   * Persisted to capi_event_log.match_keys_sent so we can diagnose EMQ drops.
   */
  matchKeys: string[];
}

/**
 * Build the user_data object for a Meta CAPI event.
 * Hashed: em, fn, ln, ph, external_id, ct (city), st (state), country, zp
 * Plain:  client_ip_address, client_user_agent, fbc, fbp
 */
export async function buildUserData(input: UserDataInput): Promise<BuildUserDataResult> {
  const ud: Record<string, unknown> = {};
  const keys: string[] = [];

  // City normalization: lowercase, strip punctuation/whitespace (Meta convention).
  const cityNorm = input.city ? input.city.toLowerCase().replace(/[^a-z]/g, '') : null;
  // State: prefer 2-letter code, but also accept full names — Meta hashes whatever we send.
  const stateNorm = input.state ? input.state.toLowerCase().replace(/[^a-z0-9]/g, '') : null;
  // Country: ISO-2 lowercase.
  const countryNorm = input.country ? input.country.toLowerCase().slice(0, 2) : null;
  // Zip: digits only.
  const zipNorm = input.zip ? input.zip.replace(/\D/g, '') : null;

  const [em, fn, ln, ph, ext, ct, st, ctry, zp] = await Promise.all([
    hashField(input.email),
    hashField(input.firstName),
    hashField(input.lastName),
    hashField(input.phone?.replace(/\D/g, '')),
    hashField(input.externalId),
    hashField(cityNorm),
    hashField(stateNorm),
    hashField(countryNorm),
    hashField(zipNorm),
  ]);

  if (em)   { ud.em          = [em];   keys.push('em'); }
  if (fn)   { ud.fn          = [fn];   keys.push('fn'); }
  if (ln)   { ud.ln          = [ln];   keys.push('ln'); }
  if (ph)   { ud.ph          = [ph];   keys.push('ph'); }
  if (ext)  { ud.external_id = [ext];  keys.push('external_id'); }
  if (ct)   { ud.ct          = [ct];   keys.push('ct'); }
  if (st)   { ud.st          = [st];   keys.push('st'); }
  if (ctry) { ud.country     = [ctry]; keys.push('country'); }
  if (zp)   { ud.zp          = [zp];   keys.push('zp'); }

  if (input.clientIp)  { ud.client_ip_address = input.clientIp;  keys.push('client_ip_address'); }
  if (input.userAgent) { ud.client_user_agent = input.userAgent; keys.push('client_user_agent'); }
  if (input.fbc)       { ud.fbc = input.fbc; keys.push('fbc'); }
  if (input.fbp)       { ud.fbp = input.fbp; keys.push('fbp'); }

  return { userData: ud, matchKeys: keys };
}

/**
 * Build the fbc cookie value from a raw fbclid.
 * Format: fb.{subdomain_index}.{creation_time_ms}.{fbclid}
 *
 * creationTimeMs MUST be the time the fbclid was first seen (the ad click).
 * If you only have the order time, pass that — but match-quality drops on iOS-blocked
 * conversions because Meta uses this timestamp to reconcile the click.
 */
export function buildFbc(fbclid: string | null | undefined, creationTimeMs?: number): string | null {
  if (!fbclid) return null;
  const ts = creationTimeMs ?? Date.now();
  return `fb.1.${ts}.${fbclid}`;
}
