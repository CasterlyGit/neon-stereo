# neon-stereo

[![License: MIT](https://img.shields.io/badge/License-MIT-cyan.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-33-47848f?logo=electron&logoColor=white)](https://www.electronjs.org/)

**A retro-neon desktop dashboard that puts Spotify and YouTube transport behind a scanline-and-glow synthwave HUD — no UI libraries, pure hand-rolled CSS.**

**Status:** v0.1 — Spotify PKCE flow, YouTube IFrame embed, and demo mode all running; distributable DMG deferred to v0.2.

**[▶ Live demo](https://casterlygit.github.io/neon-stereo/)** — the renderer rebuilt for the browser: scanlines, neon glow stack, animated album art, working transport buttons.

---

## Signal

- **15 Vitest tests** covering auth, PKCE, polling, retry, and demo lifecycle — all in `electron/__tests__/`
- **1 Hz progress tween** while window is focused; poll cadence drops to 5 s on blur, suspended on hide
- **Zero renderer secrets** — all Spotify API calls live in the main process; bearer tokens never enter renderer state
- **Keychain-first token storage** via `keytar`; falls back to a `0600`-mode JSON file if the native binding fails
- **PKCE only** — no client secret; only a Spotify Client ID is needed

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Main Process (Node + Electron)                                          │
│                                                                         │
│  ┌──────────────┐   ┌─────────────────┐   ┌──────────────────────────┐ │
│  │ Spotify auth │   │  YouTube poller │   │  Demo synthetic device   │ │
│  │ PKCE + PKCE  │   │  IFrame bridge  │   │  rotating fixture tracks │ │
│  │ refresh loop │   │  state funneler │   │                          │ │
│  └──────┬───────┘   └────────┬────────┘   └──────────────┬───────────┘ │
│         └───────────────────►│◄───────────────────────────┘            │
│                       PlaybackState stream                              │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ contextBridge (window.neonStereo)
┌───────────────────────────────▼─────────────────────────────────────────┐
│ Renderer (React + Vite, hand-rolled CSS)                                │
│                                                                         │
│  ConnectScreen → Dashboard → NowPlaying / Transport / DeviceBadge      │
│  NeonFrame (scanlines + glow) · YouTubeEmbed · YouTubeBrowse            │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Providers

| Provider | What it gives you | Requires |
|---|---|---|
| **Spotify** | Full remote-control of your Spotify Premium account (transport + transfer playback) | Premium account + Spotify Client ID |
| **YouTube** | Plays any public YouTube video (incl. YouTube Music catalog) inside the app. If you sign into YouTube within the embed, Premium perks carry through. | Nothing — no API key needed in v1 |
| **Demo** | Synthetic device + rotating fixture tracks. Useful for trying the UI without auth. | Nothing |

Provider choice is persisted to `~/Library/Application Support/neon-stereo/preferences.json`.

---

## Setup

### 1. Register a Spotify app (skip for demo/YouTube)

1. Sign in at https://developer.spotify.com/dashboard and create a new app.
2. **Redirect URI**: register `http://127.0.0.1:53682/callback` (fixed port — same convention as rclone).
3. Copy the Client ID.

### 2. Configure

```sh
cp .env.example .env
# paste your Spotify Client ID — the only secret needed for PKCE
```

### 3. Install + run

```sh
npm install
npm run dev
```

The window opens to the **Connect** screen on first launch. After approving in the browser, the dashboard appears — no restart needed.

---

## Usage

### Demo mode

```sh
NEON_DEMO=1 npm run dev
```

Boots straight to the dashboard with a synthetic `DEMO` device and rotating fixture tracks. No network requests, no keychain writes.

Alternatively: `npm run dev` then click **▶ try demo mode** on the connect screen.

### YouTube mode

Click **▶ connect youtube** on the connect screen — no account or API key required. Paste a YouTube URL or 11-character video ID into the input above the transport bar.

```sh
# boot directly into YouTube mode
NEON_DEFAULT_PROVIDER=youtube npm run dev
```

---

## Scripts

| Script | Behavior |
|---|---|
| `npm run dev` | electron-vite dev server (HMR for renderer, watch for main + preload) |
| `npm run build` | typecheck + bundle main/preload/renderer to `dist/` |
| `npm test` | run the 15-test Vitest suite |
| `npm run typecheck` | strict tsc check on renderer and main |

---

## Acceptance status (v0.1)

- [x] AC-1 PKCE first-run → loopback → token stored, no restart
- [x] AC-2 track / artist / art + 1 Hz progress tween while focused
- [x] AC-3 play / pause / prev / next / seek / volume with ≤ 2 s reflection
- [x] AC-4 retro neon visuals: scanlines + glow + monospace
- [x] AC-5 logged-out shows only Connect screen
- [x] AC-6 logged-in but no device → "No active device"
- [x] AC-7 Premium-required surfaces a single human message
- [ ] AC-8 distributable DMG (deferred to v0.2 — `npm run dev` for now)

---

## Roadmap

- [ ] v0.2 — DMG build + auto-update via electron-updater
- [ ] v0.2 — Apple Silicon universal binary
- [ ] v0.2 — Windows / Linux builds via electron-builder
- [ ] v0.3 — Last.fm scrobbling
- [ ] v0.3 — Lyric overlay (Genius or MusicBrainz)
- [ ] v0.3 — Visualizer (Web Audio API bar graph behind album art)
- [ ] Backlog — system media keys via `electron.globalShortcut`
- [ ] Backlog — mini-player / picture-in-picture window mode

---

## Notes

- All Spotify API calls happen in the main process — bearer tokens never enter the renderer's persistent state and CORS friction is avoided entirely.
- Refresh tokens are stored in the macOS Keychain via `keytar`. If `keytar`'s native binding fails to load, the app falls back to a `0600`-mode JSON file at `~/Library/Application Support/neon-stereo/tokens.json`.
- Window blur drops poll cadence from 1 s → 5 s; window hide suspends polling entirely.

---

## Related

- [curby-jarvis](https://github.com/CasterlyGit/curby-jarvis) — voice + gesture macOS controller (same HUD aesthetic, AX spine)
- [curby](https://github.com/CasterlyGit/curby) — voice-command dispatcher powering the above
- [claude-meter](https://github.com/CasterlyGit/claude-meter) — live Claude API token-cost meter widget

---

## License

MIT — see [LICENSE](LICENSE).
