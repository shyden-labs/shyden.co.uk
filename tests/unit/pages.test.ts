import { describe, it, expect } from 'vitest';
import {
  DEPLOYMENT_ID,
  confirmLive,
  liveDeploymentOf,
  rollbackAccepted,
} from '../../src/lib/pages';

/**
 * Cloudflare Pages answers for the automatic rollback (#748) and the manual
 * one (#406): what is live, whether a rollback was accepted, and whether it
 * took.
 */

/** A Pages project answer naming `id` as its live deployment. */
const project = (id: unknown) => ({
  success: true,
  result: { name: 'shyden-site', canonical_deployment: { id } },
});

describe('DEPLOYMENT_ID', () => {
  it('is letters, digits and dashes, the whole value', () => {
    expect(DEPLOYMENT_ID.source).toBe('^[A-Za-z0-9-]+$');
  });
});

describe('liveDeploymentOf', () => {
  it("answers the project's canonical deployment id", () => {
    expect(liveDeploymentOf(project('3f2a91c0-77d4-4e0b'))).toBe(
      '3f2a91c0-77d4-4e0b',
    );
  });
  it('a project answer naming no canonical deployment throws', () => {
    expect(() =>
      liveDeploymentOf({ success: true, result: { name: 'shyden-site' } }),
    ).toThrow('the project answer names no canonical deployment');
  });
  it('an empty id throws, rather than name nothing as live', () => {
    expect(() => liveDeploymentOf(project(''))).toThrow(
      'the project answer names no canonical deployment',
    );
  });
  it('an id that could reshape a URL throws', () => {
    expect(() => liveDeploymentOf(project('a/../b'))).toThrow(
      'the canonical deployment id is not a Pages deployment id',
    );
  });
  it('an id carrying a line break, which would add an output line, throws', () => {
    expect(() => liveDeploymentOf(project('a\nevil=1'))).toThrow(
      'the canonical deployment id is not a Pages deployment id',
    );
  });
  it('an answer that is not an object throws', () => {
    expect(() => liveDeploymentOf('nope')).toThrow(
      'the project answer names no canonical deployment',
    );
  });
});

describe('rollbackAccepted', () => {
  it('a success answer passes', () => {
    expect(
      rollbackAccepted({ success: true, result: { id: 'd-prev' } }),
    ).toBeUndefined();
  });
  it("a refusal throws with Cloudflare's own errors", () => {
    expect(() =>
      rollbackAccepted({
        success: false,
        errors: [{ code: 8000007, message: 'Deployment not found' }],
      }),
    ).toThrow('Cloudflare refused the rollback: 8000007 Deployment not found');
  });
  it('an answer without success: true throws, saying no reason was given', () => {
    expect(() => rollbackAccepted({})).toThrow(
      'Cloudflare refused the rollback: no reason given',
    );
  });
});

describe('confirmLive', () => {
  it('passes when the target is the live deployment', () => {
    expect(confirmLive(project('d-prev'), 'd-prev')).toBeUndefined();
  });
  it('throws naming what is live instead', () => {
    expect(() => confirmLive(project('d-new'), 'd-prev')).toThrow(
      'the rollback was accepted, but the live deployment is d-new, not d-prev',
    );
  });
});
