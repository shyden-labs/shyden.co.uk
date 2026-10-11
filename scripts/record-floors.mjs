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
 * `npm run floors:record -- --unit` runs the unit, guards and integration
 * suites (#548) and carries every Playwright and functions floor unchanged,
 * naming them: for a change that moves no browser floor, which CI then judges
 * as it judges every floor. It is CI's mode, not the laptop's.
 *
 * `npm run floors:record -- --unit-suite` runs the unit suite alone, on every
 * pass, and carries every floor it did not see asserted (#658): the laptop runs
 * only the unit suite (operator rule 2026-10-09), and a branch that merged
 * develop in needs its unit floors right before its pre-push hook lets it
 * reach `record-floors.yml`, which records the rest.
 *
 * `npm run floors:record -- --functions` runs the Functions-runtime suite
 * alone (#610): `npm run test:functions`, which builds and serves the site on
 * workerd and posts real reports to it, on this machine (it needs no
 * credential and no container: its figures are row and request counts, not
 * layout). A full record runs it too, after the Playwright run. Where a
 * functions id is new, the unit suite runs once more, as in every mode, for the
 * floor that counts the record's ids; the Playwright figures are carried.
 *
 * `npm run floors:record -- --retire <id>` (#640, any mode, repeatable) drops
 * an id the branch itself created and no test spells any more, in the same run
 * that records its replacement: the floors that count the record's ids are
 * judged on the ids it writes, not before them. An id `origin/develop` holds is
 * refused, as is any id when develop cannot be read. A hand edit of
 * `tests/floors.json` is still the operator's in two cases only: a landed
 * floor that falls, and a landed id that leaves; say why in the commit.
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
const UNIT_SUITE_ONLY = '--unit-suite';
const MODES = [UNIT_ONLY, FUNCTIONS_ONLY, UNIT_SUITE_ONLY];

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
 * The environment a suite the recorder starts runs in: the recorder's own,
 * less the in-image flag, with `record` as the file its floors are written to.
 * The flag is an instruction to this script alone. An integration test that
 * runs this script as a child would otherwise inherit it, believe it was the
 * recorder in the image, and skip the refusal under CI it exists to check
 * (#651: seven such failures on the first real dispatch).
 *
 * @param {Readonly<Record<string, string | undefined>>} environment
 * @param {string} record
 * @returns {Record<string, string | undefined>}
 */
export const childEnv = (environment, record) => {
  const { [IN_IMAGE_ENV]: _flag, ...rest } = environment;
  return { ...rest, [RECORD_ENV]: record };
};

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
 * The suites a record runs on `pass`, by mode (#658). A later pass runs only
 * to settle the ids the pass before it added, so it reruns the Vitest suites
 * and never Playwright or the functions suite; `--unit-suite` reruns the unit
 * suite alone, since the laptop runs nothing else.
 *
 * @param {string | undefined} mode the one argument, or none for a full record
 * @param {number} pass
 * @returns {{ unit: boolean, guards: boolean, integration: boolean, playwright: boolean, functions: boolean }}
 */
export const recordSuites = (mode, pass) => {
  const vitest = pass > 1 || mode !== FUNCTIONS_ONLY;
  const unitAlone = mode === UNIT_SUITE_ONLY;
  return {
    unit: vitest,
    guards: vitest && !unitAlone,
    integration: vitest && !unitAlone,
    playwright: pass === 1 && mode === undefined,
    functions: pass === 1 && (mode === undefined || mode === FUNCTIONS_ONLY),
  };
};

/**
 * The recorded ids a mode carries unmeasured, given the ids the run asserted
 * (#658): `--unit` those a Playwright or functions spec spells (#548);
 * `--functions` every one no functions spec spells (#610); a full record
 * none. In those modes an id its own suite spells and the run did not assert
 * is a floor that lost its test, and is refused. `--unit-suite` carries every
 * id the unit run did not assert: telling a unit floor that lost its test from
 * a guards one would take a second walk of `tests/` beside the one home in
 * `tests/source-files.ts`, and `record-floors.yml` refuses a lost test anyway,
 * since its full record carries nothing.
 *
 * @param {string | undefined} mode
 * @param {readonly string[]} ids the recorded ids
 * @param {ReadonlySet<string>} asserted
 * @param {{ specTexts: readonly string[], functionsTexts: readonly string[] }} texts
 * @returns {string[]}
 */
export const carriedFor = (mode, ids, asserted, texts) =>
  mode === UNIT_ONLY
    ? carriedIds(ids, [...texts.specTexts, ...texts.functionsTexts], asserted)
    : mode === FUNCTIONS_ONLY
      ? carriedOutside(ids, texts.functionsTexts, asserted)
      : mode === UNIT_SUITE_ONLY
        ? ids.filter((id) => !asserted.has(id))
        : [];

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
  const { next, refusals } = judgeRecord(recorded, seen, carried);
  return { next, refusals };
};

/**
 * `decideRecord`, also naming the refusals that are falls (#640): those are
 * the only ones the record's own ids can cause, so a pass that added ids
 * measures again before calling them final.
 *
 * @param {Readonly<Record<string, number>>} recorded
 * @param {readonly Observation[]} seen
 * @param {readonly string[]} carried
 * @returns {{ next: Record<string, number>, refusals: string[], falls: number }}
 */
const judgeRecord = (recorded, seen, carried) => {
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
  let falls = 0;
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
      falls++;
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
  return { next, refusals, falls };
};

/**
 * Why each id named to `--retire` may not leave the record, or nothing (#640).
 *
 * Only a branch-only id leaves this way: one `origin/develop`'s record does not
 * hold and no file under `tests/` spells. A landed floor is the operator's to
 * drop, by hand with the reason in the commit, as a fall is. A develop record
 * that could not be read refuses every id: unknown is never "not on develop".
 *
 * @param {readonly string[]} ids the ids to retire
 * @param {{
 *   recorded: Readonly<Record<string, number>>,
 *   develop: Readonly<Record<string, number>> | string,
 *   spelledIn: (id: string) => readonly string[],
 * }} facts `develop` is origin/develop's record, or why it could not be read;
 *   `spelledIn` names the files under `tests/` that spell an id
 * @returns {string[]}
 */
export const retireRefusals = (ids, { recorded, develop, spelledIn }) =>
  ids.flatMap((id) => {
    if (!Object.hasOwn(recorded, id))
      return [`${id} is not in ${FLOORS_FILE}: nothing to retire`];
    if (typeof develop === 'string')
      return [
        `${id} cannot be retired: whether origin/develop holds it is unknown ` +
          `(${develop})`,
      ];
    if (Object.hasOwn(develop, id))
      return [
        `${id} is on origin/develop: a landed floor leaves the record only by ` +
          `the operator's ruling, as a hand edit of ${FLOORS_FILE} with the ` +
          'reason in the commit',
      ];
    const files = spelledIn(id);
    return files.length > 0
      ? [
          `${id} is still spelled in ${files.join(', ')}: retire it with the ` +
            'floor that used it',
        ]
      : [];
  });

const RETIRE = '--retire';

/**
 * The record's mode (`--unit`, `--functions`, `--unit-suite`, or the full
 * record) and the ids
 * to retire, or the usage line naming what was given.
 *
 * @param {readonly string[]} args
 * @returns {{ mode: string | undefined, retired: string[] } | string}
 */
export const recordArguments = (args) => {
  const usage =
    `usage: npm run floors:record [-- ${MODES.join(' | ')}] ` +
    `[${RETIRE} <id>]... (got ${args.join(' ')})`;
  /** @type {string[]} */
  const modes = [];
  /** @type {string[]} */
  const retired = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === RETIRE) {
      const id = args[i + 1];
      if (id === undefined || id.startsWith('-')) return usage;
      retired.push(id);
      i++;
    } else if (MODES.includes(arg)) modes.push(arg);
    else return usage;
  }
  return modes.length > 1 ? usage : { mode: modes[0], retired };
};

/** Passes a record may take before its ids are called unsettled. */
export const MAX_PASSES = 3;

/**
 * Measure and decide until a pass adds no id, then return that pass's figures.
 *
 * `retired` ids (#640) leave the record before the first pass, so every pass
 * reads the record the run would write. A pass that adds ids reads the floors
 * counting them short, so its falls are judged again over the ids it added;
 * any other refusal is final at once, and a pass that adds nothing is judged
 * whole. A bare retire therefore still reads as a fall and is refused.
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
 *   retired?: readonly string[],
 *   measure: (floors: Readonly<Record<string, number>>, pass: number) => readonly Observation[] | string,
 *   carry?: (seen: readonly Observation[]) => readonly string[],
 *   maxPasses?: number,
 * }} run
 * @returns {{ next: Record<string, number>, refusals: string[], failure: string | undefined, passes: number }}
 */
export const recordUntilSettled = ({
  recorded,
  retired = [],
  measure,
  carry = () => [],
  maxPasses = MAX_PASSES,
}) => {
  let floors = Object.fromEntries(
    Object.entries(recorded).filter(([id]) => !retired.includes(id)),
  );
  for (let pass = 1; pass <= maxPasses; pass++) {
    const seen = measure(floors, pass);
    if (typeof seen === 'string')
      return { next: floors, refusals: [], failure: seen, passes: pass };
    const { next, refusals, falls } = judgeRecord(floors, seen, [
      ...carry(seen),
    ]);
    const added = Object.keys(next).length > Object.keys(floors).length;
    if (
      (refusals.length > 0 && !(added && falls === refusals.length)) ||
      !added
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
 * or `id: new, 3`; then one per retired id (#640): `id: retired, was 3`.
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
    )
    .concat(
      Object.keys(recorded)
        .filter((id) => !Object.hasOwn(next, id))
        .sort()
        .map((id) => `${id}: retired, was ${recorded[id]}`),
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
 * `origin/develop`'s record, fetched first so a stale ref cannot answer "not
 * on develop", or why it could not be read.
 *
 * @returns {Record<string, number> | string}
 */
const developRecord = () => {
  const fetch = spawnSync('git', ['fetch', '--quiet', 'origin', 'develop'], {
    encoding: 'utf8',
  });
  const fetchRefusal = runRefusal('fetch of origin/develop', fetch);
  if (fetchRefusal !== undefined) return fetchRefusal;
  const show = spawnSync('git', ['show', `origin/develop:${FLOORS_FILE}`], {
    encoding: 'utf8',
  });
  const showRefusal = runRefusal(`read of origin/develop:${FLOORS_FILE}`, show);
  if (showRefusal !== undefined) return showRefusal;
  try {
    return JSON.parse(show.stdout);
  } catch (error) {
    return `origin/develop:${FLOORS_FILE} is not JSON: ${messageOf(error)}`;
  }
};

/**
 * The source files under `tests/` that spell `id` as a string, in any quote:
 * where `literal-floors.test.ts` reads every id from.
 *
 * @param {string} id
 * @returns {string[]}
 */
const spelledUnderTests = (id) =>
  nonEmpty(
    readdirSync('tests', { recursive: true, encoding: 'utf8' }).filter((name) =>
      /\.(?:tsx?|mjs|js)$/.test(name),
    ),
    'source files under tests/',
  )
    .map((name) => join('tests', name))
    .filter((file) =>
      ["'", '"', '`'].some((quote) =>
        readFileSync(file, 'utf8').includes(`${quote}${id}${quote}`),
      ),
    )
    .sort();

/**
 * @returns {void}
 */
const main = () => {
  const inImage = recordsInImage(env);
  if (env.CI && !inImage)
    die('CI never records floors: run npm run floors:record locally');
  const parsed = recordArguments(argv.slice(2));
  if (typeof parsed === 'string') die(parsed);
  const { mode, retired } = parsed;
  // `--unit` skips the container (#548), about five minutes a record;
  // `--functions` the hours of a whole record (#610); `--unit-suite` every
  // suite but the one the laptop runs (#658).
  const firstPass = recordSuites(mode, 1);

  /** @type {Readonly<Record<string, number>>} */
  const recorded = existsSync(FLOORS_FILE)
    ? JSON.parse(readFileSync(FLOORS_FILE, 'utf8'))
    : {};

  // Judged before any suite runs: a refused retire costs nothing.
  if (retired.length > 0) {
    const refusals = retireRefusals(retired, {
      recorded,
      develop: developRecord(),
      spelledIn: spelledUnderTests,
    });
    if (refusals.length > 0)
      die(`nothing recorded:\n  ${refusals.join('\n  ')}`);
  }

  // Asked first, before minutes of unit suite: without Docker the Playwright
  // floors cannot be recorded, and they are never recorded on this machine.
  const docker =
    !firstPass.playwright || inImage
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
    // The first pass reads the record the run would write: without the
    // retired ids, which no test spells any more.
    if (retired.length > 0)
      writeFileSync(
        FLOORS_FILE,
        floorsText(
          Object.fromEntries(
            Object.entries(recorded).filter(([id]) => !retired.includes(id)),
          ),
        ),
      );
    settled = recordUntilSettled({
      recorded,
      retired,
      carry: (seen) => {
        read = seen.length;
        const asserted = new Set(seen.map(({ id }) => id));
        const textsOf = (/** @type {readonly string[]} */ files) =>
          files.map((file) => readFileSync(file, 'utf8'));
        carried = carriedFor(mode, Object.keys(recorded), asserted, {
          specTexts: textsOf(specs),
          functionsTexts: textsOf(functionsSpecs),
        });
        return carried;
      },
      measure: (floors, pass) => {
        // A later pass reads the record the one before it decided. Only the
        // Vitest suites run again: no Playwright or functions test reads the
        // record's ids.
        const suites = recordSuites(mode, pass);
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
        if (suites.unit) {
          const unitRefusal = runRefusal(
            UNIT,
            spawnSync('npx', ['vitest', 'run'], {
              stdio: 'inherit',
              env: childEnv(env, unit),
            }),
          );
          if (unitRefusal !== undefined) return unitRefusal;
        }
        if (suites.guards) {
          // The guards suite asserts most of the floors (#638), so it runs into
          // the same record, with the limit its own script carries.
          const guardsRefusal = runRefusal(
            GUARDS,
            spawnSync('npx', guardsArguments(), {
              stdio: 'inherit',
              env: childEnv(env, unit),
            }),
          );
          if (guardsRefusal !== undefined) return guardsRefusal;
        }
        if (suites.integration) {
          // The integration suite asserts floors too (#630), so it runs into
          // the same record, with the limit its own script carries.
          const integrationRefusal = runRefusal(
            INTEGRATION,
            spawnSync('npx', integrationArguments(), {
              stdio: 'inherit',
              env: childEnv(env, unit),
            }),
          );
          if (integrationRefusal !== undefined) return integrationRefusal;
        }
        if (suites.playwright) {
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
              env:
                run.env === undefined
                  ? undefined
                  : childEnv(env, run.env[RECORD_ENV]),
            }),
          );
          if (e2eRefusal !== undefined) return e2eRefusal;
          e2eSeen = observationsIn(e2e);
        }
        if (suites.functions) {
          const functions = join(dir, 'functions.jsonl');
          console.log(
            `Recording the functions floors: ${functionsSpecs.join(' ')}`,
          );
          const functionsRefusal = runRefusal(
            FUNCTIONS,
            spawnSync('npm', ['run', 'test:functions'], {
              stdio: 'inherit',
              env: childEnv(env, functions),
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
    // A later pass, or a retire, wrote the record: put back what it found.
    if (passes > 1 || retired.length > 0)
      if (original === undefined) rmSync(FLOORS_FILE, { force: true });
      else writeFileSync(FLOORS_FILE, original);
    die(failure ?? `nothing recorded:\n  ${refusals.join('\n  ')}`);
  }
  if (carried.length > 0)
    console.log(
      `${mode}: not measured, carried ` +
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
