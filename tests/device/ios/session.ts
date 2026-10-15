/**
 * iOS WebDriver session lifecycle: starts `safaridriver` on a free port,
 * finds the real device, creates the one WebDriver session the device
 * allows, asks the device itself which of the Mac's addresses it can
 * actually reach, asserts every precondition with a named cause, and tears
 * everything down again.
 *
 * See docs/superpowers/specs/2026-08-08-real-device-test-harness-design.md,
 * section 5, for why this exists instead of Playwright.
 *
 * "if (ok) { act() }" with no `else` is a known defect class on this
 * project -- every precondition below asserts its end state and throws a
 * specific, named cause rather than falling through silently.
 *
 * Also writes two small artifacts under test-results/ that
 * scripts/test-devices.mjs (the parallel runner, `npm run test:devices`)
 * reads, because neither fact is otherwise visible from outside this
 * process: which interaction mode the design doc s5a canary decided on this
 * run (`ios-mode.json`), and, while a session is genuinely open, enough to
 * delete it from another process if this one dies before `teardown()` runs
 * (`ios-session-marker.json`) -- see the "Artifacts for the runner" section
 * below. Both are inert when nothing reads them, so a plain `npm run
 * test:ios` is unaffected.
 */
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  createInteraction,
  describeInteractionMode,
  detectInteractionMode,
  type Interaction,
  type InteractionMode,
} from './interaction';
import { startServerProcess } from './server-process';
import {
  waitFor,
  WebDriver,
  WebDriverError,
  type WebElement,
} from './webdriver';
import { themeColour, type Theme } from '../../palette';
import { listDevices, pickIphone } from '../../../scripts/devicectl.mjs';

const DEV_SERVER_PORT = 4321;

// ── Precondition 1: the device is present ──────────────────────────────────

interface IosDevice {
  readonly udid: string;
  readonly name: string;
  readonly osVersion: string;
}

/**
 * Precondition 1: exactly one physical iPhone, per `xcrun devicectl list
 * devices`; `IOS_UDID` chooses among several. Read through
 * `scripts/devicectl.mjs`, the home the runner reads it through too: this
 * file used to carry its own copy of the parsing, which threw a bare TypeError
 * on a listing of another shape after the runner's copy had learned to name
 * it, and called devicectl with no deadline (#390).
 */
function findIosDevice(): IosDevice {
  const picked = pickIphone(listDevices(), process.env.IOS_UDID);
  if ('absence' in picked) throw new Error(picked.absence);
  return picked.device;
}

// ── Precondition 2: safaridriver started, answers GET /status ─────────────

/** Finds a free TCP port by asking the OS for one and releasing it immediately. */
async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(
          new Error(
            `expected net.Server#address() to return an AddressInfo after listen(0), got: ${JSON.stringify(address)}`,
          ),
        );
        return;
      }
      const { port } = address;
      server.close((closeErr) => {
        if (closeErr) reject(closeErr);
        else resolve(port);
      });
    });
  });
}

/**
 * Precondition 2: `safaridriver` starts and answers `GET /status`.
 *
 * Remote Automation is asserted to already be enabled (`safaridriver
 * --enable` already run) rather than run here -- this project does not
 * modify the phone's settings, provisioning or signing.
 */
async function startSafaridriver(port: number): Promise<ChildProcess> {
  return startServerProcess('safaridriver', ['-p', String(port)], {
    isReady: () => WebDriver.isReady(`http://127.0.0.1:${port}`),
    timeout: 15_000,
    describe: `safaridriver on port ${port} to answer GET /status with ready:true`,
  });
}

// ── Precondition 3: the PHONE, asked directly, can reach a Mac address ────

/**
 * One of the Mac's own non-internal IPv4 addresses, with the OS-assigned
 * name of the interface it lives on -- never a name or address this file
 * chose, only ever one `os.networkInterfaces()` reports right now.
 */
interface LanCandidate {
  readonly interfaceName: string;
  readonly address: string;
}

/**
 * Every non-internal IPv4 address this Mac currently has, on whatever
 * interface the OS currently gives it, in whatever order Node reports them.
 *
 * This project already hardcoded one interface name once and was wrong:
 * the task brief pinned `en0` ("derived at runtime via `ipconfig getifaddr
 * en0`"), and this file's own prior version fell back to an
 * `IOS_LAN_INTERFACE` environment variable (default `en0`) that had to be
 * passed by hand as `IOS_LAN_INTERFACE=en2` to work at all. Measured at the
 * time: `en0` (192.168.1.14, this Mac's Wi-Fi) was reachable from the Mac
 * itself but NOT from the phone -- Safari reported "can't open the page
 * because it couldn't connect to the server" while simultaneously loading
 * https://www.apple.com successfully, i.e. the phone had working internet
 * but was not on this Mac's Wi-Fi LAN. The address that WAS reachable came
 * from `en2`, a 169.254.x.x link-local address that only exists once the
 * iPhone is plugged in over USB -- and nothing guarantees that interface
 * keeps that name across a reboot, a different cable port, or a different
 * Mac entirely. There is therefore no name or address anywhere in this
 * file worth hardcoding, not even as a default: only the OS's own, current
 * interface list, asked fresh every run, and only the device's own answer
 * (`deviceCanReach`, below) about which of them it can use.
 */
function listCandidateAddresses(): readonly LanCandidate[] {
  const interfaces = networkInterfaces();
  const candidates: LanCandidate[] = [];
  for (const [interfaceName, addresses] of Object.entries(interfaces)) {
    for (const address of addresses ?? []) {
      // Node has shipped `family` as both the string `'IPv4'` and, briefly
      // behind a since-reverted flag, the number `4` across its history --
      // accepting either is cheap insurance against running on a Node that
      // disagrees with the one this was written against, and costs nothing
      // on one that doesn't.
      const isIPv4 =
        (address.family as string | number) === 'IPv4' ||
        (address.family as string | number) === 4;
      if (isIPv4 && !address.internal) {
        candidates.push({ interfaceName, address: address.address });
      }
    }
  }
  return candidates;
}

/** What the device reported after trying to reach one candidate address. */
interface ProbeOutcome {
  readonly ok: boolean;
  readonly reason?: string;
  readonly type?: string;
}

const PROBE_TIMEOUT_MS = 5_000;

/**
 * Asks the DEVICE ITSELF -- not the Mac -- whether it can reach `url`. This
 * is the fix's whole point: "the phone is the only authority on what it can
 * reach" (task brief). The Mac reaching its own address proves nothing
 * about whether the phone's radio or cable path can -- that one-way gap is
 * exactly what made `en0` look fine from the Mac while being unreachable
 * from the phone (see `listCandidateAddresses`'s comment).
 *
 * Runs over `execute/async` (webdriver.ts), not `execute/sync`: a plain
 * synchronous script cannot observe a `fetch()`'s outcome at all, since it
 * returns before the promise it starts has settled.
 *
 * `mode: 'no-cors'` is deliberate, not a leftover default. A same-shape
 * `fetch(url)` (the normal, 'cors', mode) cannot tell "nothing is listening
 * there" apart from "something IS listening there but sent no CORS
 * headers" -- both reject with the same generic network-error `TypeError`,
 * and this project's own preview server sends no CORS headers to anyone.
 * `no-cors` sidesteps that distinction entirely: the promise resolves the
 * moment any real HTTP transaction completes, whatever the response, and
 * rejects only on a genuine network failure -- which is exactly, and only,
 * the question this function needs answered. The response itself is
 * necessarily opaque in this mode (status always reads 0) and is not
 * inspected; reachability is the only thing being measured here. Verified
 * BOTH ways on this real device before this function was trusted: an
 * address the phone cannot route to reports `ok:false` (times out); one it
 * can reach reports `ok:true` -- against both a real candidate and a
 * deliberately-wrong one in the same subnet, so this is not just "always
 * true".
 */
async function deviceCanReach(
  driver: WebDriver,
  url: string,
): Promise<ProbeOutcome> {
  return driver.executeAsyncScript<ProbeOutcome>(
    `var url = arguments[0];
     var callback = arguments[arguments.length - 1];
     var settled = false;
     var timer = setTimeout(function () {
       if (settled) return;
       settled = true;
       callback({ ok: false, reason: 'timeout' });
     }, ${PROBE_TIMEOUT_MS});
     fetch(url, { mode: 'no-cors', cache: 'no-store' })
       .then(function (r) {
         if (settled) return;
         settled = true;
         clearTimeout(timer);
         callback({ ok: true, type: r.type });
       })
       .catch(function (e) {
         if (settled) return;
         settled = true;
         clearTimeout(timer);
         callback({ ok: false, reason: String((e && e.message) || e) });
       });`,
    [url],
  );
}

/**
 * Precondition 3 (rewritten): tries every IPv4 address the Mac currently
 * has, asking the PHONE to fetch each one, and uses the first the phone
 * itself confirms it can reach. Replaces both the task brief's original
 * `ipconfig getifaddr en0` and this file's own former `IOS_LAN_INTERFACE`
 * escape hatch -- neither is needed once the device is asked directly.
 *
 * Runs AFTER `createVerifiedSession` (unlike the old `deriveLanIp` /
 * `assertServerReachable`, which ran before any session existed):
 * `deviceCanReach` needs a live WebDriver session to ask the question
 * through at all.
 */
async function resolveReachableBaseUrl(
  driver: WebDriver,
): Promise<{ baseUrl: string; interfaceName: string; address: string }> {
  const candidates = listCandidateAddresses();
  if (candidates.length === 0) {
    throw new Error(
      'expected this Mac to have at least one non-internal IPv4 network interface -- ' +
        'os.networkInterfaces() reported none. Is networking (Wi-Fi, Ethernet, or the USB ' +
        'link-local interface the iPhone itself creates once plugged in) up at all?',
    );
  }

  const attempts: string[] = [];
  for (const candidate of candidates) {
    const url = `http://${candidate.address}:${DEV_SERVER_PORT}/classroom-groups`;
    const outcome = await deviceCanReach(driver, url);
    attempts.push(
      `${candidate.interfaceName} (${candidate.address}): ` +
        (outcome.ok
          ? `REACHABLE (fetch resolved, type=${outcome.type})`
          : `unreachable (${outcome.reason})`),
    );
    if (outcome.ok) {
      return {
        baseUrl: `http://${candidate.address}:${DEV_SERVER_PORT}`,
        interfaceName: candidate.interfaceName,
        address: candidate.address,
      };
    }
  }

  throw new Error(
    `expected the iPhone to reach this Mac's dev server on at least one of its ${candidates.length} ` +
      'non-internal IPv4 interface(s), asked directly of the device rather than assumed from the ' +
      `Mac's own point of view -- none worked. Tried:\n  ${attempts.join('\n  ')}\n` +
      'Is `npm run preview -- --host 0.0.0.0` running on this Mac, and is the phone on the same ' +
      'Wi-Fi network as it, or connected to it over USB?',
  );
}

// ── Precondition 4: the session was created against the intended UDID ─────

/**
 * `POST /session` can fail with `WebDriverError("session not created",
 * "Could not create a session: Some devices were found, but could not be
 * used: ...")` specifically when this runs CONCURRENTLY with the Android
 * group's own startup burst of `adb`/USB activity
 * (tests/device/android-preflight.setup.ts force-stops Brave, launches
 * Chrome, and polls for it going foreground, all within the first few
 * seconds of a run). Measured with a controlled A/B, not assumed: the
 * identical iOS run, same device, same code, same phone state (confirmed
 * awake and paired immediately beforehand both times) FAILED this way on
 * every attempt where `npm run test:devices` also ran the Android group,
 * and PASSED cleanly every time Android was absent from that same
 * invocation (`ANDROID_SERIAL` pointed at a non-existent serial) -- and it
 * has never failed this way standalone (`npm run test:ios`).
 *
 * This reads as USB/device-management contention on the Mac during the
 * first few seconds of a run, not a logic error, and the contention window
 * is short-lived (Android's own preflight finishes well within this
 * timeout) -- so session creation is retried, bounded, in the same
 * condition-based spirit as this file's `waitFor` (poll a real signal,
 * timeout is a safety net, never a blind sleep), but NOT through `waitFor`
 * itself. `waitFor` abandons a poll still pending at its deadline, which is
 * right for a read and wrong here: `POST /session` CREATES the one session
 * the phone allows, and an attempt abandoned mid-flight can still create
 * it, locking the next run out. So every attempt here runs to completion
 * (#309). A genuine, non-transient failure (wrong UDID, a real protocol
 * error) must fail on its FIRST attempt, not be retried for the full
 * timeout before finally surfacing: only the specific `"session not
 * created"` WebDriver error is treated as retryable; anything else
 * propagates immediately.
 */
async function createSessionWithRetry(
  port: number,
  device: IosDevice,
): Promise<WebDriver> {
  const timeoutMs = 20_000;
  const intervalMs = 1_000;
  const deadline = Date.now() + timeoutMs;
  const attempts: string[] = [];

  for (;;) {
    try {
      return await WebDriver.createSession(`http://127.0.0.1:${port}`, {
        browserName: 'safari',
        platformName: 'iOS',
        'safari:deviceUDID': device.udid,
      });
    } catch (error) {
      const retryable =
        error instanceof WebDriverError &&
        error.webDriverError === 'session not created';
      if (!retryable) throw error; // a real failure -- surface it immediately, do not retry

      attempts.push(error.message);
      if (Date.now() >= deadline) {
        throw new Error(
          `expected \`POST /session\` to succeed within ${timeoutMs}ms (retrying past the measured, ` +
            'short-lived USB contention window when the Android group starts concurrently) -- ' +
            `${attempts.length} attempt(s) all failed with "session not created". ` +
            `Last: ${attempts[attempts.length - 1]}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}

async function createVerifiedSession(
  port: number,
  device: IosDevice,
): Promise<WebDriver> {
  const driver = await createSessionWithRetry(port, device);

  const respondedUdid = driver.capabilities['safari:deviceUDID'];
  if (respondedUdid !== device.udid) {
    await driver.deleteSession().catch(() => {});
    throw new Error(
      `expected the session's safari:deviceUDID to echo the requested UDID ${device.udid} -- got ` +
        `${JSON.stringify(respondedUdid)}. A mismatch here means the session was NOT created against the ` +
        'intended real device -- a silently-substituted simulator would otherwise pass as one.',
    );
  }

  // Beyond the brief's own letter, at no extra cost: the response's own
  // `safari:useSimulator` field is a second, direct signal against the
  // exact failure the UDID check above already guards -- "a
  // silently-substituted simulator would otherwise pass as a real device"
  // (task brief, preflight step 4). Not that a simulator could plausibly
  // share a real device's UDID string; this simply reads a field already
  // present in the response and asserts it too.
  const useSimulator = driver.capabilities['safari:useSimulator'];
  if (useSimulator !== false) {
    await driver.deleteSession().catch(() => {});
    throw new Error(
      `expected the session's safari:useSimulator to be false -- got ${JSON.stringify(useSimulator)}. ` +
        'This session is not against the real device.',
    );
  }

  return driver;
}

// ── Artifacts for scripts/test-devices.mjs (the parallel runner) ─────────

/**
 * test-results/ already exists for Playwright's own artifacts and is
 * already gitignored -- these two files are transient run output, not
 * committed source, and belong alongside it. Resolved relative to this
 * file's own location rather than `process.cwd()` so it does not matter
 * whether the caller is `npm run test:ios` (vitest's cwd) or the runner
 * (its own cwd) -- both land on the same real directory.
 */
const TEST_RESULTS_DIR = fileURLToPath(
  new URL('../../../test-results/', import.meta.url),
);
const MODE_FILE = `${TEST_RESULTS_DIR}ios-mode.json`;
const SESSION_MARKER_FILE = `${TEST_RESULTS_DIR}ios-session-marker.json`;

/**
 * Design doc s5a's hard requirement, restated here: "the mode is named in
 * the suite's output... a DOM-dispatch run is never reported as though taps
 * were taps." The console banner below satisfies that for a human reading
 * this process's own output; this file satisfies it for
 * scripts/test-devices.mjs, which runs this suite as a child process and
 * cannot see that console output structured -- it needs the mode as data,
 * not text to scrape (the same reason Playwright groups get
 * `PLAYWRIGHT_JSON_OUTPUT_NAME` instead of parsed stdout). Written
 * unconditionally, not behind an opt-in flag: a file only the runner asks
 * for is a file a forgotten flag makes silently absent, which is exactly
 * the failure mode this whole mechanism exists to prevent.
 *
 * `description` carries the FULL rendered sentence from
 * `describeInteractionMode`, not just the bare `mode` value, and the runner
 * reads that field rather than re-deriving its own wording: the runner
 * cannot import this file's own `describeInteractionMode` call (plain Node
 * cannot load this module graph -- see `findIosDevice`'s own comment on
 * why), and hand-copying that sentence into a second file would let the two
 * drift the moment either one is edited. Writing the already-rendered
 * string here keeps it the one and only place this honesty-critical
 * wording is composed.
 */
function writeModeArtifact(mode: InteractionMode, device: IosDevice): void {
  mkdirSync(TEST_RESULTS_DIR, { recursive: true });
  writeFileSync(
    MODE_FILE,
    JSON.stringify(
      {
        mode,
        description: describeInteractionMode(mode),
        device: { name: device.name, osVersion: device.osVersion },
        decidedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

/**
 * "one leaked iOS session locks the phone out of every later run" (task
 * brief) -- iOS concurrency is exactly one session, by Apple's design (see
 * this file's module doc). `teardown()` below already deletes the session
 * in the common case; this marker is the fallback for the uncommon one --
 * this process crashing, or being killed, before `teardown()` runs at all.
 * scripts/test-devices.mjs checks for this file in its own top-level
 * `finally` and, if it is still there after this process has exited,
 * deletes the session itself and kills whatever is listening on the
 * recorded safaridriver port -- by port, the same mechanism the runner
 * already uses for the preview server, never by matching a process name or
 * command line.
 */
function writeSessionMarker(port: number, sessionId: string): void {
  mkdirSync(TEST_RESULTS_DIR, { recursive: true });
  writeFileSync(SESSION_MARKER_FILE, JSON.stringify({ port, sessionId }));
}

/** Only ever removed after the session it describes is confirmed gone. */
function clearSessionMarker(): void {
  if (existsSync(SESSION_MARKER_FILE)) unlinkSync(SESSION_MARKER_FILE);
}

/**
 * Lets go of a session that exists: every path out of `startIosSession` once a
 * session is created, and `teardown()`, end through here (#390).
 *
 * HARD rule: always DELETE /session/{id}, or the next run is locked out -- iOS
 * concurrency is exactly one session, by Apple's design. The marker is cleared
 * only on a CONFIRMED delete: if the delete fails, it deliberately survives
 * this process, so scripts/test-devices.mjs's fallback cleanup still finds the
 * session and finishes the job. The two failure paths in `startIosSession`
 * used to clear it whatever the delete did. safaridriver is stopped last
 * whatever happens, and only once the delete has its answer, since
 * safaridriver is the server answering it.
 */
export async function endSession(
  driver: Pick<WebDriver, 'deleteSession'>,
  child: Pick<ChildProcess, 'kill'>,
  clearMarker: () => void = clearSessionMarker,
): Promise<{ deleted: true } | { deleted: false; error: unknown }> {
  try {
    try {
      await driver.deleteSession();
    } catch (error) {
      // eslint-disable-next-line no-console -- a failed delete is reported, and the marker is what acts on it
      console.error(
        'Failed to delete the WebDriver session (stopping safaridriver; the marker stays for the runner to finish the job):',
        error,
      );
      return { deleted: false, error };
    }
    clearMarker();
    return { deleted: true };
  } finally {
    child.kill();
  }
}

// ── Public surface ──────────────────────────────────────────────────────

export interface DeviceSession {
  readonly driver: WebDriver;
  readonly baseUrl: string;
  readonly device: IosDevice;
  /**
   * Design doc s5a: decided once per run by a canary, never assumed.
   * `interaction.mode` carries the same value -- both are exposed because
   * journeys read `interaction` to act, and the mode alone is what a
   * report/log line needs to name.
   */
  readonly mode: InteractionMode;
  /** click/type/clear, mode-agnostic -- see interaction.ts. Journeys call only this, never `driver` directly for input. */
  readonly interaction: Interaction;
  /**
   * Navigates to `path` on the real server and waits for `ready` to exist:
   * `#cg-go` by default, the tool page every grouping journey drives; a
   * journey on another page names an element that page renders (#800).
   * `theme` is the saved choice stamped before the load: dark by default.
   */
  navigateToPath(path: string, ready?: string, theme?: Theme): Promise<void>;
  /** ALWAYS call this, in a `finally` -- see this file's module doc. */
  teardown(): Promise<void>;
}

/**
 * Runs every precondition in order (cheapest, most-likely-to-fail first: no
 * value starting safaridriver if there is no device to ask), then the
 * design doc s5a canary, then returns a session ready for journeys to
 * drive.
 *
 * Order differs from the task brief's original listing in one deliberate
 * way: session creation now happens BEFORE LAN address resolution, not
 * after. `resolveReachableBaseUrl` asks the device itself which address
 * reaches it, which needs a live WebDriver session to ask the question
 * through (`execute/async`) -- there is no way to ask the phone anything
 * before a session exists.
 */
export async function startIosSession(): Promise<DeviceSession> {
  // A marker from a process that crashed before reaching `teardown()` would
  // otherwise outlive its own session indefinitely (safaridriver, and the
  // real WebDriver session, are both long gone by the time anyone reads a
  // stale file) -- cleared at the start of every attempt, not just on a
  // successful one, so scripts/test-devices.mjs is never told about a
  // session this run has not created yet.
  clearSessionMarker();

  const device = findIosDevice(); // 1: device present

  const port = await pickFreePort();
  const child = await startSafaridriver(port); // 2: safaridriver + /status

  let driver: WebDriver;
  try {
    driver = await createVerifiedSession(port, device); // 3: session + UDID match
  } catch (error) {
    child.kill();
    throw error;
  }
  // From this point on a real session exists and MUST be deleted by
  // whichever path leaves this function, successful or not -- recorded
  // immediately, before anything else that could throw, so
  // scripts/test-devices.mjs can still find and close it even if this
  // process is killed one line further down.
  writeSessionMarker(port, driver.sessionId);

  let resolved: { baseUrl: string; interfaceName: string; address: string };
  try {
    resolved = await resolveReachableBaseUrl(driver); // 4: the phone picks the address
  } catch (error) {
    await endSession(driver, child);
    throw error;
  }

  let mode: InteractionMode;
  try {
    mode = await detectInteractionMode(driver); // design doc s5a: the canary
  } catch (error) {
    await endSession(driver, child);
    throw error;
  }
  // HARD requirement (design doc s5a): "The mode is named in the suite's
  // output... a DOM-dispatch run is never reported as though taps were
  // taps." Logged the moment it is known, before any journey runs, so it
  // is the first thing visible about this run regardless of which test
  // the reader scrolls to. Also written to disk (see writeModeArtifact's
  // own doc) so scripts/test-devices.mjs can report it honestly too, not
  // just this process's own console.
  // eslint-disable-next-line no-console -- this is the required, deliberate mode announcement, not incidental debug output
  console.log(
    `\n${'='.repeat(70)}\n${describeInteractionMode(mode)}\n` +
      `[iOS reachable via] ${resolved.interfaceName} (${resolved.address})\n${'='.repeat(70)}\n`,
  );
  writeModeArtifact(mode, device);
  const interaction = createInteraction(driver, mode);

  const baseUrl = resolved.baseUrl;

  return {
    driver,
    baseUrl,
    device,
    mode,
    interaction,

    async navigateToPath(
      path: string,
      ready = '#cg-go',
      theme: Theme = 'dark',
    ): Promise<void> {
      // The palette is pinned per load (#142 §6.2), so no journey's result
      // depends on the phone's own appearance setting. WebDriver cannot
      // emulate a media feature on Safari, so the lever is the one the page
      // itself honours: a saved choice, stamped on the origin BEFORE the
      // measured load, which the load then proves it rendered. Dark unless
      // a journey asks for light (#800's mirrors of Android's per-theme tests).
      await driver.navigate(`${baseUrl}/`);
      await driver.executeScript(
        'localStorage.setItem("theme", arguments[0]);',
        [theme],
      );
      await driver.navigate(`${baseUrl}${path}`);
      // The page must BE the requested one before anything is read from it:
      // after a journey followed an in-page link (the skip link's `#main`),
      // a navigation returned with Classroom Groups still loaded, and the
      // 404's heading test read that page's h1 (#800, measured on the phone).
      const wanted = new URL(path, `${baseUrl}/`).pathname;
      await waitFor(
        async () => {
          const at = await driver.executeScript<string>(
            'return location.pathname;',
          );
          return at === wanted ? true : undefined;
        },
        {
          timeout: 15_000,
          describe: `the page at ${wanted} to be the one loaded`,
        },
      );
      const ground = await driver.executeScript<string>(
        'return getComputedStyle(document.documentElement).backgroundColor;',
      );
      if (ground !== themeColour(theme, '--bg'))
        throw new Error(
          `${path} rendered the ground ${ground}, not the ${theme} theme's ` +
            `${themeColour(theme, '--bg')}: the stamped choice did not take`,
        );
      // The page's own module script (src/scripts/classroom-groups.ts) is a
      // deferred `type="module"`. `navigate` is specified to block until the
      // load event, which this project has measured to hold in practice
      // (document.readyState was already "complete" immediately after
      // `navigate` returned, on a live check) -- but every journey needs
      // #cg-go to exist regardless, so waiting for it here is a
      // condition-based readiness gate rather than trusting that timing
      // assumption implicitly at every call site.
      await waitFor(
        async () => {
          const found = await driver.findElements(ready);
          return found.length > 0 ? true : undefined;
        },
        {
          timeout: 15_000,
          describe: `${ready} to exist after navigating to ${path}`,
        },
      );
    },

    async teardown(): Promise<void> {
      await endSession(driver, child);
    },
  };
}

/**
 * Design doc s5a's own requirement, restated at the point every reader
 * actually looks: the top of each test's own output, not only once at
 * session start. `session.mode` is read at the call, because it is only
 * known once `beforeAll` has resolved. One home for every journey file.
 */
export function announceMode(
  session: DeviceSession,
  journeyName: string,
): void {
  // eslint-disable-next-line no-console -- the required per-test mode announcement, not incidental debug output
  console.log(`  [mode: ${session.mode}] ${journeyName}`);
}

export type { WebElement };
