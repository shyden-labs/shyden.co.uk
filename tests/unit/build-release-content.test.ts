import { describe, expect, it } from 'vitest';
import {
  LISTING_CAVEAT,
  listedTitles,
  modeOf,
  releaseContentOf,
} from '../../scripts/build-release-content.mjs';

const BASE = 'b'.repeat(40);
const HEAD = 'h'.repeat(40);
const V = {
  sha: 'a'.repeat(40),
  subject: 'visible',
  pr: 1,
  ticket: 2,
  files: ['src/x'],
  visitorFacing: true,
  areas: ['src'],
};
const G = {
  sha: 'c'.repeat(40),
  subject: 'gap',
  pr: 3,
  ticket: null,
  files: ['src/y'],
  visitorFacing: true,
  areas: ['src'],
};
const inventory = { base: BASE, head: HEAD, entries: [V, G] };
const TITLE = 'a describe > a journey';
const release = {
  base: BASE,
  headline: 'The headline',
  lede: 'The lede',
  signoff: { lede: 'Yours.', approve: 'Release' },
  gapGroup: 'Shown by no journey',
  checks: [{ id: 'dev-home', group: 'On dev', label: 'Open it' }],
  entries: {
    [V.sha]: { kind: 'visible', journeys: [TITLE] },
    [G.sha]: { kind: 'gap', check: 'Try it by hand' },
  },
};
const START = '2026-09-27T08:00:00.000Z';
const report = {
  stats: { startTime: START },
  suites: [
    {
      file: 'x.spec.ts',
      suites: [
        {
          title: 'a describe',
          specs: [
            {
              title: 'a journey',
              tests: [
                {
                  projectName: 'chromium',
                  results: [{ status: 'passed', duration: 1, attachments: [] }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
const manifest = [
  {
    project: 'chromium',
    title: TITLE,
    order: 1,
    label: 'l',
    file: 'chromium/a.jpg',
    at: '2026-09-27T08:00:01.000Z',
  },
];

describe('the release content (#362)', () => {
  // Built inside each test, so a stub fails each on its own assertion rather
  // than the whole file at collection.
  const content = () =>
    releaseContentOf({
      release,
      inventory,
      report,
      manifest,
      devVerified: 'success',
    });

  it('keys the sign-off to the release head', () => {
    expect(content()?.signoffKey).toBe('release-hhhhhhh');
  });

  it('names production, the head and its dev-verified state', () => {
    expect(content()?.ids).toEqual([
      { label: 'Production', value: BASE },
      { label: 'Release head', value: HEAD },
      { label: 'dev-verified', value: 'success' },
    ]);
  });

  it('carries the release file wording and its checks, and turns every gap into a check', () => {
    expect(content()?.headline).toBe('The headline');
    expect(content()?.signoff).toEqual({ lede: 'Yours.', approve: 'Release' });
    expect(content()?.checks).toEqual([
      { id: 'dev-home', group: 'On dev', label: 'Open it' },
      {
        id: 'gap-ccccccc',
        group: 'Shown by no journey',
        label: 'gap: Try it by hand',
      },
    ]);
  });

  it('renders the change map and the rest as html sections', () => {
    expect(
      content()?.sections?.map((s: { html?: string }) => typeof s.html),
    ).toEqual(['string', 'string']);
    expect(content()?.sections?.[0]?.html).toContain('#j-a-describe-a-journey');
  });

  it.each([['failure'], [null]])(
    'refuses a head whose dev-verified reads %s',
    (state) => {
      expect(() =>
        releaseContentOf({
          release,
          inventory,
          report,
          manifest,
          devVerified: state,
        }),
      ).toThrow(/dev-verified/);
    },
  );

  it('refuses a cited title that ran but captured nothing', () => {
    expect(() =>
      releaseContentOf({
        release,
        inventory,
        report,
        manifest: [{ ...manifest[0], title: 'another' }],
        devVerified: 'success',
      }),
    ).toThrow(/is not a journey of this run/);
  });
});

describe('--check against a listing (#362)', () => {
  const listing = {
    suites: [
      {
        file: 'x.spec.ts',
        suites: [
          {
            title: 'a describe',
            specs: [
              {
                title: 'a journey',
                tests: [{ projectName: 'chromium', results: [] }],
              },
            ],
          },
        ],
      },
    ],
  };

  it('reads every listed title, results or none', () => {
    expect([...listedTitles(listing)]).toEqual([TITLE]);
  });

  it('passes a branch head with no dev-verified, and writes nothing', () => {
    expect(
      releaseContentOf({
        release,
        inventory,
        report: listing,
        manifest: null,
        devVerified: null,
        check: true,
      }),
    ).toBeNull();
  });

  it('still refuses a title the listing does not hold', () => {
    const typo = {
      ...release,
      entries: {
        ...release.entries,
        [V.sha]: { kind: 'visible', journeys: ['a describe > a jorney'] },
      },
    };
    expect(() =>
      releaseContentOf({
        release: typo,
        inventory,
        report: listing,
        manifest: null,
        devVerified: null,
        check: true,
      }),
    ).toThrow(/is not a journey of this run/);
  });
});

describe('--check against a capture manifest (#765)', () => {
  /** The check, run over `rows` of the capture `report` describes. */
  const checkOf = (rows: object[], over = release) =>
    releaseContentOf({
      release: over,
      inventory,
      report,
      manifest: rows,
      devVerified: null,
      check: true,
    });
  const captured = (title: string) => ({ ...manifest[0], title });

  it('passes a cited title a manifest row carries, with no dev-verified', () => {
    expect(checkOf([captured(TITLE)])).toBeNull();
  });

  it('refuses a cited title that ran but no manifest row carries, naming its entry', () => {
    expect(() => checkOf([captured('a describe > another journey')])).toThrow(
      `"${TITLE}", cited by ${V.sha}, is not a journey of this run`,
    );
  });

  it('names every uncaptured title in one refusal, each with its entry', () => {
    const many = {
      ...release,
      entries: {
        [V.sha]: { kind: 'visible', journeys: [TITLE, 'a describe > two'] },
        [G.sha]: { kind: 'visible', journeys: ['a describe > three'] },
      },
    };
    let said = '';
    try {
      checkOf([captured('a describe > captured')], many);
    } catch (error) {
      said = String(error);
    }
    expect(said.split('\n').slice(1)).toEqual([
      `  "${TITLE}", cited by ${V.sha}, is not a journey of this run`,
      `  "a describe > two", cited by ${V.sha}, is not a journey of this run`,
      `  "a describe > three", cited by ${G.sha}, is not a journey of this run`,
    ]);
    expect(said.split('\n')[0]).toContain('3 cited titles');
  });

  it('refuses an empty manifest, which proves no capture ran', () => {
    expect(() => checkOf([])).toThrow(
      /nothing in manifest\.jsonl was captured/,
    );
  });

  it('refuses rows an earlier run captured, as building does', () => {
    expect(() =>
      checkOf([{ ...captured(TITLE), at: '2026-09-27T07:59:59.000Z' }]),
    ).toThrow(/an earlier run's/);
  });

  it('refuses to build with no manifest', () => {
    expect(() =>
      releaseContentOf({
        release,
        inventory,
        report,
        manifest: null,
        devVerified: 'success',
      }),
    ).toThrow(/building reads a capture's manifest/);
  });
});

describe('what the command line asks for (#765)', () => {
  const MODES = [
    ['a capture to build from', { evidence: 'e', out: 'o' }, 'build'],
    ['a check against a manifest', { check: true, manifest: 'm' }, 'manifest'],
    [
      'a listing-only check, asked for by name',
      { check: true, listing: 'l', listingOnly: true },
      'listing',
    ],
    [
      'a listing-only check, not asked for',
      { check: true, listing: 'l' },
      'listing-refused',
    ],
    ['a check with nothing to check against', { check: true }, 'usage'],
    [
      'a check against both a listing and a manifest',
      { check: true, listing: 'l', manifest: 'm' },
      'usage',
    ],
    [
      '--listing-only outside a check',
      { listingOnly: true, evidence: 'e', out: 'o' },
      'usage',
    ],
    [
      '--manifest outside a check',
      { manifest: 'm', evidence: 'e', out: 'o' },
      'usage',
    ],
    ['a build with no output file', { evidence: 'e' }, 'usage'],
  ] as const;
  it.each(MODES)('reads %s', (_, given, mode) => {
    expect(modeOf({ release: 'r.json', head: 'HEAD', ...given })).toBe(mode);
  });

  it('reads no release file as usage, whatever else is given', () => {
    expect(modeOf({ head: 'HEAD', check: true, manifest: 'm' })).toBe('usage');
  });

  it('says a listing proves a title runs, not that it captures', () => {
    expect(LISTING_CAVEAT).toMatch(/RUNS/);
    expect(LISTING_CAVEAT).toMatch(/not that it CAPTURES/);
    expect(LISTING_CAVEAT).toContain('--manifest');
  });
});
