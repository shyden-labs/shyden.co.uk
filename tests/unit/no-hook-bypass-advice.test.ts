import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Global rule: git hooks are never skipped. So nothing the hooks print, and
// nothing the installer prints, tells anyone how to skip them (#390 F58).
const PRINTERS = [
  '.githooks/pre-push',
  '.githooks/commit-msg',
  'scripts/install-hooks.mjs',
];

// What a file prints: its non-comment lines (# in the shell hooks, // in the script).
const printed = (path: string): string =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(#|\/\/|\*)/.test(line))
    .join('\n');

describe('no hook or installer advises skipping the hooks (#390 F58)', () => {
  it.each(PRINTERS)('%s prints no --no-verify', (path) => {
    expect(printed(path)).not.toMatch(/--no-verify/);
  });
});
