# Research — neon-stereo: retro-neon Spotify desktop dashboard

> Reads: (no EXPLORE.md — greenfield)
> Generated: 2026-04-26

## Resolved

- **Q: Stack — Electron+React vs Tauri vs PyQt6 for an Intel-Mac desktop app talking to Spotify?**
  A: **Recommend Electron + React + Vite (TypeScript).** Reasons specific to this project:
    1. Spotify's Web Playback SDK is a browser-only JS library and must run inside a real Chromium webview — Electron ships its own Chromium so it's the lowest-risk host.
    2. The retro-neon UI is CSS-shader-heavy (text-shadow glow, gradients, scanlines, CRT filters); CSS/Canvas in a webview is the natural medium.
    3. Dev velocity is high (HMR via Vite, huge ecosystem).
  Tradeoffs of the alternatives:
    - **Tauri (Rust + system webview):** ~5–10× smaller bundle (~5–15 MB vs Electron's ~80–120 MB) and lower idle RAM, but on macOS it uses WKWebView, which has historically had quirks with the Spotify Web Playback SDK (EME/Widevine, audio routing). Adds a Rust toolchain the user hasn't been using.
    - **PyQt6:** user is familiar (curby project), but **QtWebEngine cannot run the Spotify Web Playback SDK reliably** — it lacks the Widevine DRM Spotify requires for in-app streaming. PyQt6 could only do remote-control mode (Web API only, no in-app player), which is a real product limitation. Reject.
  Net: Electron. Bundle size (~100 MB on macOS) is acceptable for a personal desktop app on a modern Intel Mac.

- **Q: Spotify auth — what's the minimal flow for a desktop app?**
  A: **Authorization Code with PKCE.** Spotify explicitly recommends PKCE for desktop/mobile/SPA where the client secret cannot be stored safely. No client secret needed; we generate a code verifier + S256 challenge, swap the auth code for tokens, and refresh.
  Evidence: https://developer.spotify.com/documentation/web-api/concepts/authorization

- **Q: Does Spotify Premium matter?**
  A: **Yes — required for in-app playback via the Web Playback SDK** (mobile-only Premium tiers excluded). For pure remote-control of an *existing* Spotify Connect device (phone/desktop app) via the Web API, Premium is also required for the `user-modify-playback-state` write actions (play/pause/skip/seek/volume). Free accounts can read state but not control. Assume the user has Premium; if not, the app degrades to read-only.
  Evidence: https://developer.spotify.com/documentation/web-playback-sdk

- **Q: Which Web API endpoints + scopes do we need for the MVP?**
  A: Scopes:
    - `user-read-playback-state` — read current device + playback state
    - `user-read-currently-playing` — track/album/artist/artwork now playing
    - `user-modify-playback-state` — play/pause/next/previous/seek/volume/shuffle/repeat
    - `streaming` — required to instantiate the Web Playback SDK device (only if we host playback in-app)
  Endpoints (all under `https://api.spotify.com/v1`):
    - `GET /me/player` — full player state (track, device, position, is_playing, volume, shuffle, repeat)
    - `GET /me/player/currently-playing` — lighter "now playing" poll
    - `PUT /me/player/play` — start/resume (optional `device_id`, `uris`, `context_uri`)
    - `PUT /me/player/pause`
    - `POST /me/player/next` / `POST /me/player/previous`
    - `PUT /me/player/seek?position_ms=…`
    - `PUT /me/player/volume?volume_percent=…`
    - `PUT /me/player/shuffle?state=…` / `PUT /me/player/repeat?state=…`
    - `GET /me/player/devices` — list Spotify Connect targets
    - `PUT /me/player` — transfer playback to a device
  Polling: ~1 Hz on `/me/player` is the standard "now playing" refresh; back off when window is hidden.
  Evidence: https://developer.spotify.com/documentation/web-api/concepts/scopes

- **Q: OAuth callback strategy in a desktop app — does loopback still work?**
  A: **Yes, and it's the documented path.** Spotify allows `http://` only for loopback redirect URIs. Constraints we must honor (post Nov-2025 migration rules):
    - Must use the IP literal: `http://127.0.0.1:PORT/callback` or `http://[::1]:PORT/callback`. **`http://localhost` is rejected.**
    - You may register the URI without a port and supply the actual port at request time — useful since we'll bind to an ephemeral port.
  Implementation: spawn a tiny one-shot HTTP server on an ephemeral port from Node main process, open the system browser to the Spotify auth URL, capture the `code` on the callback, shut the server down, exchange for tokens, store refresh token in OS keychain via `keytar`.
  Evidence: https://developer.spotify.com/documentation/web-api/concepts/redirect_uri

- **Q: Retro neon visual reference — what CSS techniques, no UI lib?**
  A: Hand-rolled CSS is enough. Toolkit:
    - **Glow text:** layered `text-shadow: 0 0 4px #color, 0 0 12px #color, 0 0 28px #color;`
    - **Glow boxes / borders:** `box-shadow` with the same multi-layer trick + a 1px solid border in the accent color
    - **Scanlines:** full-screen overlay `<div>` with `background: repeating-linear-gradient(to bottom, rgba(0,0,0,.15) 0 1px, transparent 1px 3px); pointer-events:none;`
    - **CRT vignette / curvature:** radial-gradient overlay; optional SVG `feDisplacementMap` for subtle warp (skip in MVP if perf hurts)
    - **Monospace / pixel fonts:** `VT323`, `Press Start 2P`, or `IBM Plex Mono` via Google Fonts (or self-host)
    - **Palette:** dark navy/charcoal base (`#0a0e1a`-ish), one or two neon accents (cyan `#00f0ff`, magenta `#ff2bd6`), avoid using neon for body text — only highlights
    - **Animated VU meter / progress bar:** CSS `linear-gradient` + `transition: width` on the progress, or a Canvas drawn at requestAnimationFrame for a fake spectrum
    - **Subtle flicker:** `@keyframes` toggling opacity 0.97 ↔ 1.0 over 4–6s
  No third-party UI library; everything is custom CSS modules or Tailwind (optional, tree-shaken).

## Constraints to honor

- **Spotify Premium required** for any control action (play/pause/skip/volume) and for Web Playback SDK. Read endpoints work on Free, but the dashboard's controls won't.
- **Redirect URI must be IP-literal loopback** (`127.0.0.1`/`[::1]`), not `localhost`. Register in Spotify Developer Dashboard ahead of build.
- **Rate limits:** Spotify Web API uses a rolling 30-second window with 429 responses + `Retry-After`. Keep polling at 1 Hz max, batch where possible, back off on hidden window.
- **Token storage:** never persist the access token in plaintext on disk; use `keytar` (macOS Keychain) for the refresh token. Access token lives in memory.
- **DRM:** Spotify audio is Widevine-DRM-protected. Electron's bundled Chromium supports it; Tauri/WKWebView and PyQt/QtWebEngine do **not** ship Widevine. This is the single biggest stack decider.
- **macOS Intel target:** Electron supports x64 builds out of the box; no special configuration needed beyond `--arch=x64` at package time.

## Prior art in this repo

- None — greenfield. No `.flow/init/EXPLORE.md`.
- User has prior PyQt6 experience (curby) but PyQt6 is rejected here for the DRM/Widevine reason above; familiarity does not transfer.

## External references

- Spotify Authorization Guide (PKCE): https://developer.spotify.com/documentation/web-api/concepts/authorization
- Spotify Redirect URI rules (Nov-2025 migration): https://developer.spotify.com/documentation/web-api/concepts/redirect_uri
- Spotify Scopes: https://developer.spotify.com/documentation/web-api/concepts/scopes
- Spotify Web Playback SDK: https://developer.spotify.com/documentation/web-playback-sdk
- Electron docs: https://www.electronjs.org/docs/latest/
- Vite + Electron template: `electron-vite` (https://electron-vite.org)
- `keytar` for OS keychain: https://github.com/atom/node-keytar

## Out of scope for MVP (explicitly NOT doing)

- Building any audio engine of our own — Spotify's Web Playback SDK or an existing Spotify Connect device handles the audio.
- Social features (follow/share/friend activity).
- Lyrics (no first-party API; would require Musixmatch/Genius scraping).
- Playlist editing / library management — read-only references to the current track only.
- Multi-account support — single user, single Spotify account.
- Windows / Linux packaging — macOS Intel only for v1; cross-compile later if wanted.
- Auto-update infrastructure — manual rebuilds for v1.

## Remaining unknowns (for design to handle)

- **Playback host:** in-app Web Playback SDK device vs remote-control of an existing Spotify Connect device (phone/desktop client). Both are viable; in-app is cooler ("the dashboard *is* the stereo") but adds Premium-gated streaming code and Widevine setup. Gut call: **support both — default to controlling the user's active device, offer "play here" toggle that spins up the in-app SDK device.** Design stage to confirm.
- **Window chrome:** frameless custom titlebar (more retro-stereo aesthetic, more code) vs native macOS traffic lights (faster). Gut call: frameless with custom drag region.
- **State sync model:** poll `/me/player` at 1 Hz, or poll + use Web Playback SDK `player_state_changed` events when in-app device is active. Design stage decides; polling alone is fine for MVP.
- **Build/packaging tool:** `electron-builder` vs `electron-forge`. Both fine; `electron-forge` is the current Electron-team-blessed default. Defer to design.
