import { describe, it, expect } from 'vitest';
import {
  BASELINE_DIR,
  baselineChanges,
  captureMessage,
} from '../../scripts/visual-capture.mjs';

/**
 * What the CI capture (#654) commits back to a branch: the baselines a
 * `--update-snapshots=all` run changed, and nothing else. A capture renders
 * byte-identically where nothing moved (measured, browser-matrix.test.ts), so
 * `git status` after it IS the list of changed baselines. Anything else it
 * changed is refused, never committed: the job that writes runs no branch
 * code, and it must not carry branch code's side effects either.
 */

const png = (name: string) => `${BASELINE_DIR}${name}-linux.png`;

describe('baselineChanges reads what a capture changed', () => {
  it('reads a rewritten baseline', () => {
    expect(baselineChanges(` M ${png('home-en')}\n`)).toEqual({
      baselines: [png('home-en')],
      other: [],
    });
  });

  it('reads a baseline captured for the first time', () => {
    expect(baselineChanges(`?? ${png('home-th')}\n`)).toEqual({
      baselines: [png('home-th')],
      other: [],
    });
  });

  it('reads a staged rewrite the same way', () => {
    expect(baselineChanges(`M  ${png('home-en')}\n`).baselines).toEqual([
      png('home-en'),
    ]);
  });

  it('reads every line, in order', () => {
    expect(
      baselineChanges(` M ${png('a')}\n?? ${png('b')}\n M ${png('c')}\n`)
        .baselines,
    ).toEqual([png('a'), png('b'), png('c')]);
  });

  it('refuses a deleted baseline: a capture never removes one', () => {
    expect(baselineChanges(` D ${png('home-en')}\n`)).toEqual({
      baselines: [],
      other: [` D ${png('home-en')}`],
    });
  });

  it('refuses a change outside the baselines', () => {
    expect(baselineChanges(' M src/styles/tokens.css\n').other).toEqual([
      ' M src/styles/tokens.css',
    ]);
  });

  it('refuses a file in the baseline folder that is not a PNG', () => {
    expect(baselineChanges(`?? ${BASELINE_DIR}notes.txt\n`).other).toEqual([
      `?? ${BASELINE_DIR}notes.txt`,
    ]);
  });

  it('refuses a quoted path rather than guess at it', () => {
    expect(
      baselineChanges(`?? "${BASELINE_DIR}a b-linux.png"\n`).other,
    ).toHaveLength(1);
  });

  it('reads an empty status as nothing changed', () => {
    expect(baselineChanges('')).toEqual({ baselines: [], other: [] });
  });
});

describe('captureMessage names every baseline it folds in', () => {
  const files = [png('home-en'), png('home-id')];

  it('adds the block ahead of the trailers', () => {
    expect(
      captureMessage(
        'The subject\n\nThe body.\n\nCo-Authored-By: A <a@example.com>\n',
        files,
      ),
    ).toBe(
      'The subject\n\nThe body.\n\n' +
        'Visual baselines captured in CI (visual-capture.yml), 2 changed:\n' +
        `${png('home-en')}\n${png('home-id')}\n\n` +
        'Co-Authored-By: A <a@example.com>\n',
    );
  });

  it('adds it last when there are no trailers', () => {
    expect(captureMessage('The subject\n', [png('home-en')])).toBe(
      'The subject\n\n' +
        'Visual baselines captured in CI (visual-capture.yml), 1 changed:\n' +
        `${png('home-en')}\n`,
    );
  });
});
