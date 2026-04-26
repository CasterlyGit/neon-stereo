# Test plan — neon-stereo: retro-neon Spotify desktop dashboard

> Reads: REQUIREMENTS.md (each AC must be covered) + DESIGN.md (failure modes)
> Generated: 2026-04-26

## Framework & approach

- **Test runner**: [Vitest](https://vitest.dev) — matches the Vite toolchain, TypeScript-native, fast cold start, no extra ts-jest wiring.
- **Mocking strategy for Spotify Web API**: hand-rolled `fetch` fakes (a small `installFetchFake(routes)` helper that swaps `globalThis.fetch` with a router and asserts on calls). No `msw` — keeps the dependency surface minimal and we don't need network-level interception since all Spotify calls are in the main process and go through the single `electron/spotify/client.ts` `request()` wrapper.
- **What gets automated vs what gets eyeballed**: this is a desktop UI app gated on a real Spotify account, real Spotify Connect device, and visual styling. The high-leverage automation targets are the **pure functions in main** (PKCE crypto, token-refresh memoizer, error mapper, polling-cadence selector) and the **fetch-mocked main-process flows** (PKCE happy path, `/me/player` poll, transport command + 403). Visual identity, real-device end-to-end, and the auth round-trip against Spotify itself are **manual** — automating them costs more than running through the checklist once per PR for v0.1.
- **TDD shape**: write the unit tests for `pkce.ts`, the refresh memoizer, the error mapper, and the cadence selector **before** implementing them. Integration tests can come after the IPC surface is stubbed.

## Coverage matrix

One row per acceptance criterion, exactly one chosen test type per AC.

| AC | Test type | Test |
|---|---|---|
| AC-1 first-run connect → browser PKCE → loopback → token stored → dashboard, no restart | integration | `oauth.login` happy path with fake loopback callback (drives `oauth.ts` end-to-end against fetch fakes + an in-process loopback hit; asserts keytar called with refresh token + `auth:changed` emitted with `kind:'logged-in'`) |
| AC-2 track title/artist/art/progress, ≥1Hz tween while focused | manual | Manual check M-2 "now-playing renders + ticks at 1Hz" (start playback on phone, focus the app window, watch the progress bar advance smoothly for 5 s; confirm title/artist/album-art match the phone) |
| AC-3 play/pause/prev/next/seek/volume reflected ≤2 s | manual | Manual check M-3 "transport round-trip on real Premium account" (with playback active on a real device, click each control once, confirm phone reflects within 2 s) |
| AC-4 retro neon visuals: scanlines + neon glow + monospace | manual | Manual check M-1 "visual identity screenshot" (take a screenshot of the running app and verify scanline overlay visible, track title has neon glow, font is monospace) |
| AC-5 logged-out shows only Connect, no fake chrome | manual | Manual check M-4 "logged-out screen is bare" (clear keychain entry, launch app, confirm only `<ConnectScreen>` is rendered — no transport buttons, no progress bar, no track placeholder) |
| AC-6 logged-in but no active device → "No active device", controls disabled | integration | `poller → renderer state shape` test, "no-device" branch (fetch fake returns `204`; assert emitted `PlaybackState` is `{kind:'no-device'}` and snapshot of `<Dashboard>` with that prop has transport `disabled` and the "No active device" copy) |
| AC-7 Premium-required surfaces single human message | unit | `mapSpotifyError` returns `PremiumRequiredError` for a 403 with `{error:{reason:'PREMIUM_REQUIRED'}}` body, plus a renderer-side assertion that the IPC error mapper turns it into the exact string `"Spotify Premium is required to control playback"` |
| AC-8 distributable as runnable macOS app | manual | Manual check M-5 "fresh launch reaches auth screen". **Acknowledged deferred to v0.2** in DESIGN.md; for v0.1 the manual check is "`npm run dev` on a clean checkout opens the window at `<ConnectScreen>`". The "no dev toolchain" half of AC-8 is explicitly out of scope for v0.1. |

## Unit tests

Fast, no I/O, no Electron. Live under `electron/**/__tests__/*.test.ts`.

- `pkce.generateVerifier returns a 43-128 char URL-safe string` — asserts length range, regex `^[A-Za-z0-9_\-]+$`, two calls return different values.
- `pkce.challengeFromVerifier produces RFC-7636 S256 base64url` — given the spec's known verifier `"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"`, asserts the challenge equals `"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"` (the canonical RFC test vector). Locks down: SHA-256, base64**url** (no `+` `/` `=`), no trailing newline.
- `pkce.challengeFromVerifier strips base64 padding` — asserts no `=` in output across 100 random verifiers.
- `oauth.refresh memoizes concurrent calls` — fire 5 `refresh()` calls in parallel against a fetch fake that counts hits and resolves after a microtask; assert `fetch` called exactly **once** and all 5 callers receive the same access token. Then call `refresh()` again after the in-flight promise resolves and assert a **new** fetch is made (memo only collapses concurrent, not sequential).
- `oauth.refresh clears keytar + emits logged-out on invalid_grant` — fetch fake returns 400 `{error:'invalid_grant'}`; assert `keychain.clearRefreshToken()` called and the returned promise rejects with `AuthExpiredError`.
- `client.mapSpotifyError 200 → no error` — `null` (sanity).
- `client.mapSpotifyError 401 → AuthExpiredError` — typed.
- `client.mapSpotifyError 403 PREMIUM_REQUIRED → PremiumRequiredError` — body shape `{error:{status:403,reason:'PREMIUM_REQUIRED',message:'…'}}`.
- `client.mapSpotifyError 403 (other reason) → SpotifyError` — generic, **not** the premium one (so we don't show the wrong toast for region/scope-locked endpoints).
- `client.mapSpotifyError 429 → RateLimitError with retryAfterSec` — parses `Retry-After: 7` header to `retryAfterSec===7`; missing header → defaults to 1.
- `client.mapSpotifyError 5xx → SpotifyServerError` — distinct from network error.
- `poller.cadenceFor selects 1000ms when focused` — `cadenceFor({focused:true, hidden:false}) === 1000`.
- `poller.cadenceFor selects 5000ms when blurred but visible` — `=== 5000`.
- `poller.cadenceFor returns null when hidden` — `null` (caller suspends the interval entirely).
- `poller.mapPlaybackResponse → no-device on 204` — `{kind:'no-device'}`.
- `poller.mapPlaybackResponse → no-device when body.device==null` — same.
- `poller.mapPlaybackResponse → idle when item==null but device present` — covers ad breaks.
- `poller.mapPlaybackResponse → idle when item.type!=='track'` — defensive against episode items (per DESIGN risks).
- `poller.mapPlaybackResponse → playing/paused with track + asOf timestamp` — asserts `asOf` set to `Date.now()` so renderer tween is anchored.

## Integration tests

Cross a boundary: hand-rolled `fetch` fake + (where needed) a real loopback listener on `127.0.0.1:0`. No real Spotify, no real keychain — `keytar` is mocked to an in-memory map. Live under `electron/__tests__/integration/*.test.ts`.

- `oauth.login full PKCE flow happy path` — boots `oauth.login()`, intercepts `shell.openExternal` to capture the authorize URL, parses out the redirect URI/port and the `code_challenge`, makes a real HTTP GET to `http://127.0.0.1:<port>/callback?code=fake-code&state=<echoed-state>`, fetch fake routes `POST https://accounts.spotify.com/api/token` to return `{access_token,refresh_token,expires_in:3600,scope:'…'}`. Asserts: (a) `code_challenge_method=S256` in the URL, (b) the `code_verifier` posted to `/api/token` produces the captured challenge, (c) `keychain.setRefreshToken` called with the refresh token, (d) `auth:changed` IPC emitted with `kind:'logged-in'`, (e) `oauth.login()` resolves. **Covers AC-1.**
- `oauth.login rejects on state mismatch` — same harness, but the callback hits `/callback?code=fake&state=WRONG`. Asserts `oauth.login()` rejects with `AuthStateMismatchError` and **no** keytar write happens.
- `poller emits no-device PlaybackState on 204` — start poller with fetch fake returning `204` for `GET /me/player`; assert one tick later the IPC `player:state` send is called with `{kind:'no-device'}`. **Covers AC-6.**
- `poller emits playing PlaybackState with mapped fields` — fetch fake returns the sample body from DESIGN.md §Data; assert the emitted `PlaybackState` has `kind:'playing'`, `track.title==='Song Name'`, `track.artists[0]==='Artist A'`, `track.album.artUrl` set, `device.name==="Tarun's iPhone"`.
- `poller pauses on hidden, resumes on visible` — drive `BrowserWindow` `hide`/`show` event handlers (extracted into a pure subscriber so the test can call them directly); assert no fetches during hidden, fetches resume on show.
- `transport play happy path` — call `ipc.handle('player:play')`; fetch fake routes `PUT https://api.spotify.com/v1/me/player/play` to `204`; assert handler resolves with `undefined` and the next `/me/player` poll within 1 s reflects the new state (forces a poll-now after a successful control action — verifies AC-3's ≤2 s claim at the IPC level).
- `transport play surfaces PremiumRequiredError on 403` — fetch fake returns `403 {error:{reason:'PREMIUM_REQUIRED'}}`; assert the IPC handler rejects with a serialized `PremiumRequiredError` whose `.code === 'PREMIUM_REQUIRED'`. Renderer-side assertion (in the same test file, JSDOM env) that the `src/lib/ipc.ts` mapper turns that into the exact toast string `"Spotify Premium is required to control playback"`. **Covers AC-7 end-to-end (paired with the unit test for the bare mapper).**
- `client retries once on 401 then succeeds` — first call to `/me/player` returns 401, refresh-token endpoint returns a fresh access token, retried `/me/player` returns 200; assert exactly one `/api/token` call and the original caller sees the 200 body. Validates the failure-mode row "Access token expired".

## Manual checks

A short PR-review checklist. Each step is concrete enough that a reviewer with a Spotify Premium account and a phone can walk through it in <5 minutes.

- [ ] **M-1 visual identity (AC-4).** Run `npm run dev`. Take a screenshot of the running window. Verify all three: (a) a scanline overlay is visible across the full window, (b) the track title (or, if logged out, the "Connect Spotify" label) has a multi-layer neon glow in cyan or magenta, (c) the title/time readout font is monospace (e.g. JetBrains Mono / Menlo) — not a proportional sans.
- [ ] **M-2 now-playing display + 1Hz tween (AC-2).** With Spotify playing on your phone, focus the app window. Watch the progress bar for 5 seconds — it should advance visibly (not jump every 5 s). Confirm the displayed title, primary artist, and album art match the phone.
- [ ] **M-3 transport on real Premium account (AC-3).** With playback active, click pause → phone pauses within 2 s. Click play → resumes. Click next → next track on phone. Drag the progress slider to ~halfway → phone seeks. Drag the volume slider down → phone volume drops. Each round-trip ≤2 s.
- [ ] **M-4 logged-out chrome is bare (AC-5).** Open Keychain Access, delete the `neon-stereo / spotify-refresh` entry. Quit and relaunch. Confirm the window shows **only** the "Connect Spotify" affordance — no transport buttons, no progress bar, no greyed-out track tile. (i.e. no UI that implies a connected state.)
- [ ] **M-5 fresh launch reaches auth screen (AC-8, partial).** On a clean checkout (`rm -rf node_modules dist && npm install && npm run dev`), confirm the window opens at `<ConnectScreen>` without errors in the Electron console. **Note**: the "no dev toolchain" half of AC-8 is explicitly deferred to v0.2 (DMG packaging). Reviewer ticks this box for v0.1 if the dev-mode launch reaches auth.
- [ ] **M-6 no-active-device messaging (AC-6, sanity over the integration test).** With no Spotify device active anywhere on the account (close Spotify on phone + Mac), launch the app while logged in. Confirm the dashboard shows the "No active device" copy and the transport buttons are visibly disabled (greyed / no glow on hover).
- [ ] **M-7 end-to-end auth on a real account (AC-1, sanity over the integration test).** From logged-out state, click "Connect Spotify". Browser opens to `accounts.spotify.com`. Approve. Browser tab shows a small success page. Within 2 s the app window swaps to the dashboard **without** a restart. Quit + relaunch — app comes up logged in (refresh token survived).

## What we are NOT testing (and why)

- **Full end-to-end via Playwright / Spectron / `@playwright/test` against the packaged app.** Deferred to v0.2 alongside DMG packaging — running Playwright against a frameless Electron window before the app is even packaged costs more than the manual checklist above for a one-developer personal project. Revisit when AC-8 is closed.
- **Real-device handoff edge cases** (multiple Spotify Connect devices online, switching between them mid-session, Bluetooth speaker that drops). Out of scope per REQUIREMENTS.md "no multi-device picker"; we just trust whatever device Spotify reports as active.
- **Spotify Free experience deep-tested.** v0.1 only verifies that a Premium-required action surfaces the typed error and the correct toast (AC-7). We do not exercise every Free-account read path or assert that nothing else regresses on a Free account.
- **Visual regression / pixel-diff snapshots** of the neon styling. The glow stack and scanline alpha are tuned by eye; a snapshot test would either be brittle (fails on every CSS tweak) or so loose it proves nothing. Manual check M-1 is the right level.
- **Retry-after backoff timing for 429.** Unit tests cover the *parsing* of `Retry-After`; we don't run a real-time integration test that waits 7 seconds in CI. The failure-mode row in DESIGN.md is small and not a v0.1-critical path.
- **`keytar` failure path on a real locked Keychain.** Requires SIP-level setup that isn't reproducible in CI. The fallback-to-in-memory behavior is a unit-tested branch on a mocked keytar; the real-OS path is accepted risk for v0.1.
- **Cross-platform behavior** (Windows/Linux). Out of scope per REQUIREMENTS.md.
- **Auto-update / packaging integrity** — out of scope per REQUIREMENTS.md.
