import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nonEmpty } from '../source-files';
import { parseCleanYaml } from '../workflow-jobs';

const WORKFLOWS = '.github/workflows';
const workflow = (name: string) => readFileSync(join(WORKFLOWS, name), 'utf8');

describe('the deploy pipeline runs what it claims to', () => {
  // ---- the rollback's dry run (#241, Shyden's decision 2026-09-19) --------
  //
  // prod-rollback accepts `main` alone, so the rollback's secrets can only be
  // proved on main, and rolling prod back to prove them is no proof anyone
  // wants. A dry run runs the real job. It checks that both secrets are set,
  // then finds the deployment it would promote with a read-only call that
  // needs the token to reach shyden-site. It skips only the one step that
  // changes what prod serves. The steps' scripts are RUN here, in bash as the
  // runner runs them, never matched as text.
  type RollbackStep = {
    id?: string;
    name?: string;
    if?: unknown;
    run?: unknown;
    env?: Record<string, unknown>;
  };
  type RollbackWorkflow = {
    on?: { workflow_dispatch?: { inputs?: Record<string, unknown> } };
    jobs?: { rollback?: { steps?: RollbackStep[] } };
  };
  const rollbackWorkflow = () =>
    parseCleanYaml(
      workflow('rollback.yml'),
      'rollback.yml',
    ) as RollbackWorkflow;
  const rollbackSteps = (): RollbackStep[] =>
    nonEmpty(
      rollbackWorkflow().jobs?.rollback?.steps ?? [],
      'steps in the rollback job',
    );
  const rollbackStep = (name: string): RollbackStep => {
    const step = rollbackSteps().find((each) => each.name === name);
    expect(step, `rollback.yml has no step named '${name}'`).toBeDefined();
    return step!;
  };

  // A step's script as the runner runs it: bash with -eo pipefail and no
  // profile, given only the env named here and a RUNNER_TEMP of its own.
  // `https_proxy` points at a closed port, so a script that reaches for the
  // network fails on the spot rather than calling Cloudflare. Given
  // `cloudflare`, a stand-in `curl` ahead on PATH answers the Pages API with
  // it instead: the deployments list for a URL naming them, the project for
  // any other (#406).
  const runStep = (
    step: RollbackStep,
    env: Record<string, string>,
    cloudflare?: { project: unknown; deployments: unknown },
  ) => {
    const script = String(step.run ?? '');
    expect(script, `${step.name} runs no script`).not.toBe('');
    expect(script, 'an expression reaches a script through env').not.toMatch(
      /\$\{\{/,
    );
    const dir = mkdtempSync(join(tmpdir(), 'rollback-step-'));
    const outputs = join(dir, 'outputs');
    writeFileSync(outputs, '');
    const bin = join(dir, 'bin');
    // Apart from RUNNER_TEMP's own files: the step writes its answers to
    // `$RUNNER_TEMP/project.json`, and a shell redirect empties that file
    // before the stand-in could read a canned copy kept at the same path.
    const api = join(dir, 'api');
    if (cloudflare !== undefined) {
      mkdirSync(bin);
      mkdirSync(api);
      writeFileSync(
        join(api, 'project.json'),
        JSON.stringify(cloudflare.project),
      );
      writeFileSync(
        join(api, 'deployments.json'),
        JSON.stringify(cloudflare.deployments),
      );
      writeFileSync(
        join(bin, 'curl'),
        [
          '#!/bin/bash',
          'for arg; do url=$arg; done',
          'case "$url" in',
          `  */deployments*) cat '${join(api, 'deployments.json')}' ;;`,
          `  *) cat '${join(api, 'project.json')}' ;;`,
          'esac',
          '',
        ].join('\n'),
      );
      chmodSync(join(bin, 'curl'), 0o755);
    }
    try {
      const run = spawnSync(
        'bash',
        ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script],
        {
          encoding: 'utf8',
          timeout: 10_000,
          env: {
            PATH: `${cloudflare === undefined ? '' : `${bin}:`}${process.env.PATH ?? ''}`,
            https_proxy: 'http://127.0.0.1:9',
            HTTPS_PROXY: 'http://127.0.0.1:9',
            GITHUB_OUTPUT: outputs,
            RUNNER_TEMP: dir,
            ...env,
          },
        },
      );
      return {
        status: run.status,
        log: `${run.stdout}${run.stderr}`,
        outputs: readFileSync(outputs, 'utf8'),
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const CLOUDFLARE_ENV = {
    CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}',
    CLOUDFLARE_ACCOUNT_ID: '${{ secrets.CLOUDFLARE_ACCOUNT_ID }}',
  };
  const TOKEN = 'token-value-never-printed';
  const ACCOUNT = 'account-value-never-printed';

  it('a rollback stops before Cloudflare when either secret is missing, and never prints one (#241)', () => {
    const check = rollbackStep('Check the secrets are set');
    expect(check.env).toEqual(CLOUDFLARE_ENV);
    const both = runStep(check, {
      CLOUDFLARE_API_TOKEN: TOKEN,
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
    });
    expect(both.status, both.log).toBe(0);
    expect(both.log).toMatch(/^CLOUDFLARE_API_TOKEN: present$/m);
    expect(both.log).toMatch(/^CLOUDFLARE_ACCOUNT_ID: present$/m);
    expect(both.log).not.toContain(TOKEN);
    expect(both.log).not.toContain(ACCOUNT);
    // An empty secret is what the runner hands a job that cannot read it, and
    // an unset one is checked as well.
    const empty = runStep(check, {
      CLOUDFLARE_API_TOKEN: '',
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
    });
    expect(empty.status).not.toBe(0);
    expect(empty.log).toMatch(/^::error::CLOUDFLARE_API_TOKEN: absent\. /m);
    const unset = runStep(check, { CLOUDFLARE_API_TOKEN: TOKEN });
    expect(unset.status).not.toBe(0);
    expect(unset.log).toMatch(/^::error::CLOUDFLARE_ACCOUNT_ID: absent\. /m);
  });

  it('the find step passes on a deployment id and refuses anything that could reshape the call (#241)', () => {
    const find = rollbackStep('Find the deployment to roll back to');
    expect(find.id).toBe('find');
    expect(find.env).toEqual({
      ...CLOUDFLARE_ENV,
      TARGET_ID: '${{ inputs.deployment_id }}',
    });
    const credentials = {
      CLOUDFLARE_API_TOKEN: TOKEN,
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
    };
    const id = '6f1c2a3b-0d4e-4f5a-9b6c-7d8e9f0a1b2c';
    // Live is the newest; the one before it failed its build, and a preview
    // sits between: the target is the successful production one before them.
    const deployment = (
      deploymentId: string,
      createdOn: string,
      environment = 'production',
      status = 'success',
    ) => ({
      id: deploymentId,
      environment,
      created_on: createdOn,
      latest_stage: { status },
    });
    const cloudflare = {
      project: { result: { canonical_deployment: { id: 'live-4' } } },
      deployments: {
        result: [
          deployment('live-4', '2026-10-13T04:00:00Z'),
          deployment('preview-3', '2026-10-13T03:00:00Z', 'preview'),
          deployment(
            'failed-2',
            '2026-10-13T02:00:00Z',
            'production',
            'failure',
          ),
          deployment('good-1', '2026-10-13T01:00:00Z'),
        ],
      },
    };
    const given = runStep(find, { ...credentials, TARGET_ID: id }, cloudflare);
    expect(given.status, given.log).toBe(0);
    expect(given.outputs).toBe(`target=${id}\n`);
    const chosen = runStep(find, { ...credentials, TARGET_ID: '' }, cloudflare);
    expect(chosen.status, chosen.log).toBe(0);
    expect(chosen.outputs).toBe('target=good-1\n');
    // A path that climbs out of the project, a second output line, a space.
    for (const bad of ['../../dns_records', `${id}\ntarget=other`, 'a b']) {
      const run = runStep(find, { ...credentials, TARGET_ID: bad }, cloudflare);
      expect(run.status, JSON.stringify(bad)).not.toBe(0);
      expect(run.outputs, JSON.stringify(bad)).toBe('');
    }
    // No id and no Cloudflare: the lookup fails, and no target is handed on.
    const unreachable = runStep(find, { ...credentials, TARGET_ID: '' });
    expect(unreachable.status).not.toBe(0);
    expect(unreachable.outputs).toBe('');
  });

  it('the promote step takes its target from the find step, and stops if there is none (#241)', () => {
    const promote = rollbackStep('Promote it');
    expect(promote.env).toEqual({
      ...CLOUDFLARE_ENV,
      TARGET: '${{ steps.find.outputs.target }}',
    });
    const run = runStep(promote, {
      CLOUDFLARE_API_TOKEN: TOKEN,
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
      TARGET: '',
    });
    expect(run.status).not.toBe(0);
    // Stopped by its own guard, not by curl failing to reach the proxy.
    expect(run.log).toMatch(/^::error::No deployment to roll back to: /m);
  });
});
