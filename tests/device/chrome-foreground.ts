import { adb } from '../../scripts/adb.mjs';

/**
 * Chrome losing foreground mid-run: observed live, at least twice, independently, across this
 * real-device harness's own history -- 147 failed and 62 failed in otherwise-clean runs, versus
 * the usual ~6. `adb shell dumpsys window` showed `com.google.android.googlequicksearchbox`
 * (the phone's configured default assistant -- `adb shell settings get secure assistant`) had
 * taken foreground; pending, unread notifications from that same package (a weather briefing)
 * were present in the notification shade when this was investigated, though
 * `fullscreenIntent=null` on both rules out the most common direct "notification self-launches
 * an activity" mechanism, so the exact trigger remains unconfirmed (screen-sleep and
 * `stay_on_while_plugged_in` were both measured and ruled out -- see
 * docs/superpowers/specs/2026-08-08-real-device-test-harness-design.md for the harness this
 * module is part of).
 *
 * `tests/device/android-preflight.setup.ts`'s own precondition 3 ("Chrome is launched and is
 * the foreground app") only runs ONCE, at the very start of a run. `checkChromeForeground`
 * re-checks it before every test, called by tests/e2e/fixtures.ts's `page` fixture, and fails
 * that test naming the holder (#1073).
 *
 * android-preflight.setup.ts's preconditions 3 and 4 read the same two signals and import them
 * from here, so each check has one home. The focus check was once a cross-referenced duplicate
 * in the preflight ("both call sites need updating together"); #307 was the change that needed
 * both at once. On a cold launch Chrome takes the foreground about 200ms BEFORE its DevTools
 * socket exists (measured 3 of 3), so waiting for focus is not waiting for a Chrome that CDP
 * can reach, and the preflight, the one place that launches Chrome, waits for both.
 */

export const CHROME_PACKAGE = 'com.android.chrome';

/**
 * Every `mCurrentFocus=` line from `adb shell dumpsys window` -- there is more than one (one is
 * routinely `null`), so callers check "does ANY line name the package", never trust the first
 * match alone. Identical extraction to android-preflight.setup.ts's own precondition 3.
 */
export function currentFocusLines(): string {
  return adb(['shell', 'dumpsys', 'window'])
    .split('\n')
    .filter((line) => line.includes('mCurrentFocus='))
    .join('\n');
}

/**
 * The abstract unix socket Chrome's DevTools server listens on; `adb forward` maps it to
 * tcp:9222, which is where `chromium.connectOverCDP` attaches.
 */
export const DEVTOOLS_SOCKET = '@chrome_devtools_remote';

/**
 * The Chrome and WebView DevTools sockets listening on the device (`@chrome_devtools_remote`,
 * `@webview_devtools_remote_<pid>`), read from `/proc/net/unix`, whose last field on each line
 * is the socket's path. Returns the paths rather than a yes/no so that a failed wait prints what
 * WAS listening, not the whole socket table.
 *
 * Only those two families: other apps open DevTools sockets of their own (measured on the test
 * phone: a social app's JS engine, a messaging app's Stetho), and a failure message is no place
 * to list which apps are installed on someone's phone. Callers compare the result exactly, never
 * by substring, so a differently suffixed socket cannot stand in for Chrome's.
 */
export function devToolsSockets(): string[] {
  return adb(['shell', 'cat', '/proc/net/unix'])
    .split('\n')
    .map((line) => line.trim().split(/\s+/).pop() ?? '')
    .filter((path) => /^@(chrome|webview)_devtools_remote/.test(path));
}

/**
 * The per-test check (#1073): one `dumpsys window` read (median ~68ms, measured) while Chrome
 * holds the foreground. When any other app holds it, the test fails at once, naming the test
 * and every mCurrentFocus line, so the holder is found rather than worked round. It never
 * relaunches Chrome (global rule 2026-10-02: a retry is not a fix); the cause seen so far, the
 * phone's default assistant, is removed on the phone itself (Shyden's ruling, 2026-11-08).
 */
export function checkChromeForeground(testTitle: string): void {
  const focus = currentFocusLines();
  if (focus.includes(CHROME_PACKAGE)) return;
  throw new Error(
    `Chrome is not the foreground app as "${testTitle}" starts. Expected ${CHROME_PACKAGE}; ` +
      `\`dumpsys window\` shows: ${focus.trim() || '(no mCurrentFocus line at all)'}`,
  );
}
