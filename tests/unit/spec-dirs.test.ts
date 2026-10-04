import { describe, expect, it } from 'vitest';
import { specDirFilesGitHas, specDirs } from '../spec-dirs';
import { floorBreach } from '../floors';

describe('the directories guards scan are derived, not listed', () => {
  it('finds every directory under tests/ that holds specs', () => {
    // Anti-vacuity: an empty derivation would make every guard a no-op.
    expect(floorBreach('spec-dirs/dirs', specDirs().length)).toBeUndefined();
    expect(specDirs()).toContain('tests/e2e');
    expect(specDirs()).toContain('tests/device');
  });

  it('includes the deploy gates, which the hand-written list missed', () => {
    // These two produce `dev-verified`, a required check on main's branch
    // protection, and were in none of the four hand-written copies (#67).
    expect(specDirs()).toContain('tests/dev');
    expect(specDirs()).toContain('tests/prod');
  });

  it('excludes directories that hold no specs', () => {
    // tests/unit holds *.test.ts, not *.spec.ts — scanning it would make the
    // guards assert against themselves.
    expect(specDirs()).not.toContain('tests/unit');
  });
});

describe('specDirFilesGitHas -- the spec directories, read from git (#477)', () => {
  it('holds a spec and a helper beside it', () => {
    const files = specDirFilesGitHas();
    expect(files).toContain('tests/e2e/classroom-groups.spec.ts');
    expect(files).toContain('tests/e2e/recorders.ts');
  });

  it('holds nothing from a directory with no spec', () => {
    expect(specDirFilesGitHas()).not.toContain('tests/unit/ast.ts');
  });
});
