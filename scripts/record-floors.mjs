/**
 * Record the guards' liveness floors (#468): `npm run floors:record`.
 *
 * Runs the unit suite, then the guards suite (#638), then the integration
 * suite (#630) with
 * `FLOORS_RECORD` set, so every `floorBreach` call
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
 * `npm run floors:record -- --functions` runs the Functions-runtime suite
 * alone (#610): `npm run test:functions`, which builds and serves the site on
 * workerd and posts real reports to it, on this machine (it needs no
 * credential and no container: its figures are row and request counts, not
 * layout). A full record runs it too, after the Playwright run. Where a
 * functions id is new, the unit suite runs once more, as in every mode, for the
 * floor that counts the record's ids; the Playwright figures are carried.
 *
 * One id read two different values when its figure differs by engine, so
 * that refusal is also where a floor that needs one id per engine shows.
 *
 * The gate never records, for the reason CI never passes
 * `--update-snapshots`: a run that can rewrite the figure it checks against
 * asserts nothing. Recording is `.github/workflows/record-floors.yml` (#651),
 * dispatched on a branch, never triggered by a push or a pull request: it runs
 * this script inside the pinned Playwright image (`FLOORS_RECORD_IN_IMAGE=1`,
 * so no `docker run` wraps the Playwright command), commits the moved figures
 * to the branch and dispatches `ci.yml` there, and the gate then judges that
 * commit as it judges every other. Any other run under `CI` still refuses.
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
const GUARDS = 'guards suite';
const INTEGRATION = 'integration suite';
const PLAYWRIGHT = 'Playwright run';
const FUNCTIONS = 'functions suite';
const UNIT_ONLY = '--unit';
const FUNCTIONS_ONLY = '--functions';

/**
 * A suite's command, read from the `test:<name>` script that carries its one
 * limit (#630, #638), so the record run and CI cannot differ on it. Refuses a
 * script of another shape rather than guessing.
 *
 * @param {string} name `integration` or `guards`
 */
const suiteArguments = (name) => {
  const { scripts } = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  const match = /^vitest run( --[\w-]+(?:[= ][\w.-]+)?)+$/.exec(
    scripts?.[`test:${name}`] ?? '',
  );
  if (match === null)
    die(
      `package.json has no test:${name} script of the shape vitest run --flag…`,
    );
  return scripts[`test:${name}`].split(' ');
};

export const integrationArguments = () => suiteArguments('integration');

export const guardsArguments = () => suiteArguments('guards');

/** The recorded figures: one home, which `tests/floors.ts` imports. */
export const FLOORS_FILE = 'tests/floors.json';

/**
 * Set to a file for the run's `floorBreach` calls to append what they saw
 * to, instead of judging it (`tests/floors.ts`).
 */
export const RECORD_ENV = 'FLOORS_RECORD';

/**
 * Set to `1` by the dispatched CI recorder (#651), which is already inside the
 * pinned Playwright image: the Playwright command runs directly instead of
 * through `docker run`, and the one refusal under `CI` is lifted.
 */
export const IN_IMAGE_ENV = 'FLOORS_RECORD_IN_IMAGE';

/**
 * @param {Readonly<Record<string, string | undefined>>} environment
 * @returns {boolean}
 */
export const recordsInImage = (environment) =>
  environment[IN_IMAGE_ENV] === '1';

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
const FUNCTIONS_DIR = 'tests/functions';

/**
 * The Playwright specs that call `floorBreach`, which the record run is
 * limited to: every other spec would cost minutes and record nothing. Read
 * from each spec's text, so one that names the function only in a comment
 * runs for nothing; `tests/guards/floors.test.ts` holds this list equal to the
 * specs whose parse tree calls it. `FUNCTIONS_DIR` is read the same way (#610).
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
  const inside = recordInside(cwd, record, specs);
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
    command: `${PLAYWRIGHT_TEST.join(' ')} "$@"`,
    operands: specs,
  });
};

/**
 * The Playwright command both forms run: one worker. One home, so the
 * container and the in-image run cannot differ on it.
 */
const PLAYWRIGHT_TEST = ['npx', 'playwright', 'test', '--workers=1'];

/**
 * @param {string} cwd
 * @param {string} record
 * @param {readonly string[]} specs
 * @returns {string} the record's path relative to `cwd`
 */
function recordInside(cwd, record, specs) {
  const inside = relative(cwd, record);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside))
    throw new Error(
      `${record} is outside ${cwd}, where the container cannot write it`,
    );
  // Never empty: Playwright reads no file filter as every spec.
  if (specs.length === 0)
    throw new Error('no Playwright spec calls floorBreach');
  return inside;
}

/**
 * The process that records the Playwright floors: `docker run` of the pinned
 * image on a laptop, or the same Playwright command run directly where the
 * process is already inside that image (#651, the dispatched CI recorder).
 *
 * @param {object} options
 * @param {boolean} options.inImage whether this process is in the image
 * @param {string} options.image the pinned Playwright image
 * @param {string} options.cwd the repo root
 * @param {string} options.record the record file, inside `cwd`
 * @param {readonly string[]} options.specs the specs that call floorBreach
 * @returns {{ file: string, args: string[], env: Record<string, string> | undefined }}
 */
export const playwrightRecordRun = ({ inImage, ...options }) => {
  if (!inImage)
    return {
      file: 'docker',
      args: playwrightRecordArgs(options),
      env: undefined,
    };
  recordInside(options.cwd, options.record, options.specs);
  const [file, ...command] = PLAYWRIGHT_TEST;
  return {
    file,
    args: [...command, ...options.specs],
    env: { [RECORD_ENV]: options.record },
  };
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
 * The recorded ids a functions-only record (`--functions`, #610) carries
 * unchanged: every one the run did not assert that no functions spec spells.
 * Those belong to the unit suite or the Playwright run, which this mode was
 * not asked to measure. One a functions spec spells and the run did not assert
 * is a floor whose test is gone, and is refused as in every mode.
 *
 * @param {readonly string[]} ids the recorded ids
 * @param {readonly string[]} functionsTexts the functions specs, read
 * @param {ReadonlySet<string>} asserted the ids the run asserted
 * @returns {string[]}
 */
export const carriedOutside = (ids, functionsTexts, asserted) =>
  ids.filter(
    (id) =>
      !asserted.has(id) &&
      !functionsTexts.some(
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

/** Passes a record may take before its ids are called unsettled. */
export const MAX_PASSES = 3;

/**
 * Measure and decide until a pass adds no id, then return that pass's figures.
 *
 * A floor may count the record itself: literal-floors' `recorded-ids` floors
 * the ids it holds. One pass reads the record before its new ids are in it,
 * so a pass that adds ids records that floor short (#525: read 90, recorded
 * 76), and the next run fails its own ratchet. Measuring again over the ids
 * the pass added settles it. A decision never drops an id (an unasserted one
 * is refused), so a pass that changes the ids has added some, and a pass
 * with as many ids as its record has settled.
 *
 * `measure(floors, pass)` runs the suites with `floors` as the record and
 * returns what they saw, or why they could not run; `carry(seen)` names the
 * recorded ids the pass was not asked to measure.
 *
 * @param {{
 *   recorded: Readonly<Record<string, number>>,
 *   measure: (floors: Readonly<Record<string, number>>, pass: number) => readonly Observation[] | string,
 *   carry?: (seen: readonly Observation[]) => readonly string[],
 *   maxPasses?: number,
 * }} run
 * @returns {{ next: Record<string, number>, refusals: string[], failure: string | undefined, passes: number }}
 */
export const recordUntilSettled = ({
  recorded,
  measure,
  carry = () => [],
  maxPasses = MAX_PASSES,
}) => {
  let floors = { ...recorded };
  for (let pass = 1; pass <= maxPasses; pass++) {
    const seen = measure(floors, pass);
    if (typeof seen === 'string')
      return { next: floors, refusals: [], failure: seen, passes: pass };
    const { next, refusals } = decideRecord(floors, seen, [...carry(seen)]);
    if (
      refusals.length > 0 ||
      Object.keys(next).length === Object.keys(floors).length
    )
      return { next, refusals, failure: undefined, passes: pass };
    floors = next;
  }
  return {
    next: floors,
    refusals: [
      `the recorded ids never held still in ${maxPasses} passes: each added ` +
        'some, so no floor counting them can be trusted',
    ],
    failure: undefined,
    passes: maxPasses,
  };
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
  const inImage = recordsInImage(env);
  if (env.CI && !inImage)
    die('CI never records floors: run npm run floors:record locally');
  const args = argv.slice(2);
  if (
    args.length > 1 ||
    (args.length === 1 && ![UNIT_ONLY, FUNCTIONS_ONLY].includes(args[0]))
  )
    die(
      `usage: npm run floors:record [-- ${UNIT_ONLY} | ${FUNCTIONS_ONLY}] ` +
        `(got ${args.join(' ')})`,
    );
  // The unit floors alone (#548): a change that moves no Playwright floor
  // need not pay for the container, about five minutes a record.
  const unitOnly = args[0] === UNIT_ONLY;
  // The functions floors alone (#610): the suite takes minutes, the whole
  // record hours.
  const functionsOnly = args[0] === FUNCTIONS_ONLY;

  /** @type {Readonly<Record<string, number>>} */
  const recorded = existsSync(FLOORS_FILE)
    ? JSON.parse(readFileSync(FLOORS_FILE, 'utf8'))
    : {};

  // Asked first, before minutes of unit suite: without Docker the Playwright
  // floors cannot be recorded, and they are never recorded on this machine.
  const docker =
    unitOnly || functionsOnly || inImage
      ? undefined
      : runRefusal(
          PLAYWRIGHT,
          spawnSync('docker', ['--version'], { stdio: 'ignore' }),
        );
  if (docker !== undefined) die(docker);
  const specs = floorSpecs();
  if (specs.length === 0)
    die('no Playwright spec calls floorBreach: nothing to record there');
  const functionsSpecs = floorSpecs(FUNCTIONS_DIR);
  if (functionsSpecs.length === 0)
    die('no functions spec calls floorBreach: nothing to record there');

  // Collected inside the try and judged after it: `die` exits at once, which
  // skips any `finally` still pending, and the scratch directory would leak.
  const cwd = process.cwd();
  const dir = mkdtempSync(join(cwd, RECORD_DIR_PREFIX));
  const original = existsSync(FLOORS_FILE)
    ? readFileSync(FLOORS_FILE)
    : undefined;
  /** @type {readonly string[]} */
  let carried = [];
  let read = 0;
  /** @type {readonly Observation[]} */
  let e2eSeen = [];
  /** @type {readonly Observation[]} */
  let functionsSeen = [];
  let settled;
  try {
    settled = recordUntilSettled({
      recorded,
      carry: (seen) => {
        read = seen.length;
        const asserted = new Set(seen.map(({ id }) => id));
        const functionsTexts = functionsSpecs.map((spec) =>
          readFileSync(spec, 'utf8'),
        );
        carried = unitOnly
          ? carriedIds(
              Object.keys(recorded),
              [...specs, ...functionsSpecs].map((spec) =>
                readFileSync(spec, 'utf8'),
              ),
              asserted,
            )
          : functionsOnly
            ? carriedOutside(Object.keys(recorded), functionsTexts, asserted)
            : [];
        return carried;
      },
      measure: (floors, pass) => {
        // A later pass reads the record the one before it decided. Only the
        // unit suite runs again: no Playwright or functions test reads the
        // record's ids.
        if (pass > 1) {
          writeFileSync(FLOORS_FILE, floorsText(floors));
          console.log(
            `${FLOORS_FILE}: ids were added, so the unit suite runs again ` +
              `(pass ${pass}): a floor may count the ids the record holds`,
          );
        }
        const unit = join(dir, `unit-${pass}.jsonl`);
        // `--functions` measures the functions suite alone; the unit suite
        // runs only to settle the ids that pass added.
        if (!functionsOnly || pass > 1) {
          const unitRefusal = runRefusal(
            UNIT,
            spawnSync('npx', ['vitest', 'run'], {
              stdio: 'inherit',
              env: { ...env, [RECORD_ENV]: unit },
            }),
          );
          if (unitRefusal !== undefined) return unitRefusal;
          // The guards suite asserts most of the floors (#638), so it runs into
          // the same record, with the limit its own script carries.
          const guardsRefusal = runRefusal(
            GUARDS,
            spawnSync('npx', guardsArguments(), {
              stdio: 'inherit',
              env: { ...env, [RECORD_ENV]: unit },
            }),
          );
          if (guardsRefusal !== undefined) return guardsRefusal;
          // The integration suite asserts floors too (#630), so it runs into
          // the same record, with the limit its own script carries.
          const integrationRefusal = runRefusal(
            INTEGRATION,
            spawnSync('npx', integrationArguments(), {
              stdio: 'inherit',
              env: { ...env, [RECORD_ENV]: unit },
            }),
          );
          if (integrationRefusal !== undefined) return integrationRefusal;
        }
        if (pass === 1 && !unitOnly && !functionsOnly) {
          const image = inImage ? 'the running container' : localImage();
          const e2e = join(dir, 'e2e.jsonl');
          console.log(
            `Recording the Playwright floors in ${image}: ${specs.join(' ')}`,
          );
          const run = playwrightRecordRun({
            inImage,
            image,
            cwd,
            record: e2e,
            specs,
          });
          const e2eRefusal = runRefusal(
            PLAYWRIGHT,
            spawnSync(run.file, run.args, {
              stdio: 'inherit',
              env: run.env === undefined ? undefined : { ...env, ...run.env },
            }),
          );
          if (e2eRefusal !== undefined) return e2eRefusal;
          e2eSeen = observationsIn(e2e);
        }
        if (pass === 1 && !unitOnly) {
          const functions = join(dir, 'functions.jsonl');
          console.log(
            `Recording the functions floors: ${functionsSpecs.join(' ')}`,
          );
          const functionsRefusal = runRefusal(
            FUNCTIONS,
            spawnSync('npm', ['run', 'test:functions'], {
              stdio: 'inherit',
              env: { ...env, [RECORD_ENV]: functions },
            }),
          );
          if (functionsRefusal !== undefined) return functionsRefusal;
          functionsSeen = observationsIn(functions);
        }
        return [
          ...(existsSync(unit) ? observationsIn(unit) : []),
          ...e2eSeen,
          ...functionsSeen,
        ];
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const { next, refusals, failure, passes } = settled;
  if (failure !== undefined || refusals.length > 0) {
    // A later pass ran over a record this run wrote: put back what it found.
    if (passes > 1)
      if (original === undefined) rmSync(FLOORS_FILE, { force: true });
      else writeFileSync(FLOORS_FILE, original);
    die(failure ?? `nothing recorded:\n  ${refusals.join('\n  ')}`);
  }
  if (carried.length > 0)
    console.log(
      `${unitOnly ? UNIT_ONLY : FUNCTIONS_ONLY}: not measured, carried ` +
        'unchanged for CI to judge: ' +
        carried.join(', '),
    );

  const moves = describeMoves(recorded, next);
  writeFileSync(FLOORS_FILE, floorsText(next));
  console.log(
    moves.length === 0
      ? `${FLOORS_FILE}: every floor already matches (${read} read)`
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
