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
 * the foreground app") only runs ONCE, at the very start of a run -- nothing re-checked it
 * during the ~150s that follow. This module is the fix: a cheap (median ~68ms, measured)
 * re-usable check, called once per test by tests/e2e/fixtures.ts's `page` fixture, BEFORE that
 * test's own actions begin, with one bounded recovery attempt.
 *
 * android-preflight.setup.ts's preconditions 3 and 4 read the same two signals and import them
 * from here, so each check has one home. The focus check was once a cross-referenced duplicate
 * in the preflight ("both call sites need updating together"); #307 was the change that needed
 * both at once. On a cold launch Chrome takes the foreground about 200ms BEFORE its DevTools
 * socket exists (measured 3 of 3), so waiting for focus is not waiting for a Chrome that CDP
 * can reach, and both places that launch Chrome now wait for both.
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

export function isChromeForeground(): boolean {
  return currentFocusLines().includes(CHROME_PACKAGE);
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

export function hasDevToolsSocket(): boolean {
  return devToolsSockets().includes(DEVTOOLS_SOCKET);
}

/**
 * Launches Chrome to about:blank and polls (condition-based, never a blind sleep) until it is
 * BOTH the reported foreground app AND listening on its DevTools socket. They are separate
 * events: on a cold launch the socket appears about 200ms after focus (#307), so a Chrome that
 * has only reclaimed the foreground is not yet one CDP can reach. Throws, naming which of the
 * two never happened and what was observed instead, if both are not true within `timeoutMs`.
 */
export async function relaunchChromeAndWaitReady(
  timeoutMs = 5_000,
): Promise<void> {
  adb([
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    'about:blank',
    CHROME_PACKAGE,
  ]);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const foreground = isChromeForeground();
    if (foreground && hasDevToolsSocket()) return;
    if (Date.now() >= deadline) {
      throw new Error(
        foreground
          ? `Chrome took the foreground but its DevTools socket ${DEVTOOLS_SOCKET} did not ` +
              `appear within ${timeoutMs}ms of relaunching it -- DevTools sockets listening: ` +
              `${devToolsSockets().join(', ') || '(none at all)'}`
          : `Chrome did not reclaim the foreground within ${timeoutMs}ms of relaunching it -- ` +
              `current \`dumpsys window\` mCurrentFocus line(s): ${currentFocusLines() || '(none at all)'}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * The per-test guard: if Chrome already holds the foreground, this costs one `dumpsys window`
 * call (median ~68ms) and returns immediately. If something else has taken it, this is
 * `tests/device/chrome-foreground.ts`'s whole reason to exist -- it logs LOUDLY (never a quiet
 * one-line warning easy to scroll past) exactly what was found instead, attempts ONE bounded
 * recovery, and either succeeds (this test proceeds against a freshly-confirmed-foreground
 * Chrome, exactly as if the interruption never happened) or throws a clearly-named error that
 * fails THIS test with the real cause stated outright.
 *
 * Deliberately a PRE-check only (before the test's own actions, not also after): a post-check
 * cannot retroactively change a test's already-recorded verdict, so its only added value is
 * shrinking the window before the NEXT test's own pre-check would catch the same loss anyway --
 * judged not worth doubling this guard's already-nonzero per-test cost for. What this design
 * guarantees: no test ever KNOWINGLY starts against the wrong foreground app. What it does NOT
 * guarantee: if focus is stolen DURING a test's own execution (after its pre-check already
 * passed), that one test's own result is not specially flagged -- but the blast radius is
 * bounded to that single test, because the VERY NEXT test's pre-check catches it before any
 * further test can run against the wrong app. This is what turns an unbounded cascade (147
 * failures) into, at worst, one confusing result per genuine interruption, and turns a
 * PERSISTENT interruption into every affected test failing with the SAME clearly-named cause --
 * trivially recognisable as one root cause, never mistaken for 147 unrelated product defects.
 */
export async function ensureChromeForegroundOrRecover(
  testTitle: string,
): Promise<void> {
  if (isChromeForeground()) return;

  const foundInstead = currentFocusLines();
  process.stderr.write(
    '\n' +
      '!'.repeat(70) +
      '\n' +
      `!! Chrome lost the foreground before "${testTitle}" could start.\n` +
      `!! Expected ${CHROME_PACKAGE}; \`dumpsys window\` shows:\n` +
      `!!   ${foundInstead || '(no mCurrentFocus line at all)'}\n` +
      '!! Attempting one bounded recovery (relaunch Chrome, wait up to 5s)...\n' +
      '!'.repeat(70) +
      '\n\n',
  );

  await relaunchChromeAndWaitReady(5_000);

  process.stderr.write(
    `==> Recovered: Chrome is foreground and listening again before "${testTitle}". Continuing.\n`,
  );
}
