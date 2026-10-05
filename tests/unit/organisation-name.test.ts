import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { floorBreach } from '../floors';
import { searched, trackedFiles } from '../source-files';

/**
 * Shyden Ltd is dissolved (#370), and the organisation behind the site is
 * Shyden Labs (operator, 2026-10-01, #413). The site's own brand stays
 * "Shyden"; these are the two files that name the organisation itself.
 */
const LICENSE = readFileSync('LICENSE', 'utf8');
const README = readFileSync('README.md', 'utf8');

describe('the organisation is named Shyden Labs (#413)', () => {
  it("LICENSE's copyright line names Shyden Labs, once", () => {
    const lines = LICENSE.split('\n').map((line) => line.trim());
    expect(lines.filter((line) => line.startsWith('Copyright '))).toEqual([
      'Copyright 2026 Shyden Labs',
    ]);
  });

  it('README introduces the site as Shyden Labs', () => {
    expect(README.split('\n')[2]).toBe(
      'The **Shyden Labs** website, plus two free tools it hosts.',
    );
  });

  it.each([
    ['LICENSE', LICENSE],
    ['README.md', README],
  ])('%s no longer names the dissolved company', (_name, text) => {
    expect(text).toContain('Shyden');
    expect(text).not.toMatch(/Shyden\s+Ltd/i);
  });
});

/**
 * The org's GitHub handle moved to shyden-labs (#413). GitHub
 * redirects the old one only until someone claims it, so no live file may
 * lean on it. Dated plans and specs are history and keep what they said, and
 * one merge-message fixture keeps the old form because develop's own history
 * is written in it: that hit is also this scan's proof that it reads files.
 * The handle is assembled, never spelt, so this file cannot find itself.
 */
const HISTORY = 'docs/superpowers/';
const OLD_HANDLE = ['Shyden', 'Ltd'].join('-');
const KEPT = [
  `tests/unit/release-inventory.test.ts:      'Merge pull request #347 from ${OLD_HANDLE}/97-report',`,
];

describe("no live file names the org's old GitHub handle (#413)", () => {
  it('only the one historic fixture outside the dated docs', () => {
    const files = trackedFiles((path) => !path.startsWith(HISTORY));
    const hits = files.flatMap((path) =>
      readFileSync(path, 'latin1')
        .split('\n')
        .filter((line) => line.includes(OLD_HANDLE))
        .map((line) => `${path}:${line}`),
    );
    expect(hits.filter((hit) => KEPT.includes(hit))).toEqual(KEPT);
    expect(
      searched(
        hits.filter((hit) => !KEPT.includes(hit)),
        { of: files, what: 'tracked files outside the dated docs' },
      ),
    ).toEqual([]);
  });
});

/**
 * The game is Yawelo Idle (operator, 2026-10-05, #552); its old name is
 * retired from the copy, the links, the workflows and the tests alike, so no
 * live file may carry it in any case. Dated plans and specs are history. The
 * name is assembled, never spelt, so this file cannot find itself.
 */
const RETIRED_GAME_NAME = ['word', 'farer'].join('');

describe('no live file names the game by its retired name (#552)', () => {
  it('no tracked file outside the dated docs carries it, in any case', () => {
    const files = trackedFiles((path) => !path.startsWith(HISTORY));
    const hits = files.flatMap((path) =>
      readFileSync(path, 'latin1')
        .split('\n')
        .filter((line) => line.toLowerCase().includes(RETIRED_GAME_NAME))
        .map((line) => `${path}:${line.trim()}`),
    );
    expect(
      searched(hits, {
        of: files,
        what: 'tracked files outside the dated docs',
      }),
    ).toEqual([]);
    expect(
      floorBreach('organisation-name/retired-game-name-files', files.length),
    ).toBeUndefined();
  });
});
