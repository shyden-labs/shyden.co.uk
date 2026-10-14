import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import {
  committableFiles,
  filesUnder,
  nonEmpty,
  searched,
  trackedFiles,
  walkDisagreements,
} from '../source-files';
import { floorBreach } from '../floors';

/**
 * The shared directory walk (#80). Nine private copies had grown, in three
 * implementations whose exclusions disagreed — so the behaviour every guard
 * now inherits is pinned here rather than left to whichever copy a future
 * guard happened to reach for.
 */
describe('filesUnder', () => {
  it('recurses, and returns paths a caller can read', () => {
    const specs = filesUnder('tests', (path) => path.endsWith('.spec.ts'));
    // Anti-vacuity: an empty walk would satisfy every "no offenders" guard in
    // the suite at once — the exact failure #79 found in the e2e collectors.
    expect(floorBreach('source-files/specs', specs.length)).toBeUndefined();
    // Proof it went DOWN, not just listed the top level.
    expect(specs).toContain('tests/e2e/classroom-groups-print.spec.ts');
  });

  it('applies the caller predicate to the whole path, not the basename', () => {
    const inE2eOnly = filesUnder('tests', (path) =>
      path.startsWith('tests/e2e/'),
    );
    expect(inE2eOnly.every((path) => path.startsWith('tests/e2e/'))).toBe(true);
  });

  it('returns a stable order, so a guard reads the same list on every OS', () => {
    const once = filesUnder('tests', () => true);
    expect(once).toEqual([...once].sort());
  });

  it('skips dotfiles and node_modules, which only four of the nine did', () => {
    const all = filesUnder('tests', () => true);
    expect(
      searched(
        all.filter((path) => path.split('/').some((s) => s.startsWith('.'))),
        { of: all, what: 'walked paths' },
      ),
    ).toEqual([]);
    expect(
      searched(
        all.filter((path) => path.includes('node_modules')),
        { of: all, what: 'walked paths' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('source-files/walked-test-paths', all.length),
    ).toBeUndefined();
  });
});

/**
 * The liveness control #84 moved OFF the call sites and INTO the collector.
 *
 * Eleven guards hand-wrote `expect(files.length).toBeGreaterThan(0)`, five of
 * them copying a comment that cites a sibling; four forgot, and twelve tests
 * passed while scanning zero files. `recorders.ts` already settled the shape
 * for browser events in #79 — the collector, not a convention, is what a
 * caller cannot forget.
 */
describe('nonEmpty', () => {
  it('passes a populated list straight through, untouched', () => {
    expect(nonEmpty(['a', 'b'], 'letters')).toEqual(['a', 'b']);
  });

  it('throws, naming what it was scanning, when the list is empty', () => {
    expect(() => nonEmpty([], 'every .ts file under tests/')).toThrow(
      /every \.ts file under tests\//,
    );
  });

  it('blames the guard, not the subject: the message is the whole point', () => {
    // "found none" reads like a clean result. The message has to say that the
    // WALK is broken, or the next reader triages the wrong thing entirely.
    expect(() => nonEmpty([], 'x')).toThrow(/broken/);
  });
});

describe('filesUnder refuses to answer blind', () => {
  it('throws rather than returning an empty list a guard would trust', () => {
    expect(() => filesUnder('tests', () => false)).toThrow(/tests/);
  });

  it('still descends through directories that hold no match themselves', () => {
    // The refusal belongs to the TOP-LEVEL call only. `tests/` holds
    // directories with no `.spec.ts` in them, so a recursion that refused an
    // empty sub-result could never complete a walk at all.
    expect(
      floorBreach(
        'source-files/specs-through-empty-dirs',
        filesUnder('tests', (path) => path.endsWith('.spec.ts')).length,
      ),
    ).toBeUndefined();
  });
});

/**
 * The liveness control for absence assertions (#118).
 *
 * `nonEmpty` above guards a WALK. This guards an ASSERTION: `expect(x).
 * toEqual([])` is green when the guard works and when the guard looked at
 * nothing, and 108 absence assertions in this suite could not tell those
 * apart. The population goes in the same expression as the finding, so a
 * call site has nowhere to forget it.
 *
 * The content rule is #112's lesson made mechanical. That guard asserted its
 * header list had six entries and stayed green with all six Thai headers
 * blanked -- six empty strings are six entries. Counting the array is not
 * counting the content, so the count here is of SUBSTANTIVE members and the
 * rule lives in the one home rather than at 55 call sites.
 */
describe('searched -- the population a finding list was drawn from', () => {
  it('returns the findings untouched, so the caller still owns the verdict', () => {
    const findings = ['a'];
    const rows = ['x', 'y'];
    expect(searched(findings, { of: rows, what: 'rows' })).toBe(findings);
    expect(
      floorBreach('source-files/untouched-rows', rows.length),
    ).toBeUndefined();
  });

  it('refuses a population that is empty', () => {
    const files: string[] = [];
    expect(() => searched([], { of: files, what: 'files' })).toThrow(
      /no files/,
    );
    expect(
      floorBreach('source-files/empty-files', files.length),
    ).toBeUndefined();
  });

  it('refuses a population of BLANK strings -- #112 exactly', () => {
    // The Thai headers, blanked. Six entries, no content.
    const headers = ['', '  ', ''];
    expect(() => searched([], { of: headers, what: 'headers' })).toThrow(
      /no headers/,
    );
    expect(
      floorBreach('source-files/blank-headers', headers.length),
    ).toBeUndefined();
  });

  it('refuses a population of empty containers', () => {
    const catalogues = [[], {}];
    expect(() => searched([], { of: catalogues, what: 'catalogues' })).toThrow(
      /no catalogues/,
    );
    expect(
      floorBreach('source-files/empty-catalogues', catalogues.length),
    ).toBeUndefined();
  });

  it('refuses a population of null and undefined', () => {
    const locales = [null, undefined];
    expect(() => searched([], { of: locales, what: 'locales' })).toThrow(
      /no locales/,
    );
    expect(
      floorBreach('source-files/absent-locales', locales.length),
    ).toBeUndefined();
  });

  it('accepts a population where only SOME members carry content', () => {
    // A partly-blank population is a real subject, not a dead walk: the
    // blanks may be what the caller is hunting.
    const rows = ['', 'real'];
    expect(searched([], { of: rows, what: 'rows' })).toEqual([]);
    expect(
      floorBreach('source-files/partly-blank-rows', rows.length),
    ).toBeUndefined();
  });

  it('accepts a plain count, which cannot be content-checked', () => {
    const pairs = 3;
    const none = 0;
    expect(searched([], { of: pairs, what: 'pairs' })).toEqual([]);
    expect(() => searched([], { of: none, what: 'pairs' })).toThrow(/no pairs/);
    expect(floorBreach('source-files/counted-pairs', pairs)).toBeUndefined();
    expect(floorBreach('source-files/no-pairs', none)).toBeUndefined();
  });

  it('counts a zero and a false as content -- they are values, not blanks', () => {
    const widths = [0];
    const flags = [false];
    expect(searched([], { of: widths, what: 'widths' })).toEqual([]);
    expect(searched([], { of: flags, what: 'flags' })).toEqual([]);
    expect(
      floorBreach('source-files/zero-widths', widths.length),
    ).toBeUndefined();
    expect(
      floorBreach('source-files/false-flags', flags.length),
    ).toBeUndefined();
  });

  it('names the population in the message, so a failure says what died', () => {
    const pages: string[] = [];
    expect(() => searched([], { of: pages, what: 'built pages' })).toThrow(
      /built pages/,
    );
    expect(
      floorBreach('source-files/unbuilt-pages', pages.length),
    ).toBeUndefined();
  });
});

describe('committableFiles -- what git tracks or would (#477)', () => {
  // The list a walk is checked against. Untracked files count, so a test
  // file written before its `git add` is not a false red mid-cycle; ignored
  // files do not, so a build output on one machine is not a finding.
  it('holds every file git tracks', () => {
    const tracked = trackedFiles((path) => path.startsWith('tests/'));
    const listed = new Set(
      committableFiles((path) => path.startsWith('tests/')),
    );
    const dropped = tracked.filter((path) => !listed.has(path));
    expect(searched(dropped, { of: tracked, what: 'tracked files' })).toEqual(
      [],
    );
    expect(
      floorBreach('source-files/tracked-test-files', tracked.length),
    ).toBeUndefined();
  });

  it('holds no file git ignores, though it is on disk', () => {
    const ignored = 'node_modules/typescript/package.json';
    expect(existsSync(ignored)).toBe(true);
    const listed = committableFiles(
      (path) => path === 'package.json' || path.startsWith('node_modules/'),
    );
    // The known positive: the same filter does list what git tracks.
    expect(listed).toContain('package.json');
    expect(listed).not.toContain(ignored);
  });
});

describe('walkDisagreements -- a walk against the list git keeps (#477)', () => {
  it('names a file git has and the walk missed', () => {
    expect(walkDisagreements(['a.ts'], ['a.ts', 'b.ts'])).toEqual([
      'b.ts: git has it, the walk did not read it',
    ]);
  });

  it('names a file the walk read that git does not have', () => {
    expect(walkDisagreements(['a.ts', 'c.ts'], ['a.ts'])).toEqual([
      'c.ts: the walk read it, git does not have it',
    ]);
  });

  it('names nothing when the two agree, in any order', () => {
    const walked = ['b.ts', 'a.ts'];
    expect(
      searched(walkDisagreements(walked, ['a.ts', 'b.ts']), {
        of: walked,
        what: 'files the walk read',
      }),
    ).toEqual([]);
    expect(
      floorBreach('source-files/agreeing-walk', walked.length),
    ).toBeUndefined();
  });
});
