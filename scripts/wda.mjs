/**
 * WebDriverAgent on the iPhone, owned by the device run (#838).
 *
 * WDA is the iPhone run's input: real touches and real keyboard input, which
 * our Web Inspector client cannot send. `startWda` builds it for this pin
 * when no build exists (signed with the operator's Apple ID team), starts it
 * on the iPhone, waits for its ready line, and hands on the address it
 * answers on over USB. `stop` ends it and checks nothing of it outlives the
 * run. The runner starts it in its own process, beside the iOS group,
 * because the machine's test lock counts `xcodebuild test-without-building`
 * as a heavy run: a WDA started anywhere else blocks the group (measured
 * 2026-10-31).
 *
 * Recipe and measurements: `.superpowers/sdd/838/wda-recipe.md`.
 */
import { execFile, spawn as nodeSpawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseTunnelAddress } from './devicectl.mjs';
import { messageOf, nonEmpty } from './errors.mjs';

/** appium/WebDriverAgent v16.14.0 (BSD), tag dated 2026-10-04. */
export const WDA_PIN = 'd17782422d55ff1e5e0ceb74eb1fd509cc0c35b6';
const WDA_REPO = 'https://github.com/appium/WebDriverAgent.git';

/** Starting a built WDA took 6 s on 2026-10-31; the build alone ~2 min. */
export const WDA_READY_CEILING_MS = 180_000;
/** A build from nothing: measured ~2 min on 2026-10-18 and 2026-10-31. */
export const WDA_BUILD_CEILING_MS = 900_000;
export const WDA_STOP_CEILING_MS = 10_000;
/** /status answered in 5-90 ms over the tunnel on 2026-11-02. */
const WDA_ANSWER_CEILING_MS = 10_000;
const DEVICECTL_CEILING_MS = 15_000;
const WDA_PORT = 8100;

export const DEFAULT_WDA_CACHE = path.join(
  os.homedir(),
  'Library',
  'Caches',
  'shyden-wda',
);

const READY = /ServerURLHere->(\S+?)<-ServerURLHere/;

/** @param {string} line @returns {string | null} */
export function parseReadyLine(line) {
  const match = READY.exec(line);
  return match === null ? null : match[1];
}

/** @param {string} file @param {string[]} args @param {{ timeoutMs: number }} options @returns {Promise<string>} */
function run(file, args, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error)
          reject(
            new Error(
              `${file} ${args.slice(0, 2).join(' ')} failed (ceiling ${timeoutMs / 1000} s): ${error.message}\n${String(stderr).slice(-800)}`,
            ),
          );
        else resolve(stdout);
      },
    );
  });
}

/** @param {string} productsDir @returns {string | null} */
function findXctestrun(productsDir) {
  if (!existsSync(productsDir)) return null;
  const found = nonEmpty(
    readdirSync(productsDir),
    `entries in ${productsDir}, which a WebDriverAgent build leaves its products in`,
  ).find((name) => /^WebDriverAgentRunner_iphoneos.*\.xctestrun$/.test(name));
  return found === undefined ? null : path.join(productsDir, found);
}

/** @param {string} udid @returns {Promise<string | null>} the pid of a WDA runner already up for this iPhone */
function alive(udid) {
  return new Promise((resolve) => {
    execFile(
      'pgrep',
      ['-f', `xcodebuild test-without-building.*${udid}`],
      { encoding: 'utf8' },
      // pgrep exits 1 when nothing matches: that is the answer, not a failure.
      (_error, stdout) => resolve(stdout.trim().split('\n')[0] || null),
    );
  });
}

/**
 * @param {{
 *   udid: string,
 *   cacheDir?: string,
 *   ceilingMs?: number,
 *   run?: (file: string, args: string[], options: { timeoutMs: number }) => Promise<string>,
 *   spawn?: (file: string, args: string[]) => import('node:child_process').ChildProcess,
 *   findXctestrun?: (productsDir: string) => string | null,
 *   hasSource?: (srcDir: string) => boolean,
 *   alive?: (udid: string) => string | null | Promise<string | null>,
 *   answers?: (url: string) => Promise<void>,
 * }} options
 * @returns {Promise<{ url: string, stop(): Promise<void> }>}
 */
export async function startWda({
  udid,
  cacheDir = DEFAULT_WDA_CACHE,
  ceilingMs = WDA_READY_CEILING_MS,
  run: runCommand = run,
  spawn = (file, args) =>
    nodeSpawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] }),
  findXctestrun: find = findXctestrun,
  hasSource = (srcDir) =>
    existsSync(path.join(srcDir, 'WebDriverAgent.xcodeproj')),
  alive: isAlive = alive,
  answers = wdaAnswers,
}) {
  const leftover = await isAlive(udid);
  if (leftover !== null)
    throw new Error(
      `a WebDriverAgent runner is already running for this iPhone (pid ${leftover}); stop it (kill ${leftover}) before the device run starts its own`,
    );

  const root = path.join(cacheDir, WDA_PIN);
  const srcDir = path.join(root, 'src');
  const derivedData = path.join(root, 'dd');
  const products = path.join(derivedData, 'Build', 'Products');

  if (!hasSource(srcDir)) {
    await runCommand('git', ['clone', '--filter=blob:none', WDA_REPO, srcDir], {
      timeoutMs: WDA_BUILD_CEILING_MS,
    });
    await runCommand('git', ['-C', srcDir, 'checkout', WDA_PIN], {
      timeoutMs: DEVICECTL_CEILING_MS,
    });
  }

  let xctestrun = find(products);
  if (xctestrun === null) {
    await runCommand(
      'xcodebuild',
      [
        'build-for-testing',
        '-project',
        path.join(srcDir, 'WebDriverAgent.xcodeproj'),
        '-scheme',
        'WebDriverAgentRunner',
        '-destination',
        `id=${udid}`,
        '-derivedDataPath',
        derivedData,
        '-allowProvisioningUpdates',
        'DEVELOPMENT_TEAM=F3XX4PM3MF',
        'CODE_SIGN_STYLE=Automatic',
        'PRODUCT_BUNDLE_IDENTIFIER=uk.co.shyden.wda',
      ],
      { timeoutMs: WDA_BUILD_CEILING_MS },
    );
    xctestrun = find(products);
    if (xctestrun === null)
      throw new Error(
        `WebDriverAgent built, but no WebDriverAgentRunner_iphoneos*.xctestrun is in ${products}`,
      );
  }

  const child = spawn('xcodebuild', [
    'test-without-building',
    '-xctestrun',
    xctestrun,
    '-destination',
    `id=${udid}`,
  ]);
  /** @type {string[]} */
  const lines = [];
  let exited = false;
  const exitedPromise = new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      exited = true;
      resolve({ code, signal });
    });
  });
  const lastLines = () => lines.slice(-5).join('\n');

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (/** @type {() => void} */ action) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };
    /** @param {Buffer} chunk */
    const onData = (chunk) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.trim() === '') continue;
        lines.push(line);
        if (lines.length > 50) lines.shift();
        if (parseReadyLine(line) !== null) finish(() => resolve(undefined));
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    exitedPromise.then(({ code, signal }) =>
      finish(() =>
        reject(
          new Error(
            `WebDriverAgent's xcodebuild exited (code ${code}, signal ${signal}) before its ready line; is the iPhone unlocked and its signing profile current? Last lines:\n${lastLines()}`,
          ),
        ),
      ),
    );
    const timer = setTimeout(
      () =>
        finish(() => {
          child.kill('SIGTERM');
          reject(
            new Error(
              `WebDriverAgent printed no ready line within ${ceilingMs / 1000} s (WDA_READY_CEILING_MS); is the iPhone unlocked? Last lines:\n${lastLines()}`,
            ),
          );
        }),
      ceilingMs,
    );
  });

  const handle = {
    url: '',
    async stop() {
      if (!exited) {
        child.kill('SIGTERM');
        /** @type {NodeJS.Timeout | undefined} */
        let stopTimer;
        const ceiling = new Promise((resolve) => {
          stopTimer = setTimeout(resolve, WDA_STOP_CEILING_MS, 'ceiling');
        });
        const outcome = await Promise.race([exitedPromise, ceiling]);
        clearTimeout(stopTimer);
        if (outcome === 'ceiling') {
          // Not a retry: SIGTERM was ignored for the stated ceiling, so the
          // process is ended outright and the run says nothing of it was left.
          child.kill('SIGKILL');
          await exitedPromise;
        }
      }
      const outlived = await isAlive(udid);
      if (outlived !== null)
        throw new Error(
          `a WebDriverAgent runner is still running for this iPhone after the run stopped it (pid ${outlived}); kill ${outlived}`,
        );
    },
  };

  // The tunnel is read only now, after the ready line. Measured 2026-11-02:
  // an address read before xcodebuild started answered EHOSTUNREACH once WDA
  // was up, while a read made here brings the tunnel back and it then answered
  // every call, busy and idle, for 220 s. WDA is handed on only once it answers.
  try {
    const tunnel = parseTunnelAddress(
      await runCommand(
        'xcrun',
        ['devicectl', 'device', 'info', 'details', '--device', udid],
        { timeoutMs: DEVICECTL_CEILING_MS },
      ),
    );
    handle.url = `http://[${tunnel}]:${WDA_PORT}`;
    try {
      await answers(handle.url);
    } catch (error) {
      throw new Error(
        `WebDriverAgent is up but its tunnel ${handle.url} did not answer: ${messageOf(error)}`,
      );
    }
  } catch (error) {
    await handle.stop();
    throw error;
  }
  return handle;
}

/** @param {string} url @returns {Promise<void>} resolves once WDA's /status answers 200 within the ceiling */
async function wdaAnswers(url) {
  let response;
  try {
    response = await fetch(`${url}/status`, {
      signal: AbortSignal.timeout(WDA_ANSWER_CEILING_MS),
    });
  } catch (error) {
    const cause = /** @type {{ cause?: { code?: string } }} */ (error).cause;
    throw new Error(
      `GET /status: ${messageOf(error)}${cause?.code ? ` ${cause.code}` : ''} (ceiling ${WDA_ANSWER_CEILING_MS / 1000} s)`,
    );
  }
  if (!response.ok) throw new Error(`GET /status answered ${response.status}`);
}
