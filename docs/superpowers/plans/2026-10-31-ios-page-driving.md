# iPhone page driving through our Web Inspector client — Implementation Plan (#859)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The iPhone run drives Safari's page through `tests/device/ios/inspector/` instead of `safaridriver`, with 80 of 80 on the phone.

**Architecture:** A new `PageDriver`/`PageElement` (`tests/device/ios/page-driver.ts`) keeps today's `WebDriver`/`WebElement` method names and shapes, built on `PageProtocol.command`/`on`. `session.ts` launches Safari on `about:blank` with `devicectl`, attaches with `openInspector`, and hands journeys the new driver. Everything that existed only for safaridriver is deleted, and a guard keeps it gone.

**Tech Stack:** TypeScript, Vitest (unit), Node `net`/`tls` (already in `inspector/`), `xcrun devicectl`.

**Spec:** `docs/superpowers/specs/2026-10-31-ios-page-driving-design.md` (commit `f27e4e66`). Probe logs: `.superpowers/sdd/859/drive-probe-2026-10-31.log`, `drive-probe-2-2026-10-31.log`, `blank-probe-2026-10-31.log`.

## Global Constraints

- Unit tests start no process and open no socket; each under 1 s (fake timers for every ceiling).
- No retries anywhere (global rule). A wait has a ceiling and names what it waited for.
- Command ceiling `COMMAND_CEILING_MS` = 15 000 (`inspector/protocol.ts`); navigation load ceiling 15 s, naming the URL.
- `xcrun` is spawned only from `scripts/devicectl.mjs` (`tests/guards/device-tool-homes.test.ts`).
- Every commit green: `npm run format`, `npm run typecheck`, `npm run test:unit` before each commit. Guards/integration run in CI only.
- `tests/ios-ceilings.json` covers every file under `tests/device/ios/`; `journeys.journey.ts` `harnessCalls` may only fall (today 261). Re-record with `npm run ceilings:record`.
- Commit messages end `Refs #859`; never a closing keyword.

## Review Focus

1. **`about:blank` → LAN URL is the first navigation, and it may swap the page's process (target).** Not measured: the 2026-10-31 cross-origin probe did not see the swap land. `navigate` must still resolve on the new target's `Page.loadEventFired`. Pinned only on the phone (Task 6 Step 2); if it fails there, the fix is in `protocol.ts`'s event routing, not a retry.
2. **`Runtime.callFunctionOn` returning a promise** gives an `objectId` (measured for `Runtime.evaluate`, assumed for `callFunctionOn`). Unit test pins the two-step shape; the phone run (`deviceCanReach`) proves it.
3. **A script that throws synchronously inside `executeAsyncScript`** must reject with `PageScriptError`, not hang to the 15 s ceiling. Test in Task 1.
4. **`Runtime.getProperties` on an array lists `length` and other non-index names** besides `0..n-1`. `findElements` keeps only names matching `/^\d+$/`, ordered numerically. Test in Task 2 with a `length` entry and indices out of order.
5. **`rect()` through `returnByValue` on a `DOMRect`** can come back `{}`. The function returns a plain `{ x, y, width, height }` object literal. Test in Task 2 asserts the declaration builds the literal and that a missing number is refused naming the element.

---

### Task 1: `PageDriver` scripts and errors

**Files:**
- Create: `tests/device/ios/page-driver.ts`
- Create: `tests/unit/page-driver.test.ts`
- Create: `tests/unit/page-driver-fake.ts` (the fake page, shared by Tasks 1-3)
- Create: `tests/unit/fixtures/ios-inspector/page-driving-2026-10-31.json` (answer shapes copied verbatim from the probe logs; `objectId` strings kept, the screenshot `dataURL` cut to its first 64 base64 chars)
- Modify: `tests/unit/wait-for.test.ts` (import `waitFor` from `../device/ios/page-driver`; reword its two `safaridriver` messages to a generic "server exited")

**Interfaces:**
- Produces:
  - `type PagePort = Pick<PageProtocol, 'command' | 'on'>`
  - `class PageDriver { constructor(page: PagePort); executeScript<T = unknown>(script: string, args?: unknown[]): Promise<T>; executeAsyncScript<T = unknown>(script: string, args?: unknown[]): Promise<T> }`
  - `class PageScriptError extends Error { readonly scriptLine: string; readonly errorClass: string }` — message `page script failed (<first non-blank line of script, trimmed>): <description>`
  - `waitFor` and `WaitForOptions`, moved unchanged from `webdriver.ts` (Task 5 deletes the old copy; until then both exist)
  - Test helper `fakePage(answers: Record<string, unknown[]>): PagePort & { sent: { method: string; params: unknown }[]; emit(method: string, params?: unknown): void }` — answers are queued per method and shifted per call; a call with no queued answer throws naming the method.

- [ ] **Step 1: Write the failing tests** in `page-driver.test.ts`, one per case:
  - `executeScript` sends `Runtime.evaluate { expression: 'window' }` then `Runtime.callFunctionOn { objectId: <window's>, functionDeclaration: 'function () {' + script + '\n}', arguments: [{ value: 'a' }, { value: 2 }], returnByValue: true }`, and resolves to `result.value`.
  - a `wasThrown: true` answer rejects with `PageScriptError` whose message is `page script failed (return boom();): TypeError: probe boom` (the recorded thrown-error answer).
  - `executeAsyncScript` sends `Runtime.callFunctionOn` **without** `returnByValue`, its declaration containing the body and passing `resolve` as the last argument, then `Runtime.awaitPromise { promiseObjectId: <returned objectId>, returnByValue: true }`, resolving to `{ waited: 50 }` (recorded).
  - a rejection answer (recorded `RangeError: probe reject`, `wasThrown: true`) rejects with `PageScriptError` naming `RangeError: probe reject`.
  - a synchronous throw inside the async body (the `callFunctionOn` answer itself `wasThrown: true`) rejects with `PageScriptError` and sends no `Runtime.awaitPromise`.

- [ ] **Step 2:** `npm run test:unit -- tests/unit/page-driver.test.ts` — FAIL, module not found.

- [ ] **Step 3: Implement** `PageDriver.executeScript`, `executeAsyncScript`, `PageScriptError`, and move `waitFor` into `page-driver.ts`. Async declaration:

```js
function () {
  var args = Array.prototype.slice.call(arguments);
  var self = this;
  return new Promise(function (resolve) {
    args.push(resolve);
    (function () { BODY
    }).apply(self, args);
  });
}
```

- [ ] **Step 4:** the same command, plus `tests/unit/wait-for.test.ts` — PASS.
- [ ] **Step 5:** `npm run format && npm run typecheck && npm run test:unit`, then commit `The iPhone page driver runs scripts through the Web Inspector (Refs #859)`.

### Task 2: Elements

**Files:** Modify `tests/device/ios/page-driver.ts`, `tests/unit/page-driver.test.ts`.

**Interfaces:**
- Produces:
  - `PageDriver.findElement(css: string): Promise<PageElement>`; `findElements(css: string): Promise<PageElement[]>`
  - `class PageElement { constructor(page: PagePort, objectId: string, selector: string); readonly objectId: string; click(): Promise<void>; clear(): Promise<void>; sendKeys(text: string): Promise<void>; text(): Promise<string>; attribute(name: string): Promise<string | null>; property(name: string): Promise<unknown>; rect(): Promise<{ x: number; y: number; width: number; height: number }> }`
  - `class StaleElementError extends Error { readonly selector: string }` — message `the element <selector> found is gone from the page (it reloaded or was replaced)`

- [ ] **Step 1: Write the failing tests:**
  - `findElements` sends `Runtime.evaluate { expression: 'Array.from(document.querySelectorAll(<JSON of css>))' }` then `Runtime.getProperties { objectId, ownProperties: true }`; given properties named `'1'`, `'length'`, `'0'` it returns two elements in index order `0, 1` with their objectIds.
  - `executeScript` sends a `PageElement` argument as `{ objectId }` (Task 1's mapping, now that the class exists).
  - `findElement` returns the first; with none it rejects `no element matches <css>`.
  - each of the 7 element methods sends `Runtime.callFunctionOn { objectId: <element's>, functionDeclaration, arguments, returnByValue: true }`; assert the declaration per method: `click` calls `this.click()`; `clear` sets `this.value = ''` and dispatches bubbling `input` then `change`; `sendKeys` appends `arguments[0]` then the same two events, and its source carries the comment `NOT YET THE SAME as Android (#838)`; `text` returns `this.innerText`; `attribute` returns `this.getAttribute(arguments[0])`; `property` returns `this[arguments[0]]`; `rect` returns an object literal of `x, y, width, height` from `getBoundingClientRect()`.
  - `text()` refuses a non-string value naming the selector; `rect()` refuses a value missing any of the four numbers, naming the selector.
  - an `InspectorError` whose message holds `Missing injected script for given objectId` (recorded) becomes `StaleElementError` naming the selector; any other `InspectorError` passes through unchanged.

- [ ] **Step 2:** run — FAIL.
- [ ] **Step 3: Implement.** The 7 methods share one private `call(declaration, args)` helper that does the `callFunctionOn`, the stale mapping and the `wasThrown` → `PageScriptError` mapping from Task 1.
- [ ] **Step 4:** run — PASS.
- [ ] **Step 5:** format, typecheck, unit; commit `The iPhone page driver finds and reads elements (Refs #859)`.

### Task 3: Navigate and screenshot

**Files:** Modify `tests/device/ios/page-driver.ts`, `tests/unit/page-driver.test.ts`.

**Interfaces:**
- Produces: `PageDriver.navigate(url: string): Promise<void>`; `PageDriver.screenshot(): Promise<string>` (base64 PNG, no prefix); `NAVIGATION_CEILING_MS = 15_000`.

- [ ] **Step 1: Write the failing tests** (fake timers):
  - `navigate` reads `location.href` (`Runtime.evaluate`, `returnByValue: true`), subscribes to `Page.loadEventFired` **before** sending `Runtime.evaluate { expression: 'location.assign(<JSON of url>)' }`, and resolves only after the fake emits `Page.loadEventFired`. Assert order via the fake's `sent` and its subscription log.
  - when `location.href` already equals the URL it sends `Page.reload {}` and no `location.assign`.
  - with no load event, it rejects after 15 000 ms with `no Page.loadEventFired within 15 s of navigating to <url>`, and unsubscribes its listener (fake's listener count back to 0) on success and on failure alike.
  - `screenshot` reads `[innerWidth, innerHeight]`, sends `Page.snapshotRect { x: 0, y: 0, width, height, coordinateSystem: 'Viewport' }`, and returns the text after `data:image/png;base64,`; a `dataURL` without that prefix is refused, naming its first 30 chars.
- [ ] **Step 2:** run — FAIL.
- [ ] **Step 3: Implement.** No `Page.enable` is sent: the probes received `Page.*` events without it.
- [ ] **Step 4:** run — PASS.
- [ ] **Step 5:** format, typecheck, unit; commit `The iPhone page driver navigates and takes screenshots (Refs #859)`.

### Task 4: Launch Safari from `devicectl.mjs`

**Files:** Modify `scripts/devicectl.mjs`, `tests/unit/devicectl.test.ts`.

**Interfaces:**
- Produces: `safariLaunchArgs(udid: string, url: string): string[]` = `['devicectl', 'device', 'process', 'launch', '--device', udid, '--terminate-existing', '--payload-url', url, 'com.apple.mobilesafari']`; `launchSafari(udid, url, { timeoutMs = DEVICECTL_TIMEOUT_MS } = {})` runs `runWithDeadline('xcrun', safariLaunchArgs(udid, url), { timeoutMs, whenSilent: 'is the iPhone still connected, trusted and unlocked?' })`.

- [ ] **Step 1:** failing unit test pinning `safariLaunchArgs('U', 'about:blank')` to the exact array above.
- [ ] **Step 2:** run — FAIL. **Step 3:** implement both (JSDoc types, as the file's others). **Step 4:** PASS.
- [ ] **Step 5:** format, typecheck, unit; commit `devicectl opens Safari on a page for the iPhone run (Refs #859)`.

### Task 5: The session runs on the page driver; safaridriver goes

One commit: typecheck stays green only if the switch and the deletions land together.

**Files:**
- Modify `tests/device/ios/session.ts`: start = `findIosDevice()` → `launchSafari(device.udid, 'about:blank')` → `openInspector({ url: (u) => u === 'about:blank', expectedUdid: device.udid, dial: nodeDialer() })` → `inspector.page.targetCreated(COMMAND_CEILING_MS)` → `new PageDriver(inspector.page)` → `resolveReachableBaseUrl(driver)` (unchanged) → mode `'dom-dispatch'`, logged and written to `ios-mode.json` as today. Any failure after `openInspector` calls `inspector.close()` before rethrowing. `teardown()` is `inspector.close()`. `DeviceSession.driver: PageDriver`; `navigateToPath` unchanged. Delete `pickFreePort`, `startSafaridriver`, `createVerifiedSession`, `createSessionWithRetry`, the session marker functions, `endSession`, the `ChildProcess`/`net` imports. Rewrite the file header for the new flow.
- Modify `tests/device/ios/interaction.ts`: keep `InteractionMode = 'dom-dispatch'`, `Interaction` (on `PageElement`), `DomDispatchInteraction` delegating to `element.click()`/`sendKeys()`/`clear()`, and `describeInteractionMode`. Delete `SyntheticTouchInteraction`, the canary (`CANARY_*`, `observeClickEffect`, `detectInteractionMode`), `createInteraction`.
- Modify `tests/device/ios/journeys.journey.ts`, `evidence.ts`: imports and header comments that name WebDriver/safaridriver/the canary; no call changes expected.
- Delete `tests/device/ios/webdriver.ts`, `tests/device/ios/server-process.ts`, `tests/unit/webdriver.test.ts`, `tests/unit/ios-session-end.test.ts`, `tests/integration/server-process.test.ts`.
- Modify `scripts/test-devices.mjs`: delete `IOS_SESSION_MARKER_FILE`, `leakedSessionOf`, `deleteSession`, `cleanupLeakedIosSession` and its two calls (lines ~1328, ~1445); fix the comments at ~112 and ~616.
- Modify `tests/unit/device-runner.test.ts`: delete the `leakedSessionOf` and `deleteSession` describes (434-475) and their imports; keep `serversClosedAfterEach` (still used by `confirmServesBuild`).
- Modify `tests/http-stand-in.ts` header (names `webdriver.test.ts`), `scripts/devicectl.mjs` comment at 53, `scripts/dashboard.mjs` if it reads the marker.
- Modify `tests/ios-ceilings.json` by `npm run ceilings:record`: `webdriver.ts` and `server-process.ts` entries gone, `page-driver.ts` added, `harnessCalls` for journeys ≤ 261.

- [ ] **Step 1:** `grep -rn "safaridriver\|webdriver\|WebDriver\|SyntheticTouch\|detectInteractionMode\|session-marker\|ios-session" tests scripts package.json` — list every hit in the handover scratch file; each is fixed in this task or is a comment in a file Task 6's guard will read.
- [ ] **Step 2:** make the changes above.
- [ ] **Step 3:** `npm run typecheck` — PASS; `npm run test:unit` — PASS; `npm run ceilings:record` then `git diff tests/ios-ceilings.json` shows only the three expected entry changes and no rise.
- [ ] **Step 4:** re-run Step 1's grep; the only hits left are comments.
- [ ] **Step 5:** commit `The iPhone run drives Safari through our Web Inspector client, and safaridriver is retired (Refs #859)`.

### Task 6: The guard, the phone, the PR

**Files:** Create `tests/no-safaridriver.ts` (the matcher), `tests/unit/no-safaridriver.test.ts`, `tests/guards/no-safaridriver.test.ts`.

The guards suite runs in CI only, so the watched failure happens in the unit test of a pure matcher, and the guard applies that matcher to the tree.

- [ ] **Step 1: Failing unit test** for `safaridriverHits(files: readonly { path: string; text: string }[]): string[]` (returns the paths whose comment-stripped text names the tool): a `.ts` file with the name in code is a hit; the same name only in a `//` or `/* */` comment is not; a `.json` file is read raw and is a hit. The needle is built as `'safari' + 'driver'` in both files so neither spells it. Run — FAIL (module missing); implement with `withoutTsComments` (from `tests/unit/source-text`) for `.ts`/`.mjs`/`.js`; run — PASS.
- [ ] **Step 2: The guard.** Population: `filesUnder('tests', …)` and `filesUnder('scripts', …)` for `.ts`/`.mjs`/`.js`/`.json`, plus `package.json`. Assertion: `expect(safaridriverHits(searched(files, { of: files, what: 'test and script files' }))).toEqual([])`. Typecheck — PASS. Commit `A guard keeps safaridriver out of the iPhone run (Refs #859)`; CI runs the guard on the PR.
- [ ] **Step 2: Phone run.** iPhone unlocked, Safari closed. `npm run test:devices -- --ios` (the iPhone-only group, #623). Expected: iOS totals 80 passed of 80, 0 failed, 0 skipped; `ios-mode.json` says `dom-dispatch`. A failure is diagnosed on the phone first (global rule) — Review Focus 1 and 2 are the likely ones.
- [ ] **Step 3:** quote the totals line and the reachable-address line on #859; push the branch; open the PR into `develop` with `Refs #859`, checking the body with `node scripts/closing-keywords.mjs <file> "this pull request body"`; `~/.claude/scripts/pr-verdict.sh <pr>` in the background.
