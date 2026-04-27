// Thin wrapper over keytar for the refresh token.
// Falls back to a 0600 JSON file at ~/Library/Application Support/neon-stereo/tokens.json
// if keytar fails (e.g. native binding unavailable). This is the documented fallback in
// IMPLEMENTATION.log when keytar's prebuilt binary doesn't load.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SERVICE = 'neon-stereo';

export type ProviderAccount = 'spotify';

export function accountFor(provider: ProviderAccount): string {
  return `${provider}-refresh`;
}

const DEFAULT_PROVIDER: ProviderAccount = 'spotify';

type Keytar = {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
};

let keytar: Keytar | null = null;
let keytarTried = false;

async function loadKeytar(): Promise<Keytar | null> {
  if (keytarTried) return keytar;
  keytarTried = true;
  try {
    // Use eval-ish dynamic import to keep bundlers from inlining.
    const mod = (await import('keytar')) as unknown as { default?: Keytar } & Keytar;
    keytar = (mod.default ?? mod) as Keytar;
    return keytar;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[neon-stereo] keytar unavailable, falling back to JSON file:', e);
    keytar = null;
    return null;
  }
}

function fallbackPath(): string {
  const dir =
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'neon-stereo')
      : path.join(os.homedir(), '.config', 'neon-stereo');
  return path.join(dir, 'tokens.json');
}

async function fileGet(provider: ProviderAccount): Promise<string | null> {
  try {
    const raw = await fs.readFile(fallbackPath(), 'utf8');
    const obj = JSON.parse(raw) as Record<string, string>;
    const key = `${provider}_refresh_token`;
    if (typeof obj[key] === 'string') return obj[key] ?? null;
    // Back-compat: pre-multi-provider files used a flat refresh_token key for spotify.
    if (provider === 'spotify' && typeof obj['refresh_token'] === 'string')
      return obj['refresh_token'] ?? null;
    return null;
  } catch {
    return null;
  }
}

async function fileSet(provider: ProviderAccount, token: string): Promise<void> {
  const p = fallbackPath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  let existing: Record<string, string> = {};
  try {
    const raw = await fs.readFile(p, 'utf8');
    existing = JSON.parse(raw) as Record<string, string>;
  } catch {
    /* fresh file */
  }
  existing[`${provider}_refresh_token`] = token;
  // Back-compat key kept in sync for spotify so older readers still work.
  if (provider === 'spotify') existing['refresh_token'] = token;
  await fs.writeFile(p, JSON.stringify(existing), { mode: 0o600 });
}

async function fileClear(provider: ProviderAccount): Promise<void> {
  try {
    const p = fallbackPath();
    const raw = await fs.readFile(p, 'utf8');
    const obj = JSON.parse(raw) as Record<string, string>;
    delete obj[`${provider}_refresh_token`];
    if (provider === 'spotify') delete obj['refresh_token'];
    if (Object.keys(obj).length === 0) {
      await fs.unlink(p);
    } else {
      await fs.writeFile(p, JSON.stringify(obj), { mode: 0o600 });
    }
  } catch {
    /* noop */
  }
}

export async function getRefreshToken(
  provider: ProviderAccount = DEFAULT_PROVIDER,
): Promise<string | null> {
  const k = await loadKeytar();
  if (k) {
    try {
      return await k.getPassword(SERVICE, accountFor(provider));
    } catch {
      return fileGet(provider);
    }
  }
  return fileGet(provider);
}

export async function setRefreshToken(
  token: string,
  provider: ProviderAccount = DEFAULT_PROVIDER,
): Promise<void> {
  const k = await loadKeytar();
  if (k) {
    try {
      await k.setPassword(SERVICE, accountFor(provider), token);
      return;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[neon-stereo] keytar.setPassword failed, using JSON fallback', e);
    }
  }
  await fileSet(provider, token);
}

export async function clearRefreshToken(
  provider: ProviderAccount = DEFAULT_PROVIDER,
): Promise<void> {
  const k = await loadKeytar();
  if (k) {
    try {
      await k.deletePassword(SERVICE, accountFor(provider));
    } catch {
      /* fall through */
    }
  }
  await fileClear(provider);
}

// Test-only injection seam.
export function __setKeytarForTests(fake: Keytar | null): void {
  keytar = fake;
  keytarTried = true;
}
