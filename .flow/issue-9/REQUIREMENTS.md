# Requirements — demo mode (run the app without Spotify auth)

> Source: issue-9 ("demo mode")
> Generated: 2026-04-26

## Problem

Today the app is unusable without a real Spotify OAuth round-trip: `ConnectScreen` is the only entry point until `auth:getStatus` returns `'logged-in'`, which only happens after a refresh token is written to keychain via `setRefreshToken`. That makes manual testing, screenshots, and trying the UI on a fresh machine impossible without Spotify Developer credentials. Research ruled out swapping Spotify for YouTube/Last.fm/Deezer (all still require user-scoped OAuth or lack a "now playing" surface), so the fix is a self-contained demo mode that emits synthetic `PlaybackState` through the existing data path.

## Users & contexts

- **Primary user**: a developer or evaluator who wants to launch the Electron app and immediately see `Dashboard` (`NowPlaying`, `Transport`, `DeviceBadge`) animate without setting `SPOTIFY_CLIENT_ID` or signing in. Activates either via `NEON_DEMO=1` (CI/screenshot path) or by clicking a "Try demo mode" button on `ConnectScreen` (human discovery path).
- **Other affected**: existing logged-in users — must not be silently dropped into demo mode, must not have their stored refresh token touched by anything in the demo flow.

## Acceptance criteria

- [ ] **AC-1** Launching the app with `NEON_DEMO=1` in the environment skips `ConnectScreen` entirely: on first render, `App.tsx` mounts `<Dashboard/>` because `auth:getStatus` returns `kind: 'logged-in'` without a keychain refresh token having been written.
- [ ] **AC-2** When `NEON_DEMO` is unset, `ConnectScreen` shows a "Try demo mode" button beside the existing "Connect Spotify" button; clicking it invokes a new `window.api.auth.startDemo()` IPC and the renderer transitions to `<Dashboard/>` within one `auth:getStatus` cycle.
- [ ] **AC-3** While in demo mode, `DeviceBadge` displays the literal text `DEMO` (sourced from `Device.name` on the synthetic `PlaybackState`), and `NowPlaying` shows a non-empty track title, artist, and either bundled album art or the existing `artUrl: null` fallback — with no network requests to `api.spotify.com` made by the main process.
- [ ] **AC-4** With no user interaction, `NowPlaying`'s position indicator advances continuously (via the existing `useTweenedPosition` 250 ms tween anchored on `state.asOf`), and when a fixture track's `positionMs` exceeds its `durationMs` the next emitted `PlaybackState` advances to the next fixture track with `positionMs` reset to 0.
- [ ] **AC-5** In demo mode, clicking play/pause in `Transport` flips the play icon within one poll cycle; clicking next/prev rotates to the adjacent fixture track; dragging the seek bar updates `positionMs`; and the volume control updates `device.volumePercent` — none of these are no-ops, and none throw uncaught errors that would trip the `safe`/`showToast` wrapper at `Transport.tsx:42-58`.
- [ ] **AC-6** Entering, using, or exiting demo mode never calls `setRefreshToken` or `clearRefreshToken` in `electron/auth/keychain.ts`; a real Spotify refresh token already in the OS keychain before demo activation is still present (verifiable via `keytar.getPassword`) after the demo session ends.
- [ ] **AC-7** Demo state is per-process: quitting and relaunching the app without `NEON_DEMO=1` and without clicking the demo button returns the user to `ConnectScreen` (i.e. `auth:getStatus` reports `'logged-out'`) with no residual demo flag in any persisted store.
- [ ] **AC-8** Clicking "disconnect" on `Dashboard` while in demo mode returns the renderer to `ConnectScreen` and stops the demo poller (no further `playback:update` events are emitted on the IPC bus); a subsequent click of "Try demo mode" starts a fresh demo session from the first fixture track.

## Out of scope

- Replacing Spotify with a real third-party backend (YouTube Data API, Last.fm, Deezer, MusicBrainz) — research showed none of them remove the OAuth requirement.
- A `--demo` CLI flag on `app.commandLine` (env var + button is sufficient for v1).
- Persisting demo mode across app launches.
- Widening the `AuthEvent` / `AuthStatus` discriminated union to add a `'demo'` `kind` (renderer continues to treat demo as `'logged-in'`); a colored top-bar chip beyond the `DEMO` device label is a design-stage decision, not a requirement.
- Making `auth:getToken` return a usable bearer in demo mode (renderer doesn't call it; `null` is acceptable).
- Demo-mode telemetry, analytics, or "how did you hear about us" copy.

## Open questions

- **Exit affordance wiring**: should `Dashboard`'s disconnect button always call `auth.logout()` and have the main process internally dispatch to demo-exit when in demo mode (renderer stays pure), or should the renderer call a distinct `auth.exitDemo()` IPC? Research leans toward internal dispatch — design to confirm.
- **Fixture size and shape**: 3 vs 4 vs 5 tracks; whether to include one with `artUrl: null` to exercise the "no art" branch in `NowPlaying.tsx:72-80`. Research suggests 4 tracks with varied short durations (e.g. 30s/90s/180s/240s) so `next` is visibly snappy.
- **Env-var name**: `NEON_DEMO=1` (research's recommendation) vs `DEMO=1` vs `NEON_STEREO_DEMO=1`. Whichever is chosen must be reflected together in `.env.example` and `README.md`.
- **`SPOTIFY_CLIENT_ID not set` warning** (`electron/ipc.ts:14`): suppress, reword, or leave noisy when `NEON_DEMO=1`?
- **Album-art licensing source**: which CC0 source (Unsplash CC0, Openverse, hand-drawn) is acceptable for bundling under `src/assets/demo/`, and what total payload ceiling (~250 KB across fixtures)?
