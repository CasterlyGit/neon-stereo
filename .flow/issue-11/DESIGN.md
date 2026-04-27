# Design — multi-provider: Spotify + YouTube (free + Premium-aware)

> Reads: EXPLORE.md, RESEARCH.md (no REQUIREMENTS.md present — ACs derived from issue body and pinned at the bottom of this doc)
> Generated: 2026-04-26

## Approach

Add a third provider, **`youtube`**, to the existing `mode` router in `electron/ipc.ts`. A single YouTube implementation satisfies both halves of the issue: for users with a YouTube / YouTube Music Premium account it carries their perks (no ads, background) when they sign into the embedded player; for free users it plays public YouTube videos with no auth at all. The provider is built on the **YouTube IFrame Player API** (free, no OAuth for public videos, full play/pause/seek/volume control + state events) hosted in the renderer; the existing main-process `PollerHandle` swap-seam (`attachPoller`) and shared `PlaybackState` IPC channel remain the single source of truth, so the renderer's state path is the same for all three providers. v1 ships **paste-a-URL / video-ID** ingestion (no Data API search → no API key required), with search left as a flagged v2 follow-up. Alternatives considered: a Spotify-free read-only path (deferred — doesn't cover the "stream music" ask) and unofficial `ytmusicapi` reverse-engineered libs (rejected — ToS-grey, brittle, not for shipping).

## Components touched

| File / module | Change |
|---|---|
| `electron/ipc.ts` | Generalize `mode: 'spotify' \| 'demo'` → `mode: 'spotify' \| 'youtube' \| 'demo'`. Add `startYouTube` / `exitYouTube` mirroring `startDemo` / `exitDemo`. Branch every player handler on the new third arm. Add `provider:getActive` / `provider:setActive` IPC. Wire the new `yt:state` listener (renderer→main push; main re-emits as `player:state`) and `yt:control` sender (main→renderer command pump). |
| `electron/types.ts` | Introduce `ProviderError` as a parent class; rename `SpotifyError extends ProviderError`; keep all existing codes alive. Add `YouTubeError` siblings: `YT_VIDEO_UNAVAILABLE`, `YT_EMBED_DISABLED`, `YT_PLAYER_NOT_READY`, `YT_NETWORK_ERROR`. `serializeError` extended to walk the new parent. **No change to `PlaybackState` / `Track` / `Device`** — already provider-agnostic. |
| `electron/preload.ts` | Add `window.neonStereo.provider.{getActive, setActive}` and `window.neonStereo.youtube.{loadVideoId, getQueue}`. Existing `auth.*` and `player.*` namespaces unchanged. |
| `electron/auth/keychain.ts` | `ACCOUNT` becomes a function `accountFor(provider)`; only `'spotify-refresh'` is wired in v1 (YT v1 has no auth). Existing single-arg call sites updated to pass `'spotify'`. |
| `electron/main.ts` | No semantic change. `setPollerFocus` / `setPollerVisibility` already polymorphic on the active handle. Confirm `webPreferences.contextIsolation` is on for the YT iframe to use postMessage safely. |
| `src/App.tsx` | No routing change — still toggles `Dashboard` vs `ConnectScreen` on `auth.kind`. Reads new `provider.getActive()` once at boot to decide what to render inside `Dashboard`. |
| `src/components/ConnectScreen.tsx` | Replace single CTA with three: `connect spotify` / `connect youtube` / `try demo`. Strip Spotify-specific tagline (`// RETRO REMOTE FOR YOUR SPOTIFY //` → `// RETRO REMOTE FOR YOUR MUSIC //`). |
| `src/components/Dashboard.tsx` | Conditionally mount `<YouTubeEmbed />` when active provider is `youtube`. Existing `NowPlaying`/`Transport`/`DeviceBadge` unchanged — they just render whatever `PlaybackState` arrives. |
| `src/components/Transport.tsx` | Generalize the `PREMIUM_REQUIRED` toast copy to be Spotify-only (gate by `code` and provider) and add a non-fatal toast path for `YT_VIDEO_UNAVAILABLE` / `YT_EMBED_DISABLED`. |
| `.env.example` | Add commented `# YOUTUBE_API_KEY=` (unused in v1; placeholder for v2 search). Add `# NEON_DEFAULT_PROVIDER=spotify` boot override. |
| `README.md` | Broaden the one-line description; add a `Providers` section listing Spotify, YouTube, Demo and what each requires. |

## New files

- `electron/youtube/poller.ts` — `createYouTubePoller(deps)` returns `PollerHandle & { loadVideoId, play, pause, next, prev, seek, setVolume, getState }`. Owns the cadence timer (reuses `cadenceFor` from `electron/spotify/poller.ts`); each tick sends `yt:request-state` to the renderer to force a fresh snapshot. Listens to `yt:state` pushes (both periodic replies and `onStateChange`-driven events) and forwards as `PlaybackState` via `deps.emit`.
- `electron/youtube/mapper.ts` — pure `mapYouTubePlayerState(rawState, videoMeta, now)` that converts IFrame Player states (`-1` unstarted, `0` ended, `1` playing, `2` paused, `3` buffering, `5` cued) plus `currentTime` / `duration` / `videoId` / `title` into `PlaybackState`. Mirrors the shape of `mapPlaybackResponse` in `electron/spotify/poller.ts:14`. `kind: 'no-device'` when iframe never reached `cued`; `kind: 'idle'` when ready but no video loaded; `playing` / `paused` otherwise. `device.id = 'yt-embed'`, `device.name = 'YouTube'`.
- `electron/youtube/queue.ts` — minimal in-memory queue of `{ videoId, title?, durationMs? }` plus `next()` / `prev()` helpers. Persists last 20 entries to `Application Support/neon-stereo/preferences.json` (next/prev across restarts); not a playlist database.
- `electron/youtube/preferences.ts` — read/write `preferences.json` (`{ lastProvider, ytQueue }`). Same dir as the keychain JSON fallback; 0600 mode; no env coupling.
- `src/components/YouTubeEmbed.tsx` — mounts a hidden `<iframe>` to `https://www.youtube.com/embed/?enablejsapi=1` (or empty, then `loadVideoById`). Loads the IFrame Player API via `<script src="https://www.youtube.com/iframe_api">`. Listens to `ipcRenderer.on('yt:control', ...)` to receive commands; pushes state via `ipcRenderer.send('yt:state', ...)` on `onStateChange` and on `yt:request-state` poll ticks. Maps state via `mapYouTubePlayerState` (imported through preload-exposed helper, *or* mapper duplicated if cross-bundle import is awkward — see Risks).
- `src/components/UrlPasteBar.tsx` — small input above `Transport` (visible only in YT mode). Accepts a YouTube URL or video ID, validates with a regex, calls `window.neonStereo.youtube.loadVideoId(id)`. v1 has no search; this is the only ingestion path.
- `electron/__tests__/youtube-mapper.test.ts` — pin every IFrame Player state code → `PlaybackState` mapping; pin no-device / idle / playing / paused / ended transitions.
- `electron/__tests__/youtube-poller.test.ts` — pin cadence reuse, command forwarding (`play()` calls `yt:control` with `{ kind: 'play' }`), state-push handling (renderer push → `emit` called with mapped state).
- `electron/__tests__/ipc-mode-router.test.ts` — pin the 6 `mode` transitions: spotify↔demo, spotify↔youtube, demo↔youtube. Pin that `auth:logout` from `youtube` clears the active poller without throwing.

## Data / state

**In-process state** (`electron/ipc.ts`):

- `mode: 'spotify' | 'youtube' | 'demo'` — exactly one active at a time. Boot order: `NEON_DEMO=1` → demo. Else `NEON_DEFAULT_PROVIDER` env → that. Else `preferences.json#lastProvider` → that. Else `spotify`.
- `youtubePoller: PollerHandle | null`, `demoPoller: DemoPollerHandle | null`, `spotifyPoller: PollerHandle` (existing). Mutually exclusive via `attachPoller`.
- `ytQueue: { videoId, title?, durationMs? }[]` — owned by `electron/youtube/queue.ts`.

**Persisted state** (new file `~/Library/Application Support/neon-stereo/preferences.json`, 0600):

```json
{ "lastProvider": "spotify" | "youtube" | "demo" | null,
  "ytQueue": [{ "videoId": "dQw4w9WgXcQ", "title": "...", "durationMs": 213000 }] }
```

**Env vars** (`.env.example`):

| Var | Purpose | v1 status |
|---|---|---|
| `SPOTIFY_CLIENT_ID` | existing | unchanged |
| `NEON_DEMO=1` | existing | unchanged |
| `NEON_DEFAULT_PROVIDER` | boot-time override (`spotify` \| `youtube` \| `demo`) | new |
| `YOUTUBE_API_KEY` | Data API search | placeholder; unused in v1 |

**IPC channel additions:**

| Channel | Direction | Payload |
|---|---|---|
| `provider:getActive` | renderer→main (invoke) | → `'spotify' \| 'youtube' \| 'demo'` |
| `provider:setActive` | renderer→main (invoke) | `name` → void; throws if precondition fails (e.g. spotify without auth) |
| `auth:startYouTube` | renderer→main (invoke) | void |
| `yt:loadVideoId` | renderer→main (invoke) | `{ videoId: string }` → void |
| `yt:control` | main→renderer (send) | `{ kind: 'play' \| 'pause' \| 'next' \| 'prev' } \| { kind: 'seek', ms } \| { kind: 'volume', percent } \| { kind: 'loadVideoId', id }` |
| `yt:request-state` | main→renderer (send) | void (poll trigger) |
| `yt:state` | renderer→main (send) | `PlaybackState` (already-mapped; main re-emits as `player:state`) |

## Public API / surface

**Preload (`window.neonStereo`)**:

```
auth: { login, logout, getStatus, getToken, startDemo, exitDemo,
        startYouTube,  // new — provider switch with no auth
        onAuthChange }
provider: { getActive(): Promise<Provider>,
            setActive(name: Provider): Promise<void> }   // new namespace
youtube:  { loadVideoId(id: string): Promise<void>,
            getQueue(): Promise<QueueItem[]> }            // new namespace
player:   { get, play, pause, next, prev, seek, setVolume, onState }  // unchanged
```

**Connect-screen UX**: three CTAs side by side. `connect spotify` (existing flow). `connect youtube` calls `auth.startYouTube` (no OAuth in v1; just a mode flip). `try demo` (existing).

**Provider switching at runtime**: same shape as `auth.startDemo` / `auth.exitDemo`. From the dashboard, a small "switch provider" affordance (tucked in TitleBar; out of v1 unless trivial) calls `provider.setActive(name)`. Switching auto-pauses the outgoing provider.

**v1 has no UI hotkeys / CLI flags beyond what already exists** — env vars only.

## Failure modes

| Failure | How we detect | What we do |
|---|---|---|
| YouTube video ID invalid / unavailable | IFrame `onError` event (codes 100, 101, 150) → renderer pushes `YT_VIDEO_UNAVAILABLE` via `yt:state` (state kind `idle` + side-channel error event) | Toast in Transport ("video unavailable"); pop the bad ID from queue; advance to next or go idle |
| Embed disabled by uploader | `onError` 101 / 150 | Same as above (`YT_EMBED_DISABLED`); recommend the user copy a different URL |
| Iframe never loads (network / CSP) | 5s timeout on first `yt:state` after `auth:startYouTube` | Surface `YT_PLAYER_NOT_READY`; toast + offer to retry; do not leave mode in a half-attached state (auto-`exitYouTube` on retry-fail) |
| User pastes a URL with no video ID | regex fails in `UrlPasteBar` | Inline validation message; never hits IPC |
| Autoplay blocked (rare; usually only on cold first-paint) | iframe stays in state `5` (cued) after `playVideo()` | Show "click to start" overlay; user click satisfies gesture requirement |
| Spotify token refresh failure during YT mode | (not possible — spotify code paths idle in YT mode) | n/a |
| Provider switch races (rapid clicks) | `mode` changes mid-startup | All `start*` / `exit*` are awaited in series; second call short-circuits if `mode` already matches (mirrors `startDemo`'s guard at `electron/ipc.ts:77`) |
| YT iframe partition loses YouTube cookies (Premium perks gone) | n/a — silent | Documented limitation; user re-signs into YouTube inside the embed; v2 may ship a persistent partition deliberately |
| Renderer reload while in YT mode | `yt:state` pushes stop arriving | Main detects on next cadence tick (no reply within 2× cadence) → re-sends `yt:request-state`; if 3 misses, treat as idle and emit `{ kind: 'no-device' }` |

## Alternatives considered

- **Spotify free-tier read-only path** — covers some of "free" but doesn't let the user *play* music; the issue specifically wants streaming. Defer; revisit if a user asks.
- **Hidden `BrowserWindow` for the YT player instead of renderer iframe** — would survive minimize and dodge any single-window autoplay quirks, but doubles the process model and breaks the existing "renderer is renderer, main is main" symmetry. The renderer-iframe path is one moving piece, and the existing `setVisibility` / `setFocus` plumbing already pauses cadence when the window is hidden.
- **Unofficial `ytmusicapi`-style reverse-engineered clients** — would let us drive the actual YouTube Music app's library/queue, but ToS-grey and brittle. Rejected.
- **Multi-provider concurrent (two pollers running, two streams of `PlaybackState`)** — the renderer only renders one `PlaybackState`; doubling the state stream is complexity with no payoff. The single-active-mode pattern is already proven by demo.
- **In-app search in v1** — costs ~100 quota units per search (10k/day default cap), needs a Google API key, and adds a new component + tests. Paste-URL covers the core ask with zero new infra. Search lands behind a flag in v2.
- **OAuth for personalized YouTube library access in v1** — requires a GCP project + Desktop OAuth client + verification when shared. Not needed for "play YouTube content"; deferred.

## Risks / known unknowns

- **Iframe Player API + Electron CSP**: the default Electron `BrowserWindow` doesn't set a CSP, so `https://www.youtube.com/iframe_api` should load. If a CSP gets added later (it isn't today), `script-src` and `frame-src` must whitelist `*.youtube.com` and `*.ytimg.com`. Verify during implementation.
- **YT Music Premium perks via embed**: only inherited if the user is signed into YouTube *within the iframe's session partition*. Electron iframes share the renderer's partition; signing into YT in any browser-tab equivalent inside the app should stick across restarts (persistent partition by default). If perks don't apply for a Premium user during integration test, we likely need an explicit `<webview partition="persist:yt">` or to expose a "sign into YouTube" button that opens `accounts.google.com` inside the iframe.
- **Mapper import boundary**: `electron/youtube/mapper.ts` is desirable as the single source of truth, but the renderer-side `YouTubeEmbed.tsx` lives in a different bundle (Vite renderer vs electron-vite main). Two options: (a) put the mapper in a shared `src/shared/` directory imported by both; (b) duplicate it (small, deps-free). Pick (a) for consistency with `electron/types.ts` already being cross-bundle. Confirm Vite resolves a top-level `shared/` from both rollups.
- **Autoplay in Electron**: usually fine after a user gesture; the Connect-screen click satisfies it. If we hit the rare cold-start block, the fallback is the "click to start" overlay listed above.
- **Existing 10 test files**: must not regress. The mode-router refactor in `electron/ipc.ts` is the highest-risk change; the new `ipc-mode-router.test.ts` is the safety net.
- **`SpotifyError` rename to `ProviderError` parent**: every existing throw site keeps using `SpotifyError`; only the `instanceof` check in `serializeError` widens. Renderer code branches on `code` strings (`src/components/Transport.tsx:46-57`), not class identity, so renderer is unaffected.
- **`device.name` for YT** is hardcoded `"YouTube"` — fine for v1, but if we add per-account labeling later (`"YouTube — signed in as X"`), the renderer's `DeviceBadge` already truncates so no UI work needed.

## Acceptance criteria mapping

ACs derived from the issue body (no REQUIREMENTS.md present):

| AC | Where it's satisfied |
|---|---|
| **AC1** App supports YouTube / YouTube Music Premium playback | New `youtube` provider via IFrame Player API; if user signs into YouTube inside the embed, Premium perks apply. `electron/youtube/*`, `src/components/YouTubeEmbed.tsx`. |
| **AC2** A free way to stream music exists (no Premium account) | The same `youtube` provider — public videos play with no auth. v1 has no API key requirement. |
| **AC3** User can choose between providers from the connect screen | `src/components/ConnectScreen.tsx` three-CTA layout + `provider:setActive` IPC. |
| **AC4** Existing Spotify Premium flow unchanged | `mode === 'spotify'` arm of every IPC handler is byte-identical to today's behavior; refactor only widens the union. Verified by existing 10 tests + new `ipc-mode-router.test.ts`. |
| **AC5** Existing demo mode unchanged | `mode === 'demo'` arm untouched; `startDemo` / `exitDemo` keep their current bodies. Demo tests pin this. |
