/**
 * Edge-compatible HMAC session helpers.
 *
 * We sign a small claim (`role:expiresAtMs`) with HMAC-SHA256 using
 * SESSION_SECRET and store it as an httpOnly cookie. Middleware re-verifies
 * on every request. Two cookies = two tiers.
 *
 * Runs in both Edge runtime (middleware) and Node runtime (route handlers).
 */

export type Role = 'dashboard' | 'financials';

export const COOKIE = {
  dashboard:  'lgs_auth',
  financials: 'lgs_financials_auth',
} as const;

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const enc = new TextEncoder();

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Sign a claim of the form "role:expiresAtMs" with HMAC-SHA256. */
export async function sign(role: Role, secret: string, ttlMs = DEFAULT_TTL_MS): Promise<string> {
  const exp = Date.now() + ttlMs;
  const claim = `${role}:${exp}`;
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(claim));
  return `${claim}.${toHex(sig)}`;
}

/** Verify a signed token. Returns true if valid and not expired. */
export async function verify(token: string | undefined, role: Role, secret: string): Promise<boolean> {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return false;

  const claim = token.slice(0, dot);
  const sigHex = token.slice(dot + 1);
  const [tokenRole, expStr] = claim.split(':');

  if (tokenRole !== role) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;

  const key = await importKey(secret);

  // Convert hex back to bytes for subtle.verify
  if (sigHex.length % 2 !== 0) return false;
  const bytes = new Uint8Array(sigHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(sigHex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(bytes[i])) return false;
  }

  return crypto.subtle.verify('HMAC', key, bytes, enc.encode(claim));
}
