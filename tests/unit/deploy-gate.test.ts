import { describe, it, expect } from 'vitest';
import { REQUIRED_CHECKS, decideDeploy } from '../../scripts/deploy-gate.mjs';

/**
 * The dev deploy may skip re-running the suite ONLY when the bytes it is about
 * to publish are provably the bytes that passed.
 *
 * `deploy-dev.yml` used to re-run the entire merge gate on every push to
 * `develop` — the same seven steps `ci.yml` runs, ~26 minutes, on a tree that
 * had already passed them. That duplicate was also the ONLY place the suite ran
 * under a `timeout-minutes`, which is how run 34676066071 was cancelled at
 * 24m02s and the deploy was silently skipped (#155, #157).
 *
 * The obvious fix — "read the build-and-test status off the commit" — does not
 * work, and measuring that first is what produced this design. `ci.yml` never
 * runs on a push (its triggers are `pull_request` and the dispatch path's
 * `workflow_call`), so a pushed merge commit carries no status to read. What
 * IS true is that `develop` sets `strict: true`,
 * so a PR cannot merge unless it is up to date with its base, which makes the
 * merge commit's TREE identical to the tested head's tree. Measured on 6695877:
 * both are eb26eb490c6c84e670315b1103199d4006fa5998.
 *
 * So the gate verifies tree equality rather than trusting a status to exist.
 * That is strictly stronger: it refuses BY CONSTRUCTION whenever the deployed
 * bytes are not the bytes that passed — a direct push, a dispatched branch, or
 * any tree that differs. A squash merge (#892, one parent) finds its tested
 * head through the pull request GitHub records it came from, and is held to
 * the same tree equality and the same checks.
 *
 * Every branch below refuses. That is deliberate: this gate's only dangerous
 * failure is a false GREEN, so the tests are weighted towards proving it says no.
 */

const TREE = 'eb26eb490c6c84e670315b1103199d4006fa5998';
const OTHER_TREE = 'ffffffffffffffffffffffffffffffffffffffff';
const MERGE = '669587713e399575eac5c8d3b0cc4593ab9281fc';
const HEAD = '49fd9c514554e1db505cf4faa8e9733fe78f30f2';

/**
 * The three fields of a check-run this gate reads, spelled out so a fixture
 * that drifts from the contract fails to COMPILE. `conclusion: null` is a real
 * state — a run still going — and is precisely the value that must never be
 * read as a pass, so the type has to admit it.
 */
type CheckRun = {
  name: string;
  conclusion: string | null;
  completedAt: string | null;
};

const passing = (
  name: string,
  completedAt = '2026-09-13T00:00:00Z',
): CheckRun => ({
  name,
  conclusion: 'success',
  completedAt,
});

/** A merge commit whose tree provably matches its tested second parent. */
const sound = (
  checks: CheckRun[] = REQUIRED_CHECKS.map((n) => passing(n)),
) => ({
  sha: MERGE,
  parents: ['0000000000000000000000000000000000000000', HEAD],
  treeOf: { [MERGE]: TREE, [HEAD]: TREE },
  checks,
});

describe('the dev deploy gate only skips the suite for bytes that passed it', () => {
  it('names exactly the checks that gate a merge, and no fewer', () => {
    // A literal pin against the branch-protection contexts, separate from every
    // guard that derives from it (#117). `visual` is in `develop`'s required
    // contexts alongside `build-and-test`; a gate that forgot it would deploy a
    // tree whose visual regressions were never judged.
    expect(REQUIRED_CHECKS).toEqual(['build-and-test', 'visual']);
  });

  it('deploys when the tree matches the tested head and every check passed', () => {
    expect(decideDeploy(sound())).toMatchObject({ deploy: true });
  });

  describe('refuses when the deployed bytes were never tested as this tree', () => {
    it('refuses a one-parent commit whose pull requests were never read', () => {
      const result = decideDeploy({ ...sound(), parents: [HEAD] });
      expect(result.deploy).toBe(false);
      expect(result.reason).toMatch(/pull request/i);
    });

    it('refuses a root commit with no parents at all', () => {
      expect(decideDeploy({ ...sound(), parents: [] })).toEqual({
        deploy: false,
        reason: `6695877 has no parents: no tested head can stand for it, so the suite has to run here.`,
      });
    });

    it('refuses when the merge tree differs from the tested tree', () => {
      const result = decideDeploy({
        ...sound(),
        treeOf: { [MERGE]: OTHER_TREE, [HEAD]: TREE },
      });
      expect(result.deploy).toBe(false);
      expect(result.reason).toMatch(/tree/i);
    });

    it('refuses when a tree could not be resolved, rather than assuming equality', () => {
      const result = decideDeploy({ ...sound(), treeOf: { [MERGE]: TREE } });
      expect(result.deploy).toBe(false);
      expect(result.reason).toMatch(/tree/i);
    });
  });

  describe('refuses unless every required check actually reports success', () => {
    it('refuses an EMPTY check list instead of reading it as "no failures"', () => {
      // The vacuity case, and the whole reason this gate exists. An absent
      // result and a passing result must never be indistinguishable (#146).
      const result = decideDeploy(sound([]));
      expect(result.deploy).toBe(false);
      expect(result.reason).toMatch(/build-and-test/);
    });

    it.each(REQUIRED_CHECKS)(
      'refuses when %s is missing entirely',
      (missing: string) => {
        const checks = REQUIRED_CHECKS.filter((n) => n !== missing).map((n) =>
          passing(n),
        );
        const result = decideDeploy(sound(checks));
        expect(result.deploy).toBe(false);
        expect(result.reason).toContain(missing);
      },
    );

    it('refuses a failed check', () => {
      const result = decideDeploy(
        sound([
          { ...passing('build-and-test'), conclusion: 'failure' },
          passing('visual'),
        ]),
      );
      expect(result.deploy).toBe(false);
      expect(result.reason).toContain('build-and-test');
    });

    it('refuses a check still running — a null conclusion is not a pass', () => {
      const result = decideDeploy(
        sound([
          { name: 'build-and-test', conclusion: null, completedAt: null },
          passing('visual'),
        ]),
      );
      expect(result.deploy).toBe(false);
      expect(result.reason).toContain('build-and-test');
    });

    it('refuses a cancelled check — the exact shape that took the deploy down', () => {
      const result = decideDeploy(
        sound([
          { ...passing('build-and-test'), conclusion: 'cancelled' },
          passing('visual'),
        ]),
      );
      expect(result.deploy).toBe(false);
      expect(result.reason).toContain('build-and-test');
    });
  });

  describe('re-runs: the LATEST result for a name decides, as branch protection does', () => {
    it('deploys when a failure was superseded by a later success', () => {
      const result = decideDeploy(
        sound([
          {
            name: 'build-and-test',
            conclusion: 'failure',
            completedAt: '2026-09-13T00:00:00Z',
          },
          {
            name: 'build-and-test',
            conclusion: 'success',
            completedAt: '2026-09-13T01:00:00Z',
          },
          passing('visual'),
        ]),
      );
      expect(result).toMatchObject({ deploy: true });
    });

    it('refuses when a success was superseded by a later failure', () => {
      const result = decideDeploy(
        sound([
          {
            name: 'build-and-test',
            conclusion: 'success',
            completedAt: '2026-09-13T00:00:00Z',
          },
          {
            name: 'build-and-test',
            conclusion: 'failure',
            completedAt: '2026-09-13T01:00:00Z',
          },
          passing('visual'),
        ]),
      );
      expect(result.deploy).toBe(false);
      expect(result.reason).toContain('build-and-test');
    });

    it('refuses when the latest run for a name is still going', () => {
      const result = decideDeploy(
        sound([
          {
            name: 'build-and-test',
            conclusion: 'success',
            completedAt: '2026-09-13T00:00:00Z',
          },
          { name: 'build-and-test', conclusion: null, completedAt: null },
          passing('visual'),
        ]),
      );
      expect(result.deploy).toBe(false);
      expect(result.reason).toContain('build-and-test');
    });
  });

  it('always says WHY, so a refusal is actionable rather than a bare exit code', () => {
    const refusals = [
      decideDeploy({ ...sound(), parents: [HEAD] }),
      decideDeploy({
        ...sound(),
        treeOf: { [MERGE]: OTHER_TREE, [HEAD]: TREE },
      }),
      decideDeploy(sound([])),
    ];
    expect(refusals.every((r) => r.deploy === false)).toBe(true);
    for (const r of refusals)
      expect(r.reason.trim().length).toBeGreaterThan(20);
  });
});

/** The squash develop's pull request #900 landed as, one parent. */
const SQUASH = '5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a';
const DEVELOP_BEFORE = '0000000000000000000000000000000000000000';

/** A pull request as the gate reads it off `/commits/{sha}/pulls`. */
type Pull = {
  number: number;
  merged: boolean;
  mergeCommitSha: string | null;
  headSha: string;
  baseRef: string;
};

const landed = (over: Partial<Pull> = {}): Pull => ({
  number: 900,
  merged: true,
  mergeCommitSha: SQUASH,
  headSha: HEAD,
  baseRef: 'develop',
  ...over,
});

/** A squash whose tree provably matches the head its pull request tested. */
const squashed = (
  pulls: readonly Pull[] | string = [landed()],
  checks: CheckRun[] = REQUIRED_CHECKS.map((n) => passing(n)),
) => ({
  sha: SQUASH,
  parents: [DEVELOP_BEFORE],
  pulls,
  treeOf: { [SQUASH]: TREE, [HEAD]: TREE },
  checks,
});

/** What every one-parent commit no merged pull request into develop landed gets. */
const DIRECT_PUSH =
  '5a5a5a5 has one parent and no merged pull request into develop landed it as its merge commit: a direct push, so the suite has to run here.';

describe('a squash deploys only as the pull request head it landed (#892)', () => {
  it('deploys a squash whose pull request head has its tree and passed every check', () => {
    expect(decideDeploy(squashed())).toEqual({
      deploy: true,
      reason: `squash 5a5a5a5 of pull request #900: tree eb26eb4 is identical to tested head 49fd9c5, which passed build-and-test + visual.`,
    });
  });

  it('refuses a one-parent commit no pull request landed: a direct push', () => {
    expect(decideDeploy(squashed([]))).toEqual({
      deploy: false,
      reason: DIRECT_PUSH,
    });
  });

  it('refuses a commit a pull request only contains, rather than landed', () => {
    expect(
      decideDeploy(squashed([landed({ mergeCommitSha: 'a'.repeat(40) })])),
    ).toMatchObject({
      deploy: false,
      reason: DIRECT_PUSH,
    });
  });

  it('refuses a squash two pull requests claim, rather than choosing one', () => {
    expect(decideDeploy(squashed([landed(), landed({ number: 901 })]))).toEqual(
      {
        deploy: false,
        reason: `5a5a5a5 is the merge commit of pull requests #900 and #901: refusing rather than choosing which head was tested.`,
      },
    );
  });

  it('refuses a pull request into another base', () => {
    expect(decideDeploy(squashed([landed({ baseRef: 'main' })]))).toMatchObject(
      {
        deploy: false,
        reason: DIRECT_PUSH,
      },
    );
  });

  it('refuses a pull request that is not merged', () => {
    expect(decideDeploy(squashed([landed({ merged: false })]))).toMatchObject({
      deploy: false,
      reason: DIRECT_PUSH,
    });
  });

  it('refuses when the pull requests could not be read, naming why', () => {
    expect(decideDeploy(squashed('pulls for 5a5a5a5: HTTP 502'))).toEqual({
      deploy: false,
      reason: `could not read the pull requests of 5a5a5a5 (pulls for 5a5a5a5: HTTP 502): refusing rather than assuming none.`,
    });
  });

  it('refuses a root commit even when a merged pull request names it', () => {
    expect(decideDeploy({ ...squashed(), parents: [] })).toEqual({
      deploy: false,
      reason: `5a5a5a5 has no parents: no tested head can stand for it, so the suite has to run here.`,
    });
  });

  it('refuses a squash whose tree is not its pull request head’s', () => {
    expect(
      decideDeploy({
        ...squashed(),
        treeOf: { [SQUASH]: OTHER_TREE, [HEAD]: TREE },
      }),
    ).toEqual({
      deploy: false,
      reason: `tree mismatch: 5a5a5a5 is fffffff but its tested head 49fd9c5 is eb26eb4. The bytes being deployed are not the bytes that passed.`,
    });
  });

  it('refuses when the pull request head’s tree could not be resolved', () => {
    expect(
      decideDeploy({ ...squashed(), treeOf: { [SQUASH]: TREE } }),
    ).toMatchObject({
      deploy: false,
      reason: expect.stringContaining('49fd9c5'),
    });
  });

  it('refuses a squash whose pull request head has no check-runs', () => {
    expect(decideDeploy(squashed([landed()], []))).toMatchObject({
      deploy: false,
      reason: expect.stringContaining(
        'no build-and-test check-run on the tested head 49fd9c5',
      ),
    });
  });

  it('refuses a squash whose pull request head failed visual', () => {
    expect(
      decideDeploy(
        squashed(
          [landed()],
          [
            passing('build-and-test'),
            { ...passing('visual'), conclusion: 'failure' },
          ],
        ),
      ),
    ).toMatchObject({
      deploy: false,
      reason: expect.stringContaining('visual on 49fd9c5 is failure'),
    });
  });
});
