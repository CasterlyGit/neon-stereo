# Integration — demo mode (run the app without Spotify auth)

> Reads: REQUIREMENTS.md, TEST_PLAN.md, DESIGN.md, IMPLEMENTATION.log
> Generated: 2026-04-26

## Test runs

- `npm test` (vitest run) — ✅ green. **10 files / 61 tests passed** in 1.47s. All four new specs (`demoPoller.test.ts`, `demoSession.test.ts`, `ipc.demoBoot.test.ts`, `ipc.demoLifecycle.test.ts`) plus all six pre-existing specs pass.
- `npm run typecheck` — ⚠️ 2 errors, both pre-existing and **unrelated to this issue**:
  - `electron/__tests__/auth.test.ts:69` — `Cannot find name 'RequestInfo'`
  - `electron/__tests__/auth.test.ts:127` — `Cannot find name 'RequestInfo'`
  Both predate this branch (documented in IMPLEMENTATION.log). No demo-mode files (`electron/demo/*`, `electron/__tests__/demo*.test.ts`, `electron/__tests__/ipc.demo*.test.ts`, `electron/ipc.ts`, `electron/preload.ts`, `src/global.d.ts`, `src/components/ConnectScreen.tsx`) introduced any new typecheck errors.

## AC verification

- [x] **AC-1** Boot with `NEON_DEMO=1` mounts Dashboard immediately — verified by `electron/__tests__/ipc.demoBoot.test.ts` › *NEON_DEMO=1 → auth:getStatus returns { kind: "logged-in" } without touching keychain (AC-1)*. ⏳ Manual launch with env var still pending human review.
- [x] **AC-2** "Try demo mode" button → Dashboard within one cycle — verified by `electron/__tests__/demoSession.test.ts` › *start() emits auth-changed { kind: "logged-in" } synchronously* (synchronous emit guarantees the renderer's `auth:changed` listener flips on the same tick). Button presence verified in `src/components/ConnectScreen.tsx`. Note: REQUIREMENTS.md said `window.api.auth.startDemo()` — actual binding is `window.neonStereo.auth.startDemo()`, a docs-only correction flagged in DESIGN.md. ⏳ Manual click pending human review.
- [x] **AC-3** DEMO badge, non-empty track, no `api.spotify.com` requests — verified by `electron/__tests__/demoPoller.test.ts` › *first poll emits a playing PlaybackState with device.name === "DEMO"* + *first emit references DEMO_TRACKS[0]* + *a full session does not invoke fetch even once*. Also verified at IPC boundary by `ipc.demoLifecycle.test.ts` › *player:get in demo mode returns a state with device.name === "DEMO" and a non-empty track*. ⏳ Visuals (album-art fallback, devtools network tab) pending human review.
- [x] **AC-4** Position advances; auto-advance on `positionMs > durationMs` — verified by `demoPoller.test.ts` › *auto-advances to next track when injected clock crosses durationMs* + *auto-advance handles multi-track overflow when window has been hidden* (covers the 600s-jump while-loop from DESIGN.md failure modes) + *paused state does not auto-advance even when clock jumps past duration*. The renderer-side tween (`useTweenedPosition`) is unchanged and already gates on `state.isPlaying` per DESIGN.md risks list. ⏳ Visible advance over a 30s fixture pending human review.
- [x] **AC-5** Play/pause/next/prev/seek/volume all mutate, none throw — verified by `demoPoller.test.ts` › *pause() flips kind to paused; subsequent play() flips back to playing*, *next() advances index*, *prev() rotates backward (wraps to last)*, *seek(N) clamps to [0, durationMs]*, *setVolume(N) updates device.volumePercent*. End-to-end IPC behavior verified by `ipc.demoLifecycle.test.ts` › *player:next + player:get in demo mode advances track*, *player:volume in demo mode updates volumePercent*, *player:pause then player:get reflects paused*. ⏳ Manual click-through to confirm Transport.tsx `safe`/`showToast` wrapper does not fire pending human review.
- [x] **AC-6** No keychain writes ever — verified by `demoSession.test.ts` › *start/exit lifecycle never calls setRefreshToken or clearRefreshToken* + `ipc.demoBoot.test.ts` › *NEON_DEMO=1 boot does not call setRefreshToken or clearRefreshToken* + `ipc.demoLifecycle.test.ts` › *auth:logout dispatches to exitDemo (does not call clearRefreshToken)* with control case *auth:logout in spotify mode DOES call clearRefreshToken*. ⏳ Real-keychain sentinel-survival check (most important manual check per TEST_PLAN.md) pending human review.
- [x] **AC-7** Per-process state, no persistence — verified by `ipc.demoBoot.test.ts` › *NEON_DEMO unset + empty keychain → auth:getStatus returns { kind: "logged-out" } (AC-7)* + *NEON_DEMO truthy-variant ("true") boots in spotify mode (not demo)* (guards the truthy-variant failure mode from DESIGN.md). ⏳ Quit-and-relaunch round-trip pending human review.
- [x] **AC-8** Disconnect exits demo + stops poller; re-entry resets to fixture[0] — verified by `ipc.demoLifecycle.test.ts` › *auth:logout dispatches to exitDemo (does not call clearRefreshToken)* + *a fresh demo session emits a playing state with track 0 even after a prior exit* (asserts the second session lands on `DEMO_TRACKS[0]` after `next → exitDemo → startDemo`). ⏳ Manual disconnect-and-re-enter round-trip pending human review.

## Failure-mode coverage (DESIGN.md)

- ✅ **Double-attached pollers (mode-switch flicker)** — `ipc.demoLifecycle.test.ts` › *startDemo attaches demo poller and resolves only after a player:state with DEMO has been emitted* + the *fresh demo session* test exercise the stop-before-attach contract end-to-end.
- ✅ **`oauth.logout` accidentally clearing a real token** — direct unit assertion via `auth:logout dispatches to exitDemo (does not call clearRefreshToken)`.
- ⏳ **Race: in-flight Spotify poll overrides demo emit** — DESIGN.md explicitly accepts this (re-emit within ~250ms); deferred to QA per design. Not regression-tested.
- ✅ **First-emit latency before `auth:startDemo` resolves** — *startDemo … resolves only after a player:state with DEMO has been emitted* asserts the await-first-tick contract.
- ✅ **Window-hidden clock jump (`positionMs >> durationMs`)** — *auto-advance handles multi-track overflow when window has been hidden* injects a 600s jump.
- ✅ **`NEON_DEMO=true` truthy-variant** — *NEON_DEMO truthy-variant ("true") boots in spotify mode*.
- ✅ **`SPOTIFY_CLIENT_ID not set` warning suppression** — *SPOTIFY_CLIENT_ID-not-set warning is suppressed when NEON_DEMO=1* + control case asserting it still prints in spotify mode without a client id.

## Outstanding issues

- **Pre-existing typecheck errors** in `electron/__tests__/auth.test.ts:69,127` (missing `RequestInfo` global). Predate this branch — not introduced by issue-9 work, called out in IMPLEMENTATION.log. Not blocking; should be filed as a follow-up.
- **All manual checks** in TEST_PLAN.md (eight items: AC-1/2/3/4/5/6/7/8 manual paths plus window-focus/visibility, console-hygiene, README + .env.example eyeball). Cannot be executed in this stage — require an interactive Electron run by a human reviewer. The keychain-sentinel check (AC-6 manual) is the highest-priority of these because its automated counterpart is a *spy-based negative assertion*; a real-keychain proof can only come from a human.
- **Renderer-side button click** is uncovered by automated tests (repo has no renderer test harness — explicitly out of scope per TEST_PLAN.md "What we are NOT testing"). The IPC contract under it is covered.

## Decision

⚠️ **Ready with caveats.**

All eight acceptance criteria are anchored by green automated tests (61/61). All seven failure modes from DESIGN.md that warrant tests have them. No keychain or persistence side effects have been introduced — verified by spy-based negative assertions across both `start/exit` lifecycle and the boot path. The pre-existing `RequestInfo` typecheck errors are unrelated to this branch.

The caveats are the manual-check items in TEST_PLAN.md (AC-1/2/3/4/5/6/7/8 visual/interactive paths, plus README + `.env.example` eyeball). The keychain-sentinel manual check for AC-6 is the most important of these and should be performed by a human reviewer before merge — the automated assertion proves we *don't call* the keychain functions, but only a real-OS round-trip proves the user's stored refresh token is observable post-demo.

Recommend the orchestrator commit and open the PR with the manual-check list copied into the PR body as a reviewer checklist.
