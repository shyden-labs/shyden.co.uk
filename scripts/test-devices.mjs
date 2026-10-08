#!/usr/bin/env node
/**
 * `npm run test:devices` -- one build, one shared server, three device
 * groups at once: the existing emulated Playwright suite (5 projects), the
 * real Android phone over CDP, and the real iPhone over WebDriver. See
 * docs/superpowers/specs/2026-08-08-real-device-test-harness-design.md,
 * section 7 ("Parallelism"), for the shape this implements:
 *
 *   build once -> serve dist on 0.0.0.0:4321 -> desktop   (5 projects)   N workers
 *                                             -> android   (real Chrome)  1 worker
 *                                             -> ios       (real Safari)  1 session
 *
 * Desktop, Android and iOS are independent hardware and should not fight
 * each other for port 4321 or rebuild the site three times -- this script
 * builds and serves exactly once, proves the result is a genuinely fresh
 * build (not something already listening on 4321 left over from a previous
 * run), and only then hands all three groups `PW_REUSE_SERVER=1` so their
 * own `webServer` blocks adopt the already-running server instead of
 * starting their own.
 *
 * WHY THE ANDROID GROUP DOES NOT re-implement Brave-stopping, Chrome-
 * launching, or the adb forward/reverse tunnels here, even though the task
 * brief's own step 3 lists exactly those actions: `playwright.device.config.ts`
 * already runs `tests/device/android-preflight.setup.ts` as a project
 * DEPENDENCY of `android-chrome`, and that file already does precisely this
 * (Task 1, shipped and reviewed) -- every time `android-chrome` is asked
 * for, Playwright runs `android-preflight` first, automatically. Re-doing
 * the same adb calls here, moments before Playwright does them again
 * itself, would be redundant, a second place for this logic to drift from
 * the first, and no more correct. This script's own job for Android is
 * narrower: decide whether to attempt the group at all (a device must be
 * physically present), free the ONE port every group shares, and interpret
 * the result honestly.
 *
 * HARD RULES this file exists to satisfy (task brief + project standards):
 *  - Every child process's exit code is read directly off that child's own
 *    `close` event. Nothing is ever piped into another command -- a pipe
 *    reports the LAST command's exit status, which has silently turned red
 *    runs green on this project before.
 *  - No sleeps. Every wait (`waitUntil`) polls a real condition with a
 *    bounded timeout; the clock is a safety net, never the success signal.
 *  - Servers are killed BY PORT (`lsof -nP -iTCP:<port> -sTCP:LISTEN -t`),
 *    never `pkill -f`, which would just as easily match this script's own
 *    waiters.
 *  - A device that is not physically present is reported as NOT RUN, never
 *    silently omitted and never counted as passed -- see `isAndroidPresent`
 *    and `isIosPresent`, and the overall exit-code rule at the end of
 *    `main()` (any `not-run` group fails the whole run, same as a real
 *    failure would).
 *  - Cleanup (preview server, adb tunnels, any live iOS WebDriver session)
 *    always runs, via `finally` and a signal handler -- see `cleanup()`.
 */
import { execFileSync, spawn } from 'node:child_process';
import { constants } from 'node:os';
import { die, messageOf } from './errors.mjs';
import { adb, androidAbsence } from './adb.mjs';
import { listDevices, pickIphone } from './devicectl.mjs';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 4321;
const TEST_RESULTS_DIR = path.join(ROOT, 'test-results');
export const IOS_MODE_FILE = path.join(TEST_RESULTS_DIR, 'ios-mode.json');
const IOS_SESSION_MARKER_FILE = path.join(
  TEST_RESULTS_DIR,
  'ios-session-marker.json',
);

/**
 * Each group's machine-readable report, named once.
 *
 * Spelled in two places while #230 was being written -- where the group
 * writes it, and where the run clears it -- which is the duplication #227
 * had just finished removing from this very file.
 */
export const REPORT_FILES = {
  desktop: path.join(TEST_RESULTS_DIR, 'desktop-report.json'),
  android: path.join(TEST_RESULTS_DIR, 'android-report.json'),
  ios: path.join(TEST_RESULTS_DIR, 'ios-report.json'),
};

// ── the live dashboard (task 6) ─────────────────────────────────────────
//
// scripts/dashboard.mjs is a SEPARATE process, spawned detached so it
// outlives this one ("keep the server alive after the run so the final
// state stays readable" -- task brief step 2). Everything here is
// artifact files on disk, the same mechanism this file already uses for
// ios-mode.json / ios-session-marker.json: this script writes small JSON
// facts the dashboard polls for, and points each test child at its own
// JSONL file via env vars the two reporters
// (tests/reporters/jsonl-reporter.ts, tests/reporters/jsonl-vitest.ts)
// read. None of this can affect a test outcome -- see this file's own
// startDashboard() for the "never throws, only warns" contract.
//
// DASHBOARD_STATE_DIR is deliberately its OWN directory, NOT a path under
// TEST_RESULTS_DIR -- proven live, not assumed: `npx playwright test`
// recursively WIPES its entire `outputDir` (default: test-results/,
// neither playwright.config.ts nor playwright.device.config.ts overrides
// it) at the start of every invocation, unconditionally, not scoped to its
// own artifacts. Desktop and Android are two CONCURRENT such invocations
// sharing that one directory; a first version of this file put the jsonl
// files there too, and a real run showed the predictable result --
// desktop's and iOS's jsonl files were silently never written (an early
// write racing a sibling's startup wipe permanently disables that
// reporter instance, per its own "log once, then go quiet" failure mode),
// and even the pre-existing per-group `*-report.json` files and
// `ios-mode.json` were gone by the end of the run, though harmlessly so
// FOR THOSE, because each is read immediately after its own write, in the
// same async continuation, before any later wipe has a chance to land --
// timing this file's existing logic already depended on, whether or not
// that dependency was ever named before now. That narrower, pre-existing
// exposure (nothing this task introduced) is left alone rather than
// fixed here -- moving Playwright's own outputDir, or session.ts's own
// artifact location, is a bigger, separate change than "add a dashboard."
// A live, long-running, cross-process tail (what the dashboard
// fundamentally is) cannot rely on that same lucky timing, so its own
// files live somewhere Playwright has no reason to ever touch.
const DASHBOARD_PORT = 4322;
const DASHBOARD_STATE_DIR = path.join(ROOT, 'dashboard-state');
const DASHBOARD_GROUPS_FILE = path.join(DASHBOARD_STATE_DIR, 'groups.json');
const DASHBOARD_FINAL_FILE = path.join(DASHBOARD_STATE_DIR, 'final.json');

/**
 * Everything a run clears before it starts, named once and exported so a test
 * can assert what is in it.
 *
 * The three reports are here because `test-results/` stopped being anybody's
 * `outputDir` in #230, so nothing wipes it any more. A group that died before
 * writing its report would otherwise leave the PREVIOUS run's report to be
 * read as this run's, and a stale green is worse than a missing file. Proved
 * necessary by mutation: with the reports removed from this list, the whole
 * unit suite stayed green, so the property had no guard at all until one was
 * written against this constant.
 */
export const RUN_START_CLEARED = [
  DASHBOARD_GROUPS_FILE,
  DASHBOARD_FINAL_FILE,
  IOS_MODE_FILE,
  ...Object.values(REPORT_FILES),
];
const DASHBOARD_LOG_FILE = path.join(DASHBOARD_STATE_DIR, 'dashboard.log');
const DASHBOARD_JSONL_FILE = {
  desktop: path.join(DASHBOARD_STATE_DIR, 'desktop.jsonl'),
  android: path.join(DASHBOARD_STATE_DIR, 'android.jsonl'),
  ios: path.join(DASHBOARD_STATE_DIR, 'ios.jsonl'),
};

/** The live files scripts/dashboard.mjs reads, named once for both processes. */
export const DASHBOARD_FILES = {
  groups: DASHBOARD_GROUPS_FILE,
  final: DASHBOARD_FINAL_FILE,
  jsonl: DASHBOARD_JSONL_FILE,
};
// Imported by scripts/dashboard.mjs, which checks for `<dir>/index.html`
// under these two directories to show a report link. Only desktop/android are Playwright; iOS is a Vitest
// run and has no HTML report to link to.
export const REPORT_DIR = {
  desktop: path.join(ROOT, 'playwright-report', 'desktop'),
  android: path.join(ROOT, 'playwright-report', 'android'),
};

// ── small generic helpers ──────────────────────────────────────────────

/**
 *  Polls `predicate` until truthy, or throws naming what was awaited. Never a sleep-and-hope: the condition itself decides, the timeout is only a safety net against a hung device or process.
 *
 * @param {() => unknown} predicate its RESULT is read for truthiness, so a
 *   predicate answering a `Response` or `undefined` is as valid as a boolean.
 * @param {{ timeoutMs: number, describe: string, intervalMs?: number }} options
 */
export async function waitUntil(
  predicate,
  { timeoutMs, describe, intervalMs = 250 },
) {
  const deadline = Date.now() + timeoutMs;
  const timedOut = () =>
    new Error(`Timed out after ${timeoutMs}ms waiting for: ${describe}`);
  for (;;) {
    // Raced against the time left, not only checked once an answer arrives: a
    // request a half-open server accepts and never answers would otherwise
    // hold this loop past any timeout (measured: still waiting at 2s on a
    // 100ms timeout, #390).
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const result = await Promise.race([
      predicate(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(timedOut()),
          Math.max(0, deadline - Date.now()),
        );
      }),
    ]).finally(() => clearTimeout(timer));
    if (result) return result;
    if (Date.now() >= deadline) throw timedOut();
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 *  Splits a child's stdout/stderr into lines and forwards each, tagged, to this process's own streams -- live, not batched at the end, so a human watching a multi-minute group still sees progress.
 *
 * @param {string} tag
 * @param {import('node:child_process').ChildProcess} child
 */
function tagOutput(tag, child) {
  /**
   * @param {import('node:stream').Readable | null} stream
   * @param {NodeJS.WriteStream} out
   */
  const forward = (stream, out) => {
    // `stdout`/`stderr` are nullable on a ChildProcess: a stdio slot the
    // spawn did not create is simply absent, and nothing here creates one.
    if (!stream) return;
    let buffer = '';
    stream.on('data', (/** @type {Buffer | string} */ data) => {
      buffer += data.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) out.write(`[${tag}] ${line}\n`);
    });
    stream.on('end', () => {
      if (buffer.length > 0) out.write(`[${tag}] ${buffer}\n`);
    });
  };
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);
}

/**
 *  Spawns without a shell (array-form argv, never a pipe) and returns the live child immediately -- for long-running processes (the preview server) the caller needs a handle to, not a settled result.
 *
 * @param {string} tag
 * @param {string} command
 * @param {readonly string[]} args
 * @param {{ env?: NodeJS.ProcessEnv, cwd?: string }} [options]
 */
function spawnTagged(tag, command, args, { env, cwd = ROOT } = {}) {
  const child = spawn(command, args, {
    cwd,
    env: env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  tagOutput(tag, child);
  return child;
}

/**
 *  Resolves with the exit code read DIRECTLY off this exact child's own `close` event -- never scraped from stdout, never inferred from a pipe's own status.
 *
 * @param {import('node:child_process').ChildProcess} child
 * @param {string} command
 * @param {readonly string[]} args
 */
function waitForClose(child, command, args) {
  return new Promise((resolve, reject) => {
    child.once('error', (/** @type {unknown} */ err) =>
      reject(
        new Error(
          `failed to start \`${command} ${args.join(' ')}\`: ${messageOf(err)}`,
          {
            cause: err,
          },
        ),
      ),
    );
    child.once(
      'close',
      (
        /** @type {number | null} */ code,
        /** @type {NodeJS.Signals | null} */ signal,
      ) => resolve({ code, signal }),
    );
  });
}

/**
 *  spawnTagged + waitForClose, for one-shot commands this script needs the real outcome of before moving on.
 *
 * @param {string} tag
 * @param {string} command
 * @param {readonly string[]} args
 * @param {{ env?: NodeJS.ProcessEnv, cwd?: string }} [opts]
 */
async function runTagged(tag, command, args, opts) {
  const child = spawnTagged(tag, command, args, opts);
  return waitForClose(child, command, args);
}

/**
 * @param {string} file
 * @param {string} description
 */
function readJson(file, description) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(
      `expected to read ${description} at ${path.relative(ROOT, file)}: ${messageOf(error)}`,
    );
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `expected ${description} at ${path.relative(ROOT, file)} to be valid JSON: ${messageOf(error)}`,
    );
  }
}

// ── port ownership: kill by port, never by process-name pattern ────────

/** @param {number} port */
export function pidsListeningOnPort(port) {
  try {
    const out = execFileSync(
      'lsof',
      ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'],
      { encoding: 'utf8' },
    );
    return out
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number);
  } catch (error) {
    // `lsof` exits 1 with empty stdout when nothing matches the filter --
    // that is "port is free", not a real error. Anything else (lsof
    // missing, a permissions problem) is a genuine failure and must not be
    // swallowed into a false "free".
    const spawned = /** @type {{ status?: unknown, stdout?: unknown }} */ (
      error
    );
    if (spawned.status === 1 && !spawned.stdout) return [];
    throw error;
  }
}

/**
 * Kills whatever is LISTENING on `port`, identified only by that -- never
 * `pkill -f` matching a command-line pattern, which would just as easily
 * catch this very script's own `waitUntil` polling loops (this project has
 * been burned by exactly that pattern before). SIGTERM first, escalating
 * to SIGKILL only if the port is still occupied after a grace period.
 * Idempotent: does nothing, successfully, if the port is already free.
 *
 *  @param {number} port
 */
export async function killByPort(port) {
  let pids = pidsListeningOnPort(port);
  if (pids.length === 0) return;
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already gone between the lsof snapshot and this kill -- fine.
    }
  }
  try {
    await waitUntil(() => pidsListeningOnPort(port).length === 0, {
      timeoutMs: 10_000,
      describe: `port ${port} to become free after SIGTERM`,
    });
  } catch {
    pids = pidsListeningOnPort(port);
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already gone -- fine.
      }
    }
    await waitUntil(() => pidsListeningOnPort(port).length === 0, {
      timeoutMs: 5_000,
      describe: `port ${port} to become free after SIGKILL`,
    });
  }
}

/**
 * @param {string} url
 * @param {{ timeoutMs: number, describe: string }} options
 */
async function waitForHttpOk(url, { timeoutMs, describe }) {
  return waitUntil(
    async () => {
      try {
        const response = await fetch(url);
        return response.ok ? response : undefined;
      } catch {
        return undefined;
      }
    },
    { timeoutMs, describe },
  );
}

/**
 * In-memory map, mirrored to DASHBOARD_GROUPS_FILE on every write. An
 * in-memory object mutated synchronously (never read-modify-write off
 * disk) is what makes this race-free against runAndroidGroup and
 * runIosGroup each writing their own key independently -- there is no
 * window where one write can clobber the other's, because there is no
 * read step to race against.
 */
const dashboardGroupsState = {};
/**
 * @param {string} name
 * @param {string} reason
 */
function writeDashboardNotRun(name, reason) {
  /** @type {Record<string, unknown>} */ (dashboardGroupsState)[name] = {
    notRun: { reason },
  };
  try {
    writeFileSync(DASHBOARD_GROUPS_FILE, JSON.stringify(dashboardGroupsState));
  } catch (error) {
    process.stderr.write(
      `warning: failed to write the dashboard's not-run marker for "${name}": ${messageOf(error)} -- the ` +
        'dashboard (if running) may not show this group as NOT RUN; the test run itself is unaffected.\n',
    );
  }
}

/**
 * Writes the authoritative end-of-run verdict for the dashboard to
 * override its own live-tallied counts with -- see the call sites' own
 * comments. Best-effort and silent-but-visible on failure, same
 * discipline as writeDashboardNotRun: this is reporting about a run that
 * has (in the success path) already fully completed, so a failure here
 * must never be allowed to look like a test failure.
 *
 *  @param {Record<string, unknown>} payload
 */
function writeDashboardFinal(payload) {
  try {
    writeFileSync(DASHBOARD_FINAL_FILE, JSON.stringify(payload));
  } catch (error) {
    process.stderr.write(
      `warning: failed to write the dashboard's final-state artifact: ${messageOf(error)} -- the dashboard ` +
        '(if running) may keep showing live-tallied counts instead of the authoritative result; the ' +
        'terminal summary below (and the exit code) are unaffected.\n',
    );
  }
}

/**
 * Starts scripts/dashboard.mjs as an independent, detached process -- see
 * this file's own "the live dashboard" module comment for why it must
 * outlive this script. HARD requirement (task brief step 3): a dashboard
 * that fails to start, or throws once running, must never fail this run --
 * every failure path here WARNS and returns, never throws.
 *
 * stdio goes to a FILE, not a pipe: a piped child that is meant to
 * outlive its parent gets EPIPE the moment the parent's own file
 * descriptors close on exit -- the standard, documented reason a
 * `detached: true` child that must survive needs `stdio` pointed at
 * something other than 'pipe'. It also keeps the dashboard's own console
 * output out of the three-child interleaved terminal stream this whole
 * feature exists to make readable in the first place.
 */
async function startDashboard() {
  process.stdout.write('==> Starting the live dashboard...\n');
  let logFd;
  try {
    logFd = openSync(DASHBOARD_LOG_FILE, 'w');
  } catch (error) {
    process.stderr.write(
      `==> Dashboard failed to start (could not open ${path.relative(ROOT, DASHBOARD_LOG_FILE)}): ` +
        `${messageOf(error)} -- continuing WITHOUT the live dashboard; the run itself is unaffected.\n`,
    );
    return;
  }

  let child;
  try {
    child = spawn('node', ['scripts/dashboard.mjs'], {
      cwd: ROOT,
      env: process.env,
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });
  } finally {
    closeSync(logFd); // the child holds its own duplicated fd; this process's copy is no longer needed
  }
  child.unref(); // must not keep this process's event loop alive, and must not die when this process exits

  /** @type {{ message: string } | null} */
  let exitedEarly = null;
  child.once('error', (err) => {
    exitedEarly = { message: `failed to start: ${messageOf(err)}` };
  });
  child.once('exit', (code, signal) => {
    if (!exitedEarly)
      exitedEarly = {
        message: `exited early (code ${code}, signal ${signal})`,
      };
  });

  try {
    await waitUntil(
      async () => {
        if (exitedEarly) throw new Error(messageOf(exitedEarly));
        try {
          const response = await fetch(`http://localhost:${DASHBOARD_PORT}/`);
          return response.ok ? true : undefined;
        } catch {
          return undefined;
        }
      },
      {
        timeoutMs: 10_000,
        describe: `the dashboard to answer on :${DASHBOARD_PORT}`,
      },
    );
  } catch (error) {
    process.stderr.write(
      `==> Dashboard failed to start: ${messageOf(error)} -- continuing WITHOUT the live dashboard; the ` +
        `run itself is unaffected. See ${path.relative(ROOT, DASHBOARD_LOG_FILE)} for details.\n`,
    );
    return;
  }

  process.stdout.write(
    `\n${'='.repeat(70)}\n  DASHBOARD:  http://localhost:${DASHBOARD_PORT}/\n${'='.repeat(70)}\n\n`,
  );
}

/**
 * Refuses unless `url` answers with exactly the bytes of `builtFile`. This
 * checked for a `/_astro/` reference once, which every build carries, so an
 * older build left serving on the port passed as this run's (#390). `astro
 * preview` serves `dist/` verbatim (measured: 58,854 characters, equal).
 *
 * @param {string} url
 * @param {string} builtFile
 * @returns {Promise<void>}
 */
export async function confirmServesBuild(url, builtFile) {
  const built = readFileSync(builtFile, 'utf8');
  const response = await fetch(url);
  const served = await response.text();
  if (!response.ok || served !== built) {
    throw new Error(
      `expected ${url} to serve the page this run just built -- it answered ${response.status} with ` +
        `${served.length} characters that differ from the ${built.length} built ` +
        `(${path.relative(ROOT, builtFile)}). Something other than this run's preview is being served; ` +
        'aborting the whole run rather than testing the wrong bytes.',
    );
  }
}

// ── device presence: real checks, not a config flag ────────────────────

/**
 * `adb devices`, read through `androidAbsence` in `scripts/adb.mjs`, which
 * `tests/device/android-preflight.setup.ts` asks too (state must be exactly
 * `device`, not merely present-but-locked or unauthorized). The two used to
 * parse it separately and disagreed: the preflight refused any listing that
 * was not exactly one ready device, so a second phone failed it even with
 * `ANDROID_SERIAL` choosing between them (#390).
 *
 * `ANDROID_SERIAL` (a real, standard adb environment variable) disambiguates
 * when more than one device is attached, the same role `IOS_UDID` plays for
 * `isIosPresent` below -- set it to a serial that is not attached
 * and this function honestly reports absence. That is also how this run's
 * "device absent" proof was produced for a phone this agent has no hands to
 * physically unplug: point this env var at a serial that is not attached
 * and the real detection logic reports absence honestly, exactly as it
 * would for a genuinely disconnected device.
 */
function isAndroidPresent() {
  let raw;
  try {
    raw = adb(['devices']);
  } catch (error) {
    return `\`adb devices\` failed to run: ${messageOf(error)}`;
  }
  return androidAbsence(raw, process.env.ANDROID_SERIAL);
}

/**
 * Why no iPhone can be driven, or `null` when exactly one physical iPhone is
 * there, read through `scripts/devicectl.mjs`, the one home the iOS session
 * reads it through too (#390).
 *
 * This script cannot import the session's own TypeScript. Measured, not a
 * style choice: importing `tests/device/ios/session.ts` failed with
 * `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` under this repo's pinned Node (.nvmrc:
 * 24, which strips TypeScript *types* natively), because the session pulls in
 * `webdriver.ts` and `interaction.ts`, both of which use constructor PARAMETER
 * PROPERTIES (`constructor(private readonly driver: WebDriver)`), a real
 * syntax transform that Node's strip-only mode does not support. The session
 * can import a plain module, so the listing and its parsing live in one.
 */
function isIosPresent() {
  let raw;
  try {
    raw = listDevices();
  } catch (error) {
    return messageOf(error);
  }
  const picked = pickIphone(raw, process.env.IOS_UDID);
  return 'absence' in picked ? picked.absence : null;
}

// ── one-off discovery: how many tests does grepInvert exclude by design? ──

/**
 * The `--grep` pattern that SELECTS what `android-chrome`'s `grepInvert` excludes. Declared
 * once and used for the listing and both messages; tests/guards/excluded-by-design.test.ts holds
 * it to the config's `grepInvert`, character for character. It was once two hand-typed copies,
 * and this one missed `@requires-download-bytes` for as long as that tag existed (#308).
 */
const EXCLUDED_BY_DESIGN_GREP = '@emulated-viewport|@requires-isolated-context';

/**
 * `android-chrome`'s `grepInvert`
 * (playwright.device.config.ts) excludes tagged tests before Playwright's own JSON
 * reporter ever sees them -- they are not "skipped", they are never collected, so the
 * real run's own report has no number for them at all. This asks separately, freshly,
 * every run: `--list --grep=<the same pattern>` against ANY project sharing
 * android-chrome's `tests/e2e/*.spec.ts` scope directly SELECTS the tagged set
 * (chromium is a convenient, arbitrary choice -- one project, no filtering of its
 * own). `tests/device/real-device.spec.ts`, the one file android-chrome matches that
 * chromium's own testDir does not reach, carries neither tag (checked by hand), so
 * restricting this listing to tests/e2e does not undercount.
 *
 * Two tags, one count, on purpose: both exist for the identical reason (something
 * this suite's tests need is physically impossible to give them on ONE real device --
 * a resizable screen, or a fresh per-test browser context) and both are excluded from
 * the SAME `grepInvert`, so the Android group's own "skipped by design" number must be
 * their sum to stay honestly self-consistent with what actually ran (see
 * printSummaryTable / playwrightVerdict, which add this to Playwright's own
 * `stats.skipped` for the real run). Splitting them into two separately-reported
 * numbers was considered and rejected: nothing downstream (the dashboard, this
 * script's own exit-code logic) currently needs to tell them apart, and a single
 * `--grep` pattern kept in exact lock-step with the config's own `grepInvert` is one
 * fewer place for the two to silently drift apart than two separate queries would be.
 *
 * Never hardcoded: measured live against this exact source tree, every run, so a
 * future test gaining or losing either tag cannot make this number rot. `--list`'s own
 * JSON reporter marks every listed test `skipped` (nothing ran) -- measured directly
 * before being trusted, not assumed.
 */
async function countExcludedByDesign() {
  const outFile = path.join(TEST_RESULTS_DIR, 'excluded-by-design-count.json');
  const { code } = await runTagged(
    'discover',
    'npx',
    [
      'playwright',
      'test',
      '--config=playwright.config.ts',
      '--project=chromium',
      '--list',
      `--grep=${EXCLUDED_BY_DESIGN_GREP}`,
      '--reporter=json',
    ],
    { env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: outFile } },
  );
  if (code !== 0) {
    throw new Error(
      `expected \`playwright test --list --grep=${EXCLUDED_BY_DESIGN_GREP}\` to exit 0 ` +
        `(it only lists tests, never runs them) -- got code ${code}. Cannot compute the Android group's ` +
        'skipped-by-design count.',
    );
  }
  return countAt(
    readJson(outFile, 'the excluded-by-design discovery listing'),
    ['stats', 'skipped'],
    'the excluded-by-design discovery listing',
  );
}

// ── the three groups ────────────────────────────────────────────────────

/**
 * A group's report, or `null` when the group never wrote one.
 *
 * @param {string} file
 * @param {string} description
 * @returns {unknown}
 */
function reportAt(file, description) {
  return existsSync(file) ? readJson(file, description) : null;
}

/**
 * One count off a report, refused unless it is a whole number. Read blind, a
 * missing count became `NaN` in the summary and `undefined !== 0` a failure
 * nobody could explain (#390).
 *
 * @param {unknown} report
 * @param {string[]} at
 * @param {string} description
 * @returns {number}
 */
function countAt(report, at, description) {
  /** @type {unknown} */
  let value = report;
  for (const key of at)
    value =
      typeof value === 'object' && value !== null
        ? /** @type {Record<string, unknown>} */ (value)[key]
        : undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(
      `expected ${description} to carry a count at ${at.join('.')} -- got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * The one rule both kinds of group are judged by: the process and the report
 * must both say it passed, and something must have passed. A group in which
 * nothing passed measured nothing, whatever its exit code says (#390).
 *
 * @param {{ name: string, code: number | null, passed: number, failed: number,
 *   skippedByDesign: number, reportSaysOk: boolean, reportSays: string,
 *   failures: string }} counts
 */
function judged({
  name,
  code,
  passed,
  failed,
  skippedByDesign,
  reportSaysOk,
  reportSays,
  failures,
}) {
  const processSaysOk = code === 0;
  const reason =
    reportSaysOk !== processSaysOk
      ? `disagreement: process exit code ${code} but the report says ${reportSays} -- treated ` +
        'as failed either way, since these should never disagree'
      : !processSaysOk
        ? `${failures} (process exit code ${code})`
        : passed === 0
          ? 'no test passed, so this group proved nothing -- a run that measured nothing is not a pass'
          : undefined;
  return {
    name,
    status: reason === undefined ? 'passed' : 'failed',
    passed,
    failed,
    skippedByDesign,
    reason,
  };
}

/**
 * @param {string} name
 * @param {number | null} code
 * @param {string} reportFile
 */
function neverWritten(name, code, reportFile) {
  return {
    name,
    status: 'failed',
    passed: null,
    failed: null,
    skippedByDesign: null,
    reason:
      `the process exited with code ${code} but its report (${reportFile}) was never written -- ` +
      'cannot verify real counts, so this cannot be reported as anything other than failed.',
  };
}

/**
 * What a Playwright group proved, from its exit code and its JSON report
 * (`null` when none was written). `reportFile` only names the report.
 *
 * @param {{ name: string, code: number | null, report: unknown,
 *   reportFile: string, extraSkipped?: number }} group
 */
export function playwrightVerdict({
  name,
  code,
  report,
  reportFile,
  extraSkipped = 0,
}) {
  if (report === null) return neverWritten(name, code, reportFile);
  const description = `${name}'s Playwright report`;
  /** @param {string} key */
  const count = (key) => countAt(report, ['stats', key], description);
  const passed = count('expected') + count('flaky');
  const failed = count('unexpected');
  return judged({
    name,
    code,
    passed,
    failed,
    skippedByDesign: count('skipped') + extraSkipped,
    reportSaysOk: failed === 0,
    reportSays: `${failed} failed`,
    failures: `${failed} test(s) failed`,
  });
}

/**
 * What the iOS group proved, from vitest's JSON report. A file that fails to
 * load fails no test (measured: `numFailedTests` 0, `numFailedTestSuites` 1,
 * `success` false), so the failed files are named beside the failed tests.
 *
 * @param {{ name: string, code: number | null, report: unknown,
 *   reportFile: string }} group
 */
export function vitestVerdict({ name, code, report, reportFile }) {
  if (report === null) return neverWritten(name, code, reportFile);
  const description = `${name}'s vitest report`;
  /** @param {string} key */
  const count = (key) => countAt(report, [key], description);
  const passed = count('numPassedTests');
  const failed = count('numFailedTests');
  const failedFiles = count('numFailedTestSuites');
  const skippedByDesign = count('numPendingTests') + count('numTodoTests');
  const success = /** @type {Record<string, unknown>} */ (report).success;
  if (typeof success !== 'boolean') {
    throw new Error(
      `expected ${description} to say true or false at success -- got ${JSON.stringify(success)}`,
    );
  }
  return judged({
    name,
    code,
    passed,
    failed,
    skippedByDesign,
    reportSaysOk: failed === 0 && success,
    reportSays: `${failed} failed and success ${success}`,
    failures: `${failed} test(s) and ${failedFiles} file(s) failed`,
  });
}

/**
 * Runs one group, and turns a group that throws into its own failed row. The
 * three ran under one `Promise.all`, so one unreadable report rejected the lot:
 * the other two groups' verdicts were never read, the run said ABORTED, and
 * cleanup stopped the shared server under groups still running (#390).
 *
 * @param {string} name
 * @param {() => Promise<Record<string, unknown>>} run
 */
export async function contained(name, run) {
  const startedAt = Date.now();
  try {
    return await run();
  } catch (error) {
    return {
      name,
      status: 'failed',
      passed: null,
      failed: null,
      skippedByDesign: null,
      durationMs: Date.now() - startedAt,
      reason: `the group stopped before it could report: ${messageOf(error)}`,
    };
  }
}

async function runDesktopGroup() {
  const name = 'desktop';
  const reportFile = REPORT_FILES.desktop;
  const startedAt = Date.now();
  const { code } = await runTagged(
    name,
    'npx',
    [
      'playwright',
      'test',
      '--config=playwright.config.ts',
      // list,json: unchanged from before this task -- terminal output and
      // the JSON summary this script itself reads are exactly as they
      // were. html + the jsonl reporter are ADDITIONS for the dashboard
      // only (task brief step 3: "keep the existing --reporter=list,json
      // behaviour alongside the new one"). Neither playwright.config.ts
      // nor playwright.device.config.ts needed a change to support this --
      // Playwright's CLI resolves a non-built-in reporter id via
      // `path.resolve(process.cwd(), id)` (node_modules/playwright/lib/cli/testActions.js,
      // `resolveReporter`), so a relative path on this same flag is enough;
      // measured directly against this exact invocation shape before being
      // trusted, not assumed.
      '--reporter=list,json,html,./tests/reporters/jsonl-reporter.ts',
    ],
    {
      env: {
        ...process.env,
        PW_REUSE_SERVER: '1',
        PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
        DASHBOARD_JSONL_FILE: DASHBOARD_JSONL_FILE[name],
        DASHBOARD_GROUP: name,
        // Both env vars the html reporter itself already supports --
        // verified in node_modules/playwright/lib/runner/index.js
        // (`reportFolderFromEnv`, `getHtmlReportOptionProcessEnv`) rather
        // than assumed. A distinct per-group output dir is load-bearing:
        // desktop and android run CONCURRENTLY, and both would otherwise
        // write to the same default playwright-report/ folder at once.
        // `never` stops the html reporter auto-opening a browser tab --
        // disruptive mid-run, and no part of the brief asked for it.
        PLAYWRIGHT_HTML_OUTPUT_DIR: REPORT_DIR[name],
        PLAYWRIGHT_HTML_OPEN: 'never',
      },
    },
  );
  return {
    ...playwrightVerdict({
      name,
      code,
      report: reportAt(reportFile, `${name}'s Playwright JSON report`),
      reportFile: path.relative(ROOT, reportFile),
    }),
    durationMs: Date.now() - startedAt,
  };
}

/**
 * @param {number} excludedByDesign a COUNT, from `countExcludedByDesign()`,
 *   passed on as `extraSkipped` (which defaults to 0). Annotating it as a
 *   list from the name alone was wrong; the call site settled it.
 */
async function runAndroidGroup(excludedByDesign) {
  const name = 'android';
  const startedAt = Date.now();
  const absence = isAndroidPresent();
  if (absence !== null) {
    process.stdout.write(
      `[${name}] device absent -- not attempting this group: ${absence}\n`,
    );
    writeDashboardNotRun(name, absence);
    return {
      name,
      status: 'not-run',
      passed: null,
      failed: null,
      skippedByDesign: null,
      durationMs: Date.now() - startedAt,
      reason: absence,
    };
  }

  const reportFile = REPORT_FILES.android;
  const { code } = await runTagged(
    name,
    'npx',
    [
      'playwright',
      'test',
      '--config=playwright.device.config.ts',
      // See runDesktopGroup's identical comment: html + jsonl-reporter are
      // additive, list+json are unchanged, no config file needed a change.
      '--reporter=list,json,html,./tests/reporters/jsonl-reporter.ts',
    ],
    {
      env: {
        ...process.env,
        PW_REUSE_SERVER: '1',
        PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
        DASHBOARD_JSONL_FILE: DASHBOARD_JSONL_FILE[name],
        DASHBOARD_GROUP: name,
        PLAYWRIGHT_HTML_OUTPUT_DIR: REPORT_DIR[name],
        PLAYWRIGHT_HTML_OPEN: 'never',
      },
    },
  );
  return {
    ...playwrightVerdict({
      name,
      code,
      report: reportAt(reportFile, `${name}'s Playwright JSON report`),
      reportFile: path.relative(ROOT, reportFile),
      extraSkipped: excludedByDesign,
    }),
    durationMs: Date.now() - startedAt,
  };
}

async function runIosGroup() {
  const name = 'ios';
  const startedAt = Date.now();
  const absence = isIosPresent();
  if (absence !== null) {
    process.stdout.write(
      `[${name}] device absent -- not attempting this group: ${absence}\n`,
    );
    writeDashboardNotRun(name, absence);
    return {
      name,
      status: 'not-run',
      passed: null,
      failed: null,
      skippedByDesign: null,
      durationMs: Date.now() - startedAt,
      reason: absence,
    };
  }

  // This run's own mode, not a stale one a previous invocation left behind
  // -- `startIosSession` also clears this on its own next attempt, but
  // clearing it here too means a group that never even reaches
  // `startIosSession` (e.g. it fails before that) cannot be attributed a
  // leftover mode from an earlier run.
  if (existsSync(IOS_MODE_FILE)) unlinkSync(IOS_MODE_FILE);

  const reportFile = REPORT_FILES.ios;
  const { code } = await runTagged(
    name,
    'npx',
    [
      'vitest',
      'run',
      '--config=vitest.ios.config.ts',
      '--reporter=verbose',
      '--reporter=json',
      `--outputFile.json=${reportFile}`,
      // Additive, same as the two Playwright groups' jsonl reporter --
      // verbose+json are unchanged. The leading "./" is load-bearing, not
      // decorative: vitest's own CLI-to-config resolution
      // (node_modules/vitest/dist/chunks/coverage.DM_a_rWm.js, the block
      // starting "// ./reporter.js || ../reporter.js, but not
      // .reporters/reporter.js") only treats a --reporter value as a file
      // path when it matches /^\.\.?\//; a bare path is treated as a
      // reporter NAME and fails to resolve. Measured, not assumed -- see
      // tests/reporters/jsonl-vitest.ts's own module doc. No change to
      // vitest.ios.config.ts needed.
      '--reporter=./tests/reporters/jsonl-vitest.ts',
    ],
    {
      env: {
        ...process.env,
        DASHBOARD_JSONL_FILE: DASHBOARD_JSONL_FILE[name],
        DASHBOARD_GROUP: name,
      },
    },
  );
  const durationMs = Date.now() - startedAt;

  const modeInfo = existsSync(IOS_MODE_FILE)
    ? readJson(IOS_MODE_FILE, "iOS's interaction-mode artifact")
    : null;
  // Design doc s5a, restated for THIS process's own output: a run where
  // taps were never taps must not read like one where they were.
  // `modeInfo.description` is the FULL sentence session.ts already rendered
  // via its own `describeInteractionMode` call -- read verbatim, not
  // recomputed here, because this script cannot import that function
  // directly (see `isIosPresent`'s own comment for the measured
  // reason) and a hand-copied paraphrase could drift from the source of
  // truth the moment either file is edited.
  const modeNote = modeInfo
    ? modeInfo.description
    : '[iOS interaction mode] UNKNOWN -- ios-mode.json was not written this run, which means the ' +
      'session never reached the design doc s5a canary. Treat any iOS result this run as unverified ' +
      'for touch-input claims.';

  return {
    ...vitestVerdict({
      name,
      code,
      report: reportAt(reportFile, "iOS's vitest JSON report"),
      reportFile: path.relative(ROOT, reportFile),
    }),
    durationMs,
    modeNote,
  };
}

// ── cleanup: always runs, whatever happened above ───────────────────────

async function cleanupAdbTunnels() {
  // Measured directly: `adb reverse --remove-all` / `adb forward --remove-all`
  // both exit 0 against a device with nothing mapped -- safe no-ops, so
  // these run unconditionally, not gated on whether the Android group
  // actually attempted anything.
  for (const args of [
    ['forward', '--remove-all'],
    ['reverse', '--remove-all'],
  ]) {
    try {
      adb(args);
    } catch (error) {
      // No device attached at all makes plain `adb` fail outright -- fine,
      // there is nothing to remove. Anything else is logged, not thrown:
      // cleanup must not itself abort the rest of cleanup.
      process.stderr.write(
        `cleanup: \`adb ${args.join(' ')}\` failed (continuing): ${messageOf(error)}\n`,
      );
    }
  }
}

/**
 * The port and session a leaked-session marker names, refused unless both are
 * there: read blind, a marker without a port sent `DELETE` to `:undefined` and
 * asked `lsof` about port `undefined` (#390).
 *
 * @param {unknown} marker
 * @returns {{ port: number, sessionId: string }}
 */
export function leakedSessionOf(marker) {
  const { port, sessionId } = /** @type {Record<string, unknown>} */ (
    marker ?? {}
  );
  if (
    typeof port !== 'number' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    typeof sessionId !== 'string' ||
    sessionId === ''
  ) {
    throw new Error(
      `expected the iOS session marker to name a port and a session id -- got ${JSON.stringify(marker)}`,
    );
  }
  return { port, sessionId };
}

/**
 * Ends a WebDriver session, refused unless safaridriver says it did. The
 * answer went unread once, so a 404 printed "Deleted leaked WebDriver session"
 * (#390).
 *
 * @param {{ port: number, sessionId: string }} session
 * @returns {Promise<void>}
 */
export async function deleteSession({ port, sessionId }) {
  const response = await fetch(
    `http://127.0.0.1:${port}/session/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' },
  );
  if (!response.ok) {
    throw new Error(
      `safaridriver answered ${response.status} to DELETE /session/${sessionId}`,
    );
  }
}

/**
 * "one leaked iOS session locks the phone out of every later run" (task
 * brief). If `tests/device/ios/session.ts` left its marker file behind,
 * `teardown()` either never ran (this process was killed) or ran and its
 * own DELETE failed -- either way, close the session directly and free its
 * safaridriver port BY PORT (the same mechanism as the preview server,
 * never a process-name match).
 */
async function cleanupLeakedIosSession() {
  if (!existsSync(IOS_SESSION_MARKER_FILE)) return;
  process.stdout.write(
    '==> Found a leaked iOS WebDriver session marker -- cleaning it up so the phone is not locked ' +
      'out of the next run...\n',
  );
  let marker;
  try {
    marker = leakedSessionOf(
      readJson(IOS_SESSION_MARKER_FILE, 'the leaked iOS session marker'),
    );
  } catch (error) {
    process.stderr.write(
      `cleanup: could not read the iOS session marker: ${messageOf(error)}\n`,
    );
    return;
  }
  const { port, sessionId } = marker;
  try {
    await deleteSession(marker);
    process.stdout.write(
      `==> Deleted leaked WebDriver session ${sessionId}.\n`,
    );
  } catch (error) {
    process.stderr.write(
      `cleanup: DELETE on the leaked WebDriver session failed (continuing to free its port anyway): ` +
        `${messageOf(error)}\n`,
    );
  }
  await killByPort(port).catch((error) =>
    process.stderr.write(
      `cleanup: failed to free safaridriver's port ${port}: ${messageOf(error)}\n`,
    ),
  );
  try {
    unlinkSync(IOS_SESSION_MARKER_FILE);
  } catch {
    // Already gone -- fine.
  }
}

// ── reporting ────────────────────────────────────────────────────────────

/** @param {unknown} value */
function cell(value) {
  return value === null || value === undefined ? '-' : String(value);
}

/**
 * @param {any[]} groups
 * @param {number} totalDurationMs
 */
function printSummaryTable(groups, totalDurationMs) {
  const headers = [
    'Group',
    'Passed',
    'Failed',
    'Skipped(design)',
    'Not-run',
    'Duration',
  ];
  const rows = groups.map((/** @type {Record<string, any>} */ g) => [
    g.name,
    g.status === 'not-run' ? '-' : cell(g.passed),
    g.status === 'not-run' ? '-' : cell(g.failed),
    g.status === 'not-run' ? '-' : cell(g.skippedByDesign),
    g.status === 'not-run' ? 'YES' : '-',
    `${(g.durationMs / 1000).toFixed(1)}s`,
  ]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((/** @type {string[]} */ r) => r[i].length)),
  );
  /** @param {string[]} cells */
  const renderRow = (cells) =>
    cells.map((c, i) => c.padEnd(widths[i])).join('  ');

  process.stdout.write('\n' + renderRow(headers) + '\n');
  process.stdout.write(widths.map((w) => '-'.repeat(w)).join('  ') + '\n');
  for (const row of rows) process.stdout.write(renderRow(row) + '\n');
  process.stdout.write(
    `\nTotal wall-clock: ${(totalDurationMs / 1000).toFixed(1)}s\n`,
  );

  const notes = groups.filter(
    (/** @type {{ reason?: string, modeNote?: string }} */ g) =>
      g.reason || g.modeNote,
  );
  if (notes.length > 0) {
    process.stdout.write('\nNotes:\n');
    for (const g of notes) {
      if (g.reason) process.stdout.write(`  - ${g.name}: ${g.reason}\n`);
      if (g.modeNote) process.stdout.write(`  - ${g.name}: ${g.modeNote}\n`);
    }
  }
  process.stdout.write('\n');
}

// ── main ─────────────────────────────────────────────────────────────────

/** @type {import('node:child_process').ChildProcess | null} */
let previewChild = null;

/**
 * Runs `task` on the first call only, and answers every call with that run's
 * promise. Cleanup was guarded by a flag set as it began, so Ctrl+C during the
 * end-of-run cleanup found it "done", skipped it, and exited under the half
 * finished one (#390).
 *
 * @template T
 * @param {() => T} task
 * @returns {() => T}
 */
export function once(task) {
  /** @type {{ value: T } | undefined} */
  let ran;
  return () => (ran ??= { value: task() }).value;
}

/**
 * The exit status a shell reports for a process a signal ended: 128 plus the
 * signal's number. Every signal exited 130 before, SIGINT's, so a SIGTERM
 * read as a Ctrl+C (#390).
 *
 * @param {NodeJS.Signals} signal
 * @returns {number}
 */
export function exitCodeFor(signal) {
  return 128 + constants.signals[signal];
}

const cleanup = once(async () => {
  if (previewChild) {
    process.stdout.write('==> Stopping the shared preview server...\n');
    await killByPort(PORT).catch((error) =>
      process.stderr.write(
        `cleanup: failed to free port ${PORT}: ${messageOf(error)}\n`,
      ),
    );
  }
  await cleanupAdbTunnels();
  await cleanupLeakedIosSession();
});

/**
 * Ctrl+C (or a CI-style SIGTERM) must not skip cleanup -- a leaked iOS
 * session locks the phone out of every later run, which is worse than
 * letting the interrupted run's own results go unreported. The default
 * Node behaviour for these signals is to exit immediately without running
 * pending `finally` blocks, so this is not redundant with the try/finally
 * in `main()` below -- it is the path that catches what that one cannot.
 *
 * INSTALLED BY `main()`, never as the file loads (#276). Registering a
 * handler is SILENT, so the import guard #227 added -- which asserts that
 * importing this module prints nothing -- could not see it: an import left
 * two handlers behind, and a SIGTERM to whatever process had done the
 * importing then ran `adb` cleanup from it. Measured: a unit-suite run
 * printed this script's own "Received SIGTERM, cleaning up before exit"
 * and two `adb` failures.
 *
 * @returns {void}
 */
function cleanUpOnSignal() {
  for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
    process.once(signal, async () => {
      process.stdout.write(
        `\n==> Received ${signal}, cleaning up before exit...\n`,
      );
      await cleanup();
      process.exit(exitCodeFor(signal));
    });
  }
}

async function main() {
  // This script takes no arguments, so one is a mistake -- and refusing it is
  // the cheapest proof that `main()` ran when the file is executed directly
  // (#227). A skipped entry point exits 0 in silence.
  const unexpected = process.argv.slice(2);
  if (unexpected.length > 0)
    die(
      `test-devices.mjs takes no arguments, received: ${unexpected.join(' ')}`,
    );

  cleanUpOnSignal();

  mkdirSync(TEST_RESULTS_DIR, { recursive: true });
  mkdirSync(DASHBOARD_STATE_DIR, { recursive: true });

  // A stale FINAL/not-run artifact left over from a previous run must not
  // bleed into this one -- proven live while building this feature: with
  // the dashboard already open and a previous run's dashboard-final.json
  // still on disk, a brand-new run's very first tick re-applied the OLD
  // run's authoritative pass/fail numbers on top of the new run's
  // freshly-reset live counts, which would show a run that has barely
  // started as though it had already finished failed. The three JSONL
  // files are NOT cleared here -- each reporter truncates its own at the
  // top of its own run (see their module docs), and clearing them before
  // that would race harmlessly with nothing; clearing the two small
  // whole-file JSON artifacts here, before the dashboard is even started,
  // is what actually matters.
  //
  // IOS_MODE_FILE belongs in this same early clear, for the identical
  // reason -- also proven live, not reasoned about in the abstract:
  // runIosGroup() already deletes it, but only once IT runs, which is
  // AFTER the build, the preview-server start and the
  // @emulated-viewport count -- tens of seconds after the dashboard is
  // already up and rendering. Watched happening on a real run: the iOS
  // card showed dom-dispatch mode banner while its own badge still read
  // "pending", because the file on disk was still the PREVIOUS run's.
  // Harmless in substance on THIS device (the mode has been stable), but
  // exactly the shape of claim design doc s5a exists to forbid --
  // attributing a mode to a run before that run's own canary has decided
  // it. Cleared here, before the dashboard starts, so a pending iOS card
  // never carries a mode banner that isn't this run's own.
  //
  // The three per-group reports join that list since #230. They used to be
  // removed by accident: `test-results/` was Playwright's own outputDir, and
  // every invocation wiped it whole. Each group now writes to a folder of its
  // own, so `test-results/` is no longer wiped by anything -- which is the
  // point, and which would otherwise mean a group that DIED before writing
  // its report left the previous run's report in place to be read as this
  // run's. A stale green is worse than a missing file.
  for (const file of RUN_START_CLEARED) {
    if (existsSync(file)) unlinkSync(file);
  }
  for (const key of Object.keys(dashboardGroupsState))
    delete (/** @type {Record<string, unknown>} */ (dashboardGroupsState)[key]);

  const startedAt = Date.now();

  try {
    // Started FIRST, before anything else -- task brief step 2: "Print
    // the dashboard URL prominently before any group starts". Never
    // throws; a dashboard that fails to start only warns (see its own
    // doc) and the rest of this run proceeds exactly as it would without
    // it.
    await startDashboard();

    // MUST run before anything else, not only in the end-of-run `cleanup()`
    // below. Measured directly: `startIosSession` (session.ts) clears its
    // OWN marker file unconditionally the moment it is called, so this
    // run's iOS group would otherwise silently destroy
    // the evidence of a PREVIOUS run's leaked session before ever cleaning
    // it up -- and then fail anyway, because the device still considers
    // itself paired with that orphaned session (Apple allows exactly one).
    // Cleaning up any pre-existing leak here, before the iOS group ever
    // attempts a new session, is what actually prevents "one leaked session
    // locks the phone out of every later run".
    await cleanupLeakedIosSession();

    process.stdout.write(
      '==> Freeing port 4321 (any stale server from a previous run)...\n',
    );
    await killByPort(PORT);

    process.stdout.write('==> Building (npm run build)...\n');
    const build = await runTagged('build', 'npm', ['run', 'build']);
    if (build.code !== 0) {
      throw new Error(
        `\`npm run build\` exited with code ${build.code} -- aborting the whole run.`,
      );
    }

    process.stdout.write(
      '==> Starting the shared preview server (npm run preview -- --host 0.0.0.0)...\n',
    );
    previewChild = spawnTagged('preview', 'npm', [
      'run',
      'preview',
      '--',
      '--host',
      '0.0.0.0',
    ]);
    await waitForHttpOk(`http://localhost:${PORT}/classroom-groups`, {
      timeoutMs: 30_000,
      describe: `the shared preview server to answer on :${PORT}`,
    });

    // Brief step 2(d): abort the WHOLE run rather than let three groups
    // measure the wrong bytes.
    await confirmServesBuild(
      `http://localhost:${PORT}/classroom-groups`,
      path.join(ROOT, 'dist', 'classroom-groups', 'index.html'),
    );
    process.stdout.write(
      '==> Confirmed: the shared server serves the page this run just built, byte for byte.\n',
    );

    process.stdout.write(
      '==> Counting excluded-by-design exclusions (static, source-only fact)...\n',
    );
    const excludedByDesign = await countExcludedByDesign();
    process.stdout.write(
      `==> ${excludedByDesign} test(s) excluded by design ` +
        `(${EXCLUDED_BY_DESIGN_GREP.split('|').join(' or ')}) for the Android group.\n`,
    );

    process.stdout.write(
      '==> Launching desktop, android and ios concurrently...\n\n',
    );
    const groups = await Promise.all([
      contained('desktop', runDesktopGroup),
      contained('android', () => runAndroidGroup(excludedByDesign)),
      contained('ios', runIosGroup),
    ]);

    await cleanup();

    // The SAME `groups` array the summary table below prints and the exit
    // code below is computed from -- not a re-derivation. This is what
    // guarantees the dashboard's own final numbers can never disagree with
    // (let alone look rosier than) what the terminal and the exit code
    // say; see scripts/dashboard.mjs's own doc on why this file, once
    // present, overrides its live-tallied counts rather than merely
    // informing them.
    writeDashboardFinal({ aborted: null, groups });

    printSummaryTable(groups, Date.now() - startedAt);
    const anyBad = groups.some((g) => g.status !== 'passed');
    process.exitCode = anyBad ? 1 : 0;
  } catch (fatal) {
    process.stderr.write(`\nABORTED: ${messageOf(fatal)}\n\n`);
    process.exitCode = 1;
    writeDashboardFinal({ aborted: messageOf(fatal), groups: null });
    await cleanup();
  }
}

if (import.meta.main) await main();
