import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { withoutCommentLines, withoutTsComments } from './source-text';

// Global rule: git hooks are never skipped. So nothing the hooks print, and
// nothing the installer prints, tells anyone how to skip them (#390 F58).
const PRINTERS: readonly [string, (text: string) => string][] = [
  ['.githooks/pre-push', (text) => withoutCommentLines(text, '#')],
  ['.githooks/commit-msg', (text) => withoutCommentLines(text, '#')],
  ['scripts/install-hooks.mjs', withoutTsComments],
];

describe('no hook or installer advises skipping the hooks (#390 F58)', () => {
  it.each(PRINTERS)('%s prints no --no-verify', (path, printed) => {
    expect(printed(readFileSync(path, 'utf8'))).not.toMatch(/--no-verify/);
  });
});
