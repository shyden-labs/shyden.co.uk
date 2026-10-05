/**
 * Record the guards' liveness floors (#468): `npm run floors:record`.
 *
 * Runs the unit suite with `FLOORS_RECORD` set, so every `floorBreach` call
 * writes the count it saw instead of judging it (`tests/floors.ts`), then the
 * Playwright specs that call it, on every project, in the pinned image CI
 * runs them in (#475). It judges both runs' counts together and raises
 * `tests/floors.json` to match. It checks EVERYTHING before writing
 * anything, and refuses the whole record when:
 *
 * - a figure would FALL. A falling count is what a blind reader looks like,
 *   and so is a corpus that really shrank; only a person can tell the two
 *   apart, so a fall is a hand edit with the reason in the commit;
 * - a recorded id was asserted by no test, so the file names a floor that no
 *   longer exists (or a run that did not reach it);
 * - one id was asserted from two places, or read two values: two guards
 *   sharing a figure would let either go blind behind the other;
 * - either run failed or did not start, Docker included.
 *
 * `npm run floors:record -- --unit` runs the unit suite alone (#548) and
 * carries every Playwright floor unchanged, naming them: for a change that
 * moves no browser floor, which CI then judges as it judges every floor.
 *
 * One id read two different values when its figure differs by engine, so
 * that refusal is also where a floor that needs one id per engine shows.
 *
 * CI never records, for the reason CI never passes `--update-snapshots`: a
 * run that can rewrite the figure it checks against asserts nothing.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, posix, relative, sep } from 'node:path';
import { argv, env } from 'node:process';

import { die, messageOf, nonEmpty } from './errors.mjs';
import { containerArgs, localImage } from './playwright-image.mjs';

const UNIT = 'unit suite';
const PLAYWRIGHT = 'Playwright run';
const UNIT_ONLY = '--unit';

/** The recorded figures: one home, which `tests/floors.ts` imports. */
export const FLOORS_FILE = 'tests/floors.json';

/**
 * Set to a file for the run's `floorBreach` calls to append what they saw
 * to, instead of judging it (`tests/floors.ts`).
 */
export const RECORD_ENV = 'FLOORS_RECORD';

/**
 * @typedef {{ id: string, actual: number, site: string }} Observation
 */

/**
 * The record run's scratch directory is made in the checkout, git-ignored,
 * because the container mounts the checkout and nothing else: a record file
 * in the host's temporary directory is one the Playwright run cannot reach,
 * and `test-results/` is emptied by Playwright as it starts.
 */
export const RECORD_DIR_PREFIX = '.floors-record-';

const E2E_DIR = 'tests/e2e';

/**
 * The Playwright specs that call `floorBreach`, which the record run is
 * limited to: every other spec would cost minutes and record nothing. Read
 * from each spec's text, so one that names the function only in a comment
 * runs for nothing; `tests/unit/floors.test.ts` holds this list equal to the
 * specs whose parse tree calls it.
 *
 * @param {string} [dir]
 * @returns {string[]}
 */
export const floorSpecs = (dir = E2E_DIR) =>
  nonEmpty(
    readdirSync(dir).filter((name) => name.endsWith('.spec.ts')),
    `Playwright specs in ${dir}`,
  )
    .map((name) => join(dir, name))
    .filter((file) => /\bfloorBreach\(/.test(readFileSync(file, 'utf8')))
    .sort();

/**
 * Why a suite's record run cannot be trusted, or nothing. One judge for the
 * unit suite and the Playwright run, so a Playwright run is refused exactly
 * as a unit run is (#475): one that never started has no exit status and its
 * error names why; one that exited non-zero, or was killed, is a failed run.
 *
 * @param {string} suite
 * @param {{ status: number | null, error?: Error }} run
 * @returns {string | undefined}
 */
export const runRefusal = (suite, { status, error }) =>
  error !== undefined
    ? `the ${suite} did not start: ${messageOf(error)}`
    : status !== 0
      ? `the ${suite} failed in record mode (exit ${status}): nothing recorded`
      : undefined;

/**
 * The argument vector for `docker` that records the Playwright floors: every
 * project over `specs`, in the image CI runs the e2e suite in, with
 * `RECORD_ENV` naming `record` as the container sees it. A layout count
 * measured on macOS is not the one CI reads, so the e2e floors are measured
 * where CI measures them (#475).
 *
 * @param {object} options
 * @param {string} options.image the pinned Playwright image
 * @param {string} options.cwd the repo root, mounted at /work
 * @param {string} options.record the record file, inside `cwd`
 * @param {readonly string[]} options.specs the specs that call floorBreach
 * @returns {string[]}
 */
export const playwrightRecordArgs = ({ image, cwd, record, specs }) => {
  const inside = relative(cwd, record);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside))
    throw new Error(
      `${record} is outside ${cwd}, where the container cannot write it`,
    );
  // Never empty: Playwright reads no file filter as every spec.
  if (specs.length === 0)
    throw new Error('no Playwright spec calls floorBreach');
  return containerArgs({
    image,
    cwd,
    env: { [RECORD_ENV]: posix.join('/work', ...inside.split(sep)) },
    // One worker. Each browser is emulated on Apple Silicon, and two at once
    // took the feature-words journeys to 40-52s against their 30s budget:
    // 11 of 35 failed on four engines in the first record run, all timing
    // out early in the journey. One at a time, WebKit's four passed in 1.5
    // minutes (measured 2026-10-05). The default count, derived from the
    // CPUs, has frozen this laptop before.
    command: 'npx playwright test --workers=1 "$@"',
    operands: specs,
  });
};

/**
 * The recorded ids a unit-only record (`--unit`, #548) carries unchanged:
 * those a Playwright floor spec spells as a string, in either quote, that the
 * unit run did not assert. Every id is a string literal in exactly one place
 * under `tests/` (`literal-floors.test.ts`), so where it is spelled is where
 * it is checked. A carried figure is not measured; CI judges it.
 *
 * @param {readonly string[]} ids the recorded ids
 * @param {readonly string[]} specTexts the specs `floorSpecs()` names, read
 * @param {ReadonlySet<string>} asserted the ids the unit run asserted
 * @returns {string[]}
 */
export const carriedIds = (ids, specTexts, asserted) =>
  ids.filter(
    (id) =>
      !asserted.has(id) &&
      specTexts.some(
        (text) => text.includes(`'${id}'`) || text.includes(`"${id}"`),
      ),
  );

/**
 * What a record run wrote, one observation per line; nothing when it wrote
 * no file.
 *
 * @param {string} file
 * @returns {Observation[]}
 */
const observationsIn = (file) =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line))
    : [];

/**
 * The next figures, and every reason not to write them. The caller writes
 * `next` only when `refusals` is empty.
 *
 * `carried` names recorded ids the run was not asked to measure (`--unit`
 * leaves the Playwright ones out, #548): each keeps its figure instead of
 * being refused as unasserted. One the run did assert is judged as any other.
 *
 * @param {Readonly<Record<string, number>>} recorded
 * @param {readonly Observation[]} seen
 * @param {readonly string[]} [carried]
 * @returns {{ next: Record<string, number>, refusals: string[] }}
 */
export const decideRecord = (recorded, seen, carried = []) => {
  /** @type {Map<string, Observation[]>} */
  const byId = new Map();
  for (const observation of seen)
    byId.set(observation.id, [
      ...(byId.get(observation.id) ?? []),
      observation,
    ]);

  /** @type {Record<string, number>} */
  const next = { ...recorded };
  /** @type {string[]} */
  const refusals = [];
  for (const [id, observations] of byId) {
    const sites = [...new Set(observations.map(({ site }) => site))];
    const values = [...new Set(observations.map(({ actual }) => actual))];
    if (sites.length > 1) {
      refusals.push(`${id} is asserted from two places: ${sites.join(', ')}`);
      continue;
    }
    if (values.length > 1) {
      refusals.push(`${id} read two different values: ${values.join(', ')}`);
      continue;
    }
    const [actual] = values;
    const measured = recorded[id];
    if (measured !== undefined && actual < measured) {
      refusals.push(
        `${id} would fall from ${measured} to ${actual}: a blind reader looks ` +
          `like this. If the corpus really shrank, lower it in ${FLOORS_FILE} ` +
          `by hand and say why in the commit.`,
      );
      continue;
    }
    next[id] = actual;
  }
  for (const id of Object.keys(recorded))
    if (!byId.has(id) && !carried.includes(id))
      refusals.push(
        `${id} is recorded but no test asserted it: remove it from ` +
          `${FLOORS_FILE} with the floor that used it, or run the whole suite`,
      );
  return { next, refusals };
};

/**
 * One line per figure that moved, largest move first: `id: 100 -> 125 (+25)`,
 * or `id: new, 3`.
 *
 * Printed because a raise is accepted on its direction alone. A change that
 * adds five units and quietly makes the reader miss three records +2, and
 * nothing goes red; only a person reading each delta against the diff that
 * caused it can see that (operator, 2026-10-03). A guard with an independent
 * cross-check (#469) catches it mechanically; until every guard has one, the
 * delta is what gets read.
 *
 * @param {Readonly<Record<string, number>>} recorded
 * @param {Readonly<Record<string, number>>} next
 * @returns {string[]}
 */
export const describeMoves = (recorded, next) =>
  Object.keys(next)
    .filter((id) => next[id] !== recorded[id])
    .map((id) => ({ id, delta: next[id] - (recorded[id] ?? 0) }))
    .sort((a, b) => b.delta - a.delta || (a.id < b.id ? -1 : 1))
    .map(({ id }) =>
      recorded[id] === undefined
        ? `${id}: new, ${next[id]}`
        : `${id}: ${recorded[id]} -> ${next[id]} (+${next[id] - recorded[id]})`,
    );

/**
 * The file's text: ids sorted, two-space indented, a final newline, which is
 * also what prettier writes, so a record never leaves the tree unformatted.
 *
 * @param {Readonly<Record<string, number>>} floors
 * @returns {string}
 */
export const floorsText = (floors) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(floors).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
    null,
    2,
  ) + '\n';

/**
 * @returns {void}
 */
const main = () => {
  if (env.CI) die('CI never records floors: run npm run floors:record locally');
  const args = argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== UNIT_ONLY))
    die(
      `usage: npm run floors:record [-- ${UNIT_ONLY}] (got ${args.join(' ')})`,
    );
  // The unit floors alone (#548): a change that moves no Playwright floor
  // need not pay for the container, about five minutes a record.
  const unitOnly = args[0] === UNIT_ONLY;

  /** @type {Readonly<Record<string, number>>} */
  const recorded = existsSync(FLOORS_FILE)
    ? JSON.parse(readFileSync(FLOORS_FILE, 'utf8'))
    : {};

  // Asked first, before minutes of unit suite: without Docker the Playwright
  // floors cannot be recorded, and they are never recorded on this machine.
  const docker = unitOnly
    ? undefined
    : runRefusal(
        PLAYWRIGHT,
        spawnSync('docker', ['--version'], { stdio: 'ignore' }),
      );
  if (docker !== undefined) die(docker);
  const specs = floorSpecs();
  if (specs.length === 0)
    die('no Playwright spec calls floorBreach: nothing to record there');

  // Collected inside the try and judged after it: `die` exits at once, which
  // skips any `finally` still pending, and the scratch directory would leak.
  const cwd = process.cwd();
  const dir = mkdtempSync(join(cwd, RECORD_DIR_PREFIX));
  /** @type {string | undefined} */
  let refusal;
  /** @type {Observation[]} */
  let seen = [];
  try {
    const unit = join(dir, 'unit.jsonl');
    const e2e = join(dir, 'e2e.jsonl');
    refusal = runRefusal(
      UNIT,
      spawnSync('npx', ['vitest', 'run'], {
        stdio: 'inherit',
        env: { ...env, [RECORD_ENV]: unit },
      }),
    );
    if (refusal === undefined && !unitOnly) {
      const image = localImage();
      console.log(
        `Recording the Playwright floors in ${image}: ${specs.join(' ')}`,
      );
      refusal = runRefusal(
        PLAYWRIGHT,
        spawnSync(
          'docker',
          playwrightRecordArgs({ image, cwd, record: e2e, specs }),
          { stdio: 'inherit' },
        ),
      );
    }
    seen = [...observationsIn(unit), ...observationsIn(e2e)];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (refusal !== undefined) die(refusal);
  const carried = unitOnly
    ? carriedIds(
        Object.keys(recorded),
        specs.map((spec) => readFileSync(spec, 'utf8')),
        new Set(seen.map(({ id }) => id)),
      )
    : [];
  const { next, refusals } = decideRecord(recorded, seen, carried);
  if (refusals.length > 0) die(`nothing recorded:\n  ${refusals.join('\n  ')}`);
  if (carried.length > 0)
    console.log(
      `${UNIT_ONLY}: not measured, carried unchanged for CI to judge: ` +
        carried.join(', '),
    );

  const moves = describeMoves(recorded, next);
  writeFileSync(FLOORS_FILE, floorsText(next));
  console.log(
    moves.length === 0
      ? `${FLOORS_FILE}: every floor already matches (${seen.length} read)`
      : [
          `${FLOORS_FILE}: ${moves.length} floor(s) moved:`,
          ...moves.map((move) => `  ${move}`),
          'Read each one against your diff: a raise smaller than the units you',
          'added is a reader that lost some. Put these lines in the commit.',
        ].join('\n'),
  );
};

// Only when run, never when imported: the unit suite imports the decision.
if (import.meta.main) main();
