import { describe, it, expect } from 'vitest';
import { base64url, challengeFromVerifier, generateVerifier } from '../auth/pkce.js';

describe('pkce', () => {
  it('generateVerifier returns a 43-128 char URL-safe string', () => {
    const v = generateVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(generateVerifier()).not.toBe(v);
  });

  it('challengeFromVerifier produces RFC-7636 S256 base64url (canonical vector)', () => {
    // RFC 7636 Appendix B canonical test vector.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = challengeFromVerifier(verifier);
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('challengeFromVerifier strips base64 padding and uses URL-safe alphabet', () => {
    for (let i = 0; i < 100; i++) {
      const v = generateVerifier();
      const c = challengeFromVerifier(v);
      expect(c).not.toMatch(/[=+/]/);
      expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('base64url strips padding and replaces +/ with -_', () => {
    expect(base64url(Buffer.from([0xff, 0xff, 0xff]))).toBe('____');
    expect(base64url(Buffer.from([0xfb, 0xff, 0xfe]))).toBe('-__-');
    expect(base64url(Buffer.from([0xff]))).toBe('_w'); // would be '/w==' in plain base64
  });
});
