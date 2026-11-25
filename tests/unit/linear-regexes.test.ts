import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderedScreen } from '../../scripts/adb.mjs';
import { relativeSpecifiers } from '../../scripts/capture-scope.mjs';
import { closingKeywordOffences } from '../../scripts/closing-keywords.mjs';
import { endpoint } from '../../scripts/settings.mjs';
import { tokensFrom } from '../../src/lib/access-expiry';
import { parseRoster, serialiseRoster } from '../../src/lib/csv';
import { getStrings } from '../../src/lib/i18n';
import { cell, engineConfig } from '../../src/lib/i18n/back-translate';
import { previewImageFor } from '../../src/lib/preview-image';
import { pageIdFromPath } from '../../src/lib/report';
import { tokenList } from '../access-expiry-shared';
import { student } from './factories';

/**
 * Every regular expression SonarCloud found backtracking super-linearly
 * (javascript:S8786, #1278) stays linear on the input that made it slow.
 *
 * Each input is a long run the old pattern restarted on at every position:
 * 50,000 characters took seconds there (the formula guard 8.6 s on 40,000,
 * measured on #1278) and take well under a millisecond once linear. The bound
 * is generous so that only a quadratic pattern can reach it; what each
 * function answers is its own test file's business, so a refusal counts too.
 */
const N = 50_000;
const LINEAR_MS = 100;

const elapsedMs = (run: () => unknown): number => {
  const started = performance.now();
  try {
    run();
  } catch {
    // A refusal is an answer; only the time it took is measured here.
  }
  return performance.now() - started;
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('a regular expression SonarCloud found slow stays linear (S8786, #1278)', () => {
  it('reads a screen size that is one long run of digits', () => {
    expect(
      elapsedMs(() =>
        renderedScreen(`${'1'.repeat(N)}!`, 'Physical density: 640'),
      ),
    ).toBeLessThan(LINEAR_MS);
  });

  it('reads a screen density that is one long run of digits', () => {
    expect(
      elapsedMs(() =>
        renderedScreen('Physical size: 1440x3120', `${'1'.repeat(N)}!`),
      ),
    ).toBeLessThan(LINEAR_MS);
  });

  it('finds no import in a from followed by a long run of spaces', () => {
    expect(
      elapsedMs(() => relativeSpecifiers(`from${' '.repeat(N)}x`)),
    ).toBeLessThan(LINEAR_MS);
  });

  it('finds no closing keyword in a fix followed by a long run of spaces', () => {
    expect(
      elapsedMs(() => closingKeywordOffences(`fix${' '.repeat(N)}x`)),
    ).toBeLessThan(LINEAR_MS);
  });

  it('trims a configured endpoint holding a long run of slashes', () => {
    vi.stubEnv('LINEAR_REGEX_ENDPOINT', `https://a.example/${'/'.repeat(N)}x`);
    expect(elapsedMs(() => endpoint('LINEAR_REGEX_ENDPOINT'))).toBeLessThan(
      LINEAR_MS,
    );
  });

  it('reads a token name that is one long line', () => {
    expect(
      elapsedMs(() =>
        tokensFrom(
          tokenList([
            { name: `${'a'.repeat(N)}\n`, expires_at: '2027-10-15T23:55:00Z' },
          ]),
        ),
      ),
    ).toBeLessThan(LINEAR_MS);
  });

  it('writes a roster name holding a long run of line breaks', () => {
    expect(
      elapsedMs(() =>
        serialiseRoster(
          [student({ number: 1, name: `${'\n'.repeat(N)}x` })],
          '7B',
          'en',
        ),
      ),
    ).toBeLessThan(LINEAR_MS);
  });

  it('writes a class name holding a long run of line breaks', () => {
    expect(
      elapsedMs(() => serialiseRoster([], `${'\n'.repeat(N)}x`, 'en')),
    ).toBeLessThan(LINEAR_MS);
  });

  it('reads back a roster name holding a long run of line breaks', () => {
    expect(
      elapsedMs(() =>
        parseRoster(
          `number,name\n1,"x${'\n'.repeat(N)}y"\n`,
          'en',
          getStrings('en'),
        ),
      ),
    ).toBeLessThan(LINEAR_MS);
  });

  it('reads back a class name holding a long run of tabs', () => {
    expect(
      elapsedMs(() =>
        parseRoster(
          `# Class: x${'\t'.repeat(N)}y\nnumber\n1\n`,
          'en',
          getStrings('en'),
        ),
      ),
    ).toBeLessThan(LINEAR_MS);
  });

  it('trims a back-translation URL holding a long run of slashes', () => {
    expect(
      elapsedMs(() =>
        engineConfig({
          BACK_TRANSLATE_URL: `https://a.example/${'/'.repeat(N)}x`,
        }),
      ),
    ).toBeLessThan(LINEAR_MS);
  });

  it('puts a long run of spaces into a review table cell', () => {
    expect(elapsedMs(() => cell(`${' '.repeat(N)}x`))).toBeLessThan(LINEAR_MS);
  });

  it('names the preview of a path holding a long run of slashes', () => {
    expect(
      elapsedMs(() => previewImageFor(`/x${'/'.repeat(N)}y`)),
    ).toBeLessThan(LINEAR_MS);
  });

  it('reads the page of a path holding a long run of slashes', () => {
    expect(elapsedMs(() => pageIdFromPath(`/x${'/'.repeat(N)}y`))).toBeLessThan(
      LINEAR_MS,
    );
  });
});
