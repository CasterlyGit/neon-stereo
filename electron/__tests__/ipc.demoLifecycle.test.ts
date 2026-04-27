import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PlaybackState } from '../types.js';
import { DEMO_TRACKS } from '../demo/fixtures.js';

type Handler = (...args: unknown[]) => unknown;
const handlerStore = new Map<string, Handler>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler): void => {
      handlerStore.set(channel, fn);
    },
    removeHandler: (channel: string): void => {
      handlerStore.delete(channel);
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
  webContents: { send: vi.fn() },
} as unknown as Electron.BrowserWindow;

let stopActivePoller: (() => void) | null = null;

async function bootIpc(env: Record<string, string | undefined>): Promise<{
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  emits: PlaybackState[];
  authEmits: unknown[];
  pollerMod: typeof import('../spotify/poller.js');
}> {
  for (const k of Object.keys(env)) {
    const v = env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  vi.resetModules();
  handlerStore.clear();

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
  return { invoke, emits, authEmits, pollerMod };
}

beforeEach(() => {
  keychainState.refreshToken = null;
});

afterEach(() => {
  stopActivePoller?.();
  stopActivePoller = null;
  delete process.env['NEON_DEMO'];
  delete process.env['SPOTIFY_CLIENT_ID'];
  vi.clearAllMocks();
});

describe('ipc — auth:startDemo lifecycle', () => {
  it('startDemo attaches demo poller and resolves only after a player:state with DEMO has been emitted', async () => {
    const { invoke, emits, authEmits } = await bootIpc({
      NEON_DEMO: undefined,
      SPOTIFY_CLIENT_ID: 'cid',
    });

    const before = emits.length;
    await invoke('auth:startDemo');

    // After startDemo resolves, we should have at least one new player:state
    // whose device.name === 'DEMO'. (Guards the "first-emit latency" risk in DESIGN.md.)
    const newEmits = emits.slice(before);
    const demoStates = newEmits.filter(
      (s): s is Extract<PlaybackState, { kind: 'playing' | 'paused' | 'idle' }> =>
        s.kind !== 'no-device',
    );
    const sawDemo = demoStates.some((s) => s.device.name === 'DEMO');
    expect(sawDemo).toBe(true);

    // Renderer also got told auth flipped to logged-in.
    expect(authEmits).toContainEqual({ kind: 'logged-in' });
  });

  it('auth:startDemo when already in demo mode is a no-op', async () => {
    const { invoke, authEmits } = await bootIpc({
      NEON_DEMO: '1',
      SPOTIFY_CLIENT_ID: '',
    });
    const beforeAuth = authEmits.length;
    await invoke('auth:startDemo');
    // Already in demo at boot — no fresh logged-in event emitted by an extra start.
    expect(authEmits.length).toBe(beforeAuth);
  });
});

describe('ipc — auth:logout in demo mode (AC-8 first half)', () => {
  it('auth:logout dispatches to exitDemo (does not call clearRefreshToken)', async () => {
    const { invoke, authEmits } = await bootIpc({
      NEON_DEMO: '1',
      SPOTIFY_CLIENT_ID: '',
    });
    const keychain = await import('../auth/keychain.js');
    await invoke('auth:logout');
    expect(keychain.clearRefreshToken).not.toHaveBeenCalled();
    expect(authEmits).toContainEqual({ kind: 'logged-out' });
  });

  it('auth:logout in spotify mode DOES call clearRefreshToken (control case)', async () => {
    const { invoke } = await bootIpc({
      NEON_DEMO: undefined,
      SPOTIFY_CLIENT_ID: 'cid',
    });
    const keychain = await import('../auth/keychain.js');
    await invoke('auth:logout');
    expect(keychain.clearRefreshToken).toHaveBeenCalled();
  });
});

describe('ipc — startDemo after exitDemo resumes from fixture[0] (AC-8 second half)', () => {
  it('a fresh demo session emits a playing state with track 0 even after a prior exit', async () => {
    const { invoke, emits } = await bootIpc({
      NEON_DEMO: undefined,
      SPOTIFY_CLIENT_ID: 'cid',
    });

    await invoke('auth:startDemo');

    // Mutate to track 1 to prove a later session starts fresh, not resumed.
    await invoke('player:next');

    const beforeFirst = emits.length;
    // Now look at the latest state to confirm we left on track[1] before exit.
    const latest = emits[beforeFirst - 1] as PlaybackState;
    if (latest.kind === 'playing' || latest.kind === 'paused') {
      expect(latest.track.id).toBe(DEMO_TRACKS[1]!.id);
    } else {
      throw new Error('expected playing/paused before exit');
    }

    await invoke('auth:exitDemo');

    const beforeReentry = emits.length;
    await invoke('auth:startDemo');

    // First emit of the new session is on DEMO_TRACKS[0] with positionMs ~ 0.
    const newEmits = emits.slice(beforeReentry);
    const firstWithTrack = newEmits.find(
      (s): s is Extract<PlaybackState, { kind: 'playing' | 'paused' }> =>
        s.kind === 'playing' || s.kind === 'paused',
    );
    expect(firstWithTrack).toBeDefined();
    if (firstWithTrack) {
      expect(firstWithTrack.track.id).toBe(DEMO_TRACKS[0]!.id);
      expect(firstWithTrack.positionMs).toBe(0);
    }
  });
});

describe('ipc — mode-switch hygiene', () => {
  it('startDemo (from spotify mode) does not produce an unhandled rejection', async () => {
    const { invoke } = await bootIpc({
      NEON_DEMO: undefined,
      SPOTIFY_CLIENT_ID: 'cid',
    });
    await expect(invoke('auth:startDemo')).resolves.not.toThrow();
  });

  it('exitDemo (from demo mode) does not produce an unhandled rejection', async () => {
    const { invoke } = await bootIpc({
      NEON_DEMO: '1',
      SPOTIFY_CLIENT_ID: '',
    });
    await expect(invoke('auth:exitDemo')).resolves.not.toThrow();
  });
});

describe('ipc — demo-mode player handlers (AC-3, AC-5)', () => {
  it('player:get in demo mode returns a state with device.name === "DEMO" and a non-empty track', async () => {
    const { invoke } = await bootIpc({
      NEON_DEMO: '1',
      SPOTIFY_CLIENT_ID: '',
    });
    const state = (await invoke('player:get')) as PlaybackState;
    expect(state.kind).not.toBe('no-device');
    if (state.kind === 'playing' || state.kind === 'paused') {
      expect(state.device.name).toBe('DEMO');
      expect(state.track.title.length).toBeGreaterThan(0);
    }
  });

  it('player:next + player:get in demo mode advances track', async () => {
    const { invoke } = await bootIpc({
      NEON_DEMO: '1',
      SPOTIFY_CLIENT_ID: '',
    });
    const before = (await invoke('player:get')) as PlaybackState;
    await invoke('player:next');
    const after = (await invoke('player:get')) as PlaybackState;
    if (
      (before.kind === 'playing' || before.kind === 'paused') &&
      (after.kind === 'playing' || after.kind === 'paused')
    ) {
      expect(after.track.id).not.toBe(before.track.id);
    } else {
      throw new Error('expected playing/paused before and after');
    }
  });

  it('player:volume in demo mode updates volumePercent', async () => {
    const { invoke } = await bootIpc({
      NEON_DEMO: '1',
      SPOTIFY_CLIENT_ID: '',
    });
    await invoke('player:volume', 33);
    const after = (await invoke('player:get')) as PlaybackState;
    if (after.kind === 'playing' || after.kind === 'paused') {
      expect(after.device.volumePercent).toBe(33);
    } else {
      throw new Error('expected playing/paused');
    }
  });

  it('player:pause then player:get reflects paused', async () => {
    const { invoke } = await bootIpc({
      NEON_DEMO: '1',
      SPOTIFY_CLIENT_ID: '',
    });
    await invoke('player:pause');
    const after = (await invoke('player:get')) as PlaybackState;
    expect(after.kind).toBe('paused');
  });
});
