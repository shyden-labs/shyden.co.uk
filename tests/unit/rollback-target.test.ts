import { describe, expect, it } from 'vitest';
import { rollbackTarget } from '../../scripts/rollback-target.mjs';

/**
 * Which deployment a rollback promotes (#406). Not a list position: the
 * newest successful production deployment created before the one Cloudflare
 * calls live (`canonical_deployment`), so a second rollback, or a failed
 * deploy in between, can never pick the live build or a broken one.
 */
const deployment = (
  id: string,
  createdOn: string,
  { environment = 'production', status = 'success' } = {},
) => ({
  id,
  environment,
  created_on: createdOn,
  latest_stage: { name: 'deploy', status },
});

/** Newest first, as Cloudflare lists them. */
const D3 = deployment('d3', '2026-10-12T10:00:00Z');
const D2 = deployment('d2', '2026-10-11T10:00:00Z');
const D1 = deployment('d1', '2026-10-10T10:00:00Z');

describe('rollbackTarget (#406)', () => {
  it('with no rollback yet, takes the deployment before the live one', () => {
    expect(
      rollbackTarget({ deployments: [D3, D2, D1], canonicalId: 'd3' }),
    ).toBe('d2');
  });

  it('after one rollback, steps back from what is LIVE, not from the newest entry', () => {
    // Live is d2 after rolling d3 back; `.[1]` would pick d2 again.
    expect(
      rollbackTarget({ deployments: [D3, D2, D1], canonicalId: 'd2' }),
    ).toBe('d1');
  });

  it('skips a failed production deployment in between', () => {
    const failed = deployment('f', '2026-10-11T12:00:00Z', {
      status: 'failure',
    });
    expect(
      rollbackTarget({ deployments: [D3, failed, D2, D1], canonicalId: 'd3' }),
    ).toBe('d2');
  });

  it('skips preview deployments', () => {
    const preview = deployment('p', '2026-10-11T12:00:00Z', {
      environment: 'preview',
    });
    expect(
      rollbackTarget({ deployments: [D3, preview, D2], canonicalId: 'd3' }),
    ).toBe('d2');
  });

  it('refuses when only one production deployment exists, by name', () => {
    expect(() =>
      rollbackTarget({ deployments: [D3], canonicalId: 'd3' }),
    ).toThrow(
      'No successful production deployment before the live one (d3): nothing to roll back to.',
    );
  });

  it('refuses when the live deployment is not among those listed', () => {
    expect(() =>
      rollbackTarget({ deployments: [D3, D2], canonicalId: 'old' }),
    ).toThrow(
      'The live deployment (old) is not among the 2 listed: list further back, or give deployment_id.',
    );
  });

  it('refuses a requested target that is already live, naming both', () => {
    expect(() =>
      rollbackTarget({
        deployments: [D3, D2, D1],
        canonicalId: 'd2',
        requested: 'd2',
      }),
    ).toThrow(
      'deployment_id d2 is the live deployment (canonical d2): rolling back to it would change nothing.',
    );
  });

  it('takes a requested target that is not live, as given', () => {
    expect(
      rollbackTarget({
        deployments: [D3, D2, D1],
        canonicalId: 'd3',
        requested: 'd1',
      }),
    ).toBe('d1');
  });
});
