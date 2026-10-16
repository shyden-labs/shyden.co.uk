# iPhone Web Inspector client — Design (#811)

Refs #811, #800, #801, #804, #821. Extends [the real-device harness design](2026-08-08-real-device-test-harness-design.md), section 5.

## 1. Why this exists

Every test the real-Android run executes has an iPhone twin (global mirror rule, 2026-10-15). Android's tests reach Chrome through the DevTools protocol: `emulateMedia` for print, reduced motion and colour scheme, `addInitScript`, `page.on('console')`, `page.route`, `goBack`. The iPhone run reaches Safari only through `safaridriver` (W3C WebDriver), which has none of these. Safari's own Web Inspector protocol has them. This design adds a client for it, beside `safaridriver`, so the iPhone twin uses the same mechanism Android does.

## 2. Shyden's rulings (AskUserQuestion, 2026-10-16)

1. **Web Inspector only.** No Appium (so no WebDriverAgent and no 7-day re-signing).
2. **Keyboard tests need no iPhone twin**: *"this is fine because it's a phone and phone users are not expected to have a separate usb keyboard for their phones"*. Covers tests whose subject is a hardware key press (Tab, Shift+Tab, Space, Enter); typed text into a field still mirrors.
3. **Reduced motion, colour scheme and print go through the Web Inspector override**, not the Settings app, as Android's `emulateMedia` does.
4. **Forced colours: measure on the phone first** (Increase Contrast, Smart Invert, Classic Invert); he rules on the result.

## 3. What is measured, read, and assumed

| Fact | Status |
| --- | --- |
| `safaridriver` click, value and W3C actions report success and do nothing on the iPhone Air (iOS 27.0) | Measured, August 2026 (`tests/device/ios/interaction.ts`) |
| Appium `mobile: keys` "only works on iPad. On iOS calling it has no effect" | Read, Appium XCUITest driver docs |
| `Page.setEmulatedMedia`, `Page.overrideUserPreference` (PrefersReducedMotion, PrefersContrast, PrefersColorScheme), `Page.setBootstrapScript`, `Page.reload`, `Console`, `Network.setInterceptionEnabled` / `addInterception` / `interceptWithResponse` / `interceptContinue` exist | Read, WebKit `Source/JavaScriptCore/inspector/protocol/*.json` on main, 2026-10-16 |
| No forced-colours override and no `Input` domain in that protocol | Read, same files |
| Wire path: usbmuxd (`/var/run/usbmuxd`, 16-byte little-endian header, XML plist body: `ListDevices`, `ReadPairRecord`, `Connect` with the port byte-swapped); lockdown on port 62078 (4-byte big-endian length, binary plist: `QueryType`, `StartSession` then TLS with the pair record's host key and certificate, `StartService`); `com.apple.webinspector` on the port it returns (TLS when `EnableServiceSSL`), 4-byte big-endian length-framed binary plists, `_rpc_reportIdentifier:` / `_rpc_getConnectedApplications:` / `_rpc_forwardGetListing:` / `_rpc_forwardSocketSetup:` / `_rpc_forwardSocketData:`; on iOS 11 and later each message is one whole plist (the `WIRPartialMessageKey` / `WIRFinalMessageKey` chunking is for older iOS) and each is followed by a plist holding the string `" "`, which appium notes stops real devices hanging; page commands wrapped in `Target.sendMessageToTarget` | Read, source of `appium-remote-debugger` 17.5.16 and `appium-ios-device` 3.1.24 (downloaded as data, not installed) |
| iOS 27 Safari answers each of these commands | **Assumed until the phone run** (step 1 of the plan) |
| The inspector can attach to a page `safaridriver` is driving | **Assumed until the phone run**; the biggest risk (section 8) |

## 4. Why no dependency

The few-dependencies rule makes any new package Shyden's decision, and the licence rule makes unknown or GPL licences red, never waived. Measured 2026-10-16:

- `appium-ios-device` 3.1.24 adds **159 packages** (the repo has 438), two with **no licence** (`ftp-response-parser`, `parse-listing`, through `@appium/support`). Red.
- `appium-remote-debugger` 17.5.16 adds **248**, the same two. Red.
- `ios-webkit-debug-proxy` 1.9.2 (Homebrew, BSD-3-Clause) needs `libusbmuxd`, licensed `GPL-2.0-or-later AND LGPL-2.1-or-later`. Red.

So the client is written here on Node's own `net` and `tls`, like `tests/device/ios/webdriver.ts` ("plain `fetch`, no new dependencies"). CLAUDE.md's dependency line gains a sentence saying so, with these figures.

## 5. Architecture

Each file has one job and takes its transport as a parameter, so every layer is unit-tested without a socket or a process.

```
tests/device/ios/inspector/
  bplist.ts        binary plist encode/decode (the subset the protocol uses: dict, array, string, int, real, bool, data)
  plist-xml.ts     XML plist encode/decode (usbmuxd messages and the pair record are XML)
  framing.ts       usbmux 16-byte header frames; 4-byte big-endian length frames
  usbmux.ts        ListDevices, ReadPairRecord, Connect(device, port) over /var/run/usbmuxd
  lockdown.ts      QueryType, StartSession (TLS with the pair record), StartService -> { port, ssl }
  wir.ts           Web Inspector RPC: identify, list applications, list pages, attach to a page, send/receive protocol text
  protocol.ts      JSON protocol: ids, replies, errors, events, Target.sendMessageToTarget wrapping
  page.ts          the Playwright-shaped surface the journeys call (below)
```

`page.ts`, each a one-to-one mirror of what Android's test calls:

| Android (Playwright) | iPhone (`inspector.page`) | Protocol |
| --- | --- | --- |
| `page.emulateMedia({ media })` | `emulateMedia({ media })` | `Page.setEmulatedMedia` |
| `page.emulateMedia({ reducedMotion, colorScheme })` | same options | `Page.overrideUserPreference` |
| `page.addInitScript(source)` | `addInitScript(source)` | `Page.setBootstrapScript` (one script; several are joined in order) |
| `page.on('console')` | `onConsole(listener)` | `Console.enable`, `Console.messageAdded` |
| `page.route(url, handler)` | `route(url, handler)` | `Network.setInterceptionEnabled`, `addInterception`, `requestIntercepted`, `interceptWithResponse` / `interceptContinue` |
| `page.goBack()` | `session.back()` | W3C `POST /session/{id}/back` on `safaridriver` (no inspector needed) |

`session.ts` gains `session.inspector`, attached once per journey file after the first navigation: find Safari (`com.apple.mobilesafari`) in the application list, find the page whose URL is the one `safaridriver` just opened, attach. Every override is undone in the session's per-test teardown (`emulateMedia` back to defaults, bootstrap script cleared, interceptions removed, interception off), and the teardown reads the result back in the page (the protocol has no getters: `matchMedia` for each media feature, and the bootstrap marker absent after the next load), so one test's setting cannot leak into the next. A journey that dies leaves nothing on the phone: every override lives in the inspector session and ends with it.

## 6. Errors

Fail fast, naming the cause; no retries (global rule):

- No paired device in `ListDevices`: names the phone the run expected.
- Web Inspector off: the page list stays empty past a stated ceiling; the error names the switch (Settings > Apps > Safari > Advanced > Web Inspector on iOS 18; the iOS 27 path is read off the phone in step 1).
- The page `safaridriver` opened is not in the listing within the ceiling: lists the URLs that are there.
- A protocol command returns an error: throws `InspectorError` with the command, its parameters and WebKit's message. A command iOS refuses is brought to Shyden before anything is called impossible (AC10).
- Another inspector already holds the page (Safari's Web Inspector open on the Mac): waits on its release up to a ceiling, then fails naming the holder, as the busy-resource rule requires.

## 7. Testing

- **Unit** (Vitest, no socket, no process, under 0.07 s of CPU each): `bplist` and `plist-xml` round-trip every type, plus golden bytes; framing splits and joins at every boundary; `usbmux`, `lockdown`, `wir` and `protocol` against an in-memory transport replaying recorded exchanges, one test per message kind and per error; a frame split across reads at every byte boundary; `page.ts` maps each Playwright option to its exact protocol call (literal expectations, never computed from the same table). Recordings are captured from the phone in step 1 and committed as fixtures, with secrets (pair record keys) stripped and a guard refusing them.
- **Device** (the phone, never CI): one canary journey per capability, each proving itself — `matchMedia` reads back each emulated value; the bootstrap script stamps a marker the page's first inline script reads; a console sentinel logged from the first script is received; a stubbed request returns the stub's body; `pageshow.persisted` is true after `back()`.
- **Mutation**: each canary is broken (wrong media, script cleared, listener detached, stub removed, back replaced by a navigation) and seen RED, then restored GREEN.
- **Mirror**: the ported tests in #800, #801 and #804 run with Android's titles, `iOS mirror:` prefixed; keyboard tests are listed in `tests/device/ios/exempt.ts` with Shyden's words, derived against the Android listing so a new keyboard test appears on the day it is added; existing stand-ins are kept and re-marked, never deleted.

## 8. Risks, and the first phone step

1. **The inspector may not attach to a page `safaridriver` drives.** Safari's automation windows are a separate mode. Measured first. If it cannot, the fallback is to drive navigation through the inspector and launch Safari with `devicectl`; that changes the existing driver, so Shyden is asked first.
2. **iOS 27 may not answer a command** read from WebKit main. Each is measured in step 1; a refusal goes to Shyden (AC10).
3. **Lockdown TLS on iOS 27** may need options Node's `tls` defaults refuse. appium turns certificate checking off (`rejectUnauthorized: false`); this client instead pins the phone's certificate to the pair record's `DeviceCertificate` and refuses any other. Measured in step 1; any weakened TLS setting is named in the code and in the PR.

Step 1 needs no code (Shyden's side note, 2026-10-16: keep the phone-free work small until a phone probe shows the approach works). With the phone on USB and a `safaridriver` session open on a page, Safari on the Mac opens its own Web Inspector on that page (Develop menu > the iPhone > the page). That inspector speaks the same protocol over the same service, so each step answers one risk: (a) the page is listed and the inspector attaches while the session drives it (risk 1); (b) the Elements tab's print-media and appearance buttons, and the user-preference overrides (reduced motion, colour scheme), change the page (`Page.setEmulatedMedia`, `Page.overrideUserPreference`); (c) an Inspector Bootstrap Script runs before the page's first script; (d) a Local Override answers a request (interception); (e) the console shows a page load from its first script (risk 2). The answers decide whether the layers in the plan are built at all. Only after a yes on (a) does the code grow past the codecs, and its fixtures are recorded from the phone then.

## 9. Not in scope

Real key presses (ruled out of the mirror, section 2), the Settings app, Appium, real touch input (taps stay dom-dispatch per the 2026-10-15 ruling), and forced-colours emulation until Shyden rules on the phone measurement.
