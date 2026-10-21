import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { scratchGit, withoutLocalGit } from '../git-env';

/**
 * `scripts/deploy-gate.mjs` as `deploy-dev.yml` runs it: in a checkout, with
 * the commit in GITHUB_SHA and the API behind GITHUB_API_URL.
 *
 * `deploy-gate.test.ts` covers `decideDeploy`. This file covers `main()`,
 * which decides what `decideDeploy` is given and whether its answer stops the
 * job: with the exit on a refusal removed, or the checks read off the first
 * parent, or an HTTP error read as an empty list, the whole suite stayed
 * green. The exit code is the gate, since the deploy job proceeds on 0.
 *
 * The repository is real, built with git in a scratch directory, and so is
 * its merge commit. Only GitHub is a stand-in: a local server answering the
 * one request the script makes.
 */

const SCRIPT = path.resolve(
  import.meta.dirname,
  '../../scripts/deploy-gate.mjs',
);
const REPO = 'shyden-labs/shyden.co.uk';
const TOKEN = 'gate-token';

interface Received {
  readonly method: string;
  readonly url: string;
  readonly auth: string | undefined;
}

let received: Received[] = [];
let answer: (url: string) => { status: number; body: unknown } = () => ({
  status: 404,
  body: {},
});
let server: Server;
let api = '';

let dir = '';
/** The first commit, the tested head, and the merge that carries it. */
let base = '';
let tested = '';
let merge = '';
/** A second pull request's head, and the squash develop landed it as (#892). */
let squashedHead = '';
let squash = '';

const short = (sha: string) => sha.slice(0, 7);

/**
 * The paths the stand-in received, closed by a request this test sends
 * itself once the script has exited. "The script asked nothing" is then
 * `['/sentinel']`, which a listener that never fired cannot produce, where an
 * empty list is what a dead one and a silent script both look like.
 */
const requestsThenSentinel = async (): Promise<string[]> => {
  await fetch(`${api}/sentinel`);
  return received.map(({ url }) => url);
};

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '';
    received.push({
      method: req.method ?? '',
      url,
      auth: req.headers.authorization,
    });
    const { status, body } = answer(url);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  dir = mkdtempSync(path.join(tmpdir(), 'deploy-gate-'));
  const git = scratchGit(dir);
  const head = () => git(['rev-parse', 'HEAD']).trim();
  git(['init', '-q', '-b', 'develop']);
  git(['config', 'user.email', 'gate@example.invalid']);
  git(['config', 'user.name', 'Gate']);
  writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git(['add', 'a.txt']);
  git(['commit', '-q', '-m', 'base']);
  base = head();
  git(['checkout', '-q', '-b', 'feature']);
  writeFileSync(path.join(dir, 'b.txt'), 'b\n');
  git(['add', 'b.txt']);
  git(['commit', '-q', '-m', 'tested head']);
  tested = head();
  git(['checkout', '-q', 'develop']);
  git(['merge', '-q', '--no-ff', 'feature', '-m', 'merge']);
  merge = head();
  git(['checkout', '-q', '-b', 'second']);
  writeFileSync(path.join(dir, 'c.txt'), 'c\n');
  git(['add', 'c.txt']);
  git(['commit', '-q', '-m', 'second tested head']);
  squashedHead = head();
  git(['checkout', '-q', 'develop']);
  git(['merge', '-q', '--squash', 'second']);
  git(['commit', '-q', '-m', 'second, squashed (#900)']);
  squash = head();
  // The merge stays checked out: GITHUB_SHA names the commit each test judges.
  git(['checkout', '-q', merge]);
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  received = [];
});

const CHECKS_PATH = () =>
  `/repos/${REPO}/commits/${tested}/check-runs?per_page=100`;

/** GitHub's answer for the tested head: each required check, concluded. */
const checksOnTested = (visual: string | null = 'success') => {
  answer = (url) =>
    url === CHECKS_PATH()
      ? {
          status: 200,
          body: {
            check_runs: [
              {
                name: 'build-and-test',
                status: 'completed',
                conclusion: 'success',
                completed_at: '2026-09-30T10:00:00Z',
              },
              {
                name: 'visual',
                status: visual === null ? 'in_progress' : 'completed',
                conclusion: visual,
                completed_at: visual === null ? null : '2026-09-30T10:01:00Z',
              },
            ],
          },
        }
      : { status: 404, body: { message: 'Not Found' } };
};

const PULLS_PATH = (sha: string) =>
  `/repos/${REPO}/commits/${sha}/pulls?per_page=100`;
const CHECKS_OF = (sha: string) =>
  `/repos/${REPO}/commits/${sha}/check-runs?per_page=100`;

/** GitHub answering exactly these paths, and 404 for any other. */
const serve = (bodies: Record<string, unknown>) => {
  answer = (url) =>
    Object.hasOwn(bodies, url)
      ? { status: 200, body: bodies[url] }
      : { status: 404, body: { message: 'Not Found' } };
};

/** Both required checks passed. */
const PASSED = {
  check_runs: ['build-and-test', 'visual'].map((name) => ({
    name,
    status: 'completed',
    conclusion: 'success',
    completed_at: '2026-10-21T10:00:00Z',
  })),
};

/** The pull request #900 as `/commits/{sha}/pulls` lists it, landed as `squash`. */
const pull900 = (headSha: string) => ({
  number: 900,
  merged_at: '2026-10-21T10:05:00Z',
  merge_commit_sha: squash,
  head: { sha: headSha },
  base: { ref: 'develop' },
});

/**
 * Run the script with the runner's variables. Asynchronously, and that is not
 * a style choice: `spawnSync` would block this process's event loop, and with
 * it the stand-in server the script is waiting on, so the run never ends.
 */
const run = (
  overrides: Record<string, string | undefined> = {},
): Promise<{ code: number | null; out: string; err: string }> =>
  new Promise((resolve) => {
    const env = {
      ...withoutLocalGit(process.env),
      GITHUB_SHA: merge,
      GITHUB_REPOSITORY: REPO,
      GITHUB_TOKEN: TOKEN,
      GITHUB_API_URL: api,
      ...overrides,
    };
    const child = spawn(process.execPath, [SCRIPT], {
      cwd: dir,
      env: Object.fromEntries(
        Object.entries(env).filter(([, value]) => value !== undefined),
      ),
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('close', (code) => resolve({ code, out, err }));
  });

describe('the deploy gate, run in a checkout against the checks API', () => {
  it('proceeds on a merge whose tree passed, and says why', async () => {
    checksOnTested();
    const tree = scratchGit(dir)(['rev-parse', `${merge}^{tree}`]).trim();

    const { code, out, err } = await run();

    expect(err).toBe('');
    expect(out).toBe(
      `deploy-gate: PROCEED — tree ${short(tree)} is identical to tested head ` +
        `${short(tested)}, which passed build-and-test + visual.\n`,
    );
    expect(code).toBe(0);
  });

  it("asks for the tested head's checks, once, with the token", async () => {
    checksOnTested();
    await run();

    expect(received).toEqual([
      { method: 'GET', url: CHECKS_PATH(), auth: `Bearer ${TOKEN}` },
    ]);
  });

  it('exits 1 on a refusal, which is what stops the deploy job', async () => {
    checksOnTested('failure');

    const { code, out } = await run();

    expect(out).toContain(
      `deploy-gate: REFUSE — visual on ${short(tested)} is failure, not success.`,
    );
    expect(code).toBe(1);
  });

  it('judges the commit in GITHUB_SHA, not whatever is checked out', async () => {
    // The checkout is at the merge; the commit to judge is the tested head,
    // which has one parent and no pull request landed: a direct push.
    serve({ [PULLS_PATH(tested)]: [] });
    const { code, out } = await run({ GITHUB_SHA: tested });

    expect(out).toContain(
      `deploy-gate: REFUSE — ${short(tested)} has one parent and no merged pull request into develop landed it`,
    );
    expect(await requestsThenSentinel()).toEqual([
      PULLS_PATH(tested),
      '/sentinel',
    ]);
    expect(code).toBe(1);
    expect(short(base)).not.toBe(short(tested));
  });

  it('refuses an HTTP error, rather than reading it as no checks', async () => {
    answer = () => ({ status: 500, body: { message: 'Server Error' } });

    const { code, err } = await run();

    expect(err).toContain(
      `deploy-gate: REFUSE — check-runs for ${short(tested)}: HTTP 500`,
    );
    expect(code).toBe(1);
  });

  it('refuses an API it cannot reach, naming the request and the cause', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) =>
      closed.listen(0, '127.0.0.1', resolve),
    );
    const port = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));

    const { code, err } = await run({
      GITHUB_API_URL: `http://127.0.0.1:${port}`,
    });

    expect(err).toContain(
      `deploy-gate: REFUSE — GET http://127.0.0.1:${port}/repos/${REPO}/commits/` +
        `${tested}/check-runs?per_page=100 could not be reached: ` +
        `connect ECONNREFUSED 127.0.0.1:${port}`,
    );
    expect(code).toBe(1);
  });

  it('refuses without a token, before asking anything', async () => {
    checksOnTested();

    const { code, err } = await run({ GITHUB_TOKEN: undefined });

    expect(err).toContain('GITHUB_REPOSITORY and GITHUB_TOKEN are required');
    expect(await requestsThenSentinel()).toEqual(['/sentinel']);
    expect(code).toBe(1);
  });
});

describe('the deploy gate on a squash, run in a checkout against the API (#892)', () => {
  it('proceeds on a squash whose pull request head has its tree and passed, and says why', async () => {
    serve({
      [PULLS_PATH(squash)]: [pull900(squashedHead)],
      [CHECKS_OF(squashedHead)]: PASSED,
    });
    const tree = scratchGit(dir)(['rev-parse', `${squash}^{tree}`]).trim();

    const { code, out, err } = await run({ GITHUB_SHA: squash });

    expect(err).toBe('');
    expect(out).toBe(
      `deploy-gate: PROCEED — squash ${short(squash)} of pull request #900: ` +
        `tree ${short(tree)} is identical to tested head ${short(squashedHead)}, ` +
        'which passed build-and-test + visual.\n',
    );
    expect(code).toBe(0);
    expect(await requestsThenSentinel()).toEqual([
      PULLS_PATH(squash),
      CHECKS_OF(squashedHead),
      '/sentinel',
    ]);
  });

  it('refuses a squash whose pull request names a head with another tree', async () => {
    serve({
      [PULLS_PATH(squash)]: [pull900(tested)],
      [CHECKS_OF(tested)]: PASSED,
    });

    const { code, out } = await run({ GITHUB_SHA: squash });

    expect(out).toContain(
      `deploy-gate: REFUSE — tree mismatch: ${short(squash)} is `,
    );
    expect(code).toBe(1);
  });

  it('reads the head’s tree from the API when the checkout does not hold the head', async () => {
    const tree = scratchGit(dir)(['rev-parse', `${squash}^{tree}`]).trim();
    const gone = 'c'.repeat(40);
    serve({
      [PULLS_PATH(squash)]: [pull900(gone)],
      [`/repos/${REPO}/git/commits/${gone}`]: { tree: { sha: tree } },
      [CHECKS_OF(gone)]: PASSED,
    });

    const { code, out } = await run({ GITHUB_SHA: squash });

    expect(out).toContain(
      `deploy-gate: PROCEED — squash ${short(squash)} of pull request #900: `,
    );
    expect(code).toBe(0);
  });

  it('refuses a squash whose pull requests cannot be read', async () => {
    serve({});

    const { code, out } = await run({ GITHUB_SHA: squash });

    expect(out).toContain(
      `deploy-gate: REFUSE — could not read the pull requests of ${short(squash)} ` +
        `(pulls for ${short(squash)}: HTTP 404)`,
    );
    expect(await requestsThenSentinel()).toEqual([
      PULLS_PATH(squash),
      '/sentinel',
    ]);
    expect(code).toBe(1);
  });
});
