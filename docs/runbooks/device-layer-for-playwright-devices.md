# The device layer shyden.co.uk already has (for shyden-labs/playwright-devices)

Shyden ruled on 2026-11-17 that the Playwright-on-devices layer is built once, in `shyden-labs/playwright-devices`, for every device type, and every project adopts it. shyden-labs/shyden.co.uk#840 became "adopt playwright-devices" and waits on it. This note is where the new repo starts. It describes `develop` as read on 2026-11-17 (shyden-labs/shyden.co.uk#1186). Every file named below is in this repository. Nothing in it uses a third-party iOS package.

## iPhone: our own Web Inspector client, with WebDriverAgent for input

The page is read and driven through Safari's Web Inspector. Input goes through WebDriverAgent (WDA), because the Web Inspector protocol has no Input domain.

| File | What it does |
| --- | --- |
| `tests/device/ios/inspector/usbmux.ts` | Talks to the Mac's usbmuxd: lists the phone, hands over its pair record, opens a tunnel to a port on the phone. |
| `tests/device/ios/inspector/lockdown.ts` | Lockdown (port 62078): QueryType, StartSession, StartService for `com.apple.webinspector`. |
| `tests/device/ios/inspector/pin.ts` | TLS to the phone, pinned to the pair record's own root (the certificate is self-signed, so a chain check would refuse it). |
| `tests/device/ios/inspector/link.ts` | Frames over any byte transport. Every wait has a ceiling. |
| `tests/device/ios/inspector/bplist.ts`, `plist-xml.ts`, `framing.ts`, `fields.ts` | Binary and XML plists, length framing, field readers. |
| `tests/device/ios/inspector/wir.ts` | The Web Inspector RPC: binary-plist `{ __selector, __argument }` messages. |
| `tests/device/ios/inspector/protocol.ts` | The JSON protocol to a page, sent through its target (the iOS 13+ shape). |
| `tests/device/ios/inspector/connect.ts` | The whole route in one call: usbmuxd, then lockdown, then TLS, then the inspector, then a page. |
| `tests/device/ios/session.ts` | Finds the iPhone, opens Safari on `about:blank` with `devicectl`, attaches the inspector, asks the phone which Mac address it can reach, and returns a `PageDriver`. |
| `tests/device/ios/page-driver.ts` | Drives Safari's page through the inspector. This replaced `safaridriver` (see below). |
| `tests/device/ios/interaction.ts` | Real touches, finger drags and the iPhone's own keyboard through WDA. No script scroll, click or value set. |
| `tests/device/ios/wda.ts` | Client for the WDA HTTP API (`WDA_URL`). |
| `scripts/wda.mjs` | Builds and starts WDA: appium/WebDriverAgent v16.14.0 (BSD), pinned to commit `d17782422d55ff1e5e0ceb74eb1fd509cc0c35b6`, on port 8100. The run always stops it. |
| `scripts/devicectl.mjs` | Every `xcrun devicectl` read, each with a deadline. |
| `tests/device/ios/journeys.journey.ts`, `evidence.ts`, `png-shrink.ts` | The iPhone journeys and their screenshot evidence. The iPhone suite is Vitest: 80 tests in all on 2026-11-17. |

Designs: `docs/superpowers/specs/2026-10-16-ios-web-inspector-design.md` and `docs/superpowers/specs/2026-10-31-ios-page-driving-design.md`.

## Android: Playwright over CDP

| File | What it does |
| --- | --- |
| `playwright.device.config.ts` | The `android-chrome` project (791 tests) and a clock project (21), connected over CDP. |
| `tests/device/android-preflight.setup.ts` | Six preconditions, each its own test: adb sees one device, the screen is awake and unlocked, Chrome is in front, the DevTools socket exists, the adb forward and reverse tunnels are mapped, and CDP answers as Chrome. |
| `tests/device/chrome-foreground.ts` | Detects Chrome losing the foreground (the phone's assistant app took it, causing 147 and 62 failures in two runs). |
| `tests/device/device-downloads.ts` | Sends downloads to the phone and reads the bytes back over adb. |
| `tests/real-touch.ts` | Real touches on the phone (`tapOn` and its siblings). |
| `tests/device/no-mouse-on-phone.ts` | Refuses every Playwright call that sends mouse input or scrolls by protocol on the phone (shyden-labs/shyden.co.uk#996). |
| `tests/device/native-picker.ts` | Chooses a `<select>` option by tapping the select and then a row of Chrome's own dialog, which neither the page nor CDP can reach (shyden-labs/shyden.co.uk#1027). |
| `tests/device/visitor-tab.ts` | Opens every tab with a VIEW intent, the way a visitor's link does, and has Playwright adopt it (shyden-labs/shyden.co.uk#807). |
| `tests/device/ui-dump.ts` | Reads a `uiautomator dump`, so the phone's own Settings screens are walked by real taps on what a control says, never a fixed coordinate (shyden-labs/shyden.co.uk#1047). |
| `scripts/test-devices.mjs` | `npm run test:devices`: one build and one server. Runs the desktop group, the Android phone and the iPhone at once, with a live dashboard on `:4322`. Design: `docs/superpowers/specs/2026-08-08-real-device-test-harness-design.md`. |

## Facts measured here that the new repo needs

- **`safaridriver` and WDA cannot run together.** safaridriver holds the phone in Guided Access, which kills WDA or refuses it. Shyden ruled on shyden-labs/shyden.co.uk#838 (2026-10-18) for WDA plus our own inspector client.
- **No npm package passed the licence rule** (shyden-labs/shyden.co.uk#811, measured 2026-10-16): `appium-ios-device` brought 159 packages and `appium-remote-debugger` 248, each including two unlicensed ones. `ios-webkit-debug-proxy` needs GPL `libusbmuxd`. That is why the client uses only Node's own `net` and `tls`.
- **A tap that does not land stops the run** (shyden-labs/shyden.co.uk#838). A harness fix never changes the page under test (shyden-labs/shyden.co.uk#838: a body-scroller workaround was rejected).
- **Port 8100 is shared.** Other sessions' Appium runs on real iPhones use the Mac's 8100 too. Check the listener with `lsof` before and after every run (shyden-labs/shyden.co.uk#1157).
- **A simulator run must name `IOS_UDID`.** Without it, the run found the parked real iPhone twice (exit 70) (shyden-labs/shyden.co.uk#1157).
- **Safari's tab overview swallows every touch.** A drag that started on the address capsule opened it (shyden-labs/shyden.co.uk#1169). Drags are now centred on the screen. The fix is on an unmerged branch (see below).
- **On the 8 GB Mac with 6 other sessions open, the simulator's WDA printed no ready line within 180 s** (shyden-labs/shyden.co.uk#1169). This is measured, but not proven to be the cause.
- **With the keyboard up, a tap at y 538 landed on the keyboard's accessory bar** (seen in a shyden-labs/shyden.co.uk#1169 probe). No ticket yet.
- **Android tunnels belong to whoever made them.** Another session's adb forward and reverse tunnels must not be removed (shyden-labs/shyden.co.uk#1163). A stopped run left a forward and two Chrome tabs behind, which broke ShyTalk's next run (shyden-labs/shyden.co.uk#1180).
- **Neither Brave nor Firefox on Android can be driven.** Every iOS browser is WKWebView, so one iOS engine covers all of them.
- **Totals, 2026-11-17:** each desktop engine 809, Android 812 (791 + 21 clock), iPhone 80. Making these equal within each device group is the `unified-tests` work (shyden-labs/shyden.co.uk#1056, shyden-labs/shyden.co.uk#1181, shyden-labs/shyden.co.uk#1182).

## Unmerged work on the simulator route

These branches are stacked, each cut from the one before. Each is ahead of `develop`.

- `1157-simulator-route`, pushed: runs the iPhone suite on the iOS Simulator (Safari opens only once the inspector socket is connected and is closed before the start page opens).
- `1168-stalled-swipe-message`, pushed: a swipe that stalls under a bar is reported as a stall.
- `1169-touches-stop`, not yet pushed: real swipes are centred on the screen.

None has had a clean simulator run yet: WDA failed to start under memory pressure. shyden-labs/shyden.co.uk#1183 (iPad and iPhone Duo on the simulator) and shyden-labs/shyden.co.uk#1184 (Android tablet and foldable emulators) are filed here and may move to playwright-devices.
