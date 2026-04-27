import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Provider } from '../types.js';

export type QueueItem = { videoId: string; title?: string; durationMs?: number };

export type Preferences = {
  lastProvider: Provider | null;
  ytQueue: QueueItem[];
};

const DEFAULT: Preferences = { lastProvider: null, ytQueue: [] };

function prefsPath(): string {
  const dir =
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'neon-stereo')
      : path.join(os.homedir(), '.config', 'neon-stereo');
  return path.join(dir, 'preferences.json');
}

function isProvider(v: unknown): v is Provider {
  return v === 'spotify' || v === 'youtube' || v === 'demo';
}

export async function readPreferences(): Promise<Preferences> {
  try {
    const raw = await fs.readFile(prefsPath(), 'utf8');
    const obj = JSON.parse(raw) as Partial<Preferences>;
    const lastProvider = isProvider(obj.lastProvider) ? obj.lastProvider : null;
    const ytQueue = Array.isArray(obj.ytQueue)
      ? obj.ytQueue.filter(
          (x): x is QueueItem =>
            !!x && typeof x === 'object' && typeof (x as QueueItem).videoId === 'string',
        )
      : [];
    return { lastProvider, ytQueue };
  } catch {
    return { ...DEFAULT };
  }
}

export async function writePreferences(p: Preferences): Promise<void> {
  const f = prefsPath();
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, JSON.stringify(p), { mode: 0o600 });
}

export async function patchPreferences(patch: Partial<Preferences>): Promise<Preferences> {
  const cur = await readPreferences();
  const next: Preferences = { ...cur, ...patch };
  await writePreferences(next);
  return next;
}
