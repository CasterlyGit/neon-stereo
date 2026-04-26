# Explore — neon-stereo

Target: **demo mode** — let the user run the app without going through Spotify PKCE auth, so the dashboard can be shown / tested with fake (or third-party-free) playback data. Issue text also asks: investigate whether YouTube (or any free-tier alternative) could replace Spotify; otherwise demo mode is the fallback.

## Stack
- TypeScript 5.6, React 18, Electron 33, Vite 5 via `electron-vite` 2
- Package manager: `npm` (lockfile `package-lock.json`)
- Test runner: Vitest 2 (`vitest.config.ts`)
- Native dep: `keytar` (with JSON-file fallback already implemented)
- No lint/prettier config in repo; conventions enforced via strict `tsc`

## Layout
- `electron/` — main + preload + auth + spotify modules (Node side)
  - `electron/main.ts` — BrowserWindow boot, focus/visibility wiring, calls `registerIpcHandlers`
  - `electron/ipc.ts` — single source of all `ipcMain.handle(...)` registrations and the `createPoller` wiring
  - `electron/preload.ts` — `contextBridge` exposes `window.neonStereo` (`auth.*`, `player.*`)
  - `electron/types.ts` — `PlaybackState`, `Track`, `Device`, `AuthEvent`, error classes, `serializeError`
  - `electron/auth/{oauth,pkce,keychain}.ts` — PKCE + loopback server + refresh-token storage
  - `electron/spotify/{client,poller}.ts` — typed API client w/ error mapping; pure `mapPlaybackResponse` + `createPoller`
  - `electron/__tests__/*.test.ts` — Vitest specs
- `src/` — React renderer
  - `src/App.tsx` — top-level switch on `auth.kind` → `<ConnectScreen/>` vs `<Dashboard/>`
  - `src/components/{ConnectScreen,Dashboard,NowPlaying,Transport,DeviceBadge,NeonFrame,TitleBar}.tsx`
  - `src/styles/{global.css,tokens.css}` — the retro-neon look
  - `src/global.d.ts` — augments `Window` with `neonStereo` API surface
- `index.html`, `electron.vite.config.ts`, `tsconfig.json`, `vitest.config.ts` — top-level build config
- `.env.example` — only `SPOTIFY_CLIENT_ID`
- `dist/` — build output, gitignored

## Entry points
- run (dev): `npm run dev` (electron-vite, HMR on renderer; reads `SPOTIFY_CLIENT_ID` from `.env`)
- test: `npm test` (vitest run) / `npm run test:watch`
- build: `npm run build` (typechecks both tsconfigs, bundles main+preload+renderer to `dist/`)
- typecheck: `npm run typecheck`

## Conventions
- ESM in renderer, CJS bundle for main/preload (`electron.vite.config.ts:13,27`)
- Strict TS, two tsconfigs (`tsconfig.json`, `electron/tsconfig.json`)
- All Spotify network calls live in main; renderer only talks IPC via `window.neonStereo` — see preload at `electron/preload.ts:6-34` and renderer usage at `src/components/Transport.tsx:60-65`
- IPC errors are serialized via `serializeError` (`electron/types.ts:111`) so the renderer can branch on `.code` (e.g. `Transport.tsx:46-57`)
- Pure-function design for testables: `mapPlaybackResponse` (`electron/spotify/poller.ts:14`), `cadenceFor` (`poller.ts:6`), `mapSpotifyError` (`spotify/client.ts:19`)
- Components are functional, hand-rolled inline styles + CSS vars (`var(--accent)`, `var(--glow)`) — no UI library
- Test files in `electron/__tests__/*.test.ts`; no renderer-side tests

## Recent activity
- branch: `auto/9-demo-mode`
- last commits:
  - `75699f0` chore: add standard issue templates from workspace kit
  - `00b82d7` integration: v0.1 init
  - `3e767f8` docs: README run instructions + IMPLEMENTATION.log
  - `be2dbdb` feat(renderer): logged-out CTA + auth wiring
  - `d5fd2e6` feat(renderer): NowPlaying + Transport + DeviceBadge
- uncommitted: only untracked `inbox/` (workspace metadata, unrelated). Working tree clean otherwise.

## Files relevant to this target

A demo-mode feature must hook in at the auth boundary AND short-circuit the Spotify-bound poller / control IPC handlers. The seams are clean — the existing main/preload/IPC split means the renderer will need almost no changes if demo mode is implemented entirely in the main process.

- `electron/ipc.ts` — primary edit site. Today every handler ultimately calls `oauth.getAccessToken()` and `fetch('https://api.spotify.com/v1/me/player')`. Demo mode needs to swap the `fetchPlaybackState` impl + the control side-effects. Lines `36-56` (poller wiring) and `59-124` (handler registrations) are the surface to refactor.
- `electron/auth/oauth.ts` — `getStatus()` and `getAccessToken()` define what "logged-in" means today (`oauth.ts:165-177`). Demo mode is effectively a third auth state; need to decide whether to extend the union or to gate before reaching this module.
- `electron/types.ts:18-32` — `PlaybackState` and `AuthEvent` types. Demo mode probably reuses `playing|paused|idle|no-device` as-is and just feeds canned data, so no type changes needed for playback. May want a `kind: 'demo'` discriminator on `AuthStatus`/`AuthEvent` if we want the UI to badge "DEMO".
- `electron/spotify/poller.ts:14-90` — `mapPlaybackResponse` already produces well-formed `PlaybackState`s; we can synthesize fake response bodies and run them through this same mapper to get realistic states (artists, album, art, progress).
- `electron/main.ts:11-65` — BrowserWindow setup; demo entry point could be a CLI flag (`--demo`) or env var (`NEON_DEMO=1`) read here and threaded into `registerIpcHandlers`.
- `electron/preload.ts` + `src/global.d.ts` — only need updates if we expose explicit `auth.startDemo()` / `auth.exitDemo()` controls. A "no UI changes" implementation can avoid touching these.
- `src/App.tsx:6-28` — branches on `auth.kind`. Currently `'logged-in' | 'logged-out' | 'unknown'`; demo mode reuses `logged-in` if we want zero renderer change, OR we widen it to render a "DEMO" badge.
- `src/components/ConnectScreen.tsx:59-76` — natural place to add a secondary "Try demo mode" button next to **connect spotify**.
- `src/components/Dashboard.tsx:39-46` — `DeviceBadge` + disconnect row; good place to surface a "DEMO" indicator.
- `src/components/NowPlaying.tsx`, `Transport.tsx` — should work unchanged when fed synthetic `PlaybackState`. `Transport` already debounces seek/volume and tolerates errors; in demo mode the seek/volume IPCs just need to mutate fake state and re-emit.
- `README.md:20-44` — "Setup" section will need a demo-mode bullet so a tester can launch without registering a Spotify app.
- `.env.example` — may add a documented `NEON_DEMO=1` toggle.

### Demo-data sources to consider (Open question for next stage)

- **Spotify**: no unauthenticated `currently-playing` endpoint exists (their public catalog endpoints require a Client Credentials token, which still requires a developer app). Cannot replace PKCE.
- **YouTube Data API v3**: requires an API key. The IFrame Player API can play tracks in a webview but doesn't give us a "what's currently playing on the user's account" feed without OAuth. Same auth burden, different vendor — not a free win.
- **Deezer / Last.fm / MusicBrainz**: free public catalog metadata, but no "now playing" surface. Could power a fake feed driven by canned tracklists.
- **Recommendation**: ship demo mode with a small embedded fixture (3-5 tracks, looping, with public-domain or placeholder art URLs) rather than chasing a third-party free tier. This is what the issue text falls back to ("otherwise demo mode will siffice").

## Open questions for the next stage
- Activation: env var (`NEON_DEMO=1`), CLI flag (`--demo`), or in-app button on the Connect screen? The button is most discoverable; env var is easiest to test from CI.
- Should demo mode persist across app launches or always be opt-in fresh? (Refresh token currently persists in keychain — demo state shouldn't touch it.)
- Should the demo "track" auto-progress (timer-driven `progress_ms`) so the 1Hz tween in `NowPlaying.useTweenedPosition` looks alive? Yes seems right; needs a fake `asOf`.
- Do play/pause/next/prev mutate fake state and re-emit, or are they no-ops with a toast? Mutating produces a more honest demo of `Transport.tsx`.
- Do we surface a visible "DEMO" badge so a screenshot can't be confused for real connected state? Likely yes — extend `AuthEvent` with a third kind, or piggy-back on `Device.name = 'DEMO'`.
- Album art: bundle a few CC0 images locally (offline-safe) vs. hotlink? Bundled is more robust for a "no-network" demo.
- Tests: should `createDemoPoller`/fixture be unit-tested under `electron/__tests__/` for parity with the existing pattern?
