import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PlaybackState } from '../types.js';

type Handler = (...args: unknown[]) => unknown;
const handlerStore = new Map<string, Handler>();

const onListeners = new Map<string, Handler>();
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler): void => {
      handlerStore.set(channel, fn);
    },
    removeHandler: (channel: string): void => {
      handlerStore.delete(channel);
    },
    on: (channel: string, fn: Handler): void => {
      onListeners.set(channel, fn);
    },
    off: (channel: string): void => {
      onListeners.delete(channel);
    },
  },
  shell: { openExternal: async (): Promise<void> => {} },
}));

const keychainState: { refreshToken: string | null } = { refreshToken: null };
vi.mock('../auth/keychain.js', () => ({
  getRefreshToken: vi.fn(async (): Promise<string | null> => keychainState.refreshToken),
  setRefreshToken: vi.fn(async (): Promise<void> => {}),
  clearRefreshToken: vi.fn(async (): Promise<void> => {}),
  __setKeytarForTests: (): void => {},
}));

const fakeWin = {
  webContents: {
    send: vi.fn(),
  },
} as unknown as Electron.BrowserWindow;

let stopActivePoller: (() => void) | null = null;

async function bootIpc(env: Record<string, string | undefined>): Promise<{
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  emits: PlaybackState[];
  authEmits: unknown[];
}> {
  for (const k of Object.keys(env)) {
    const v = env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  vi.resetModules();
  handlerStore.clear();
  onListeners.clear();

  const ipcMod = await import('../ipc.js');
  const pollerMod = await import('../spotify/poller.js');

  const emits: PlaybackState[] = [];
  const authEmits: unknown[] = [];
  (fakeWin.webContents.send as ReturnType<typeof vi.fn>).mockImplementation(
    (channel: string, payload: unknown) => {
      if (channel === 'player:state') emits.push(payload as PlaybackState);
      if (channel === 'auth:changed') authEmits.push(payload);
    },
  );

  ipcMod.registerIpcHandlers(() => fakeWin);
  stopActivePoller = pollerMod.stopPoller;

  const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
    const handler = handlerStore.get(channel);
    if (!handler) throw new Error(`no handler registered for ${channel}`);
    return handler({}, ...args);
  };
  return { invoke, emits, authEmits };
}

beforeEach(() => {
  keychainState.refreshToken = null;
});

afterEach(() => {
  stopActivePoller?.();
  stopActivePoller = null;
  delete process.env['NEON_DEMO'];
  delete process.env['SPOTIFY_CLIENT_ID'];
  delete process.env['GOOGLE_OAUTH_CLIENT_ID'];
  vi.clearAllMocks();
});

describe('ipc boot — auth:getStatus contract', () => {
  it('NEON_DEMO=1 → auth:getStatus returns { kind: "logged-in" } without touching keychain (AC-1)', async () => {
    const { invoke } = await bootIpc({ NEON_DEMO: '1', SPOTIFY_CLIENT_ID: '' });
    const keychain = await import('../auth/keychain.js');
    const status = await invoke('auth:getStatus');
    expect(status).toEqual({ kind: 'logged-in' });
    expect(keychain.getRefreshToken).not.toHaveBeenCalled();
  });

  it('NEON_DEMO unset + empty keychain → auth:getStatus returns { kind: "logged-out" } (AC-7)', async () => {
    keychainState.refreshToken = null;
    const { invoke } = await bootIpc({ NEON_DEMO: undefined, SPOTIFY_CLIENT_ID: 'cid' });
    const status = await invoke('auth:getStatus');
    expect(status).toEqual({ kind: 'logged-out' });
  });

  it('NEON_DEMO truthy-variant ("true") boots in spotify mode (not demo)', async () => {
    keychainState.refreshToken = null;
    const { invoke } = await bootIpc({ NEON_DEMO: 'true', SPOTIFY_CLIENT_ID: 'cid' });
    const status = await invoke('auth:getStatus');
    // Spotify mode + empty keychain → logged-out, not the unconditional demo logged-in.
    expect(status).toEqual({ kind: 'logged-out' });
  });
});

describe('ipc boot — keychain isolation (AC-6 boot path)', () => {
  it('NEON_DEMO=1 boot does not call setRefreshToken or clearRefreshToken', async () => {
    const { invoke } = await bootIpc({ NEON_DEMO: '1', SPOTIFY_CLIENT_ID: '' });
    const keychain = await import('../auth/keychain.js');
    await invoke('auth:getStatus');
    await invoke('player:get');
    expect(keychain.setRefreshToken).not.toHaveBeenCalled();
    expect(keychain.clearRefreshToken).not.toHaveBeenCalled();
  });
});

describe('ipc boot — startup warning hygiene', () => {
  it('no-credentials warning is suppressed when NEON_DEMO=1', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await bootIpc({ NEON_DEMO: '1', SPOTIFY_CLIENT_ID: '', GOOGLE_OAUTH_CLIENT_ID: '' });
      const warnings = warnSpy.mock.calls.map((c) => String(c[0] ?? ''));
      expect(warnings.some((w) => w.includes('no provider credentials configured'))).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('no-credentials warning prints when neither Spotify nor Google is configured', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await bootIpc({
        NEON_DEMO: undefined,
        SPOTIFY_CLIENT_ID: '',
        GOOGLE_OAUTH_CLIENT_ID: '',
      });
      const warnings = warnSpy.mock.calls.map((c) => String(c[0] ?? ''));
      expect(warnings.some((w) => w.includes('no provider credentials configured'))).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('no-credentials warning is suppressed when GOOGLE_OAUTH_CLIENT_ID is set (user is using YouTube)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await bootIpc({
        NEON_DEMO: undefined,
        SPOTIFY_CLIENT_ID: '',
        GOOGLE_OAUTH_CLIENT_ID: 'google-cid',
      });
      const warnings = warnSpy.mock.calls.map((c) => String(c[0] ?? ''));
      expect(warnings.some((w) => w.includes('no provider credentials configured'))).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
