import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scratchDir } from '../scratch-dir';

/**
 * The commit-msg hook, end to end, as git invokes it.
 *
 * WHAT THIS FILE IS FOR, now that the rule has one home. The forms the rule
 * covers are enumerated in `closing-keywords.test.ts` against the detector
 * itself; duplicating them here would give the rule two homes and let the
 * copies drift. What only this file can prove is the WIRING: that the hook
 * reaches that detector at all, that it fails the commit when the detector
 * finds something, and that its message still teaches the rule -- the hook is
 * the only place a future author meets it.
 *
 * Every rejection asserts the REASON, never merely the rejection. With no
 * hook on disk `execFileSync` throws ENOENT and a bare `ok === false` passes
 * on nothing, which is the vacuity this repository keeps finding.
 */

const HOOK = '.githooks/commit-msg';

/** Runs the real hook against a real message file, as git would. */
function runHook(message: string): { ok: boolean; output: string } {
  const file = join(scratchDir('commit-msg-'), 'COMMIT_EDITMSG');
  writeFileSync(file, message);
  try {
    execFileSync(HOOK, [file], { encoding: 'utf8', stdio: 'pipe' });
    return { ok: true, output: '' };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('the commit-msg hook reaches the closing-keyword rule', () => {
  it('rejects the exact message that closed #44', () => {
    // Verbatim from 983fb7e. GitHub read the keyword inside a sentence in
    // capitals saying the issue must stay open, and closed it anyway.
    const { ok, output } = runHook(
      'chore: measure e2e timings\n\nDOES NOT CLOSE #44. This is the measurement the ticket requires first.\n',
    );
    expect(ok).toBe(false);
    expect(output).toContain('Refs #');
  });

  it('rejects the exact PR body that closed #89', () => {
    // Verbatim from PR #92. Not a negation, so the guard written after the
    // first accident matched nothing at all here.
    const { ok, output } = runHook(
      'feat: x\n\nI will close #89 by hand once both are in\n',
    );
    expect(ok).toBe(false);
    expect(output).toContain('Refs #');
  });

  it('rejects a closing keyword the author means, and says how to close one', () => {
    // Operator decision, 2026-09-21: no exception. The measurement behind it
    // is that no closing keyword appears in the last 300 commit bodies.
    const { ok, output } = runHook('feat: x\n\nCloses #65\n');
    expect(ok).toBe(false);
    expect(output).toContain('gh issue close');
  });

  it('names the offending line, so the author can find it', () => {
    const { output } = runHook('feat: x\n\nsome context\n\nFixes #7\n');
    expect(output).toContain('5: Fixes #7');
  });

  it('accepts the phrasing it tells you to use', () => {
    expect(runHook('feat: x\n\nRefs #44 — the ticket stays open.\n').ok).toBe(
      true,
    );
  });

  it('accepts a message with no issue reference at all', () => {
    expect(runHook('docs: tidy a comment\n').ok).toBe(true);
  });
});
