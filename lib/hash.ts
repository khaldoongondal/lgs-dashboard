/**
 * Web-Crypto SHA-256 PII hashing for Meta CAPI.
 * Meta requires email / first_name / last_name to be lowercase-trimmed
 * then SHA-256 hashed before transmission.
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
  email?:     string | null;
  firstName?: string | null;
  lastName?:  string | null;
  phone?:     string | null;
  clientIp?:  string | null;
  userAgent?: string | null;
  fbc?:       string | null;
  fbp?:       string | null;
  externalId?: string | null;  // fingerprint or our internal contact id
}

/**
 * Build the user_data object for a Meta CAPI event.
 * Hashed: em, fn, ln, ph, external_id
 * Plain: client_ip_address, client_user_agent, fbc, fbp
 */
export async function buildUserData(input: UserDataInput): Promise<Record<string, unknown>> {
  const ud: Record<string, unknown> = {};

  const [em, fn, ln, ph, ext] = await Promise.all([
    hashField(input.email),
    hashField(input.firstName),
    hashField(input.lastName),
    hashField(input.phone?.replace(/\D/g, '')),
    hashField(input.externalId),
  ]);

  if (em)  ud.em          = [em];
  if (fn)  ud.fn          = [fn];
  if (ln)  ud.ln          = [ln];
  if (ph)  ud.ph          = [ph];
  if (ext) ud.external_id = [ext];

  if (input.clientIp)  ud.client_ip_address = input.clientIp;
  if (input.userAgent) ud.client_user_agent = input.userAgent;
  if (input.fbc)       ud.fbc = input.fbc;
  if (input.fbp)       ud.fbp = input.fbp;

  return ud;
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
