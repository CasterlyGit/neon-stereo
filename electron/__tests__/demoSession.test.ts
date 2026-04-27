import { describe, it, expect, vi } from 'vitest';
import { createDemoSession } from '../demo/session.js';
import * as keychain from '../auth/keychain.js';
import type { AuthEvent } from '../types.js';

describe('createDemoSession — auth events', () => {
  it('start() emits auth-changed { kind: "logged-in" } synchronously', () => {
    const session = createDemoSession();
    const events: AuthEvent[] = [];
    session.on('auth-changed', (e) => events.push(e));
    session.start();
    expect(events).toEqual([{ kind: 'logged-in' }]);
  });

  it('exit() emits auth-changed { kind: "logged-out" }', () => {
    const session = createDemoSession();
    const events: AuthEvent[] = [];
    session.on('auth-changed', (e) => events.push(e));
    session.start();
    session.exit();
    expect(events).toEqual([{ kind: 'logged-in' }, { kind: 'logged-out' }]);
  });

  it('getStatus() reflects state across start/exit transitions', () => {
    const session = createDemoSession();
    expect(session.getStatus()).toEqual({ kind: 'logged-out' });
    session.start();
    expect(session.getStatus()).toEqual({ kind: 'logged-in' });
    session.exit();
    expect(session.getStatus()).toEqual({ kind: 'logged-out' });
  });

  it('start() while already started is idempotent (no duplicate event)', () => {
    const session = createDemoSession();
    const events: AuthEvent[] = [];
    session.on('auth-changed', (e) => events.push(e));
    session.start();
    session.start();
    expect(events).toEqual([{ kind: 'logged-in' }]);
  });

  it('off() removes a previously-registered listener', () => {
    const session = createDemoSession();
    const events: AuthEvent[] = [];
    const listener = (e: AuthEvent): void => {
      events.push(e);
    };
    session.on('auth-changed', listener);
    session.start();
    session.off('auth-changed', listener);
    session.exit();
    expect(events).toEqual([{ kind: 'logged-in' }]);
  });
});

describe('createDemoSession — keychain isolation (AC-6)', () => {
  it('start/exit lifecycle never calls setRefreshToken or clearRefreshToken', async () => {
    const setSpy = vi.spyOn(keychain, 'setRefreshToken');
    const clearSpy = vi.spyOn(keychain, 'clearRefreshToken');
    try {
      const session = createDemoSession();
      session.start();
      session.exit();
      session.start();
      session.exit();
      expect(setSpy).not.toHaveBeenCalled();
      expect(clearSpy).not.toHaveBeenCalled();
    } finally {
      setSpy.mockRestore();
      clearSpy.mockRestore();
    }
  });
});
