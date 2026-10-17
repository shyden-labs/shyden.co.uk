import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { withoutTsComments } from './source-text';

/**
 * #841. `google-ledger.test.ts` holds the lock, the re-read and the whole
 * write; this file holds that the read-back actually goes through them.
 * Deleting the script's `takeLock` call, or writing the ledger past the
 * module, would leave every test of the module green. Importing the script
 * would load prettier and its whole i18n tree, so it is read as text, with
 * its comments stripped so its own documentation cannot satisfy a check.
 */

const SCRIPT = path.resolve(
  import.meta.dirname,
  '../../scripts/i18n-google-read-back.mjs',
);
const code = (): string => withoutTsComments(readFileSync(SCRIPT, 'utf8'));
const callsOf = (source: string, name: string): number =>
  source.match(new RegExp(`\\b${name}\\(`, 'g'))?.length ?? 0;

describe('the read-back goes through the ledger module (#841)', () => {
  it('takes the lock once, in main, before the store is read, and gives it back however the run ends', () => {
    const source = code();
    const main = source.slice(source.indexOf('async function main()'));
    expect(callsOf(source, 'takeLock')).toBe(1);
    expect(callsOf(main, 'takeLock')).toBe(1);
    expect(main.indexOf('takeLock(')).toBeLessThan(
      main.indexOf('readBack(key)'),
    );
    expect(main).toMatch(
      /try\s*\{\s*await readBack\(key\);\s*\}\s*finally\s*\{\s*release\(\);\s*\}/,
    );
  });

  it('reads the store only once the lock is held', () => {
    const source = code();
    const readBack = source.slice(
      source.indexOf('async function readBack('),
      source.indexOf('async function main()'),
    );
    expect(readBack).toContain('parseStore(JSON.parse(readFileSync(STORE');
    expect(callsOf(source, 'parseStore')).toBe(1);
  });

  it('sends its one request to Google from inside spendWithin', () => {
    const source = code();
    expect(callsOf(source, 'spendWithin')).toBe(1);
    expect(callsOf(source, 'fetch')).toBe(1);
    const sending = source.slice(source.indexOf('spendWithin('));
    expect(sending.indexOf('fetch(ENDPOINT')).toBeGreaterThan(0);
    expect(sending.indexOf('fetch(ENDPOINT')).toBeLessThan(
      sending.indexOf('await save(store);\n\n'),
    );
  });

  it('names the ledger in exactly three places: its path, the first read, and the module', () => {
    const lines = code()
      .split('\n')
      .filter((line) => /\bLEDGER\b/.test(line))
      .map((line) => line.trim());
    expect(lines).toEqual([
      'const LEDGER = `${homedir()}/.config/shyden/google-translate-ledger.json`;',
      'const left = charactersLeft(readLedger(files, LEDGER), day, limit);',
      '{ files, path: LEDGER, day, limit, raised, pid: process.pid },',
    ]);
  });

  it('creates its lock file only if no other run has', () => {
    expect(code()).toContain("writeFileSync(path, text, { flag: 'wx' });");
  });
});
