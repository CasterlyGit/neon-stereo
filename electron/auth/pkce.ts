import { createHash, randomBytes } from 'node:crypto';

/**
 * Encode a Buffer as base64url (RFC 4648 §5): replace `+`→`-`, `/`→`_`, strip `=`.
 */
export function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * Generate a PKCE code verifier — 43-128 chars of [A-Za-z0-9-._~] per RFC 7636.
 * We use base64url of 32 random bytes → 43 chars, all in the safe set.
 */
export function generateVerifier(): string {
  return base64url(randomBytes(32));
}

/**
 * Compute the S256 code challenge: base64url(SHA256(ascii(verifier))).
 * Locked to the canonical RFC 7636 test vector — see pkce.test.ts.
 */
export function challengeFromVerifier(verifier: string): string {
  const hash = createHash('sha256').update(verifier, 'ascii').digest();
  return base64url(hash);
}

/** Generate a random opaque OAuth state nonce. */
export function generateState(): string {
  return base64url(randomBytes(16));
}
