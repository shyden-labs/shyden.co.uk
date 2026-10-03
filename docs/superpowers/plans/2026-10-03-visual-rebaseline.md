# Automated Visual Rebaseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Dependabot updates Playwright and nothing else and the new browsers move pixels, recapture exactly the failed baselines, commit them to the pull request, run CI there, and hold the merge with a required check until the operator has approved the PNG diff.

**Architecture:** One script, `scripts/visual-rebaseline.mjs`, holds every decision as a pure, unit-tested function, plus a thin `main` that reads files and calls GitHub. An unprivileged `pull_request` workflow qualifies the PR, reruns the gate in the gate's own image and uploads the recaptured PNGs with a manifest. A privileged `workflow_run` workflow runs only default-branch code: it refuses until `develop` requires the lock, validates the upload, commits it through the Git Data API, dispatches `ci.yml` and comments. `ci.yml` gains `workflow_dispatch`. The lock is a second script, `scripts/operator-review.mjs` (a pure `reviewVerdict` and a thin `main`), run by `operator-review.yml` from the default branch on every pull request and after every review, which a relay workflow with no permissions starts; the workflow posts the verdict as the commit status `operator-review`.

**Tech Stack:** Node 24 ESM with JSDoc types (checked by `astro check`), Vitest, `yaml` (already a dev dependency), GitHub Actions, the GitHub REST API through `fetch`.

**Spec:** `docs/superpowers/specs/2026-10-03-visual-rebaseline-design.md` (reviewed to zero in 24 passes; decision 4 and Unit 4 added in passes 19-24). Read it before any task.

## Global Constraints

- Acts only for pull requests opened by `dependabot[bot]`, from this repository, level with `develop`, that update Playwright and nothing else (operator decision 3, 2026-10-03).
- The gate (`ci.yml` job `visual`) never rewrites what it checks: `playwright.config.ts` keeps `updateSnapshots: 'none'` (pinned at `browser-matrix.test.ts:331`), and no `ci.yml` job passes `--update-snapshots`.
- No new secret: the commit uses the job's own `GITHUB_TOKEN`, and CI on the new head starts by dispatching `ci.yml` (operator decision 2).
- A bot rebaseline merges only once the operator has approved it at its current head, and a required check enforces that (operator decision 4, Unit 4). Nothing commits a rebaseline until `develop` requires that check (Task 10), and requiring it is the operator's, after the merge (Task 11).
- No retries anywhere (operator rule 2026-10-02). Every network call has a time limit; whatever does not arrive fails by name.
- The job that runs pull-request code holds a read-only token and no secrets. The job that writes never checks out, installs or runs pull-request code, and never executes anything from the artifact.
- Every third-party action is pinned to a full SHA with a `# vX.Y.Z` comment, using the SHAs already in `ci.yml`.
- One test per case: a population known before the run is generated as one test each, never looped inside one test (global rule 2026-10-02).
- Every guard counts the unit it judges, with a floor at the measured figure minus one, and is mutation-verified RED and restored GREEN (global rule 2026-10-02).
- No closing keyword beside an issue number in any commit or PR body: write `Refs #459`.
- Merge into `develop` with a merge commit, never a squash.

## Review Focus

1. **A future Playwright rewords its screenshot error.** A reasonable person expects the run to fail by name rather than misread it. The baseline path comes from the `-expected.png` attachment, which Playwright points at the committed file (measured on 1.63.0). The message is consulted only for `toHaveScreenshot` on its first line and for an optional pixel count. Task 2 pins a report with no count (kept, with `pixels: null`) and a report with no diff attachment (refused).
2. **The macOS temp directory is a symlink** (`/var` → `/private/var`), so the CLI tests' `cwd()` would not match the paths written into a fixture. Task 4 resolves every temp dir with `realpathSync` before writing paths into a report.
3. **An artifact entry name carrying a newline or `::`** would inject a workflow command if echoed raw. Every artifact-derived string in an error is `JSON.stringify`-quoted and cut to 120 characters (Task 3 pins one).
4. **A downgrade is how the proof sets an older, drifting release.** A person would expect it to qualify like an upgrade. Task 1 pins it.
5. **A rename into `package.json`** must never pass as a dependency file. Task 4's `qualify` command records a renamed file as `old → new`, which matches no allowed path, and Task 1 pins that.
6. **A rebaseline renamed away.** A bot commit that moves a screenshot out of `tests/e2e/__screenshots__/` changed a screenshot as surely as one that edits it. Task 8's `verdict` command reads each file's `previous_filename` as well as its `filename`, so either side locks.
7. **A review on a pull request from a fork.** GitHub fills `workflow_run.pull_requests` only for a head in this repository, so the trusted half refuses that run by name and the status stays as the fork's last `pull_request_target` run set it. Task 1 refuses a fork, so no rebaseline can be on one; the cost is a red relay-started run, never a lock that opens.

## Measurement deferred (operator decision, 2026-10-03)

The spec's first planned task, finding a Playwright release that drifts, was deferred by the operator (recorded on #459, comment 5966311423). The throwaway harness from run 37099208646 now fails the pre-push unit suite on two #454 guards. Only 1.45.3 to 1.58.2 can be measured, because CI renders only in noble images. Task 12 does the search with the shipped capture workflow itself, after the merge, so no experiment workflow and no hook skip are needed.

## Where the plan departs from the spec

- **The recapture is detected by hash, not `git diff`.** The spec has the capture take `git diff --name-only` after recapturing. The capture job runs in the Playwright container, where the checkout belongs to another user and `git` refuses it as unsafe unless `safe.directory` is configured. Instead, `classify` records each failed baseline's sha256 before the recapture, and `buildManifest` refuses any whose bytes did not change. The contract is the spec's own: the files kept are exactly the screenshots the gate failed, and a gate-failed screenshot that did not change is a contradiction that fails the job.
- **The manifest is bound to the run that made it.** Beyond the spec's pattern checks, `validateArtifact` refuses a manifest whose PR number or head SHA differs from the triggering run's own `workflow_run` facts, so an artifact cannot speak for another pull request.
- **The workflow posts the `operator-review` status, not the script.** The spec has `operator-review.yml` run only `node scripts/operator-review.mjs`. Here the script decides and writes step outputs, and `gh api` steps (preinstalled on the runner, so still nothing installed) post each status, as `deploy-dev.yml` posts `dev-verified`. `pipeline-wiring`'s *documents only a context something in this repository can report* derives the contexts a workflow can report from job names and from `-f context=<name>` in its run lines (`producibleContexts`); a status posted by `fetch` inside a script is invisible to it, so `CLAUDE.md` naming the lock as a check to require would be refused. The guard keeps its one recognised form, and the order the spec sets (pending on the event's head before any read, pending on the current head, then the verdict) is kept as steps.
- **The `locked?` check is its own step**, `node scripts/visual-rebaseline.mjs locked`, before the download and the commit, so a wiring guard can read its order and its condition from the parsed workflow rather than from the script's control flow.

## Files

- Create `scripts/visual-rebaseline.mjs`: pure decisions (Tasks 1-3, and `lockRequired` in Task 10) and `main` (Tasks 4 and 10).
- Create `tests/unit/visual-rebaseline.test.ts`: the pure functions (Tasks 1-3 and 10).
- Create `tests/unit/visual-rebaseline-cli.test.ts`: `classify` and `stage` against real files (Task 4).
- Modify `.github/workflows/ci.yml`: the `workflow_dispatch` trigger (Task 5).
- Create `.github/workflows/visual-rebaseline.yml`: capture (Task 6).
- Create `.github/workflows/visual-rebaseline-commit.yml`: commit (Task 7), and its `locked` step (Task 10).
- Create `scripts/operator-review.mjs` and `tests/unit/operator-review.test.ts`: the lock's verdict (Task 8).
- Create `.github/workflows/operator-review.yml` and `.github/workflows/operator-review-relay.yml`: the lock (Task 9).
- Modify `tests/unit/script-entry.test.ts`: register both scripts (Tasks 4 and 8), and the new command (Task 10).
- Modify `tests/unit/pipeline-wiring.test.ts`: two trigger pins (Task 5), the `--update-snapshots` guard (Task 6), the new guards (Tasks 6, 7, 9 and 10).
- Modify `CLAUDE.md`: the rebaseline paragraph and the lock that holds its merge (Task 11).
- Delete `.github/workflows/probe-459.yml` and `.github/workflows/probe-459-relay.yml`, the throwaway measurement merged in #460 (Task 11).

### How a review pass runs this plan

Every code block below sits under a marker that `.superpowers/sdd/459/assemble.py` applies in order: `create` writes a new file, `append` adds to one, and `edit` replaces an OLD block that must match exactly once with a NEW one. A review pass assembles the plan onto a scratch worktree of this branch, then runs `npx prettier --check .`, `npx astro check` and `npx vitest run` there, plus every mutation the tasks predict.

---

### Task 1: Qualify a pull request

**Files:**
- Create: `scripts/visual-rebaseline.mjs`
- Create: `tests/unit/visual-rebaseline.test.ts`

**Interfaces:**
- Produces: `qualify(pr: PullRequestFacts): { qualifies: true, versions: string } | { qualifies: false, reason: string }`, which throws on a truncated file list. `PullRequestFacts` is `{ author, headRepo, baseRepo, files: string[], changedFiles, behindBy, base: Side, head: Side }`, and `Side` is `{ lock: string, pkg: string, dockerfile: string | null }`. Also `DEPENDABOT`, `LABEL` and `ARTIFACT`.

- [ ] **Step 1: Write the failing tests**

<!-- create: tests/unit/visual-rebaseline.test.ts -->
```ts
import { describe, expect, it } from 'vitest';
import { qualify } from '../../scripts/visual-rebaseline.mjs';

/**
 * The visual rebaseline (#459) and the decisions it makes. Fixtures are
 * written here, never imported from the code under test.
 */

/**
 * #26's real lockfile entries (c6af312, @playwright/test 1.61.1 to 1.63.0),
 * copied verbatim. The bump changed the root devDependency, these three
 * entries, and REMOVED `node_modules/playwright/node_modules/fsevents`, so a
 * rule naming only the three entries would have refused the one real
 * Playwright update this repository has had.
 */
const PLAYWRIGHT_ENTRIES = {
  '1.61.1': {
    'node_modules/@playwright/test': {
      version: '1.61.1',
      resolved: 'https://registry.npmjs.org/@playwright/test/-/test-1.61.1.tgz',
      integrity:
        'sha512-8nKv6+0RJSL9FE4jYOEGXnPeM/Hg12qZpmqzZjRh3qM0Y7c3z1mrOTfFLids72RDQYVh9WpLEfR5WdpNX4fkig==',
      dev: true,
      license: 'Apache-2.0',
      dependencies: { playwright: '1.61.1' },
      bin: { playwright: 'cli.js' },
      engines: { node: '>=18' },
    },
    'node_modules/playwright': {
      version: '1.61.1',
      resolved: 'https://registry.npmjs.org/playwright/-/playwright-1.61.1.tgz',
      integrity:
        'sha512-DWnY5o3YbLWK4GovuAVwpqL+1VwGNdUGrRr++8j8PtQQzvAVZUIMjKQ90fY689sEJZJBbZVw1rXaOKSTitkzPQ==',
      dev: true,
      license: 'Apache-2.0',
      dependencies: { 'playwright-core': '1.61.1' },
      bin: { playwright: 'cli.js' },
      engines: { node: '>=18' },
      optionalDependencies: { fsevents: '2.3.2' },
    },
    'node_modules/playwright/node_modules/fsevents': {
      version: '2.3.2',
      resolved: 'https://registry.npmjs.org/fsevents/-/fsevents-2.3.2.tgz',
      integrity:
        'sha512-xiqMQR4xAeHTuB9uWm+fFRcIOgKBMiOBP+eXiyT7jsgVCq1bkVygt00oASowB7EdtpOHaaPgKt812P9ab+DDKA==',
      dev: true,
      hasInstallScript: true,
      license: 'MIT',
      optional: true,
      os: ['darwin'],
      engines: { node: '^8.16.0 || ^10.6.0 || >=11.0.0' },
    },
    'node_modules/playwright-core': {
      version: '1.61.1',
      resolved:
        'https://registry.npmjs.org/playwright-core/-/playwright-core-1.61.1.tgz',
      integrity:
        'sha512-h7Qlt6m4REp25qvIdvbDtVmD4LqVXfpRxhORv9L0jzETM05p4fuPJ3dKyuSXQxDSbXnmS79HAgi9589lGSpLkg==',
      dev: true,
      license: 'Apache-2.0',
      bin: { 'playwright-core': 'cli.js' },
      engines: { node: '>=18' },
    },
  },
  '1.63.0': {
    'node_modules/@playwright/test': {
      version: '1.63.0',
      resolved: 'https://registry.npmjs.org/@playwright/test/-/test-1.63.0.tgz',
      integrity:
        'sha512-oxMK4vllB9RK5NQ2l1pq1IfOf2AvnEuj/vYGDj0H2nMtmtZpKtCwt/l00GEO6xjGfpBNAvjovvYdCm50dRQkpQ==',
      dev: true,
      license: 'Apache-2.0',
      dependencies: { playwright: '1.63.0' },
      bin: { playwright: 'cli.js' },
      engines: { node: '>=20' },
    },
    'node_modules/playwright': {
      version: '1.63.0',
      resolved: 'https://registry.npmjs.org/playwright/-/playwright-1.63.0.tgz',
      integrity:
        'sha512-+7ziBLidS4NaNCdt57SUDT+wYmmd5fmiQejUic/kb+YsYSCPyOOE9sebzMjNmQrsnNpDJqd4WHvV/8lfKfUDUg==',
      dev: true,
      license: 'Apache-2.0',
      dependencies: { 'playwright-core': '1.63.0' },
      bin: { playwright: 'cli.js' },
      engines: { node: '>=20' },
    },
    'node_modules/playwright-core': {
      version: '1.63.0',
      resolved:
        'https://registry.npmjs.org/playwright-core/-/playwright-core-1.63.0.tgz',
      integrity:
        'sha512-rYCsBF/M5HjUch52bbtVONEFjv6Xu8sm8h72dNlR5bzIE1fvC/bxgspzkjSfU+MweEMmPM8KJebG6nnyxo5mCg==',
      dev: true,
      license: 'Apache-2.0',
      bin: { 'playwright-core': 'cli.js' },
      engines: { node: '>=20' },
    },
  },
} as const;

type Release = keyof typeof PLAYWRIGHT_ENTRIES;

const npmEntry = (name: string, version: string) => ({
  version,
  resolved: `https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${version}.tgz`,
  integrity: `sha512-${name}-${version}`,
  dev: true,
  license: 'MIT',
});

interface LockChange {
  readonly astro?: string;
  readonly root?: Record<string, string>;
  readonly extra?: Record<string, unknown>;
  readonly top?: Record<string, unknown>;
}

/** A lockfile shaped like this repository's. */
const lockAt = (playwright: Release, change: LockChange = {}) =>
  JSON.stringify(
    {
      name: 'shyden-co-uk',
      version: '0.1.0',
      lockfileVersion: 3,
      requires: true,
      ...change.top,
      packages: {
        '': {
          name: 'shyden-co-uk',
          version: '0.1.0',
          dependencies: { astro: `^${change.astro ?? '7.3.5'}` },
          devDependencies: {
            '@playwright/test': `^${playwright}`,
            ...change.root,
          },
        },
        'node_modules/astro': npmEntry('astro', change.astro ?? '7.3.5'),
        ...PLAYWRIGHT_ENTRIES[playwright],
        ...change.extra,
      },
    },
    null,
    2,
  );

const pkgAt = (
  playwright: Release,
  change: { astro?: string; build?: string } = {},
) =>
  JSON.stringify(
    {
      name: 'shyden-co-uk',
      version: '0.1.0',
      scripts: { build: change.build ?? 'astro build' },
      dependencies: { astro: `^${change.astro ?? '7.3.5'}` },
      devDependencies: { '@playwright/test': `^${playwright}` },
    },
    null,
    2,
  );

const dockerfileAt = (version: string, comment = '# The image CI runs.') =>
  `${comment}\nFROM mcr.microsoft.com/playwright:v${version}-noble@sha256:${'a'.repeat(64)}\n`;

const OLD = {
  lock: lockAt('1.61.1'),
  pkg: pkgAt('1.61.1'),
  dockerfile: dockerfileAt('1.61.1'),
};
const NEW = {
  lock: lockAt('1.63.0'),
  pkg: pkgAt('1.63.0'),
  dockerfile: dockerfileAt('1.61.1'),
};
const REPO = 'shyden-labs/shyden.co.uk';

/** #26 as a pull request: Dependabot's, level, the lockfile and package.json. */
const pr = (change: Partial<Parameters<typeof qualify>[0]> = {}) => ({
  author: 'dependabot[bot]',
  headRepo: REPO,
  baseRepo: REPO,
  files: ['package-lock.json', 'package.json'],
  changedFiles: 2,
  behindBy: 0,
  base: OLD,
  head: NEW,
  ...change,
});

const reasonOf = (verdict: ReturnType<typeof qualify>) =>
  verdict.qualifies ? '(it qualified)' : verdict.reason;

describe('qualify: a Playwright update and nothing else (#459)', () => {
  it('qualifies #26, the real bump, nested fsevents removed', () => {
    expect(qualify(pr())).toEqual({
      qualifies: true,
      versions:
        '@playwright/test 1.61.1 → 1.63.0, playwright 1.61.1 → 1.63.0, ' +
        'playwright-core 1.61.1 → 1.63.0',
    });
  });

  it('qualifies a bump that also brings the Dockerfile pin level', () => {
    const verdict = qualify(
      pr({
        files: [
          'docker/playwright/Dockerfile',
          'package-lock.json',
          'package.json',
        ],
        changedFiles: 3,
        head: { ...NEW, dockerfile: dockerfileAt('1.63.0') },
      }),
    );
    expect(verdict.qualifies).toBe(true);
  });

  it('qualifies a downgrade, the move the end-to-end proof makes', () => {
    expect(qualify(pr({ base: NEW, head: OLD }))).toEqual({
      qualifies: true,
      versions:
        '@playwright/test 1.63.0 → 1.61.1, playwright 1.63.0 → 1.61.1, ' +
        'playwright-core 1.63.0 → 1.61.1',
    });
  });

  it('refuses a pull request a person opened', () => {
    expect(reasonOf(qualify(pr({ author: 'ShydenMcM' })))).toBe(
      'opened by ShydenMcM, not dependabot[bot]',
    );
  });

  it('refuses a fork', () => {
    expect(reasonOf(qualify(pr({ headRepo: 'someone/shyden.co.uk' })))).toBe(
      'the head is someone/shyden.co.uk, not shyden-labs/shyden.co.uk',
    );
  });

  it('throws on a truncated file list rather than answering', () => {
    expect(() => qualify(pr({ changedFiles: 3 }))).toThrow(
      'the file list holds 2 of 3 changed files, so it is truncated',
    );
  });

  for (const path of [
    'src/pages/index.astro',
    'tests/e2e/__screenshots__/home-linux.png',
    '.github/workflows/ci.yml',
    'package-lock.json.orig',
  ])
    it(`refuses a pull request that also changes ${path}`, () => {
      expect(
        reasonOf(
          qualify(
            pr({
              files: ['package-lock.json', 'package.json', path],
              changedFiles: 3,
            }),
          ),
        ),
      ).toBe(`it changes more than dependencies: ${path}`);
    });

  it('refuses a rename into package.json, recorded as old → new', () => {
    expect(
      reasonOf(
        qualify(
          pr({ files: ['package-lock.json', 'docs/x.json → package.json'] }),
        ),
      ),
    ).toBe('it changes more than dependencies: docs/x.json → package.json');
  });

  it('refuses a head behind its base', () => {
    expect(reasonOf(qualify(pr({ behindBy: 2 })))).toBe(
      'it is 2 commit(s) behind its base; bringing it level runs this again',
    );
  });

  it('refuses Playwright grouped with Astro', () => {
    const head = {
      ...NEW,
      lock: lockAt('1.63.0', { astro: '7.4.0' }),
      pkg: pkgAt('1.63.0', { astro: '7.4.0' }),
    };
    expect(reasonOf(qualify(pr({ head })))).toBe(
      "package-lock.json's root entry changes more than @playwright/test",
    );
  });

  it('refuses Playwright grouped with a font', () => {
    const font = (version: string) => ({
      'node_modules/@fontsource-variable/instrument-sans': npmEntry(
        '@fontsource-variable/instrument-sans',
        version,
      ),
    });
    const base = { ...OLD, lock: lockAt('1.61.1', { extra: font('5.3.0') }) };
    const head = { ...NEW, lock: lockAt('1.63.0', { extra: font('5.2.4') }) };
    expect(reasonOf(qualify(pr({ base, head })))).toBe(
      "package-lock.json changes node_modules/@fontsource-variable/instrument-sans, outside Playwright's tree",
    );
  });

  it("refuses a package added outside Playwright's tree", () => {
    const head = {
      ...NEW,
      lock: lockAt('1.63.0', {
        extra: { 'node_modules/left-pad': npmEntry('left-pad', '1.3.0') },
      }),
    };
    expect(reasonOf(qualify(pr({ head })))).toBe(
      "package-lock.json changes node_modules/left-pad, outside Playwright's tree",
    );
  });

  it("refuses a package removed outside Playwright's tree", () => {
    const base = {
      ...OLD,
      lock: lockAt('1.61.1', {
        extra: { 'node_modules/left-pad': npmEntry('left-pad', '1.3.0') },
      }),
    };
    expect(reasonOf(qualify(pr({ base })))).toBe(
      "package-lock.json changes node_modules/left-pad, outside Playwright's tree",
    );
  });

  it("refuses a package nested in another package's tree", () => {
    const head = {
      ...NEW,
      lock: lockAt('1.63.0', {
        extra: {
          'node_modules/astro/node_modules/fsevents': npmEntry(
            'fsevents',
            '2.3.3',
          ),
        },
      }),
    };
    expect(reasonOf(qualify(pr({ head })))).toBe(
      "package-lock.json changes node_modules/astro/node_modules/fsevents, outside Playwright's tree",
    );
  });

  it('refuses a lookalike of a Playwright entry', () => {
    const head = {
      ...NEW,
      lock: lockAt('1.63.0', {
        extra: {
          'node_modules/playwright-extra': npmEntry(
            'playwright-extra',
            '4.3.6',
          ),
        },
      }),
    };
    expect(reasonOf(qualify(pr({ head })))).toBe(
      "package-lock.json changes node_modules/playwright-extra, outside Playwright's tree",
    );
  });

  it('refuses a root-entry change besides @playwright/test', () => {
    const head = {
      ...NEW,
      lock: lockAt('1.63.0', { root: { vitest: '^5.0.2' } }),
    };
    expect(reasonOf(qualify(pr({ head })))).toBe(
      "package-lock.json's root entry changes more than @playwright/test",
    );
  });

  it('refuses a lockfile change outside its packages', () => {
    const head = {
      ...NEW,
      lock: lockAt('1.63.0', { top: { lockfileVersion: 4 } }),
    };
    expect(reasonOf(qualify(pr({ head })))).toBe(
      'package-lock.json changes outside its packages',
    );
  });

  it('refuses a package.json change besides @playwright/test', () => {
    const head = {
      ...NEW,
      pkg: pkgAt('1.63.0', { build: 'astro build && true' }),
    };
    expect(reasonOf(qualify(pr({ head })))).toBe(
      'package.json changes more than @playwright/test',
    );
  });

  it('refuses a Dockerfile change besides its FROM pin', () => {
    const verdict = qualify(
      pr({
        files: [
          'docker/playwright/Dockerfile',
          'package-lock.json',
          'package.json',
        ],
        changedFiles: 3,
        head: { ...NEW, dockerfile: dockerfileAt('1.63.0', '# Edited.') },
      }),
    );
    expect(reasonOf(verdict)).toBe(
      'docker/playwright/Dockerfile changes more than its FROM pin',
    );
  });

  it('refuses a Dockerfile-only pull request: no Playwright version moved', () => {
    const verdict = qualify(
      pr({
        files: ['docker/playwright/Dockerfile'],
        changedFiles: 1,
        head: { ...OLD, dockerfile: dockerfileAt('1.63.0') },
      }),
    );
    expect(reasonOf(verdict)).toBe('no Playwright version moved');
  });
});
```

- [ ] **Step 2: Run the tests against a throwing stub, and watch each fail on its own assertion**

Create the script with `export function qualify() { throw new Error('not implemented'); }` and the three constants, then run:

Run: `npx vitest run tests/unit/visual-rebaseline.test.ts`
Expected: 23 failed, 0 passed. 22 fail on `not implemented`, and `throws on a truncated file list` fails because the stub's message is not the one it names. A test that PASSES here is vacuous, so fix it before going on.

- [ ] **Step 3: Write the implementation**

<!-- create: scripts/visual-rebaseline.mjs -->
```js
#!/usr/bin/env node
/**
 * Rebaselines the visual gate for a Dependabot Playwright update (#459).
 *
 * A Playwright release ships new browsers, and new browsers can move pixels
 * while the site is unchanged. For a pull request Dependabot opened that
 * updates Playwright and nothing else, `visual-rebaseline.yml` reruns the
 * gate, recaptures exactly the screenshots it failed and uploads them, and
 * `visual-rebaseline-commit.yml` validates that upload, commits it to the
 * branch, starts CI there and labels the pull request for the operator's
 * review. Any other update keeps a red `visual` for a person to diagnose
 * (operator, 2026-10-03: "we cannot afford to allow any visual bugs go
 * unnoticed and unfixed"). Design:
 * docs/superpowers/specs/2026-10-03-visual-rebaseline-design.md.
 *
 * Every decision is a pure function here, unit-tested in
 * tests/unit/visual-rebaseline.test.ts. `main` only reads files and calls
 * GitHub: one request at a time, each with a time limit, never a retry
 * (operator rule, 2026-10-02), so whatever does not arrive fails by name.
 *
 *   node scripts/visual-rebaseline.mjs qualify                  # capture
 *   node scripts/visual-rebaseline.mjs classify <gate> <list>   # capture
 *   node scripts/visual-rebaseline.mjs stage <out-dir>          # capture
 *   node scripts/visual-rebaseline.mjs find                     # commit
 *   node scripts/visual-rebaseline.mjs commit                   # commit
 */
import { isDeepStrictEqual } from 'node:util';

export const DEPENDABOT = 'dependabot[bot]';
/** The label that holds a rebaselined pull request for the operator. */
export const LABEL = 'rebaseline-needs-review';
/** The artifact the capture uploads and the commit downloads. */
export const ARTIFACT = 'visual-rebaseline';

const PLAYWRIGHT = '@playwright/test';
/**
 * Playwright's own tree in the lockfile: these entries, and every entry
 * nested inside one (#26 removed `node_modules/playwright/node_modules/
 * fsevents`).
 */
const PLAYWRIGHT_TREES = [
  'node_modules/@playwright/test',
  'node_modules/playwright',
  'node_modules/playwright-core',
];
const DEPENDENCY_FILES = new Set([
  'package.json',
  'package-lock.json',
  'docker/playwright/Dockerfile',
]);

/**
 * The types `qualify` reads and returns, in one block (a docblock sitting
 * directly on another is refused by stranded-docblocks.test.ts).
 *
 * One side of a pull request: its lockfile, manifest and Dockerfile.
 * @typedef {{ lock: string, pkg: string, dockerfile: string | null }} Side
 *
 * What the qualify job learns about a pull request. A renamed file is
 * recorded as `old → new`, which no dependency path matches.
 * @typedef {object} PullRequestFacts
 * @property {string} author
 * @property {string} headRepo
 * @property {string} baseRepo
 * @property {readonly string[]} files
 * @property {number} changedFiles
 * @property {number} behindBy
 * @property {Side} base
 * @property {Side} head
 *
 * @typedef {{ qualifies: true, versions: string }
 *   | { qualifies: false, reason: string }} Verdict
 */

/**
 * @param {string} reason
 * @returns {Verdict}
 */
const refuse = (reason) => ({ qualifies: false, reason });

/**
 * Whether a pull request updates Playwright and nothing else. Not
 * qualifying is an answer; a file list that cannot be trusted is not one, so
 * it throws.
 * @param {PullRequestFacts} pr
 * @returns {Verdict}
 */
export function qualify(pr) {
  if (pr.author !== DEPENDABOT)
    return refuse(`opened by ${pr.author}, not ${DEPENDABOT}`);
  if (pr.headRepo !== pr.baseRepo)
    return refuse(`the head is ${pr.headRepo}, not ${pr.baseRepo}`);
  if (pr.files.length !== pr.changedFiles)
    throw new Error(
      `the file list holds ${pr.files.length} of ${pr.changedFiles} ` +
        'changed files, so it is truncated',
    );
  const others = pr.files.filter((file) => !DEPENDENCY_FILES.has(file));
  if (others.length > 0)
    return refuse(`it changes more than dependencies: ${others.join(', ')}`);
  if (pr.behindBy !== 0)
    return refuse(
      `it is ${pr.behindBy} commit(s) behind its base; ` +
        'bringing it level runs this again',
    );
  const outside =
    lockOutsidePlaywright(pr.base.lock, pr.head.lock) ??
    packageOutsidePlaywright(pr.base.pkg, pr.head.pkg) ??
    dockerfileOutsideFrom(pr.base.dockerfile, pr.head.dockerfile);
  if (outside) return refuse(outside);
  const moved = playwrightVersionsMoved(pr.base.lock, pr.head.lock);
  if (moved.length === 0) return refuse('no Playwright version moved');
  return { qualifies: true, versions: moved.join(', ') };
}

/**
 * @param {string} key a lockfile `packages` key
 * @returns {boolean}
 */
const inPlaywrightTree = (key) =>
  PLAYWRIGHT_TREES.some((tree) => key === tree || key.startsWith(`${tree}/`));

/**
 * A package manifest, or the lockfile's root entry, without its
 * `@playwright/test` pins.
 * @param {any} manifest
 * @returns {any}
 */
function withoutPlaywright(manifest) {
  if (manifest === null || typeof manifest !== 'object') return manifest;
  const copy = structuredClone(manifest);
  for (const field of ['dependencies', 'devDependencies'])
    if (copy[field]) delete copy[field][PLAYWRIGHT];
  return copy;
}

/**
 * Why the lockfile moves something besides Playwright, if it does.
 * @param {string} baseText
 * @param {string} headText
 * @returns {string | undefined}
 */
function lockOutsidePlaywright(baseText, headText) {
  const { packages: before = {}, ...baseRest } = JSON.parse(baseText);
  const { packages: after = {}, ...headRest } = JSON.parse(headText);
  if (!isDeepStrictEqual(baseRest, headRest))
    return 'package-lock.json changes outside its packages';
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (isDeepStrictEqual(before[key], after[key])) continue;
    if (key === '') {
      if (
        !isDeepStrictEqual(
          withoutPlaywright(before[key]),
          withoutPlaywright(after[key]),
        )
      )
        return `package-lock.json's root entry changes more than ${PLAYWRIGHT}`;
      continue;
    }
    if (!inPlaywrightTree(key))
      return `package-lock.json changes ${key}, outside Playwright's tree`;
  }
  return undefined;
}

/**
 * @param {string} baseText
 * @param {string} headText
 * @returns {string | undefined}
 */
function packageOutsidePlaywright(baseText, headText) {
  return isDeepStrictEqual(
    withoutPlaywright(JSON.parse(baseText)),
    withoutPlaywright(JSON.parse(headText)),
  )
    ? undefined
    : `package.json changes more than ${PLAYWRIGHT}`;
}

/**
 * Every line but a `FROM` must be unchanged, in place.
 * @param {string | null} base
 * @param {string | null} head
 * @returns {string | undefined}
 */
function dockerfileOutsideFrom(base, head) {
  if (base === head) return undefined;
  if (base === null || head === null)
    return `docker/playwright/Dockerfile is ${base === null ? 'added' : 'removed'}`;
  /** @param {string} text */
  const rest = (text) =>
    text.split('\n').map((line) => (/^\s*FROM\s/i.test(line) ? 'FROM' : line));
  return isDeepStrictEqual(rest(base), rest(head))
    ? undefined
    : 'docker/playwright/Dockerfile changes more than its FROM pin';
}

/**
 * @param {string} baseText
 * @param {string} headText
 * @returns {string[]} `<name> <from> → <to>` for each entry that moved
 */
function playwrightVersionsMoved(baseText, headText) {
  const before = JSON.parse(baseText).packages ?? {};
  const after = JSON.parse(headText).packages ?? {};
  return PLAYWRIGHT_TREES.flatMap((key) => {
    const from = before[key]?.version;
    const to = after[key]?.version;
    return from === to
      ? []
      : [`${key.slice('node_modules/'.length)} ${from} → ${to}`];
  });
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run tests/unit/visual-rebaseline.test.ts`
Expected: 23 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/visual-rebaseline.mjs tests/unit/visual-rebaseline.test.ts
git commit -m "visual-rebaseline: qualify a Playwright-only Dependabot update (Refs #459)"
```

- [ ] **Step 6: Mutate, predicting each verdict first**

Apply each mutation to `scripts/visual-rebaseline.mjs` alone, run the whole file, and restore it from the commit:

| # | Mutation | Predicted |
| --- | --- | --- |
| Q1 | `inPlaywrightTree`: drop the `` `${tree}/` `` branch | RED: #26 (nested fsevents) and the downgrade |
| Q2 | `inPlaywrightTree`: `startsWith(tree)` with no slash | RED: lookalike `playwright-extra` |
| Q3 | `lockOutsidePlaywright`: skip the root entry entirely | RED: Astro, root-entry change |
| Q4 | `dockerfileOutsideFrom`: return `undefined` always | RED: the FROM-pin test |
| Q5 | `qualify`: drop the `behindBy` check | RED: behind its base |
| Q6 | `qualify`: drop the `moved.length === 0` check | RED: Dockerfile-only |

---

### Task 2: Read the gate's report and build the manifest

**Files:**
- Modify: `scripts/visual-rebaseline.mjs`
- Modify: `tests/unit/visual-rebaseline.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `testsIn(report): { title: string, results: any[] }[]`, which counts both a report and a `--list` listing. `failedBaselines(report, listed: number, root: string): FailedBaseline[]`, where `FailedBaseline` is `{ path: string, pixels: number | null }`. `gateAgrees(exitCode: number, failed: readonly FailedBaseline[]): void`. `buildManifest({ pr, headSha, playwright, failed, contentOf }): Manifest`, where each `failed` item also carries `before` (the committed file's sha256), and `Manifest` is `{ pr, headSha, playwright, files: { path, sha256, bytes, pixels }[] }`. `sha256(content: Uint8Array): string`.

- [ ] **Step 1: Write the failing tests**

<!-- edit: tests/unit/visual-rebaseline.test.ts -->
```ts
import { describe, expect, it } from 'vitest';
import { qualify } from '../../scripts/visual-rebaseline.mjs';
```
```ts
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildManifest,
  failedBaselines,
  gateAgrees,
  qualify,
  testsIn,
} from '../../scripts/visual-rebaseline.mjs';
```

<!-- append: tests/unit/visual-rebaseline.test.ts -->
```ts

/**
 * Results shaped as Playwright 1.63.0's JSON reporter writes them, measured
 * on 2026-10-03: a failed `toHaveScreenshot` attaches `<name>-expected.png`
 * at the COMMITTED baseline's own path, plus `-actual` and `-diff`; a missing
 * baseline attaches neither; messages carry ANSI colour.
 */
const ROOT = '/__w/shyden.co.uk/shyden.co.uk';
const ESC = String.fromCharCode(27);
const coloured = (text: string) => `${ESC}[31m${text}${ESC}[39m`;
const baselineOf = (name: string) =>
  `tests/e2e/__screenshots__/${name}-linux.png`;

const passed = () => ({ status: 'passed', errors: [], attachments: [] });
const pixelFailure = (
  name: string,
  detail = '1234 pixels (ratio 0.01 of all image pixels) are different.',
) => ({
  status: 'failed',
  errors: [
    {
      message: `Error: expect(page).${coloured('toHaveScreenshot')}(expected) failed\n\n  ${detail}\n\n  Snapshot: ${name}.png`,
    },
  ],
  attachments: [
    {
      name: `${name}-expected.png`,
      contentType: 'image/png',
      path: `${ROOT}/${baselineOf(name)}`,
    },
    {
      name: `${name}-actual.png`,
      contentType: 'image/png',
      path: `${ROOT}/test-results/v/${name}-actual.png`,
    },
    {
      name: `${name}-diff.png`,
      contentType: 'image/png',
      path: `${ROOT}/test-results/v/${name}-diff.png`,
    },
    {
      name: 'error-context',
      contentType: 'text/markdown',
      path: `${ROOT}/test-results/v/error-context.md`,
    },
  ],
});
const missingBaseline = (name: string) => ({
  status: 'failed',
  errors: [
    {
      message: `Error: A snapshot doesn't exist at ${ROOT}/${baselineOf(name)}.\n\n> 16 |   await expect(page).toHaveScreenshot('${name}.png');`,
    },
  ],
  attachments: [
    {
      name: 'error-context',
      contentType: 'text/markdown',
      path: `${ROOT}/test-results/v/error-context.md`,
    },
  ],
});
const ordinaryFailure = () => ({
  status: 'failed',
  errors: [
    {
      message:
        'Error: expect(locator).toHaveText(expected) failed\n\nExpected: "y"',
    },
  ],
  attachments: [],
});

/** A report whose tests sit inside a file suite and a describe suite, as Playwright nests them. */
const reportOf = (
  results: readonly unknown[],
  errors: readonly unknown[] = [],
) => ({
  suites: [
    {
      title: 'visual.spec.ts',
      specs: [],
      suites: [
        {
          title: 'visual',
          specs: results.map((result, index) => ({
            title: `case ${index}`,
            tests: [{ results: [result] }],
          })),
        },
      ],
    },
  ],
  errors,
});

describe('failedBaselines: the gate failed on pixels alone, or the run refuses (#459)', () => {
  it('counts tests nested inside describe suites', () => {
    expect(testsIn(reportOf([passed(), passed(), passed()]))).toHaveLength(3);
  });

  it('finds nothing to rebaseline when the gate passed', () => {
    expect(failedBaselines(reportOf([passed(), passed()]), 2, ROOT)).toEqual(
      [],
    );
  });

  it('names the committed baseline and pixel count of a screenshot failure', () => {
    expect(
      failedBaselines(
        reportOf([passed(), pixelFailure('home-mobile')]),
        2,
        ROOT,
      ),
    ).toEqual([{ path: baselineOf('home-mobile'), pixels: 1234 }]);
  });

  it('counts a page that changed height as a screenshot failure', () => {
    const resized = pixelFailure(
      'home',
      'Expected an image 1280px by 800px, received 1280px by 820px. 8000 pixels (ratio 0.29 of all image pixels) are different.',
    );
    expect(failedBaselines(reportOf([resized]), 1, ROOT)).toEqual([
      { path: baselineOf('home'), pixels: 8000 },
    ]);
  });

  it('keeps a screenshot failure whose message gives no count, with no count', () => {
    const reworded = pixelFailure('home', 'The images differ.');
    expect(failedBaselines(reportOf([reworded]), 1, ROOT)).toEqual([
      { path: baselineOf('home'), pixels: null },
    ]);
  });

  it('refuses a missing baseline', () => {
    expect(() =>
      failedBaselines(reportOf([missingBaseline('home')]), 1, ROOT),
    ).toThrow(
      "case 0 failed on something besides one screenshot comparison: Error: A snapshot doesn't exist",
    );
  });

  it('refuses an ordinary assertion failure', () => {
    expect(() =>
      failedBaselines(reportOf([ordinaryFailure()]), 1, ROOT),
    ).toThrow(
      'case 0 failed on something besides one screenshot comparison: Error: expect(locator).toHaveText(expected) failed',
    );
  });

  it('refuses a test that made two screenshot comparisons', () => {
    const one = pixelFailure('home');
    const other = pixelFailure('menu');
    const both = {
      ...one,
      errors: [...one.errors, ...other.errors],
      attachments: [...one.attachments, ...other.attachments],
    };
    expect(() => failedBaselines(reportOf([both]), 1, ROOT)).toThrow(
      'case 0 failed on something besides one screenshot comparison',
    );
  });

  it('refuses a run with a screenshot failure beside an ordinary one', () => {
    expect(() =>
      failedBaselines(
        reportOf([pixelFailure('home'), ordinaryFailure()]),
        2,
        ROOT,
      ),
    ).toThrow('case 1 failed on something besides one screenshot comparison');
  });

  for (const status of ['timedOut', 'skipped', 'interrupted'])
    it(`refuses a test that ended ${status}`, () => {
      expect(() =>
        failedBaselines(reportOf([{ ...passed(), status }]), 1, ROOT),
      ).toThrow(`case 0 ended ${status}`);
    });

  it('refuses a test that ran twice', () => {
    const report = reportOf([passed()]);
    report.suites[0].suites[0].specs[0].tests[0].results.push(passed());
    expect(() => failedBaselines(report, 1, ROOT)).toThrow(
      'case 0 has 2 results, and the gate runs each test once',
    );
  });

  it('refuses a report that holds fewer tests than the listing', () => {
    expect(() => failedBaselines(reportOf([passed()]), 2, ROOT)).toThrow(
      'the report holds 1 tests and the listing 2',
    );
  });

  it('refuses an empty listing, which would make an empty report agree', () => {
    expect(() => failedBaselines(reportOf([]), 0, ROOT)).toThrow(
      'the listing holds no visual tests',
    );
  });

  it('refuses an error outside any test', () => {
    expect(() =>
      failedBaselines(
        reportOf(
          [passed()],
          [{ message: `${coloured('Error')}: config failed\nat x` }],
        ),
        1,
        ROOT,
      ),
    ).toThrow('the run failed outside any test: Error: config failed');
  });

  it('refuses an expected image with no diff beside it', () => {
    const failure = pixelFailure('home');
    failure.attachments = failure.attachments.filter(
      (a) => !a.name.endsWith('-diff.png'),
    );
    expect(() => failedBaselines(reportOf([failure]), 1, ROOT)).toThrow(
      'case 0: home has no diff image, so no comparison ran',
    );
  });

  it('refuses an expected image that is not a committed baseline', () => {
    const failure = pixelFailure('home');
    failure.attachments[0] = {
      ...failure.attachments[0],
      path: `${ROOT}/test-results/v/home-expected.png`,
    };
    expect(() => failedBaselines(reportOf([failure]), 1, ROOT)).toThrow(
      'case 0: test-results/v/home-expected.png is not a committed baseline',
    );
  });
});

describe("gateAgrees: the gate's exit and its report tell one story (#459)", () => {
  const one = [{ path: baselineOf('home'), pixels: 1 }];

  it('accepts a clean exit with no failure', () => {
    expect(() => gateAgrees(0, [])).not.toThrow();
  });

  it('accepts a red exit with failures', () => {
    expect(() => gateAgrees(1, one)).not.toThrow();
  });

  it('refuses a clean exit with failures', () => {
    expect(() => gateAgrees(0, one)).toThrow(
      'the gate exited 0 but its report holds 1 failed screenshot(s)',
    );
  });

  it('refuses a red exit with no failure in its report', () => {
    expect(() => gateAgrees(1, [])).toThrow(
      'the gate exited 1 with no failed screenshot in its report',
    );
  });
});

const hex = (content: Uint8Array) =>
  createHash('sha256').update(content).digest('hex');

describe('buildManifest: what the capture uploads (#459)', () => {
  const committed = Uint8Array.from([1, 2, 3]);
  const recaptured = Uint8Array.from([1, 2, 3, 4]);
  const failed = [
    { path: baselineOf('home'), pixels: 99, before: hex(committed) },
  ];

  it("records each recaptured file's hash, size and pixel count", () => {
    expect(
      buildManifest({
        pr: 42,
        headSha: 'c'.repeat(40),
        playwright: '1.58.2',
        failed,
        contentOf: () => recaptured,
      }),
    ).toEqual({
      pr: 42,
      headSha: 'c'.repeat(40),
      playwright: '1.58.2',
      files: [
        {
          path: baselineOf('home'),
          sha256: hex(recaptured),
          bytes: 4,
          pixels: 99,
        },
      ],
    });
  });

  it('refuses a baseline the recapture left unchanged', () => {
    expect(() =>
      buildManifest({
        pr: 42,
        headSha: 'c'.repeat(40),
        playwright: '1.58.2',
        failed,
        contentOf: () => committed,
      }),
    ).toThrow(
      `the gate failed ${baselineOf('home')}, and the recapture left it unchanged`,
    );
  });
});
```

- [ ] **Step 2: Run them against throwing stubs**

Add `testsIn`, `failedBaselines`, `gateAgrees` and `buildManifest` as `throw new Error('not implemented')` stubs.

Run: `npx vitest run tests/unit/visual-rebaseline.test.ts`
Expected: Task 1's 23 pass, and every new test (24) fails. `accepts a clean exit` and `accepts a red exit` fail because the stub throws.

- [ ] **Step 3: Write the implementation**

<!-- edit: scripts/visual-rebaseline.mjs -->
```js
import { isDeepStrictEqual } from 'node:util';
```
```js
import { createHash } from 'node:crypto';
import { relative, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
```

<!-- append: scripts/visual-rebaseline.mjs -->
```js

/** Where every committed baseline lives, and what its name may hold. */
const BASELINE = /^tests\/e2e\/__screenshots__\/[A-Za-z0-9][\w.-]*-linux\.png$/;
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/**
 * @param {unknown} text
 * @returns {string}
 */
const plain = (text) => String(text ?? '').replace(ANSI, '');

/**
 * @param {unknown} text
 * @returns {string}
 */
const firstLine = (text) => plain(text).split('\n')[0] || '(no message)';

/**
 * @param {Uint8Array} content
 * @returns {string} lowercase hex
 */
export const sha256 = (content) =>
  createHash('sha256').update(content).digest('hex');

/**
 * A screenshot the gate failed on pixels alone, at its committed path.
 * @typedef {{ path: string, pixels: number | null }} FailedBaseline
 *
 * What the capture uploads beside the PNGs.
 * @typedef {object} Manifest
 * @property {number} pr
 * @property {string} headSha
 * @property {string} playwright
 * @property {{ path: string, sha256: string, bytes: number, pixels: number | null }[]} files
 */

/**
 * Every test in a Playwright JSON report, or in a `--list` listing, which
 * has the same shape with no results.
 * @param {any} report
 * @returns {{ title: string, results: any[] }[]}
 */
export function testsIn(report) {
  /** @type {{ title: string, results: any[] }[]} */
  const tests = [];
  /** @param {any} suite */
  const walk = (suite) => {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? [])
        tests.push({ title: spec.title, results: test.results ?? [] });
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  return tests;
}

/**
 * The committed baselines the gate failed on pixels alone. Anything else
 * refuses by name: an error outside a test, a count unlike the listing's, a
 * test that timed out, was skipped or ran twice, a failure that is not one
 * screenshot comparison. The path comes from the `-expected.png`
 * attachment, which Playwright points at the committed file, never from the
 * error's wording, which a later release may change.
 * @param {any} report the gate's JSON report
 * @param {number} listed how many tests the visual project lists
 * @param {string} root the checkout the attachment paths sit under
 * @returns {FailedBaseline[]}
 */
export function failedBaselines(report, listed, root) {
  if (listed <= 0) throw new Error('the listing holds no visual tests');
  const tests = testsIn(report);
  if (tests.length !== listed)
    throw new Error(
      `the report holds ${tests.length} tests and the listing ${listed}`,
    );
  const outside = report.errors ?? [];
  if (outside.length > 0)
    throw new Error(
      `the run failed outside any test: ${firstLine(outside[0]?.message)}`,
    );
  return tests.flatMap(({ title, results }) => {
    if (results.length !== 1)
      throw new Error(
        `${title} has ${results.length} results, and the gate runs each test once`,
      );
    const [result] = results;
    if (result.status === 'passed') return [];
    if (result.status !== 'failed')
      throw new Error(`${title} ended ${result.status}`);
    return [screenshotFailure(title, result, root)];
  });
}

/**
 * @param {string} title
 * @param {any} result
 * @param {string} root
 * @returns {FailedBaseline}
 */
function screenshotFailure(title, result, root) {
  /** @type {{ name: string, path?: string }[]} */
  const attachments = result.attachments ?? [];
  const errors = result.errors ?? [];
  const expected = attachments.filter((a) => a.name.endsWith('-expected.png'));
  if (
    errors.length !== 1 ||
    expected.length !== 1 ||
    !firstLine(errors[0].message).includes('toHaveScreenshot')
  )
    throw new Error(
      `${title} failed on something besides one screenshot comparison: ` +
        firstLine(errors[0]?.message),
    );
  const stem = expected[0].name.slice(0, -'-expected.png'.length);
  if (!attachments.some((a) => a.name === `${stem}-diff.png`))
    throw new Error(
      `${title}: ${stem} has no diff image, so no comparison ran`,
    );
  const path = relative(root, expected[0].path ?? '')
    .split(sep)
    .join('/');
  if (!BASELINE.test(path))
    throw new Error(`${title}: ${path} is not a committed baseline`);
  const count = /(\d+) pixels \(ratio/.exec(plain(errors[0].message));
  return { path, pixels: count ? Number(count[1]) : null };
}

/**
 * The gate's exit status and its report must agree.
 * @param {number} exitCode
 * @param {readonly FailedBaseline[]} failed
 */
export function gateAgrees(exitCode, failed) {
  if (exitCode === 0 && failed.length > 0)
    throw new Error(
      `the gate exited 0 but its report holds ${failed.length} failed screenshot(s)`,
    );
  if (exitCode !== 0 && failed.length === 0)
    throw new Error(
      `the gate exited ${exitCode} with no failed screenshot in its report`,
    );
}

/**
 * The manifest for the recaptured baselines. A baseline the gate failed
 * that the recapture left byte-identical is a contradiction, and refuses.
 * @param {object} input
 * @param {number} input.pr
 * @param {string} input.headSha
 * @param {string} input.playwright
 * @param {readonly (FailedBaseline & { before: string })[]} input.failed
 * @param {(path: string) => Uint8Array} input.contentOf
 * @returns {Manifest}
 */
export function buildManifest({ pr, headSha, playwright, failed, contentOf }) {
  const files = failed.map(({ path, pixels, before }) => {
    const content = contentOf(path);
    const hash = sha256(content);
    if (hash === before)
      throw new Error(
        `the gate failed ${path}, and the recapture left it unchanged`,
      );
    return { path, sha256: hash, bytes: content.length, pixels };
  });
  return { pr, headSha, playwright, files };
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run tests/unit/visual-rebaseline.test.ts`
Expected: 47 passed (measured, plan review pass 4).

- [ ] **Step 5: Commit, then mutate**

```bash
git add scripts/visual-rebaseline.mjs tests/unit/visual-rebaseline.test.ts
git commit -m "visual-rebaseline: read the gate's report and build the manifest (Refs #459)"
```

| # | Mutation | Predicted |
| --- | --- | --- |
| R1 | `failedBaselines`: drop `listed <= 0` | RED: empty listing (the counts agree at 0) |
| R2 | `screenshotFailure`: `expected.length < 1` instead of `!== 1`, and drop `errors.length !== 1` | RED: two screenshot comparisons, and nothing else (the missing baseline and the ordinary failure have no expected image) |
| R3 | `screenshotFailure`: drop the diff check | RED: no diff image |
| R4 | `plain`: return the text unchanged | RED: the error outside any test, whose message is coloured where the expected text is not. The pixel failure stays GREEN, because the colour codes wrap `toHaveScreenshot` without splitting it. |
| R5 | `testsIn`: do not walk child suites | RED: nested count, and every report test |
| R6 | `buildManifest`: drop the unchanged check | RED: recapture left unchanged |

---

### Task 3: Validate the artifact, and write what the commit says

**Files:**
- Modify: `scripts/visual-rebaseline.mjs`
- Modify: `tests/unit/visual-rebaseline.test.ts`

**Interfaces:**
- Consumes: `sha256`, `BASELINE`, the `Manifest` typedef (Task 2).
- Produces: `validateArtifact({ entries, run, headPaths }): { manifest: Manifest, files: { path: string, content: Uint8Array }[] }`, where `entries` is `{ name: string, kind: 'file' | 'directory' | 'other', content?: Uint8Array }[]` and `run` is `{ pr: number, headSha: string }`. `dispatchable(workflow: unknown): boolean`. `commentBody(manifest, commitSha: string): string`. `commitMessage(manifest): string`. `MAX_PNG_BYTES`.

- [ ] **Step 1: Write the failing tests**

<!-- edit: tests/unit/visual-rebaseline.test.ts -->
```ts
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildManifest,
  failedBaselines,
  gateAgrees,
  qualify,
  testsIn,
} from '../../scripts/visual-rebaseline.mjs';
```
```ts
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { closingKeywordOffences } from '../../scripts/closing-keywords.mjs';
import {
  LABEL,
  MAX_PNG_BYTES,
  buildManifest,
  commentBody,
  commitMessage,
  dispatchable,
  failedBaselines,
  gateAgrees,
  qualify,
  testsIn,
  validateArtifact,
} from '../../scripts/visual-rebaseline.mjs';
```

<!-- append: tests/unit/visual-rebaseline.test.ts -->
```ts

const HEAD_SHA = 'c'.repeat(40);
const PATH_A = baselineOf('home-mobile');
const PATH_B = baselineOf('glory-points-desktop');
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (seed: number) => Uint8Array.from([...SIGNATURE, seed, seed + 1]);
const RUN = { pr: 42, headSha: HEAD_SHA };
const HEAD_PATHS = new Set([PATH_A, PATH_B, 'package.json']);

interface Staged {
  readonly path: string;
  readonly content: Uint8Array;
}
const STAGED: readonly Staged[] = [
  { path: PATH_A, content: png(1) },
  { path: PATH_B, content: png(2) },
];
const manifestFor = (files: readonly Staged[]) => ({
  pr: 42,
  headSha: HEAD_SHA,
  playwright: '1.58.2',
  files: files.map(({ path, content }) => ({
    path,
    sha256: hex(content),
    bytes: content.length,
    pixels: 10,
  })),
});
const DIRECTORIES = ['tests', 'tests/e2e', 'tests/e2e/__screenshots__'].map(
  (name) => ({ name, kind: 'directory' as const }),
);
const entriesFor = (manifest: unknown, files: readonly Staged[] = STAGED) => [
  {
    name: 'manifest.json',
    kind: 'file' as const,
    content: new TextEncoder().encode(
      typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
    ),
  },
  ...DIRECTORIES,
  ...files.map(({ path, content }) => ({
    name: path,
    kind: 'file' as const,
    content,
  })),
];
/** Validate a manifest that differs from the good one by `change`. */
const withManifest = (change: Record<string, unknown>) => () =>
  validateArtifact({
    entries: entriesFor({ ...manifestFor(STAGED), ...change }),
    run: RUN,
    headPaths: HEAD_PATHS,
  });
/** Validate a manifest whose first file entry differs by `change`. */
const withFile = (change: Record<string, unknown>) => {
  const manifest = manifestFor(STAGED);
  manifest.files[0] = { ...manifest.files[0], ...change };
  return () =>
    validateArtifact({
      entries: entriesFor(manifest),
      run: RUN,
      headPaths: HEAD_PATHS,
    });
};

describe('validateArtifact: the commit trusts nothing it did not check (#459)', () => {
  it('yields the files of a well-formed artifact', () => {
    const { manifest, files } = validateArtifact({
      entries: entriesFor(manifestFor(STAGED)),
      run: RUN,
      headPaths: HEAD_PATHS,
    });
    expect(manifest.pr).toBe(42);
    expect(files.map(({ path }) => path)).toEqual([PATH_A, PATH_B]);
    expect(files[1].content).toEqual(png(2));
  });

  it('refuses a manifest that is not JSON', () => {
    expect(() =>
      validateArtifact({
        entries: entriesFor('{"pr":'),
        run: RUN,
        headPaths: HEAD_PATHS,
      }),
    ).toThrow('manifest.json is not JSON');
  });

  it('refuses a manifest with a key it does not document', () => {
    expect(withManifest({ extra: 1 })).toThrow(
      "manifest.json's keys are not exactly files, headSha, playwright, pr",
    );
  });

  it('refuses a manifest missing a key', () => {
    expect(withManifest({ playwright: undefined })).toThrow(
      "manifest.json's keys are not exactly files, headSha, playwright, pr",
    );
  });

  it('refuses a pull request number that is not a positive integer', () => {
    expect(withManifest({ pr: '42' })).toThrow(
      'manifest.json names no pull request number',
    );
  });

  it('refuses a head that is not 40 hex', () => {
    expect(withManifest({ headSha: 'C'.repeat(40) })).toThrow(
      'manifest.json names no head SHA',
    );
  });

  it('refuses a Playwright version that is not semver', () => {
    expect(withManifest({ playwright: '1.58.2<b>' })).toThrow(
      'manifest.json names no Playwright version',
    );
  });

  it('refuses a manifest for another pull request', () => {
    expect(withManifest({ pr: 43 })).toThrow(
      'manifest.json names #43, and the capture ran for #42',
    );
  });

  it('refuses a manifest for another head', () => {
    expect(withManifest({ headSha: 'd'.repeat(40) })).toThrow(
      `manifest.json names ${'d'.repeat(40)}, and the capture ran on ${HEAD_SHA}`,
    );
  });

  it('refuses a manifest that lists no file', () => {
    expect(withManifest({ files: [] })).toThrow('manifest.json lists no files');
  });

  it('refuses a file entry with a key it does not document', () => {
    expect(withFile({ mode: '100755' })).toThrow(
      "a file's keys are not exactly bytes, path, pixels, sha256",
    );
  });

  for (const path of [
    'tests/e2e/__screenshots__/../../../.github/workflows/ci.yml',
    'src/pages/index.astro',
    'tests/e2e/__screenshots__/home-darwin.png',
    'tests/e2e/__screenshots__/nested/home-linux.png',
    'tests/e2e/__screenshots__/..-linux.png',
  ])
    it(`refuses the path ${path}`, () => {
      expect(withFile({ path })).toThrow(
        `${JSON.stringify(path)} is not a baseline path`,
      );
    });

  it('quotes an artifact-derived string, so a newline cannot start a workflow command', () => {
    expect(withFile({ path: 'x\n::add-mask::y' })).toThrow(
      '"x\\n::add-mask::y" is not a baseline path',
    );
  });

  it('refuses a path listed twice', () => {
    const manifest = manifestFor(STAGED);
    manifest.files[1] = { ...manifest.files[0] };
    expect(() =>
      validateArtifact({
        entries: entriesFor(manifest),
        run: RUN,
        headPaths: HEAD_PATHS,
      }),
    ).toThrow(`${PATH_A} is listed twice`);
  });

  it('refuses a baseline the head does not hold, so a rebaseline adds no file', () => {
    expect(() =>
      validateArtifact({
        entries: entriesFor(manifestFor(STAGED)),
        run: RUN,
        headPaths: new Set([PATH_A]),
      }),
    ).toThrow(
      `${PATH_B} is not a baseline at the head, and a rebaseline adds no file`,
    );
  });

  it('refuses a malformed sha256', () => {
    expect(withFile({ sha256: 'f'.repeat(63) })).toThrow(
      `${PATH_A} has no sha256`,
    );
  });

  it('refuses a size over 2 MB', () => {
    expect(withFile({ bytes: MAX_PNG_BYTES + 1 })).toThrow(
      `${PATH_A} declares ${MAX_PNG_BYTES + 1} bytes, outside 1 to ${MAX_PNG_BYTES}`,
    );
  });

  it('refuses a negative pixel count', () => {
    expect(withFile({ pixels: -1 })).toThrow(
      `${PATH_A} has a pixel count of -1`,
    );
  });

  it('refuses a symlink, or anything that is not a file, even one with bytes', () => {
    // With content attached, the entry's kind is the only thing that can
    // refuse it: a walker that read through a link would hand over bytes.
    const entries = entriesFor(manifestFor(STAGED)).map((entry) =>
      entry.name === PATH_A
        ? { name: PATH_A, kind: 'other' as const, content: STAGED[0].content }
        : entry,
    );
    expect(() =>
      validateArtifact({ entries, run: RUN, headPaths: HEAD_PATHS }),
    ).toThrow(
      `the artifact holds other ${JSON.stringify(PATH_A)}, which the manifest does not list`,
    );
  });

  it('refuses a file the manifest does not list', () => {
    const extra = baselineOf('extra');
    const entries = [
      ...entriesFor(manifestFor(STAGED)),
      { name: extra, kind: 'file' as const, content: png(9) },
    ];
    expect(() =>
      validateArtifact({ entries, run: RUN, headPaths: HEAD_PATHS }),
    ).toThrow(
      `the artifact holds file ${JSON.stringify(extra)}, which the manifest does not list`,
    );
  });

  it('refuses a directory no listed file needs', () => {
    const entries = [
      ...entriesFor(manifestFor(STAGED)),
      { name: '.github', kind: 'directory' as const },
    ];
    expect(() =>
      validateArtifact({ entries, run: RUN, headPaths: HEAD_PATHS }),
    ).toThrow(
      'the artifact holds directory ".github", which the manifest does not list',
    );
  });

  it('refuses a listed file the artifact lacks', () => {
    const entries = entriesFor(manifestFor(STAGED), [STAGED[0]]);
    expect(() =>
      validateArtifact({ entries, run: RUN, headPaths: HEAD_PATHS }),
    ).toThrow(`the artifact is missing ${PATH_B}`);
  });

  it('refuses a file without the PNG signature', () => {
    const gif = {
      path: PATH_A,
      content: new TextEncoder().encode('GIF89a....'),
    };
    const files = [gif, STAGED[1]];
    expect(() =>
      validateArtifact({
        entries: entriesFor(manifestFor(files), files),
        run: RUN,
        headPaths: HEAD_PATHS,
      }),
    ).toThrow(`${PATH_A} is not a PNG`);
  });

  it('refuses a file whose size differs from the manifest', () => {
    expect(withFile({ bytes: 11 })).toThrow(
      `${PATH_A} holds 10 bytes, and the manifest says 11`,
    );
  });

  it('refuses a file whose hash differs from the manifest', () => {
    expect(withFile({ sha256: 'f'.repeat(64) })).toThrow(
      `${PATH_A} does not hash to its manifest entry`,
    );
  });
});

describe('dispatchable: a commit there could start CI (#459)', () => {
  it('accepts a mapping that holds workflow_dispatch', () => {
    expect(
      dispatchable(parse('on:\n  pull_request:\n  workflow_dispatch:\n')),
    ).toBe(true);
  });

  it('refuses a mapping without it', () => {
    expect(
      dispatchable(parse('on:\n  pull_request:\n  workflow_call:\n')),
    ).toBe(false);
  });

  it('refuses a trigger that is only commented out', () => {
    expect(
      dispatchable(parse('on:\n  pull_request:\n  # workflow_dispatch:\n')),
    ).toBe(false);
  });

  it('accepts the string form', () => {
    expect(dispatchable(parse('on: workflow_dispatch\n'))).toBe(true);
  });

  it('accepts the list form', () => {
    expect(dispatchable(parse('on: [pull_request, workflow_dispatch]\n'))).toBe(
      true,
    );
  });
});

describe('what the commit writes (#459)', () => {
  const manifest = {
    ...manifestFor(STAGED),
    files: manifestFor(STAGED).files.map((file, index) => ({
      ...file,
      pixels: index === 0 ? 1234 : null,
    })),
  };

  it('comments with each baseline, its count, the version, the commit and the review ask', () => {
    expect(commentBody(manifest, 'e'.repeat(40))).toBe(
      [
        'Rebaselined automatically (#459). `operator-review` holds the merge until the operator approves the PNG diff at this head.',
        '',
        `Playwright 1.58.2, commit ${'e'.repeat(40)}.`,
        '',
        '| Baseline | Differing pixels at the gate |',
        '| --- | --- |',
        `| \`${PATH_A}\` | 1234 |`,
        `| \`${PATH_B}\` | not reported |`,
        '',
        `Labelled \`${LABEL}\`.`,
      ].join('\n'),
    );
  });

  it('commits with a message that references #459 and closes nothing', () => {
    const message = commitMessage(manifest);
    expect(message.split('\n')[0]).toBe(
      'Rebaseline 2 screenshot(s) for Playwright 1.58.2 (Refs #459)',
    );
    expect(message).toContain(`- ${PATH_A} (1234 px)`);
    expect(message).toContain(`- ${PATH_B} (count not reported)`);
    expect(closingKeywordOffences(message)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them against throwing stubs**

Add `validateArtifact`, `dispatchable`, `commentBody` and `commitMessage` as throwing stubs, and `export const MAX_PNG_BYTES = 2 * 1024 * 1024;`.

Run: `npx vitest run tests/unit/visual-rebaseline.test.ts`
Expected: the first 47 pass, and all 36 new tests fail.

- [ ] **Step 3: Write the implementation**

<!-- append: scripts/visual-rebaseline.mjs -->
```js

/** The largest baseline today is 578 KB (measured 2026-10-03). */
export const MAX_PNG_BYTES = 2 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MANIFEST_KEYS = ['files', 'headSha', 'playwright', 'pr'];
const FILE_KEYS = ['bytes', 'path', 'pixels', 'sha256'];

/**
 * An artifact-derived string, quoted and cut, so a newline in it cannot
 * start a workflow command when the error reaches the log.
 * @param {unknown} value
 * @returns {string}
 */
const quoted = (value) => JSON.stringify(String(value).slice(0, 120));

/**
 * A number as itself; anything else, quoted.
 * @param {unknown} value
 * @returns {string}
 */
const shown = (value) =>
  typeof value === 'number' ? String(value) : quoted(value);

/**
 * @param {unknown} value
 * @param {readonly string[]} keys sorted
 * @returns {value is Record<string, any>}
 */
const hasExactly = (value, keys) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  isDeepStrictEqual(Object.keys(value).sort(), keys);

/**
 * @param {string} path
 * @returns {string[]} every directory above the file
 */
const ancestorsOf = (path) =>
  path
    .split('/')
    .slice(0, -1)
    .map((_, index, parts) => parts.slice(0, index + 1).join('/'));

/**
 * @typedef {{ name: string, kind: 'file' | 'directory' | 'other',
 *   content?: Uint8Array }} Entry
 */

/**
 * The artifact, checked from its manifest down to each file's bytes, or a
 * refusal by name. Nothing in it is trusted: the manifest is bound to the
 * run that produced it, every path must already be a baseline at the head,
 * and every file must be exactly the PNG the manifest describes.
 * @param {object} input
 * @param {readonly Entry[]} input.entries the downloaded artifact, walked with lstat
 * @param {{ pr: number, headSha: string }} input.run the triggering run's own facts
 * @param {ReadonlySet<string>} input.headPaths every file at the pull request's head
 * @returns {{ manifest: Manifest, files: { path: string, content: Uint8Array }[] }}
 */
export function validateArtifact({ entries, run, headPaths }) {
  const manifestEntry = entries.find(
    (entry) => entry.name === 'manifest.json' && entry.kind === 'file',
  );
  if (!manifestEntry?.content)
    throw new Error('the artifact holds no manifest.json');
  /** @type {unknown} */
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestEntry.content));
  } catch {
    throw new Error('manifest.json is not JSON');
  }
  if (!hasExactly(manifest, MANIFEST_KEYS))
    throw new Error(
      `manifest.json's keys are not exactly ${MANIFEST_KEYS.join(', ')}`,
    );
  if (!Number.isSafeInteger(manifest.pr) || manifest.pr <= 0)
    throw new Error('manifest.json names no pull request number');
  if (
    typeof manifest.headSha !== 'string' ||
    !/^[0-9a-f]{40}$/.test(manifest.headSha)
  )
    throw new Error('manifest.json names no head SHA');
  if (
    typeof manifest.playwright !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(manifest.playwright)
  )
    throw new Error('manifest.json names no Playwright version');
  if (manifest.pr !== run.pr)
    throw new Error(
      `manifest.json names #${manifest.pr}, and the capture ran for #${run.pr}`,
    );
  if (manifest.headSha !== run.headSha)
    throw new Error(
      `manifest.json names ${manifest.headSha}, and the capture ran on ${run.headSha}`,
    );
  if (!Array.isArray(manifest.files) || manifest.files.length === 0)
    throw new Error('manifest.json lists no files');
  /** @type {Set<string>} */
  const listed = new Set();
  for (const file of manifest.files) {
    if (!hasExactly(file, FILE_KEYS))
      throw new Error(`a file's keys are not exactly ${FILE_KEYS.join(', ')}`);
    if (
      typeof file.path !== 'string' ||
      file.path.includes('..') ||
      !BASELINE.test(file.path)
    )
      throw new Error(`${quoted(file.path)} is not a baseline path`);
    if (listed.has(file.path)) throw new Error(`${file.path} is listed twice`);
    listed.add(file.path);
    if (!headPaths.has(file.path))
      throw new Error(
        `${file.path} is not a baseline at the head, and a rebaseline adds no file`,
      );
    if (typeof file.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(file.sha256))
      throw new Error(`${file.path} has no sha256`);
    if (
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 1 ||
      file.bytes > MAX_PNG_BYTES
    )
      throw new Error(
        `${file.path} declares ${shown(file.bytes)} bytes, outside 1 to ${MAX_PNG_BYTES}`,
      );
    if (
      file.pixels !== null &&
      (!Number.isSafeInteger(file.pixels) || file.pixels < 0)
    )
      throw new Error(
        `${file.path} has a pixel count of ${shown(file.pixels)}`,
      );
  }
  const expected = new Set(['manifest.json', ...listed]);
  const needed = new Set([...listed].flatMap(ancestorsOf));
  /** @type {Map<string, Uint8Array>} */
  const contents = new Map();
  for (const entry of entries) {
    if (entry.kind === 'directory' && needed.has(entry.name)) continue;
    if (entry.kind !== 'file' || !expected.has(entry.name) || !entry.content)
      throw new Error(
        `the artifact holds ${entry.kind} ${quoted(entry.name)}, which the manifest does not list`,
      );
    contents.set(entry.name, entry.content);
  }
  for (const name of expected)
    if (!contents.has(name)) throw new Error(`the artifact is missing ${name}`);
  /** @type {Manifest} */
  const checked = /** @type {Manifest} */ (manifest);
  const files = checked.files.map(({ path, bytes, sha256: hash }) => {
    const content = /** @type {Uint8Array} */ (contents.get(path));
    if (!PNG_SIGNATURE.every((byte, index) => content[index] === byte))
      throw new Error(`${path} is not a PNG`);
    if (content.length !== bytes)
      throw new Error(
        `${path} holds ${content.length} bytes, and the manifest says ${bytes}`,
      );
    if (sha256(content) !== hash)
      throw new Error(`${path} does not hash to its manifest entry`);
    return { path, content };
  });
  return { manifest: checked, files };
}

/**
 * Whether a parsed workflow can be started by `workflow_dispatch`.
 * @param {unknown} workflow
 * @returns {boolean}
 */
export function dispatchable(workflow) {
  const on =
    workflow !== null && typeof workflow === 'object'
      ? /** @type {Record<string, unknown>} */ (workflow).on
      : undefined;
  if (typeof on === 'string') return on === 'workflow_dispatch';
  if (Array.isArray(on)) return on.includes('workflow_dispatch');
  return (
    on !== null &&
    typeof on === 'object' &&
    Object.hasOwn(on, 'workflow_dispatch')
  );
}

/**
 * @param {number | null} pixels
 * @returns {string}
 */
const countOf = (pixels) => (pixels === null ? 'not reported' : String(pixels));

/**
 * The pull request comment. Every value in it passed `validateArtifact`'s
 * patterns first.
 * @param {Manifest} manifest
 * @param {string} commitSha
 * @returns {string}
 */
export function commentBody(manifest, commitSha) {
  return [
    'Rebaselined automatically (#459). `operator-review` holds the merge until the operator approves the PNG diff at this head.',
    '',
    `Playwright ${manifest.playwright}, commit ${commitSha}.`,
    '',
    '| Baseline | Differing pixels at the gate |',
    '| --- | --- |',
    ...manifest.files.map(
      ({ path, pixels }) => `| \`${path}\` | ${countOf(pixels)} |`,
    ),
    '',
    `Labelled \`${LABEL}\`.`,
  ].join('\n');
}

/**
 * @param {Manifest} manifest
 * @returns {string}
 */
export function commitMessage(manifest) {
  return [
    `Rebaseline ${manifest.files.length} screenshot(s) for Playwright ${manifest.playwright} (Refs #459)`,
    '',
    "The visual gate failed these on pixels alone after Dependabot's",
    'Playwright update, and visual-rebaseline.yml recaptured them in the',
    "gate's own image. operator-review holds the merge until the operator",
    'approves the PNG diff at this head.',
    '',
    ...manifest.files.map(({ path, pixels }) =>
      pixels === null
        ? `- ${path} (count not reported)`
        : `- ${path} (${pixels} px)`,
    ),
  ].join('\n');
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run tests/unit/visual-rebaseline.test.ts`
Expected: 83 passed (measured, plan review pass 4).

- [ ] **Step 5: Commit, then mutate**

```bash
git add scripts/visual-rebaseline.mjs tests/unit/visual-rebaseline.test.ts
git commit -m "visual-rebaseline: validate the artifact and write the commit (Refs #459)"
```

| # | Mutation | Predicted |
| --- | --- | --- |
| V1 | drop the `run.pr` binding | RED: another pull request |
| V2 | drop the `headPaths` check | RED: adds no file |
| V3 | drop `entry.kind !== 'file' \|\|` | RED: the symlink that carries bytes |
| V4 | skip the signature check | RED: not a PNG |
| V5 | `quoted` returns `String(value)` | RED: the newline test |
| V6 | `dispatchable`: `return true` | RED: without it, commented out |

---

### Task 4: The commands that read files and call GitHub

**Files:**
- Modify: `scripts/visual-rebaseline.mjs`
- Create: `tests/unit/visual-rebaseline-cli.test.ts`

**Interfaces:**
- Consumes: every export from Tasks 1-3.
- Produces: `main(args?: string[]): Promise<void>` and the five commands. `qualify` reads `PR_NUMBER`, `GITHUB_TOKEN` and `GITHUB_REPOSITORY`, and writes `qualifies=true|false` to `GITHUB_OUTPUT`. `classify <gate.json> <list.json>` reads `GATE_EXIT`, writes `failed.json` and `failed=<n>`. `stage <dir>` reads `failed.json`, `PR_NUMBER` and `HEAD_SHA`, and writes `<dir>/manifest.json` with the files beside it. `find` reads `RUN_ID` and writes `present=true|false`. `commit` reads `RUN_PR`, `RUN_HEAD_SHA` and `ARTIFACT_DIR`. `entriesUnder(root: string): Entry[]` is exported for the CLI test. Every command appends its report to `GITHUB_STEP_SUMMARY` when that is set, and prints `::error::<reason>` and exits 1 on a refusal.

The network commands (`qualify`, `find`, `commit`, and Task 10's `locked`) are proved on the real runner in Task 12. They talk only to GitHub, and a stand-in for GitHub would test the stand-in. The file commands are proved here against real files.

- [ ] **Step 1: Write the failing tests**

<!-- create: tests/unit/visual-rebaseline-cli.test.ts -->
```ts
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  entriesUnder,
  validateArtifact,
} from '../../scripts/visual-rebaseline.mjs';

/**
 * The capture's file commands, run as the workflow runs them, against real
 * files in a temporary checkout (#459). `stage`'s output is read back through
 * `validateArtifact`, so the format the capture writes is the format the
 * commit accepts.
 */
const SCRIPT = resolve('scripts/visual-rebaseline.mjs');
const BASELINE = 'tests/e2e/__screenshots__/home-linux.png';
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const COMMITTED = Uint8Array.from([...SIGNATURE, 1]);
const RECAPTURED = Uint8Array.from([...SIGNATURE, 2, 3]);
const hex = (content: Uint8Array) =>
  createHash('sha256').update(content).digest('hex');

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A checkout with one committed baseline. realpath: macOS's tmpdir is a symlink, and cwd() is not. */
const checkout = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rebaseline-')));
  made.push(dir);
  mkdirSync(join(dir, dirname(BASELINE)), { recursive: true });
  writeFileSync(join(dir, BASELINE), COMMITTED);
  return dir;
};

const run = (dir: string, args: string[], env: Record<string, string>) =>
  spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      GITHUB_OUTPUT: join(dir, 'out.txt'),
      ...env,
    },
  });

const outputs = (dir: string) => readFileSync(join(dir, 'out.txt'), 'utf8');

const reportOf = (dir: string, failing: boolean) => ({
  suites: [
    {
      title: 'visual.spec.ts',
      specs: [
        {
          title: 'home',
          tests: [
            {
              results: [
                failing
                  ? {
                      status: 'failed',
                      errors: [
                        {
                          message:
                            'Error: expect(page).toHaveScreenshot(expected) failed\n\n  77 pixels (ratio 0.01 of all image pixels) are different.',
                        },
                      ],
                      attachments: [
                        {
                          name: 'home-expected.png',
                          path: join(dir, BASELINE),
                        },
                        {
                          name: 'home-actual.png',
                          path: join(dir, 'test-results/home-actual.png'),
                        },
                        {
                          name: 'home-diff.png',
                          path: join(dir, 'test-results/home-diff.png'),
                        },
                      ],
                    }
                  : { status: 'passed', errors: [], attachments: [] },
              ],
            },
          ],
        },
      ],
    },
  ],
  errors: [],
});
const LISTING = {
  suites: [
    {
      title: 'visual.spec.ts',
      specs: [{ title: 'home', tests: [{ results: [] }] }],
    },
  ],
  errors: [],
};
const classify = (dir: string, failing: boolean, exit: string) => {
  writeFileSync(join(dir, 'gate.json'), JSON.stringify(reportOf(dir, failing)));
  writeFileSync(join(dir, 'list.json'), JSON.stringify(LISTING));
  return run(dir, ['classify', 'gate.json', 'list.json'], { GATE_EXIT: exit });
};

describe("entriesUnder: the commit job's walk of the artifact (#459)", () => {
  // Why this walk is not tests/source-files.ts's `filesUnder`: that one skips
  // dotfiles and node_modules, which is right for scanning the repository and
  // would blind a validator to exactly what it exists to refuse.
  it('sees a dotfile, and reports a symlink without following it', () => {
    const dir = checkout();
    writeFileSync(join(dir, '.hidden'), 'x');
    symlinkSync(join(dir, BASELINE), join(dir, 'link.png'));
    const names = entriesUnder(dir).map(({ name, kind }) => `${kind} ${name}`);
    expect(names.sort()).toEqual([
      'directory tests',
      'directory tests/e2e',
      'directory tests/e2e/__screenshots__',
      'file .hidden',
      `file ${BASELINE}`,
      'other link.png',
    ]);
  });
});

describe('visual-rebaseline.mjs, run as the capture runs it (#459)', () => {
  it('fails an unknown command by name', () => {
    const result = run(checkout(), ['bogus'], {});
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      '::error::unknown command bogus; expected qualify, classify, stage, find or commit',
    );
  });

  it('classify: a passing gate has nothing to do', () => {
    const dir = checkout();
    const result = classify(dir, false, '0');
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(outputs(dir)).toBe('failed=0\n');
  });

  it('classify: records each failed baseline with its committed hash', () => {
    const dir = checkout();
    const result = classify(dir, true, '1');
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(outputs(dir)).toBe('failed=1\n');
    expect(JSON.parse(readFileSync(join(dir, 'failed.json'), 'utf8'))).toEqual([
      { path: BASELINE, pixels: 77, before: hex(COMMITTED) },
    ]);
  });

  it('classify: refuses a gate whose exit disagrees with its report', () => {
    const result = classify(checkout(), false, '1');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      '::error::the gate exited 1 with no failed screenshot in its report',
    );
  });

  it('stage: writes what the commit accepts', () => {
    const dir = checkout();
    expect(classify(dir, true, '1').status).toBe(0);
    writeFileSync(join(dir, BASELINE), RECAPTURED);
    mkdirSync(join(dir, 'node_modules/@playwright/test'), { recursive: true });
    writeFileSync(
      join(dir, 'node_modules/@playwright/test/package.json'),
      '{"version":"1.58.2"}',
    );
    const result = run(dir, ['stage', 'rebaseline'], {
      PR_NUMBER: '42',
      HEAD_SHA: 'c'.repeat(40),
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const { manifest, files } = validateArtifact({
      entries: entriesUnder(join(dir, 'rebaseline')),
      run: { pr: 42, headSha: 'c'.repeat(40) },
      headPaths: new Set([BASELINE]),
    });
    expect(manifest).toEqual({
      pr: 42,
      headSha: 'c'.repeat(40),
      playwright: '1.58.2',
      files: [
        {
          path: BASELINE,
          sha256: hex(RECAPTURED),
          bytes: RECAPTURED.length,
          pixels: 77,
        },
      ],
    });
    expect(files[0].content).toEqual(Buffer.from(RECAPTURED));
  });

  it('stage: refuses a baseline the recapture left unchanged', () => {
    const dir = checkout();
    expect(classify(dir, true, '1').status).toBe(0);
    mkdirSync(join(dir, 'node_modules/@playwright/test'), { recursive: true });
    writeFileSync(
      join(dir, 'node_modules/@playwright/test/package.json'),
      '{"version":"1.58.2"}',
    );
    const result = run(dir, ['stage', 'rebaseline'], {
      PR_NUMBER: '42',
      HEAD_SHA: 'c'.repeat(40),
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      `::error::the gate failed ${BASELINE}, and the recapture left it unchanged`,
    );
  });
});
```

- [ ] **Step 2: Run them and watch every one fail**

Run: `npx vitest run tests/unit/visual-rebaseline-cli.test.ts`
Expected: 7 failed. The script has no `main` yet, so every run exits 0 with no output, and `entriesUnder` is not exported yet.

- [ ] **Step 3: Write `main`**

<!-- edit: scripts/visual-rebaseline.mjs -->
```js
import { createHash } from 'node:crypto';
import { relative, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
```
```js
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { argv, cwd, env, exit } from 'node:process';
import { isDeepStrictEqual } from 'node:util';
import { messageOf } from './errors.mjs';
```

<!-- append: scripts/visual-rebaseline.mjs -->
```js

// ---- I/O: everything below reads, writes or calls GitHub -------------------

const LIMIT_MS = 30_000;

/**
 * @param {string} name
 * @returns {string}
 */
function requireEnv(name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * A line for the log and, when there is one, the job summary: the API reads
 * back the log, never the summary (#224).
 * @param {string} text
 */
function report(text) {
  console.log(text);
  if (env.GITHUB_STEP_SUMMARY)
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

/**
 * @param {string} name
 * @param {string} value
 */
function output(name, value) {
  appendFileSync(requireEnv('GITHUB_OUTPUT'), `${name}=${value}\n`);
}

/**
 * @param {string} path
 * @returns {any}
 */
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/**
 * One request to this repository's API: a time limit, no retry. A status
 * outside `ok` fails by name.
 * @param {string} method
 * @param {string} path below /repos/{owner}/{repo}
 * @param {{ body?: unknown, accept?: string, ok?: readonly number[] }} [options]
 * @returns {Promise<{ status: number, text: string }>}
 */
async function github(method, path, options = {}) {
  const {
    body,
    accept = 'application/vnd.github+json',
    ok = [200, 201],
  } = options;
  const response = await fetch(
    `https://api.github.com/repos/${requireEnv('GITHUB_REPOSITORY')}${path}`,
    {
      method,
      headers: {
        accept,
        authorization: `Bearer ${requireEnv('GITHUB_TOKEN')}`,
        'x-github-api-version': '2022-11-28',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(LIMIT_MS),
    },
  );
  const text = await response.text();
  if (!ok.includes(response.status))
    throw new Error(
      `${method} ${path} answered ${response.status}: ${text.slice(0, 200)}`,
    );
  return { status: response.status, text };
}

/**
 * @param {string} path
 * @returns {Promise<any>}
 */
const getJson = async (path) => JSON.parse((await github('GET', path)).text);

/**
 * @param {string} method
 * @param {string} path
 * @param {unknown} body
 * @returns {Promise<any>}
 */
const sendJson = async (method, path, body) =>
  JSON.parse((await github(method, path, { body })).text);

/**
 * A file's raw text at a commit; `null` only where `missing` allows it.
 * @param {string} path
 * @param {string} ref
 * @param {boolean} [missing]
 * @returns {Promise<string | null>}
 */
async function contentAt(path, ref, missing = false) {
  const { status, text } = await github('GET', `/contents/${path}?ref=${ref}`, {
    accept: 'application/vnd.github.raw+json',
    ok: missing ? [200, 404] : [200],
  });
  return status === 404 ? null : text;
}

/**
 * @param {string} sha
 * @returns {Promise<Side>}
 */
async function sideAt(sha) {
  return {
    lock: /** @type {string} */ (await contentAt('package-lock.json', sha)),
    pkg: /** @type {string} */ (await contentAt('package.json', sha)),
    dockerfile: await contentAt('docker/playwright/Dockerfile', sha, true),
  };
}

async function runQualify() {
  const number = requireEnv('PR_NUMBER');
  const pr = await getJson(`/pulls/${number}`);
  /** @type {string[]} */
  const files = [];
  for (let page = 1; ; page += 1) {
    const batch = await getJson(
      `/pulls/${number}/files?per_page=100&page=${page}`,
    );
    for (const file of batch)
      files.push(
        file.previous_filename
          ? `${file.previous_filename} → ${file.filename}`
          : file.filename,
      );
    if (batch.length < 100) break;
  }
  const compare = await getJson(
    `/compare/${encodeURIComponent(pr.base.ref)}...${pr.head.sha}`,
  );
  const verdict = qualify({
    author: pr.user.login,
    headRepo: pr.head.repo?.full_name ?? '(a deleted repository)',
    baseRepo: pr.base.repo.full_name,
    files,
    changedFiles: pr.changed_files,
    behindBy: compare.behind_by,
    base: await sideAt(compare.merge_base_commit.sha),
    head: await sideAt(pr.head.sha),
  });
  report(
    verdict.qualifies
      ? `Qualifies for a rebaseline: ${verdict.versions}.`
      : `No rebaseline: ${verdict.reason}.`,
  );
  output('qualifies', String(verdict.qualifies));
}

/**
 * @param {string} gatePath
 * @param {string} listPath
 */
function runClassify(gatePath, listPath) {
  const failed = failedBaselines(
    readJson(gatePath),
    testsIn(readJson(listPath)).length,
    cwd(),
  );
  gateAgrees(Number(requireEnv('GATE_EXIT')), failed);
  const recorded = failed.map((each) => ({
    ...each,
    before: sha256(readFileSync(each.path)),
  }));
  writeFileSync('failed.json', JSON.stringify(recorded, null, 2));
  report(
    failed.length === 0
      ? 'The visual gate passed: nothing to rebaseline.'
      : [
          `The visual gate failed ${failed.length} screenshot(s) on pixels alone:`,
          ...failed.map(({ path, pixels }) => `- ${path} (${countOf(pixels)})`),
        ].join('\n'),
  );
  output('failed', String(failed.length));
}

/** @param {string} outDir */
function runStage(outDir) {
  const manifest = buildManifest({
    pr: Number(requireEnv('PR_NUMBER')),
    headSha: requireEnv('HEAD_SHA'),
    playwright: readJson('node_modules/@playwright/test/package.json').version,
    failed: readJson('failed.json'),
    contentOf: (path) => readFileSync(path),
  });
  for (const { path } of manifest.files) {
    mkdirSync(dirname(join(outDir, path)), { recursive: true });
    copyFileSync(path, join(outDir, path));
  }
  writeFileSync(
    join(outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
  report(
    `Staged ${manifest.files.length} recaptured baseline(s) for #${manifest.pr}.`,
  );
}

async function runFind() {
  const runId = requireEnv('RUN_ID');
  const { artifacts } = await getJson(
    `/actions/runs/${runId}/artifacts?name=${ARTIFACT}`,
  );
  const present = artifacts.some(
    /** @param {{ name: string, expired: boolean }} a */
    (a) => a.name === ARTIFACT && !a.expired,
  );
  report(
    present
      ? `Run ${runId} uploaded ${ARTIFACT}.`
      : `Run ${runId} uploaded no ${ARTIFACT}: nothing to commit.`,
  );
  output('present', String(present));
}

/**
 * Every entry under the downloaded artifact, read with lstat, so a symlink is
 * seen as one and never followed. The second home for walking a tree (see
 * one-home.test.ts): tests/source-files.ts's `filesUnder` skips dotfiles and
 * node_modules and refuses an empty walk, which is right for scanning the
 * repository and would blind a validator to exactly what it must refuse.
 * @param {string} root
 * @param {string} [prefix]
 * @returns {Entry[]}
 */
export function entriesUnder(root, prefix = '') {
  return readdirSync(join(root, prefix)).flatMap((name) => {
    const path = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(join(root, path));
    if (stat.isDirectory())
      return [
        { name: path, kind: /** @type {const} */ ('directory') },
        ...entriesUnder(root, path),
      ];
    if (stat.isFile())
      return [
        {
          name: path,
          kind: /** @type {const} */ ('file'),
          content: readFileSync(join(root, path)),
        },
      ];
    return [{ name: path, kind: /** @type {const} */ ('other') }];
  });
}

async function runCommit() {
  const number = Number(requireEnv('RUN_PR'));
  const headSha = requireEnv('RUN_HEAD_SHA');
  const entries = entriesUnder(requireEnv('ARTIFACT_DIR'));
  const pr = await getJson(`/pulls/${number}`);
  if (pr.user.login !== DEPENDABOT)
    throw new Error(
      `#${number} was opened by ${pr.user.login}, not ${DEPENDABOT}`,
    );
  if (pr.head.repo?.full_name !== requireEnv('GITHUB_REPOSITORY'))
    throw new Error(`#${number}'s head is not in this repository`);
  if (pr.state !== 'open') throw new Error(`#${number} is ${pr.state}`);
  if (pr.head.sha !== headSha)
    throw new Error(
      `#${number}'s head moved from ${headSha} to ${pr.head.sha} after the ` +
        'capture; the capture on the new head decides again',
    );
  const tree = await getJson(`/git/trees/${headSha}?recursive=1`);
  if (tree.truncated)
    throw new Error(`the tree at ${headSha} came back truncated`);
  const headPaths = new Set(
    tree.tree
      .filter(/** @param {{ type: string }} t */ (t) => t.type === 'blob')
      .map(/** @param {{ path: string }} t */ (t) => t.path),
  );
  const { manifest, files } = validateArtifact({
    entries,
    run: { pr: number, headSha },
    headPaths,
  });
  const { parse } = await import('yaml');
  const ci = await contentAt('.github/workflows/ci.yml', headSha);
  if (!dispatchable(parse(/** @type {string} */ (ci))))
    throw new Error(
      `ci.yml at ${headSha} has no workflow_dispatch trigger, so nothing could ` +
        "run CI on a rebaseline commit; Dependabot's next rebase brings it in",
    );
  const blobs = [];
  for (const { path, content } of files) {
    const blob = await sendJson('POST', '/git/blobs', {
      content: Buffer.from(content).toString('base64'),
      encoding: 'base64',
    });
    blobs.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const head = await getJson(`/git/commits/${headSha}`);
  const newTree = await sendJson('POST', '/git/trees', {
    base_tree: head.tree.sha,
    tree: blobs,
  });
  const commit = await sendJson('POST', '/git/commits', {
    message: commitMessage(manifest),
    tree: newTree.sha,
    parents: [headSha],
  });
  await github('PATCH', `/git/refs/heads/${pr.head.ref}`, {
    body: { sha: commit.sha, force: false },
  });
  report(`Committed ${commit.sha} on ${pr.head.ref}.`);
  await github('POST', '/actions/workflows/ci.yml/dispatches', {
    body: { ref: pr.head.ref },
    ok: [204],
  });
  report(`Dispatched ci.yml on ${pr.head.ref}.`);
  await github('POST', `/issues/${number}/labels`, {
    body: { labels: [LABEL] },
  });
  await github('POST', `/issues/${number}/comments`, {
    body: { body: commentBody(manifest, commit.sha) },
  });
  report(`Labelled #${number} ${LABEL} and commented.`);
}

/**
 * @param {readonly string[]} [args]
 */
export async function main(args = argv.slice(2)) {
  const [command, ...rest] = args;
  try {
    if (command === 'qualify') await runQualify();
    else if (command === 'classify') runClassify(rest[0], rest[1]);
    else if (command === 'stage') runStage(rest[0]);
    else if (command === 'find') await runFind();
    else if (command === 'commit') await runCommit();
    else
      throw new Error(
        `unknown command ${command ?? '(none)'}; expected qualify, classify, stage, find or commit`,
      );
  } catch (error) {
    const reason = messageOf(error);
    console.log(`::error::${reason}`);
    if (env.GITHUB_STEP_SUMMARY)
      appendFileSync(env.GITHUB_STEP_SUMMARY, `Refused: ${reason}\n`);
    exit(1);
  }
}

if (import.meta.main) await main();
```

- [ ] **Step 3b: Register the script with the guards that inventory scripts**

`script-entry.test.ts` runs every script that decides with `import.meta.main`, using an input it refuses. With no command, this one refuses by name:

<!-- edit: tests/unit/script-entry.test.ts -->
```ts
  // The three that did all their work at module scope until #276. Each refuses
```
```ts
  // With no command it does nothing it could report, so it refuses by name
  // before reading a file or calling GitHub (#459).
  'visual-rebaseline.mjs': {
    args: [],
    status: 1,
    says: 'unknown command (none); expected qualify, classify, stage, find or commit',
  },
  // The three that did all their work at module scope until #276. Each refuses
```

`one-home.test.ts` keeps directory walking in `tests/source-files.ts`. The artifact walk is a second home on purpose, with the reason beside it:

<!-- edit: tests/unit/one-home.test.ts -->
```ts
    ).toEqual([
      // The shared home. Every scan in the suite recurses through here.
      'tests/source-files.ts',
      // The detector itself: the one other file that must name the syntax,
      // in order to find it anywhere else.
      'tests/unit/one-home.test.ts',
    ]);
```
```ts
    ).toEqual([
      // The commit job's walk of a downloaded artifact (#459). filesUnder
      // skips dotfiles and node_modules and refuses an empty walk, which
      // would blind a validator to exactly what it exists to refuse; this
      // one reads every entry with lstat and follows no symlink.
      'scripts/visual-rebaseline.mjs',
      // The shared home. Every scan in the suite recurses through here.
      'tests/source-files.ts',
      // The detector itself: the one other file that must name the syntax,
      // in order to find it anywhere else.
      'tests/unit/one-home.test.ts',
    ]);
```

<!-- edit: tests/unit/one-home.test.ts -->
```ts
    ).toEqual([
      // The recursion. An empty sub-result is ordinary here and must stay
      // that way, so the proof belongs to the exported top-level form.
      'tests/source-files.ts',
```
```ts
    ).toEqual([
      // The artifact walk (#459): an empty artifact is input for
      // validateArtifact to refuse by name, never an exception here.
      'scripts/visual-rebaseline.mjs',
      // The recursion. An empty sub-result is ordinary here and must stay
      // that way, so the proof belongs to the exported top-level form.
      'tests/source-files.ts',
```

- [ ] **Step 4: Run both files, the typechecker and the whole suite**

Run: `npx vitest run tests/unit/visual-rebaseline.test.ts tests/unit/visual-rebaseline-cli.test.ts`
Expected: 90 passed (83 + 7, measured, plan review pass 4).

Run: `npx astro check`
Expected: `0 errors`, `0 warnings`, `0 hints`. Filter the summary with `(error|warning|hint)s?` and expect three lines.

Run: `npx vitest run`
Expected: the whole unit suite green. A new file is invisible to the tracked-file guards until it is added, so run `git add -N` on the new files first.

- [ ] **Step 5: Commit, then mutate**

```bash
git add scripts/visual-rebaseline.mjs tests/unit/visual-rebaseline-cli.test.ts
git commit -m "visual-rebaseline: the capture and commit commands (Refs #459)"
```

| # | Mutation | Predicted |
| --- | --- | --- |
| C1 | `runClassify`: drop `gateAgrees` | RED: the exit disagreement |
| C2 | `runStage`: do not copy the files | RED: stage, missing file |
| C3 | `main`: `exit(0)` in the catch | RED: unknown command, disagreement, unchanged |
| C4 | `entriesUnder` skips names starting with `.` | RED: sees a dotfile |

---

### Task 5: `ci.yml` can be dispatched

**Files:**
- Modify: `.github/workflows/ci.yml:26-31`
- Modify: `tests/unit/pipeline-wiring.test.ts` (the two trigger pins)

**Interfaces:**
- Produces: `ci.yml` with `on:` holding exactly `pull_request`, `workflow_call` and `workflow_dispatch`. Task 7's `commit` dispatches it.

- [ ] **Step 1: Change both pins**

<!-- edit: tests/unit/pipeline-wiring.test.ts -->
```ts
    // The whole trigger set, exactly: callable, and still nothing else.
    expect(Object.keys(ci.on ?? {}).sort()).toEqual([
      'pull_request',
      'workflow_call',
    ]);
```
```ts
    // The whole trigger set, exactly: callable, dispatchable for the visual
    // rebaseline's commit (#459), and still nothing else.
    expect(Object.keys(ci.on ?? {}).sort()).toEqual([
      'pull_request',
      'workflow_call',
      'workflow_dispatch',
    ]);
```

<!-- edit: tests/unit/pipeline-wiring.test.ts -->
```ts
    // request is allowed only because the key falls back to the run's own id,
    // a group of one that cancels nothing. The one such trigger is
    // `workflow_call`, the dispatch path running this suite (#163).
    expect(
      Object.keys(ci.on ?? {}).sort(),
      'a trigger besides pull_request needs a key no other run shares',
    ).toEqual(['pull_request', 'workflow_call']);
```
```ts
    // request is allowed only because the key falls back to the run's own id,
    // a group of one that cancels nothing. There are two such triggers:
    // `workflow_call`, the dispatch path running this suite (#163), and
    // `workflow_dispatch`, which the visual rebaseline's commit uses to run CI
    // on the head it wrote (#459).
    expect(
      Object.keys(ci.on ?? {}).sort(),
      'a trigger besides pull_request needs a key no other run shares',
    ).toEqual(['pull_request', 'workflow_call', 'workflow_dispatch']);
```

- [ ] **Step 2: Watch both fail**

Run: `npx vitest run tests/unit/pipeline-wiring.test.ts`
Expected: 2 failed, each showing `workflow_dispatch` missing from the received triggers.

- [ ] **Step 3: Add the trigger**

<!-- edit: .github/workflows/ci.yml -->
```yaml
# `workflow_call` is the one other trigger, and it is not a push: it is how
# deploy-dev.yml's dispatch path runs THIS suite on a branch that has no pull
# request, rather than a copy of it that could drift (#163).
on:
  pull_request:
  workflow_call:
```
```yaml
# `workflow_call` is not a push either: it is how deploy-dev.yml's dispatch
# path runs THIS suite on a branch that has no pull request, rather than a
# copy of it that could drift (#163).
#
# `workflow_dispatch` is how the visual rebaseline's commit runs CI on the
# head it wrote (#459). A push made with a job's own GITHUB_TOKEN starts no
# workflow, and a dispatch is one of the two events GitHub exempts. The
# dispatched run has no pull request number, so its concurrency key falls
# back to its run id, and the checks it posts land on the branch head by
# name, which is what branch protection and scripts/deploy-gate.mjs read.
on:
  pull_request:
  workflow_call:
  workflow_dispatch:
```

- [ ] **Step 4: Watch them pass, then run the whole suite**

Run: `npx vitest run tests/unit/pipeline-wiring.test.ts`
Expected: all pass.

Run: `npx vitest run`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml tests/unit/pipeline-wiring.test.ts
git commit -m "ci.yml can be dispatched, for the rebaseline's commit (Refs #459)"
```

---

### Task 6: The capture workflow

**Files:**
- Create: `.github/workflows/visual-rebaseline.yml`
- Modify: `tests/unit/pipeline-wiring.test.ts` (narrow the `--update-snapshots` guard, and append the capture guards)

**Interfaces:**
- Consumes: `qualify`, `classify` and `stage` (Task 4), `scripts/playwright-image.mjs`, and `ARTIFACT` (`visual-rebaseline`).
- Produces: a workflow named exactly `Visual rebaseline capture`, which uploads the artifact `visual-rebaseline` when there is something to commit.

- [ ] **Step 1: Write the failing guards**

<!-- edit: tests/unit/pipeline-wiring.test.ts -->
```ts
  it('never passes --update-snapshots, in any workflow', () => {
    // `workflowFileNames` refuses an empty read (#84), so this loop cannot
    // run over nothing and report success.
    for (const name of workflowFileNames()) {
      if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue;
      expect(
        withoutCommentLines(workflow(name), '#'),
        `${name} can rewrite the baseline it is checking against`,
      ).not.toContain('--update-snapshots');
    }
  });
```
```ts
  it('passes --update-snapshots in no workflow but the rebaseline capture (#459)', () => {
    // The capture recaptures in a throwaway checkout, and what it writes
    // reaches the repository only as a commit the operator reviews. Every
    // other workflow, the gate included, must never rewrite a baseline.
    const read = workflowYamlNames();
    // Measured 2026-10-03: 12 workflow files once #459 lands (the two lock
    // workflows added, the #460 probe's two deleted). 11 also holds through
    // Task 6 alone, where the capture is the eleventh.
    expect(read.length).toBeGreaterThanOrEqual(11);
    const rewriting = read.filter((name) =>
      withoutCommentLines(workflow(name), '#').includes('--update-snapshots'),
    );
    expect(searched(rewriting, { of: read, what: 'workflow files' })).toEqual([
      'visual-rebaseline.yml',
    ]);
  });
```

<!-- append: tests/unit/pipeline-wiring.test.ts -->
```ts

// ---- the visual rebaseline (#459) -----------------------------------------
//
// Two workflows split the privilege. The capture runs pull-request code, so
// it holds a read-only token and no secret; the commit writes, so it runs
// only the default branch's code. Read from the parsed workflows, so a
// comment cannot satisfy any of these.

const CAPTURE = 'visual-rebaseline.yml';
const COMMIT = 'visual-rebaseline-commit.yml';

interface ParsedStep {
  readonly job: string;
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Record<string, unknown>;
  readonly env?: Record<string, unknown>;
}

/** Every step of a workflow, with its job, as the YAML parser reads it. */
const stepsOf = (file: string): ParsedStep[] => {
  const { jobs } = parseCleanYaml(workflow(file), file) as {
    jobs: Record<string, { steps?: Omit<ParsedStep, 'job'>[] }>;
  };
  return Object.entries(jobs).flatMap(([job, body]) =>
    (body.steps ?? []).map((step) => ({ job, ...step })),
  );
};

/** Each shell line a workflow runs, comment-stripped, with its job. */
const runLinesOf = (file: string) =>
  stepsOf(file).flatMap(({ job, run }) =>
    withoutCommentLines(run ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map((line) => ({ job, line })),
  );

describe('the rebaseline capture runs pull-request code with nothing to write with (#459)', () => {
  const root = () =>
    parseCleanYaml(workflow(CAPTURE), CAPTURE) as {
      name?: unknown;
      on?: Record<string, unknown>;
      permissions?: unknown;
    };

  it('is named as the commit workflow names it', () => {
    expect(root().name).toBe('Visual rebaseline capture');
  });

  it('runs on pull_request alone', () => {
    expect(Object.keys(root().on ?? {})).toEqual(['pull_request']);
  });

  it('reads the checkout and the pull request, and writes nothing', () => {
    expect(root().permissions).toEqual({
      contents: 'read',
      'pull-requests': 'read',
    });
  });

  it('gives no job permissions of its own', () => {
    const { jobs } = parseCleanYaml(workflow(CAPTURE), CAPTURE) as {
      jobs: Record<string, { permissions?: unknown }>;
    };
    const ids = Object.keys(jobs);
    // Measured: 3 jobs (qualify, image, capture).
    expect(ids.length).toBeGreaterThanOrEqual(2);
    const own = ids.filter((id) => jobs[id].permissions !== undefined);
    expect(searched(own, { of: ids, what: 'capture jobs' })).toEqual([]);
  });

  it('reads no secret', () => {
    const jobs = workflowJobs(workflow(CAPTURE), CAPTURE);
    const reading = jobs.filter(({ secrets }) => secrets.length > 0);
    expect(
      searched(
        reading.map(({ id }) => id),
        { of: jobs.map(({ id }) => id), what: 'capture jobs' },
      ),
    ).toEqual([]);
  });

  it('leaves no token in any checkout', () => {
    const checkouts = checkoutSteps(workflow(CAPTURE), CAPTURE);
    // Measured: 3 checkouts, one per job.
    expect(checkouts.length).toBeGreaterThanOrEqual(2);
    const persisting = checkouts.filter((step) => step.persistsCredentials);
    expect(
      searched(
        persisting.map(({ where }) => where),
        { of: checkouts.map(({ where }) => where), what: 'checkout steps' },
      ),
    ).toEqual([]);
  });

  it('acts only for Dependabot, decided before anything else runs', () => {
    expect(jobNamed(CAPTURE, 'qualify').condition).toBe(
      "github.event.pull_request.user.login == 'dependabot[bot]'",
    );
    expect(jobNamed(CAPTURE, 'image').needs).toEqual(['qualify']);
    // Each states its own condition, with the upstream result spelled out:
    // a bare implicit success() is judged over every upstream job (#157).
    expect(jobNamed(CAPTURE, 'image').condition).toBe(
      "!cancelled() && needs.qualify.result == 'success' && " +
        "needs.qualify.outputs.qualifies == 'true'",
    );
    expect(jobNamed(CAPTURE, 'capture').needs).toEqual(['image']);
    expect(jobNamed(CAPTURE, 'capture').condition).toBe(
      "!cancelled() && needs.image.result == 'success'",
    );
  });

  it('captures on the head the commit lands on, not the merge ref', () => {
    const checkouts = stepsOf(CAPTURE).filter(
      ({ job, uses }) =>
        job === 'capture' && uses?.startsWith('actions/checkout@'),
    );
    expect(checkouts.map((step) => step.with?.ref)).toEqual([
      '${{ github.event.pull_request.head.sha }}',
    ]);
  });

  it('passes --update-snapshots in its capture job alone, after the gate ran', () => {
    const lines = runLinesOf(CAPTURE);
    const rewriting = lines.filter(({ line }) =>
      line.includes('--update-snapshots'),
    );
    expect(rewriting.map(({ job }) => job)).toEqual(['capture']);
    const gate = lines.findIndex(
      ({ line }) =>
        /npx playwright test --project=visual\b/.test(line) &&
        !line.includes('--update-snapshots') &&
        !line.includes('--list'),
    );
    expect(gate, 'the gate run').toBeGreaterThan(-1);
    expect(gate).toBeLessThan(lines.indexOf(rewriting[0]));
  });

  it('declares the visual project wherever it runs Playwright', () => {
    const playwright = stepsOf(CAPTURE).filter(({ run }) =>
      /npx playwright test/.test(withoutCommentLines(run ?? '')),
    );
    // Measured: 3 steps (gate, list, recapture).
    expect(playwright.length).toBeGreaterThanOrEqual(2);
    const undeclared = playwright.filter((step) => step.env?.VISUAL !== '1');
    expect(
      searched(
        undeclared.map(({ run }) => run),
        { of: playwright.map(({ run }) => run), what: 'Playwright steps' },
      ),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Watch them fail**

Run: `npx vitest run tests/unit/pipeline-wiring.test.ts`
Expected: 11 failed, 100 passed (measured, plan review pass 10). The narrowed guard fails on its floor (`expected 10 to be greater than or equal to 11`: ten workflows, the #460 probe's two included and the capture not yet among them), and the ten capture guards fail with `ENOENT` on `visual-rebaseline.yml`.

- [ ] **Step 3: Write the workflow**

<!-- create: .github/workflows/visual-rebaseline.yml -->
```yaml
name: Visual rebaseline capture
# The UNPRIVILEGED half of the visual rebaseline (#459). Design:
# docs/superpowers/specs/2026-10-03-visual-rebaseline-design.md.
#
# A Playwright release ships new browsers, and new browsers can move pixels
# while the site is unchanged. For a pull request Dependabot opened that
# updates Playwright and nothing else, this reruns the visual gate in the
# gate's own image, recaptures exactly the screenshots it failed on pixels
# alone, and uploads them. The commit workflow, which runs only the
# default branch's code, decides whether they reach the branch.
#
# It runs pull-request code (a new Playwright is third-party code), so it
# holds a read-only token and no secret, and no checkout keeps a token. It is
# not a required check: on any other pull request every job is skipped, and a
# pull request that does not qualify ends green with its reason in the
# summary. A red `visual` on such a pull request stays red for a person to
# diagnose (operator, 2026-10-03: "we cannot afford to allow any visual bugs
# go unnoticed and unfixed").
on:
  pull_request:

permissions:
  contents: read
  pull-requests: read

concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  # Opened by Dependabot, from this repository, level with its base, and
  # touching Playwright alone: scripts/visual-rebaseline.mjs decides, and
  # tests/unit/visual-rebaseline.test.ts holds the rule.
  qualify:
    if: github.event.pull_request.user.login == 'dependabot[bot]'
    runs-on: ubuntu-26.04
    timeout-minutes: 5
    outputs:
      qualifies: ${{ steps.decide.outputs.qualifies }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version-file: .nvmrc
      - id: decide
        env:
          GITHUB_TOKEN: ${{ github.token }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
        run: node scripts/visual-rebaseline.mjs qualify

  # The gate's image, picked exactly as ci.yml picks it (#454). Each job below
  # states its upstream result itself: an implicit success() is judged over
  # every upstream job, and a skip there skips silently (#157).
  image:
    needs: qualify
    if: ${{ !cancelled() && needs.qualify.result == 'success' && needs.qualify.outputs.qualifies == 'true' }}
    runs-on: ubuntu-26.04
    timeout-minutes: 5
    outputs:
      ref: ${{ steps.pick.outputs.ref }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version-file: .nvmrc
      - id: pick
        run: node scripts/playwright-image.mjs

  capture:
    needs: image
    if: ${{ !cancelled() && needs.image.result == 'success' }}
    runs-on: ubuntu-26.04
    # The gate's last twelve green runs took at most 91 s (#431); a
    # recapture doubles that, and a stalled image pull is bounded too.
    timeout-minutes: 15
    container:
      image: ${{ needs.image.outputs.ref }}
    steps:
      # The HEAD, not the merge ref a pull_request checkout defaults to: the
      # commit lands on the head. qualify required the head to be level with
      # its base, so the two hold the same tree.
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      # The gate exactly as ci.yml runs it, keeping its JSON report. It is
      # allowed to fail: its exit and its report are read together next.
      - name: Run the visual gate, keeping its report
        id: gate
        env:
          VISUAL: '1'
          PLAYWRIGHT_JSON_OUTPUT_NAME: gate.json
        run: |
          set +e
          npx playwright test --project=visual --reporter=list,json
          echo "exit=$?" >> "$GITHUB_OUTPUT"
      - name: List the visual tests the report must account for
        env:
          VISUAL: '1'
        run: npx playwright test --project=visual --list --reporter=json > list.json
      - name: Classify the gate's failures
        id: classify
        env:
          GATE_EXIT: ${{ steps.gate.outputs.exit }}
        run: node scripts/visual-rebaseline.mjs classify gate.json list.json
      # Recaptures every screenshot (measured deterministic, #134); stage
      # keeps only the ones the gate failed.
      - name: Recapture
        if: steps.classify.outputs.failed != '0'
        env:
          VISUAL: '1'
        run: npx playwright test --project=visual --update-snapshots=all --reporter=list
      - name: Stage the baselines the gate failed
        if: steps.classify.outputs.failed != '0'
        env:
          PR_NUMBER: ${{ github.event.pull_request.number }}
          HEAD_SHA: ${{ github.event.pull_request.head.sha }}
        run: node scripts/visual-rebaseline.mjs stage rebaseline
      - name: Upload them for the commit workflow
        if: steps.classify.outputs.failed != '0'
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: visual-rebaseline
          path: rebaseline/
          retention-days: 7
          if-no-files-found: error
```

- [ ] **Step 4: Watch the guards pass, then run the whole suite**

Run: `npx vitest run tests/unit/pipeline-wiring.test.ts`
Expected: all pass.

Run: `npx vitest run`
Expected: green. Every repo-wide workflow guard now reads a new file: SHA pins, timeouts, permissions, the image selector and the browser jobs. If any of them refuses it, fix the workflow, never the guard.

Run: `npx prettier --check .`
Expected: clean.

- [ ] **Step 5: Commit, then mutate**

```bash
git add .github/workflows/visual-rebaseline.yml tests/unit/pipeline-wiring.test.ts
git commit -m "The visual rebaseline capture workflow (Refs #459)"
```

Each mutation edits `visual-rebaseline.yml` (or `ci.yml` for W1) alone and runs the whole of `pipeline-wiring.test.ts`:

| # | Mutation | Predicted |
| --- | --- | --- |
| W1 | `ci.yml`'s visual job gains `--update-snapshots` | RED: the narrowed guard |
| W2 | workflow `contents: write` | RED: writes nothing |
| W3 | `capture` job gains `permissions: { contents: read }` | RED: no job permissions |
| W4 | `qualify` gets `env: { T: ${{ secrets.X }} }` | RED: reads no secret |
| W5 | `qualify` gets `env: { T: ${{ secrets['X'] }} }` | RED: reads no secret (the bracket form) |
| W6 | the capture checkout drops `persist-credentials: false` | RED: no token |
| W7 | the capture checkout drops its `ref` | RED: head, not merge ref |
| W8 | the recapture moves above the gate step | RED: after the gate ran |
| W9 | the list step drops `VISUAL: '1'` | RED: declares the visual project |
| W10 | `qualify`'s `if:` removed | RED: acts only for Dependabot |
| W11 | `name:` changed to `Visual rebaseline` | RED: named as the commit names it |
| W12 | `capture` loses its `if:` | RED: the repo-wide skipped-upstream guard (#157), and the capture's condition pin |

---

### Task 7: The commit workflow

**Files:**
- Create: `.github/workflows/visual-rebaseline-commit.yml`
- Modify: `tests/unit/pipeline-wiring.test.ts` (append the commit guards and the no-retry guard)

**Interfaces:**
- Consumes: `find` and `commit` (Task 4), and the capture's `name:` (Task 6).
- Produces: the end-to-end chain that Task 12 proves, once Task 10 has added its `locked` step.

- [ ] **Step 1: Write the failing guards**

<!-- append: tests/unit/pipeline-wiring.test.ts -->
```ts

describe('the rebaseline commit runs only the default branch code (#459)', () => {
  const root = () =>
    parseCleanYaml(workflow(COMMIT), COMMIT) as {
      on?: { workflow_run?: { workflows?: unknown; types?: unknown } };
      permissions?: unknown;
      jobs?: Record<string, { permissions?: unknown }>;
    };

  it('is started by the capture finishing, and by nothing else', () => {
    expect(Object.keys(root().on ?? {})).toEqual(['workflow_run']);
    expect(root().on?.workflow_run?.workflows).toEqual([workflowName(CAPTURE)]);
    expect(root().on?.workflow_run?.types).toEqual(['completed']);
  });

  it('proceeds only after a successful capture of a pull request', () => {
    expect(jobNamed(COMMIT, 'commit').condition).toBe(
      "github.event.workflow_run.conclusion == 'success' && " +
        "github.event.workflow_run.event == 'pull_request'",
    );
  });

  it('writes in one job, with the three scopes it needs', () => {
    expect(root().permissions).toEqual({ contents: 'read' });
    expect(root().jobs?.commit?.permissions).toEqual({
      contents: 'write',
      actions: 'write',
      'pull-requests': 'write',
    });
    expect(Object.keys(root().jobs ?? {})).toEqual(['commit']);
  });

  it('checks out the default branch and nothing else, keeping no token', () => {
    const checkouts = stepsOf(COMMIT).filter(({ uses }) =>
      uses?.startsWith('actions/checkout@'),
    );
    const astray = checkouts.filter(
      (step) =>
        step.with?.ref !== undefined ||
        step.with?.repository !== undefined ||
        step.with?.['persist-credentials'] !== false,
    );
    expect(
      searched(
        astray.map(({ job }) => job),
        { of: checkouts.map(({ job }) => job), what: 'checkout steps' },
      ),
    ).toEqual([]);
  });

  it('installs only with npm ci --ignore-scripts', () => {
    const installs = runLinesOf(COMMIT).filter(({ line }) =>
      /\b(npm|npx|yarn|pnpm)\b/.test(line),
    );
    expect(installs.map(({ line }) => line)).toEqual([
      'npm ci --ignore-scripts',
    ]);
  });

  it("runs node only on its own checkout's scripts", () => {
    const nodes = runLinesOf(COMMIT).filter(({ line }) =>
      /\bnode\b/.test(line),
    );
    // Measured: 2 (find, commit).
    expect(nodes.length).toBeGreaterThanOrEqual(1);
    const astray = nodes.filter(({ line }) => {
      const match = /^node (scripts\/[\w.-]+\.mjs)( [a-z]+)*$/.exec(line);
      return !match || !existsSync(match[1]);
    });
    expect(
      searched(
        astray.map(({ line }) => line),
        { of: nodes.map(({ line }) => line), what: 'node invocations' },
      ),
    ).toEqual([]);
  });

  it('downloads the triggering run’s artifact, into the runner’s own temp', () => {
    const downloads = stepsOf(COMMIT).filter(({ uses }) =>
      uses?.startsWith('actions/download-artifact@'),
    );
    expect(downloads.map((step) => step.with)).toEqual([
      {
        name: 'visual-rebaseline',
        path: '${{ runner.temp }}/rebaseline',
        'run-id': '${{ github.event.workflow_run.id }}',
        'github-token': '${{ github.token }}',
      },
    ]);
  });
});

/** Run lines per rebaseline workflow, measured; each floor is that less one. */
const RUN_LINES_MEASURED: Record<string, number> = {
  [CAPTURE]: 9,
  [COMMIT]: 3,
};

describe('neither rebaseline workflow retries (operator rule, 2026-10-02)', () => {
  for (const file of [CAPTURE, COMMIT])
    it(`${file} retries nothing`, () => {
      const lines = runLinesOf(file);
      expect(lines.length).toBeGreaterThanOrEqual(RUN_LINES_MEASURED[file] - 1);
      const retrying = lines.filter(({ line }) =>
        /\bretr(?:y|ies)\b|--repeat-each|\buntil\b|\bwhile\b/i.test(line),
      );
      expect(
        searched(
          retrying.map(({ line }) => line),
          { of: lines.map(({ line }) => line), what: `${file} run lines` },
        ),
      ).toEqual([]);
      const actions = stepsOf(file).flatMap(({ uses }) => (uses ? [uses] : []));
      expect(
        searched(
          actions.filter((uses) => /retry/i.test(uses)),
          { of: actions, what: `${file} actions` },
        ),
      ).toEqual([]);
    });
});
```

- [ ] **Step 2: Watch them fail**

Run: `npx vitest run tests/unit/pipeline-wiring.test.ts`
Expected: 8 failed, 112 passed (measured, plan review passes 6 and 10): the seven commit guards and `visual-rebaseline-commit.yml retries nothing`, each with `ENOENT` on `visual-rebaseline-commit.yml`. `visual-rebaseline.yml retries nothing` passes.

- [ ] **Step 3: Write the workflow**

<!-- create: .github/workflows/visual-rebaseline-commit.yml -->
```yaml
name: Visual rebaseline commit
# The PRIVILEGED half of the visual rebaseline (#459). Design:
# docs/superpowers/specs/2026-10-03-visual-rebaseline-design.md.
#
# `workflow_run` always runs the DEFAULT branch's copy of this file, so a pull
# request cannot change what it does, and GitHub's read-only rule for runs
# Dependabot triggers covers push and pull_request events, not this one, so
# the job gets exactly the scopes it declares. It checks out only the
# default branch, installs only that lockfile with --ignore-scripts (the
# dispatch check parses YAML with the repository's `yaml` package), and runs
# only scripts/visual-rebaseline.mjs from that checkout. Nothing from the pull
# request is checked out, installed or run. The artifact is data: walked with
# lstat, validated down to each PNG's bytes, and refused whole on any doubt.
#
# Then it commits the PNGs through the Git Data API (fast-forward only),
# dispatches ci.yml on the branch, since a push made with this token starts
# no workflow, and labels the pull request for the operator's review. No
# agent merges it before the operator has approved the PNG diff (CLAUDE.md).
on:
  workflow_run:
    workflows: ['Visual rebaseline capture']
    types: [completed]

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.event.workflow_run.pull_requests[0].number || github.run_id }}
  cancel-in-progress: false

jobs:
  commit:
    if: github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'pull_request'
    runs-on: ubuntu-26.04
    timeout-minutes: 10
    permissions:
      contents: write
      actions: write
      pull-requests: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      # No npm cache in a job that can write: a cache is shared state.
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version-file: .nvmrc
      - run: npm ci --ignore-scripts
      - name: Find the capture's upload
        id: find
        env:
          GITHUB_TOKEN: ${{ github.token }}
          RUN_ID: ${{ github.event.workflow_run.id }}
        run: node scripts/visual-rebaseline.mjs find
      - name: Download it into an empty directory
        if: steps.find.outputs.present == 'true'
        uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
        with:
          name: visual-rebaseline
          path: ${{ runner.temp }}/rebaseline
          run-id: ${{ github.event.workflow_run.id }}
          github-token: ${{ github.token }}
      - name: Validate, commit, start CI, ask for review
        if: steps.find.outputs.present == 'true'
        env:
          GITHUB_TOKEN: ${{ github.token }}
          ARTIFACT_DIR: ${{ runner.temp }}/rebaseline
          RUN_PR: ${{ github.event.workflow_run.pull_requests[0].number }}
          RUN_HEAD_SHA: ${{ github.event.workflow_run.head_sha }}
        run: node scripts/visual-rebaseline.mjs commit
```

Now that the file exists, the capture's header can name it. Naming it in Task 6 would have turned *no workflow names a workflow file that does not exist* red for that task's commit (measured, plan review pass 5):

<!-- edit: .github/workflows/visual-rebaseline.yml -->
```yaml
# alone, and uploads them. The commit workflow, which runs only the
# default branch's code, decides whether they reach the branch.
```
```yaml
# alone, and uploads them. visual-rebaseline-commit.yml, which runs only the
# default branch's code, decides whether they reach the branch.
```

- [ ] **Step 4: Watch them pass, then run everything**

Run: `npx vitest run tests/unit/pipeline-wiring.test.ts`
Expected: all pass.

Run: `npx vitest run && npx astro check && npx prettier --check .`
Expected: green, `0 errors / 0 warnings / 0 hints`, clean.

- [ ] **Step 5: Commit, then mutate**

```bash
git add .github/workflows/visual-rebaseline-commit.yml tests/unit/pipeline-wiring.test.ts
git commit -m "The visual rebaseline commit workflow (Refs #459)"
```

| # | Mutation | Predicted |
| --- | --- | --- |
| K1 | add `pull_request:` to `on` | RED: nothing else starts it |
| K2 | `workflows: ['Visual rebaseline']` | RED: names the capture |
| K3 | the checkout gains `ref: ${{ github.event.workflow_run.head_sha }}` | RED: default branch only |
| K4 | `npm ci` without `--ignore-scripts` | RED: installs only |
| K5 | a step `run: npx playwright --version` | RED: installs only |
| K6 | the commit step runs `node ${{ runner.temp }}/rebaseline/x.mjs` | RED: own checkout's scripts |
| K7 | the job `if:` drops the event check | RED: successful capture of a PR |
| K8 | workflow-level `contents: write` | RED: one job writes |
| K9 | the download drops `run-id` | RED: the triggering run's artifact |
| K10 | the capture gate gains `--retries=1` | RED: `visual-rebaseline.yml retries nothing` |
| K11 | the commit step becomes `until node scripts/visual-rebaseline.mjs commit; do :; done` | RED: the no-retry guard, and the node guard |
| K12 | the commit step becomes `while ! node scripts/visual-rebaseline.mjs commit; do :; done` | RED: the no-retry guard, and the node guard |
| K13 | a step `uses: nick-fields/retry@` followed by forty zeros (a placeholder SHA: the guard reads the action's name) | RED: the no-retry guard's action check |
| K14 | the checkout gains `repository: someone/fork` | RED: default branch only |
| K15 | the checkout's `persist-credentials: false` becomes `true` | RED: default branch only, keeping no token |
| K16 | `npm ci --ignore-scripts` becomes `npm install --ignore-scripts` | RED: installs only |
| K25 | `runLinesOf` reads no line at all | RED: both no-retry guards on their floors (8 and, once Task 10 lands, 3), the node guard's floor, and every other guard that reads run lines (installs only, the capture's `--update-snapshots` placement, Task 9's allow-list) |

---

### Task 8: The verdict that holds a rebaseline's merge

**Files:**
- Create: `scripts/operator-review.mjs`
- Create: `tests/unit/operator-review.test.ts`
- Modify: `tests/unit/script-entry.test.ts` (register the script)

**Interfaces:**
- Consumes: `messageOf` (`scripts/errors.mjs`).
- Produces: `reviewVerdict({ total, commits, reviews, head }): { state: 'success' | 'failure', description: string }`, which throws on a refusal. `commits` is `{ sha: string, author: string | null, paths: string[], truncated: boolean }[]`; `reviews` is `{ user: string | null, state: string, commitId: string }[]`, oldest first, as the list endpoint returns them; `total` is the pull request's own `commits` count and `head` the SHA the verdict is for. Also `OPERATOR`. Two commands for Task 9, each reading `PR_NUMBER`, `GITHUB_REPOSITORY` and `GITHUB_TOKEN`: `head` writes the step output `sha`, and `verdict` reads `HEAD_SHA` and writes `state` and `description`.

- [ ] **Step 1: Write the failing tests**

<!-- create: tests/unit/operator-review.test.ts -->
```ts
import { describe, expect, it } from 'vitest';
import { reviewVerdict } from '../../scripts/operator-review.mjs';

// The operator-review lock (#459, decision 4). Fixtures are written here,
// never imported from the code under test, so they can disagree with it.

const HEAD = 'a'.repeat(40);
const OLDER = 'b'.repeat(40);
const SHOT = 'tests/e2e/__screenshots__/home-mobile-linux.png';
const OPERATOR = 'ShydenMcM';
const ACTIONS = 'github-actions[bot]';

interface Commit {
  sha: string;
  author: string | null;
  paths: string[];
  truncated: boolean;
}

interface Review {
  user: string | null;
  state: string;
  commitId: string;
}

const commit = (
  author: string | null,
  paths: string[],
  change: Partial<Commit> = {},
): Commit => ({
  sha: 'c'.repeat(40),
  author,
  paths,
  truncated: false,
  ...change,
});

const review = (user: string, state: string, commitId = HEAD): Review => ({
  user,
  state,
  commitId,
});

const verdictOf = (
  commits: Commit[],
  reviews: Review[] = [],
  total = commits.length,
) => reviewVerdict({ total, commits, reviews, head: HEAD });

/** Dependabot's bump, then the commit workflow's recapture. */
const REBASELINE = [
  commit('dependabot[bot]', ['package.json', 'package-lock.json']),
  commit(ACTIONS, [SHOT]),
];

const UNLOCKED = {
  state: 'success',
  description: 'No automatic rebaseline in this pull request',
};
const WAITING = {
  state: 'failure',
  description: 'Waiting for the operator to approve the rebaseline at aaaaaaa',
};
const APPROVED = {
  state: 'success',
  description: 'The operator approved the rebaseline at aaaaaaa',
};

describe('reviewVerdict: a pull request with no automatic rebaseline (#459)', () => {
  it('passes one with no bot commit, screenshots included', () => {
    expect(verdictOf([commit(OPERATOR, [SHOT])])).toEqual(UNLOCKED);
  });

  it('passes a bot commit that touches no screenshot', () => {
    expect(verdictOf([commit(ACTIONS, ['package.json'])])).toEqual(UNLOCKED);
  });

  it('passes a bot commit on a path that only begins like the folder', () => {
    expect(
      verdictOf([commit(ACTIONS, ['tests/e2e/__screenshots__-notes.md'])]),
    ).toEqual(UNLOCKED);
  });
});

describe('reviewVerdict: a pull request carrying one (#459)', () => {
  it('holds it with no review', () => {
    expect(verdictOf(REBASELINE)).toEqual(WAITING);
  });

  it('holds a screenshot commit whose author resolves to no account', () => {
    expect(verdictOf([commit(null, [SHOT])])).toEqual(WAITING);
  });

  it("releases it on the operator's approval at the head", () => {
    expect(verdictOf(REBASELINE, [review(OPERATOR, 'APPROVED')])).toEqual(
      APPROVED,
    );
  });

  it('holds an approval given at an older commit', () => {
    expect(
      verdictOf(REBASELINE, [review(OPERATOR, 'APPROVED', OLDER)]),
    ).toEqual(WAITING);
  });

  it("holds the agent App's approval", () => {
    expect(
      verdictOf(REBASELINE, [review('shyden-agent[bot]', 'APPROVED')]),
    ).toEqual(WAITING);
  });

  it("holds Dependabot's approval", () => {
    expect(
      verdictOf(REBASELINE, [review('dependabot[bot]', 'APPROVED')]),
    ).toEqual(WAITING);
  });

  it('holds once changes are requested after the approval', () => {
    expect(
      verdictOf(REBASELINE, [
        review(OPERATOR, 'APPROVED'),
        review(OPERATOR, 'CHANGES_REQUESTED'),
      ]),
    ).toEqual(WAITING);
  });

  it('releases an approval given again after a change request', () => {
    expect(
      verdictOf(REBASELINE, [
        review(OPERATOR, 'CHANGES_REQUESTED'),
        review(OPERATOR, 'APPROVED'),
      ]),
    ).toEqual(APPROVED);
  });

  it('keeps the approval when a comment follows it', () => {
    expect(
      verdictOf(REBASELINE, [
        review(OPERATOR, 'APPROVED'),
        review(OPERATOR, 'COMMENTED'),
      ]),
    ).toEqual(APPROVED);
  });

  it('holds a dismissed approval, which the API returns as DISMISSED', () => {
    expect(verdictOf(REBASELINE, [review(OPERATOR, 'DISMISSED')])).toEqual(
      WAITING,
    );
  });
});

describe('reviewVerdict: what it refuses to decide (#459)', () => {
  it("refuses a commit list shorter than the pull request's count", () => {
    expect(() => verdictOf(REBASELINE, [], 251)).toThrow(
      "read 2 of the pull request's 251 commits",
    );
  });

  it('refuses a commit whose file list is truncated', () => {
    const sha = 'd'.repeat(40);
    expect(() =>
      verdictOf([commit(OPERATOR, ['src/a.ts'], { sha, truncated: true })]),
    ).toThrow(`commit ${sha}'s file list is truncated`);
  });
});
```

- [ ] **Step 2: Run them against a throwing stub**

Create `scripts/operator-review.mjs` with `export function reviewVerdict() { throw new Error('not implemented'); }`, then run:

Run: `npx vitest run tests/unit/operator-review.test.ts`
Expected: 15 failed (measured, plan review pass 10), each on its own assertion; the two refusal tests fail because the stub's message is not the one they name.

- [ ] **Step 3: Write the script**

<!-- create: scripts/operator-review.mjs -->
```js
/**
 * The `operator-review` lock (#459, decision 4): holds a pull request that
 * carries an automatic rebaseline until the operator has approved it at its
 * current head. Design: docs/superpowers/specs/2026-10-03-visual-rebaseline-design.md,
 * Unit 4.
 *
 * `reviewVerdict` decides and is pure. `main` reads GitHub and writes step
 * outputs; operator-review.yml posts every status itself with `gh api`, where
 * the context it reports can be read from the workflow.
 */
import { appendFileSync } from 'node:fs';
import { argv, env, exit } from 'node:process';
import { messageOf } from './errors.mjs';

/** The one login whose approval counts. */
export const OPERATOR = 'ShydenMcM';

/** The identity a commit made with a job's GITHUB_TOKEN takes. */
const REBASELINER = 'github-actions[bot]';

const SCREENSHOTS = 'tests/e2e/__screenshots__/';

/** A COMMENTED review decides nothing, as in GitHub's own rule. */
const DECISIVE = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);

/**
 * @typedef {{ sha: string, author: string | null, paths: readonly string[], truncated: boolean }} Commit
 * @typedef {{ user: string | null, state: string, commitId: string }} Review
 * @typedef {{ state: 'success' | 'failure', description: string }} Verdict
 */

/**
 * The status for one head. Locked when any commit by the rebaseliner, or by
 * an author GitHub links to no account, changed a screenshot; then only the
 * operator's latest decisive review, an approval at this head, releases it.
 * @param {{ total: number, commits: readonly Commit[], reviews: readonly Review[], head: string }} facts
 * @returns {Verdict}
 */
export function reviewVerdict({ total, commits, reviews, head }) {
  if (commits.length < total)
    throw new Error(
      `read ${commits.length} of the pull request's ${total} commits; the list stops at 250`,
    );
  const truncated = commits.find((commit) => commit.truncated);
  if (truncated)
    throw new Error(`commit ${truncated.sha}'s file list is truncated`);
  const locked = commits.some(
    ({ author, paths }) =>
      (author === REBASELINER || author === null) &&
      paths.some((path) => path.startsWith(SCREENSHOTS)),
  );
  if (!locked)
    return {
      state: 'success',
      description: 'No automatic rebaseline in this pull request',
    };
  const decision = reviews
    .filter(({ user, state }) => user === OPERATOR && DECISIVE.has(state))
    .at(-1);
  const at = head.slice(0, 7);
  return decision?.state === 'APPROVED' && decision.commitId === head
    ? {
        state: 'success',
        description: `The operator approved the rebaseline at ${at}`,
      }
    : {
        state: 'failure',
        description: `Waiting for the operator to approve the rebaseline at ${at}`,
      };
}

// ---- I/O: everything below reads GitHub or writes step outputs -------------

const LIMIT_MS = 30_000;
const PAGE = 100;

/**
 * The variables a command needs, every missing one named in one refusal.
 * @param {readonly string[]} names
 * @returns {Record<string, string>}
 */
function settings(names) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`${missing.join(', ')} not set`);
  return Object.fromEntries(names.map((name) => [name, String(env[name])]));
}

/**
 * One GET from this repository's API: a time limit, no retry, and any status
 * but 200 fails by name.
 * @param {string} path below /repos/{owner}/{repo}
 * @returns {Promise<{ body: any, link: string }>}
 */
async function read(path) {
  const { GITHUB_REPOSITORY, GITHUB_TOKEN } = settings([
    'GITHUB_REPOSITORY',
    'GITHUB_TOKEN',
  ]);
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`,
    {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${GITHUB_TOKEN}`,
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(LIMIT_MS),
    },
  );
  const text = await response.text();
  if (response.status !== 200)
    throw new Error(
      `GET ${path} answered ${response.status}: ${text.slice(0, 200)}`,
    );
  return { body: JSON.parse(text), link: response.headers.get('link') ?? '' };
}

/**
 * Every page of a list endpoint, until one comes back short. Each page is new
 * data, never a second attempt at the same request.
 * @param {string} path
 * @returns {Promise<any[]>}
 */
async function everyPage(path) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const { body } = await read(`${path}?per_page=${PAGE}&page=${page}`);
    items.push(...body);
    if (body.length < PAGE) return items;
  }
}

/**
 * @param {string} name
 * @param {string} value
 */
function output(name, value) {
  appendFileSync(
    settings(['GITHUB_OUTPUT']).GITHUB_OUTPUT,
    `${name}=${value}\n`,
  );
}

async function runHead() {
  const { PR_NUMBER } = settings(['PR_NUMBER']);
  const { body: pr } = await read(`/pulls/${PR_NUMBER}`);
  console.log(`#${PR_NUMBER}'s head is ${pr.head.sha}.`);
  output('sha', pr.head.sha);
}

async function runVerdict() {
  const { PR_NUMBER, HEAD_SHA } = settings(['PR_NUMBER', 'HEAD_SHA']);
  const { body: pr } = await read(`/pulls/${PR_NUMBER}`);
  const commits = [];
  for (const { sha, author } of await everyPage(
    `/pulls/${PR_NUMBER}/commits`,
  )) {
    // GET /commits/{sha} pages its file list at 300; a next page means this
    // one is not the whole list. A rename counts its old path too.
    const { body, link } = await read(`/commits/${sha}`);
    commits.push({
      sha,
      author: author?.login ?? null,
      paths: body.files.flatMap(
        /** @param {{ filename: string, previous_filename?: string }} file */
        (file) =>
          file.previous_filename
            ? [file.filename, file.previous_filename]
            : [file.filename],
      ),
      truncated: /rel="next"/.test(link),
    });
  }
  const reviews = (await everyPage(`/pulls/${PR_NUMBER}/reviews`)).map(
    /** @param {{ user: { login: string } | null, state: string, commit_id: string }} r */
    (r) => ({
      user: r.user?.login ?? null,
      state: r.state,
      commitId: r.commit_id,
    }),
  );
  const verdict = reviewVerdict({
    total: pr.commits,
    commits,
    reviews,
    head: HEAD_SHA,
  });
  console.log(
    `operator-review on ${HEAD_SHA}: ${verdict.state}, ${verdict.description}`,
  );
  output('state', verdict.state);
  output('description', verdict.description);
}

/**
 * @param {readonly string[]} [args]
 */
export async function main(args = argv.slice(2)) {
  const [command] = args;
  try {
    if (command === 'head') await runHead();
    else if (command === 'verdict') await runVerdict();
    else
      throw new Error(
        `unknown command ${command ?? '(none)'}; expected head or verdict`,
      );
  } catch (error) {
    // The status stays `pending`, which blocks the merge, and the cause is in
    // the log and the job summary (#224: the API reads back the log).
    const reason = messageOf(error);
    console.log(`::error::${reason}`);
    if (env.GITHUB_STEP_SUMMARY)
      appendFileSync(env.GITHUB_STEP_SUMMARY, `Refused: ${reason}\n`);
    exit(1);
  }
}

if (import.meta.main) await main();
```

- [ ] **Step 3b: Register the script with the entry guard**

<!-- edit: tests/unit/script-entry.test.ts -->
```ts
  // The three that did all their work at module scope until #276. Each refuses
```
```ts
  // With no command it can decide nothing, so it refuses by name before it
  // reads a variable or calls GitHub, and the status stays pending (#459).
  'operator-review.mjs': {
    args: [],
    status: 1,
    says: 'unknown command (none); expected head or verdict',
  },
  // The three that did all their work at module scope until #276. Each refuses
```

- [ ] **Step 4: Run the file, the typechecker and the whole suite**

Run: `npx vitest run tests/unit/operator-review.test.ts`
Expected: 15 passed.

Run: `npx astro check`
Expected: `0 errors`, `0 warnings`, `0 hints` (three lines through `(error|warning|hint)s?`).

Run: `git add -N scripts/operator-review.mjs tests/unit/operator-review.test.ts && npx vitest run`
Expected: the whole unit suite green.

- [ ] **Step 5: Commit, then mutate**

```bash
git add scripts/operator-review.mjs tests/unit/operator-review.test.ts tests/unit/script-entry.test.ts
git commit -m "operator-review: the verdict that holds an automatic rebaseline (Refs #459)"
```

| # | Mutation | Predicted |
| --- | --- | --- |
| O1 | drop `\|\| author === null` | RED: no account |
| O2 | `SCREENSHOTS` loses its trailing slash | RED: only begins like the folder |
| O3 | `DECISIVE` gains `'COMMENTED'` | RED: a comment follows it |
| O4 | drop `&& decision.commitId === head` | RED: an older commit |
| O5 | drop `user === OPERATOR &&` | RED: the App's, Dependabot's |
| O6 | `.at(-1)` becomes `.at(0)` | RED: changes requested after, approval given again |
| O7 | drop the count refusal | RED: a shorter list |
| O8 | drop the truncation refusal | RED: a truncated file list |
| O9 | `main`: `exit(0)` in the catch | RED: the script-entry probe's three runs of `operator-review.mjs` |

The network half (`read`, `everyPage`, the two commands) talks only to GitHub, so Task 12 proves it on the real runner, as Task 4 does for its own commands.

---

### Task 9: The lock's two workflows

**Files:**
- Create: `.github/workflows/operator-review.yml`
- Create: `.github/workflows/operator-review-relay.yml`
- Modify: `tests/unit/pipeline-wiring.test.ts` (append the lock guards)

**Interfaces:**
- Consumes: the `head` and `verdict` commands (Task 8).
- Produces: the commit status `operator-review` on every pull request's head, which Task 11 asks the operator to require.

- [ ] **Step 1: Write the failing guards**

<!-- append: tests/unit/pipeline-wiring.test.ts -->
```ts

// ---- the operator-review lock (#459, decision 4) ---------------------------
//
// A commit status that holds an automatic rebaseline's merge until the
// operator approves it. The trusted half runs the default branch's copy on
// every push to a pull request and after every review; the relay, holding
// nothing, exists only so that a review starts it.

const REVIEW = 'operator-review.yml';
const RELAY = 'operator-review-relay.yml';

/** A step as the YAML parser reads it, with the keys these guards judge. */
type JudgedStep = ParsedStep & {
  readonly name?: string;
  readonly if?: unknown;
  readonly 'continue-on-error'?: unknown;
};

describe('operator-review decides from the default branch alone (#459)', () => {
  const root = () =>
    parseCleanYaml(workflow(REVIEW), REVIEW) as {
      on?: {
        pull_request_target?: { types?: unknown };
        workflow_run?: { workflows?: unknown; types?: unknown };
      };
      permissions?: unknown;
      jobs?: Record<
        string,
        { permissions?: unknown; 'continue-on-error'?: unknown }
      >;
    };

  it('is started by a pull request event and by the relay, and by nothing else', () => {
    expect(Object.keys(root().on ?? {})).toEqual([
      'pull_request_target',
      'workflow_run',
    ]);
    expect(root().on?.pull_request_target?.types).toEqual([
      'opened',
      'synchronize',
      'reopened',
    ]);
    expect(root().on?.workflow_run?.workflows).toEqual([workflowName(RELAY)]);
    expect(root().on?.workflow_run?.types).toEqual(['completed']);
  });

  it('holds exactly its three scopes, in one job that widens nothing', () => {
    expect(root().permissions).toEqual({
      contents: 'read',
      'pull-requests': 'read',
      statuses: 'write',
    });
    expect(Object.keys(root().jobs ?? {})).toEqual(['verdict']);
    expect(root().jobs?.verdict?.permissions).toBeUndefined();
    expect(root().jobs?.verdict?.['continue-on-error']).toBeUndefined();
  });

  it('checks out the default branch only, keeping no token', () => {
    const checkouts = stepsOf(REVIEW).filter(({ uses }) =>
      uses?.startsWith('actions/checkout@'),
    );
    // Measured: 1.
    expect(checkouts).toHaveLength(1);
    expect(checkouts[0].with).toEqual({ 'persist-credentials': false });
  });

  it('runs exactly the event check, its two commands and three status posts', () => {
    // First an independent count of the run steps in the raw text, so a
    // reader blind to one form of `run:` is caught by the step it missed
    // before the list below is read through it.
    const raw =
      withoutCommentLines(workflow(REVIEW), '#').match(/^\s+(?:- )?run:/gm) ??
      [];
    const parsed = stepsOf(REVIEW).filter(({ run }) => run !== undefined);
    expect(parsed.length, 'the parser read fewer run steps than the text').toBe(
      raw.length,
    );
    // Measured: 6 run steps.
    expect(raw).toHaveLength(6);
    // The whole list is the allow-list, in order: an install, another
    // script, a retry, or a status under another name is a line it does not
    // hold, and `pending` is posted before the first read.
    expect(runLinesOf(REVIEW).map(({ line }) => line)).toEqual([
      'if [ -z "$PR_NUMBER" ] || [ -z "$EVENT_HEAD" ]; then',
      'echo "::error::the event names no pull request, so there is no head to hold"',
      'exit 1',
      'fi',
      'gh api -X POST "repos/$GITHUB_REPOSITORY/statuses/$EVENT_HEAD" -f state=pending -f context=operator-review -f "description=Deciding"',
      'node scripts/operator-review.mjs head',
      'gh api -X POST "repos/$GITHUB_REPOSITORY/statuses/$HEAD_SHA" -f state=pending -f context=operator-review -f "description=Deciding"',
      'node scripts/operator-review.mjs verdict',
      'gh api -X POST "repos/$GITHUB_REPOSITORY/statuses/$HEAD_SHA" -f "state=$STATE" -f context=operator-review -f "description=$DESCRIPTION" -f "target_url=$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"',
    ]);
  });

  it('stops at the first failure, so a refusal leaves pending', () => {
    const steps = stepsOf(REVIEW) as JudgedStep[];
    // Measured: 8 steps.
    expect(steps.length).toBeGreaterThanOrEqual(7);
    const carrying = steps.filter(
      (step) =>
        step['continue-on-error'] !== undefined ||
        /\b(?:always|failure|cancelled)\(/.test(String(step.if ?? '')),
    );
    expect(
      searched(
        carrying.map((step) => step.name ?? step.uses ?? String(step.run)),
        {
          of: steps.map((step) => step.name ?? step.uses ?? String(step.run)),
          what: 'operator-review steps',
        },
      ),
    ).toEqual([]);
  });

  it('is reported only as a status, never as a check run a job earns by finishing', () => {
    // A job's check run passes when the job does, so a job named for the lock
    // would satisfy it with no verdict at all. Every workflow, so a job added
    // anywhere later is covered.
    const jobs = workflowYamlNames().flatMap((file) => {
      const { jobs: parsed } = parseCleanYaml(workflow(file), file) as {
        jobs: Record<string, { name?: unknown }>;
      };
      return Object.entries(parsed).map(([id, body]) => ({
        at: `${file}: ${id}`,
        check: typeof body.name === 'string' ? body.name : id,
      }));
    });
    // Measured: 24 jobs across the 12 workflows once #459 lands.
    expect(jobs.length).toBeGreaterThanOrEqual(23);
    expect(
      searched(
        jobs
          .filter(({ check }) => check === 'operator-review')
          .map(({ at }) => at),
        { of: jobs.map(({ at }) => at), what: 'jobs in every workflow' },
      ),
    ).toEqual([]);
    expect(
      producibleContexts(workflow(REVIEW), REVIEW).filter(
        (context) => context === 'operator-review',
      ),
    ).toHaveLength(3);
  });
});

describe('the review relay decides nothing and holds nothing (#459)', () => {
  const root = () =>
    parseCleanYaml(workflow(RELAY), RELAY) as {
      on?: { pull_request_review?: { types?: unknown } };
      permissions?: unknown;
      jobs?: Record<string, { permissions?: unknown }>;
    };

  it('is started by a review submitted or dismissed, and by nothing else', () => {
    // Without `dismissed`, a dismissed approval would keep its success.
    expect(Object.keys(root().on ?? {})).toEqual(['pull_request_review']);
    expect(root().on?.pull_request_review?.types).toEqual([
      'submitted',
      'dismissed',
    ]);
  });

  it('holds no permission, in the workflow or its job', () => {
    expect(root().permissions).toEqual({});
    expect(Object.keys(root().jobs ?? {})).toEqual(['relay']);
    expect(root().jobs?.relay?.permissions).toBeUndefined();
  });

  it('runs one line and no action', () => {
    expect(stepsOf(RELAY).map(({ uses }) => uses)).toEqual([undefined]);
    expect(runLinesOf(RELAY).map(({ line }) => line)).toEqual([
      'echo "Review on pull request $PR_NUMBER; operator-review.yml decides."',
    ]);
  });
});
```

- [ ] **Step 2: Watch them fail**

Run: `npx vitest run tests/unit/pipeline-wiring.test.ts`
Expected: 9 failed, 120 passed (measured, plan review pass 10): the 9 new guards, each with `ENOENT` on `operator-review.yml` or `operator-review-relay.yml`.

- [ ] **Step 3: Write the workflows**

<!-- create: .github/workflows/operator-review.yml -->
```yaml
name: Operator review
# The trusted half of the operator-review lock (#459, decision 4). Design:
# docs/superpowers/specs/2026-10-03-visual-rebaseline-design.md, Unit 4.
#
# A required check on develop that holds a pull request carrying an
# automatic rebaseline (a commit by github-actions[bot] on a screenshot)
# until the operator has approved it at its current head. Both triggers run
# the DEFAULT branch's copy of this file, so a pull request cannot change the
# verdict. A review fires no pull_request_target, so the relay completes on
# every review and its completion starts this, whatever its conclusion: the
# verdict reads everything it needs itself.
#
# It checks out only the default branch, keeping no token, installs nothing
# (the script uses Node's own fetch), and runs scripts/operator-review.mjs
# and `gh api`, which posts each status: `pending` on the event's head before
# any read, `pending` on the current head when a push has moved it, then the
# verdict there. A run that stops leaves `pending`, which blocks the merge.
on:
  pull_request_target:
    types: [opened, synchronize, reopened]
  workflow_run:
    workflows: ['Operator review relay']
    types: [completed]

permissions:
  contents: read
  pull-requests: read
  statuses: write

concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.event.workflow_run.pull_requests[0].number || github.run_id }}
  cancel-in-progress: false

jobs:
  verdict:
    runs-on: ubuntu-26.04
    timeout-minutes: 5
    env:
      GH_TOKEN: ${{ github.token }}
      GITHUB_TOKEN: ${{ github.token }}
      PR_NUMBER: ${{ github.event.pull_request.number || github.event.workflow_run.pull_requests[0].number }}
      EVENT_HEAD: ${{ github.event.pull_request.head.sha || github.event.workflow_run.pull_requests[0].head.sha }}
    steps:
      - name: Refuse an event that names no pull request
        run: |
          if [ -z "$PR_NUMBER" ] || [ -z "$EVENT_HEAD" ]; then
            echo "::error::the event names no pull request, so there is no head to hold"
            exit 1
          fi
      - name: Hold the check on the event's head
        run: gh api -X POST "repos/$GITHUB_REPOSITORY/statuses/$EVENT_HEAD" -f state=pending -f context=operator-review -f "description=Deciding"
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version-file: .nvmrc
      - name: Read the current head
        id: head
        run: node scripts/operator-review.mjs head
      - name: Hold the check on the current head too
        if: steps.head.outputs.sha != env.EVENT_HEAD
        env:
          HEAD_SHA: ${{ steps.head.outputs.sha }}
        run: gh api -X POST "repos/$GITHUB_REPOSITORY/statuses/$HEAD_SHA" -f state=pending -f context=operator-review -f "description=Deciding"
      - name: Decide
        id: verdict
        env:
          HEAD_SHA: ${{ steps.head.outputs.sha }}
        run: node scripts/operator-review.mjs verdict
      - name: Post the verdict
        env:
          HEAD_SHA: ${{ steps.head.outputs.sha }}
          STATE: ${{ steps.verdict.outputs.state }}
          DESCRIPTION: ${{ steps.verdict.outputs.description }}
        run: gh api -X POST "repos/$GITHUB_REPOSITORY/statuses/$HEAD_SHA" -f "state=$STATE" -f context=operator-review -f "description=$DESCRIPTION" -f "target_url=$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
```

<!-- create: .github/workflows/operator-review-relay.yml -->
```yaml
name: Operator review relay
# Completes on every review so that operator-review.yml, the trusted half of
# the operator-review lock (#459), runs: a review fires no
# pull_request_target. This file runs the pull request's own copy, which is
# why it decides nothing, reads nothing and holds no permission.
on:
  pull_request_review:
    types: [submitted, dismissed]

permissions: {}

jobs:
  relay:
    runs-on: ubuntu-26.04
    timeout-minutes: 1
    steps:
      - name: Name the pull request
        env:
          PR_NUMBER: ${{ github.event.pull_request.number }}
        run: echo "Review on pull request $PR_NUMBER; operator-review.yml decides."
```

- [ ] **Step 4: Watch them pass, then run everything**

Run: `npx vitest run tests/unit/pipeline-wiring.test.ts`
Expected: all pass.

Run: `npx vitest run && npx astro check && npx prettier --check .`
Expected: green, `0 errors / 0 warnings / 0 hints`, clean.

- [ ] **Step 5: Commit, then mutate**

```bash
git add .github/workflows/operator-review.yml .github/workflows/operator-review-relay.yml tests/unit/pipeline-wiring.test.ts
git commit -m "The operator-review lock's workflows (Refs #459)"
```

| # | Mutation | Predicted |
| --- | --- | --- |
| L1 | `on` gains `pull_request:` | RED: started by nothing else, and the existing *no workflow a pull request can start grants a write scope to a silent job* |
| L2 | the relay's `name:` becomes `Review relay` | RED: started by the relay |
| L3 | workflow-level `contents: write` | RED: three scopes |
| L4 | the checkout gains `ref: ${{ github.event.pull_request.head.sha }}` | RED: default branch only |
| L5 | a step `run: npm ci` | RED: the allow-list test, on its measured run-step count |
| L6 | a step `run: \|` holding `echo hi` and `npx playwright --version` | RED: the allow-list test, on its measured run-step count |
| L7 | the event-head `pending` step moves after `Read the current head` | RED: the allow-list's order |
| L8 | the verdict post's context becomes `operator-review-x` | RED: the allow-list, and three status posts |
| L9 | the job gains `name: operator-review` | RED: never a check run |
| L10 | `ci.yml`'s `checks` job gains `name: operator-review` | RED: never a check run, in another workflow |
| L11 | the verdict post gains `if: always()` | RED: stops at the first failure |
| L12 | the event-head `pending` step gains `continue-on-error: true` | RED: stops at the first failure |
| L13 | the job gains `continue-on-error: true` | RED: widens nothing |
| L14 | the relay drops `dismissed` | RED: submitted or dismissed |
| L15 | the relay's `permissions: {}` becomes `pull-requests: read` | RED: holds no permission |
| L16 | the relay gains a checkout step | RED: no action, and the existing *no checkout in any workflow leaves the job token in .git/config* (#395) |
| L17 | `runLinesOf` drops lines starting `gh ` | RED: the allow-list (a reader blind to one command) |
| L18 | `stepsOf` drops every step whose `run` spans lines | RED: the allow-list test, on the parser-against-text count (a reader blind to one form), and the capture's guards that read its block runs |

---

### Task 10: Nothing commits a rebaseline until the lock is required

**Files:**
- Modify: `scripts/visual-rebaseline.mjs` (`lockRequired`, `LOCK`, the `locked` command)
- Modify: `tests/unit/visual-rebaseline.test.ts`, `tests/unit/visual-rebaseline-cli.test.ts`, `tests/unit/script-entry.test.ts` (the command list)
- Modify: `.github/workflows/visual-rebaseline-commit.yml` (the `locked` step)
- Modify: `tests/unit/pipeline-wiring.test.ts` (the step's guard, and two measured counts)

**Interfaces:**
- Consumes: `getJson` and `report` (Task 4); the lock's name (Task 9).
- Produces: `lockRequired(branch: unknown): boolean` and `LOCK`; the command `locked`, which refuses by name unless `develop` requires the lock.

- [ ] **Step 1: Write the failing tests**

<!-- edit: tests/unit/visual-rebaseline.test.ts -->
```ts
  gateAgrees,
  qualify,
  testsIn,
  validateArtifact,
} from '../../scripts/visual-rebaseline.mjs';
```
```ts
  gateAgrees,
  lockRequired,
  qualify,
  testsIn,
  validateArtifact,
} from '../../scripts/visual-rebaseline.mjs';
```

<!-- append: tests/unit/visual-rebaseline.test.ts -->
```ts

/** `GET /branches/develop`, as a contents: read token read it (run 37112752013). */
const branchRequiring = (contexts: string[], checks: string[] = contexts) => ({
  name: 'develop',
  protected: true,
  protection: {
    enabled: true,
    required_status_checks: {
      enforcement_level: 'everyone',
      contexts,
      checks: checks.map((context) => ({ context, app_id: null })),
    },
  },
});

const MEASURED = ['build-and-test', 'visual', 'closing-keywords'];

describe('lockRequired: nothing commits until develop requires the lock (#459)', () => {
  it('reads it from contexts', () => {
    expect(
      lockRequired(branchRequiring([...MEASURED, 'operator-review'], MEASURED)),
    ).toBe(true);
  });

  it('reads it from checks alone', () => {
    expect(
      lockRequired(branchRequiring(MEASURED, [...MEASURED, 'operator-review'])),
    ).toBe(true);
  });

  it('refuses the branch as measured, which names it nowhere', () => {
    expect(lockRequired(branchRequiring(MEASURED))).toBe(false);
  });

  it('refuses a name that only begins like it', () => {
    expect(lockRequired(branchRequiring(['operator-review-old']))).toBe(false);
  });

  it('refuses a branch with protection off', () => {
    expect(
      lockRequired({
        name: 'develop',
        protected: false,
        protection: {
          enabled: false,
          required_status_checks: {
            enforcement_level: 'off',
            contexts: [],
            checks: [],
          },
        },
      }),
    ).toBe(false);
  });

  it('refuses a reply with no protection at all', () => {
    expect(lockRequired({ name: 'develop', protected: false })).toBe(false);
  });
});
```

<!-- edit: tests/unit/visual-rebaseline-cli.test.ts -->
```ts
      '::error::unknown command bogus; expected qualify, classify, stage, find or commit',
```
```ts
      '::error::unknown command bogus; expected qualify, classify, stage, find, locked or commit',
```

<!-- edit: tests/unit/script-entry.test.ts -->
```ts
    says: 'unknown command (none); expected qualify, classify, stage, find or commit',
```
```ts
    says: 'unknown command (none); expected qualify, classify, stage, find, locked or commit',
```

<!-- append: tests/unit/pipeline-wiring.test.ts -->
```ts

describe('the rebaseline commit refuses until develop requires the lock (#459)', () => {
  const steps = () => stepsOf(COMMIT) as JudgedStep[];
  const running = (command: string) =>
    steps().findIndex(
      ({ run }) =>
        withoutCommentLines(run ?? '', '#').trim() ===
        `node scripts/visual-rebaseline.mjs ${command}`,
    );

  it('asks before the download and before the commit', () => {
    const locked = running('locked');
    expect(locked, 'no step runs the locked command alone').toBeGreaterThan(0);
    const download = steps().findIndex(({ uses }) =>
      uses?.startsWith('actions/download-artifact@'),
    );
    expect(download).toBeGreaterThan(locked);
    expect(running('commit')).toBeGreaterThan(locked);
  });

  it('runs whenever the commit runs, and stops the job when it refuses', () => {
    const locked = steps()[running('locked')];
    const commit = steps()[running('commit')];
    expect(locked?.if).toBe(commit?.if);
    expect(String(locked?.if)).not.toMatch(/\b(?:always|failure|cancelled)\(/);
    expect(locked?.['continue-on-error']).toBeUndefined();
  });
});
```

The step now counts toward two measured figures in Task 7's guards:

<!-- edit: tests/unit/pipeline-wiring.test.ts -->
```ts
    // Measured: 2 (find, commit).
    expect(nodes.length).toBeGreaterThanOrEqual(1);
```
```ts
    // Measured: 3 (find, locked, commit).
    expect(nodes.length).toBeGreaterThanOrEqual(2);
```

<!-- edit: tests/unit/pipeline-wiring.test.ts -->
```ts
  [COMMIT]: 3,
```
```ts
  [COMMIT]: 4,
```

- [ ] **Step 2: Watch them fail**

Add `lockRequired` to `scripts/visual-rebaseline.mjs` as a throwing stub, then run:

Run: `npx vitest run tests/unit/visual-rebaseline.test.ts tests/unit/visual-rebaseline-cli.test.ts tests/unit/script-entry.test.ts tests/unit/pipeline-wiring.test.ts`
Expected: 12 failed, 337 passed (measured, plan review pass 10): the 6 `lockRequired` tests, the CLI's unknown command, both new wiring guards, and the script-entry probe's three runs of `visual-rebaseline.mjs` (from this checkout, through a path holding a space, through a symlink). The two moved floors still pass, since each is the new figure less one, which the old count meets; K24 below is what shows the step's absence going red.

- [ ] **Step 3: Write the check, the command and the step**

<!-- edit: scripts/visual-rebaseline.mjs -->
```js

// ---- I/O: everything below reads, writes or calls GitHub -------------------
```
```js

/** The required check that holds an automatic rebaseline's merge (Unit 4). */
export const LOCK = 'operator-review';
const BASE = 'develop';

/**
 * Whether a branch, as `GET /branches/{branch}` returns it, requires the
 * lock among its required status checks, in `contexts` or in `checks`.
 * Anything else, a branch with no protection included, reads as not
 * required, which refuses.
 * @param {unknown} branch
 * @returns {boolean}
 */
export function lockRequired(branch) {
  const required =
    /** @type {{ protection?: { required_status_checks?: { contexts?: unknown, checks?: unknown } } } | null} */ (
      branch
    )?.protection?.required_status_checks;
  const contexts = Array.isArray(required?.contexts) ? required.contexts : [];
  const checks = Array.isArray(required?.checks) ? required.checks : [];
  return (
    contexts.includes(LOCK) ||
    checks.some(
      /** @param {{ context?: unknown } | null} check */
      (check) => check?.context === LOCK,
    )
  );
}

// ---- I/O: everything below reads, writes or calls GitHub -------------------
```

<!-- edit: scripts/visual-rebaseline.mjs -->
```js
/**
 * @param {readonly string[]} [args]
 */
export async function main(args = argv.slice(2)) {
```
```js
async function runLocked() {
  const branch = await getJson(`/branches/${BASE}`);
  if (!lockRequired(branch))
    throw new Error(
      `${BASE} does not require ${LOCK} yet, so nothing commits a ` +
        'rebaseline; the operator requires the check first (#459)',
    );
  report(`${BASE} requires ${LOCK}.`);
}

/**
 * @param {readonly string[]} [args]
 */
export async function main(args = argv.slice(2)) {
```

<!-- edit: scripts/visual-rebaseline.mjs -->
```js
    else if (command === 'find') await runFind();
    else if (command === 'commit') await runCommit();
    else
      throw new Error(
        `unknown command ${command ?? '(none)'}; expected qualify, classify, stage, find or commit`,
      );
```
```js
    else if (command === 'find') await runFind();
    else if (command === 'locked') await runLocked();
    else if (command === 'commit') await runCommit();
    else
      throw new Error(
        `unknown command ${command ?? '(none)'}; expected qualify, classify, stage, find, locked or commit`,
      );
```

<!-- edit: .github/workflows/visual-rebaseline-commit.yml -->
```yaml
        run: node scripts/visual-rebaseline.mjs find
      - name: Download it into an empty directory
```
```yaml
        run: node scripts/visual-rebaseline.mjs find
      # Until develop requires operator-review, a rebaseline is captured and
      # uploaded but never committed: only the lock holds its merge (#459).
      - name: Refuse unless develop requires operator-review
        if: steps.find.outputs.present == 'true'
        env:
          GITHUB_TOKEN: ${{ github.token }}
        run: node scripts/visual-rebaseline.mjs locked
      - name: Download it into an empty directory
```

<!-- edit: .github/workflows/visual-rebaseline-commit.yml -->
```yaml
# dispatches ci.yml on the branch, since a push made with this token starts
# no workflow, and labels the pull request for the operator's review. No
# agent merges it before the operator has approved the PNG diff (CLAUDE.md).
```
```yaml
# dispatches ci.yml on the branch, since a push made with this token starts
# no workflow, and labels the pull request. It commits nothing until develop
# requires operator-review, which then holds the merge until the operator
# approves the PNG diff at the new head (operator-review.yml).
```

- [ ] **Step 4: Watch them pass, then run everything**

Run: `npx vitest run && npx astro check && npx prettier --check .`
Expected: green, `0 errors / 0 warnings / 0 hints`, clean.

- [ ] **Step 5: Commit, then mutate**

```bash
git add scripts/visual-rebaseline.mjs tests/unit .github/workflows/visual-rebaseline-commit.yml
git commit -m "visual-rebaseline: commit nothing until develop requires the lock (Refs #459)"
```

| # | Mutation | Predicted |
| --- | --- | --- |
| K17 | `lockRequired` reads `contexts` only | RED: checks alone |
| K18 | `lockRequired` reads `checks` only | RED: contexts |
| K19 | `contexts.includes(LOCK)` becomes `contexts.some((c) => String(c).startsWith(LOCK))` | RED: only begins like it |
| K20 | the `locked` step moves after the download | RED: asks before |
| K21 | the `locked` step's `if:` compares to `'false'` | RED: runs whenever the commit runs |
| K22 | the `locked` step gains `continue-on-error: true` | RED: stops the job |
| K23 | the `locked` step's `if:` gains `always() && ` | RED: runs whenever, and stops the job |
| K24 | the `locked` step runs `node scripts/visual-rebaseline.mjs locked \|\| true` | RED: asks before (no step runs it alone), runs whenever the commit runs, and Task 7's node guard |

---

### Task 11: Document, label, merge, deploy, and hand the lock to the operator

**Files:**
- Modify: `CLAUDE.md`
- Delete: `.github/workflows/probe-459.yml`, `.github/workflows/probe-459-relay.yml`

- [ ] **Step 1: Add the paragraph**

<!-- edit: CLAUDE.md -->
```markdown
- **The visual suite is opt-in, and both sides run the same pinned image.**
```
```markdown
- **A Dependabot Playwright update rebaselines itself, and a required check holds it for the operator (#459).** New browsers can move pixels while the site is unchanged. For a pull request Dependabot opened, from this repository, level with `develop`, whose diff is Playwright and nothing else (`scripts/visual-rebaseline.mjs`'s `qualify`), `visual-rebaseline.yml` reruns the gate in the gate's image and recaptures exactly the screenshots it failed on pixels alone. `visual-rebaseline-commit.yml` runs only `develop`'s code: it refuses until `develop` requires the lock, validates the upload down to each PNG's bytes, commits it as `github-actions[bot]` (fast-forward only), dispatches `ci.yml` there and labels the pull request `rebaseline-needs-review`. **The lock is the commit status `operator-review`**, which `operator-review.yml` posts on every pull request from `develop`'s copy (`scripts/operator-review.mjs` decides): `success` when no commit by `github-actions[bot]` touches a screenshot, and otherwise only once `ShydenMcM` has approved at the current head, so any later push holds it again. `operator-review-relay.yml` holds no permission and exists only because a review fires no `pull_request_target`. Making it a required check on `develop`, with no app pinned, is administration and so the operator's; until he has, nothing commits a rebaseline. An agent never posts that status, never approves in his place, and never merges past it. Any other update, Astro and fonts included, keeps a red `visual` for a person to diagnose (operator, 2026-10-03: _"we cannot afford to allow any visual bugs go unnoticed and unfixed"_).
- **The visual suite is opt-in, and both sides run the same pinned image.**
```

- [ ] **Step 1b: Hold the rule in memory too**

Write `~/.claude/projects/-Users-shyden-Developer-Repos-shyden-co-uk/memory/a-rebaseline-waits-for-the-operator.md` with frontmatter `name: a-rebaseline-waits-for-the-operator`, `type: feedback`, and this body: a pull request carrying an automatic rebaseline is held by the required check `operator-review` until the operator approves its PNG diff at the head; an agent never posts that status, never approves for him, never pushes to such a branch to move it along, and never merges past a red or missing check. **Why:** operator decision 4, 2026-10-03 (#459 comment 5967363108), after a side review found only a label and a sentence standing between a bot-written baseline and `develop`, while agents merge green pull requests there without asking; and his words, *"we cannot afford to allow any visual bugs go unnoticed and unfixed"*. **How to apply:** when `operator-review` is red or missing on a pull request, notify the operator with its link and move on to other work. Then add its one-line pointer to `MEMORY.md`.

- [ ] **Step 2: Retire the probe**

The probe merged in #460 measured the tokens this design rests on. Its rows are on #459 (comment 5967707811), and its last row, a Dependabot-triggered `pull_request_target`, is read before this merges (Step 6).

```bash
git rm .github/workflows/probe-459.yml .github/workflows/probe-459-relay.yml
```

- [ ] **Step 3: Run the whole gate and push**

Run: `npx prettier --check . && npx astro check && npx vitest run`
Expected: clean, `0 / 0 / 0`, green.

```bash
git add CLAUDE.md
git commit -m "CLAUDE.md: the visual rebaseline and the lock that holds it; retire the probe (Refs #459)"
git push -u origin 459-visual-rebaseline
```

- [ ] **Step 4: Create the label**

```bash
gh label create rebaseline-needs-review --color B60205 \
  --description "Visual baselines rebaselined automatically (#459); operator-review holds the merge for the operator"
gh label list --search rebaseline-needs-review
```

Expected: the list prints the label, read back after the write.

- [ ] **Step 5: Open the pull request and wait**

Write the body to `.superpowers/sdd/459/pr.md` with `Refs #459` and the attribution footer. Check it with `node scripts/closing-keywords.mjs .superpowers/sdd/459/pr.md "this pull request body"`, then run `gh pr create --base develop --body-file …`. Wait with `~/.claude/scripts/wait-run.sh` in a `run_in_background` call, then read every step by name with the run's SHA matched to `headRefOid`, which is read into a file.

- [ ] **Step 6: Merge only once Dependabot's own row is measured**

Read #459 for the probe's row from a pull request Dependabot opened (`.superpowers/sdd/459/probe-read.sh`, with `measure.sha` at that pull request's head). If it is not recorded yet, the pull request stays open until Dependabot's next run (Monday, 06:00 UTC) records it. If its `pull_request_target` run could not post a status (anything but HTTP 201), stop: a Dependabot pull request would never get its `success`, and the design goes back to the operator.

- [ ] **Step 7: Merge and deploy**

Merge with a merge commit. Wait for `deploy-dev.yml` on the merge, read each job by name, and read `dev-verified` off the commit.

- [ ] **Step 8: Hand the lock to the operator**

Requiring the check is administration, which the agent App holds read-only. Send a `PushNotification`, then ask with `AskUserQuestion`, the request stated in the question text itself: add `operator-review` to `develop`'s required status checks with no app pinned (any source), as `dev-verified` is, since the agent App's statuses access is read-only and it cannot post one at all (spec, Unit 4); until then the commit workflow refuses every rebaseline by name, which is the intended state. Once he says it is done, read `GET /branches/develop` and confirm the protection's checks list the lock, rather than trusting the answer. Task 12 starts only after that read.

---

### Task 12: Find a release that drifts, then prove the chain end to end

This task runs on the real runner after the merge. GitHub fires `workflow_run` only for a workflow on the default branch, and the dispatch needs `ci.yml`'s new trigger there too. It needs an open Dependabot pull request. Dependabot runs weekly, on Monday at 06:00 UTC, so the earliest is 2026-10-05. Every run ID is recorded on #459.

- [ ] **Step 1: Pick the pull request**

First confirm the lock is required: Task 11 Step 8's read of `GET /branches/develop` lists it. Until it does, the commit workflow refuses by name and nothing here can be proved.

`gh pr list --author app/dependabot --state open`. Pick one whose head is level with `develop`. If none is open, stop: write the handover, notify the operator, and resume after the next Dependabot run.

- [ ] **Step 2: Search for a drifting release, using the shipped capture**

On that branch, pushed as the App (so the PR author stays `dependabot[bot]`), make one commit that returns the PR's own change to `develop` and sets Playwright to a candidate:

```bash
git switch <dependabot-branch>
git checkout origin/develop -- package.json package-lock.json docker/playwright/Dockerfile
npm install --save-dev --no-audit --no-fund "@playwright/test@^<candidate>"
git diff --stat origin/develop
git commit -am "Proof (#459): Playwright <candidate>, measuring drift"
git push
```

`git diff --stat` must name only `package.json` and `package-lock.json`. The push runs `ci.yml` (as a pull request) and `Visual rebaseline capture`. The capture's `qualify` must report `Qualifies`. `playwright-image.mjs` resolves the candidate's noble digest, and `classify` reports whether the gate failed on pixels alone. Candidates are newest first: 1.58.2, 1.57.0, 1.56.1, 1.55.1, 1.54.2, 1.53.2, 1.52.0, 1.51.1, 1.50.1, 1.49.1, 1.48.2, 1.47.2, 1.46.1, 1.45.3, each the latest patch of its minor, with its noble digest resolved on 2026-10-03. Every run is recorded on #459 with its `classify` line. A candidate that fails on anything other than pixels (an older Playwright that cannot load today's config) is recorded as that and skipped.

If no candidate drifts, stop. Notify the operator and ask how to proceed before building any proof.

- [ ] **Step 3: The positive proof**

The first drifting candidate is the proof. On its capture run the commit workflow must, in order:

1. push a commit to the Dependabot branch;
2. dispatch `ci.yml` there;
3. have the dispatched run's checks accepted by branch protection: on the new head every required check but the lock reads `success`, and `gh pr view <n> --json mergeStateStatus` reads `BLOCKED`, because the new head carries no `operator-review` (a push made with `GITHUB_TOKEN` starts no `pull_request_target`).

Also confirm that the PR shows the PNG diff, the label and the comment. If any of the three fails, stop and take it to the operator.

- [ ] **Step 3b: The lock**

On the same pull request, in order, recording each status read off the head:

1. An App approval (`gh pr review <n> --approve`) runs the relay, then `operator-review.yml`, which posts `failure`, "Waiting for the operator to approve the rebaseline at <sha7>": an agent's approval releases nothing.
2. Ask the operator (a `PushNotification`, then `AskUserQuestion` naming the pull request and its head, read from the API in the same turn) to review the PNG diff and approve it if it is right. His approval turns the status `success`, and `mergeStateStatus` reads `CLEAN`. The approval proves the lock, not a merge: the pull request carries a downgrade and is never merged.
3. The negative proof's next push (Step 4) moves the head, and `operator-review` reads `pending` there, then `failure`.

Separately, the next pull request an agent opens gets `success`, "No automatic rebaseline in this pull request".

- [ ] **Step 4: The negative proofs**

On the same pull request, one commit that also changes a source file gets `No rebaseline: it changes more than dependencies`. One that groups Playwright with `@fontsource-variable/instrument-sans` 5.2.4 gets `package-lock.json changes node_modules/@fontsource-variable/instrument-sans`, and its `visual` stays red.

- [ ] **Step 5: Dependabot as the actor**

Comment `@dependabot recreate`. Dependabot rebuilds the pull request from scratch and discards the proof's commits. The capture then runs under Dependabot's own restricted token and ends green, qualifying or not as the rule decides for the rebuilt diff, and `operator-review.yml`, started by Dependabot's `pull_request_target`, posts `success` on the rebuilt head, which carries no rebaseline. Record both runs, then retire #459 with `gh issue close 459` once every AC is evidenced on it.

---

## Review log

| Pass | Findings |
| --- | --- |
| 1 | Assembled and run (`.superpowers/sdd/459/pass.sh`): prettier wanted 75 hunks (every block now formatted in place by `format_blocks.py`); 8 meta-guards refused the code: an absence with no population, a duplicated walker, two private directory walkers and a private caught-message reader (one-home), `image`/`capture` relying on implicit `success()` (#157), the `import.meta.main` inventory, consecutive docblocks |
| 2 | Run clean (3508/3508, 0/0/0). Reading: V3 could never go red (the symlink fixture had no bytes, so another clause refused it); R4 predicted the wrong test; R2's prediction was left open, and reasoning it through showed no test could kill it (two comparisons in one test added) |
| 3 | 46 mutations run, all RED for the predicted test, totals steady. Reading the spec against the plan: the hash-for-`git diff` deviation was unstated; the comment paraphrased the spec's line; the memory half of the review rule was missing; five forms were never planted (K12-K16); K13's first draft carried an invented SHA |
| 4 | Run clean, K12-K16 RED as predicted. Counts measured by assembling through each task: 23, 47, 83, 90, where the plan said 48, 86, 93, and the CLI red run said 6 for 7 |
| 5 | Reading the prose whole: Task 1's mutation step came before its commit; Task 4's interfaces omitted `entriesUnder`; C4 and W12 ran but had no rows. Running each task's intermediate state (not only the finished assembly): through Tasks 4 and 5 green, through Task 6 one red. The capture's comment named `visual-rebaseline-commit.yml` a task before it exists, which *no workflow names a workflow file that does not exist* refuses, so Task 7 now adds the name |
| 6 | Run clean, and the whole suite green at every intermediate state (through Tasks 4, 5, 6 and 7: 3489, 3489, 3499, 3508). Reading the whole prose, then measuring each red-run claim by rebuilding its state: Task 6's narrowed guard fails on its floor (8 of 9 workflows), not on `[]` as written; Task 7's claim held exactly |
| 7 | None. Run clean (3508/3508, 0/0/0, prettier clean); the assembled code is byte-identical to pass 6's (`git diff` empty), so its mutations and intermediate states stand; the whole prose read. **Approved 2026-10-03** (operator rule 2026-09-24: reviewed to zero, then self-approved). |
| 8 | After decision 4 (spec passes 19-24): Tasks 8-10 added (the verdict, the lock's workflows, the `locked` step), Task 11 rewritten (the lock in `CLAUDE.md` and memory, the probe retired, the merge waiting on Dependabot's own row, requiring the check handed to the operator), Task 12 given the lock's proof and `BLOCKED` before approval. The branch merged `develop` (b839ff8, which brought the probe's two files) and `pass.sh` now assembles onto it, copies this plan into the scratch tree (the suite's guards read prose) and deletes the probe as Task 11 does. Run clean (3543/3543, 0/0/0, prettier clean), counts as expected (15, 89, 122, 131). 34 new mutations, all RED for the predicted test with steady totals. Findings: the allow-list test's raw-count cross-check sat after the exact list, so no blind reader could ever reach it (L6's prediction was unreachable); L1, L16 and K24 predicted fewer tests than went red; Task 3's comment and commit message still carried the process rule; Task 6's workflow floor and Task 7's shared no-retry floor were no longer tight. `producibleContexts` cannot see a status posted from a script, so the workflow posts it (a stated departure). |
| 9 | Run clean (3543/3543, 0/0/0). The cross-check now runs first: L18 (a reader blind to block-form runs) went RED on it, `expected 5 to be 6`, and L6 on the measured count, `7` for `6`; all 23 wiring mutations RED as predicted. |
| 10 | Every intermediate state rebuilt and run whole (`states.py`): green through Tasks 7, 8, 9 and 10 (3508, 3526, 3535, 3543). Each red-run claim rebuilt from its own state: Tasks 7, 8 and 9 held (8/112, 15, 9/120), but Task 6's floor message now reads `10` for `11` (the probe's two files) and Task 10 fails 12, not 10 (the script-entry probe runs each script three ways). Reading the new tasks' prose whole: Task 11 gave the wrong reason for no app pinned (the spec's is that the agent App cannot post a status); O9's row named one probe run of three |
| 11 | Run clean (3543/3543, 0/0/0); assembled code byte-identical to pass 9's. Reading the whole plan: Task 7's per-file no-retry floors had never been seen red on the commit side (L18 blinds only block-form runs, which the commit workflow has none of), so K25 blinds the reader entirely. Every mutation in the plan, the 52 from passes 1-7 and the 35 since, run against the final assembly: 87 of 87 RED for the predicted tests, totals steady per file (89, 7, 131, 15, 122), every file restored; K25 failed seven guards, both floors among them |
