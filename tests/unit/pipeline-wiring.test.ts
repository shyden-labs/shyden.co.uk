import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import {
  codeWithoutComments,
  withoutCommentLines,
  withoutTsComments,
} from './source-text';
import { nonEmpty, searched, trackedFiles } from '../source-files';
import type { Project } from '@playwright/test';
import playwrightConfig, {
  VISUAL_MEASURE_PROJECT,
  VISUAL_PROJECT,
} from '../../playwright.config';
import {
  checkoutSteps,
  inheritedPermissionsFindings,
  jobsDownstreamOfAConditionalJob,
  parseCleanYaml,
  skippedUpstreamFindings,
  producibleContexts,
  unboundedJobFindings,
  workflowJobs,
  workflowLevelWrites,
  type DeclaredPermissions,
  type WorkflowJob,
} from '../workflow-jobs';
import { parseFile } from './ast';
import { declarationsIn } from '../playwright-declarations';
import { REQUIRED_CHECKS } from '../../scripts/deploy-gate.mjs';
import { localImage } from '../../scripts/playwright-image.mjs';
import { stringLeaves } from '../../src/lib/catalogue-leaves';

/**
 * The plain `test(...)` declarations `spec` makes, read by the parser. A test
 * commented out, or spelled inside a string, is not one: counting `test(` in
 * the raw text counted both (#218).
 */
const plainTestsIn = (spec: string) =>
  declarationsIn(parseFile(spec)).filter(
    ({ kind, modifier }) => kind === 'test' && modifier === '',
  );

/**
 * The deploy pipeline is wired to the things it claims to run.
 *
 * This file exists because of a real, shipped gap: `tests/dev/dev-sanity.spec.ts`
 * and `playwright.dev.config.ts` were both written to verify the deployed dev
 * site — nine tests, both locales, the tool actually shuffling students — and
 * **nothing in CI ever referenced either of them**. "Deployed to dev" meant
 * only that `wrangler` had not errored. A dev deploy serving a blank page
 * would have gone green.
 *
 * A test suite nobody runs is worse than no suite: it reads as coverage. The
 * checks below are cheap, and each one names a way that could happen again.
 *
 * SOURCE TEXT where the question is whether a filename or a job name APPEARS,
 * which comment-stripped text answers exactly. PARSED YAML where the question
 * is the job graph — what a job needs and what its condition says — which text
 * cannot answer: see tests/workflow-jobs.ts, and #157 for the job that line
 * matching let ship un-runnable.
 */

const WORKFLOWS = '.github/workflows';
const workflow = (name: string) => readFileSync(join(WORKFLOWS, name), 'utf8');

/**
 * A workflow's text with its COMMENT LINES REMOVED.
 *
 * Every check below asks whether the pipeline DOES something. A `#` line
 * saying it does is prose, and prose is exactly what these files are full
 * of. Found by mutation: the first version of the dev-sanity check searched
 * raw text, and pointing the run step at a different config left it green --
 * because this file's own comment explaining the fix still contained the
 * filename it was looking for.
 */
const runnableText = (text: string) => withoutCommentLines(text);

const workflowSteps = (name: string) => runnableText(workflow(name));

/**
 * A workflow's `on:` block alone, comment-stripped.
 *
 * Scoped to the block because an absence assertion over the whole file is
 * answered by any `branches:` anywhere in it, and stripped because ci.yml's own
 * prose names `develop` and `main` -- a raw read would be satisfied by the
 * documentation describing the bug (#23, #21, #35, #49, #129).
 */
const onBlock = (name: string) =>
  workflowSteps(name).match(/^on:\n([\s\S]*?)(?=^\S)/m)?.[1] ?? '';

/**
 * The workflow filenames, proved non-empty (#84).
 *
 * Three guards in this file assert ABSENCE over this list -- `release.yml`
 * is gone, no dangling workflow reference, no default-config bypass -- and
 * one empty read satisfies all three at once.
 */
const workflowFileNames = (): string[] =>
  nonEmpty(readdirSync(WORKFLOWS), `workflow files in ${WORKFLOWS}`);

const isYaml = (file: string): boolean =>
  file.endsWith('.yml') || file.endsWith('.yaml');

const workflowYamlNames = (): string[] => workflowFileNames().filter(isYaml);

/**
 * Every workflow file `raw` names, comments included: in a workflow a
 * comment explaining the pipeline is part of what is checked (`ci.yml` once
 * explained itself in terms of a deleted `deploy.yml`).
 */
const workflowRefs = (raw: string): string[] =>
  [...raw.matchAll(/\b([\w.-]+\.ya?ml)\b/g)].map(([, ref]) => ref);

/** What a workflow calls itself: the Actions UI, and `github.workflow`. */
const workflowName = (file: string): string => {
  const root = parseCleanYaml(workflow(file), file) as { name?: unknown };
  return typeof root.name === 'string' ? root.name : file;
};

/** Putting built bytes on an environment — what makes a workflow a deploy. */
const DEPLOY_COMMAND = 'wrangler pages deploy';

/** Text a human reads, which is where a wrong instruction becomes an action. */
const READABLE = /\.(md|ya?ml|ts|tsx|mjs|js|astro|sh)$/;

/** A backticked span: the form every context in this repo's prose is written in. */
const TICKED = /`([^`\n]+)`/g;

/**
 * How far before the anchor a claim may sit. A context is named right beside
 * `required_status_checks.contexts` — "X is added to Y", "X joins Y" — and a
 * wider window starts reading unrelated spans as claims. Measured: the
 * `-f context=<name>` docblock in `workflow-jobs.ts` sits about 80 characters
 * before its own mention of the anchor, so 80 would flag correct code.
 */
const CLAIM_WINDOW = 40;

/**
 * Every context this repository's prose names as belonging in
 * `required_status_checks.contexts`: the backticked span immediately before
 * the anchor, when it is close enough to be part of the same sentence.
 *
 * Prose is the medium the operator acts on, so a claim is read where he reads
 * it. The anchor's own span is not a claim about itself, and a docblock
 * boundary or a blank line in the gap means the two spans sit in different
 * sentences entirely.
 */
const contextClaimsIn = (text: string): string[] => {
  const spans = [...text.matchAll(TICKED)];
  const claims: string[] = [];
  spans.forEach((span, index) => {
    if (!span[1].includes('required_status_checks')) return;
    const before = spans[index - 1];
    if (before === undefined) return;
    const from = (before.index ?? 0) + before[0].length;
    const gap = text.slice(from, span.index ?? 0);
    if (gap.length > CLAIM_WINDOW) return;
    if (gap.includes('*/') || /\n\s*\n/.test(gap)) return;
    claims.push(before[1]);
  });
  return claims;
};

const allWorkflows = () =>
  workflowYamlNames().map((f) => ({
    name: f,
    text: runnableText(workflow(f)),
  }));

/** One job of a workflow, parsed, naming itself in the failure when missing. */
const jobNamed = (file: string, id: string): WorkflowJob => {
  const job = workflowJobs(workflow(file), file).find((each) => each.id === id);
  expect(job, `${file} defines no job '${id}'`).toBeDefined();
  return job!;
};

/** Every workflow's jobs, parsed, beside the file they came from. */
const workflowGraphs = () =>
  workflowYamlNames().map((name) => ({
    name,
    jobs: workflowJobs(workflow(name), name),
  }));

// The two constructs that change what prod serves: a wrangler deploy to the
// prod Pages project, and a rollback through the Pages API on it. The name
// must END at `shyden-site`, so `shyden-site-dev` is not prod.
const deploysProd = (scripts: string) =>
  /--project-name[= ]+shyden-site(?![\w.-])/.test(scripts);
const rollsProdBack = (scripts: string) =>
  /\/pages\/projects\/shyden-site(?![\w.-])/.test(scripts) &&
  /\/rollback\b/.test(scripts);
// Reading the production reports count (#349): the script's count mode, with
// no argument, as a whole command line. A shell comment naming it is not a
// reader, and neither is `report-failure`, which never reads Cloudflare.
const countsWaitingReports = (scripts: string) =>
  /^[ \t]*node scripts\/waiting-reports\.mjs[ \t]*$/m.test(scripts);
/** The two secrets `reports-count` holds, sorted as `WorkflowJob.secrets` is. */
const REPORTS_COUNT_SECRETS = [
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_D1_READ_TOKEN',
];

/** The job block owning `needle`, from a workflow's comment-stripped text. */
const jobBlockRunning = (yaml: string, needle: string): string => {
  const stripped = withoutCommentLines(yaml);
  const lines = stripped.split('\n');
  const starts = lines
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => /^ {2}[A-Za-z][\w-]*:\s*$/.test(line))
    .map(({ i }) => i);
  const blocks = starts.map((start, n) =>
    lines.slice(start, starts[n + 1] ?? lines.length).join('\n'),
  );
  const owning = blocks.filter((block) => block.includes(needle));
  expect(
    searched(owning, { of: blocks, what: 'job blocks in the workflow' }),
  ).toHaveLength(1);
  return owning[0];
};

describe('the deploy pipeline runs what it claims to', () => {
  it('some workflow actually runs the dev sanity suite', () => {
    const runners = allWorkflows().filter((w) =>
      w.text.includes('--config=playwright.dev.config.ts'),
    );
    expect(
      runners.map((w) => w.name),
      'playwright.dev.config.ts is referenced by no workflow — the dev site is deployed and never verified, which is exactly the gap this file was written for',
    ).not.toEqual([]);
  });

  it('the dev sanity suite exists and is more than a stub', () => {
    // A guard that only checked the workflow REFERENCES the config would pass
    // against an emptied suite.
    // Measured 15 plain tests in dev-sanity.spec.ts on 2026-10-03 (#446).
    // Stated tight, so a reader that comes back one short fails.
    expect(plainTestsIn('tests/dev/dev-sanity.spec.ts').length).toBeGreaterThan(
      14,
    );
  });

  it('the dev deploy is gated on a gate that SUCCEEDED, never on one that skipped', () => {
    const deploy = jobNamed('deploy-dev.yml', 'deploy-dev');
    expect(deploy.needs).toEqual(['gate', 'test']);

    // Exactly one of the two gates runs per event, so the other is ALWAYS
    // skipped. `!failure() && !cancelled()` alone is therefore satisfied by a
    // run where BOTH skipped — absent evidence reading as a pass, which is the
    // shape of every defect this file exists for (#146, #157). One of them has
    // to have actually succeeded. Pinned EXACTLY on deploy-dev's OWN parsed
    // condition: the whole-file substring match this replaced was satisfied by
    // any job's, and a substring would still accept `always() || …`.
    expect(deploy.condition).toBe(
      "!failure() && !cancelled() && (needs.gate.result == 'success' || needs.test.result == 'success')",
    );
  });

  it('verifies a deploy that succeeded although a gate upstream of it skipped (#157)', () => {
    // Shipped with no condition, this job inherited an implicit `success()`
    // that the runner judges over EVERY upstream job. One gate skips on every
    // event by design, so it skipped on every run: 866bc23 deployed and was
    // never verified (run 34742940098). Pinned exactly: the rule below accepts
    // any condition of the right shape, and this is the one the runner was
    // measured running after a skipped gate (run 34743720266).
    const verify = jobNamed('deploy-dev.yml', 'verify-dev');
    expect(verify.needs).toEqual(['deploy-dev']);
    expect(verify.condition).toBe(
      "!cancelled() && needs.deploy-dev.result == 'success'",
    );
  });

  it('no job in any workflow is silently skipped by a skip upstream of it (#157)', () => {
    const graphs = workflowGraphs();
    const downstream = graphs.flatMap(({ name, jobs }) =>
      jobsDownstreamOfAConditionalJob(jobs).map(
        ({ job }) => `${name} ${job.id}`,
      ),
    );
    const findings = graphs.flatMap(({ name, jobs }) =>
      skippedUpstreamFindings(jobs).map((finding) => `${name}: ${finding}`),
    );
    expect(
      searched(findings, {
        of: downstream,
        what: 'jobs downstream of a conditional job',
      }),
    ).toEqual([]);
  });

  it('the push path proves the tree instead of re-running the suite', () => {
    const dev = workflowSteps('deploy-dev.yml');
    const gate = jobBlockRunning(dev, 'scripts/deploy-gate.mjs');
    expect(gate).toContain("if: github.event_name == 'push'");
    // The gate reads parents and trees; a shallow clone would make it refuse
    // for want of objects rather than for want of evidence.
    expect(gate).toContain('fetch-depth: 0');
    // check-runs live behind their own scope; without it the API 404s and the
    // gate refuses every deploy.
    expect(gate).toContain('checks: read');
  });

  it('a dispatched branch still runs everything, because it has no tested parent', () => {
    // `workflow_dispatch` puts an ARBITRARY branch on dev. It has no second
    // parent and no PR checks, so there is nothing for the tree gate to verify.
    // Dropping this path would quietly remove a documented capability.
    const dispatch = jobNamed('deploy-dev.yml', 'test');
    expect(dispatch.uses).toBe(CI_WORKFLOW);
    expect(dispatch.condition).toBe("github.event_name != 'push'");
  });

  it("the dispatch path runs the merge path's own workflow, so the two cannot drift", () => {
    // A push deploys because `ci.yml`'s `build-and-test` passed on the tree,
    // and the gate reads that conclusion, never the work behind it. A
    // dispatched branch has no such conclusion, so it runs the suite itself.
    // Until #163 it ran a COPY of build-and-test's steps, which this test held
    // equal (#157). Sharding split those steps across three jobs, and a copy
    // of three jobs is three chances to drift, so the dispatch path now CALLS
    // ci.yml: the suite a dispatched branch runs is, by construction, the
    // suite the merge gate believes a pull request passed.
    const ci = parseCleanYaml(workflow('ci.yml'), 'ci.yml') as {
      on?: Record<string, unknown>;
    };
    // The whole trigger set, exactly: callable, and still nothing else.
    expect(Object.keys(ci.on ?? {}).sort()).toEqual([
      'pull_request',
      'workflow_call',
    ]);
    expect(jobNamed('deploy-dev.yml', 'test').uses).toBe(CI_WORKFLOW);
  });

  it('the dispatch path grants the workflow it calls every permission its jobs ask for', () => {
    // A called workflow's token can only be narrowed, never widened: a job in
    // ci.yml asking for a scope its caller did not grant makes GitHub refuse
    // the whole run at startup. The merge path never shows it, because a pull
    // request's run is not called, so the refusal would surface the first day
    // somebody needs the escape hatch.
    type Permissions = Record<string, string>;
    const ci = parseCleanYaml(workflow('ci.yml'), 'ci.yml') as {
      permissions?: Permissions;
      jobs: Record<string, { permissions?: Permissions }>;
    };
    const dev = parseCleanYaml(
      workflow('deploy-dev.yml'),
      'deploy-dev.yml',
    ) as {
      jobs: Record<string, { permissions?: Permissions }>;
    };
    const granted = dev.jobs.test?.permissions ?? {};
    const LEVEL: Record<string, number> = { none: 0, read: 1, write: 2 };
    const asked = [
      ci.permissions ?? {},
      ...Object.values(ci.jobs).map((job) => job.permissions ?? {}),
    ].flatMap((each) => Object.entries(each));
    const refused = asked
      .filter(
        ([scope, level]) => LEVEL[granted[scope] ?? 'none'] < LEVEL[level],
      )
      .map(
        ([scope, level]) =>
          `ci.yml asks for ${scope}: ${level}, and the dispatch path grants ${granted[scope] ?? 'none'}`,
      );
    expect(
      searched(refused, { of: asked, what: 'permissions ci.yml asks for' }),
    ).toEqual([]);
  });

  // The merge gate. `dev-verified` has to be POSTED by something, or branch
  // protection requiring it blocks every PR forever.
  it('dev-verified is posted by the dev workflow', () => {
    const dev = workflowSteps('deploy-dev.yml');
    expect(dev).toContain('context=dev-verified');
    expect(dev).toContain('statuses: write');
  });

  it('prod-verified is posted by the prod workflow', () => {
    const prod = workflowSteps('deploy-prod.yml');
    expect(prod).toContain('context=prod-verified');
    expect(prod).toContain('statuses: write');
  });

  // Prod must deploy from `main`, never from a branch. Deploying before the
  // merge means production runs a commit that is on no permanent ref, and
  // `main` stops describing what is live.
  it('prod deploys from main, not from a dispatched branch alone', () => {
    const prod = workflowSteps('deploy-prod.yml');
    expect(prod).toMatch(/on:[\s\S]*?push:[\s\S]*?branches:\s*\[main\]/);
  });

  // Every job that deploys the prod project, with the environment it names,
  // read PARSED. A name is the whole name: the regex this replaced read
  // `name: prod` as a prefix, so a deploy moved into `prod-rollback`, which
  // has no reviewer, still passed it (#241, mutation W5).
  it('prod is behind the approval-gated environment', () => {
    const deploys = workflowGraphs().flatMap(({ name, jobs }) =>
      jobs
        .filter((job) => deploysProd(job.runs.join('\n')))
        .map(
          (job) =>
            `${name} ${job.id} in ${job.environment ?? 'no environment'}`,
        ),
    );
    expect(deploys).toEqual(['deploy-prod.yml deploy-prod in prod']);
  });

  // The placeholder guard cost two false-failed releases before it matched the
  // placeholder SHAPE rather than a bare `[[`, and before it skipped binaries.
  // Both fixes live in one line, and losing either is a release blocked for
  // nothing.
  it('the prod placeholder guard still skips binaries and matches a shape', () => {
    const prod = workflowSteps('deploy-prod.yml');
    expect(prod).toContain("grep -rnIE '\\[\\[[^]]{1,60}\\]\\]' dist/");
  });

  // Every page, every locale, and before a release as well as after one. The
  // smoke was a curl step in deploy-prod.yml with a hand-written path list,
  // held to LOCALES by a guard here, and it first met a build that was already
  // live: #370 took the company number off the site and the smoke went on
  // requiring it (#390). It is tests/prod/prod-smoke.spec.ts now, deriving its
  // routes, so the prod config's run carries it after a deploy and
  // `sanity-on-build` carries it on every pull request.
  it('the prod smoke is a spec in the suite that gates prod-verified', () => {
    expect(existsSync('tests/prod/prod-smoke.spec.ts')).toBe(true);
    expect(workflowSteps('deploy-prod.yml')).not.toMatch(/curl /);
  });

  // The deploy-before-merge workflow is GONE. It survived exactly one merge
  // -- the one that introduced its replacements, which could not otherwise
  // earn the `prod-verified` status branch protection then required. That
  // status is no longer required: the gate is `dev-verified`, posted before
  // the merge by deploy-dev.yml.
  //
  // Two pipelines both able to deploy prod, disagreeing about when, is worse
  // than either.
  it('the deploy-before-merge workflow is gone', () => {
    expect(workflowFileNames()).not.toContain('release.yml');
  });

  // …and exactly one workflow deploys prod on a PUSH, so a merge can never
  // start two prod deployments.
  it('only one workflow deploys prod on a push', () => {
    const pushers = allWorkflows().filter(
      (w) =>
        /on:[\s\S]*?push:/.test(w.text) &&
        w.text.includes('shyden-site --branch'),
    );
    expect(pushers.map((w) => w.name)).toEqual(['deploy-prod.yml']);
  });

  // ---- one lock around everything that changes what prod serves (#238) ----
  //
  // rollback.yml and deploy-prod.yml sat in different groups, so a release
  // still deploying could land after a rollback and undo it, with both runs
  // reporting success. Measured on the runner (#238 AC1): a run waiting at an
  // approval HOLDS its group, at workflow and at job level, and a newer arrival
  // cancels a run already waiting for it. So a rollback that merely queued
  // could wait on an approval nobody clicks, or be cancelled by the next push
  // to main. Shyden's decision (AC2): one group, and the rollback cancels
  // whatever holds it. Read PARSED: a commented-out block is no block.
  const PROD_LOCK = 'shyden-prod-publish';
  type ParsedWorkflow = {
    concurrency?: string | { group?: unknown; 'cancel-in-progress'?: unknown };
    jobs?: Record<string, { steps?: { run?: unknown }[] }>;
  };
  const parsedWorkflow = (name: string) =>
    parseCleanYaml(workflow(name), name) as ParsedWorkflow;
  const lockOf = ({ concurrency }: ParsedWorkflow) =>
    typeof concurrency === 'string' ? concurrency : concurrency?.group;
  const changesProd = ({ jobs }: ParsedWorkflow) => {
    const scripts = Object.values(jobs ?? {})
      .flatMap((job) => (job.steps ?? []).map((step) => String(step.run ?? '')))
      .join('\n');
    return deploysProd(scripts) || rollsProdBack(scripts);
  };

  it('a rollback cancels any prod release in flight, and a release waits for a rollback (#238)', () => {
    expect(parsedWorkflow('rollback.yml').concurrency, 'rollback.yml').toEqual({
      group: PROD_LOCK,
      'cancel-in-progress': true,
    });
    expect(
      parsedWorkflow('deploy-prod.yml').concurrency,
      'deploy-prod.yml',
    ).toEqual({
      group: PROD_LOCK,
      'cancel-in-progress': false,
    });
  });

  // A list of the lock's members would miss the next workflow that deploys
  // prod, so the members are DERIVED from what each workflow's steps run. And
  // nothing else may take the lock: a dev deploy inside it would be cancelled
  // by every prod rollback.
  it('every workflow that changes what prod serves takes the prod lock, and nothing else does (#238)', () => {
    const names = workflowYamlNames();
    const actors = nonEmpty(
      names.filter((name) => changesProd(parsedWorkflow(name))),
      'workflows whose steps deploy or roll back the prod Pages project',
    );
    const holders = names.filter(
      (name) => lockOf(parsedWorkflow(name)) === PROD_LOCK,
    );
    expect(holders, `the workflows holding ${PROD_LOCK}`).toEqual(actors);
  });

  // ---- each secret lives in the environment of the job reading it (#241) ----
  //
  // A repository secret reaches a workflow on any branch that can be pushed.
  // An environment secret reaches only a job that names its environment, and
  // `prod` and `prod-rollback` accept `main` alone. So the secrets are only as
  // well placed as the jobs that read them: once the repository copies are
  // deleted, a job naming no environment reads nothing, and a job naming the
  // wrong one reads another project's token. Read PARSED, per job
  // (tests/workflow-jobs.ts): a secret in a YAML comment is read by nothing,
  // and one in a shell comment inside `run:` is still expanded by the runner.
  const everyJob = () =>
    workflowGraphs().flatMap(({ name, jobs }) =>
      jobs.map((job) => ({ where: `${name} ${job.id}`, file: name, job })),
    );

  // GITHUB_TOKEN is not a repository secret: the runner mints it for each run,
  // scoped by the job's `permissions:`, so no environment can hold it.
  const storedSecrets = ({ secrets }: WorkflowJob) =>
    secrets.filter((secret) => secret !== 'GITHUB_TOKEN');

  it('every job that reads a secret other than GITHUB_TOKEN names an environment (#241)', () => {
    const readers = everyJob().filter(
      ({ job }) => storedSecrets(job).length > 0,
    );
    const unplaced = readers
      .filter(({ job }) => job.environment === undefined)
      .map(
        ({ where, job }) =>
          `${where} reads ${storedSecrets(job).join(', ')} in no environment`,
      );
    expect(
      searched(unplaced, {
        of: readers.map(({ where }) => where),
        what: 'jobs reading a secret other than GITHUB_TOKEN',
      }),
    ).toEqual([]);
  });

  // What a job does with the Cloudflare pair decides the environment it reads
  // them from, derived from its steps and never from the file's name. The dev
  // and prod tokens share one name, one per environment, so the environment
  // is the only thing choosing which project a job can reach. Reading the
  // production reports count changes nothing, and still has its own
  // environment and token (#349), so a job that reads it is a row here too.
  const CLOUDFLARE_ENVIRONMENTS = [
    {
      does: 'deploys shyden-site-dev',
      environment: 'dev',
      in: (scripts: string) =>
        /--project-name[= ]+shyden-site-dev(?![\w.-])/.test(scripts),
    },
    { does: 'deploys shyden-site', environment: 'prod', in: deploysProd },
    {
      does: 'rolls shyden-site back',
      environment: 'prod-rollback',
      in: rollsProdBack,
    },
    {
      does: 'reads the production reports count',
      environment: 'reports-count',
      in: countsWaitingReports,
    },
  ];

  it('a Cloudflare secret is read only in the environment of what its job does (#241, #349)', () => {
    const readers = everyJob().filter(({ job }) =>
      job.secrets.some((secret) => secret.startsWith('CLOUDFLARE_')),
    );
    const misplaced = readers.flatMap(({ where, job }) => {
      const acts = CLOUDFLARE_ENVIRONMENTS.filter((act) =>
        act.in(job.runs.join('\n')),
      );
      if (acts.length !== 1)
        return [
          `${where} reads Cloudflare secrets and ` +
            (acts.length === 0
              ? 'does nothing a Cloudflare environment is for'
              : acts.map(({ does }) => does).join(' and ')),
        ];
      const [{ does, environment }] = acts;
      return job.environment === environment
        ? []
        : [
            `${where} ${does}, so it reads Cloudflare secrets in ` +
              `${environment}, not ${job.environment ?? 'no environment'}`,
          ];
    });
    expect(
      searched(misplaced, {
        of: readers.map(({ where }) => where),
        what: 'jobs reading a Cloudflare secret',
      }),
    ).toEqual([]);
  });

  // `reports-count` holds a token that reads production's reports table, so
  // it holds exactly the count's two secrets, and nothing but the count reads
  // them. The rule above places a job by what it does; this one keeps the
  // environment from gaining a second tenant, or the token a second reader.
  it('only the waiting-reports count reads secrets in reports-count, or its token anywhere (#349)', () => {
    const jobs = everyJob();
    const strays = jobs.flatMap(({ where, job }) => {
      const inCount = job.environment === 'reports-count';
      const readsToken = job.secrets.includes('CLOUDFLARE_D1_READ_TOKEN');
      if (!inCount)
        return readsToken
          ? [`${where} reads CLOUDFLARE_D1_READ_TOKEN outside reports-count`]
          : [];
      const findings: string[] = [];
      if (!countsWaitingReports(job.runs.join('\n')))
        findings.push(`${where} is in reports-count and counts no reports`);
      const secrets = storedSecrets(job);
      if (secrets.join() !== REPORTS_COUNT_SECRETS.join())
        findings.push(
          `${where} reads ${secrets.join(', ') || 'nothing'} in ` +
            `reports-count, not ${REPORTS_COUNT_SECRETS.join(', ')}`,
        );
      return findings;
    });
    expect(
      searched(strays, {
        of: jobs.filter(({ job }) => job.environment === 'reports-count'),
        what: 'jobs in reports-count',
      }),
    ).toEqual([]);
  });

  // A prod job is any job in a workflow that changes what prod serves, and any
  // job in a prod environment. A secret meant for dev is named `DEV_*`, and
  // `dev` accepts every branch, because deploy-dev.yml puts feature branches
  // on dev on purpose. Anything it holds is only as private as the least
  // reviewed branch, so it never travels to prod.
  it('no job that deploys or verifies prod reads a secret meant for dev (#241)', () => {
    const prodJobs = everyJob().filter(
      ({ file, job }) =>
        changesProd(parsedWorkflow(file)) ||
        job.environment === 'prod' ||
        job.environment === 'prod-rollback',
    );
    const leaks = prodJobs.flatMap(({ where, job }) =>
      job.secrets
        .filter((secret) => secret.startsWith('DEV_'))
        .map((secret) => `${where} reads ${secret}`),
    );
    expect(
      searched(leaks, {
        of: prodJobs.map(({ where }) => where),
        what: 'jobs that deploy or verify prod',
      }),
    ).toEqual([]);
  });

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
  const stepCondition = (step: RollbackStep) =>
    String(step.if ?? '')
      .trim()
      .replace(/^\$\{\{([\s\S]*)\}\}$/, '$1')
      .trim();

  // A step's script as the runner runs it: bash with -eo pipefail and no
  // profile, given only the env named here. `https_proxy` points at a closed
  // port, so a script that reaches for the network fails on the spot rather
  // than calling Cloudflare.
  const runStep = (step: RollbackStep, env: Record<string, string>) => {
    const script = String(step.run ?? '');
    expect(script, `${step.name} runs no script`).not.toBe('');
    expect(script, 'an expression reaches a script through env').not.toMatch(
      /\$\{\{/,
    );
    const dir = mkdtempSync(join(tmpdir(), 'rollback-step-'));
    const outputs = join(dir, 'outputs');
    writeFileSync(outputs, '');
    try {
      const run = spawnSync(
        'bash',
        ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script],
        {
          encoding: 'utf8',
          timeout: 10_000,
          env: {
            PATH: process.env.PATH ?? '',
            https_proxy: 'http://127.0.0.1:9',
            HTTPS_PROXY: 'http://127.0.0.1:9',
            GITHUB_OUTPUT: outputs,
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

  // Off unless asked for: a dispatch that omits it, from the API or a hurried
  // click, rolls back as it always did.
  it('the rollback has a dry run, and it is off unless asked for (#241)', () => {
    expect(rollbackWorkflow().on?.workflow_dispatch?.inputs?.dry_run).toEqual(
      expect.objectContaining({ type: 'boolean', default: false }),
    );
  });

  it('the rollback checks its secrets first and skips only the promote on a dry run (#241)', () => {
    const steps = rollbackSteps();
    expect(
      steps.map((step) => `${step.name}: ${stepCondition(step) || 'always'}`),
    ).toEqual([
      'Check the secrets are set: always',
      'Find the deployment to roll back to: always',
      'Promote it: !inputs.dry_run',
    ]);
    // The call that changes what prod serves lives in the skipped step alone.
    expect(
      steps
        .filter((step) => /\/rollback\b/.test(String(step.run ?? '')))
        .map((step) => step.name),
    ).toEqual(['Promote it']);
  });

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
    const given = runStep(find, { ...credentials, TARGET_ID: id });
    expect(given.status, given.log).toBe(0);
    expect(given.outputs).toBe(`target=${id}\n`);
    // A path that climbs out of the project, a second output line, a space.
    for (const bad of ['../../dns_records', `${id}\ntarget=other`, 'a b']) {
      const run = runStep(find, { ...credentials, TARGET_ID: bad });
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

  // ---- the develop branching model ---------------------------------------
  //
  // `deploy-dev.yml` was DISPATCH-only, which made the dev deploy — and so the
  // `dev-verified` status gating `main` — a step someone had to remember. The
  // header comment gave a real reason: every PR branch deploying to one shared
  // dev environment means the last push wins, and `dev-verified` then describes
  // whichever branch happened to land last.
  //
  // An integration branch removes that competition by construction rather than
  // by discipline: exactly one branch deploys to dev, so "last push wins" is no
  // longer ambiguous — dev always shows develop's head, which is what it should
  // show.
  it('dev deploys automatically when develop moves', () => {
    const dev = workflowSteps('deploy-dev.yml');
    expect(dev).toMatch(/on:[\s\S]*?push:[\s\S]*?branches:\s*\[develop\]/);
  });

  // The dispatch escape hatch stays: deploying an arbitrary branch to dev is a
  // real capability worth keeping.
  it('the dispatch escape hatch survives', () => {
    const dev = workflowSteps('deploy-dev.yml');
    expect(dev).toMatch(/workflow_dispatch:/);
  });

  // …but an UNGUARDED dispatch would hand any feature branch a `dev-verified`
  // status, which is exactly what branch protection on `main` requires. That
  // branch could then open a PR straight into `main` and satisfy the gate
  // without ever passing through `develop` — the bypass this whole model
  // exists to prevent. Deploy and test on any ref; publish the STATUS only for
  // develop.
  it('dev-verified is only posted for develop', () => {
    const dev = workflowSteps('deploy-dev.yml');
    const post = dev.indexOf('/statuses/');
    expect(post, 'no dev-verified status step found').toBeGreaterThan(-1);
    const step = dev.slice(Math.max(0, post - 900), post);
    expect(step).toMatch(/if:.*github\.ref_name\s*==\s*'develop'/);
  });

  // `ci.yml` had a bare `pull_request:` — every PR, whatever its base. That
  // happened to be correct while `main` was the only long-lived branch, and
  // silently stays correct here, which is the problem: nothing records that
  // `build-and-test` is required on BOTH bases. Name them, so removing one is
  // a red test rather than a quiet hole in the gate.
  it('CI runs on a pull request into ANY base, not just develop and main', () => {
    // #144, measured: PR #143 was stacked on `17-aurora`, matched no workflow
    // trigger, ran ZERO checks -- and still reported `mergeStateStatus: CLEAN`.
    // An empty check list is indistinguishable at a glance from "CI passed",
    // which is this repo's recurring class arriving in a medium where there is
    // no step at all to read.
    //
    // Naming the bases here was meant to record which ones are REQUIRED. That
    // is a fact about branch protection and is not expressible by a trigger;
    // encoding it here bought documentation at the cost of coverage.
    const on = onBlock('ci.yml');

    // Liveness first: an empty block would make the absence below vacuous.
    expect(on, 'the on: block could not be read at all').toContain(
      'pull_request:',
    );
    expect(
      on,
      'a base filter makes every other base a gate-free zone by construction',
    ).not.toContain('branches:');
  });

  it('names the job that branch protection has to require', () => {
    // The other half of the control, and the half no diff shows: a suite that
    // runs proves it DETECTS, only `required_status_checks.contexts` proves it
    // STOPS anything. Renaming this job silently de-gates develop and main,
    // because protection matches a context by NAME (#33).
    expect(workflowSteps('ci.yml')).toContain('build-and-test:');
  });

  // #284: the other half of #33's lesson. Protection matches a context by
  // NAME, so a name nothing reports is not a weak gate — it is a branch that
  // can never merge again, repairable only by an administrator. Both sides
  // are derived: what the workflows can report, and what the prose claims.
  it('documents only a context something in this repository can report', () => {
    const producible = new Set(
      workflowYamlNames().flatMap((file) =>
        producibleContexts(workflow(file), file),
      ),
    );

    const claims = trackedFiles((path) => READABLE.test(path)).flatMap((file) =>
      contextClaimsIn(readFileSync(file, 'utf8')).map((context) => ({
        file,
        context,
      })),
    );

    const findings = claims
      .filter(({ context }) => !producible.has(context))
      .map(
        ({ file, context }) =>
          `${file} tells the operator to require \`${context}\`, which no job ` +
          `and no status in this repository reports`,
      );

    expect(
      searched(findings, {
        of: claims.map(({ context }) => context),
        what: 'contexts this repository documents as required',
      }),
    ).toEqual([]);
  });

  // #284, operator: "if you're deploying to dev, say you're deploying to dev.
  // it's not a release." A release is the version, tag and change notes
  // `release-tag.yml` cuts. Putting built bytes on an environment is a
  // deploy, and calling one a release reads as the sign-off gate having been
  // bypassed. Derived from what a workflow DOES, so a third environment is
  // covered the day it is added rather than when someone remembers this.
  it('never calls a deploy a release', () => {
    const deploys = workflowYamlNames().filter((file) =>
      workflowJobs(workflow(file), file).some((job) =>
        job.runs.some((run) =>
          withoutCommentLines(run).includes(DEPLOY_COMMAND),
        ),
      ),
    );

    const findings = deploys
      .filter(
        (file) => /release/i.test(file) || /release/i.test(workflowName(file)),
      )
      .map(
        (file) =>
          `${file} deploys, so neither it nor its name: may say release`,
      );

    expect(
      searched(findings, {
        of: deploys,
        what: `workflows running \`${DEPLOY_COMMAND}\``,
      }),
    ).toEqual([]);
  });

  // #237: a push to an open pull request started a fresh run and left the
  // superseded one spending about 30 runner-minutes on a head that could no
  // longer merge (35336492915 and 35335647213 were cancelled by hand). Read
  // PARSED: a commented-out block is no block, whatever its text says.
  it("a push cancels its own pull request's superseded CI run, never another's (#237)", () => {
    const ci = parseCleanYaml(workflow('ci.yml'), 'ci.yml') as {
      on?: Record<string, unknown>;
      concurrency?: { group?: unknown; 'cancel-in-progress'?: unknown };
    };

    // The group's pull request number is empty on any other event, and an
    // empty key is one group for every run: a second trigger would let a run
    // on one branch cancel a run on another. So a trigger other than a pull
    // request is allowed only because the key falls back to the run's own id,
    // a group of one that cancels nothing. The one such trigger is
    // `workflow_call`, the dispatch path running this suite (#163).
    expect(
      Object.keys(ci.on ?? {}).sort(),
      'a trigger besides pull_request needs a key no other run shares',
    ).toEqual(['pull_request', 'workflow_call']);

    // Exactly these two, in any order. Every workflow in the repo shares one
    // namespace of groups, so the key names this workflow; it names the pull
    // request, so a push never cancels another PR's run, and a run with no
    // pull request falls back to its own id; and it names nothing finer,
    // because a key per commit puts each push in a group of its own and
    // cancels nothing at all.
    const keyedBy = [
      ...String(ci.concurrency?.group ?? '').matchAll(/\$\{\{\s*(.+?)\s*\}\}/g),
    ].map((match) => match[1]);
    expect(
      [...keyedBy].sort(),
      `ci.yml's concurrency group is keyed by [${keyedBy.join(', ')}]`,
    ).toEqual([
      'github.event.pull_request.number || github.run_id',
      'github.workflow',
    ]);
    expect(ci.concurrency?.['cancel-in-progress']).toBe(true);
  });

  // RAW text on purpose — the opposite of every other check in this file.
  //
  // Elsewhere a comment claiming the pipeline does something is prose to be
  // stripped. Here the comment IS the thing under test: `ci.yml`'s header
  // explained itself in terms of `deploy.yml`, a workflow deleted with the
  // deploy-before-merge pipeline. A reader trusting that comment goes looking
  // for a file that has not existed for releases.
  //
  // Guards the CLASS rather than that one instance: any workflow naming any
  // workflow file that is not there fails, including the next one.
  it('no workflow names a workflow file that does not exist', () => {
    const candidates = (name: string) => [
      join(WORKFLOWS, name),
      join('.github', name),
      name,
    ];
    // The population is the references judged, not the files opened: a
    // reader blind to every reference would open each workflow and pass
    // (#446). And a file that is not YAML is refused by name, never skipped:
    // its `ref` is undefined.
    const refs = workflowFileNames().flatMap(
      (file): Array<{ file: string; ref: string | undefined }> =>
        isYaml(file)
          ? workflowRefs(readFileSync(join(WORKFLOWS, file), 'utf8')).map(
              (ref) => ({ file, ref }),
            )
          : [{ file, ref: undefined }],
    );
    const dangling = refs
      .filter(
        ({ ref }) =>
          ref === undefined || !candidates(ref).some((p) => existsSync(p)),
      )
      .map(({ file, ref }) =>
        ref === undefined ? `${file}: not a workflow` : `${file} → ${ref}`,
      );
    expect(
      searched(dangling, {
        of: refs.map(({ file, ref }) =>
          ref === undefined ? file : `${file} → ${ref}`,
        ),
        what: 'workflow file references',
      }),
    ).toEqual([]);
  });

  it('reads every workflow file reference, and as many as there are', () => {
    // Measured 19 references on 2026-10-03 (#446). Stated tight, so a
    // reader that comes back one short fails.
    const files = workflowYamlNames();
    const read = files.map((file) => ({
      file,
      refs: workflowRefs(readFileSync(join(WORKFLOWS, file), 'utf8')),
    }));
    expect(read.flatMap(({ refs }) => refs).length).toBeGreaterThan(18);
    // Cross-checked against the parsed document: every workflow file a
    // value names once YAML has unquoted, unescaped and unfolded it must be
    // among what the raw scan read, or the raw text spells it in a way the
    // scan cannot see. The pattern's own forms are planted below.
    const missed = read.flatMap(({ file, refs }) =>
      stringLeaves(parseCleanYaml(workflow(file), file))
        .flatMap(([, value]) => workflowRefs(value))
        .filter((ref) => !refs.includes(ref))
        .map((ref) => `${file} → ${ref}`),
    );
    expect(searched(missed, { of: files, what: 'workflow files' })).toEqual([]);
  });

  it.each([
    ['a comment', '# was deploy.yml\non: push\n'],
    [
      'a reusable workflow',
      'jobs:\n  a:\n    uses: ./.github/workflows/deploy.yml\n',
    ],
    [
      'a quoted value',
      "on:\n  workflow_run:\n    workflows: ['deploy.yaml']\n",
    ],
    [
      'a script',
      'jobs:\n  a:\n    steps:\n      - run: gh workflow run deploy.yml\n',
    ],
  ])('reads a workflow file named in %s', (_where, raw) => {
    expect(workflowRefs(raw)).toHaveLength(1);
  });

  // Production was verified by `curl`: status codes and grepping fetched HTML.
  // That is a TEXT assertion, and this repo has already shipped a bug for a
  // full release that no text assertion can see — `display: flex` ate authored
  // whitespace while `textContent` still contained it, so every text-based
  // check passed. curl also cannot tell whether the CSS loaded, whether the
  // calculators' JS ran, or whether the page scrolls sideways at 320px.
  //
  // `prod-verified` should mean a browser rendered production, so the browser
  // run has to come BEFORE the status is posted, not beside it.
  it('prod-verified is gated on a real browser run, not a curl smoke', () => {
    const prod = workflowSteps('deploy-prod.yml');
    const browser = prod.indexOf('playwright.prod.config');
    const status = prod.indexOf('/statuses/');

    expect(browser, 'prod never runs playwright.prod.config').toBeGreaterThan(
      -1,
    );
    expect(status, 'prod never posts a commit status').toBeGreaterThan(-1);
    expect(
      browser,
      'prod-verified is posted before the browser run that should gate it',
    ).toBeLessThan(status);
  });

  /**
   * Production is verified against the host REAL VISITORS GET.
   *
   * `shyden-site.pages.dev` is the deployment alias, and it is Basic-auth
   * locked (401) while the apex is public (200). Verifying the alias means
   * `prod-verified` attests that a password-protected staging URL rendered —
   * it says nothing about whether shyden.co.uk resolves, presents a valid
   * certificate, or routes to this project at all. Any of those breaking
   * leaves the site dark for everyone while the release goes green.
   *
   * Two tests because there are two independent ways to regress: the config
   * default drifting back, and the workflow overriding a correct default.
   * A fix to only one of them changes nothing.
   */
  it('the prod browser run defaults to the public production domain', async () => {
    delete process.env.WEB_BASE_URL;
    const config = (await import('../../playwright.prod.config')).default;

    expect(config.use?.baseURL).toBe('https://shyden.co.uk');
  });

  it('prod verification targets the public domain, not the deployment alias', () => {
    const prod = workflowSteps('deploy-prod.yml');

    expect(
      prod,
      'a prod check still runs against the Basic-auth-locked deployment alias',
    ).not.toMatch(/shyden-site\.pages\.dev/);
    expect(prod, 'the browser run does not target the apex').toMatch(
      /WEB_BASE_URL:\s*https:\/\/shyden\.co\.uk/,
    );
  });

  it('the prod sanity suite exists and is more than a stub', () => {
    // Measured 8 plain tests in prod-sanity.spec.ts on 2026-10-03 (#446).
    // Stated tight, so a reader that comes back one short fails.
    expect(
      plainTestsIn('tests/prod/prod-sanity.spec.ts').length,
    ).toBeGreaterThan(7);
  });
});

/**
 * The e2e reconciliation guard is what `npm run test:e2e` actually runs.
 *
 * The guard (scripts/test-e2e.mjs) compares the tests a run accounted for
 * against the tests `playwright test --list` enumerates, and refuses a green
 * summary over a partial run. It protects nothing if the pipeline calls
 * Playwright directly and walks straight past it — which is the easiest change
 * in the world to make by accident, and produces no visible symptom, because
 * the suite still passes. It just stops being checked.
 */
describe('the e2e reconciliation guard cannot be bypassed', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

  it('is what `npm run test:e2e` invokes', () => {
    expect(
      pkg.scripts['test:e2e'],
      'pointing this back at `playwright test` silently removes the guard ' +
        'without failing a single test',
    ).toContain('scripts/test-e2e.mjs');
  });

  it('names a script that exists', () => {
    expect(existsSync('scripts/test-e2e.mjs')).toBe(true);
  });

  it('is not bypassed by any workflow calling Playwright directly', () => {
    // The deployed-site smoke suites legitimately call Playwright with their
    // own config (playwright.dev/prod.config.ts) and are not the full corpus.
    // Anything invoking the DEFAULT config, though, is the full suite and must
    // come through the guard.
    //
    // One exception, and it is DERIVED rather than written down: the visual
    // project (#33) is not part of the default corpus at all -- it exists
    // only under `VISUAL=1`, so `test-e2e.mjs` never enumerates it and there
    // is nothing for the reconciliation to reconcile. Naming it here by
    // importing it means renaming the project moves this exemption with it,
    // instead of leaving a stale allowance behind. Playwright supplies the
    // liveness itself: an unknown project, or one matching no tests, is a
    // hard error rather than a green empty run.
    //
    // `--project=` alone is NOT enough to be exempt. `--project=chromium`
    // would run a fifth of the real corpus with nobody counting it.
    const subset = new RegExp(`--project=${VISUAL_PROJECT.name}\\b`);
    const bypasses = workflowFileNames()
      .flatMap((file) =>
        workflow(file)
          .split('\n')
          .map((line) => ({ file, line })),
      )
      .filter(
        ({ line }) =>
          /\bplaywright\s+test\b/.test(line) &&
          !line.includes('--config=') &&
          !subset.test(line),
      );

    expect(
      searched(
        bypasses.map(({ file, line }) => `${file}: ${line.trim()}`),
        { of: workflowFileNames(), what: 'workflow files' },
      ),
      'a workflow running the default config outside `npm run test:e2e` is a ' +
        'full suite whose completeness nobody checks',
    ).toEqual([]);
  });
});

/**
 * Every Playwright image `text` names, whatever follows the name: a tag, a
 * digest or nothing at all, which is `latest`. The first version of this scan
 * wanted a colon after the name, so an image pinned by digest, or not pinned,
 * passed it.
 */
const playwrightImagesIn = (text: string): string[] =>
  text.match(/mcr\.microsoft\.com\/playwright[\w.@:/-]*/g) ?? [];

/** How many of a workflow's parsed string values name a Playwright image. */
const parsedImageValues = (raw: string, file: string): number =>
  stringLeaves(parseCleanYaml(raw, file)).filter(([, value]) =>
    value.includes('mcr.microsoft.com/playwright'),
  ).length;

/**
 * The visual-regression job, and the one flag that would hollow it out (#33).
 *
 * A screenshot suite that can rewrite its own baseline asserts nothing, and
 * the flag that does it is three words long. This is the same family as every
 * other guard here: the pipeline is only as good as the thing nobody has
 * quietly edited.
 *
 * Read over COMMENT-STRIPPED text, and in the inverse direction from the
 * usual reason. These are ABSENCE assertions, so a comment naming the flag
 * makes them go RED on a workflow that is correct -- and `ci.yml`'s own
 * comment explains that it never passes `--update-snapshots`, which would
 * fail this guard on the sentence promising the thing it checks for.
 */
describe('the visual-regression job cannot rewrite what it checks', () => {
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

  it('takes the image the baselines are captured in from one selector', async () => {
    // #454: no workflow names the image. The `image` job picks it with
    // scripts/playwright-image.mjs, and the local runner takes the same
    // pick (`localImage`), so a capture and its comparison share one image
    // without either writing it down. A browser bundle from a different
    // release than the library driving it fails in ways neither reports.
    const workflows = workflowYamlNames();
    const named = workflows.flatMap((name) =>
      playwrightImagesIn(withoutCommentLines(workflow(name), '#')).map(
        (image) => `${name}: ${image}`,
      ),
    );
    expect(searched(named, { of: workflows, what: 'workflow files' })).toEqual(
      [],
    );
    expect(jobNamed('ci.yml', 'image').runs).toEqual([
      'node scripts/playwright-image.mjs',
    ]);
    // The image the local runner USES, not whether it imports the selector:
    // an import left beside an image derived another way passed a text
    // check (mutation PI5).
    const { image } = (await import('../../scripts/visual.mjs')) as {
      image: string;
    };
    expect(image).toBe(localImage());
  });

  it('reads every workflow for an image, and as many as there are', () => {
    // Measured 10 workflow files on 2026-10-03 (#446), two of them #459's
    // probes (probe-459.yml, probe-459-relay.yml): lower this when they go.
    // Stated tight, so a walk that comes back one short fails.
    const workflows = workflowYamlNames();
    expect(workflows.length).toBeGreaterThan(9);
    // Cross-checked against the parsed document: every value naming the
    // image once YAML has unquoted and unfolded it must be one the text scan
    // reports. No workflow names it today, so the planted forms below are
    // what this check runs on. Counts, not sets, because the verdict above
    // holds the scan to none: any value naming the image is then one missed.
    const missed = workflows.filter(
      (name) =>
        parsedImageValues(workflow(name), name) >
        playwrightImagesIn(withoutCommentLines(workflow(name), '#')).length,
    );
    expect(searched(missed, { of: workflows, what: 'workflow files' })).toEqual(
      [],
    );
  });

  it.each([
    [
      'a container image',
      'jobs:\n  a:\n    container:\n      image: mcr.microsoft.com/playwright:v1.55.0-noble\n',
    ],
    [
      'an image pinned by digest',
      'jobs:\n  a:\n    container: mcr.microsoft.com/playwright@sha256:0123abcd\n',
    ],
    [
      'an untagged image',
      'jobs:\n  a:\n    container: mcr.microsoft.com/playwright\n',
    ],
    [
      'a quoted image',
      "jobs:\n  a:\n    container:\n      image: 'mcr.microsoft.com/playwright:v1.55.0-jammy'\n",
    ],
    [
      'a script',
      'jobs:\n  a:\n    steps:\n      - run: docker run --rm mcr.microsoft.com/playwright:v1.55.0-noble npx playwright test\n',
    ],
  ])('reads a Playwright image named in %s', (_where, raw) => {
    expect(parsedImageValues(raw, 'plant.yml')).toBe(1);
    expect(playwrightImagesIn(withoutCommentLines(raw, '#'))).toHaveLength(1);
  });

  it('runs the visual project, with the switch that declares it', () => {
    const ci = withoutCommentLines(workflow('ci.yml'), '#');
    expect(ci).toMatch(/npx playwright test --project=visual\s*$/m);
    // Without it the project is not declared at all, and `--project=visual`
    // is a hard Playwright error rather than an empty, green run.
    expect(ci).toMatch(/VISUAL:\s*'1'/);
  });
});

/**
 * A failure capture that catches nothing must not report success (#131).
 *
 * `if-no-files-found: ignore` is the one value that makes an
 * `actions/upload-artifact` step go GREEN having preserved nothing. Every
 * one of these steps runs under `if: failure()` — they exist solely to keep
 * the only evidence a red run ever produces — so a silent empty capture is
 * the vacuous-guard pattern living inside the evidence path itself. Verified
 * 2026-09-10: that path had fired exactly ONCE in this repository's history,
 * and nothing would have said so if it had fired and caught nothing.
 *
 * `warn` over `error` deliberately: the job is already red when these run,
 * and a job that died in `test:unit` before Playwright created
 * `test-results/` is legitimately empty. An annotation says so; a second red
 * X would blame the capture for the unit failure.
 */
type ArtifactStep = {
  workflow: string;
  step: string;
  /** The declared `if-no-files-found`, or `null` when the key is absent. */
  declared: string | null;
};

/**
 * Every `actions/upload-artifact` step in one workflow's text.
 *
 * SOURCE TEXT, not YAML parsing, for the reason given at the top of this
 * file. The walk is indentation-scoped: from the `uses:` line, keys belong to
 * that step until a line appears at or left of that indentation, which is
 * where the next step or the next block begins. Taking the file's first
 * `if-no-files-found` instead would let step three inherit step two's answer.
 */
const artifactStepsIn = (workflow: string, text: string): ArtifactStep[] => {
  const lines = text.split('\n');
  const steps: ArtifactStep[] = [];
  let step = '(unnamed step)';

  lines.forEach((line, i) => {
    const named = line.match(/^\s*-\s+name:\s*(.+?)\s*$/);
    if (named) step = named[1];
    if (!/^\s*uses:\s*actions\/upload-artifact@/.test(line)) return;

    const indent = line.search(/\S/);
    let declared: string | null = null;
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j];
      if (next.trim() === '') continue;
      if (next.search(/\S/) < indent) break;
      const value = next.match(/^\s*if-no-files-found:\s*(\S+)/);
      if (value) {
        declared = value[1].replace(/^['"]|['"]$/g, '');
        break;
      }
    }
    steps.push({ workflow, step, declared });
  });

  return steps;
};

/** Derived from disk, never from a list: the handover's list said two (#131). */
const allArtifactSteps = (): ArtifactStep[] =>
  nonEmpty(
    allWorkflows().flatMap(({ name, text }) => artifactStepsIn(name, text)),
    'upload-artifact steps in .github/workflows',
  );

const artifactSite = (s: ArtifactStep) => `${s.workflow} → ${s.step}`;

describe('a failure capture cannot succeed having caught nothing', () => {
  it('tells ignore, a quoted value and an absent key apart', () => {
    const fixture = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - name: silent',
      '        uses: actions/upload-artifact@abc # v7.0.1',
      '        with:',
      '          if-no-files-found: ignore',
      '      - name: loud',
      '        uses: actions/upload-artifact@abc # v7.0.1',
      '        with:',
      "          if-no-files-found: 'warn'",
      '      - name: silent by default',
      '        uses: actions/upload-artifact@abc # v7.0.1',
      '        with:',
      '          path: test-results/',
      '      - name: a later step is not this one',
      '        run: echo if-no-files-found: ignore',
      '',
    ].join('\n');

    expect(artifactStepsIn('fixture.yml', fixture)).toEqual([
      { workflow: 'fixture.yml', step: 'silent', declared: 'ignore' },
      { workflow: 'fixture.yml', step: 'loud', declared: 'warn' },
      { workflow: 'fixture.yml', step: 'silent by default', declared: null },
    ]);
  });

  it('no artifact capture in any workflow is set to ignore', () => {
    const steps = allArtifactSteps();
    const silent = steps
      .filter((s) => s.declared === 'ignore')
      .map(artifactSite);

    expect(
      searched(silent, { of: steps, what: 'upload-artifact steps' }),
    ).toEqual([]);
  });

  it('every artifact capture states what an empty capture means', () => {
    const steps = allArtifactSteps();
    const undeclared = steps
      .filter((s) => s.declared === null)
      .map(artifactSite);

    expect(
      searched(undeclared, { of: steps, what: 'upload-artifact steps' }),
    ).toEqual([]);
  });
});

/**
 * A server Playwright cannot supervise is a suite that cannot run.
 *
 * Astro 7.3 detects that an AI agent is running the command -- `isRunByAgent()`
 * in `astro/dist/cli/agent.js`, via `am-i-vibing` -- and DAEMONISES `astro dev`
 * and `astro preview` without being asked. `playwright.config.ts` supervises
 * the process it spawned, so the fork-and-exit reads as
 * "Process from config.webServer exited early" and the whole run aborts at
 * zero tests, while the detached server keeps port 4321. It binds IPv6 only,
 * so `lsof -ti tcp:4321` reports the port free and the next run fails the same
 * way (#139).
 *
 * The opt-out is badly named: `ASTRO_PREVIEW_BACKGROUND` is what the parent
 * sets ON the daemon child, so its presence means "detection already ran, do
 * not re-detect" and therefore keeps the server in the FOREGROUND.
 */
describe('the e2e server is supervised, not handed to a daemon', () => {
  /** `astro dev` and `astro preview` each have their OWN opt-out variable. */
  const SERVER = /\bastro\s+(dev|preview)\b/;

  const serverScripts = (): [string, string][] =>
    Object.entries(
      JSON.parse(readFileSync('package.json', 'utf8')).scripts ?? {},
    ).filter(([, command]) => SERVER.test(command as string)) as [
      string,
      string,
    ][];

  it('every astro server script opts out of the agent auto-background', () => {
    // Derived from package.json, never a list: a third server script added
    // next year is covered without anybody remembering this file exists.
    const scripts = serverScripts();
    const unguarded = scripts.filter(([, command]) => {
      const mode = SERVER.exec(command)![1].toUpperCase();
      return !command.includes(`ASTRO_${mode}_BACKGROUND=`);
    });

    expect(
      searched(unguarded, {
        of: scripts.map(([, command]) => command),
        what: 'astro server scripts',
      }),
      'an auto-backgrounded server exits early under Playwright and orphans the port',
    ).toEqual([]);
  });

  it('the opt-out it relies on still exists in the installed Astro', () => {
    // The seam, not our side of it. An Astro upgrade that renames or drops
    // this check must turn THIS red, rather than the suite starting to abort
    // at zero tests with a message about a web server.
    for (const mode of ['dev', 'preview']) {
      // STRIPPED, like every other source-text assertion here: a match landing
      // in a comment would report an opt-out Astro had already dropped.
      const cli = withoutTsComments(
        readFileSync(`node_modules/astro/dist/cli/${mode}/index.js`, 'utf8'),
      );
      // THE WHOLE CONSTRUCT, because the bare negation is a SUBSTRING of the
      // `!!process.env.ASTRO_*_BACKGROUND` that records the flag in the lock
      // file, and that line would keep this green with the opt-out deleted.
      // Measured: mutating the branch away left the guard passing (M7).
      expect(
        cli,
        `astro ${mode} no longer honours ASTRO_${mode.toUpperCase()}_BACKGROUND`,
      ).toContain(
        `!process.env.ASTRO_${mode.toUpperCase()}_BACKGROUND && isRunByAgent()`,
      );
    }
  });
});

/**
 * Every job runs under a budget of its own, and the e2e suite's is one number.
 *
 * MEASURED 2026-09-12 (#155). `deploy-dev.yml`'s "Comprehensive web tests" job
 * carried `timeout-minutes: 25`, while `npm run test:e2e` alone took **26m13s**
 * on the identical tree (PR run 34674831504, which went green). Aurora's merge
 * pushed the suite past that budget, so run 34676066071 for `c100e59` was
 * CANCELLED at 24m02s and BOTH `Deploy to Dev` and `Verify dev + dev-verified`
 * were SKIPPED. A cancelled run posts no red gate, and `ci.yml` ran the very
 * same suite with no budget at all and went green: one suite, two budgets, and
 * only the smaller one could stop a deploy.
 *
 * MEASURED 2026-09-13 (#157). Since #159 a push to `develop` runs no suite -- the
 * gate proves the merged tree is the one `ci.yml` passed -- so the only e2e run
 * on the merge path was the one job with no budget, where a hang burns the
 * runner's 360-minute default. Its last ten green runs took 22.9 to 28.5
 * minutes; `visual` took 44 to 72 seconds.
 *
 * So both rules are DERIVED from every workflow, parsed, never pinned to one
 * named job. `DEV_E2E_JOB_MIN_MINUTES` pinned deploy-dev.yml's e2e job, and
 * when #159 made that job dispatch-only it went on guarding the path merges no
 * longer take. Every job running the suite carries EXACTLY the budget below, so
 * no copy can drift from another.
 *
 * The budget is a POLICY, pinned as a literal and asserted separately from the
 * guard that derives from it, so moving the constant cannot move both sides and
 * quietly restore the hole (#117).
 *
 * RESTATED FOR A SHARD (#163). By the time the suite was split it took up to
 * 39.3 minutes of those 45 (its last eight green runs, median 36.9): a margin
 * of 1.15 that the suite's growth had eaten from 1.58. And 45 minutes for an
 * eighth of the suite would bound nothing a shard could plausibly take: a
 * shard hung for 40 minutes would read as slow, not stuck. The policy is now
 * per shard, and no job runs the unsplit suite: the dispatch path calls
 * ci.yml rather than keeping a copy of its steps.
 *
 * MEASURED on PR #320, five green eight-shard runs of one head (run
 * 35832427906, attempts 1 to 5): the slowest shard of each took 8.3 to 8.9
 * minutes, so 20 is 2.2 times the slowest. Revisit it when that falls under
 * 1.5, rather than when a shard is cancelled.
 */
const E2E_SHARD_BUDGET_MINUTES = 20;

/**
 * The command that runs the e2e suite: the command itself, never a longer
 * script name that merely starts with it.
 */
const E2E_SUITE_COMMAND = /(?<![\w:-])npm run test:e2e(?![\w:-])/;

/** A step script that runs the e2e suite. */
const runsTheE2eSuite = (script: string): boolean =>
  E2E_SUITE_COMMAND.test(script);

/** Every job, in every workflow, that runs the e2e suite. */
const e2eSuites = () =>
  workflowGraphs().flatMap(({ name, jobs }) =>
    jobs
      .filter((job) => job.runs.some(runsTheE2eSuite))
      .map((job) => ({ name, job })),
  );

/** A command that builds the site: the npm script, or Astro's own. */
const BUILDS_THE_SITE = /(?<![\w:-])(?:npm run build|astro build)(?![\w:-])/;

/**
 * Whether a job builds the site before it runs the e2e suite: in an earlier
 * step, or earlier in the same step's script. The first version read earlier
 * steps only, so a block script building and then testing passed it.
 */
const buildsBeforeTheSuite = (runs: readonly string[]): boolean => {
  const script = runs.join('\n');
  const at = script.search(E2E_SUITE_COMMAND);
  return at >= 0 && BUILDS_THE_SITE.test(script.slice(0, at));
};

/** A one-job workflow whose job runs `steps`, for a planted form. */
const plantedJob = (steps: string): WorkflowJob[] =>
  workflowJobs(
    `on: push\njobs:\n  e2e:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`,
    'plant.yml',
  );

describe('every workflow that runs the e2e suite is read as doing so', () => {
  it('reads every job running the suite, and as many as there are', () => {
    // Measured 1 job on 2026-10-03 (#446): ci.yml's sharded e2e matrix, which
    // the dispatch path calls rather than copying. Stated tight, so a reader
    // that finds none fails.
    expect(e2eSuites().length).toBeGreaterThan(0);
    // Cross-checked against the text: a workflow whose runnable text runs
    // the suite must contribute a job to the parsed population, or the parse
    // has dropped the step that does it.
    const workflows = workflowYamlNames();
    const suites = e2eSuites();
    const missed = workflows.filter(
      (name) =>
        runsTheE2eSuite(runnableText(workflow(name))) &&
        !suites.some((suite) => suite.name === name),
    );
    expect(searched(missed, { of: workflows, what: 'workflow files' })).toEqual(
      [],
    );
  });

  it.each([
    ['a one-line step', '      - run: npm run test:e2e\n'],
    [
      'a shard step',
      '      - run: npm run test:e2e -- --shard=${{ matrix.shard }}/${{ strategy.job-total }}\n',
    ],
    [
      'a block script',
      '      - run: |\n          npm ci\n          npm run test:e2e\n',
    ],
    ['a chained command', '      - run: npm ci && npm run test:e2e\n'],
  ])('reads a job running the suite in %s', (_form, steps) => {
    expect(
      plantedJob(steps).filter((job) => job.runs.some(runsTheE2eSuite)),
    ).toHaveLength(1);
  });

  it('does not read a longer script that starts with the same name', () => {
    const [job] = plantedJob(
      '      - run: npm run test:e2e:visual\n      - run: npm run test:e2e-report\n',
    );
    expect(job!.runs).toHaveLength(2);
    expect(job!.runs.some(runsTheE2eSuite)).toBe(false);
  });

  it.each([
    [
      'an earlier step',
      '      - run: npm run build\n      - run: npm run test:e2e\n',
    ],
    [
      'the same block script',
      '      - run: |\n          npm run build\n          npm run test:e2e\n',
    ],
    [
      "Astro's own command",
      '      - run: npx astro build\n      - run: npm run test:e2e\n',
    ],
  ])('reads a build before the suite in %s', (_form, steps) => {
    const [job] = plantedJob(steps);
    expect(buildsBeforeTheSuite(job!.runs)).toBe(true);
  });

  it('does not read a build after the suite as one before it', () => {
    const [job] = plantedJob(
      '      - run: npm run test:e2e\n      - run: npm run build\n',
    );
    expect(buildsBeforeTheSuite(job!.runs)).toBe(false);
  });
});

describe('every job runs under a budget of its own (#157)', () => {
  it('pins the e2e budget as a chosen policy, not a number nobody picked', () => {
    expect(E2E_SHARD_BUDGET_MINUTES).toBe(20);
  });

  it('no checkout in any workflow leaves the job token in .git/config (#395)', () => {
    // No step pushes or fetches with it, and every later step -- npm ci, the
    // build, Playwright, wrangler -- could read it, in jobs that hold
    // statuses: write and contents: write.
    const checkouts = workflowYamlNames().flatMap((name) =>
      checkoutSteps(workflow(name), name),
    );
    const findings = checkouts
      .filter(({ persistsCredentials }) => persistsCredentials)
      .map(({ where }) => where);
    expect(
      searched(findings, {
        of: checkouts.map(({ where }) => where),
        what: 'checkout steps across every workflow',
      }),
    ).toEqual([]);
  });

  it('no job in any workflow runs on the runner default budget', () => {
    const graphs = workflowGraphs();
    const findings = graphs.flatMap(({ name, jobs }) =>
      unboundedJobFindings(jobs).map((finding) => `${name}: ${finding}`),
    );
    expect(
      searched(findings, {
        of: graphs.flatMap(({ jobs }) => jobs),
        what: 'jobs across every workflow',
      }),
    ).toEqual([]);
  });

  it('every job running the e2e suite carries exactly the shard budget', () => {
    const suites = e2eSuites();
    const offBudget = suites
      .filter(({ job }) => job.timeoutMinutes !== E2E_SHARD_BUDGET_MINUTES)
      .map(
        ({ name, job }) =>
          `${name}: ${job.id} has timeout-minutes ${job.timeoutMinutes ?? 'absent'}, not ${E2E_SHARD_BUDGET_MINUTES}`,
      );
    expect(
      searched(offBudget, {
        of: suites,
        what: 'jobs running npm run test:e2e',
      }),
    ).toEqual([]);
  });
});

/** The workflow the dispatch path calls, as a caller job names it. */
const CI_WORKFLOW = './.github/workflows/ci.yml';

/**
 * The e2e step every shard runs. The total is the matrix's own size, never a
 * number written beside it, so the two cannot disagree: a matrix of five with
 * `/4` spelled out would run shard 5 of 4, which Playwright refuses, and a
 * matrix of three would leave a quarter of the suite to no shard at all.
 */
const E2E_SHARD_COMMAND =
  'npm run test:e2e -- --shard=${{ matrix.shard }}/${{ strategy.job-total }}';

/** Where each shard writes its account, and where build-and-test reads them. */
const E2E_ACCOUNTS = 'e2e-accounts';

/**
 * `build-and-test` once the suite is split (#163).
 *
 * Branch protection requires it by NAME and the deploy gate deploys because it
 * passed, so its success has to go on meaning what it meant when it ran the
 * suite itself: every step ran, and the whole suite ran. It runs none of that
 * now. It stands for the jobs that do, and `scripts/e2e-shards.mjs` is its
 * verdict over them; `tests/unit/e2e-shards.test.ts` holds that verdict's
 * logic. What is held here is the wiring the verdict cannot see from inside a
 * run: what it is handed, when it runs, and which jobs it stands for.
 */
describe('build-and-test stands for the whole suite, run as shards (#163)', () => {
  type Step = {
    run?: string;
    uses?: string;
    if?: string;
    env?: Record<string, string>;
    with?: Record<string, unknown>;
  };
  type Job = {
    steps?: Step[];
    strategy?: { 'fail-fast'?: unknown; matrix?: Record<string, unknown> };
  };
  const ciParsed = () =>
    parseCleanYaml(workflow('ci.yml'), 'ci.yml') as {
      jobs: Record<string, Job>;
    };

  // A skipped required check is reported to branch protection as PASSING. An
  // aggregate whose condition could turn false would read green exactly when a
  // shard failed or was skipped (#157), so it has no condition that can: it
  // runs always(), and refuses in a step.
  it('is never skipped: it runs always(), and refuses in a step instead', () => {
    expect(jobNamed('ci.yml', 'build-and-test').condition).toBe('always()');
  });

  // Derived, not listed. A job added to ci.yml later is either required by
  // name itself -- repository administration, which the deploy gate must then
  // read too (REQUIRED_CHECKS) -- or build-and-test stands for it. A job that
  // is neither gates nothing, however red it goes (#33).
  it('stands for every other ci.yml job that is not required by name itself', () => {
    const jobs = workflowJobs(workflow('ci.yml'), 'ci.yml');
    const aggregate = jobNamed('ci.yml', 'build-and-test');
    const standsFor = jobs
      .map(({ id }) => id)
      .filter((id) => !REQUIRED_CHECKS.includes(id));
    expect([...aggregate.needs].sort()).toEqual(standsFor.sort());

    // Liveness, and the property the gate is trusted for: among the jobs it
    // stands for are the ones running the unit suite and the e2e suite.
    const stood = jobs.filter(({ id }) => aggregate.needs.includes(id));
    expect(stood.some(({ runs }) => runs.includes('npm run test:unit'))).toBe(
      true,
    );
    expect(stood.some(({ runs }) => runs.some(runsTheE2eSuite))).toBe(true);
  });

  it('hands its verdict every job it needs, and every shard account', () => {
    const verdict = (ciParsed().jobs['build-and-test']?.steps ?? []).find(
      (step) => step.run?.includes('scripts/e2e-shards.mjs'),
    );
    // Every account FILE the download brought, never a directory for the
    // verdict to list: an unmatched glob stays the literal pattern, which the
    // verdict refuses by name (#84).
    expect(verdict?.run?.trim()).toBe(
      `node scripts/e2e-shards.mjs ${E2E_ACCOUNTS}/*.json`,
    );
    // An env var, not an interpolation into the script: `toJSON(needs)`
    // carries job outputs, and an expression spliced into a `run:` is code.
    expect(verdict?.env?.NEEDS_JSON).toBe('${{ toJSON(needs) }}');
  });

  it('runs the e2e suite only as shards, each told its place in the matrix', () => {
    const e2e = workflowJobs(workflow('ci.yml'), 'ci.yml').filter(({ runs }) =>
      runs.some(runsTheE2eSuite),
    );
    expect(e2e.map(({ id }) => id)).toEqual(['e2e']);
    expect(e2e[0].runs.filter(runsTheE2eSuite)).toEqual([E2E_SHARD_COMMAND]);
  });

  it('schedules shards 1 to N, and lets each one finish when another fails', () => {
    const strategy = ciParsed().jobs.e2e?.strategy;
    const shards = strategy?.matrix?.shard;
    expect(Array.isArray(shards)).toBe(true);
    const list = shards as unknown[];
    // More than one, or it is not a split at all.
    // Measured 8 shards scheduled on 2026-10-03 (#446). Stated tight, so a
    // reader that comes back one short fails.
    expect(list.length).toBeGreaterThan(7);
    expect(list).toEqual(list.map((_, i) => i + 1));
    // A failing shard would otherwise CANCEL its siblings, and every test they
    // had not reached would go unreported: one red run would show one shard's
    // failures and hide the rest. The gate is unaffected either way, because
    // a cancelled shard refuses as surely as a failed one.
    expect(strategy?.['fail-fast']).toBe(false);
  });

  // The listing each shard is held to runs on a tree with NO build, so CI
  // proves on every pull request that collecting the suite never needs one.
  //
  // This rule used to point the other way. copy-reaches-a-page.spec.ts walked
  // `dist` at module scope, so `playwright test --list` ENOENTed without a
  // build, and run 35829226473's shard 1 passed all 742 of its tests and then
  // refused its own count (#163). The shards were made to build first -- which
  // hid the defect in CI and left it for every fresh checkout to meet (#351).
  // The read now happens in the test that needs it, the web server builds for
  // the run as it always did, and `collection-needs-no-build.test.ts` finds a
  // read of `dist/` anywhere the suite is collected. A build step here would
  // pay for a second build and blind the one cold listing CI performs.
  it('no job running the e2e suite builds the site before it', () => {
    const suites = e2eSuites();
    const prebuilt = suites
      .filter(({ job }) => buildsBeforeTheSuite(job.runs))
      .map(
        ({ name, job }) =>
          `${name}: ${job.id} builds before the e2e suite, so its listing never runs cold`,
      );
    expect(
      searched(prebuilt, { of: suites, what: 'jobs running npm run test:e2e' }),
    ).toEqual([]);
  });

  it('each shard writes its account where build-and-test reads it', () => {
    const steps = ciParsed().jobs.e2e?.steps ?? [];
    const run = steps.find((step) => step.run?.includes('npm run test:e2e'));
    expect(run?.env?.E2E_ACCOUNT_DIR).toBe(E2E_ACCOUNTS);
    // Uploaded whatever the shard's outcome, and an empty upload is an error:
    // a shard that wrote nothing has nothing to add up.
    const upload = steps.find(
      (step) =>
        step.uses?.startsWith('actions/upload-artifact@') &&
        step.with?.path === E2E_ACCOUNTS,
    );
    expect(upload?.if).toBe('always()');
    expect(upload?.with?.['if-no-files-found']).toBe('error');
  });
});

/**
 * Every artifact a matrix job uploads is named per leg (#163, AC7).
 *
 * `upload-artifact` refuses a second artifact of the same name in one run. Two
 * shards uploading one name would each race to be first, and the loser's step
 * would fail -- on a red run, the very run whose traces are wanted, and it
 * would take that shard's evidence with it.
 */
describe('a matrix job names every artifact per leg', () => {
  it('every upload in a matrix job names its leg', () => {
    const uploads = workflowYamlNames().flatMap((file) => {
      const parsed = parseCleanYaml(workflow(file), file) as {
        jobs?: Record<
          string,
          {
            strategy?: { matrix?: unknown };
            steps?: { uses?: string; with?: { name?: unknown } }[];
          }
        >;
      };
      return Object.entries(parsed.jobs ?? {})
        .filter(([, job]) => job.strategy?.matrix !== undefined)
        .flatMap(([id, job]) =>
          (job.steps ?? [])
            .filter((step) => step.uses?.startsWith('actions/upload-artifact@'))
            .map((step) => ({
              where: `${file}: ${id}`,
              name: String(step.with?.name ?? ''),
            })),
        );
    });
    const shared = uploads
      .filter(({ name }) => !/\$\{\{\s*matrix\./.test(name))
      .map(
        ({ where, name }) =>
          `${where} uploads '${name}', the same name on every leg`,
      );
    expect(
      searched(shared, { of: uploads, what: 'uploads in matrix jobs' }),
    ).toEqual([]);
  });
});

/**
 * The runner image every job pins, as an exact set.
 *
 * `ubuntu-latest` is a MOVING label: GitHub annotates every run of this repo
 * with "The ubuntu-latest label will migrate to Ubuntu 26 beginning October 19,
 * 2026", and on that date all ten jobs would change OS at once -- with no PR,
 * no diff and no run to show for it (#244). The OS is part of the build, and a
 * part of the build that moves without a diff is a part nobody reviewed.
 *
 * Pinned here as a set rather than a rule so the eventual move to Ubuntu 26 is
 * a one-line change a reviewer can see, which is exactly what this ticket asks
 * of it.
 */
const PINNED_RUNNER_IMAGES = ['ubuntu-26.04'];

describe('no job rides a moving runner label', () => {
  /** Every runner label of every job, beside the job that asks for it. */
  const runnerLabels = () =>
    workflowGraphs().flatMap(({ name, jobs }) =>
      jobs.flatMap((job) =>
        job.runsOn.map((label) => ({
          where: `${name} job '${job.id}'`,
          label,
        })),
      ),
    );

  it('pins an image rather than a label that migrates under it', () => {
    const all = runnerLabels();
    // The CLASS, derived: any `*-latest` label floats, not only ubuntu's.
    const floating = all.filter(({ label }) => /-latest$/.test(label));
    expect(
      searched(floating, {
        of: all.map(({ label }) => label),
        what: `runner labels in ${WORKFLOWS}`,
      }),
    ).toEqual([]);
  });

  it('pins the images this repository has actually run on', () => {
    // The LEVEL, as an exact set: a guard derived from the workflows can say
    // nothing about WHICH image they agreed on (#117), and adding a second
    // image must be a reviewed change rather than a silent one.
    const labels = [
      ...new Set(runnerLabels().map(({ label }) => label)),
    ].sort();
    expect(nonEmpty(labels, `runner labels in ${WORKFLOWS}`)).toEqual(
      PINNED_RUNNER_IMAGES,
    );
  });
});

describe('the visual job says which architecture it rendered on', () => {
  /**
   * The baselines are captured on a laptop and compared in CI, and the image
   * tag they share is MULTI-ARCH -- so "both sides run the same pinned image"
   * can be true of the tag while the two sides rasterise text differently
   * (#224). A difference nobody is looking at is still spent out of the
   * tolerance a real regression has to fit inside, so the architecture has to
   * be on the record of every run rather than assumed.
   */
  const visualRuns = () => jobNamed('ci.yml', 'visual').runs;

  it('prints the container architecture into the job summary', () => {
    const recording = visualRuns().filter(
      (script) =>
        /uname\s+-m/.test(script) && script.includes('GITHUB_STEP_SUMMARY'),
    );
    expect(
      searched(recording, {
        of: visualRuns(),
        what: "run steps in ci.yml's visual job",
      }),
      'the visual job must record the architecture it renders on',
    ).toHaveLength(1);
  });

  it('records it BEFORE the comparison, so a red run still reports it', () => {
    const runs = visualRuns();
    const arch = runs.findIndex((script) => /uname\s+-m/.test(script));
    const compare = runs.findIndex((script) =>
      script.includes('--project=visual'),
    );
    expect(arch, 'no step runs `uname -m`').toBeGreaterThanOrEqual(0);
    expect(compare, 'no step runs the visual project').toBeGreaterThanOrEqual(
      0,
    );
    // Order is the assertion. A step placed after the comparison still
    // "prints the architecture", and prints it only when the run is green --
    // which is the half of the time nobody needs it.
    expect(arch).toBeLessThan(compare);
  });
});

describe('the drift measurement reports, and never gates (#224)', () => {
  /** The `visual` job's steps, parsed -- `runs` carries only `run:` text. */
  const visualSteps = (): Array<Record<string, unknown>> => {
    const root = parseCleanYaml(workflow('ci.yml'), 'ci.yml') as {
      jobs: Record<string, { steps: Array<Record<string, unknown>> }>;
    };
    return nonEmpty(root.jobs.visual.steps, "steps in ci.yml's visual job");
  };

  const indexOf = (predicate: (s: Record<string, unknown>) => boolean) =>
    visualSteps().findIndex(predicate);

  // `--project=visual` is a PREFIX of `--project=visual-measure`, so a
  // substring test matches the measuring step too and the two are
  // indistinguishable -- the same shape as `/glory-points` matching inside
  // `/id/glory-points` (#21 Stage 4). `\\b` does not help either: `-` is a
  // non-word character, so `\\bvisual\\b` matches inside `visual-measure`.
  /** A fallback that carries information, as opposed to a bare `|| true`. */
  const INFORMATIVE_FALLBACK = /\|\|\s*(echo|printf)\b/;

  const GATE_PROJECT = /--project=visual(?![\w-])/;
  const isGate = (s: Record<string, unknown>) =>
    typeof s.run === 'string' && GATE_PROJECT.test(s.run);
  // The SAME prefix trap one level down, and it was left as a bare
  // `includes` while the comment above spelled the lesson out: mutation M3
  // renamed the project to `visual-measurement` and this still matched, so a
  // guard meant to notice the measuring step had vanished stayed green (#286).
  const MEASURE_PROJECT = /--project=visual-measure(?![\w-])/;
  const isMeasure = (s: Record<string, unknown>) =>
    typeof s.run === 'string' && MEASURE_PROJECT.test(s.run);

  it('measures after the gate has decided the build', () => {
    const gate = indexOf(isGate);
    const measure = indexOf(isMeasure);
    expect(
      gate,
      'no step runs the gating visual project',
    ).toBeGreaterThanOrEqual(0);
    expect(
      measure,
      'no step runs the measuring project',
    ).toBeGreaterThanOrEqual(0);
    expect(measure).toBeGreaterThan(gate);
  });

  it('is tolerated, while the gate it follows is NOT', () => {
    // The direction is the whole assertion. Tolerating the gate would let a
    // real visual regression through; failing to tolerate the measurement
    // would turn a zero-tolerance comparison -- which is EXPECTED to fail --
    // into a broken build on every pull request.
    const steps = visualSteps();
    expect(steps[indexOf(isMeasure)]['continue-on-error']).toBe(true);
    expect(steps[indexOf(isGate)]['continue-on-error']).toBeUndefined();
  });

  // #286: this table is the evidence #224 was decided on, and it was being
  // cut. Playwright's list reporter prints each comparison's ratio three
  // times, so ten comparisons overflow forty lines -- the last two were
  // dropped from the table with nothing in the output saying so.
  it('prints every comparison rather than the first N lines', () => {
    const measure = visualSteps()[indexOf(isMeasure)].run as string;
    expect(
      withoutCommentLines(measure),
      'a cap silently drops measurements off the end of the table',
    ).not.toMatch(/\|\s*head\s+-/);
  });

  // #286: `||` tests the PIPELINE's status, which is the LAST command's.
  // `grep ... | head -40 || echo 'no comparison output'` reads head's status,
  // and head exits 0 whether or not grep matched a single line, so the
  // fallback could never run. A measurement that produced nothing rendered an
  // EMPTY block under a confident heading, and silence reads as "nothing
  // drifted" when it means "nothing was measured".
  //
  // Every line of every workflow script is the population, not the lines that
  // happen to carry a fallback: after a fix there may be no fallback left at
  // all, and a guard whose population its own fix empties is vacuous by
  // construction (#118).
  it('lets a fallback test the status of the command producing its text', () => {
    const lines = workflowYamlNames().flatMap((file) =>
      workflowJobs(workflow(file), file).flatMap((job) =>
        job.runs.flatMap((run) =>
          withoutCommentLines(run)
            .split('\n')
            .map((line) => ({ file, line })),
        ),
      ),
    );

    const findings = lines
      .filter(
        ({ line }) =>
          INFORMATIVE_FALLBACK.test(line) && line.split('||')[0].includes('|'),
      )
      .map(({ file, line }) => `${file}: ${line.trim()}`);

    expect(
      searched(findings, {
        of: lines.map(({ line }) => line),
        what: 'lines of workflow run scripts',
      }),
      'a command between a fallback and the status it tests makes it dead code',
    ).toEqual([]);
  });

  it('writes its numbers where they can be read back, not only to the summary', () => {
    // A step summary is rendered in the UI and is not exposed by the Actions
    // API, so `gh run view --log` returns the script and nothing else. The
    // drift table was written only there once, and could not be read (#224).
    //
    // Judged per LINE, not per step: a step that tees one line and appends
    // the next with `>>` holds a `tee` and still writes where nothing reads
    // it back (#446). Shell comments are not writes.
    const writesTheSummary = (line: string) =>
      line.includes('GITHUB_STEP_SUMMARY') && !line.trimStart().startsWith('#');
    const writes = visualSteps()
      .flatMap((s) => (typeof s.run === 'string' ? s.run.split('\n') : []))
      .filter(writesTheSummary);
    // Measured 2 on 2026-10-03 (#446). Stated tight.
    expect(writes.length).toBeGreaterThan(1);
    // Independent of the YAML parse (#446, control c): the visual job's own
    // text, YAML comments aside, names the summary on exactly as many lines.
    // The job is every line after its key, up to the next line at a job's
    // own two-space indent.
    const lines = workflow('ci.yml').split('\n');
    const start = lines.indexOf('  visual:');
    expect(start, 'ci.yml declares no visual job').toBeGreaterThan(-1);
    const after = lines.slice(start + 1);
    const end = after.findIndex((line) => /^ {2}\S/.test(line));
    const job = end === -1 ? after : after.slice(0, end);
    expect(job.filter(writesTheSummary)).toHaveLength(writes.length);

    const unreadable = writes.filter(
      (line) => !/tee\s+-a\s+"\$GITHUB_STEP_SUMMARY"/.test(line),
    );
    expect(
      searched(unreadable, {
        of: writes,
        what: "lines writing a job summary in ci.yml's visual job",
      }),
      'a summary written with >> cannot be read back from the job log',
    ).toEqual([]);
  });

  it('runs even when the gate went red, which is when it is worth having', () => {
    expect(visualSteps()[indexOf(isMeasure)].if).toBe('always()');
  });

  // The measurement must not destroy the evidence of the failure it follows
  // (#311). Playwright deletes the `outputDir` of every project a run selects
  // as that run starts (`createRemoveOutputDirsTask`, over
  // `testRun.filteredProjects`), and both projects inherited the config's
  // `test-results/desktop`. So on a red gate the measure step -- `always()`,
  // so that it runs then above all -- deleted the comparison's expected,
  // actual and diff images before `Keep the visual diff` uploaded anything.
  // Run 35772454043 failed on 528 pixels, and its artifact held one image
  // set: the measurement's, with a single differing pixel.

  /** Where a project's run writes, and so what the start of its run deletes. */
  const outputDirOf = (project: Project): string =>
    resolve(project.outputDir ?? playwrightConfig.outputDir ?? 'test-results');

  /** Whether deleting, or uploading, `dir` reaches `path`. */
  const reaches = (dir: string, path: string): boolean =>
    path === dir || path.startsWith(dir + sep);

  it('measures into a folder of its own, so its start cannot delete the gate diff (#311)', () => {
    const gate = outputDirOf(VISUAL_PROJECT);
    const measure = outputDirOf(VISUAL_MEASURE_PROJECT);
    expect(
      reaches(measure, gate),
      `the measure step clears ${measure} as it starts, and the gate's diff is in ${gate}`,
    ).toBe(false);
    // The other way round too, because the gate is also run on its own: a
    // gate run must not take a measurement's images with it either.
    expect(
      reaches(gate, measure),
      `a gate run clears ${gate} as it starts, and the measurement is in ${measure}`,
    ).toBe(false);
  });

  it('uploads the gate diff and the measurement diff together (#311)', () => {
    const uploads = nonEmpty(
      visualSteps().filter(
        (step) =>
          typeof step.uses === 'string' &&
          step.uses.startsWith('actions/upload-artifact@'),
      ),
      "upload-artifact steps in ci.yml's visual job",
    );
    const paths = nonEmpty(
      uploads
        .flatMap((step) =>
          String(
            (step.with as { path?: unknown } | undefined)?.path ?? '',
          ).split('\n'),
        )
        .map((line) => line.trim())
        .filter(Boolean),
      "paths the visual job's uploads keep",
    );
    // A glob or a `!` exclusion is a matching rule this guard would have to
    // re-implement to read, so it is refused rather than approved unread.
    const unreadable = paths.filter((path) => /[*?[\]{}!]/.test(path));
    expect(searched(unreadable, { of: paths, what: 'upload paths' })).toEqual(
      [],
    );

    const keeps = (dir: string) =>
      paths.some((path) => reaches(resolve(path), dir));
    const gate = outputDirOf(VISUAL_PROJECT);
    const measure = outputDirOf(VISUAL_MEASURE_PROJECT);
    expect(
      keeps(gate),
      `the gate's diff is written to ${gate}, which no upload path reaches`,
    ).toBe(true);
    expect(
      keeps(measure),
      `the measurement's diff is written to ${measure}, which no upload path reaches`,
    ).toBe(true);
  });
});

describe('no two concurrently launched groups share an output folder (#230)', () => {
  /**
   * Playwright wipes its ENTIRE `outputDir` at the start of every invocation,
   * unconditionally and not scoped to its own artifacts, and names each
   * worker's artifacts folder by WORKER INDEX alone. `npm run test:devices`
   * launches more than one config against this same checkout at once, so two
   * processes numbering their workers independently collide by construction:
   * one stopping deletes a folder a live worker in the other is still writing
   * into. Reproduced in isolation -- a group holding a trace failed with
   * `ENOENT ... .playwright-artifacts-0/traces/...` while a sibling restarted
   * its worker, and passed alone on the same tree.
   */
  const RUNNER = 'scripts/test-devices.mjs';

  /**
   * The PLAYWRIGHT configs the runner launches, derived from its source.
   *
   * Keyed on the COMMAND, not the filename. The first draft matched every
   * `--config=` and picked up `vitest.ios.config.ts` -- the iOS group is a
   * vitest run, so it has no `outputDir`, wipes nothing, and cannot take part
   * in this collision. Its name is every bit as much a `*.config.ts`, so only
   * the invocation tells them apart.
   *
   * Comments are stripped first: this runner's prose names
   * `playwright.device.config.ts` several times, and a guard satisfied by a
   * file's own documentation asserts nothing.
   */
  const launchedConfigs = (): string[] => {
    const code = codeWithoutComments(RUNNER, readFileSync(RUNNER, 'utf8'));
    // The WHOLE invocation, not a split-and-search. A draft that split on
    // `'playwright',` and took the first `--config=` in the remainder reached
    // ACROSS invocations: with one group's flag deleted, its segment matched
    // the iOS group's `--config=vitest.ios.config.ts` further down the file
    // and the guard reported two Playwright configs where there was one. Found
    // by mutation, not by reading -- the prediction for that mutation was
    // wrong, which is how the weakness surfaced at all.
    const found = [
      ...code.matchAll(
        /'playwright',\s*'test',\s*'--config=([\w.-]+\.config\.[cm]?ts)'/g,
      ),
    ].map((m) => m[1]);
    return [
      ...new Set(nonEmpty(found, `playwright configs launched by ${RUNNER}`)),
    ];
  };

  /**
   * Importing `playwright.device.config.ts` sets `PW_REAL_DEVICE` at module
   * scope, so the variable is restored rather than left behind for whatever
   * runs next in this process.
   */
  const outputDirOf = async (config: string): Promise<string> => {
    const before = process.env.PW_REAL_DEVICE;
    try {
      const loaded = (await import(resolve(config))) as {
        default?: { outputDir?: string };
      };
      const dir = loaded.default?.outputDir;
      expect(
        dir,
        `${config} declares no outputDir, so it takes Playwright's default and collides by construction`,
      ).toBeTruthy();
      return resolve(dir as string);
    } finally {
      if (before === undefined) delete process.env.PW_REAL_DEVICE;
      else process.env.PW_REAL_DEVICE = before;
    }
  };

  it('launches more than one config, or the rest of this asserts nothing', () => {
    expect(launchedConfigs().length).toBeGreaterThan(1);
  });

  it('gives each launched config a folder of its own', async () => {
    const configs = launchedConfigs();
    const dirs = await Promise.all(configs.map(outputDirOf));
    expect(
      new Set(dirs).size,
      `two groups resolve to one output folder: ${dirs.join(', ')}`,
    ).toBe(dirs.length);
  });

  it('clears every per-group report before a run, now that nothing wipes them', async () => {
    // `test-results/` stopped being anybody's outputDir here, so nothing wipes
    // it any more -- which is the point of the split, and which means a group
    // that DIED before writing its report would leave the previous run's
    // report to be read as this run's.
    //
    // Guarded against the runner's own exported constants rather than its
    // source text, which is possible only because #227 made the file
    // importable. Mutation found this missing: with the reports taken out of
    // the clear list the whole unit suite stayed green.
    const runner = (await import(resolve('scripts/test-devices.mjs'))) as {
      REPORT_FILES: Record<string, string>;
      RUN_START_CLEARED: readonly string[];
    };
    const reports = Object.values(runner.REPORT_FILES);
    const uncleared = reports.filter(
      (file) => !runner.RUN_START_CLEARED.includes(file),
    );
    expect(
      searched(uncleared, { of: reports, what: 'per-group report files' }),
    ).toEqual([]);
  });

  it('nests none inside another, which a parent wipe would take with it', async () => {
    const dirs = await Promise.all(launchedConfigs().map(outputDirOf));
    const nested = dirs.flatMap((inner) =>
      dirs
        .filter((outer) => inner !== outer && inner.startsWith(outer + sep))
        .map((outer) => `${inner} is inside ${outer}`),
    );
    expect(
      searched(nested, { of: dirs, what: 'gauntlet output folders' }),
    ).toEqual([]);
  });
});

// ---- what a job that states nothing is handed (#301) ----------------------
//
// A job with no `permissions:` inherits the workflow's; a workflow with none
// inherits the REPOSITORY default, measured `write` on 2026-09-22 on
// `actions/permissions/workflow`. `ci.yml` stated none, so its `visual` job --
// and any job added later to the one workflow that runs on every pull request
// -- was handed the right to push commits, edit issues and open pull requests
// in order to read a checkout and run a suite.
//
// The default itself is repository administration, and so the operator's; the
// declaration is the half this repository controls, and it is the half that
// survives a settings change in either direction.
describe('no job inherits the repository default permissions (#301)', () => {
  const declaredPermissions = (): DeclaredPermissions[] =>
    workflowYamlNames().map((file) => ({
      file,
      permissions: (
        parseCleanYaml(workflow(file), file) as { permissions?: unknown }
      ).permissions,
    }));

  it('every workflow states a workflow-level permissions block', () => {
    const declared = declaredPermissions();
    expect(
      searched(inheritedPermissionsFindings(declared), {
        of: declared.map(({ file }) => file),
        what: 'workflow files',
      }),
    ).toEqual([]);
  });

  // Four of the finder's five branches cannot fire on this repository's own
  // configuration, and a detector branch nothing has ever matched is vacuous
  // whatever it was written to catch (#118). Synthetic input is the only way
  // to watch them fire, and `fine.yml` is here so a finder that reported
  // everything would fail this test rather than pass the one above.
  it('reports a silent workflow, a shorthand, a list and a rejected value', () => {
    expect(
      inheritedPermissionsFindings([
        { file: 'silent.yml', permissions: undefined },
        { file: 'empty.yml', permissions: null },
        { file: 'shorthand.yml', permissions: 'write-all' },
        { file: 'listed.yml', permissions: ['contents'] },
        { file: 'typo.yml', permissions: { contents: true } },
        { file: 'fine.yml', permissions: { contents: 'read' } },
      ]),
    ).toEqual([
      'silent.yml states no workflow-level permissions',
      'empty.yml states no workflow-level permissions',
      "shorthand.yml grants every scope with the 'write-all' shorthand",
      'listed.yml declares permissions that are not a mapping',
      'typo.yml grants contents: true, which is not read, write or none',
    ]);
  });

  // Presence cannot pin a LEVEL, and no rule over every workflow can ask for
  // read-only: `release-tag.yml` needs `contents: write` to cut a tag. This
  // asks it of the workflows a PULL REQUEST can start, derived from the
  // parsed `on:` rather than named -- those are the ones whose run can be
  // provoked by a branch nobody here has reviewed, which is the case the
  // repository default was never chosen for.
  it('no workflow a pull request can start grants a write scope to a silent job', () => {
    const startedByPullRequest = ({ file }: DeclaredPermissions): boolean => {
      const on = (parseCleanYaml(workflow(file), file) as { on?: unknown }).on;
      if (typeof on === 'string') return on === 'pull_request';
      if (Array.isArray(on)) return on.includes('pull_request');
      return typeof on === 'object' && on !== null && 'pull_request' in on;
    };
    const onPullRequest = declaredPermissions().filter(startedByPullRequest);
    const writes = onPullRequest.flatMap(({ file, permissions }) =>
      workflowLevelWrites(permissions).map(
        (scope) => `${file} grants ${scope} at the workflow level`,
      ),
    );
    expect(
      searched(writes, {
        of: onPullRequest.map(({ file }) => file),
        what: 'workflows a pull request can start',
      }),
    ).toEqual([]);
  });
});

/**
 * #95. The back-translation review runs on the real engine, can go red, and
 * runs whenever anything it reads changes.
 *
 * Advisory by design -- no score fails it -- which makes the three ways it
 * could quietly stop meaning anything the ones to hold: an engine that is not
 * the pinned one, an error swallowed into a green check, and a change to its
 * own inputs that does not start it at all.
 */
describe('the back-translation review', () => {
  const FILE = 'back-translation.yml';
  const SCRIPT = 'scripts/i18n-back-translate.mjs';
  const parsed = () =>
    parseCleanYaml(workflow(FILE), FILE) as {
      on?: Record<string, { paths?: string[] } | null>;
      env?: Record<string, unknown>;
      jobs?: Record<
        string,
        {
          'continue-on-error'?: unknown;
          env?: Record<string, unknown>;
          steps?: {
            name?: string;
            'continue-on-error'?: unknown;
            env?: Record<string, unknown>;
          }[];
        }
      >;
    };
  /** The review job's shell, with its comment lines gone. */
  const scripts = () =>
    jobNamed(FILE, 'review')
      .runs.map((run) => withoutCommentLines(run))
      .join('\n');

  it('runs the script', () => {
    expect(scripts()).toMatch(
      /^\s*node scripts\/i18n-back-translate\.mjs\s*$/m,
    );
  });

  it('builds its engine from the Dockerfile Dependabot watches', () => {
    expect(scripts()).toMatch(
      /^\s*docker build\b[^\n]*\sdocker\/libretranslate\s*$/m,
    );
    expect(existsSync('docker/libretranslate/Dockerfile')).toBe(true);
  });

  // #390 F75. The review names its engine from the Dockerfile (`engineName`),
  // which Dependabot bumps. A version typed here stops being true on the
  // first bump, so the workflow may not set one at any level.
  it('lets the script name the engine from its Dockerfile', () => {
    const workflowFile = parsed();
    const job = workflowFile.jobs?.review;
    const steps = job?.steps ?? [];
    const typed = [
      ['the workflow', workflowFile.env],
      ['the review job', job?.env],
      ...steps.map(
        (step) => [step.name ?? '(unnamed step)', step.env] as const,
      ),
    ]
      // `env` may also be one expression string, which can carry it too.
      .filter(([, env]) =>
        typeof env === 'string'
          ? env.includes('BACK_TRANSLATE_ENGINE')
          : env?.BACK_TRANSLATE_ENGINE !== undefined,
      )
      .map(([where]) => where);
    expect(
      searched(typed, { of: steps, what: 'review steps' }),
      'BACK_TRANSLATE_ENGINE typed into the workflow',
    ).toEqual([]);
  });

  it('can go red: nothing in it continues on error', () => {
    const job = parsed().jobs?.review;
    const steps = job?.steps ?? [];
    const excused = [
      job?.['continue-on-error'],
      ...steps.map((step) => step['continue-on-error']),
    ].filter((value) => value !== undefined);
    expect(
      searched(excused, { of: steps, what: 'review steps' }),
      'a liveness failure swallowed here is a green check over nothing',
    ).toEqual([]);
  });

  /** Every module a script loads at run time, following relative imports. */
  function importClosure(entry: string): string[] {
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const code = withoutTsComments(readFileSync(file, 'utf8'));
      // A type-only import is erased before the script runs.
      for (const [, specifier] of code.matchAll(
        /^import\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]/gm,
      ))
        visit(normalize(join(dirname(file), specifier)));
    };
    visit(entry);
    return [...seen].sort();
  }

  const globToRegExp = (glob: string): RegExp =>
    new RegExp(
      `^${glob
        .split('**')
        .map((part) =>
          part
            .split('*')
            .map((text) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
            .join('[^/]*'),
        )
        .join('.*')}$`,
    );

  it('starts for a pull request that changes anything it reads', () => {
    const triggers = parsed().on ?? {};
    expect(Object.keys(triggers).sort()).toEqual([
      'pull_request',
      'workflow_dispatch',
    ]);
    const paths = triggers.pull_request?.paths ?? [];
    const inputs = [
      ...importClosure(SCRIPT),
      'docker/libretranslate/Dockerfile',
      `.github/workflows/${FILE}`,
    ];
    // The closure is followed, not listed: this is its floor, not its size.
    // Measured 17 modules the import walk found on 2026-10-03 (#446). Stated
    // tight, so a reader that comes back one short fails.
    expect(inputs.length, 'the import walk found nothing').toBeGreaterThan(16);
    const unwatched = inputs.filter(
      (file) => !paths.some((glob) => globToRegExp(glob).test(file)),
    );
    expect(
      searched(unwatched, { of: inputs, what: 'files the review reads' }),
      'a change to one of these would not start the review',
    ).toEqual([]);
  });
});

/** `npm install` and every alias npm documents for it (`npm help install`). */
const NPM_INSTALL_VERBS = [
  'install',
  'add',
  'i',
  'in',
  'ins',
  'inst',
  'insta',
  'instal',
  'isnt',
  'isnta',
  'isntal',
  'isntall',
];

/** `text` with each shell continuation joined onto the line it continues. */
const joinedLines = (text: string): string[] =>
  text.replace(/\\\n\s*/g, ' ').split('\n');

/**
 * Each command in `text` that installs wrangler globally: `npm` with an
 * install verb, a global flag and a wrangler argument, in any order. The first
 * version of this scan wanted the flag before the package, on one line, after
 * `install` or `i`, so `npm install wrangler -g` and `npm in -g wrangler`
 * passed it.
 */
const globalWranglerInstalls = (text: string): string[] =>
  joinedLines(text)
    .flatMap((line) => line.split(/&&|\|\||;/))
    .map((command) => command.trim())
    .filter((command) => {
      const words = command.split(/\s+/);
      const at = words.indexOf('npm');
      if (at < 0) return false;
      const args = words.slice(at + 2);
      return (
        NPM_INSTALL_VERBS.includes(words[at + 1] ?? '') &&
        args.some((arg) =>
          /^(?:-g|--global(?:=.*)?|--location=global)$/.test(arg),
        ) &&
        args.some((arg) => /^wrangler(?:@|$)/.test(arg))
      );
    });

/** Every line of `text` naming wrangler beside a global flag, joined first. */
const globalFlagLines = (text: string): string[] =>
  joinedLines(text).filter(
    (line) =>
      line.includes('wrangler') &&
      /(?:^|\s)(?:-g|--global|--location=global)(?![\w-])/.test(line),
  );

/**
 * wrangler comes from the lockfile (#97, spec section 9).
 *
 * Both deploy workflows ran `npm install -g wrangler@4`, so any 4.x could
 * arrive at deploy time and bundle the Pages Functions differently from the
 * last deploy of the same commit. The locked copy is what the tests ran, and
 * Dependabot's npm ecosystem moves it as a reviewable diff.
 */
describe('wrangler comes from the lockfile (#97)', () => {
  it('is an exact-pinned devDependency', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies.wrangler).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('no workflow installs it globally', () => {
    const workflows = allWorkflows();
    const globalInstalls = workflows.flatMap(({ name, text }) =>
      globalWranglerInstalls(text).map((command) => `${name}: ${command}`),
    );
    expect(
      searched(globalInstalls, {
        of: workflows.map(({ text }) => text),
        what: 'workflow texts',
      }),
    ).toEqual([]);
  });

  it('reads every workflow for an install, and as many as there are', () => {
    // Measured 10 workflow files on 2026-10-03 (#446), two of them #459's
    // probes (probe-459.yml, probe-459-relay.yml): lower this when they go.
    // Stated tight, so a walk that comes back one short fails.
    const workflows = allWorkflows();
    expect(workflows.length).toBeGreaterThan(9);
    // Cross-checked against a coarser reading: any line naming wrangler
    // beside a global flag must hold a command the parser reports, or the
    // parser has a blind spot. No workflow holds one today, so the planted
    // forms below are what this check runs on.
    const missed = workflows.flatMap(({ name, text }) =>
      globalFlagLines(text)
        .filter((line) => globalWranglerInstalls(line).length === 0)
        .map((line) => `${name}: ${line}`),
    );
    expect(
      searched(missed, {
        of: workflows.map(({ text }) => text),
        what: 'workflow texts',
      }),
    ).toEqual([]);
  });

  it.each([
    ['the flag before the package', 'run: npm install -g wrangler@4'],
    ['the flag after the package', 'run: npm install wrangler@4 -g'],
    ['the long flag', 'run: npm i --global wrangler'],
    ['a continued line', 'run: |\n  npm install \\\n    -g wrangler'],
    ['sudo', 'run: sudo npm i -g wrangler'],
    ['a chained command', 'run: npm ci && npm i -g wrangler'],
  ])('reads a global install written with %s', (_form, text) => {
    expect(globalFlagLines(text)).toHaveLength(1);
    expect(globalWranglerInstalls(text)).toHaveLength(1);
  });

  // Written out, never generated from NPM_INSTALL_VERBS: a test made from the
  // list cannot see a verb dropped from it, because the verb's test goes too
  // (#446, matrix row PW6).
  it.each([
    'npm install -g wrangler',
    'npm add -g wrangler',
    'npm i -g wrangler',
    'npm in -g wrangler',
    'npm ins -g wrangler',
    'npm inst -g wrangler',
    'npm insta -g wrangler',
    'npm instal -g wrangler',
    'npm isnt -g wrangler',
    'npm isnta -g wrangler',
    'npm isntal -g wrangler',
    'npm isntall -g wrangler',
  ])('reads a global install written `%s`', (command) => {
    expect(globalWranglerInstalls(`run: ${command}`)).toHaveLength(1);
  });

  it('does not read the locked copy, or a global install of something else', () => {
    expect(
      globalWranglerInstalls(
        'run: npx wrangler pages deploy dist\nrun: npm i -g pnpm && npx wrangler --version',
      ),
    ).toEqual([]);
  });

  it('every deploy runs the locked copy', () => {
    const deploys = allWorkflows().flatMap(({ name, text }) =>
      text
        .split('\n')
        .filter((line) => line.includes(DEPLOY_COMMAND))
        .map((line) => `${name}: ${line.trim()}`),
    );
    expect(
      searched(
        deploys.filter((line) => !line.includes(`npx ${DEPLOY_COMMAND}`)),
        { of: deploys, what: 'wrangler deploy lines' },
      ),
    ).toEqual([]);
  });

  it('the functions job runs the functions-runtime suite', () => {
    // That build-and-test needs the job is already derived by "stands for
    // every other ci.yml job that is not required by name itself"; this pins
    // what the job runs, read from the parsed workflow.
    expect(jobNamed('ci.yml', 'functions').runs).toEqual([
      'npm ci',
      // Every engine: the suite posts the 404's forms from all five (#350).
      // No browser install: the job runs in the pinned image (#431).
      'npm run test:functions',
    ]);
  });
});

// ---- the dev token proves its reach before every dev deploy (#415) -------
//
// Dev and production live in separate Cloudflare accounts, because a Pages
// permission narrows to an account and never to a project. The dev token's
// scope was proved once by hand; the job proves it again before each deploy,
// so a token widened later never deploys. Read parsed, per step, in order.
describe('the dev token proves its reach before every dev deploy (#415)', () => {
  it('runs the reach probe in the deploy job, before the deploy', () => {
    const runs = jobNamed('deploy-dev.yml', 'deploy-dev').runs.map((run) =>
      withoutCommentLines(run).trim(),
    );
    const probe = runs.indexOf('node scripts/token-reach.mjs');
    const deploy = runs.findIndex((run) =>
      run.startsWith('npx wrangler pages deploy'),
    );
    expect(deploy, 'the deploy step').toBeGreaterThan(-1);
    expect(probe, 'the reach probe').toBeGreaterThan(-1);
    expect(probe, 'the probe runs before the deploy').toBeLessThan(deploy);
  });
});

// ---- browsers come with the pinned image (#431) ---------------------------
//
// Run 36973026350's shard 2 spent its whole job in `npx playwright install
// --with-deps` while an apt mirror stalled. A retry would only hide that, so
// the download is gone instead: every job that runs Playwright runs inside the
// Playwright image, which carries the browsers and their system packages. Read
// from the parsed workflows, so a new browser job is judged the day it is
// written and a comment naming the image cannot stand in for it.
describe('browsers come with the pinned Playwright image, never a download (#431)', () => {
  /**
   * The two deploy verify jobs still install, until they can post their status
   * without `gh`, which the image lacks (#444). Shrink-only: each entry must
   * still be found, so a fixed job leaves the list instead of staying excused.
   */
  const STILL_INSTALLING = [
    'deploy-dev.yml › verify-dev',
    'deploy-prod.yml › smoke-and-verify',
  ];
  type Jobs = Record<string, { container?: unknown }>;
  const imageOf = (file: string, id: string): string | undefined => {
    const { jobs } = parseCleanYaml(workflow(file), file) as { jobs: Jobs };
    const container = jobs[id]?.container;
    if (typeof container === 'string') return container;
    if (container && typeof container === 'object' && 'image' in container)
      return String((container as { image: unknown }).image);
    return undefined;
  };
  const runsPlaywright = (runs: readonly string[]) =>
    runs
      .map((run) => withoutCommentLines(run))
      .some((run) =>
        /playwright\s+test|npm run test:(e2e|functions|sanity|visual)\b/.test(
          run,
        ),
      );
  const browserJobs = () =>
    workflowGraphs().flatMap(({ name, jobs }) =>
      jobs
        .filter(({ runs }) => runsPlaywright(runs))
        .map(({ id }) => ({ file: name, id, where: `${name} › ${id}` })),
    );

  it('downloads browsers in no step but the excused deploy verify jobs', () => {
    const installing = workflowGraphs().flatMap(({ name, jobs }) =>
      jobs
        .filter(({ runs }) =>
          runs.some((run) =>
            /playwright\s+install/.test(withoutCommentLines(run)),
          ),
        )
        .map(({ id }) => `${name} › ${id}`),
    );
    expect(installing).toEqual(STILL_INSTALLING);
  });

  it('runs every other Playwright job in the image the `image` job picks', () => {
    // One expression, so every browser job in a run shares one digest, and
    // the choice between the pinned and the resolved image lives in one
    // script rather than in each job (#454).
    const jobs = browserJobs();
    const graphs = new Map(
      workflowGraphs().map(({ name, jobs: all }) => [name, all]),
    );
    const astray = jobs
      .filter(({ where }) => !STILL_INSTALLING.includes(where))
      .filter(
        ({ file, id }) =>
          imageOf(file, id) !== '${{ needs.image.outputs.ref }}' ||
          !graphs
            .get(file)
            ?.find((job) => job.id === id)
            ?.needs.includes('image'),
      )
      .map(
        ({ where, file, id }) =>
          `${where}: ${imageOf(file, id) ?? 'no container'}`,
      );
    expect(
      searched(astray, {
        of: jobs.map(({ where }) => where),
        what: 'jobs running Playwright',
      }),
    ).toEqual([]);
  });
});

// ---- the waiting-reports count (#349, spec 15.3) -------------------------
//
// The job holds a production read token, so what it may run is pinned whole:
// two steps of Node, after checkout and setup-node. Read PARSED
// (tests/workflow-jobs.ts), so a YAML comment can neither trip nor satisfy it.
describe('the waiting-reports count (#349)', () => {
  const FILE = 'waiting-reports.yml';
  type Step = {
    uses?: string;
    run?: string;
    if?: string;
    env?: Record<string, string>;
  };
  type CountWorkflow = {
    on?: Record<string, unknown>;
    concurrency?: unknown;
    jobs?: Record<
      string,
      {
        permissions?: unknown;
        env?: Record<string, string>;
        steps?: Step[];
      }
    >;
  };
  const parsed = () => parseCleanYaml(workflow(FILE), FILE) as CountWorkflow;
  const steps = () => parsed().jobs?.count?.steps ?? [];
  const unwrapped = (condition: string | undefined) =>
    condition?.replace(/^\$\{\{\s*|\s*\}\}$/g, '').trim();

  it('runs daily at 01:17 UTC and on dispatch, never on a push or a pull request', () => {
    expect(parsed().on).toEqual({
      schedule: [{ cron: '17 1 * * *' }],
      workflow_dispatch: null,
    });
    expect(Object.keys(parsed().jobs ?? {})).toEqual(['count']);
  });

  it('runs one at a time, queued and never cancelled, so two runs cannot both post', () => {
    expect(parsed().concurrency).toEqual({
      group: 'waiting-reports',
      'cancel-in-progress': false,
    });
  });

  it('names reports-count, and asks for contents: read and issues: write alone', () => {
    expect(jobNamed(FILE, 'count').environment).toBe('reports-count');
    expect(parsed().jobs?.count?.permissions).toEqual({
      contents: 'read',
      issues: 'write',
    });
  });

  it('runs no npm package code: checkout, setup-node and the script, nothing else', () => {
    expect(steps().map(({ uses }) => uses?.replace(/@.*/, '') ?? null)).toEqual(
      ['actions/checkout', 'actions/setup-node', null, null],
    );
    expect(jobNamed(FILE, 'count').runs).toEqual([
      'node scripts/waiting-reports.mjs',
      'node scripts/waiting-reports.mjs report-failure',
    ]);
  });

  it('reports a failure only under if: failure(), and the count runs unconditionally', () => {
    const [, , counting, reporting] = steps();
    expect(unwrapped(counting.if)).toBeUndefined();
    expect(unwrapped(reporting.if)).toBe('failure()');
  });

  it('gives the Cloudflare secrets to the counting step alone', () => {
    const [, , counting, reporting] = steps();
    expect(Object.keys(counting.env ?? {}).sort()).toEqual(
      REPORTS_COUNT_SECRETS,
    );
    expect(reporting.env).toBeUndefined();
    expect(parsed().jobs?.count?.env).toEqual({
      NOTICE_ISSUE: '360',
      GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
    });
  });
});
