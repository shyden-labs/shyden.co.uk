/**
 * The iPhone run's session (#859): finds the real iPhone, opens Safari on
 * `about:blank` with `devicectl`, attaches our own Web Inspector client
 * (`./inspector/`) to that page, asks the phone itself which of the Mac's
 * addresses it can reach, and hands the journeys a `PageDriver` on it.
 * Every precondition asserts its end state and throws a named cause.
 *
 * It replaced a `safaridriver` session (Shyden's ruling on #838, 2026-10-18):
 * Safari's automation mode holds the phone in Guided Access, which kills or
 * refuses WebDriverAgent, the taps #838 adds. Design:
 * docs/superpowers/specs/2026-10-31-ios-page-driving-design.md.
 *
 * Writes `test-results/ios-mode.json` for scripts/test-devices.mjs (the
 * parallel runner, `npm run test:devices`), which cannot see this process's
 * console output as data. Nothing outlives the process: the inspector's
 * sockets close with it, and the phone frees the page (measured 2026-10-26: a
 * second run attached 0.1 s after an exit that closed nothing).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { nodeDialer, openInspector, type Inspector } from './inspector/connect';
import { COMMAND_CEILING_MS } from './inspector/protocol';
import {
  describeInteractionMode,
  DomDispatchInteraction,
  type Interaction,
  type InteractionMode,
} from './interaction';
import { PageDriver, waitFor, type PageElement } from './page-driver';
import { themeColour } from '../../palette';
import {
  launchSafari,
  listDevices,
  pickIphone,
} from '../../../scripts/devicectl.mjs';

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
 * Runs through `executeAsyncScript` (page-driver.ts), not `executeScript`: a plain
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
  driver: PageDriver,
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
 * Runs once the inspector is attached: `deviceCanReach` asks the question
 * through the page, from `about:blank` (measured 2026-10-31: `opaque` from
 * both of the Mac's addresses).
 */
async function resolveReachableBaseUrl(
  driver: PageDriver,
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

// ── Artifacts for scripts/test-devices.mjs (the parallel runner) ─────────

/**
 * test-results/ already exists for Playwright's own artifacts and is
 * already gitignored -- this file is transient run output, not
 * committed source, and belong alongside it. Resolved relative to this
 * file's own location rather than `process.cwd()` so it does not matter
 * whether the caller is `npm run test:ios` (vitest's cwd) or the runner
 * (its own cwd) -- both land on the same real directory.
 */
const TEST_RESULTS_DIR = fileURLToPath(
  new URL('../../../test-results/', import.meta.url),
);
const MODE_FILE = `${TEST_RESULTS_DIR}ios-mode.json`;

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

// ── Public surface ──────────────────────────────────────────────────────

export interface DeviceSession {
  readonly driver: PageDriver;
  readonly baseUrl: string;
  readonly device: IosDevice;
  /**
   * How input reaches the page. `dom-dispatch` until #838 brings
   * WebDriverAgent's real taps; named in the run's output so a DOM-dispatch
   * run is never reported as taps.
   */
  readonly mode: InteractionMode;
  /** click/type/clear -- see interaction.ts. Journeys call only this, never `driver` directly for input. */
  readonly interaction: Interaction;
  /** Navigates to `path` on the real server and waits for the page to be interactive. */
  navigateToPath(path: string): Promise<void>;
  /** ALWAYS call this, in a `finally`: it detaches and closes every socket. */
  teardown(): Promise<void>;
}

/** The page Safari is opened on, before the phone has said which address it reaches. */
const START_PAGE = 'about:blank';

/** Opens Safari on the start page and attaches to it; the attached inspector, closed on any failure after. */
async function attachToSafari(device: IosDevice): Promise<Inspector> {
  launchSafari(device.udid, START_PAGE);
  const inspector = await openInspector({
    url: (url) => url === START_PAGE,
    expectedUdid: device.udid,
    dial: nodeDialer(),
  });
  try {
    await inspector.page.targetCreated(COMMAND_CEILING_MS);
  } catch (error) {
    inspector.close();
    throw error;
  }
  return inspector;
}

/** Runs every precondition in order, cheapest first, and returns a session ready for journeys. */
export async function startIosSession(): Promise<DeviceSession> {
  const device = findIosDevice();
  const inspector = await attachToSafari(device);
  const driver = new PageDriver(inspector.page);

  let resolved: { baseUrl: string; interfaceName: string; address: string };
  try {
    resolved = await resolveReachableBaseUrl(driver);
  } catch (error) {
    inspector.close();
    throw error;
  }

  const mode: InteractionMode = 'dom-dispatch';
  console.log(
    `\n${'='.repeat(70)}\n${describeInteractionMode(mode)}\n` +
      `[iOS reachable via] ${resolved.interfaceName} (${resolved.address})\n${'='.repeat(70)}\n`,
  );
  writeModeArtifact(mode, device);
  const interaction = new DomDispatchInteraction();
  const { baseUrl } = resolved;

  return {
    driver,
    baseUrl,
    device,
    mode,
    interaction,

    async navigateToPath(path: string): Promise<void> {
      // The palette is pinned per load (#142 §6.2), so no journey's result
      // depends on the phone's own appearance setting. Journeys do not
      // emulate media features yet (#870), so the lever is the one the page
      // itself honours: a saved choice, stamped on the origin BEFORE the
      // measured load, which the load then proves it rendered. Dark, the
      // palette every journey was written against.
      await driver.navigate(`${baseUrl}/`);
      await driver.executeScript("localStorage.setItem('theme', 'dark');");
      await driver.navigate(`${baseUrl}${path}`);
      const ground = await driver.executeScript<string>(
        'return getComputedStyle(document.documentElement).backgroundColor;',
      );
      if (ground !== themeColour('dark', '--bg'))
        throw new Error(
          `${path} rendered the ground ${ground}, not the dark theme's ` +
            `${themeColour('dark', '--bg')}: the stamped choice did not take`,
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
          const found = await driver.findElements('#cg-go');
          return found.length > 0 ? true : undefined;
        },
        {
          timeout: 15_000,
          describe: `#cg-go to exist after navigating to ${path}`,
        },
      );
    },

    async teardown(): Promise<void> {
      inspector.close();
    },
  };
}

export type { PageElement };
