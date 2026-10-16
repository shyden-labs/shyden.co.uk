import { describe, expect, test } from 'vitest';
import {
  androidVerdicts,
  iosVerdicts,
  parityBreaks,
} from '../../scripts/mutation-parity.mjs';

/** A phone's verdict on one title. */
type Verdict = 'RED' | 'GREEN';

/**
 * Mutation parity, per title (#821 AC4): a mutant applied to both phones must
 * turn each iPhone mirror RED exactly where its Android twin is RED. A title
 * GREEN on one phone and RED on the other is a twin that is weaker (or
 * stricter) than the test it claims to be.
 */
const playwright = (
  specs: { path: string[]; title: string; status: string }[],
) => ({
  suites: [
    {
      title: 'classroom-groups.spec.ts',
      specs: [],
      suites: specs.map(({ path, title, status }) => ({
        title: path[0],
        specs: [{ title, tests: [{ status }] }],
        suites: [],
      })),
    },
  ],
});

const vitest = (
  results: { ancestors: string[]; title: string; status: string }[],
) => ({
  testResults: [
    {
      assertionResults: results.map(({ ancestors, title, status }) => ({
        ancestorTitles: ancestors,
        title,
        status,
      })),
    },
  ],
});

describe('androidVerdicts reads a Playwright JSON report', () => {
  test('an unexpected test is RED and an expected one GREEN, keyed by describe path and title', () => {
    expect(
      androidVerdicts(
        playwright([
          {
            path: ['class name'],
            title: 'heads the results',
            status: 'unexpected',
          },
          {
            path: ['class name'],
            title: 'blank blocks nothing',
            status: 'expected',
          },
        ]),
      ),
    ).toEqual(
      new Map([
        ['class name > heads the results', 'RED'],
        ['class name > blank blocks nothing', 'GREEN'],
      ]),
    );
  });

  test('a skipped test has no verdict', () => {
    const verdicts = androidVerdicts(
      playwright([
        { path: ['a'], title: 'runs', status: 'expected' },
        { path: ['a'], title: 'skipped', status: 'skipped' },
      ]),
    );
    expect([...verdicts.keys()]).toEqual(['a > runs']);
  });
});

describe('iosVerdicts reads a Vitest JSON report', () => {
  test('the iOS mirror prefix is dropped from every segment', () => {
    expect(
      iosVerdicts(
        vitest([
          {
            ancestors: ['iOS mirror: class name'],
            title: 'iOS mirror: heads the results',
            status: 'failed',
          },
        ]),
      ),
    ).toEqual(new Map([['class name > heads the results', 'RED']]));
  });
});

describe('parityBreaks compares the twins', () => {
  const android = new Map<string, Verdict>([
    ['g > a', 'RED'],
    ['g > b', 'GREEN'],
    ['g > only android', 'RED'],
  ]);

  test('a weaker twin, GREEN where Android is RED, is a break', () => {
    const ios = new Map<string, Verdict>([
      ['g > a', 'GREEN'],
      ['g > b', 'GREEN'],
    ]);
    expect(parityBreaks(android, ios).breaks).toEqual([
      { title: 'g > a', android: 'RED', ios: 'GREEN' },
    ]);
  });

  test('a stricter twin, RED where Android is GREEN, is a break', () => {
    const ios = new Map<string, Verdict>([
      ['g > a', 'RED'],
      ['g > b', 'RED'],
    ]);
    expect(parityBreaks(android, ios).breaks).toEqual([
      { title: 'g > b', android: 'GREEN', ios: 'RED' },
    ]);
  });

  test('twins that agree are compared and pass', () => {
    const ios = new Map<string, Verdict>([
      ['g > a', 'RED'],
      ['g > b', 'GREEN'],
    ]);
    const { compared, breaks } = parityBreaks(android, ios);
    expect(compared).toEqual(['g > a', 'g > b']);
    expect(breaks).toEqual(compared.slice(2));
  });

  test('a title on one phone only is counted apart, never compared', () => {
    const ios = new Map<string, Verdict>([['g > only ios', 'GREEN']]);
    expect(parityBreaks(android, ios).unpaired).toEqual({
      android: ['g > a', 'g > b', 'g > only android'],
      ios: ['g > only ios'],
    });
  });
});
