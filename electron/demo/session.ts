import { EventEmitter } from 'node:events';
import type { AuthEvent } from '../types.js';

export type DemoStatus = { kind: 'logged-in' } | { kind: 'logged-out' };

export type DemoSession = {
  start(): void;
  exit(): void;
  getStatus(): DemoStatus;
  on(ev: 'auth-changed', cb: (e: AuthEvent) => void): void;
  off(ev: 'auth-changed', cb: (e: AuthEvent) => void): void;
};

export function createDemoSession(): DemoSession {
  const emitter = new EventEmitter();
  let state: { kind: 'demo' | 'off' } = { kind: 'off' };

  return {
    start(): void {
      if (state.kind === 'demo') return;
      state = { kind: 'demo' };
      emitter.emit('auth-changed', { kind: 'logged-in' } satisfies AuthEvent);
    },
    exit(): void {
      if (state.kind === 'off') return;
      state = { kind: 'off' };
      emitter.emit('auth-changed', { kind: 'logged-out' } satisfies AuthEvent);
    },
    getStatus(): DemoStatus {
      return state.kind === 'demo' ? { kind: 'logged-in' } : { kind: 'logged-out' };
    },
    on(ev, cb): void {
      emitter.on(ev, cb);
    },
    off(ev, cb): void {
      emitter.off(ev, cb);
    },
  };
}
