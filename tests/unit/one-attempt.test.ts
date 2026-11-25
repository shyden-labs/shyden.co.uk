import { describe, expect, it } from 'vitest';
import { oneAttemptEach } from '../../scripts/test-e2e.mjs';

/**
 * An evidence run captures one attempt of each test (#1274 moved these from
 * the guards suite, so the unit coverage reads the function they pin).
 * That `main()` asks it before anything runs stays in
 * `tests/guards/evidence-page.test.ts`.
 */
describe('an evidence run takes one attempt of each test', () => {
  it('refuses a second attempt of any test, which would overwrite the first one’s captures', () => {
    // `shoot` numbers a test's captures per worker, and Playwright runs a retry
    // in a fresh worker, so attempt 2 writes `01-…`, `02-…` over attempt 1's
    // files while the manifest keeps both attempts' rows: the sign-off page
    // shows one picture twice. A repeat collides the same way.
    const evidence = { EVIDENCE_DIR: '/e' };
    for (const argv of [
      ['--retries=1'],
      ['--retries', '2'],
      ['tests/e2e/x.spec.ts', '--retries=1'],
    ])
      expect(() => oneAttemptEach(argv, evidence), argv.join(' ')).toThrow(
        /an evidence run takes one attempt of each test: --retries=[12] /,
      );
    for (const argv of [['--repeat-each=2'], ['--repeat-each', '3']])
      expect(() => oneAttemptEach(argv, evidence), argv.join(' ')).toThrow(
        /an evidence run takes one attempt of each test: --repeat-each=[23] /,
      );
    for (const argv of [['--retries'], ['--repeat-each']])
      expect(() => oneAttemptEach(argv, evidence), argv.join(' ')).toThrow(
        /^--(retries|repeat-each) was given no value$/,
      );
  });

  it('allows one attempt of each test, and leaves an ordinary run its retries', () => {
    for (const argv of [
      [],
      ['--retries=0'],
      ['--retries', '0'],
      ['--repeat-each=1'],
      ['--workers', '2', '--project=chromium'],
    ])
      expect(oneAttemptEach(argv, { EVIDENCE_DIR: '/e' }), argv.join(' ')).toBe(
        'one attempt',
      );
    // Without EVIDENCE_DIR nothing is captured, so nothing can be overwritten.
    for (const argv of [['--retries=2'], ['--repeat-each', '3']])
      expect(oneAttemptEach(argv, {}), argv.join(' ')).toBe(
        'not an evidence run',
      );
  });
});
