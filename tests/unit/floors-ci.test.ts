import { describe, expect, it } from 'vitest';
import { floorBreach } from '../floors';
import { searched } from '../source-files';
import {
  IN_IMAGE_ENV,
  RECORD_ENV,
  childEnv,
  playwrightRecordArgs,
  playwrightRecordRun,
  recordsInImage,
} from '../../scripts/record-floors.mjs';
import {
  amendedMessage,
  floorMoves,
  summaryLines,
} from '../../scripts/floors-diff.mjs';

/**
 * The CI recorder (#651): the Playwright floors are recorded where CI runs
 * them. On a laptop that is a `docker run` of the pinned image; inside that
 * image already (the dispatched job's container) it is the same Playwright
 * command run directly, and the commit it makes is worded from the JSON diff.
 */
describe('the recorder runs Playwright directly when it is already in the image (#651)', () => {
  const options = {
    image: 'mcr.microsoft.com/playwright:v1.0.0-noble@sha256:abc',
    cwd: '/work',
    record: '/work/.floors-record-x/e2e.jsonl',
    specs: ['tests/e2e/a.spec.ts', 'tests/e2e/b.spec.ts'],
  };

  it('wraps the command in docker run by default', () => {
    const run = playwrightRecordRun({ ...options, inImage: false });
    expect(run.file).toBe('docker');
    expect(run.args).toEqual(playwrightRecordArgs(options));
    expect(run.env).toBeUndefined();
  });

  it('runs the same Playwright command without docker when in the image', () => {
    expect(playwrightRecordRun({ ...options, inImage: true })).toEqual({
      file: 'npx',
      args: [
        'playwright',
        'test',
        '--workers=1',
        'tests/e2e/a.spec.ts',
        'tests/e2e/b.spec.ts',
      ],
      env: { [RECORD_ENV]: '/work/.floors-record-x/e2e.jsonl' },
    });
  });

  it('puts the same test command in the container as it runs directly', () => {
    const direct = playwrightRecordRun({ ...options, inImage: true }).args;
    const command = ['npx', ...direct.slice(0, 3)].join(' ');
    expect(
      playwrightRecordArgs(options).some((arg) =>
        arg.includes(`${command} "$@"`),
      ),
    ).toBe(true);
  });

  it('still refuses a record outside the checkout, in either form', () => {
    expect(() =>
      playwrightRecordRun({
        ...options,
        record: '/elsewhere/e2e',
        inImage: true,
      }),
    ).toThrow(/outside \/work/);
  });

  it('still refuses an empty spec list, in either form', () => {
    expect(() =>
      playwrightRecordRun({ ...options, specs: [], inImage: true }),
    ).toThrow(/no Playwright spec calls floorBreach/);
  });

  it('is switched on by exactly FLOORS_RECORD_IN_IMAGE=1', () => {
    expect(IN_IMAGE_ENV).toBe('FLOORS_RECORD_IN_IMAGE');
    expect(recordsInImage({ [IN_IMAGE_ENV]: '1' })).toBe(true);
    expect(recordsInImage({ [IN_IMAGE_ENV]: 'true' })).toBe(false);
    expect(recordsInImage({ [IN_IMAGE_ENV]: '' })).toBe(false);
    expect(recordsInImage({})).toBe(false);
  });
});

describe('the commit lists each moved floor, from the JSON diff (#651)', () => {
  const before = { 'a/one': 3, 'b/two': 10, 'c/three': 7 };

  it('lists a raise as id: old -> new', () => {
    expect(floorMoves(before, { ...before, 'b/two': 12 })).toEqual([
      { id: 'b/two', old: 10, next: 12 },
    ]);
  });

  it('lists a new id with no old figure', () => {
    expect(floorMoves(before, { ...before, 'd/four': 2 })).toEqual([
      { id: 'd/four', old: undefined, next: 2 },
    ]);
  });

  it('lists a removed id with no new figure', () => {
    const { 'c/three': _gone, ...rest } = before;
    expect(floorMoves(before, rest)).toEqual([
      { id: 'c/three', old: 7, next: undefined },
    ]);
  });

  it('lists a fall too: the diff does not judge, the recorder does', () => {
    expect(floorMoves(before, { ...before, 'a/one': 1 })).toEqual([
      { id: 'a/one', old: 3, next: 1 },
    ]);
  });

  it('lists nothing when nothing moved', () => {
    // Empty by design, so the inputs fed are the population.
    const cases = [{ case: 'identical files', after: { ...before } }];
    expect(
      searched(
        cases.flatMap(({ after }) => floorMoves(before, after)),
        { of: cases, what: 'floor files compared' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('floors-ci/nothing-moved-cases', cases.length),
    ).toBeUndefined();
  });

  it('sorts by id', () => {
    expect(
      floorMoves(
        { 'z/last': 1, 'a/first': 1 },
        { 'z/last': 2, 'a/first': 2 },
      ).map(({ id }) => id),
    ).toEqual(['a/first', 'z/last']);
  });
});

/**
 * The figures are folded into the commit they were measured on (operator
 * 2026-10-10, "Bot folds into the head"): every commit stays green on its
 * own. The commit keeps its message and gains one block naming what moved,
 * written ahead of its trailers so `Co-Authored-By` and the rest stay
 * trailers git can read.
 */
describe('the measured commit keeps its message and gains the moves (#651)', () => {
  const moves = [
    { id: 'a/one', old: 3, next: 4 },
    { id: 'd/four', old: undefined, next: 2 },
  ];
  const block = [
    'Floors recorded in CI (unit), 2 moved:',
    'a/one: 3 -> 4',
    'd/four: new -> 2',
  ];

  it('writes the moves ahead of the trailers', () => {
    const original = [
      'The subject (Refs #9)',
      '',
      'The body.',
      '',
      'Co-Authored-By: Someone <someone@example.test>',
      'Claude-Session: https://example.test/s',
      '',
    ].join('\n');
    expect(amendedMessage(original, moves, 'unit')).toBe(
      [
        'The subject (Refs #9)',
        '',
        'The body.',
        '',
        ...block,
        '',
        'Co-Authored-By: Someone <someone@example.test>',
        'Claude-Session: https://example.test/s',
        '',
      ].join('\n'),
    );
  });

  it('writes the moves last when the message has no trailers', () => {
    expect(amendedMessage('The subject\n\nThe body.\n', moves, 'unit')).toBe(
      ['The subject', '', 'The body.', '', ...block, ''].join('\n'),
    );
  });

  it('never takes the subject for a trailer, even one shaped like one', () => {
    expect(amendedMessage('chore: the subject\n', moves, 'unit')).toBe(
      ['chore: the subject', '', ...block, ''].join('\n'),
    );
  });

  it('keeps a merge commit message whole', () => {
    expect(
      amendedMessage(
        "Merge remote-tracking branch 'origin/develop'\n",
        moves,
        'full',
      ),
    ).toBe(
      [
        "Merge remote-tracking branch 'origin/develop'",
        '',
        'Floors recorded in CI (full), 2 moved:',
        'a/one: 3 -> 4',
        'd/four: new -> 2',
        '',
      ].join('\n'),
    );
  });

  it('adds no closing keyword beside an issue number', () => {
    expect(
      amendedMessage('The subject (Refs #9)\n', moves, 'full'),
    ).not.toMatch(/\b(clos|fix|resolv)\w*\s+#\d/i);
  });

  it('summarises a record that moved nothing, and dispatches nothing', () => {
    expect(summaryLines([], 'full')).toEqual([
      'No floor moved (full): nothing committed, nothing dispatched.',
    ]);
  });

  it('summarises a record that moved floors', () => {
    expect(summaryLines([{ id: 'a/one', old: 3, next: 4 }], 'full')).toEqual([
      '1 floor moved (full):',
      '- `a/one: 3 -> 4`',
    ]);
  });
});

describe('a suite the recorder starts never inherits the in-image flag (#651)', () => {
  // The first real dispatch (run 38022668233) failed 7 integration tests:
  // they run record-floors.mjs as a child, and with the flag inherited the
  // child believed it was the recorder in the image, so it skipped the
  // refusal under CI and ran Playwright directly.
  const parent = { [IN_IMAGE_ENV]: '1', CI: 'true', PATH: '/bin' };

  it('drops the flag and names the record, keeping everything else', () => {
    expect(childEnv(parent, '/tmp/unit-1.jsonl')).toEqual({
      CI: 'true',
      PATH: '/bin',
      [RECORD_ENV]: '/tmp/unit-1.jsonl',
    });
  });

  it('leaves the recorder its own flag', () => {
    childEnv(parent, '/tmp/unit-1.jsonl');
    expect(parent[IN_IMAGE_ENV]).toBe('1');
  });
});
