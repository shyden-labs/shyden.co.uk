import { describe, it, expect } from 'vitest';
import {
  BASELINE_DIR,
  CAPTURE_PIXEL_RULE,
  baselineChanges,
  captureMessage,
  captureSummary,
  capturedBaselines,
} from '../../scripts/visual-capture.mjs';
import { pngOf, rampPixels, withChangedPixels } from '../png-fixture';

/**
 * What the CI capture (#654) hands back to fold (#889): the baselines a
 * `--update-snapshots=all` run changed, and nothing else. `git status` after
 * it lists every rewritten file; a rewrite is committed only past the pixel
 * rule (#678). Anything else it changed is refused, never committed: the job
 * that writes runs no branch code, and it must not carry branch code's side
 * effects either.
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

/**
 * The pixel rule (#678): a rewrite is committed only when more than 60 pixels
 * differ from the committed baseline at zero tolerance. Operator 2026-10-11,
 * from every baseline rewrite on develop (294 over 31 commits): pages a change
 * never touched differed by 1 to 17 pixels, and every real change by 210 or
 * more; neither the largest channel step nor the visual gate's own threshold
 * told them apart (#371's dot grid moved 1,419 to 8,584 pixels and the gate
 * saw none of them).
 */
describe('capturedBaselines commits a rewrite only past the pixel rule', () => {
  it('is more than 60 pixels', () => {
    expect(CAPTURE_PIXEL_RULE).toBe(60);
  });

  const width = 10;
  const height = 10;
  const pixels = rampPixels(width, height);
  const file = png('home-en');
  const judged = (committed: Buffer | undefined, captured: Buffer) =>
    capturedBaselines([file], {
      committed: () => committed,
      captured: () => captured,
    });
  const picture = (bytes: Uint8Array) =>
    pngOf({ width, height, pixels: bytes });

  it('keeps a rewrite that moved 60 pixels, naming its count', () => {
    expect(
      judged(picture(pixels), picture(withChangedPixels(pixels, 60))),
    ).toEqual({
      commit: [],
      kept: [{ file, differing: 60 }],
    });
  });

  it('commits a rewrite that moved 61 pixels', () => {
    expect(
      judged(picture(pixels), picture(withChangedPixels(pixels, 61))),
    ).toEqual({
      commit: [{ file, differing: 61 }],
      kept: [],
    });
  });

  it('keeps a rewrite whose pixels did not move at all', () => {
    expect(judged(picture(pixels), picture(pixels)).kept).toEqual([
      { file, differing: 0 },
    ]);
  });

  it('commits a baseline captured for the first time, which has nothing to differ from', () => {
    expect(judged(undefined, picture(pixels))).toEqual({
      commit: [{ file, differing: 'new' }],
      kept: [],
    });
  });

  it('commits a rewrite whose size changed, which no count describes', () => {
    expect(
      judged(
        picture(pixels),
        pngOf({ width: 11, height, pixels: rampPixels(11, height) }),
      ),
    ).toEqual({ commit: [{ file, differing: 'size' }], kept: [] });
  });

  it('judges each file on its own pictures, in the order given', () => {
    const quiet = png('not-found');
    const result = capturedBaselines([quiet, file], {
      committed: () => picture(pixels),
      captured: (name) =>
        picture(withChangedPixels(pixels, name === quiet ? 17 : 100)),
    });
    expect(result).toEqual({
      commit: [{ file, differing: 100 }],
      kept: [{ file: quiet, differing: 17 }],
    });
  });
});

describe('captureSummary names every page committed and every page kept', () => {
  it('prints each with its count, so a page near the rule is seen next run', () => {
    expect(
      captureSummary({
        commit: [
          { file: png('home-en'), differing: 5148 },
          { file: png('home-th'), differing: 'new' },
          { file: png('yeetalk-calculators'), differing: 'size' },
        ],
        kept: [{ file: png('not-found'), differing: 17 }],
      }),
    ).toBe(
      [
        '3 baselines committed (more than 60 pixels differ, new, or a new size; #678):',
        `- \`${png('home-en')}\`: 5148 pixels differ`,
        `- \`${png('home-th')}\`: new`,
        `- \`${png('yeetalk-calculators')}\`: size changed`,
        '1 rewrite kept out (60 pixels or fewer differ):',
        `- \`${png('not-found')}\`: 17 pixels differ`,
      ].join('\n'),
    );
  });

  it('says plainly when nothing was committed', () => {
    expect(captureSummary({ commit: [], kept: [] })).toBe(
      'No baseline changed: no artifact uploaded, nothing to fold.',
    );
  });

  it('says one baseline, not one baselines', () => {
    expect(
      captureSummary({
        commit: [{ file: png('home-en'), differing: 61 }],
        kept: [],
      }),
    ).toBe(
      [
        '1 baseline committed (more than 60 pixels differ, new, or a new size; #678):',
        `- \`${png('home-en')}\`: 61 pixels differ`,
      ].join('\n'),
    );
  });

  it('says one pixel differs, not one pixels differ (#704)', () => {
    expect(
      captureSummary({
        commit: [],
        kept: [{ file: png('home-en'), differing: 1 }],
      }),
    ).toBe(
      [
        '0 baselines committed (more than 60 pixels differ, new, or a new size; #678):',
        '1 rewrite kept out (60 pixels or fewer differ):',
        `- \`${png('home-en')}\`: 1 pixel differs`,
      ].join('\n'),
    );
  });

  it('says zero pixels differ in the plural (#704)', () => {
    expect(
      captureSummary({
        commit: [],
        kept: [{ file: png('home-en'), differing: 0 }],
      }),
    ).toBe(
      [
        '0 baselines committed (more than 60 pixels differ, new, or a new size; #678):',
        '1 rewrite kept out (60 pixels or fewer differ):',
        `- \`${png('home-en')}\`: 0 pixels differ`,
      ].join('\n'),
    );
  });
});
