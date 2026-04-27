# Design — demo mode (synthetic playback, no Spotify auth)

> Reads: REQUIREMENTS.md (acceptance criteria are the contract)
> Generated: 2026-04-26

## Approach

Add a self-contained "demo session" alongside the existing OAuth session in `electron/ipc.ts`. A new `createDemoSession` factory mirrors the closure + EventEmitter shape of `createOAuth` (state in-memory, never touches keychain). A new `createDemoPoller` factory mirrors the `PollerHandle` shape so it can be passed to the existing `attachPoller` singleton without changes. Activation is dual: `NEON_DEMO=1` read in `electron/ipc.ts` boots the app in demo mode pre-render; the renderer's new "Try demo mode" button calls a new `auth:startDemo` IPC. The renderer's data path is unchanged — `App.tsx` still branches on `kind: 'logged-in' | 'logged-out'`, `Dashboard` still consumes `PlaybackState`, and the badge surfaces via `Device.name = 'DEMO'`. We considered widening `AuthEvent`/`AuthStatus` to a `'demo'` kind for a colored chip but rejected it (research recommendation A): the device-label channel is sufficient for v1 and keeps the renderer untouched outside `ConnectScreen`.

## Components touched

| File / module | Change |
|---|---|
| `electron/ipc.ts` | Replace the single `createOAuth` + `createPoller` boot with a small switch on a `mode: 'spotify' \| 'demo'` value held in closure scope. Build both backends but only attach one poller at a time. Route every `auth:*` and `player:*` handler through that switch. Add two new IPC handlers `auth:startDemo` / `auth:exitDemo`. On `NEON_DEMO === '1'`, suppress the `SPOTIFY_CLIENT_ID not set` warning and pre-attach the demo poller. |
| `electron/preload.ts` | Add `auth.startDemo()` and `auth.exitDemo()` wrappers exposed via `contextBridge`. |
| `src/global.d.ts` | Add `startDemo(): Promise<void>` and `exitDemo(): Promise<void>` to the `Window['neonStereo'].auth` declaration so strict tsc accepts the calls. |
| `src/components/ConnectScreen.tsx` | Add a secondary "▶  try demo mode" button below the existing "connect spotify" button (same neon styling, dimmer accent). Click handler calls `window.neonStereo.auth.startDemo()` and lets the existing `auth:changed` listener in `App.tsx` flip to `<Dashboard/>`. |
| `electron/main.ts` | No code change. Existing `setPollerFocus`/`setPollerVisibility` already operate via `attachPoller`'s singleton, which the demo poller will populate. |
| `electron/types.ts` | No change. `PlaybackState` and `AuthEvent` reused as-is; `Device.name === 'DEMO'` is a value, not a type change. |
| `electron/spotify/poller.ts` | No change to `createPoller`/`mapPlaybackResponse`/`attachPoller`. `PollerHandle` type is consumed (not modified) by the new demo poller. |
| `README.md` | Add a "Demo mode" subsection under Setup: `NEON_DEMO=1 npm run dev` and "click Try demo mode on the connect screen". |
| `.env.example` | Add commented `# NEON_DEMO=1` line with one-sentence description. |

## New files

- `electron/demo/fixtures.ts` — exports `DEMO_DEVICE: Device` (`{ id: 'demo', name: 'DEMO', type: 'Computer', volumePercent: 60 }`) and `DEMO_TRACKS: Track[]` (4 entries; durations 30s/90s/180s/240s; track 3 has `album.artUrl: null` to exercise the "no art" branch in `NowPlaying.tsx:72-80`; tracks 1/2/4 reference bundled images via Vite-resolved `new URL('../../src/assets/demo/foo.png', import.meta.url).href` style — but since fixtures live in main and the renderer can't share that import, the URLs are constructed as `data:image/svg+xml;utf8,...` SVG placeholders generated inline so they survive the IPC boundary as plain strings and require zero asset bundling for v1). Resolves the album-art licensing open question without bundling external images.
- `electron/demo/session.ts` — exports `createDemoSession(): DemoSession` with closure state `{ kind: 'demo' \| 'off' }`, an `EventEmitter`, and methods `start() / exit() / getStatus() / on('auth-changed', cb) / off('auth-changed', cb)`. Mirrors `createOAuth`'s surface (`oauth.ts:51-192`) for symmetry; emits `{ kind: 'logged-in' }` on `start()` and `{ kind: 'logged-out' }` on `exit()`. Never touches keychain.
- `electron/demo/poller.ts` — exports `createDemoPoller(deps: { emit: (s: PlaybackState) => void; tracks?: Track[]; device?: Device; now?: () => number; }): PollerHandle`. Implements the same handle shape (`start/stop/setFocus/setVisibility/pollNow`) plus extra control methods used by IPC handlers: `play() / pause() / next() / prev() / seek(ms) / setVolume(pct)`. Internal state: `index: number`, `isPlaying: boolean`, `positionMs: number`, `asOf: number`, `volumePercent: number`. Returns the handle so it can pass to `attachPoller` *and* be retained by `ipc.ts` for control mutations.
- `electron/__tests__/demoPoller.test.ts` — Vitest spec mirroring `poller.test.ts` style. Cases: (a) `start()` emits a `playing` `PlaybackState` with `device.name === 'DEMO'`; (b) `next()` advances `track` to fixture[1] with `positionMs: 0`; (c) `pause()` sets `kind: 'paused'` and `isPlaying: false`, subsequent `play()` sets it back; (d) when the simulated clock advances past `track.durationMs`, the next emitted state is fixture[index+1] with `positionMs: 0` (auto-advance); (e) `seek(N)` sets `positionMs: N` and re-emits; (f) `setVolume(N)` updates `device.volumePercent` and re-emits. Inject `now: () => number` so tests don't use real timers. No I/O, no keychain, no fetch.
- `electron/__tests__/demoSession.test.ts` (small) — verifies `start()` emits `{ kind: 'logged-in' }`, `exit()` emits `{ kind: 'logged-out' }`, `getStatus()` reflects state, and that *neither* method calls `setRefreshToken`/`clearRefreshToken` (mock keychain module and assert `.mock.calls.length === 0`). Anchors AC-6.

## Data / state

- **Mode flag** (in `ipc.ts` closure scope): `let mode: 'spotify' | 'demo' = process.env['NEON_DEMO'] === '1' ? 'demo' : 'spotify'`. Mutated only by `auth:startDemo` and `auth:exitDemo` handlers. Not persisted.
- **Demo session state** (in `createDemoSession` closure): `{ kind: 'demo' | 'off' }`, plus an `EventEmitter`. No env var, no file, no keychain. Lost on quit. Anchors AC-7.
- **Demo poller state** (in `createDemoPoller` closure):
  - `index: number` — current fixture index, `0..tracks.length-1`.
  - `isPlaying: boolean` — true on construction; toggled by `play/pause`.
  - `positionMs: number` — last anchored position; reset to 0 on `next/prev/auto-advance`.
  - `asOf: number` — `now()` snapshot at last emit; renderer interpolates from this via `useTweenedPosition`.
  - `volumePercent: number` — initialized from `DEMO_DEVICE.volumePercent`.
  - `timer: ReturnType<typeof setTimeout> | null` and `stopped: boolean` — same lifecycle as `createPoller` (`poller.ts:108-118`); cadence reused via `cadenceFor`.
- **Auto-advance computation** (per emit): `elapsed = now() - asOf; effective = positionMs + (isPlaying ? elapsed : 0); if (effective >= track.durationMs) { index = (index + 1) % tracks.length; positionMs = 0; asOf = now(); } else { positionMs = effective; asOf = now(); }`. Then build a `PlaybackState` with `kind: isPlaying ? 'playing' : 'paused'` (or just `'paused'` when not playing).
- **Env var**: `NEON_DEMO` (chosen over `DEMO` to avoid collisions, over `NEON_STEREO_DEMO` for terseness — resolves open question). Documented in `.env.example` and `README.md`.
- **No new persisted state.** Specifically: no file under `userData/`, no entry in keychain, no `localStorage`. Anchors AC-6 and AC-7.

## Public API / surface

**New IPC channels (matched in `electron/preload.ts` + `src/global.d.ts`):**

| Channel | Args | Returns | Behavior |
|---|---|---|---|
| `auth:startDemo` | none | `Promise<void>` | If `mode === 'demo'`, no-op. Else: stop active poller, set `mode = 'demo'`, call `demoSession.start()` (emits `auth:changed { kind: 'logged-in' }` to renderer), construct + `attachPoller(demoPoller)` so it auto-starts and emits the first synthetic `PlaybackState`. |
| `auth:exitDemo` | none | `Promise<void>` | If `mode !== 'demo'`, no-op. Else: stop demo poller, set `mode = 'spotify'`, call `demoSession.exit()` (emits `auth:changed { kind: 'logged-out' }`), re-attach the Spotify poller. |

**Modified IPC channels (same names, branching on `mode`):**

| Channel | `mode === 'spotify'` | `mode === 'demo'` |
|---|---|---|
| `auth:getStatus` | existing logic (returns `'logged-in'` if keychain has a refresh token) | always `{ kind: 'logged-in' }` (anchors AC-1) |
| `auth:login` | existing `oauth.login()` | reject with `serializeError(new Error('already in demo mode'))` (defensive — UI shouldn't reach this path) |
| `auth:logout` | existing `oauth.logout()` | dispatch internally to `auth:exitDemo` so the existing `disconnect` button on `Dashboard.tsx:43` works unchanged. **Resolves the "exit affordance" open question — internal dispatch, renderer stays pure** (anchors AC-8). |
| `auth:getToken` | existing | return `null` (renderer never calls it; documented in `.env.example` comment) |
| `player:get` | existing | return current synthetic `PlaybackState` from the demo poller |
| `player:play` | existing | `demoPoller.play(); demoPoller.pollNow();` |
| `player:pause` | existing | `demoPoller.pause(); demoPoller.pollNow();` |
| `player:next` | existing | `demoPoller.next(); demoPoller.pollNow();` |
| `player:prev` | existing | `demoPoller.prev(); demoPoller.pollNow();` |
| `player:seek` | existing | `demoPoller.seek(positionMs); demoPoller.pollNow();` |
| `player:volume` | existing | `demoPoller.setVolume(percent); demoPoller.pollNow();` |

**Renderer surface additions (`src/global.d.ts` and `electron/preload.ts`):**

```text
window.neonStereo.auth.startDemo(): Promise<void>
window.neonStereo.auth.exitDemo(): Promise<void>
```

**Note on REQUIREMENTS wording:** AC-2 says `window.api.auth.startDemo()`; the actual binding is `window.neonStereo.auth.startDemo()` (per `electron/preload.ts:38`). This is a docs-only correction — implementation uses the existing `neonStereo` namespace.

**UI additions (`ConnectScreen.tsx`):**

- A second `<button>` below the connect-spotify button. Same `no-drag` class, same shape, dimmer styling: `border: '1px solid var(--text-dim)'`, `color: 'var(--text-dim)'`, no `boxShadow`/`textShadow` glow. Label: `▶  try demo mode`. On click: `await window.neonStereo.auth.startDemo()` inside a `safe`-style try/catch (mirror `connect()` at `ConnectScreen.tsx:8-20`).

**Env var:**

- `NEON_DEMO=1` — enables demo mode at boot. Read in `electron/ipc.ts` (not `main.ts`) so the same module that owns the OAuth/poller wiring also owns the mode switch. No CLI flag (`--demo`) for v1 — research-recommended skip.

## Failure modes

| Failure | How we detect | What we do |
|---|---|---|
| `attachPoller` called twice without `stop()` between (mode-switch) → both timers tick, renderer flickers | Code review; `attachPoller` always reassigns `activePoller` but the *previous* poller's timer is still scheduled | `auth:startDemo`/`auth:exitDemo` must call `stopPoller()` (already exported from `poller.ts:182`) **before** building and attaching the new poller. Add a regression test in `demoSession.test.ts`. |
| Demo `auth:logout` accidentally calls `oauth.logout()` and clears a real refresh token | Unit test with mocked `setRefreshToken`/`clearRefreshToken` asserting `.mock.calls.length === 0` across the full demo lifecycle | Branch in `ipc.ts`: `if (mode === 'demo') return exitDemo()` *before* invoking `oauth.logout()`. Test anchors AC-6. |
| User toggles into demo mode while a real Spotify poll is in flight → late `player:state` emit overrides the demo state | The Spotify poller's `tick()` (`poller.ts:120-129`) awaits a fetch and then emits unconditionally | Acceptable: demo poller will re-emit on its first tick (immediate via `start()` → `void tick()` at `poller.ts:135`), overwriting within ~250ms. If flicker is observed, gate emits on `mode === currentMode` snapshot at tick start. Note in PR; defer hardening unless QA flags it. |
| Renderer calls `player:get` between `auth:startDemo` resolution and demo poller's first emit → returns stale Spotify state | Race window of <50ms in practice | `auth:startDemo` awaits the demo poller's first `pollNow()` before resolving, guaranteeing `Dashboard.tsx:13`'s initial `player.get()` sees demo state. |
| Synthetic `positionMs` overflows `durationMs` by a large amount (e.g. window was hidden for minutes, then shown) → renderer shows wildly wrong position | `setVisibility(false)` pauses scheduling but the demo's internal clock keeps ticking via `Date.now()` | On the *next* `tick()`, the auto-advance loop will repeatedly skip tracks until `effective < durationMs`. Implement as `while (isPlaying && effective >= tracks[index].durationMs) { effective -= tracks[index].durationMs; index = (index + 1) % tracks.length; }` so we end up on the right track at the right offset. Covered by demo poller test case (d) with a clock injection that jumps 600s. |
| `process.env['NEON_DEMO']` is `'true'` or `'yes'` instead of `'1'` | tsc passes, app silently boots in Spotify mode | Strict equality `=== '1'` is documented in `.env.example`. Don't accept truthy variants — keeps the contract narrow and matches `process.env` conventions in this repo (`SPOTIFY_CLIENT_ID` is also bare-string compared at `ipc.ts:12`). |
| `SPOTIFY_CLIENT_ID not set` warning still prints in demo mode → noisy dev console | Visible at `npm run dev` startup | Reorder `ipc.ts:11-15` to compute `mode` first, then only warn when `mode === 'spotify' && !clientId`. Resolves an open question. |

## Alternatives considered

- **Replace Spotify with YouTube/Last.fm/Deezer.** Rejected — research showed all candidates either still need user-scoped OAuth (YouTube IFrame doesn't expose user playback; Last.fm has no "now playing on this account" surface for an unauthenticated user) or require a developer key that re-creates the setup burden the issue exists to escape. See RESEARCH.md "Resolved" Q1.
- **Widen `AuthEvent`/`AuthStatus` to add `kind: 'demo'`.** Rejected for v1 — would require `App.tsx`, `global.d.ts`, and `preload.ts` changes and a `Dashboard` chip, with no functional gain over `Device.name === 'DEMO'` rendered through the existing `DeviceBadge`. Easy to revisit later if a top-bar chip is desired.
- **Renderer-driven exit** via a separate "exit demo" button on `Dashboard`. Rejected — adds a second UI affordance for an action that's identical from the user's perspective ("disconnect"). Internal dispatch in `auth:logout` keeps `Dashboard.tsx` untouched.
- **Bundled CC0 album-art images under `src/assets/demo/`.** Rejected — fixtures live in main, where Vite asset URL resolution is awkward (main is CJS, Vite asset imports target the renderer). Inline `data:` SVG placeholders are zero-asset, zero-license-burden, and survive the IPC boundary as plain strings. One fixture still uses `artUrl: null` to exercise that branch (anchors AC-3's "or the existing `artUrl: null` fallback" clause).
- **CLI flag `--demo`** parsed via `app.commandLine`. Rejected — env var + button covers both CI and human-discovery cases; a third activation path is documentation overhead. Research-recommended skip.
- **Persist demo flag** so a tester doesn't need to re-click. Rejected per AC-7 — persistence risks silently dropping a logged-in user into demo mode after an upgrade, and a one-click flow is cheap enough.
- **Build the demo poller as a thin shim over `createPoller` + a fake `fetchPlaybackState`.** Plausible and was tempting, but `createPoller` only exposes `start/stop/.../pollNow`, not `play/pause/next/prev/seek/setVolume`. We need a custom handle anyway to mutate state, so duplicating the timer scheduling (~30 LOC) is cleaner than smuggling control side-effects through `fetchPlaybackState`.

## Risks / known unknowns

- **First-emit latency.** `attachPoller(demoPoller)` calls `start()` which calls `void tick()` immediately. We need `auth:startDemo` to *await* that first tick (or call `pollNow()` explicitly and await it) before returning, so `Dashboard.tsx:13`'s `player.get()` sees demo state on first render. If we forget, AC-3 may flicker between `no-device` and demo state. Caught by an integration-stage smoke test.
- **`createPoller` emits via `deps.emit`, not via the singleton's `getWin`.** When demo mode is active, we still want `webContents.send('player:state', state)`. The demo poller's `emit` callback in `ipc.ts` should be the same closure used for the Spotify poller (`(state) => getWin()?.webContents.send('player:state', state)`). Easy to share — extract once in `ipc.ts` scope.
- **Vitest test for `demoPoller` may flake if it accidentally uses real `setTimeout`.** Mitigation: the test injects `now: () => number` and only tests `pollNow()` synchronously (which calls `tick()` directly without scheduling). `start()`/`stop()` lifecycle is tested via mode flips, not via wall-clock ticks. Same pattern as `poller.test.ts:43-73`.
- **AC-2's "within one `auth:getStatus` cycle" wording.** Today the renderer doesn't poll `auth:getStatus`; it relies on the `auth:changed` push. The demo session emits `auth-changed { kind: 'logged-in' }` synchronously inside `start()`, which triggers `App.tsx:16`'s listener. Should satisfy AC-2 in practice; integration test will confirm.
- **`useTweenedPosition` and paused state.** When the demo is paused, the renderer's tween shouldn't advance. Existing code at `NowPlaying.tsx:12-22` already gates the tween on `state.isPlaying`, so this should Just Work — but worth verifying in the integration stage that pausing doesn't drift.
- **Window focus/visibility while in demo mode.** `setPollerFocus`/`setPollerVisibility` route through the singleton; demo poller honors them via `cadenceFor` like the Spotify poller. Cadence semantics (1Hz focused, 5Hz blurred, off-when-hidden) are inherited unchanged.
- **Multi-window edge case.** `main.ts:62-64` re-creates `mainWindow` on `activate` (macOS dock click after all windows closed), but `registerIpcHandlers` is only called once at boot. Demo mode flag survives; demo poller stays attached. Out of scope to deepen — same behavior as Spotify mode today.
