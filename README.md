# neon-stereo

**[▶ Live demo](https://casterlygit.github.io/neon-stereo/)** — the actual renderer rebuilt for the browser: scanlines, neon glow stack, animated synthwave album art, working transport buttons.

A retro-styled, neon-accented desktop dashboard for controlling your music.

> Initial idea: "a stereo device dashboard that can control my spotify from my desktop, retro style with subtle neon highlights, needs to be an app"

Built with the spec-driven pipeline (`.flow/init/`).

## Stack

Electron + React + Vite + TypeScript. Tests via Vitest. macOS Intel target.

- **Main process** owns provider auth + state. Spotify uses PKCE + the typed
  `/v1/me/player` API client. YouTube uses the IFrame Player API hosted in a
  renderer-side embed; the main-process poller funnels its state into the same
  provider-agnostic `PlaybackState` stream.
- **Preload** exposes a typed `window.neonStereo` over `contextBridge`.
- **Renderer** is pure React with hand-rolled CSS for the retro neon look — no UI libs.

## Providers

| Provider | What it gives you | Requires |
|---|---|---|
| **Spotify** | Full remote-control of your Spotify Premium account (transport + transfer playback) | Premium account + Spotify Client ID |
| **YouTube** | Plays any public YouTube video (incl. YouTube Music catalog) inside the app. If you sign into YouTube within the embed, Premium perks (no ads, background) carry through. | Nothing — no API key needed in v1 |
| **Demo** | Synthetic device + rotating fixture tracks. Useful for trying the UI without auth. | Nothing |

The connect screen lets you pick at runtime; the choice is persisted to
`~/Library/Application Support/neon-stereo/preferences.json`.

## Setup

### 1. Register a Spotify app

1. Sign in at https://developer.spotify.com/dashboard and create a new app.
2. **Redirect URI**: register `http://127.0.0.1:53682/callback` (the app uses this fixed
   port — same convention as rclone — so it can be registered upfront).
3. Copy the Client ID.

### 2. Configure the app

```sh
cp .env.example .env
# edit .env and paste your client ID
```

The Client ID is the only secret needed for PKCE — there is no client secret.

### 3. Install + run

```sh
npm install
npm run dev
```

The window opens to the **Connect Spotify** screen on first launch. After approving in
the browser, the dashboard appears — no restart needed.

### Demo mode

To explore the UI without Spotify credentials, set `NEON_DEMO=1`:

```sh
NEON_DEMO=1 npm run dev
```

The app boots straight to the dashboard with a synthetic device labelled `DEMO` and a
short rotating set of fixture tracks. Alternatively, run `npm run dev` and click
**▶ try demo mode** on the connect screen. Demo state is per-process — quitting and
relaunching without the env var or button returns to the connect screen. No keychain
writes, no network requests to `api.spotify.com`.

### YouTube mode

Click **▶ connect youtube** on the connect screen. No accounts or API keys are
needed for the free path — paste a YouTube URL or 11-character video ID into the
input that appears above the transport bar to start playback. If you sign into
YouTube inside the embedded player, YouTube / YT Music Premium perks (no ads,
background) carry through.

To boot directly into YouTube mode, set `NEON_DEFAULT_PROVIDER=youtube` in
`.env`.

## Scripts

| Script | Behavior |
|---|---|
| `npm run dev` | electron-vite dev server (HMR for the renderer, watch for main + preload) |
| `npm run build` | typecheck + bundle main/preload/renderer to `dist/` |
| `npm test` | run the Vitest unit + integration suite |
| `npm run typecheck` | strict tsc check on both renderer and main |

## Acceptance status (v0.1)

- [x] AC-1 PKCE first-run → loopback → token stored, no restart
- [x] AC-2 track/artist/art + 1Hz progress tween while focused
- [x] AC-3 play/pause/prev/next/seek/volume with ≤2s reflection
- [x] AC-4 retro neon visuals: scanlines + glow + monospace
- [x] AC-5 logged-out shows only Connect Spotify
- [x] AC-6 logged-in but no device → "No active device"
- [x] AC-7 Premium-required surfaces single human message
- [ ] AC-8 distributable DMG (deferred to v0.2 — `npm run dev` for now)

## Notes

- All Spotify API calls happen in the main process — bearer tokens never enter the
  renderer's persistent state and we sidestep CORS friction.
- Refresh tokens are stored in the macOS Keychain via `keytar`. If `keytar`'s native
  binding fails to load, the app falls back to a `0600`-mode JSON file at
  `~/Library/Application Support/neon-stereo/tokens.json`.
- Window blur drops poll cadence from 1s → 5s; window hide suspends polling entirely.
