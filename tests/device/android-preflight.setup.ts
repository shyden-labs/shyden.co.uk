import { adb, androidAbsence } from '../../scripts/adb.mjs';
import { test, expect } from '@playwright/test';
import {
  CHROME_PACKAGE,
  DEVTOOLS_SOCKET,
  currentFocusLines,
  devToolsSockets,
} from './chrome-foreground';

/**
 * Runs before the `android-chrome` project (wired via `dependencies` in
 * playwright.device.config.ts) and establishes, then asserts, every precondition the real
 * device needs. Each precondition is its own test with a written-out failure message, so a
 * red run names its cause instead of surfacing as a generic downstream timeout -- see
 * docs/superpowers/specs/2026-08-08-real-device-test-harness-design.md ("Preconditions are
 * asserted, never assumed").
 *
 * These tests use no Playwright browser/context/page fixture: they talk to the device only
 * through `adb` and a plain HTTP request, because the thing being verified here is whether a
 * browser can be reached at all.
 *
 * Serial mode: order matters (Brave must be stopped before Chrome is asserted foreground;
 * the tunnels must be mapped before the CDP endpoint is asked to answer), and there is no
 * value in running precondition 4 once precondition 1 has already shown there is no device to
 * ask.
 */
test.describe.configure({ mode: 'serial' });

test.describe('android device preflight', () => {
  // The same decision the runner made before starting this project, from the
  // same function: one ready phone, or the one ANDROID_SERIAL names among
  // several. adb itself targets ANDROID_SERIAL for every later call here.
  test('1. adb sees exactly one device to drive, ready', () => {
    expect(
      androidAbsence(adb(['devices']), process.env.ANDROID_SERIAL),
      'why no Android phone can be driven',
    ).toBeNull();
  });

  test('2. the screen is awake and unlocked', () => {
    const power = adb(['shell', 'dumpsys', 'power']);
    expect(
      power,
      "expected `dumpsys power` to report mWakefulness=Awake -- the phone's screen is " +
        'asleep; wake it and keep it awake before running the device suite',
    ).toContain('mWakefulness=Awake');

    // KeyguardStateMonitor.mIsShowing is Android's own signal for "the lock screen is
    // currently showing". Confirmed present exactly once in `dumpsys window policy` on this
    // device, so a plain substring match is unambiguous.
    const policy = adb(['shell', 'dumpsys', 'window', 'policy']);
    expect(
      policy,
      'expected KeyguardStateMonitor.mIsShowing=false in `dumpsys window policy` -- the ' +
        'phone is locked; unlock it before running the device suite',
    ).toContain('mIsShowing=false');
  });

  test('3. Chrome is launched and is the foreground app', async () => {
    // A leftover Brave in the foreground is what caused 30s click timeouts during design-doc
    // measurement (rendering freezes in a backgrounded app; Playwright's actionability check
    // waits for a stable bounding box and never gets one). Force-stop it before launching
    // Chrome so this precondition cannot pass by accident.
    adb(['shell', 'am', 'force-stop', 'com.brave.browser']);

    // Chrome is force-stopped too, so every run launches it COLD (#307). Whether Chrome
    // happened to be running used to decide precondition 4: a warm Chrome already had its
    // DevTools socket, a cold one opens it about 200ms after taking the foreground, and a
    // single read missed it 3 times in 3. With the cold path the only path, precondition 4's
    // wait is exercised on every run, and a regression to a single read fails every run
    // rather than only on the days the phone had reclaimed Chrome.
    adb(['shell', 'am', 'force-stop', CHROME_PACKAGE]);

    // Proven, not assumed: the stopped Chrome's socket must be gone before the launch, or
    // precondition 4 could be satisfied by it. This absence check cannot pass on a reader
    // that sees nothing at all, because precondition 4 must find the socket through the SAME
    // reader moments later.
    await expect
      .poll(devToolsSockets, {
        message:
          `expected ${DEVTOOLS_SOCKET} to be gone within 5s of force-stopping Chrome -- ` +
          'without that, the launch below is not a cold one',
        timeout: 5_000,
      })
      .not.toContain(DEVTOOLS_SOCKET);

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

    // `dumpsys window` prints more than one mCurrentFocus line (one is routinely `null`), so
    // this polls the whole set rather than trusting the first match. Condition-based wait, not
    // a blind sleep: a cold launch can take longer than the very next `adb` round-trip.
    await expect
      .poll(currentFocusLines, {
        message:
          'expected one of the mCurrentFocus lines in `dumpsys window` to name ' +
          `${CHROME_PACKAGE} within 5s of \`am start\` -- Chrome did not become the ` +
          'foreground app, which is the single most expensive failure mode this preflight ' +
          'exists to catch (it otherwise presents as a bare 30s click timeout)',
        timeout: 5_000,
      })
      .toContain(CHROME_PACKAGE);
  });

  test('4. the Chrome DevTools abstract socket exists', async () => {
    // Polled, never read once (#307): Chrome takes the foreground BEFORE its DevTools server
    // listens -- about 200ms before, on the cold launch precondition 3 forces every run -- so
    // a single read straight after precondition 3 misses the socket on every cold start.
    await expect
      .poll(devToolsSockets, {
        message:
          `expected ${DEVTOOLS_SOCKET} among the DevTools sockets in /proc/net/unix within 10s ` +
          'of Chrome taking the foreground -- Chrome opens it once its DevTools server is ' +
          'listening, and only while USB debugging is enabled. The received list is every ' +
          'DevTools socket that WAS listening; empty means none at all',
        timeout: 10_000,
      })
      .toContain(DEVTOOLS_SOCKET);
  });

  test('5. adb forward and reverse tunnels are mapped', () => {
    adb(['forward', 'tcp:9222', 'localabstract:chrome_devtools_remote']);
    adb(['reverse', 'tcp:4321', 'tcp:4321']);

    const forwardList = adb(['forward', '--list']);
    const reverseList = adb(['reverse', '--list']);

    expect(
      forwardList,
      "expected `adb forward --list` to map tcp:9222 to the device's chrome_devtools_remote " +
        `socket; got: ${forwardList.trim() || '(empty)'}`,
    ).toContain('tcp:9222 localabstract:chrome_devtools_remote');

    expect(
      reverseList,
      "expected `adb reverse --list` to map tcp:4321 to tcp:4321, so the device's " +
        `localhost:4321 reaches the Mac's dev server; got: ${reverseList.trim() || '(empty)'}`,
    ).toContain('tcp:4321 tcp:4321');
  });

  test('6. the CDP endpoint answers and reports Chrome', async () => {
    const response = await fetch('http://127.0.0.1:9222/json/version');
    expect(
      response.ok,
      `expected HTTP 200 from http://127.0.0.1:9222/json/version over the forwarded tunnel; ` +
        `got HTTP ${response.status}`,
    ).toBe(true);

    const body = await response.json();
    expect(
      body.Browser,
      "expected the CDP /json/version response's 'Browser' field to name Chrome; got: " +
        JSON.stringify(body),
    ).toContain('Chrome');
  });
});
