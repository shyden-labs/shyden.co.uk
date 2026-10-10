import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { filesUnder, searched } from '../source-files';
import { withoutTsComments } from '../unit/source-text';
import { floorBreach } from '../floors';

/**
 * Each command-line tool the device leg drives is spawned from one home, which
 * gives every call a deadline and an error that names the command (#390).
 *
 * A synchronous call to a wedged phone blocks the worker's event loop, so not
 * even the test timeout can fire: the gauntlet hangs with nothing to say why.
 * `adb` had nineteen such calls across five files. `xcrun devicectl` had two,
 * in the runner and the iOS session, each with its own copy of the parsing,
 * and only the runner's had been taught to name a listing of another shape.
 */
const HOMES = [
  { tool: 'adb', home: 'scripts/adb.mjs' },
  { tool: 'xcrun', home: 'scripts/devicectl.mjs' },
] as const;

const files = ['tests', 'scripts'].flatMap((dir) =>
  filesUnder(dir, (file) => /\.(ts|mjs)$/.test(file)),
);

/** A call that runs `tool`: any of the spawners, with the tool as a literal. */
const spawnsTool = (tool: string): RegExp =>
  new RegExp(
    String.raw`\b(?:execFileSync|execFile|spawnSync|spawn|execSync|exec|runWithDeadline)\(\s*['"\`]` +
      tool +
      String.raw`\b`,
  );

/** Each way the code runs a tool, as a source line naming it. */
const SPAWN_FORMS: ReadonlyArray<[string, (tool: string) => string]> = [
  ['execFileSync', (tool) => `execFileSync('${tool}', ['devices']);`],
  ['execFile', (tool) => `execFile('${tool}', ['devices'], done);`],
  ['spawnSync', (tool) => `spawnSync("${tool}", ['devices']);`],
  ['spawn', (tool) => `spawn(\`${tool}\`, ['devices']);`],
  ['execSync', (tool) => `execSync('${tool} devices');`],
  ['exec', (tool) => `exec('${tool} devices', done);`],
  [
    'runWithDeadline',
    (tool) => `runWithDeadline('${tool}', ['devices'], 5000);`,
  ],
  [
    'a call split over lines',
    (tool) => `spawnSync(\n  '${tool}',\n  ['devices'],\n);`,
  ],
];

describe.each(HOMES)('no file spawns $tool but $home', ({ tool, home }) => {
  it('reads every call site through the one home', () => {
    const spawns = spawnsTool(tool);
    const spawning = files.filter(
      (file) =>
        file !== home &&
        spawns.test(withoutTsComments(readFileSync(file, 'utf8'))),
    );
    expect(
      searched(spawning, {
        of: files,
        what: 'files under tests/ and scripts/',
      }),
    ).toEqual([]);
    expect(
      floorBreach('device-tool-homes/call-site-files', files.length),
    ).toBeUndefined();

    // The positive control: the home itself is caught by the same pattern, so
    // an empty list above is a fact about the other files and not a pattern
    // that has stopped matching anything.
    expect(
      spawns.test(withoutTsComments(readFileSync(home, 'utf8'))),
      `${home} spawns ${tool}`,
    ).toBe(true);
  });

  it('reads every file under tests/ and scripts/, and as many as there are', () => {
    expect(
      floorBreach('device-tool-homes/files', files.length),
    ).toBeUndefined();
    // The home is among them, so a walk that loses scripts/ fails too.
    expect(files).toContain(home);
  });

  it.each(SPAWN_FORMS)('reads a spawn written with %s', (_form, line) => {
    expect(spawnsTool(tool).test(line(tool))).toBe(true);
  });

  it('does not read a longer tool name as this one', () => {
    expect(spawnsTool(tool).test(`spawnSync('${tool}x', []);`)).toBe(false);
  });
});

/**
 * The runner and the Android preflight each read `adb devices` themselves, and
 * disagreed: the runner takes the phone `ANDROID_SERIAL` names among several,
 * while the preflight refused any listing that was not exactly one ready
 * device, so a two-phone setup the runner accepts failed preflight test 1.
 * Both now ask `androidAbsence`, beside the `adb` it reads (#390).
 */
describe('`adb devices` is read in one place', () => {
  it('only scripts/adb.mjs decides which listed device is ready', () => {
    const readsState = /\bstate\s*(?:===|:)\s*['"]device['"]/;
    const reading = files.filter((file) =>
      readsState.test(withoutTsComments(readFileSync(file, 'utf8'))),
    );
    expect(
      searched(reading, { of: files, what: 'files under tests/ and scripts/' }),
    ).toEqual(['scripts/adb.mjs']);
    expect(
      floorBreach('device-tool-homes/adb-reader-files', files.length),
    ).toBeUndefined();
  });
});
