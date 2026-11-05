import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

describe('the pre-push hook', () => {
  it('is the hook directory git actually consults', () => {
    // The seam. A hook script in a directory `core.hooksPath` does not name is
    // an inert file, and every source-text assertion below would still pass.
    // `git config` EXITS 1 when the key is unset, so this has to be caught:
    // letting it throw reports a spawn failure and buries the actual finding.
    let configured = '';
    try {
      configured = execFileSync('git', ['config', 'core.hooksPath'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      configured = '(unset)';
    }
    expect(
      configured,
      'git is not pointed at .githooks — run `npm install` to trigger the ' +
        '`prepare` script, which is what installs the hook',
    ).toBe('.githooks');
  });
});
