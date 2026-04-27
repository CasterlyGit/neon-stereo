# Research — demo mode (run the app without Spotify auth)

> Reads: EXPLORE.md
> Generated: 2026-04-26

## Resolved

- **Q: Could YouTube (or any free-tier alternative) replace Spotify as a real backend?**
  A: **No** — none of the candidates remove the OAuth burden the issue is trying to escape.
  - Spotify: every `currently-playing` / control endpoint requires a user-scoped token (Client Credentials can't read user state). Evidence: scopes hard-coded at `electron/auth/oauth.ts:20-24` (`user-read-playback-state`, `user-modify-playback-state`).
  - YouTube Data API v3: an API key works for catalog reads but the IFrame Player API has no "what is the user playing" surface, and the Data API's `videos`/`search` endpoints don't model playback state. Replacing Spotify means a full OAuth dance against Google, plus rebuilding `mapPlaybackResponse` for a foreign shape — strictly more work than demo mode.
  - Last.fm / MusicBrainz / Deezer: free metadata only, no "now playing on this user's account" feed.
  - Conclusion: ship demo mode with an embedded fixture, as the issue's fallback already anticipates ("otherwise demo mode will siffice").

- **Q: How is demo mode activated?**
  A: **Both** — env var (`NEON_DEMO=1`) read in `electron/main.ts` and threaded into `registerIpcHandlers`, *and* a "Try demo mode" button on `ConnectScreen` that calls a new `auth.startDemo()` IPC. Env var = trivial CI/screenshot path; button = discoverable for human testers. Same underlying state machine; the button just sets the flag at runtime. Evidence: env-var pattern already in repo (`electron/ipc.ts:11` reads `process.env['SPOTIFY_CLIENT_ID']`); `ConnectScreen.tsx:59-76` has the obvious UI seam next to the existing connect button.

- **Q: Should demo mode persist across launches?**
  A: **No**. Always opt-in fresh per process. Reasoning: keytar holds the real Spotify refresh token (`electron/auth/keychain.ts` via `setRefreshToken` at `oauth.ts:109`) and demo state must not touch it — otherwise a tester could be silently in demo mode after a real login. Keep the demo flag in-memory only, mirroring how `state: AuthState` lives in the `createOAuth` closure (`oauth.ts:53`). Env var re-asserts on each launch; button is per-session.

- **Q: Should the demo track auto-progress?**
  A: **Yes**. The renderer already tweens locally at 250 ms via `useTweenedPosition` (`src/components/NowPlaying.tsx:12-22`), anchored on `state.asOf`. Demo poller just needs to emit a `PlaybackState` whose `positionMs + (Date.now() - asOf)` advances naturally — set `asOf = Date.now()` on each emit and let the renderer interpolate. When the synthetic position passes `track.durationMs`, advance to the next fixture track and reset `positionMs` to 0. No new clock primitive needed.

- **Q: Are play/pause/next/prev mutations or no-ops in demo mode?**
  A: **Mutations**, with an immediate re-emit. Evidence: `Transport.tsx:97-105` flips state by re-issuing IPCs and waiting for the next poll — no-ops would freeze the play/pause icon (`isPlaying` derived from `state.kind === 'playing'` at `Transport.tsx:20`), which would look broken. Implement as: `player:play` flips `isPlaying=true` + resets `asOf`, `player:pause` flips `false`, `player:next/prev` rotate the fixture index, `player:seek` writes `positionMs`, `player:volume` writes `device.volumePercent`. Then call `poller.pollNow()` (already the pattern at `ipc.ts:90`).

- **Q: Visible "DEMO" badge?**
  A: **Yes**, but cheaply. Set the synthetic `Device.name = 'DEMO'` (`electron/types.ts:11-16`); `DeviceBadge` will render it verbatim. Avoid widening the `AuthEvent`/`AuthStatus` union unless we need a CSS-level treatment — keeping `kind: 'logged-in'` means zero changes to `App.tsx:6-28` or `global.d.ts:9`. (Open: design may still choose to widen the union for a colored badge — see Remaining unknowns.)

- **Q: Album art — bundled vs hotlinked?**
  A: **Bundled**, served via Vite's `import` for the renderer. Reasoning: the demo's whole pitch is "no setup, no network" — a hotlinked URL would 404 in airplane-mode demos and create flaky screenshots. `NowPlaying.tsx:72-80` already handles `artUrl: null` gracefully (renders "no art"), so a missing image won't crash. Bundle 3-5 small (≤80 KB) CC0 images under `src/assets/demo/` and reference them by their Vite-resolved URLs in the fixture. The renderer-bundled URLs survive the contextBridge as plain strings.

- **Q: Should `createDemoPoller`/fixture be unit-tested?**
  A: **Yes** — tiny tests, in line with repo conventions. Add `electron/__tests__/demoPoller.test.ts`. Cover: (1) emits a fixture-derived `PlaybackState` whose `device.name === 'DEMO'`, (2) `next()` rotates to the second track, (3) `pause()` then `play()` toggles `isPlaying`, (4) when `positionMs + elapsed > durationMs` the next emit advances to the next fixture. Mirrors `poller.test.ts:43-73` pure-mapping style — no real timers, inject `now`.

## Constraints to honor

- **Renderer must not need to know about demo mode for the data path.** All synthetic data goes through the existing `PlaybackState` shape (`electron/types.ts:18-30`); `NowPlaying`, `Transport`, `DeviceBadge` must work unchanged. The only renderer addition is the *button* on `ConnectScreen`.
- **Refresh token isolation.** Demo flow must never call `setRefreshToken` / `clearRefreshToken` (`electron/auth/keychain.ts`). Specifically, demo's `logout` (a.k.a. "exit demo") must clear in-memory state only. A real `auth.logout` while in demo mode should still work and return us to logged-out, untouched.
- **`auth:getStatus` semantics.** Today it returns `'logged-in'` if a stored refresh token exists (`ipc.ts:72-78`). Demo mode must report `'logged-in'` *without* writing a token, so the existing branch in `App.tsx:25` routes to `<Dashboard/>` automatically. The status response shape (`AuthStatus = { kind }`) is fine as-is for v1; widening is optional.
- **IPC handler set is fixed by `preload.ts:6-34`.** New IPCs (`auth:startDemo`, `auth:exitDemo`) require matching entries in `preload.ts` and `src/global.d.ts:7-12`. Any drift fails strict tsc (`npm run typecheck`).
- **Poller singleton.** `attachPoller` (`spotify/poller.ts:197-200`) replaces `activePoller`. Switching modes mid-session needs a clean `activePoller.stop()` before attaching the demo poller — otherwise both timers tick and the renderer flickers between real and synthetic state.
- **Strict TS, no `any`.** Existing modules use `unknown` + narrowing (`mapPlaybackResponse`, `serializeError`). Demo fixture must be statically typed as `Track[]` / `Device`.
- **`SPOTIFY_CLIENT_ID not set` warning at `ipc.ts:14` is fine in demo mode** — but the warning text is misleading. Suppress it (or reword) when `NEON_DEMO=1` so the dev-mode console isn't noisy.

## Prior art in this repo

- `electron/spotify/poller.ts:107-169` (`createPoller`) — the exact handle shape (`start/stop/setFocus/setVisibility/pollNow`) the demo poller must implement so `attachPoller` accepts it without changes.
- `electron/spotify/poller.ts:14-50` (`mapPlaybackResponse`) — feed it canned response bodies to synthesize `PlaybackState`. Simpler than constructing the discriminated union by hand and exercises the same code path real responses do.
- `electron/auth/oauth.ts:51-192` (`createOAuth`) — closure-state + EventEmitter pattern. Mirror it for `createDemoSession` (in-memory `kind: 'demo' | 'off'`, emits `auth-changed`). Same `on/off/getStatus` surface so swapping is mechanical in `ipc.ts`.
- `electron/__tests__/poller.test.ts:17-91` — the exact test style (pure functions, no timers, inject `now`) to mirror for `demoPoller.test.ts`.
- `src/components/Transport.tsx:42-58` (`safe`/`showToast`) — the pattern that already swallows errors per-control. Demo handlers shouldn't throw in normal flows, so this stays a no-op safety net.

## External references (if any)

- None required. Spotify Web API docs were already known via `electron/spotify/client.ts` and `oauth.ts`; nothing about YouTube / Last.fm changed the conclusion above.
- CC0 album-art sources for bundling (design-stage choice, not blocking research): unsplash.com `?license=cc0`, openverse.org, or hand-drawn placeholders. Keep total payload ≤ ~250 KB across all fixture images.

## Remaining unknowns (for design to handle)

- **Auth union shape.** Stick with `kind: 'logged-in'` and rely on `Device.name === 'DEMO'` for the badge (zero-renderer-change), OR widen `AuthEvent`/`AuthStatus` to `'demo'` and let `Dashboard` render a colored chip. Gut call: **start narrow** (option A); widen only if the design wants a top-bar treatment that `DeviceBadge` can't carry.
- **Fixture content.** 3 vs 5 tracks; whether to include one paused-by-default and one with `artUrl: null` to exercise both code paths. Suggest 4 tracks, all `playing`, varied durations (90s / 180s / 240s / 30s) to make `next` visibly advance fast during a demo.
- **Exit affordance.** `Dashboard.tsx:43` wires "disconnect" to `auth.logout()`. In demo mode the same button can call a new `auth.exitDemo()` IPC, OR `auth.logout()` can detect demo state and dispatch internally. Internal dispatch keeps the renderer pure (preferred), but design may prefer an explicit "exit demo" label for clarity.
- **Env-var name.** `NEON_DEMO=1` reads cleanly; alternatives `DEMO=1` (collides with other tooling) or `NEON_STEREO_DEMO=1` (verbose). Pick one in `.env.example` and `README.md` together.
- **CLI flag parity.** `--demo` on `app.commandLine` is trivial in `main.ts` but adds a second activation path to document. Suggest **skip** for v1; env var + button is enough.
- **Should demo mode mark `auth:getToken`?** Today returns the bearer string (`ipc.ts:79-81`). Demo can return `null` (caller would fail) or a sentinel (`'demo'`). Renderer doesn't currently call `getToken`, so any answer works — pick `null` and document as "not callable in demo".
