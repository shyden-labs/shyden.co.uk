import { describe, expect, it } from 'vitest';
import { report } from '../../scripts/dependabot-failures.mjs';

/**
 * `scripts/dependabot-failures.mjs`'s `report` (#1119) against a stand-in
 * GitHub client answering in GitHub's shapes. The stand-in records every
 * request, so what the check asked and posted is read off its own record.
 */

const NOW = new Date('2026-11-10T09:00:00Z');
const RUNS =
  '/actions/runs?event=dynamic&created=%3E%3D2026-11-03&per_page=100';
const ISSUES =
  '/issues?state=open&creator=github-actions%5Bbot%5D&per_page=100';
const TITLE = 'A Dependabot update run failed';

const FAILED = {
  id: 42574190341,
  name: 'docker in /.github/node - Update #1689136452',
  path: 'dynamic/dependabot/dependabot-updates',
  status: 'completed',
  conclusion: 'failure',
  created_at: '2026-11-09T06:37:34Z',
  html_url:
    'https://github.com/shyden-labs/shyden.co.uk/actions/runs/42574190341',
};

const JOBS = `/actions/runs/${FAILED.id}/jobs?filter=latest&per_page=100`;
const LOG = '/actions/jobs/129018109738/logs';

type Answer = unknown | Error;

/** A client whose answers are `routes`; every request is recorded. */
const standIn = (routes: Record<string, Answer>) => {
  const asked: { path: string; body?: unknown }[] = [];
  const answer = (path: string, body?: unknown) => {
    asked.push(body === undefined ? { path } : { path, body });
    const key = `${body === undefined ? 'GET' : 'POST'} ${path}`;
    if (!(key in routes)) throw new Error(`no stand-in route for ${key}`);
    const reply = routes[key];
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return {
    asked,
    github: {
      json: async (path: string, body?: unknown) => answer(path, body),
      text: async (path: string) => String(answer(path)),
    },
  };
};

const failedWeek = (): Record<string, Answer> => ({
  [`GET ${RUNS}`]: { workflow_runs: [FAILED] },
  [`GET ${JOBS}`]: {
    jobs: [{ id: 129018109738, name: 'Dependabot', conclusion: 'failure' }],
  },
  [`GET ${LOG}`]: [
    '2026-11-09T06:38:06.2179717Z updater | 2026/11/09 06:38:06 INFO <job_1689136452> Handled error whilst updating node: dependency_file_not_supported',
    '2026-11-09T06:38:07.8949599Z ##[error]Dependabot encountered an error performing the update',
    '2026-11-09T06:38:07.8958666Z 🤖 ~ finished: error reported to Dependabot ~',
  ].join('\n'),
  [`GET ${ISSUES}`]: [],
  'POST /issues': { number: 1200, assignees: [{ login: 'ShydenMcM' }] },
});

describe('report: a failed Dependabot run opens one notice (#1119)', () => {
  it('opens an issue assigned to the operator, naming the run and its error line', async () => {
    const { asked, github } = standIn(failedWeek());
    await expect(report(github, NOW)).resolves.toBe(
      'Opened #1200, assigned to ShydenMcM.',
    );
    const posted = asked.find(({ path }) => path === '/issues');
    expect(posted?.body).toMatchObject({
      title: TITLE,
      assignees: ['ShydenMcM'],
    });
    const body = (posted?.body as { body: string }).body;
    expect(body).toContain(
      '[docker in /.github/node - Update #1689136452](https://github.com/shyden-labs/shyden.co.uk/actions/runs/42574190341), 2026-11-09',
    );
    expect(body).toContain(
      '`Handled error whilst updating node: dependency_file_not_supported`',
    );
  });

  it('posts nothing in a week with no failed run', async () => {
    const { asked, github } = standIn({
      [`GET ${RUNS}`]: {
        workflow_runs: [{ ...FAILED, conclusion: 'success' }],
      },
    });
    await expect(report(github, NOW)).resolves.toBe(
      'No Dependabot update run failed since 2026-11-03: no notice.',
    );
    expect(asked.map(({ path }) => path)).toEqual([RUNS]);
  });

  it('comments on the notice still open rather than opening a second', async () => {
    const routes = failedWeek();
    routes[`GET ${ISSUES}`] = [
      {
        number: 1199,
        state: 'open',
        title: TITLE,
        user: { login: 'github-actions[bot]' },
      },
    ];
    routes['POST /issues/1199/comments'] = { id: 1 };
    const { asked, github } = standIn(routes);
    await expect(report(github, NOW)).resolves.toBe(
      'Commented on the open notice, #1199.',
    );
    expect(asked.some(({ path }) => path === '/issues')).toBe(false);
  });

  it('still names the run when its log cannot be read', async () => {
    const routes = failedWeek();
    routes[`GET ${LOG}`] = new Error('HTTP 410');
    const { asked, github } = standIn(routes);
    await report(github, NOW);
    const body = (
      asked.find(({ path }) => path === '/issues')?.body as { body: string }
    ).body;
    expect(body).toContain('docker in /.github/node - Update #1689136452');
    expect(body).toContain('its log could not be read (HTTP 410)');
  });

  it('fails when the runs cannot be read, rather than reporting a quiet week', async () => {
    const { github } = standIn({ [`GET ${RUNS}`]: new Error('HTTP 403') });
    await expect(report(github, NOW)).rejects.toThrow('HTTP 403');
  });

  it('fails when GitHub opens the notice without its assignee', async () => {
    const routes = failedWeek();
    routes['POST /issues'] = { number: 1200, assignees: [] };
    const { github } = standIn(routes);
    await expect(report(github, NOW)).rejects.toThrow(
      'Opened #1200, but it is not assigned to ShydenMcM',
    );
  });
});
