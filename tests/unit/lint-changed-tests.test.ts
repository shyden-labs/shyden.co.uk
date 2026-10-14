import { describe, it, expect } from 'vitest';
import {
  changedTestFiles,
  lintReport,
} from '../../scripts/lint-changed-tests.mjs';

describe('changedTestFiles reads the test files out of git diff --name-only', () => {
  it('keeps TypeScript under tests/, once each, sorted', () => {
    expect(
      changedTestFiles(
        [
          'tests/unit/b.test.ts',
          'src/lib/grouping.ts',
          'tests/e2e/a.spec.ts',
          'tests/floors.json',
          'tests/unit/b.test.ts',
          'scripts/x.mjs',
          'tests/source-files.ts',
          '',
        ].join('\n'),
      ),
    ).toEqual([
      'tests/e2e/a.spec.ts',
      'tests/source-files.ts',
      'tests/unit/b.test.ts',
    ]);
  });
});

describe('lintReport says what it read and what it found', () => {
  it('says plainly that no test file changed, rather than passing over nothing', () => {
    expect(lintReport('origin/develop', [], undefined)).toEqual({
      lines: [
        'lint-changed-tests: no test file changed against origin/develop: nothing to lint.',
      ],
      failed: false,
    });
  });

  it('names each finding and fails', () => {
    expect(
      lintReport('origin/develop', ['tests/unit/a.test.ts'], {
        judged: { searches: 2, absences: 3, presence: 1 },
        findings: ['tests/unit/a.test.ts:4: absence-liveness: why'],
      }),
    ).toEqual({
      lines: [
        'tests/unit/a.test.ts:4: absence-liveness: why',
        'lint-changed-tests: 1 finding in 1 changed test file (read 2 searches, 3 absences, 1 presence assertion against origin/develop).',
      ],
      failed: true,
    });
  });

  it('passes a changed file it read and found clean, saying what it read', () => {
    expect(
      lintReport(
        'origin/develop',
        ['tests/unit/a.test.ts', 'tests/unit/b.test.ts'],
        { judged: { searches: 1, absences: 0, presence: 2 }, findings: [] },
      ),
    ).toEqual({
      lines: [
        'lint-changed-tests: 0 findings in 2 changed test files (read 1 search, 0 absences, 2 presence assertions against origin/develop).',
      ],
      failed: false,
    });
  });
});
