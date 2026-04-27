# Research — extend neon-stereo to YouTube / YouTube Music Premium and/or a free streaming path

> Reads: EXPLORE.md
> Generated: 2026-04-26

## Resolved

- **Q1: What "free" streaming options actually expose remote-control-style APIs?**
  A: Only one is a clean fit for an Electron/TS desktop app — **the YouTube IFrame Player API**. It's free, needs no OAuth for public videos, and exposes `loadVideoById` / `playVideo` / `pauseVideo` / `seekTo` / `setVolume` plus an `onStateChange` event (verified against `developers.google.com/youtube/iframe_api_reference`). The architectural twist: this is **in-app playback** (we host the player in a hidden/embedded BrowserWindow or `<iframe>`), not "remote control of an external app like Spotify". Other options ruled out: Spotify free tier returns 403 PREMIUM_REQUIRED on every control endpoint (already handled at `electron/spotify/client.ts:26-34`), so it can only deliver a read-only "now playing" widget. Last.fm has no controls. SoundCloud's public API has been closed to new app registrations for years. Local-file `<audio>` is a different product. Evidence: `electron/spotify/client.ts:26-34`, `electron/types.ts:56-65` (existing PREMIUM_REQUIRED handling).

- **Q2: YouTube Music vs YouTube — which can we actually drive?**
  A: **YouTube, not YouTube Music.** YT Music has no official public API for playback control or library reads. Unofficial libs (`ytmusicapi`, `node-youtube-music`) reverse-engineer internal endpoints — ToS-grey and brittle, not appropriate to ship. The realistic path: use the **YouTube IFrame Player API**, which plays any public YouTube video (including the official-artist-channel uploads and topic-channel auto-generated audio that *is* most of YT Music's catalog). For a user with YT Music Premium specifically, signing into the embedded player carries their account perks (no ads, background) into our app. Evidence: confirmed against `developers.google.com/youtube/iframe_api_reference` — public videos only, `videoId`-based.

- **Q3: Single-provider-at-a-time vs multi-provider switching?**
  A: **Single-provider-at-a-time, with runtime switching** — same shape as today's `mode: 'spotify' | 'demo'` flag in `electron/ipc.ts:20`. Generalize to `mode: 'spotify' | 'youtube' | 'demo'` (or a `Provider` interface with one active instance). Runtime swap is already proven by `startDemo`/`exitDemo` at `electron/ipc.ts:76-93`; the `attachPoller` singleton at `electron/spotify/poller.ts:197-200` is the swap seam. No need to run two providers concurrently — the renderer only knows about one `PlaybackState` stream.

- **Q4: Spotify-free degraded UX?**
  A: **Show NowPlaying read-only; hide Transport controls when scopes lack `user-modify-playback-state`.** The existing `PREMIUM_REQUIRED` toast at `src/components/Transport.tsx:46-49` already covers the "user clicked play but can't" case as a fallback. A cleaner UX: detect free-tier at connect time (the granted-scopes string is already captured at `electron/auth/oauth.ts:99-100`) and conditionally render Transport. Out of scope for the YouTube provider since that path uses our embedded player and always has full control.

- **Q5: Google OAuth ceremony — required?**
  A: **Not for v1.** The IFrame Player API plays public videos with **no OAuth at all**. The YouTube Data API v3 (used for search/metadata) accepts a plain API key for unauthenticated read of public data — 10,000 quota units/day default, search costs 100 units (≈100 searches/day), `videos.list` costs 1 unit (verified against `developers.google.com/youtube/v3/getting-started`). OAuth is only needed if we want personalized library reads (user's playlists, "liked songs"). If we go there later: GCP project + Desktop OAuth client + PKCE (Google supports it explicitly) + 127.0.0.1 loopback (supported for desktop, deprecated only on mobile) — and verification is required for sensitive scopes if anyone besides the developer uses it. Evidence: `developers.google.com/identity/protocols/oauth2/native-app`.

- **Q6: Naming / branding?**
  A: **Keep `neon-stereo` as the app name** — already provider-neutral. Update `README.md` (line: "Retro-styled, neon-accented desktop dashboard for controlling Spotify playback.") to mention multiple providers. `src/components/ConnectScreen.tsx:70` (`// RETRO REMOTE FOR YOUR SPOTIFY //`) and the `connect spotify` CTA at line 90 become per-provider buttons. `electron/auth/keychain.ts:11` (`ACCOUNT='spotify-refresh'`) becomes per-provider account names so both can be authed in parallel.

## Constraints to honor

- **Provider-agnostic state shapes**: `PlaybackState` / `Track` / `Device` (`electron/types.ts:3-30`) already work for any provider. Don't change them — map YouTube's player state into the same shape.
- **Bearer tokens never reach the renderer**: every existing IPC handler hits the API in main only (`electron/ipc.ts:60-67`, `electron/spotify/client.ts:91-120`). The YouTube IFrame is the exception — its player code runs in a renderer (the embed) — so any *YouTube Data API* calls (search) must still go through main, but the IFrame's player commands are renderer-side by design.
- **Pure mappers, separated from side effects**: `cadenceFor` and `mapPlaybackResponse` (`electron/spotify/poller.ts:5-90`) are deps-free and pinned by tests. Mirror this for YouTube — write a pure `mapYouTubePlayerState(playerState, currentTime, duration, videoMeta)` that the YT poller imports.
- **Two-step poller pattern**: `createPoller(deps)` → `attachPoller(handle)` (`electron/spotify/poller.ts:107-200`) is the swap seam. The YouTube provider must satisfy `PollerHandle` exactly (start/stop/setFocus/setVisibility/pollNow).
- **Typed errors + IPC serialization**: renderer branches on `code` strings (`src/components/Transport.tsx:46-57`). Don't drop the `SpotifyError` hierarchy — generalize to a `ProviderError` parent, keep existing codes alive, add YouTube-specific codes (e.g. `YT_QUOTA_EXCEEDED`, `YT_VIDEO_UNAVAILABLE`) as siblings.
- **Test coverage must hold**: 10 test files in `electron/__tests__/` pin pkce, refresh, error mapping, poller cadence, demo lifecycle, IPC boot. Don't break any of them when generalizing.
- **`mode` flag default behavior**: today the bare `npm run dev` boots Spotify mode. Adding a `youtube` mode means picking how a user opts in (env var, connect screen click, both).

## Prior art in this repo

- **`electron/demo/{session,poller,fixtures}.ts`** — the closest template for an "alt provider that doesn't talk to a real API and emits `PlaybackState` on cadence." The YouTube IFrame provider is structurally similar: it owns its own state (current video, position, playing/paused), the poller just samples-and-emits. Difference: instead of `advanceClock()` driven by `Date.now()` (`electron/demo/poller.ts:40-52`), the YT poller asks the IFrame for `getCurrentTime()` / `getPlayerState()`.
- **`electron/auth/oauth.ts:208-284` (`runLoopback`)** — Google OAuth would reuse this verbatim; only `AUTHORIZE_ENDPOINT` (`accounts.google.com/o/oauth2/v2/auth`), `TOKEN_ENDPOINT` (`oauth2.googleapis.com/token`), and `SCOPES` change. PKCE in `electron/auth/pkce.ts` is RFC-compliant and works for Google as-is.
- **`electron/spotify/client.ts:91-120` (`createSpotifyClient`)** — the typed-error + 401-refresh-retry shape generalizes to any HTTP provider. A `createYouTubeDataClient` for search would mirror it (substituting `mapYouTubeError`).
- **`electron/ipc.ts:55-93` (mode-aware boot + `startDemo`/`exitDemo`)** — the runtime-swap pattern to copy. Adding `startYouTube`/`exitYouTube` follows the same shape.
- **`electron/auth/keychain.ts`** — already has the keytar+JSON-fallback plumbing; adding a second `ACCOUNT` constant (or making `ACCOUNT` per-provider) is a one-line shape change.
- **`src/components/ConnectScreen.tsx`** — current logged-out CTA is a single button; the multi-provider version becomes a row of 2-3 buttons (spotify, youtube, demo).

## External references

- **YouTube IFrame Player API** — `https://developers.google.com/youtube/iframe_api_reference`. Free, JS-only, no OAuth for public videos. Methods: `loadVideoById`, `playVideo`, `pauseVideo`, `seekTo(seconds, allowSeekAhead)`, `setVolume(0-100)`, `getCurrentTime`, `getDuration`, `getPlayerState`. Event: `onStateChange` (states: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued).
- **YouTube Data API v3** — `https://developers.google.com/youtube/v3/getting-started`. Default 10,000 quota units/day. `search.list` = 100 units, `videos.list` = 1 unit. API-key auth works for unauthenticated public reads — no OAuth needed.
- **Google OAuth for installed apps** — `https://developers.google.com/identity/protocols/oauth2/native-app`. PKCE supported and recommended; 127.0.0.1 loopback supported for desktop apps; sensitive scopes trigger app verification when distributed beyond the developer.
- **Spotify Web API control endpoints + free-tier behavior** — already documented in this codebase: `electron/spotify/client.ts:26-34` (PREMIUM_REQUIRED reason on 403), `electron/spotify/poller.ts:14-50` (`mapPlaybackResponse`).

## Remaining unknowns (for design to handle)

- **Search UX vs paste-a-URL UX**: do we add an in-app search input (new component, costs ~1 search per query × 10k/day quota cap), or take the smaller "paste a YouTube URL / video ID" path for v1? Gut call: paste-URL for v1 (zero new UI; tests stay simple), add search later behind a feature flag.
- **Hidden BrowserWindow vs renderer `<iframe>`**: hidden `BrowserWindow` keeps audio playing even if the dashboard is minimized (autoplay policy easier to bypass with `webPreferences.autoplayPolicy='no-user-gesture-required'`); a renderer-side `<iframe>` is simpler and matches the existing single-window architecture but may have autoplay friction. Gut call: renderer iframe inside a hidden `<div>` within `Dashboard.tsx`, with a click-to-start gesture on first play (matches the Connect button click).
- **Personalized library access**: the user said "youtube or youtube music premium" — do they specifically want their YT Music library/playlists pulled in, or is "play any YouTube content" enough? Option A (full library) requires Google OAuth + GCP project + verification; Option B (search/paste only) needs only an API key. Defer to user; design should pick B unless told otherwise.
- **Default mode when both providers configured**: if `SPOTIFY_CLIENT_ID` *and* `YOUTUBE_API_KEY` are present in `.env`, which provider does the connect screen highlight? Gut call: last-used (persisted) > demo > whichever is configured.
- **Spotify-free read-only path**: do we ship it now (small change: detect missing `user-modify-playback-state` scope, hide Transport) or defer until someone asks? Gut call: defer — the YouTube path covers the "free music" ask more directly, and the `PREMIUM_REQUIRED` toast at `src/components/Transport.tsx:46-49` already prevents broken-button UX for free-tier Spotify users today.
- **Provider-mode transitions**: today demo↔spotify is one switch. With three modes, the state machine is bigger (3×2=6 transitions). Worth being explicit in design about which transitions require auth vs which are always allowed.
