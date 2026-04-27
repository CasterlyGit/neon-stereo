# Explore — neon-stereo

Target: extend the dashboard beyond Spotify Premium — to YouTube / YouTube Music Premium, and/or a free streaming option.

## Stack

- TypeScript on Node + browser
- Electron 33 (frameless macOS window) packaged via `electron-vite` (Vite 5)
- React 18 renderer (hand-rolled CSS, no UI lib)
- `keytar` for macOS Keychain (with 0600 JSON fallback)
- Tests: Vitest (unit + integration, mocked HTTP)
- Package manager: npm

## Layout

- `electron/main.ts` — BrowserWindow boot, focus/blur → poller cadence wiring
- `electron/preload.ts` — `contextBridge` exposes `window.neonStereo` (auth + player namespaces)
- `electron/ipc.ts` — central IPC handler registry; **today this is also the mode router** (`'spotify' | 'demo'`, switched by `NEON_DEMO=1`)
- `electron/types.ts` — shared types (`PlaybackState`, `Track`, `Device`, `AuthEvent`, typed `SpotifyError` hierarchy + `serializeError`)
- `electron/auth/` — `pkce.ts`, `oauth.ts` (loopback http://127.0.0.1:53682/callback), `keychain.ts`
- `electron/spotify/` — `client.ts` (typed error mapping + 401-refresh retry), `poller.ts` (cadence selector + `mapPlaybackResponse`)
- `electron/demo/` — `session.ts`, `poller.ts`, `fixtures.ts` — already proves the "alt provider" pattern (no API calls, synthetic state)
- `electron/__tests__/` — 10 test files covering pkce/refresh/error mapping/poller/demo lifecycle/IPC boot
- `src/` — React renderer: `App.tsx`, `components/{ConnectScreen,Dashboard,NowPlaying,Transport,DeviceBadge,NeonFrame,TitleBar}.tsx`, `styles/{tokens,global}.css`
- `dist/` — build output (main, preload, renderer)
- `.flow/issue-11/` — pipeline artifacts for this task

## Entry points

- run: `npm run dev` (electron-vite dev with HMR; `NEON_DEMO=1 npm run dev` skips auth)
- test: `npm test` (Vitest)
- build: `npm run build` (typecheck + bundle to `dist/`); `npm run typecheck` for tsc-only

## Conventions

- Strict TS, ESM source (`"type": "module"`); main bundled to CJS via electron-vite
- All Spotify HTTP lives in main process — bearer tokens never reach the renderer (see `electron/ipc.ts:60-67`, `electron/spotify/client.ts:91-120`)
- Errors are typed classes (`electron/types.ts:34-117`) and serialized over IPC via `serializeError`; renderer branches on `code` (`src/components/Transport.tsx:46-57`)
- Pure mappers separated from side effects: `cadenceFor` and `mapPlaybackResponse` in `electron/spotify/poller.ts:5-90` are deps-free, testable
- React components are functional, no class components, no UI library; CSS variables in `src/styles/tokens.css`
- Two-step poller pattern: `createPoller(deps)` returns a handle, `attachPoller(handle)` swaps into the singleton (`electron/spotify/poller.ts:171-200`) — this is the seam that makes the demo provider possible

## Recent activity

- branch: `auto/11-extend-support-to-free-softwar`
- last commits:
  - `eaa4b5f` demo mode (#10)
  - `75699f0` chore: add standard issue templates from workspace kit
  - `00b82d7` integration: v0.1 init
  - `3e767f8` docs: README run instructions + IMPLEMENTATION.log
  - `be2dbdb` feat(renderer): logged-out CTA + auth wiring
- uncommitted: only the untracked `inbox/` dir (workspace stuff, unrelated)

## Files relevant to this target

This is a Spotify-only app today; everything that mentions Spotify by name is a candidate touchpoint for adding a second provider.

- `electron/ipc.ts` — **central wiring**; today branches on `mode: 'spotify' | 'demo'`. A YouTube provider would slot in here as a third mode (or, better, a `Provider` interface; ipc dispatches per active provider). All 7 player IPC handlers and the auth handlers route through this file.
- `electron/types.ts` — `PlaybackState`/`Track`/`Device` are already provider-agnostic shapes. The `SpotifyError` hierarchy (`PremiumRequiredError`, `RateLimitError`, etc.) is Spotify-named but the structure generalizes; consider a `ProviderError` parent.
- `electron/spotify/poller.ts` — `cadenceFor` is provider-agnostic (already reused by `electron/demo/poller.ts:75`). `mapPlaybackResponse` is Spotify-specific. The `PollerHandle` interface + `attachPoller` singleton is the swap seam.
- `electron/spotify/client.ts` — Spotify-specific HTTP wrapper + error mapper. A YouTube/YT-Music client would live alongside as `electron/youtube/client.ts` with the same shape.
- `electron/auth/oauth.ts` — Spotify-flavored PKCE (`SCOPES`, `TOKEN_ENDPOINT`, `AUTHORIZE_ENDPOINT` are hard-coded constants at lines 18-24). YouTube/Google OAuth needs a different scope set + Google's authorize/token URLs, but the loopback machinery (`runLoopback` at line 208) is reusable as-is.
- `electron/auth/keychain.ts` — `SERVICE='neon-stereo'`, `ACCOUNT='spotify-refresh'` (line 10-11). Per-provider account names needed if both providers can be logged in.
- `electron/preload.ts` — exposes `window.neonStereo.{auth,player}`. Adding a provider may mean either `auth.loginYoutube()` etc. or a `provider` namespace.
- `electron/demo/{session,poller,fixtures}.ts` — **the template to copy**. This module already proves the "non-Spotify provider that satisfies the same `PollerHandle` and emits `PlaybackState`" pattern, including IPC mode swap (`startDemo`/`exitDemo`).
- `electron/main.ts` — `setPollerFocus`/`setPollerVisibility` already work polymorphically on whatever handle is attached; no changes likely needed beyond bootstrap.
- `src/App.tsx` — top-level routing only checks `auth.kind === 'logged-in'`. Currently no concept of "which provider"; the dashboard just shows whatever the active poller emits.
- `src/components/ConnectScreen.tsx` — copy is Spotify-specific (`"// RETRO REMOTE FOR YOUR SPOTIFY //"` line 70, `"connect spotify"` button line 90). New CTAs needed (e.g. "connect youtube music", "connect free", "try demo").
- `src/components/Transport.tsx:46-49` — handles `PREMIUM_REQUIRED` toast with Spotify-named copy. Provider-aware copy needed if the YouTube path can also raise a premium-required equivalent.
- `src/components/DeviceBadge.tsx` — surfaces `device.name`; already generic but worth reading once.
- `.env.example` — only declares `SPOTIFY_CLIENT_ID` + `NEON_DEMO`. New provider keys go here.
- `README.md` — claims "Retro-styled, neon-accented desktop dashboard for controlling Spotify playback." Needs broadening if scope expands.
- `package.json` — no current YouTube SDK dependency; nothing to remove.
- `electron/__tests__/` — every existing test file is a template for the new provider (auth, refresh, client retry, error mapping, poller, ipc lifecycle).

## Open questions for the next stage

1. **Free-streaming option** — the app architecturally requires a service that exposes a "now playing" + "play/pause/next/prev/seek/volume" remote-control API. Free options to evaluate:
   - YouTube Data API v3 + IFrame Player API in a hidden BrowserWindow — only requires a Google client ID, free tier; control is in-app, not "remote control of an external player" like Spotify.
   - Spotify's own free tier — read-only `/v1/me/player` works, but `PUT /me/player/play|pause|next|prev|seek|volume` returns 403 PREMIUM_REQUIRED. Already partially supported; we could degrade gracefully to read-only.
   - Last.fm scrobble feed (read-only "what's playing" with no controls) — probably not what the user wants.
   - SoundCloud public API (free, has play/pause but no cross-device "transfer playback").
   - Local file playback via Electron + `<audio>` (truly free, no API quota, no auth) — different product.
   Which of these counts as "free"? The user mentions YouTube Music (paid) **or** "free way to stream music", suggesting the free path can be a different product shape, not necessarily a remote-control of someone else's player.
2. **YouTube Music vs YouTube** — YT Music has **no official public API** for playback control. The realistic paths are: (a) the YouTube Data API + Iframe Embed (controls a YT video player embedded in the app, not the YT Music app), or (b) unofficial reverse-engineered libs like `ytmusicapi` (Python) — probably out of scope for an Electron TS app and ToS-grey. Worth confirming user intent: control YT Music desktop, or play YouTube videos as music inside our app?
3. **Provider model** — single-provider-at-a-time (the current `mode` flag pattern, simpler) vs. multi-provider (user picks at connect screen, can switch without quitting)? The demo mode already proves swap-at-runtime works.
4. **Premium-feature parity** — Spotify free can't transfer playback or control; if "free" means using Spotify free, the UI must hide Transport. Does the user want a degraded-but-visible UI or only the now-playing read?
5. **OAuth provider for Google** — Google's OAuth requires registration + verification; loopback redirect URIs need explicit allowlisting in the GCP console. Does the user have a Google Cloud project, or should we recommend one path that avoids that ceremony (Spotify-free read-only)?
6. **Naming** — `neon-stereo` is provider-neutral; the README and connect-screen copy aren't. Is renaming the only branding change, or do we keep "Spotify" prominent when that provider is selected?
