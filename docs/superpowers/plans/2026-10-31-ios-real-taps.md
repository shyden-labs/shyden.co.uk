# iPhone Real Taps (#838) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every iPhone tap and keystroke in `npm run test:devices` reaches Safari as a real touch and real keyboard input through WebDriverAgent, and the run stops, naming the cause, whenever a real tap does not land.

**Architecture:** The runner (`scripts/test-devices.mjs`) builds and starts WebDriverAgent (WDA) on the iPhone, passes its URL to the iOS Vitest group as `WDA_URL`, and always stops it. `tests/device/ios/wda.ts` is a small HTTP client for WDA. `RealTapInteraction` turns an element's page rectangle into screen points (WebView frame from WDA plus `visualViewport` from our Web Inspector client), checks that the element is the hit target, taps through W3C pointer actions, and checks that a trusted touch event reached the element. A canary at session start proves this before any journey runs. `DomDispatchInteraction` is deleted; there is no fallback.

**Tech Stack:** TypeScript, Vitest (iOS group and unit), Node `child_process` in the runner only, WebDriverAgent (appium/WebDriverAgent, BSD, pinned SHA), our Web Inspector client (`tests/device/ios/inspector/`).

**Spec:** issue #838 (ACs 1-5) plus the outline Shyden approved in chat on 2026-10-31: (1) the runner owns WDA's lifetime; (2) a fresh fail-closed canary, never a silent `el.click()` fallback; (3) every tap at the element's real screen position, like Android; (4) an invisible-layer mutation turns both phones red; (5) the old `838-real-taps` branch is not reused. Shyden: *"must always be as real as possible"*. Route ruling 2026-10-18 (WDA signed with his Apple ID, beside our inspector; safaridriver retired). Recipe: `.superpowers/sdd/838/wda-recipe.md`.

## Global Constraints

- Work on a new branch `838-wda-real-taps`, in a new worktree `../shyden.co.uk-838w` off `origin/develop`. Leave `../shyden.co.uk-838` and its branch untouched; never force-push.
- Laptop runs: `npm run format`, `npm run typecheck`, `npm run test:unit` only. Exception: the real-device runs in Tasks 1, 6 and 7.
- A unit test reaches no network and starts no process: WDA HTTP and `spawn` are injected and faked in unit tests.
- No retries: every wait has a stated ceiling and fails naming what it waited for.
- WDA pin: `https://github.com/appium/WebDriverAgent.git` at `d17782422d55ff1e5e0ceb74eb1fd509cc0c35b6` (v16.14.0). Signing: `DEVELOPMENT_TEAM=F3XX4PM3MF CODE_SIGN_STYLE=Automatic PRODUCT_BUNDLE_IDENTIFIER=uk.co.shyden.wda`. iPhone UDID for xcodebuild: `00008150-000954D90A20401C` (read from `listDevices`, never hard-coded in code).
- Never open a safaridriver session (it kills WDA).
- No new npm package.
- Commits end with the session's attribution lines; messages say `Refs #838`, never a closing keyword.

## Review Focus

1. **Phone locked or Safari not in front when the run starts:** the canary fails with "tap did not land" plus the hit target that was found; never a pass. Test: Task 4, `canary fails closed when the trusted event never arrives`.
2. **Page zoomed or scrolled (visual viewport offset/scale not 1/0):** points still land on the element. Test: Task 3, `toScreenPoint applies visual-viewport offset and scale`.
3. **Target under Safari's bottom toolbar or off screen:** scroll to centre first; a centre outside the WebView frame fails before tapping. Test: Task 3, `toScreenPoint refuses a point outside the screen`.
4. **WDA never prints its ready line (signing profile expired 2027-07-02, build failure):** the runner fails at its ceiling, quoting the last xcodebuild lines, and still kills the process. Test: Task 2, `startWda rejects at the ceiling and kills the child`.
5. **WDA left running after a crash mid-run:** `stopWda` runs in `finally`; the runner refuses to start if a `xcodebuild test-without-building` for this UDID already runs. Test: Task 2, `startWda refuses when a runner is already alive`.

---

### Task 1: Measure on the phone (spike, throwaway)

Decides three facts the code depends on; record the measured answers at the top of `.superpowers/sdd/838/measurements.md` (git-ignored) and in the PR body.

- [ ] **Step 1:** Build and start WDA per the recipe, and open Safari on a dev page with `launchSafari`.
- [ ] **Step 2: Session.** Does `POST /session {"capabilities":{"alwaysMatch":{"bundleId":"com.apple.mobilesafari","forceAppLaunch":false,"shouldWaitForQuiescence":false}}}` attach to the already-open Safari without relaunching it (does the inspector page stay attached)? If not, try `{}` capabilities. Record which one works.
- [ ] **Step 3: WebView frame.** `POST /session/:id/element {"using":"class chain","value":"**/XCUIElementTypeWebView"}` then `GET /session/:id/element/:eid/rect`. Record the rect and whether it changes when Safari's toolbar collapses after scrolling.
- [ ] **Step 4: Mapping.** Inject a fixed 100×100 button at a known CSS position, tap `frame.x + (cssX - vv.offsetLeft) * vv.scale` (same for y) via `POST /session/:id/actions` (pointer type `touch`: move, down, pause 50 ms, up). Record whether a `pointerdown` with `isTrusted === true` and `pointerType === 'touch'` reached the button. Repeat once with the page pinch-zoomed.
- [ ] **Step 5: Typing.** Tap a text field, then `POST /session/:id/wda/keys {"value":["Ana"]}`, then `{"value":["\b\b\b"]}`. Record the field's value after each.
- [ ] **Step 6:** Stop WDA; `pgrep -fl 'xcodebuild test-without-building'` prints nothing. If any step's answer differs from what Tasks 2-5 assume, update this plan before starting Task 2.

### Task 2: The runner owns WDA's lifetime

**Files:**
- Create: `scripts/wda.mjs`
- Modify: `scripts/test-devices.mjs` (the iOS group, around line 1035), `scripts/devicectl.mjs` (add `tunnelAddress`)
- Test: `tests/unit/wda-lifetime.test.ts`, `tests/unit/devicectl.test.ts`

**Interfaces:**
- WDA must start inside the same runner process as the iOS Vitest group: the machine test lock counts `xcodebuild test-without-building` as a heavy run, so a separately started WDA blocks the group (measured Task 1).
- Produces: `startWda({ udid, coreDeviceId, spawn, exec, cacheDir, ceilingMs }) => Promise<{ url: string; stop(): Promise<void> }>`; `WDA_READY_CEILING_MS = 180_000` (build included, measured ~2 min in the recipe); `parseReadyLine(line: string) => string | null` reads `ServerURLHere->http://<ip>:8100<-ServerURLHere`; `tunnelAddress(coreDeviceId, { exec }) => string`, the "Tunnel IP Address" from `xcrun devicectl device info details --device <id>`.
- The URL handed on is `http://[<tunnel address>]:8100` (USB, not Wi-Fi; Wi-Fi here is unstable).
- Cache: clone and DerivedData under `~/Library/Caches/shyden-wda/<pin>/`; `build-for-testing` runs only when the `.xctestrun` for this pin is missing.

- [ ] **Step 1: Write the failing tests** in `tests/unit/wda-lifetime.test.ts` with a fake `spawn` (an EventEmitter with `stdout`, `kill`) and fake `exec`:
  - `parseReadyLine reads the URL from xcodebuild's ready line` (`'ServerURLHere->http://192.168.1.9:8100<-ServerURLHere'` → `'http://192.168.1.9:8100'`; any other line → `null`).
  - `startWda resolves with the tunnel URL once the ready line prints` (exec returns tunnel `fdca:60ef:3214::1` → url `http://[fdca:60ef:3214::1]:8100`).
  - `startWda skips build-for-testing when the xctestrun exists` / `builds when it is missing` (assert the exec/spawn argument lists contain the pinned flags from Global Constraints).
  - `startWda rejects at the ceiling and kills the child` (fake timers; message names `WDA_READY_CEILING_MS` and the last 5 output lines).
  - `startWda refuses when a runner is already alive` (exec of `pgrep -f 'xcodebuild test-without-building.*<udid>'` returns a pid → rejects naming the pid).
  - `stop kills the child and resolves only after it exits`.
  - in `devicectl.test.ts`: `tunnelAddress reads the Tunnel IP Address line`.
- [ ] **Step 2:** `npm run test:unit -- wda-lifetime devicectl` → FAIL (module missing).
- [ ] **Step 3:** Implement `scripts/wda.mjs` and `tunnelAddress`. In `test-devices.mjs`, start WDA before the iOS Vitest group, pass `WDA_URL` in its `env`, and call `stop()` in a `finally` that also runs when the group throws.
- [ ] **Step 4:** `npm run test:unit -- wda-lifetime devicectl` → PASS; `npm run typecheck` clean.
- [ ] **Step 5: Commit** `The device run starts WebDriverAgent on the iPhone itself and always stops it (Refs #838)`.

### Task 3: WDA client and screen-point mapping

**Files:**
- Create: `tests/device/ios/wda.ts`
- Test: `tests/unit/ios-wda.test.ts`

**Interfaces:**
- Produces:
  - `type Http = (method: 'GET'|'POST'|'DELETE', path: string, body?: unknown) => Promise<unknown>`; `httpFor(baseUrl: string): Http` (real `fetch`, ceiling `WDA_COMMAND_CEILING_MS = 10_000`, throws `WdaError` naming method, path and WDA's `value.message`).
  - `class WdaSession { static open(http: Http): Promise<WdaSession>; windowRect(): Promise<Rect>; tap(point: Point): Promise<void>; keys(text: string): Promise<void>; close(): Promise<void> }`, using the capabilities Task 1 recorded.
  - `type Rect = { x: number; y: number; width: number; height: number }`, `type Point = { x: number; y: number }`, `type VisualViewport = { offsetLeft: number; offsetTop: number; scale: number }`.
  - `toScreenPoint(cssRect: Rect, vv: VisualViewport, origin: Point, screen: Rect): Point`: the centre of `cssRect`, mapped as `origin.x + (cx - vv.offsetLeft) * vv.scale` (same for y); throws `RangeError` naming both if the point is outside `screen`. `origin` is the page's content origin in screen points, measured by the canary (Task 1: WDA's WebView frame is the whole screen, `{0,0,420,912}`, while the page starts at y=68).
  - `tap` posts W3C actions: one `pointer` source, `pointerType: 'touch'`, `pointerMove` (duration 0) → `pointerDown` → `pause` 50 ms → `pointerUp`, then `DELETE /session/:id/actions`.

- [ ] **Step 1: Write the failing tests** (fake `Http` records calls):
  - `toScreenPoint maps the centre at scale 1` (rect `{x:10,y:20,w:100,h:40}`, vv `{0,0,1}`, origin `{x:0,y:68}`, screen `{0,0,420,912}` → `{x:60,y:108}`).
  - `toScreenPoint applies visual-viewport offset and scale` (vv `{offsetLeft:10, offsetTop:20, scale:2}`, origin `{x:0,y:68}` → `{x:100,y:128}`).
  - `toScreenPoint refuses a point outside the screen`.
  - `tap sends one touch pointer: move, down, 50 ms pause, up` (exact action body asserted) and then releases actions.
  - `keys posts the text to wda/keys as one value array`.
  - `a WDA error names the method, path and WDA's message`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS, typecheck clean.
- [ ] **Step 5: Commit** `A WebDriverAgent client taps the iPhone at an element's real screen point (Refs #838)`.

### Task 4: Real-tap interaction, per-tap landing check and canary

**Files:**
- Modify: `tests/device/ios/interaction.ts` (replace `DomDispatchInteraction`), `tests/device/ios/session.ts:298-352`, `tests/device/ios/page-driver.ts` (drop `click`/`clear`/`sendKeys` from `PageElement` once unused, and their tests in `tests/unit/page-driver.test.ts`)
- Test: `tests/unit/ios-real-tap.test.ts` (new; uses `tests/unit/page-driver-fake.ts`)

**Interfaces:**
- Consumes: `WdaSession`, `toScreenPoint`, `Rect`, `Point`, `VisualViewport` (Task 3); `PageElement.rect()`, `PageDriver.executeScript`.
- Produces: `type InteractionMode = 'real-tap'`; `class RealTapInteraction implements Interaction { constructor(driver: PageDriver, wda: WdaSession, origin: Point, screen: Rect) }`; `runTapCanary(driver: PageDriver, wda: WdaSession): Promise<Point>`; `class TapNotLandedError extends Error` (fields `selector`, `hitTarget`).
- `click(element)`, in order:
  1. `element.scrollIntoView({block:'center', inline:'center'})` in the page, then wait for two animation frames.
  2. Read `rect()` and `visualViewport`; `toScreenPoint` with the canary's `origin` and `wda.windowRect()` (read once per session).
  3. Hit check in the page: `document.elementFromPoint(cx, cy)` must be the element or inside it; otherwise throw `TapNotLandedError` naming the selector and the hit element (tag, id, classes), before tapping.
  4. Arm a one-shot capturing `pointerdown` listener on the element that records `isTrusted`, `pointerType`, `clientX`, `clientY`.
  5. `wda.tap(point)`.
  6. Read the record (ceiling 2 s); absent, untrusted, not `touch`, or its client point outside the element's rect → `TapNotLandedError` (the last names the drift between expected and actual client point).
- `type(element, text)`: `click(element)`, then `wda.keys(text)`. `clear(element)`: `click(element)`, read `value.length`, `wda.keys('\b'.repeat(n))`, then assert `value === ''`.
- `runTapCanary(driver, wda): Promise<Point>`: injects a full-viewport fixed layer (`position:fixed; inset:0; z-index:2147483647`) recording one trusted touch `pointerdown`, taps the screen point `(screen.width/2, screen.height/2)`, and returns `origin = screen point − (clientX, clientY)`; then removes the layer, injects a fixed 120×60 button at the viewport centre and `click`s it through `RealTapInteraction` with that origin, proving the whole path. The `RealTapInteraction` constructor takes `(driver, wda, origin: Point, screen: Rect)`. Any error is rethrown as `iPhone real taps are not landing: <cause>. The run stops here; it never falls back to el.click().`
- `startIosSession`: requires `process.env.WDA_URL` (missing → throw naming `scripts/test-devices.mjs` as the place that starts WDA); opens `WdaSession`; builds `RealTapInteraction`; runs `runTapCanary` on `${baseUrl}/` before returning; `teardown` closes the WDA session as well as the inspector. `describeInteractionMode('real-tap')` says taps and keys are real touches and keyboard input through WebDriverAgent.

- [ ] **Step 1: Write the failing tests:**
  - `click scrolls the element to centre before reading its rect` (call order on the fake driver).
  - `click refuses when another element is the hit target, naming it` (fake `elementFromPoint` returns `div#overlay.cover` → `TapNotLandedError` with that text; `wda.tap` never called).
  - `click taps the mapped screen point once`.
  - `click fails when no trusted touch reaches the element`.
  - `type taps the field and sends the text as keys`; `clear sends one backspace per character and checks the field is empty`.
  - `canary fails closed when the trusted event never arrives` (message starts `iPhone real taps are not landing`).
  - `startIosSession refuses to start without WDA_URL`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement; delete `DomDispatchInteraction` and the now-unused `PageElement` input methods. **Step 4:** run → PASS; typecheck clean.
- [ ] **Step 5: Commit** `Every iPhone tap is a real touch through WebDriverAgent, checked to land, and the run stops if one does not (Refs #838)`.

### Task 5: Journeys, mode banner and docs say real taps

**Files:**
- Modify: `tests/device/ios/journeys.journey.ts` (header comment near line 30; Journey 11 at line 737), `scripts/dashboard.mjs:378-439` (banner class for `real-tap`; drop `dom-dispatch` styles), `CLAUDE.md` real-device gauntlet paragraph (one sentence: iPhone taps are real through WDA, which the run starts and stops).

- [ ] **Step 1:** Journey 11 becomes `Journey 11 -- iOS-only, no zoom on focus: a real tap into every typed field keeps visualViewport.scale at 1 and the field focused`: after `interaction.click(field)`, assert `document.activeElement === field` and `visualViewport.scale === 1`, keeping the existing font-size ≥ 16px check.
- [ ] **Step 2:** remove every "dom-dispatch" wording (`grep -rn "dom-dispatch" tests scripts CLAUDE.md` prints nothing).
- [ ] **Step 3:** `npm run format && npm run typecheck && npm run test:unit` → clean.
- [ ] **Step 4: Commit** `The iPhone journeys and the dashboard report real taps, and Journey 11 checks focus without zoom after a real tap (Refs #838)`.

### Task 6: Mutation parity on both phones (AC4, by hand, not kept)

- [ ] **Step 1:** On a scratch commit (never pushed), add to `src/pages/classroom-groups.astro`'s page a transparent `position:absolute` div covering `#cg-go` (`opacity:0; pointer-events:auto`).
- [ ] **Step 2:** Run `npm run test:devices` against it. Expected: Android RED (Playwright reports the div intercepting the pointer) and iPhone RED with `TapNotLandedError` naming the div. Save both failure lines.
- [ ] **Step 3:** Drop the scratch commit (`git reset --hard` to the Task 5 commit, nothing else uncommitted first); stop WDA; `pgrep -fl 'xcodebuild test-without-building'` prints nothing.

### Task 7: Gauntlet green and PR (AC5)

- [ ] **Step 1:** `npm run test:devices` on the Task 5 head: green on emulated, Android and iPhone; the iPhone banner reads `real-tap`. Record the three totals and the iPhone run time.
- [ ] **Step 2:** Push the branch, open the PR into `develop` (body: what changed, Task 1 measurements, Task 6 failure lines, Task 7 totals, `Refs #838`). Move #838 to In Progress when the branch is pushed.
- [ ] **Step 3:** When CI is green on the head SHA, squash-merge; confirm `dev-verified` on the merge commit; post the AC list N of N on #838 and close it by hand.
