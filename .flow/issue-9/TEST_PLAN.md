# Test plan — demo mode (run the app without Spotify auth)

> Reads: REQUIREMENTS.md (every AC must be covered), DESIGN.md (failure modes table)
> Generated: 2026-04-26

## Coverage matrix

| AC | Test type | Test |
|---|---|---|
| AC-1 (`NEON_DEMO=1` boots straight to Dashboard, no keychain) | unit + manual | `ipc.demoBoot.test.ts > getStatus returns logged-in when NEON_DEMO=1` + manual launch with env var |
| AC-2 ("Try demo mode" button → Dashboard within one cycle) | unit + manual | `demoSession.test.ts > start() emits auth-changed { kind: 'logged-in' } synchronously` + manual click on `ConnectScreen` |
| AC-3 (DEMO badge, non-empty track, no `api.spotify.com` calls) | unit + manual | `demoPoller.test.ts > first emit has device.name === 'DEMO' and a non-empty track` + manual eyeball + `demoPoller.test.ts > no fetch is invoked during a full session` |
| AC-4 (position advances; auto-advance to next fixture on overflow) | unit | `demoPoller.test.ts > auto-advances to next track when injected clock crosses durationMs` |
| AC-5 (play/pause/next/prev/seek/volume all mutate, none throw) | unit | `demoPoller.test.ts > play/pause toggles isPlaying`, `> next/prev rotate index`, `> seek sets positionMs`, `> setVolume updates device.volumePercent` |
| AC-6 (no keychain writes ever) | unit | `demoSession.test.ts > start/exit never call setRefreshToken or clearRefreshToken` + `ipc.demoBoot.test.ts > NEON_DEMO=1 boot does not touch keychain` |
| AC-7 (per-process: relaunch without env var / button → ConnectScreen) | unit + manual | `ipc.demoBoot.test.ts > getStatus returns logged-out when NEON_DEMO is unset and no refresh token` + manual quit-and-relaunch |
| AC-8 (disconnect from Dashboard exits demo, stops poller; re-entry resets to fixture[0]) | unit + manual | `ipc.demoLifecycle.test.ts > auth:logout in demo mode dispatches to exitDemo and stops poller` + `> startDemo after exitDemo resumes from fixture[0]` + manual click of disconnect |

## Unit tests

All under `electron/__tests__/`, Vitest (matches existing `poller.test.ts` style: pure factories, injected `now()`, no real timers, no I/O).

**`demoPoller.test.ts`** — covers AC-3, AC-4, AC-5

- `start() emits a playing PlaybackState with device.name === 'DEMO'` — asserts the first state from `createDemoPoller({ emit })` has `device.name === 'DEMO'`, `kind: 'playing'`, and a non-empty `track.title` / `track.artists[0].name`.
- `next() advances index and resets positionMs to 0` — call `next()`, assert emitted state's track equals `DEMO_TRACKS[1]` and `positionMs === 0`.
- `prev() rotates backward and resets positionMs to 0` — symmetric to `next`.
- `play()/pause() toggles isPlaying and kind` — `pause()` produces `kind: 'paused'`; subsequent `play()` produces `kind: 'playing'`.
- `auto-advances to next track when injected clock crosses durationMs` — inject `now: () => t` where `t` jumps past `tracks[0].durationMs`; assert next emit is on `tracks[1]` with `positionMs === 0`. Anchors AC-4 second clause.
- `auto-advance handles multi-track overflow (window-hidden case)` — jump `now` by 600s; assert end state lands on the correct fixture/offset (per the `while (effective >= durationMs)` loop in DESIGN.md failure modes).
- `seek(N) sets positionMs and re-emits` — call `seek(15000)`, assert `positionMs === 15000` on the next emitted state.
- `setVolume(N) updates device.volumePercent and re-emits` — call `setVolume(25)`, assert `device.volumePercent === 25`.
- `no fetch is invoked during a full session` — spy on global `fetch`; run a sequence of `start/play/pause/next/seek/setVolume/pollNow`; assert `fetch.mock.calls.length === 0`. Anchors AC-3's "no network requests to api.spotify.com" clause.

**`demoSession.test.ts`** — covers AC-2, AC-6

- `start() emits auth-changed { kind: 'logged-in' } synchronously` — listener attached before `start()` receives the event in the same tick. Anchors AC-2.
- `exit() emits auth-changed { kind: 'logged-out' }` — symmetric.
- `getStatus() reflects state` — returns `{ kind: 'logged-in' }` after `start()`, `{ kind: 'logged-out' }` after `exit()`.
- `start/exit never call setRefreshToken or clearRefreshToken` — `vi.mock('../auth/keychain')`; run full lifecycle (`start → exit → start → exit`); assert both mock fns have `.mock.calls.length === 0`. Anchors AC-6.

**`ipc.demoBoot.test.ts`** — covers AC-1, AC-6 (boot path), AC-7

- `auth:getStatus returns logged-in when NEON_DEMO=1` — set `process.env.NEON_DEMO = '1'` before importing `ipc.ts`; assert the registered `auth:getStatus` handler resolves to `{ kind: 'logged-in' }` without any keychain read. Anchors AC-1.
- `auth:getStatus returns logged-out when NEON_DEMO is unset and keychain has no token` — clear env; mock `getRefreshToken` to return `null`; assert handler resolves to `{ kind: 'logged-out' }`. Anchors AC-7.
- `NEON_DEMO=1 boot does not invoke setRefreshToken or clearRefreshToken` — mock keychain; boot ipc with env var set; run a `getStatus` cycle; assert keychain write fns untouched. Anchors AC-6 boot path.
- `NEON_DEMO !== '1' (e.g. 'true') boots in spotify mode` — guards against the truthy-variant failure mode in DESIGN.md.
- `SPOTIFY_CLIENT_ID-not-set warning is suppressed when NEON_DEMO=1` — spy on `console.warn`; assert the warning string is not printed when `NEON_DEMO=1` and `SPOTIFY_CLIENT_ID` is unset.

**`ipc.demoLifecycle.test.ts`** — covers AC-8, mode-switching failure modes

- `auth:startDemo attaches demo poller and resolves after first emit` — assert that by the time the promise resolves, a `player:state` send with `device.name === 'DEMO'` has already been dispatched. Guards the "first-emit latency" risk in DESIGN.md.
- `auth:logout in demo mode dispatches to exitDemo (no oauth.logout call) and stops the poller` — mock `oauth.logout` and the poller's `stop`; trigger `auth:logout` while `mode === 'demo'`; assert `oauth.logout` not called, demo poller `stop` called, no further `player:state` emits. Anchors AC-8 first half + AC-6 keychain-safety.
- `startDemo after exitDemo resumes from fixture[0]` — `startDemo → exitDemo → startDemo`; assert the second session's first emit is on `DEMO_TRACKS[0]` with `positionMs === 0`. Anchors AC-8 second half.
- `mode-switch stops the previous poller before attaching the new one` — spy on `stopPoller`; `startDemo` while spotify poller is attached should call `stopPoller` before `attachPoller(demoPoller)`. Guards the double-timer flicker failure mode.

## Integration tests

None as automated specs (this repo has no renderer-side test harness — `EXPLORE.md` Conventions: "no renderer-side tests"). The Electron-level integration is exercised through manual checks below; the unit tests above already cover the IPC contract on the main side, and the renderer changes are a single button + two declared API methods.

## Manual checks

Run from a clean working tree against the built app (`npm run dev`).

- [ ] **AC-1 boot path**: `NEON_DEMO=1 npm run dev` — app opens directly on `Dashboard` (no `ConnectScreen` flash). `DeviceBadge` reads `DEMO`. A track title and artist are visible.
- [ ] **AC-2 button path**: `npm run dev` (no env var) — `ConnectScreen` shows both **connect spotify** and **▶ try demo mode**. Click the demo button → transitions to `Dashboard` within ~1 frame.
- [ ] **AC-3 visuals**: With demo active, confirm `DeviceBadge` text is exactly `DEMO`. Open DevTools Network tab — confirm no requests to `api.spotify.com`. `NowPlaying` shows non-empty title/artist; for the `artUrl: null` fixture, the existing no-art fallback (`NowPlaying.tsx:72-80`) renders cleanly.
- [ ] **AC-4 position tween**: Without touching anything, the position indicator visibly advances. Wait for a short fixture (30s) to end — track auto-advances to the next fixture and position resets to 0.
- [ ] **AC-5 transport controls**: Click play/pause — icon flips within ~250ms. Click next → next fixture appears; click prev → previous fixture appears. Drag seek bar → position jumps. Adjust volume → no toast / no console error.
- [ ] **AC-6 keychain isolation** (most important manual check): *Before* enabling demo mode, log in once with a real Spotify token (or seed `keytar.setPassword('neon-stereo', 'refresh-token', 'sentinel-value')` in a Node REPL). Quit. Relaunch in demo mode (`NEON_DEMO=1` or button). Use demo mode. Click disconnect. Quit. Inspect the OS keychain (Keychain Access on macOS, search "neon-stereo") — the original sentinel value is still present, unchanged.
- [ ] **AC-7 no persistence**: Quit demo session. Relaunch *without* `NEON_DEMO=1` and *without* clicking the demo button — `ConnectScreen` is shown (not `Dashboard`).
- [ ] **AC-8 disconnect + re-entry**: While in demo, click `disconnect` on `Dashboard` → returns to `ConnectScreen`. Open DevTools → confirm no further `player:state` IPC events fire. Click **▶ try demo mode** again → `Dashboard` reappears, first track is `DEMO_TRACKS[0]` (i.e. fresh session, not resumed mid-track).
- [ ] **Window focus/visibility**: Cmd-Tab away and back — cadence behavior unchanged (no flicker, no error). Minimize the window — no demo emits while hidden.
- [ ] **Console hygiene**: With `NEON_DEMO=1`, the `SPOTIFY_CLIENT_ID not set` warning does NOT print.
- [ ] **README + .env.example**: README "Setup" section documents `NEON_DEMO=1 npm run dev` and the demo button. `.env.example` has a commented `# NEON_DEMO=1` line.

## What we are NOT testing (and why)

- **Full Vitest coverage of `attachPoller` / `setPollerFocus` / `setPollerVisibility` interactions in demo mode.** These are inherited unchanged from the Spotify path and are already covered by `poller.test.ts`. Demo poller implements the same `PollerHandle` shape; if it satisfies `attachPoller`'s type contract, behavior is the same.
- **Renderer-side automated tests for the new button** (`ConnectScreen.tsx`). Repo has no renderer test harness (per `EXPLORE.md` Conventions). The button is a one-line addition; manual eyeball + the IPC-level unit test for `auth:startDemo` is sufficient.
- **Album-art rendering pixel tests.** Visual; covered by the manual AC-3 check. The `artUrl: null` branch is exercised by fixture 3.
- **Cross-platform keytar behavior.** `keytar` and its JSON-file fallback are out of scope — the keychain-isolation guarantee is enforced by *not calling* keychain functions at all, which is asserted at the unit level.
- **CI coverage of the env-var boot path under Electron.** The unit test imports `ipc.ts` directly with the env var set, which is sufficient for the contract. Booting a real Electron process in CI just to read one env var would be infrastructure overhead disproportionate to the risk.
- **Race between in-flight Spotify poll and demo activation** (DESIGN.md failure mode). Acceptable per design — demo poller re-emits within ~250ms. Deferred to QA/follow-up unless the manual check shows a flicker.
- **`auth:login` rejection in demo mode** (DESIGN.md "defensive — UI shouldn't reach this path"). Defensive code only; not user-reachable, not worth a dedicated test.
- **`auth:getToken` returning `null` in demo mode.** Renderer never calls it; documented in `.env.example`.
