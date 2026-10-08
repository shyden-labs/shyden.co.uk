import { describe, expect, it } from 'vitest';
import { fixtureTestDirs, inFixtureTestDir } from '../vitest-suite-dirs';

describe('the directories whose tests hold fixtures (#638)', () => {
  it('are the unit suite and the guards suite, read from their configs', () => {
    expect(fixtureTestDirs()).toEqual(['tests/unit/', 'tests/guards/']);
  });

  it('recognise a file in either, and no other', () => {
    expect(inFixtureTestDir('tests/unit/a.test.ts')).toBe(true);
    expect(inFixtureTestDir('tests/guards/a.test.ts')).toBe(true);
    expect(inFixtureTestDir('tests/integration/a.test.ts')).toBe(false);
    expect(inFixtureTestDir('tests/e2e/a.spec.ts')).toBe(false);
    expect(inFixtureTestDir('tests/guardsx/a.test.ts')).toBe(false);
  });
});
