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

  const verdict = (files: string[], needs: unknown) =>
    spawnSync(process.execPath, [SCRIPT, ...files], {
      encoding: 'utf8',
      env: { ...process.env, NEEDS_JSON: JSON.stringify(needs) },
    });

  const succeeded = {
    checks: { result: 'success', outputs: {} },
    e2e: { result: 'success', outputs: {} },
  };

  it('passes when every job succeeded and the shards add up, and says so', () => {
    const run = verdict(accountFiles(whole()), succeeded);
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/4 shards ran 2210 of the 2210 tests/);
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
    const run = verdict([unmatched], docsOnlyNeeds());
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/docs-only/);
    expect(run.stdout).toMatch(/e2e, functions, sanity-on-build/);
  });

  it('fails a docs-only verdict when a shard ran anyway', () => {
    const run = verdict(
      accountFiles(whole()),
      docsOnlyNeeds({ e2e: { result: 'success', outputs: {} } }),
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
      scope: { result: 'success', outputs: { docs_only: 'false' } },
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/e2e finished `skipped`, not `success`/);
    expect(run.stderr).toMatch(/no shard accounted for itself/);
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
