import { describe, expect, it } from 'vitest';
import { releaseVerdict } from '../../scripts/docs-only.mjs';

/**
 * Whether a run is the release (#822): a pull request into `main`, the one
 * run the logs suite starts on by itself (Shyden, 2026-10-16: "a release
 * cannot be cut until all checks are complete, including this one. and this
 * is the only time that suite is run automatically"). Fail closed the other
 * way from docs-only: anything that is not exactly that pull request is not a
 * release, so the logs job is skipped there and `build-and-test` refuses it
 * skipped where this says true.
 */
describe('releaseVerdict', () => {
  it('is true for a pull request into main', () => {
    expect(releaseVerdict({ event: 'pull_request', base: 'main' })).toBe(true);
  });

  it.each([
    ['a pull request into develop', 'pull_request', 'develop'],
    ['a pull request into a branch named like main', 'pull_request', 'main-x'],
    ['a pull request with no base', 'pull_request', undefined],
    ['a push, as deploy-dev calls ci.yml', 'push', 'main'],
    ['a dispatched run', 'workflow_dispatch', 'main'],
    ['a run naming no event', undefined, 'main'],
  ])('is false for %s', (_, event, base) => {
    expect(releaseVerdict({ event, base })).toBe(false);
  });
});
