import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accountFileName } from '../../scripts/e2e-shards.mjs';
import { type Account, whole, docsOnlyNeeds } from '../e2e-shards-shared';

describe('the verdict, run as build-and-test runs it', () => {
  const SCRIPT = join(process.cwd(), 'scripts/e2e-shards.mjs');
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });

  const scratch = () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-accounts-'));
    dirs.push(dir);
    return dir;
  };

  /**
   * Each account in the file its shard writes, handed over as the list the
   * workflow's shell glob produces. The verdict reads the files it is given
   * and lists no directory, so an empty download cannot read as an empty
   * directory that proved nothing (#84).
   */
  const accountFiles = (accounts: Account[]) => {
    const dir = scratch();
    return accounts.map((each) => {
      const file = join(dir, accountFileName(each.shard));
      writeFileSync(file, JSON.stringify(each));
      return file;
    });
  };

  /**
   * The capture shards' files (#774), as the workflow hands them over: the
   * four accounts where scope said the capture runs, and otherwise the
   * literal pattern of a glob that matched nothing, as a skipped download
   * leaves it. A test that is about the capture passes its own.
   */
  const captureFilesFor = (needs: unknown) => {
    const said = (needs as { scope?: { outputs?: { capture?: string } } })
      ?.scope?.outputs?.capture;
    return said === 'true'
      ? accountFiles(whole())
      : [join(scratch(), '*.json')];
  };

  const verdict = (
    files: string[],
    needs: unknown,
    captureFiles: string[] = captureFilesFor(needs),
  ) =>
    spawnSync(
      process.execPath,
      [SCRIPT, ...files, '--capture', ...captureFiles],
      {
        encoding: 'utf8',
        env: { ...process.env, NEEDS_JSON: JSON.stringify(needs) },
      },
    );

  /**
   * `needs` with the capture job (#774) as scope's verdict leaves it, beside a
   * logs suite (#822) skipped as on every pull request that is not a release.
   * The release-cut check is no job of ci.yml's (#944): it posts a status.
   */
  const capturing = (
    needs: Record<string, unknown>,
    said: 'true' | 'false',
    result: string,
  ) => {
    const scope = needs.scope as
      { outputs?: Record<string, string> } | undefined;
    return {
      logs: { result: 'skipped', outputs: {} },
      ...needs,
      scope: {
        result: 'success',
        outputs: {
          docs_only: 'false',
          release: 'false',
          ...scope?.outputs,
          capture: said,
        },
      },
      capture: { result, outputs: {} },
    };
  };

  /**
   * `needs` on a release pull request (#822): scope says the logs suite runs.
   */
  const releasing = (needs: Record<string, unknown>, logs: string) => {
    const scope = needs.scope as { outputs: Record<string, string> };
    return {
      ...needs,
      scope: { ...scope, outputs: { ...scope.outputs, release: 'true' } },
      logs: { result: logs, outputs: {} },
    };
  };

  const succeeded = capturing(
    {
      checks: { result: 'success', outputs: {} },
      e2e: { result: 'success', outputs: {} },
    },
    'true',
    'success',
  );

  it('passes when every job succeeded and the shards add up, and says so', () => {
    const run = verdict(accountFiles(whole()), succeeded);
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/4 shards ran 2210 of the 2210 tests/);
    expect(run.stdout).toMatch(
      /4 capture shards ran 2210 of the 2210 cases the release selection holds/,
    );
  });

  it('fails when the capture shards fall short of the selection (#774)', () => {
    const run = verdict(
      accountFiles(whole()),
      succeeded,
      accountFiles(whole().slice(0, 3)),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(
      /the capture: shard 4 of 4 never accounted for itself/,
    );
  });

  it('fails, naming it, when the capture ran and its glob matched no account (#774)', () => {
    const unmatched = join(scratch(), '*.json');
    const run = verdict(accountFiles(whole()), succeeded, [unmatched]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(
      `the capture: ${unmatched} does not exist, so it holds no shard's account`,
    );
  });

  it('fails when a capture account exists where scope said the capture is skipped (#774)', () => {
    const run = verdict(
      accountFiles(whole()),
      capturing(succeeded, 'false', 'skipped'),
      accountFiles(whole()),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(
      /the capture: 4 shard accounts were written, where scope said the capture does not run/,
    );
  });

  it('fails when it is handed no --capture accounts at all (#774)', () => {
    const run = spawnSync(
      process.execPath,
      [SCRIPT, ...accountFiles(whole())],
      {
        encoding: 'utf8',
        env: { ...process.env, NEEDS_JSON: JSON.stringify(succeeded) },
      },
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(
      /handed no --capture accounts, so the capture shards cannot be added up/,
    );
  });

  it('fails when a shard failed, even though the accounts add up', () => {
    const run = verdict(accountFiles(whole()), {
      ...succeeded,
      e2e: { result: 'failure', outputs: {} },
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/e2e.*failure/);
  });

  it('fails when the accounts fall short, even though every job succeeded', () => {
    const run = verdict(accountFiles(whole().slice(0, 3)), succeeded);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/shard 4 of 4/);
  });

  // bash leaves a glob that matches nothing as the literal pattern, so a
  // download that brought no account arrives as one path that does not exist.
  it('fails, naming it, when the glob matched no account at all', () => {
    const unmatched = join(scratch(), '*.json');
    const run = verdict([unmatched], succeeded);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`${unmatched} does not exist`);
    expect(run.stderr).toMatch(/no shard accounted for itself/);
  });

  it('fails, rather than passing on nothing, when it is handed no files', () => {
    const run = verdict([], succeeded);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/no shard accounted for itself/);
  });

  it('names a file that is not an account at all', () => {
    const [first, ...rest] = accountFiles(whole());
    writeFileSync(first, '{ not json');
    const run = verdict([first, ...rest], succeeded);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/not an account/);
  });

  it('passes a docs-only pull request whose download was skipped, and says so', () => {
    const unmatched = join(scratch(), '*.json');
    const run = verdict(
      [unmatched],
      capturing(docsOnlyNeeds(), 'false', 'skipped'),
    );
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/docs-only/);
    expect(run.stdout).toMatch(/coverage, e2e, functions, sanity-on-build/);
  });

  it('fails a docs-only verdict when a shard ran anyway', () => {
    const run = verdict(
      accountFiles(whole()),
      capturing(
        docsOnlyNeeds({ e2e: { result: 'success', outputs: {} } }),
        'false',
        'skipped',
      ),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(
      /e2e finished `success` on a docs-only pull request/,
    );
    expect(run.stderr).toMatch(/is a shard account/);
  });

  it('judges a full run by its accounts when the scope job said false', () => {
    const run = verdict([join(scratch(), '*.json')], {
      ...docsOnlyNeeds(),
      scope: {
        result: 'success',
        outputs: { docs_only: 'false', capture: 'false', release: 'false' },
      },
      capture: { result: 'skipped', outputs: {} },
      logs: { result: 'skipped', outputs: {} },
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/e2e finished `skipped`, not `success`/);
    expect(run.stderr).toMatch(/no shard accounted for itself/);
  });

  it('passes a full run whose capture scope skipped, and says so', () => {
    const run = verdict(
      accountFiles(whole()),
      capturing(succeeded, 'false', 'skipped'),
    );
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/4 shards ran 2210 of the 2210 tests/);
  });

  it('fails a full run whose capture was skipped where scope said it runs', () => {
    const run = verdict(
      accountFiles(whole()),
      capturing(succeeded, 'true', 'skipped'),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(
      /capture finished `skipped` where scope said it runs, not `success`/,
    );
  });

  it('passes a release whose logs suite succeeded (#822)', () => {
    const run = verdict(accountFiles(whole()), releasing(succeeded, 'success'));
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/4 shards ran 2210 of the 2210 tests/);
  });

  it('fails a release whose logs suite was skipped (#822)', () => {
    const run = verdict(accountFiles(whole()), releasing(succeeded, 'skipped'));
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(
      /logs finished `skipped` where scope said it runs, not `success`/,
    );
  });

  it('fails when it is handed no needs to read', () => {
    const run = spawnSync(
      process.execPath,
      [SCRIPT, ...accountFiles(whole())],
      {
        encoding: 'utf8',
        env: { ...process.env, NEEDS_JSON: '' },
      },
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/could not be read/);
  });
});
