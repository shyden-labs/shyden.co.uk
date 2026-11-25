import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmServes, liveDeploymentOf } from '../../src/lib/pages';
import { pagesApi } from '../../scripts/pages.mjs';

/**
 * A release that fails its live check falls back to the deployment that was
 * live before it (#748). The live one is the project's
 * `canonical_deployment`, read before the deploy; the fall-back is one
 * rollback request to it, then one read confirming it is live again.
 */

const project = (id: unknown) => ({
  success: true,
  result: { name: 'shyden-site', canonical_deployment: { id } },
});

describe('liveDeploymentOf reads the deployment a project serves', () => {
  it('reads the canonical deployment id', () => {
    expect(
      liveDeploymentOf(project('3f2a9c1e-0b7d-4e5a-9f10-2c3d4e5f6a7b')),
    ).toBe('3f2a9c1e-0b7d-4e5a-9f10-2c3d4e5f6a7b');
  });

  it('refuses an answer with no canonical deployment: there is nothing to fall back to', () => {
    expect(() =>
      liveDeploymentOf({ success: true, result: { name: 'shyden-site' } }),
    ).toThrow('the project answer names no live (canonical) deployment');
  });

  it('refuses an id that is not a deployment id, without echoing it', () => {
    expect(() => liveDeploymentOf(project('x; rm -rf /'))).toThrow(
      'the live deployment id is not a Cloudflare Pages deployment id',
    );
  });

  it('refuses an answer that is not a project', () => {
    expect(() => liveDeploymentOf('nope')).toThrow(
      'the project answer names no live (canonical) deployment',
    );
  });
});

describe('confirmServes says whether the fall-back took', () => {
  it('passes when the project now serves the deployment asked for', () => {
    expect(() => confirmServes(project('d-prev'), 'd-prev')).not.toThrow();
  });

  it('fails naming both when the project serves another', () => {
    expect(() => confirmServes(project('d-bad'), 'd-prev')).toThrow(
      'the project serves d-bad, not d-prev',
    );
  });
});

describe('pagesApi makes one request per read, and two for a fall-back', () => {
  const calls: { method: string; url: string; auth: string | null }[] = [];
  const answers: unknown[] = [];
  const stub = () =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({
          method: init.method ?? 'GET',
          url,
          auth: new Headers(init.headers).get('authorization'),
        });
        return new Response(JSON.stringify(answers.shift()), {
          status: 200,
        });
      }),
    );
  const api = () =>
    pagesApi({
      base: 'https://cf.test/client/v4',
      account: 'acct',
      token: 'tok',
      timeoutMs: 1000,
    });
  const PROJECT =
    'https://cf.test/client/v4/accounts/acct/pages/projects/shyden-site';

  afterEach(() => {
    vi.unstubAllGlobals();
    calls.length = 0;
    answers.length = 0;
  });

  it('live reads the project once and answers its live deployment', async () => {
    stub();
    answers.push(project('d-live'));
    expect(await api().live('shyden-site')).toBe('d-live');
    expect(calls).toEqual([
      { method: 'GET', url: PROJECT, auth: 'Bearer tok' },
    ]);
  });

  it('restore asks for the rollback once, then reads the project once to confirm', async () => {
    stub();
    answers.push(
      { success: true, result: { id: 'd-prev' } },
      project('d-prev'),
    );
    await api().restore('shyden-site', 'd-prev');
    expect(calls).toEqual([
      {
        method: 'POST',
        url: `${PROJECT}/deployments/d-prev/rollback`,
        auth: 'Bearer tok',
      },
      { method: 'GET', url: PROJECT, auth: 'Bearer tok' },
    ]);
  });

  it('restore fails when the project still serves the failed release', async () => {
    stub();
    answers.push({ success: true, result: { id: 'd-prev' } }, project('d-bad'));
    await expect(api().restore('shyden-site', 'd-prev')).rejects.toThrow(
      'the project serves d-bad, not d-prev',
    );
  });

  it('restore refuses an id that is not a deployment id, before any request', async () => {
    stub();
    await expect(api().restore('shyden-site', '../x')).rejects.toThrow(
      'the deployment to restore is not a Cloudflare Pages deployment id',
    );
    expect(calls).toEqual([]);
  });

  it('refuses a project name outside its shape, before any request', async () => {
    stub();
    await expect(api().live('../other')).rejects.toThrow(
      'the project name is not a Cloudflare Pages project name',
    );
    expect(calls).toEqual([]);
  });
});
