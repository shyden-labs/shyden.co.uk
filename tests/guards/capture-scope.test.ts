import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  CAPTURE_ENTRIES,
  OUTSIDE_TREES,
  importClosure,
  isCapturePath,
} from '../../scripts/capture-scope.mjs';
import { searched, trackedFiles } from '../source-files';
import { floorBreach } from '../floors';

/**
 * The scope job traces the capture's files on every pull request (#774), and
 * a trace that stops runs the capture: safe, but a filter that never skips.
 * So the real tree is traced here, where a stop is a failure with its reason,
 * and the trace is held to reach what it must and to leave out what it can.
 */
const trace = () =>
  importClosure(
    [
      ...trackedFiles((path) => path.startsWith('tests/e2e/')),
      ...CAPTURE_ENTRIES,
    ],
    { read: (path) => readFileSync(path, 'utf8'), exists: existsSync },
  );

describe('the capture scope traces the real tree (#774)', () => {
  it('traces every e2e file and entry to a fixed point', () => {
    const closure = trace();
    // Known positives outside tests/e2e/: the engine list playwright.config.ts
    // imports, and the evidence file names tests/e2e/evidence.ts imports.
    expect(closure.has('tests/engines.ts')).toBe(true);
    expect(closure.has('scripts/evidence-files.mjs')).toBe(true);
    expect(
      floorBreach('capture-scope/traced-files', closure.size),
    ).toBeUndefined();
  });

  it('still leaves a unit test and a git hook out, so the filter can skip', () => {
    const closure = trace();
    expect(isCapturePath('tests/unit/capture-scope.test.ts', closure)).toBe(
      false,
    );
    expect(isCapturePath('.githooks/commit-msg', closure)).toBe(false);
  });

  it('names only trees that exist', () => {
    const missing = OUTSIDE_TREES.filter((tree) => !existsSync(tree));
    expect(
      searched(missing, { of: OUTSIDE_TREES, what: 'trees the capture skips' }),
    ).toEqual([]);
    expect(
      floorBreach('capture-scope/outside-trees', OUTSIDE_TREES.length),
    ).toBeUndefined();
  });
});
