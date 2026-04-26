# Design — neon-stereo: retro-neon Spotify desktop dashboard

> Reads: REQUIREMENTS.md (acceptance criteria are the contract), RESEARCH.md
> Generated: 2026-04-26

## Approach

Build an Electron + React + Vite (TypeScript) desktop app for macOS Intel. **v0.1 is remote-control-only** over the Spotify Web API — no in-app Web Playback SDK, no `streaming` scope, no Widevine wiring; the app drives whatever Spotify Connect device is already active on the user's account. Auth uses Authorization Code with PKCE, with the loopback callback handled by a one-shot HTTP server in the **main** process, the refresh token persisted via `keytar` (macOS Keychain), and **all Spotify API calls made from main** to sidestep renderer-side CORS concerns and keep the access token out of the renderer's persistent state. Window is **frameless with a custom title bar** for retro identity; **distribution for v0.1 is `npm run dev`** (DMG packaging deferred to v0.2 — flagged against AC-8 below).

Alternatives considered and rejected: Tauri (no Widevine on WKWebView — irrelevant here since we dropped in-app playback, but loses no benefit because Electron is already chosen for v0.2 SDK readiness); PyQt6 (rejected for the same Widevine reason in RESEARCH.md, plus user-familiarity is a weak signal vs ecosystem fit); putting Spotify fetches in the renderer (renderer would need the bearer token in JS memory and we'd take CORS preflight friction in dev — main-process proxy is cleaner).

## Components touched

Greenfield — there are no existing files. This table maps **module → responsibility** for the implement stage.

| File / module | Change |
|---|---|
| `package.json` | Declare entry (`electron/main.ts`), scripts (`dev`, `build`, `build:main`), deps: `electron`, `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `typescript`, `keytar`, `electron-vite` (or hand-rolled Vite + tsc for main). |
| `electron/main.ts` | Boot: create `BrowserWindow` (frameless, `titleBarStyle:'hiddenInset'`, traffic-light overrides), wire IPC handlers, own auth lifecycle, own Spotify API client, own polling loop. |
| `electron/preload.ts` | Expose typed bridge `window.neonStereo` to renderer via `contextBridge.exposeInMainWorld`. No Node primitives leak. |
| `electron/auth/pkce.ts` | PKCE helpers: `generateVerifier()`, `challengeFromVerifier(verifier)` (S256 base64url). |
| `electron/auth/oauth.ts` | `login()`: spawn loopback server on ephemeral port, build authorize URL with `redirect_uri=http://127.0.0.1:<port>/callback`, `shell.openExternal(url)`, await `?code=…`, POST `/api/token`, persist refresh token via keytar, hold access token in memory, emit `auth-changed`. `logout()`: clear keytar entry + memory, emit `auth-changed`. `refresh()`: POST refresh-token grant; called on 401 or proactive 60s before `expires_at`. |
| `electron/auth/keychain.ts` | Thin wrapper: `getRefreshToken()`, `setRefreshToken(t)`, `clearRefreshToken()` over `keytar.{getPassword,setPassword,deletePassword}('neon-stereo','spotify-refresh')`. |
| `electron/spotify/client.ts` | `request(method, path, opts)` — fetch wrapper, injects `Authorization: Bearer <access>`, on 401 calls `refresh()` once and retries, on 403 with body `reason==='PREMIUM_REQUIRED'` throws typed `PremiumRequiredError`, on 429 honors `Retry-After`, on network failure throws `NetworkError`. |
| `electron/spotify/poller.ts` | `start()`: setInterval calling `GET /me/player`, cadence is 1000ms when window focused, 5000ms when blurred, paused entirely when window minimized/hidden. Emits `playback-state` IPC events to renderer. |
| `electron/ipc.ts` | Registers `ipcMain.handle` for: `auth:login`, `auth:logout`, `auth:getToken`, `player:get`, `player:play`, `player:pause`, `player:next`, `player:prev`, `player:seek`, `player:volume`. Emits via `webContents.send`: `auth:changed`, `player:state`. |
| `src/main.tsx` | React entry. Mounts `<App/>`. |
| `src/App.tsx` | Top-level routing between `<ConnectScreen/>` (no auth) and `<Dashboard/>` (auth). Subscribes to `auth:changed`. |
| `src/components/Dashboard.tsx` | Composes `<NeonFrame>` → (`<NowPlaying/>`, `<Transport/>`, `<DeviceBadge/>`). Subscribes to `player:state`. Renders "No active device" empty-state when `state.device==null`. |
| `src/components/NowPlaying.tsx` | Album art (left), track title + artist (right), local-tween progress bar. Receives `playback-state` prop. |
| `src/components/Transport.tsx` | Play/pause toggle, prev, next, seek slider (controlled, debounced 200ms then `player:seek`), volume slider (debounced 200ms then `player:volume`). Disabled when no active device. |
| `src/components/DeviceBadge.tsx` | Shows `state.device.name` + small dot. |
| `src/components/NeonFrame.tsx` | Wraps children with scanline overlay div + neon-glow border. CSS-only. |
| `src/components/ConnectScreen.tsx` | Single button "Connect Spotify" → `window.neonStereo.auth.login()`. |
| `src/lib/ipc.ts` | Typed renderer-side helpers wrapping `window.neonStereo.*`. |
| `src/styles/tokens.css` | CSS custom properties: `--bg`, `--accent`, `--accent-2`, `--text`, `--mono`. |
| `src/styles/global.css` | Resets, `body { background: var(--bg); font-family: var(--mono); }`, scanline keyframes, glow utilities. |
| `vite.config.ts` | Vite config for renderer: React plugin, root=`src`, build out `dist/renderer`. |
| `tsconfig.json` (root + `electron/tsconfig.json`) | Strict TS for both main and renderer; main targets Node20, renderer targets ES2022 + DOM. |
| `public/index.html` | Renderer HTML shell loaded by `BrowserWindow`. |

## New files

- `package.json` — npm manifest + scripts.
- `electron/main.ts` — Electron main entry.
- `electron/preload.ts` — context bridge.
- `electron/auth/pkce.ts` — PKCE crypto helpers.
- `electron/auth/oauth.ts` — login/logout/refresh + loopback server.
- `electron/auth/keychain.ts` — `keytar` wrapper.
- `electron/spotify/client.ts` — fetch wrapper with token + error handling.
- `electron/spotify/poller.ts` — `/me/player` polling loop.
- `electron/ipc.ts` — IPC handler registration.
- `electron/tsconfig.json` — TS config for main process.
- `electron/types.ts` — shared types: `PlaybackState`, `Device`, `Track`, error classes.
- `src/main.tsx` — React entry.
- `src/App.tsx` — root component.
- `src/components/Dashboard.tsx` — dashboard root.
- `src/components/NowPlaying.tsx` — track + art + progress.
- `src/components/Transport.tsx` — play/pause/next/prev/seek/volume.
- `src/components/DeviceBadge.tsx` — active device label.
- `src/components/NeonFrame.tsx` — scanline + glow border chrome.
- `src/components/ConnectScreen.tsx` — first-run auth screen.
- `src/components/TitleBar.tsx` — custom frameless drag region + close/min/max placeholders (macOS uses native traffic-light overrides via `BrowserWindow`, this is the right side of the bar).
- `src/lib/ipc.ts` — typed renderer IPC client.
- `src/styles/tokens.css` — palette + font tokens.
- `src/styles/global.css` — base styles + scanlines.
- `vite.config.ts` — renderer build config.
- `tsconfig.json` — root TS config.
- `public/index.html` — renderer shell.
- `.env.example` — `SPOTIFY_CLIENT_ID=…` (read by main at startup; user copies to `.env`).
- `.gitignore` — `node_modules`, `dist`, `.env`, `.flow/`-internal.

## Data / state

### Env vars
- `SPOTIFY_CLIENT_ID` — required, read once in `main.ts`. App refuses to start `auth:login` without it.

### Persisted state (macOS Keychain via keytar)
- service: `neon-stereo`
- account: `spotify-refresh`
- value: opaque refresh token string (Spotify-issued)

That is **the only persisted secret**. No tokens written to disk in plaintext anywhere.

### In-memory state (main process)

```ts
type AccessToken = {
  token: string;
  expiresAt: number; // epoch ms
  scopes: string[];  // verified subset
};

type AuthState =
  | { kind: 'logged-out' }
  | { kind: 'logged-in'; access: AccessToken };
```

### IPC payloads

```ts
type Track = {
  id: string;
  title: string;
  artists: string[];          // primary first
  album: { name: string; artUrl: string | null };
  durationMs: number;
};

type Device = { id: string; name: string; type: string; volumePercent: number };

type PlaybackState =
  | { kind: 'no-device' }
  | { kind: 'idle'; device: Device }   // device active but nothing playing
  | {
      kind: 'playing' | 'paused';
      device: Device;
      track: Track;
      positionMs: number;
      isPlaying: boolean;
      asOf: number;                     // epoch ms when sampled (for client tween)
      shuffle: boolean;
      repeat: 'off' | 'track' | 'context';
    };

type AuthEvent = { kind: 'logged-in' } | { kind: 'logged-out' };
```

### Sample `/me/player` excerpt mapped to `PlaybackState`

```json
{
  "is_playing": true,
  "progress_ms": 51234,
  "device": { "id": "abc", "name": "Tarun's iPhone", "type": "Smartphone", "volume_percent": 60 },
  "item": {
    "id": "trk1",
    "name": "Song Name",
    "duration_ms": 215000,
    "artists": [{ "name": "Artist A" }, { "name": "Artist B" }],
    "album": { "name": "Album", "images": [{ "url": "https://…" }] }
  },
  "shuffle_state": false,
  "repeat_state": "off"
}
```

### Visual tokens (`tokens.css`)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0a0a12` | window background |
| `--bg-elev` | `#11111c` | card surfaces |
| `--text` | `#e6e8ef` | body |
| `--text-dim` | `#7d8094` | secondary |
| `--accent` | `#ff3ec8` (magenta) | primary neon — track title, active control |
| `--accent-2` | `#00ffd5` (cyan) | secondary neon — progress fill, focus ring |
| `--mono` | `'JetBrains Mono', ui-monospace, Menlo, monospace` | all readouts |
| `--scanline-opacity` | `0.06` | overlay alpha |
| `--glow` | `0 0 4px var(--accent), 0 0 12px var(--accent), 0 0 28px var(--accent)` | text-/box-shadow stack |

## Public API / surface

### Preload bridge — `window.neonStereo`

```ts
interface NeonStereoAPI {
  auth: {
    login(): Promise<void>;          // resolves once tokens stored
    logout(): Promise<void>;
    getToken(): Promise<string|null>; // for debug/dev only; renderer normally never needs this
    onAuthChange(cb: (e: AuthEvent) => void): () => void; // returns unsubscribe
  };
  player: {
    get(): Promise<PlaybackState>;
    play(): Promise<void>;
    pause(): Promise<void>;
    next(): Promise<void>;
    prev(): Promise<void>;
    seek(positionMs: number): Promise<void>;
    setVolume(percent: number): Promise<void>;       // 0-100
    onState(cb: (s: PlaybackState) => void): () => void;
  };
}
```

### IPC channels (internal)

| Channel | Direction | Payload |
|---|---|---|
| `auth:login` | renderer→main (invoke) | `() ⇒ void` |
| `auth:logout` | renderer→main (invoke) | `() ⇒ void` |
| `auth:getToken` | renderer→main (invoke) | `() ⇒ string\|null` |
| `auth:changed` | main→renderer (send) | `AuthEvent` |
| `player:get` | renderer→main (invoke) | `() ⇒ PlaybackState` |
| `player:play\|pause\|next\|prev` | renderer→main (invoke) | `() ⇒ void` |
| `player:seek` | renderer→main (invoke) | `(positionMs:number) ⇒ void` |
| `player:volume` | renderer→main (invoke) | `(percent:number) ⇒ void` |
| `player:state` | main→renderer (send) | `PlaybackState` |

### CLI / scripts

| Script | Behavior |
|---|---|
| `npm run dev` | concurrently: vite dev server for renderer + tsc-watch for `electron/` + electron pointed at compiled main with `VITE_DEV_SERVER_URL` env |
| `npm run build` | tsc `electron/` → `dist/main`, vite build → `dist/renderer` (DMG packaging deferred) |

### OAuth surface (external)

- Spotify authorize URL: `https://accounts.spotify.com/authorize?response_type=code&client_id=$CID&redirect_uri=http://127.0.0.1:$PORT/callback&code_challenge_method=S256&code_challenge=$CHAL&scope=user-read-playback-state%20user-read-currently-playing%20user-modify-playback-state&state=$NONCE`
- Token endpoint: `POST https://accounts.spotify.com/api/token` with `grant_type=authorization_code` + PKCE verifier, then later `grant_type=refresh_token`.
- Loopback redirect URI registered in Spotify Dev Dashboard: `http://127.0.0.1/callback` (port omitted at registration time, supplied at request time per Nov-2025 rules).

## Failure modes

| Failure | How we detect | What we do |
|---|---|---|
| Refresh token expired/invalid | Token endpoint returns 400 `invalid_grant` | Clear keytar, set `AuthState=logged-out`, emit `auth:changed`, renderer shows `<ConnectScreen/>`. User-visible: "Spotify session expired. Please reconnect." |
| Access token expired | `client.request` gets 401 from Web API | Call `oauth.refresh()` once, retry the original request; if refresh also fails → fall through to "refresh token expired/invalid" path |
| No active device | `GET /me/player` returns `204 No Content` or body has `device:null` | Emit `PlaybackState{kind:'no-device'}`. Dashboard shows "No active device — open Spotify on your phone or Mac" panel; transport buttons disabled. (AC-6) |
| Premium required | Web API returns `403` with body `{error:{reason:'PREMIUM_REQUIRED'}}` on a control action | Throw `PremiumRequiredError` from `client.request`; IPC handler catches, returns rejected promise; renderer toast: **"Spotify Premium is required to control playback"**. (AC-7) |
| Network down | `fetch` throws (`ENOTFOUND`/`ECONNREFUSED`) or times out (10s) | `client.request` throws `NetworkError`; poller swallows + keeps last state with a small "offline" badge; control actions surface "Couldn't reach Spotify — check your connection." |
| Rate limit (429) | `429` response with `Retry-After: N` header | `client.request` waits `min(N,30)`s then retries once; if still 429, return cached state and back off poller to 5s for the next 30s. No user-visible error unless a control action; control gets "Rate limited, try again in a moment." |
| Loopback port collision | OS rejects `listen()` | Try up to 5 ephemeral ports (`server.listen(0)`); on persistent failure surface "Couldn't open auth callback. Close other apps using local ports and retry." |
| User cancels OAuth (closes browser tab) | No callback received within 5 min | Tear down loopback server, `auth.login()` rejects with `AuthCancelledError`; renderer ConnectScreen returns to idle, no error toast. |
| `keytar` write fails (Keychain locked / no entitlement) | `keytar.setPassword` throws | Fall back to in-memory only for the session, log warning, surface non-blocking banner: "Couldn't save login to Keychain — you'll be asked to reconnect next launch." |
| Spotify API returns malformed JSON | `JSON.parse` throws or schema check fails | Treat as transient; poller skips one tick. Control action surfaces "Spotify returned an unexpected response." |
| Window blurred → poller still hammering | Built-in: window `blur`/`focus` events | Drop poll cadence to 5s on blur, restore to 1s on focus, suspend entirely on `hide`. |

## AC traceability

| AC | Covered by |
|---|---|
| AC-1 first-run connect → browser PKCE → loopback → token stored → dashboard, no restart | `electron/auth/oauth.ts` (`login()`), `electron/auth/keychain.ts`, `auth:changed` IPC event, `<App>` listens and swaps `<ConnectScreen>` ↔ `<Dashboard>` |
| AC-2 track title/artist/art/progress, ≥1Hz tween while focused | `electron/spotify/poller.ts` (1s focused), `<NowPlaying>` (locally tweens `positionMs` between polls using `asOf` timestamp + `requestAnimationFrame`) |
| AC-3 play/pause/prev/next/seek/volume, ≤2s reflected in Spotify | `<Transport>` → `player:*` IPC → `client.request` PUT/POST; the next poll (≤1s) updates UI; control actions also optimistically merge into local `PlaybackState` |
| AC-4 retro neon visuals: scanlines + neon glow on title/active control + monospace | `<NeonFrame>` (scanlines), `tokens.css` (`--accent`, `--glow`), `<NowPlaying>` track title uses `text-shadow: var(--glow)`, `<Transport>` active button uses `box-shadow: var(--glow)`, `--mono` font |
| AC-5 logged-out shows only Connect, no fake chrome | `<App>` renders `<ConnectScreen>` when `auth.kind==='logged-out'`; `<Dashboard>` is not mounted at all |
| AC-6 logged-in but no active device → "No active device", controls disabled | `PlaybackState{kind:'no-device'}` branch in `<Dashboard>`; `<Transport>` `disabled={state.kind!=='playing'&&state.kind!=='paused'}` |
| AC-7 Premium-required surfaces single human message | `PremiumRequiredError` typed throw in `client.request`; renderer toast in `src/lib/ipc.ts` error mapper |
| AC-8 distributable as runnable macOS app reaching auth screen on fresh launch | **v0.1: deferred to v0.2.** `npm run dev` satisfies the *behavior* (window opens to ConnectScreen) but not the *no-dev-toolchain* clause. **Flagged for human review.** Resolution path for v0.2: add `electron-forge` with `make` target producing an unsigned DMG; auth flow is unchanged. |

## Alternatives considered

- **In-app Web Playback SDK device** — cooler ("dashboard *is* the stereo") but requires `streaming` scope, Widevine setup, Spotify Premium-streaming gating, and a renderer-hosted SDK. Pushed to v0.2 because it isn't required by any AC and roughly doubles the auth+playback surface.
- **Renderer-side Spotify fetches** — would shrink IPC surface, but puts bearer tokens in renderer JS memory and exposes us to dev-mode CORS friction and any future content-security-policy tightening. Main-process proxy is strictly safer.
- **`electron-builder` for v0.1 packaging** — viable, but `electron-forge` is the Electron-team-blessed default in 2026 and matches our intent for a v0.2 DMG; either way, packaging is deferred.
- **Native macOS chrome (no frameless)** — ships faster but loses the retro-stereo identity that motivated the project. Frameless with `titleBarStyle:'hiddenInset'` is a small fixed cost that pays off visually.
- **`electron-store` for refresh-token persistence** — writes to disk plaintext; rejected per RESEARCH.md constraint.
- **Polling rate >1Hz** — Spotify rate limits in 30s windows; 1Hz focused / 0.2Hz blurred is the documented sweet spot.

## Risks / known unknowns

- **`keytar` macOS entitlement** — `keytar` ships a prebuilt native binding; on packaged (notarized) macOS apps it occasionally needs the keychain entitlement in the entitlements plist. Not a v0.1 concern (we're in dev mode), but **flagged for v0.2 packaging**. Mitigation: include `com.apple.security.cs.allow-unsigned-executable-memory` not required, but verify `keychain-access-groups` is unset (default works for unsigned dev binaries).
- **Token-refresh race** — concurrent 401s on parallel requests could trigger N parallel refreshes. Mitigation: `oauth.refresh()` memoizes the in-flight promise (`if (refreshing) return refreshing`) so all callers await the same swap.
- **Dev-mode CORS** — non-issue because all Spotify calls happen in main (Node `fetch`, no CORS). Documented here so the implement stage doesn't reintroduce renderer-side fetches "for simplicity."
- **Local-tween drift** — between 1s polls we tween `positionMs` clientside; if the user scrubs in another Spotify client, our tween will be wrong for up to 1s. Acceptable for v0.1 (AC-2 says "at least once per second").
- **Frameless drag region on macOS** — `-webkit-app-region: drag` on the title bar, but interactive elements inside need `-webkit-app-region: no-drag`. Easy to forget on the volume slider. Implement stage: lint by hand against `<TitleBar>` + any controls overlapping it.
- **AC-8 unresolved for v0.1** — explicitly accepted gap; documented above. Reconfirm with user before v0.2 kickoff whether unsigned DMG is acceptable or notarization is required.
- **Spotify API shape drift** — Spotify occasionally adds null-able fields (e.g., `item:null` for ad breaks, episode items vs track items). The `PlaybackState` mapper must defensively coerce; treat `item.type !== 'track'` as `kind:'idle'` for v0.1 (no podcast UI).
- **`SPOTIFY_CLIENT_ID` distribution** — for v0.2 packaging we'll need to embed the client ID at build time (it's not a secret under PKCE; safe to ship in the bundle). v0.1 reads from `.env`; document this in the README before v0.2.
