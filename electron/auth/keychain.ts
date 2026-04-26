// Thin wrapper over keytar for the refresh token.
// Falls back to a 0600 JSON file at ~/Library/Application Support/neon-stereo/tokens.json
// if keytar fails (e.g. native binding unavailable). This is the documented fallback in
// IMPLEMENTATION.log when keytar's prebuilt binary doesn't load.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SERVICE = 'neon-stereo';
const ACCOUNT = 'spotify-refresh';

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

async function fileGet(): Promise<string | null> {
  try {
    const raw = await fs.readFile(fallbackPath(), 'utf8');
    const obj = JSON.parse(raw) as Record<string, string>;
    return obj['refresh_token'] ?? null;
  } catch {
    return null;
  }
}

async function fileSet(token: string): Promise<void> {
  const p = fallbackPath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify({ refresh_token: token }), { mode: 0o600 });
}

async function fileClear(): Promise<void> {
  try {
    await fs.unlink(fallbackPath());
  } catch {
    /* noop */
  }
}

export async function getRefreshToken(): Promise<string | null> {
  const k = await loadKeytar();
  if (k) {
    try {
      return await k.getPassword(SERVICE, ACCOUNT);
    } catch {
      return fileGet();
    }
  }
  return fileGet();
}

export async function setRefreshToken(token: string): Promise<void> {
  const k = await loadKeytar();
  if (k) {
    try {
      await k.setPassword(SERVICE, ACCOUNT, token);
      return;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[neon-stereo] keytar.setPassword failed, using JSON fallback', e);
    }
  }
  await fileSet(token);
}

export async function clearRefreshToken(): Promise<void> {
  const k = await loadKeytar();
  if (k) {
    try {
      await k.deletePassword(SERVICE, ACCOUNT);
    } catch {
      /* fall through */
    }
  }
  await fileClear();
}

// Test-only injection seam.
export function __setKeytarForTests(fake: Keytar | null): void {
  keytar = fake;
  keytarTried = true;
}
