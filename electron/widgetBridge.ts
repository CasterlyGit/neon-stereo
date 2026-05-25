/**
 * Shared in-process state for the Übersicht widget bridge.
 * ipc.ts writes here on every player state emission; nowPlayingServer.ts reads here.
 */
import type { PlaybackState, Provider } from './types.js';

let _state: PlaybackState = { kind: 'no-device' };
let _provider: Provider = 'spotify';

export function setBridgeState(state: PlaybackState, provider: Provider): void {
  _state = state;
  _provider = provider;
}

export function getBridgeState(): { state: PlaybackState; provider: Provider } {
  return { state: _state, provider: _provider };
}
