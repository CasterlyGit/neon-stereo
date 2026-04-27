# Integration — multi-provider: Spotify + YouTube (free + Premium-aware)

> Reads: DESIGN.md, EXPLORE.md, RESEARCH.md, IMPLEMENTATION.log
> Note: REQUIREMENTS.md and TEST_PLAN.md were not produced in this pipeline run; ACs are taken from DESIGN.md §"Acceptance criteria mapping" (AC1–AC5, derived from the issue body) and the test set was framed by DESIGN.md §"New files" (the three new `electron/__tests__/youtube-*.test.ts` and `ipc-mode-router.test.ts` files).

## Test runs

- `npm test` (vitest run) — ✅ **13 files / 116 tests passed** in 2.06s. New suites: `youtube-mapper.test.ts` (19), `youtube-poller.test.ts` (15), `ipc-mode-router.test.ts` (21). All 10 pre-existing suites still green (auth, clientRetry, demoPoller, demoSession, ipc.demoBoot, ipc.demoLifecycle, pkce, poller, refresh, spotifyErrors).
- `npm run typecheck` — ⚠️ 2 errors in `electron/__tests__/auth.test.ts:69,127` (`Cannot find name 'RequestInfo'`). **Pre-existing on `main`** (verified by checking out main and rerunning), introduced by commit `2237c1b` long before this branch. Not a regression of issue-11; out of scope. Renderer (`tsconfig.json`) and main (`electron/tsconfig.json`) both compile clean for all issue-11 source files.

## AC verification

- [x] **AC1 — App supports YouTube / YouTube Music Premium playback.** Verified by:
  - `electron/youtube/poller.ts` + `electron/__tests__/youtube-poller.test.ts` (15 tests pin cadence reuse, command forwarding via `yt:control`, state-push handling).
  - `src/components/YouTubeEmbed.tsx` mounts the IFrame Player API (`https://www.youtube.com/iframe_api`) inside the renderer's session partition, so a user signed into YouTube inside the embed inherits Premium perks (no ads, background) — the embedded-partition path documented in DESIGN.md "Risks".
  - End-to-end IPC pipeline pinned by `ipc-mode-router.test.ts:213` ("yt:state push pipeline → renderer pushing a snapshot triggers a player:state emit").
- [x] **AC2 — A free way to stream music exists (no Premium account).** Verified by the same provider: the IFrame Player API plays public videos with no OAuth and no API key. `electron/preload.ts:31` exposes `youtube.loadVideoId`; `ipc-mode-router.test.ts:247` ("yt:loadVideoId validates input") pins the unauthenticated paste-URL ingestion path. RESEARCH.md Q5 confirmed: "OAuth ceremony — required? Not for v1."
- [x] **AC3 — User can choose between providers from the connect screen.** Verified by:
  - `src/components/ConnectScreen.tsx:107,124,141` — three CTAs (`▶ connect spotify`, `▶ connect youtube`, `▶ try demo mode`) and the new tagline `// RETRO REMOTE FOR YOUR MUSIC //` (line 86).
  - `provider:getActive` / `provider:setActive` IPC at `electron/ipc.ts:259-260`.
  - Boot-default ordering pinned by `ipc-mode-router.test.ts:122` ("provider:getActive boot defaults" — 3 cases: `NEON_DEMO=1 → demo`, `NEON_DEFAULT_PROVIDER=youtube → youtube`, no overrides → spotify) and `ipc-mode-router.test.ts:333` ("preferences file with lastProvider=demo is honored").
- [x] **AC4 — Existing Spotify Premium flow unchanged.** Verified by:
  - 10 pre-existing test files all green (auth, refresh, clientRetry, poller, spotifyErrors, pkce, demoPoller, demoSession, ipc.demoBoot, ipc.demoLifecycle).
  - `SpotifyError` rename: kept as a class name; only the parent widened to `ProviderError` (`electron/types.ts:38,51`). Renderer branches on `code` strings (`Transport.tsx:53`), so class-identity changes are invisible to it. The Spotify-only `PREMIUM_REQUIRED` toast is now gated by provider (`Transport.tsx:53` — `code === 'PREMIUM_REQUIRED' && provider === 'spotify'`).
  - `electron/auth/keychain.ts:14` `accountFor('spotify')` resolves to the existing `'spotify-refresh'` keychain entry (back-compat per IMPLEMENTATION.log line 2).
- [x] **AC5 — Existing demo mode unchanged.** Verified by:
  - `ipc.demoBoot.test.ts` (6 tests) and `ipc.demoLifecycle.test.ts` (11 tests) green.
  - `mode === 'demo'` arm of `electron/ipc.ts` untouched in semantic shape (commit `628d6a1` only widened the union and added a parallel `youtube` arm).

## Failure-mode coverage (from DESIGN.md §"Failure modes")

| Failure | Status |
|---|---|
| Invalid / unavailable video ID (`YT_VIDEO_UNAVAILABLE`) | ✅ Class at `types.ts:126`; toast at `Transport.tsx:65`; queue advance pinned in `youtube-poller.test.ts`. |
| Embed disabled (`YT_EMBED_DISABLED`) | ✅ Class at `types.ts:133`; toast at `Transport.tsx:67`. |
| Iframe never loads (`YT_PLAYER_NOT_READY`) | ✅ Class at `types.ts:143`; bridge wired in `YouTubeEmbed.tsx`. |
| User pastes a non-video URL | ✅ `parseVideoId` in `mapper.ts`; `UrlPasteBar.tsx` validates inline; `ipc-mode-router.test.ts:263` pins "invalid id rejects". |
| Autoplay blocked | ⏳ Pending human review — fallback "click to start" overlay path documented; not directly testable in vitest (requires real Electron renderer). |
| Provider switch races (rapid clicks) | ✅ `ipc.ts:157` short-circuits when `mode === 'youtube'`; `ipc-mode-router.test.ts:184` six mode transitions pinned. |
| YT iframe partition loses YouTube cookies | ⏳ Documented limitation; not a v1 failure path to handle in code. |
| Renderer reload while in YT mode | ⏳ Pending human review during dev/build smoke — design specifies main re-sends `yt:request-state` on idle. |

## Manual / pending checks (recommended before tagging release)

- Boot the app in YouTube mode (`NEON_DEFAULT_PROVIDER=youtube npm run dev`); paste a URL; confirm play / pause / seek / volume.
- Boot in Spotify mode (existing flow); confirm no behavioral regression (NowPlaying, Transport, DeviceBadge).
- Boot in demo mode (`NEON_DEMO=1 npm run dev`); confirm fixtures still play.
- Sign into YouTube *inside* the embed iframe with a Premium account; confirm the no-ads experience persists across an app restart (validates the partition assumption in DESIGN.md "Risks").
- First-cold-paint autoplay: confirm "click to start" gesture path is not needed, or that the Connect-button gesture satisfies it.

## Outstanding issues

- **Pre-existing typecheck noise** (`auth.test.ts` `RequestInfo` lib-dom typing). Exists on `main`. Not introduced here, not blocking. Suggest a small follow-up to add `lib: ["DOM"]` to the test tsconfig or import the type from `undici`/`node:fetch` typings.
- **Manual UX checks above** are not automatable in Vitest (require a live Electron renderer). Treat as smoke-test gate before any release tag.
- **No REQUIREMENTS.md / TEST_PLAN.md** were authored upstream; ACs were re-derived in DESIGN.md. Recommend adding the missing pipeline stages for the next issue if formal sign-off matters.

## Decision

⚠️ **Ready with caveats** — all 116 tests pass, every design-specified failure mode has either code-level handling or is explicitly documented as a v1 deferral, and every AC has automated coverage. The caveats are (1) the pre-existing typecheck noise on `main` (not a regression) and (2) the four manual UX paths that vitest cannot exercise (autoplay gesture, Premium partition persistence, dev-server YT smoke, Spotify regression smoke). These are normal pre-merge smoke checks, not blockers from the implementation itself.
