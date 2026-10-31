# The iPhone run drives the page through our own Web Inspector client (#859)

## Why

Shyden ruled on 2026-10-18 (AskUserQuestion on #838): **WebDriverAgent for taps, our Web Inspector client for the page, Safari's WebDriver retired from the iPhone run.** The two cannot share the phone: a Safari automation session holds it in Guided Access, so WebDriverAgent is killed or refused. #811 built the client (`tests/device/ios/inspector/`) and proved emulation through it. This ticket moves the page half of the run, opening a URL, running scripts, finding and reading elements, onto that client, so #838 can then add real taps beside it.

## Goals

1. The iPhone run starts no `safaridriver` and needs no Remote Automation setting.
2. Every call the journeys and the evidence capture make on the session today has a replacement on the new driver, with the same name and shape, so the journeys change only where a call cannot keep its shape (the #858 ceiling of 266 session calls only falls).
3. The run's totals match the last safaridriver run: 80 of 80.

## Non-goals

- Real taps or real typing. Taps stay `el.click()` and typing stays a set value plus `input`/`change`, as the run already does in `dom-dispatch` mode (#838 brings WebDriverAgent's).
- Emulation in journeys (#870), and new journeys.
- Cross-origin pages: the run serves one LAN origin. The protocol layer already follows a target swap (`Target.didCommitProvisionalTarget`, measured 2026-10-24).

## Measured on the iPhone Air, iOS 27.0.1, 2026-10-31

Logs in `.superpowers/sdd/859/` (git-ignored): `drive-probe-2026-10-31.log`, `drive-probe-2-2026-10-31.log`, `blank-probe-2026-10-31.log`.

| need | command | result |
| --- | --- | --- |
| open Safari | `xcrun devicectl device process launch --terminate-existing --payload-url <url> com.apple.mobilesafari` | works for `about:blank` and `https://` URLs; the page is listed and attached in 0.14-0.26 s |
| a sync value | `Runtime.evaluate` `returnByValue: true` | value in `result.value` |
| a page exception | the same | `wasThrown: true`, `result.className` and `result.description` (`TypeError: probe boom`) |
| an async value | `Runtime.evaluate` `awaitPromise: true` | **ignored**: a promise comes back as `{}` |
| an async value | `Runtime.evaluate` (no `returnByValue`) gives the promise's `objectId`, then `Runtime.awaitPromise { promiseObjectId, returnByValue: true }` | resolves to the value; a rejection comes back `wasThrown: true` with the error's class and message |
| an element | `Runtime.evaluate` without `returnByValue` | `objectId`, `subtype: "node"`, `className` |
| a list of elements | an array's `objectId`, then `Runtime.getProperties { ownProperties: true }` | one `objectId` per index |
| act on an element | `Runtime.callFunctionOn { objectId, functionDeclaration, arguments: [{ value } or { objectId }], returnByValue }` | works |
| an element after a reload | the same with an old `objectId` | error `Missing injected script for given objectId` |
| navigate | `Page.navigate` | **absent**: `'Page.navigate' was not found` |
| navigate | `Runtime.evaluate` of `location.assign(url)` | navigates; `Page.frameNavigated`, `Page.domContentEventFired`, `Page.loadEventFired` follow, target id unchanged on one origin |
| reload | `Page.reload` | works; the same three events follow |
| screenshot | `Page.snapshotRect { x, y, width, height, coordinateSystem: 'Viewport' }` | a PNG `dataURL` at device pixels (1170 x 900 for 390 x 300) |
| LAN reachability from the page | `fetch(lan, { mode: 'no-cors' })` from `about:blank` | `opaque` from both of the Mac's addresses (`en0` and the USB link-local `en2`) |

## After the first phone run, 2026-10-31

The first run gave 0 of 80: every navigation waited out its 15 s for `Page.loadEventFired`. Probes on the phone (`.superpowers/sdd/859/swap-probe-2026-10-31.log`, `swap-probe-2-2026-10-31.log`) showed why:

- `about:blank` to the LAN page swaps the page's target (`Target.targetCreated` provisional `page-50`, `Target.didCommitProvisionalTarget`, `Target.targetDestroyed page-39`).
- Those messages reach us only with the answer to the next command we send: at 1.35 s when the next command went at 1.35 s, at 12.35 s when it went at 12.35 s.
- The new target sends no `Page.loadEventFired`, not even after `Page.reload`; its commands answer normally.

So `navigate` polls instead (below). `nav-probe-2026-10-31.log`: `about:blank` to `/` in 749 ms, then `/classroom-groups`, `/classroom-groups/` and a same-URL reload, each found `#cg-go`.

## The design

### One new file: `tests/device/ios/page-driver.ts`

`PageDriver` and `PageElement` keep the method names and argument shapes of today's `WebDriver` and `WebElement` (`tests/device/ios/webdriver.ts`), built on `PageProtocol` from `openInspector`:

| today | new |
| --- | --- |
| `navigate(url)` | The current document is marked (`window.__pageDriverLeaving = true`), then `location.assign(url)` by `Runtime.evaluate`, then the page is asked every 100 ms whether its document is unmarked and `readyState` is `complete`, ceiling 15 s naming the URL. A `Missing target for given targetId` answer during the poll means "not loaded yet"; any other refusal ends the wait. If the URL equals the current `location.href`, `Page.reload` instead (an assign to the same URL does not always load). Not by `Page.loadEventFired`: see *After the first phone run*. |
| `executeScript(script, args)` | WebDriver semantics kept: `script` is a function body. `Runtime.evaluate('window')` gives a fresh handle each call (2 ms measured, so no handle is ever stale), then `Runtime.callFunctionOn` on it with `functionDeclaration: 'function () {' + script + '\n}'`, `arguments` mapped `PageElement` → `{ objectId }`, else `{ value }`, `returnByValue: true`. No caller returns an element (read 2026-10-31), so none is supported. |
| `executeAsyncScript(script, args)` | The body is wrapped in `new Promise((resolve) => { ...; })` with `resolve` as the last argument (WebDriver's callback), then `Runtime.awaitPromise`. |
| `findElement(css)` / `findElements(css)` | `document.querySelectorAll` as an array handle, then `Runtime.getProperties`; `findElement` throws naming the selector when none match, as today. |
| `screenshot()` | `Page.snapshotRect` of the viewport (`innerWidth` x `innerHeight` read first); returns the base64 after the `data:image/png;base64,` prefix, as today. |
| `waitFor(...)` | unchanged; it is already transport-free. |
| `PageElement.click/clear/sendKeys/text/attribute/property/rect` | `Runtime.callFunctionOn` on the element: `this.click()`; value cleared plus `input`/`change`; value appended plus `input`/`change` (a stand-in, marked `NOT YET THE SAME as Android (#838)`); `innerText`; `getAttribute`; `this[name]`; `getBoundingClientRect()`. |

That is every call in use, read from `tests/device/ios/*.ts` on 2026-10-31: 6 of 6 on the driver (`navigate`, `executeScript`, `executeAsyncScript`, `findElement`, `findElements`, `screenshot`) and 7 of 7 on an element (`click`, `clear`, `sendKeys`, `text`, `attribute`, `property`, `rect`). `elementRef` and `elementRequest` existed only to wrap an element for the wire; a `PageElement` is passed as itself. `sessionId`, `capabilities` and `deleteSession` belong to the WebDriver session and go with it. No caller uses `getUrl` or `refresh`, so neither is built.

Errors: a thrown page exception becomes `PageScriptError` naming the script's first line, the error's class and message. A stale handle becomes `StaleElementError` naming the selector that found it, the same distinction `WebDriverError` drew. Nothing retries (global rule).

### Session start (`session.ts`)

1. The device is present (unchanged, `scripts/devicectl.mjs`).
2. Safari is launched on `about:blank` by `devicectl`, and `openInspector` attaches to the page whose URL is `about:blank`, `expectedUdid` set to the device's.
3. The phone picks the address: `deviceCanReach` runs its `fetch` through `executeAsyncScript`, as today.
4. The mode is `dom-dispatch`, announced as today. The canary goes: it measured WebDriver's own input commands, which no longer exist. `ios-mode.json` is still written, so `scripts/test-devices.mjs` reports the mode. `SyntheticTouchInteraction` and `detectInteractionMode` are deleted (#838 adds the WebDriverAgent one).
5. `navigateToPath` is unchanged in what it does (stamp dark, load, check the ground, wait for `#cg-go`).
6. `teardown()` is `inspector.close()`, which detaches and closes every socket. The session marker and `test-devices.mjs`' WebDriver `DELETE /session` and port cleanup go: when this process dies its sockets die with it, and the phone frees the page (measured 2026-10-26: a second run attached at 0.1 s after an exit with no close).

### What is deleted

`tests/device/ios/webdriver.ts` (its `waitFor` moves to `page-driver.ts`), `startSafaridriver`, `createSessionWithRetry` (a retry: a ticketed defect class anyway), the session marker, `tests/unit/webdriver.test.ts` and `tests/unit/ios-session-end.test.ts` (replaced), `test-devices.mjs`' safaridriver cleanup and its tests in `device-runner.test.ts`. `server-process.ts` and `tests/integration/server-process.test.ts` go too: safaridriver is its only caller (read 2026-10-31), and its entry in `tests/ios-ceilings.json` with it.

### The guard

`tests/guards/no-safaridriver.test.ts`: no file under `tests/`, `scripts/` or `package.json`, comments stripped (`searched()`, so an empty population fails), names `safaridriver`. Watched fail once on a planted line.

### Tests

Unit, no socket and no process: `PageDriver` over a fake `Channel` (the `PageProtocol` constructor already takes one), each method pinned on the exact JSON it sends and on the answer shapes recorded above (copied from the probe logs into `tests/unit/fixtures/ios-inspector/` beside #811's, with the existing fixture guard refusing secrets). One test per method and per error path.

On the phone: `npm run test:devices` iOS group, totals quoted on the ticket, 80 of 80.

## Decided here (my calls, Shyden may overrule)

- `devicectl` launches Safari, not WebDriverAgent's `/url`: WDA is #838's and not built yet.
- The new driver keeps WebDriver's method names, so the journey file barely changes and the #858 count does not move.
- The interaction canary is deleted rather than ported, because what it measured is gone.

## Left to the builder

The names of private helpers.
