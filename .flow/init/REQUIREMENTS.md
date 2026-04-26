# Requirements — neon-stereo: retro-neon Spotify desktop dashboard

> Source: idea — "a stereo device dashboard that can control my spotify from my desktop. retro style with subtle neon highlights. needs to be an app."
> Generated: 2026-04-26

## Problem

The user wants a dedicated desktop app — not a browser tab — that looks and feels like a piece of retro stereo hardware and lets them see and control their Spotify playback from the desktop. The official Spotify desktop client is functional but visually generic; this project is a personal-use, single-account dashboard that turns "what's playing" into a small, always-glanceable instrument-panel UI with subtle neon styling. Scope is intentionally narrow: a focused now-playing display plus the core transport controls, nothing else.

## Users & contexts

- **Primary user**: the project owner, on a macOS Intel desktop, running the app as a standalone window alongside other work. Already a Spotify Premium subscriber.
- **Other affected**: none — single-account, single-machine personal tool.

## Acceptance criteria

Testable, behavior-level statements. Each must be verifiable with a yes/no answer.

- [ ] AC-1: Launching the app for the first time opens a window that, if no refresh token is in the OS keychain, presents a "Connect Spotify" action which opens the system browser to Spotify's PKCE auth URL and, on successful callback to the loopback redirect, stores the refresh token and transitions to the dashboard view without restart.
- [ ] AC-2: When a track is playing on the user's active Spotify Connect device, the dashboard displays the track title, primary artist, album artwork, and a progress indicator that advances in sync with playback (updating at least once per second while the window is focused).
- [ ] AC-3: The dashboard exposes play/pause, previous, next, seek (scrub the progress bar to a position), and volume controls, and each control's effect is reflected in Spotify's actual playback state within 2 seconds of the user action.
- [ ] AC-4: The visual identity is unmistakably "retro stereo with subtle neon": the UI ships with at least three concrete elements — (a) a full-window scanline overlay, (b) a neon accent color (cyan or magenta) applied via multi-layer `text-shadow`/`box-shadow` glow on the track title and the active control, and (c) a monospace or pixel display font for the title/time readout — visible in a screenshot of the running app.
- [ ] AC-5: When the user is not logged in, the dashboard shows only the "Connect Spotify" affordance (no fake/empty player chrome that implies a connected state).
- [ ] AC-6: When the user is logged in but no Spotify Connect device is currently active, the dashboard shows a clearly labeled "No active device" state instead of stale track info, and disables the transport controls.
- [ ] AC-7: When a Premium-only action is attempted by a non-Premium account (Spotify returns 403 `PREMIUM_REQUIRED`), the app surfaces a single, human-readable message ("Spotify Premium is required to control playback") rather than a silent failure or raw error.
- [ ] AC-8: The app is distributable as a runnable macOS application (DMG or equivalent packaged build) such that a fresh launch on the user's Intel Mac reaches the auth screen without requiring a dev toolchain.

## Out of scope

- Playlist editing or any library/collection management.
- Lyrics display.
- Social features (friend activity, sharing, follow).
- Queue management / "up next" editing.
- Equalizer or any audio DSP.
- Multi-device switching UI — the dashboard reflects the currently active Spotify Connect device but does not offer a picker to move playback to a different device.
- Windows / Linux builds; cross-platform packaging.
- Multi-account support; account switching.
- Auto-update / self-update infrastructure.

## Open questions

- **Playback host**: should the app embed Spotify's Web Playback SDK so the dashboard itself is a Spotify Connect device ("play here"), or remain remote-control-only over the Web API, leaving audio on the user's existing device? Both meet the ACs; the SDK adds Premium-streaming + Widevine wiring.
- **Window chrome**: frameless custom titlebar (more on-theme, more code for drag regions and traffic-light replacements) vs standard macOS window chrome (faster to ship)?
- **Distribution format for v0.1**: signed-and-notarized DMG, unsigned DMG, or "run from `npm run dev` only" for the very first cut — what's the minimum that satisfies AC-8 for personal use?
