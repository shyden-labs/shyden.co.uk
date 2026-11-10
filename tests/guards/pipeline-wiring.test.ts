import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { withoutCommentLines } from '../unit/source-text';
import { nonEmpty, searched } from '../source-files';
import {
  checkoutSteps,
  inheritedPermissionsFindings,
  parseCleanYaml,
  workflowJobs,
  workflowLevelWrites,
  type DeclaredPermissions,
  type WorkflowJob,
} from '../workflow-jobs';
import { REQUIRED_CHECKS } from '../../scripts/deploy-gate.mjs';

const WORKFLOWS = '.github/workflows';
const loadParser = async () => {
  const [{ parseFile }, { declarationsIn }] = await Promise.all([
    import('../unit/ast'),
    import('../playwright-declarations'),
  ]);
  return { parseFile, declarationsIn };
};
const workflow = (name: string) => readFileSync(join(WORKFLOWS, name), 'utf8');

/**
 * The plain `test(...)` declarations `spec` makes, read by the parser. A test
 * commented out, or spelled inside a string, is not one: counting `test(` in
 * the raw text counted both (#218).
 */
const plainTestsIn = async (spec: string) => {
  const { parseFile, declarationsIn } = await loadParser();
  return declarationsIn(parseFile(spec)).filter(
    ({ kind, modifier }) => kind === 'test' && modifier === '',
  );
};

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
  (/\/pages\/projects\/shyden-site(?![\w.-])/.test(scripts) &&
    /\/rollback\b/.test(scripts)) ||
  /node scripts\/pages\.mjs restore shyden-site(?![\w.-])/.test(scripts);
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
// Reading the Access service tokens' expiry (#796): the script's check mode,
// with no argument, as a whole command line, read as the count's is.
const watchesAccessTokens = (scripts: string) =>
  /^[ \t]*node scripts\/access-expiry\.mjs[ \t]*$/m.test(scripts);
/** The two secrets `access-expiry` holds, sorted as `WorkflowJob.secrets` is. */
const ACCESS_EXPIRY_SECRETS = [
  'CLOUDFLARE_ACCESS_READ_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
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

  it('the dev sanity suite exists and is more than a stub', async () => {
    // A guard that only checked the workflow REFERENCES the config would pass
    // against an emptied suite.
    expect(
      (await plainTestsIn('tests/dev/dev-sanity.spec.ts')).length,
    ).toBeGreaterThan(0);
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
    // `image` is the Playwright image it runs in (#444), not a gate.
    expect(verify.needs).toEqual(['deploy-dev', 'image']);
    expect(verify.condition).toBe(
      "!cancelled() && needs.deploy-dev.result == 'success'",
    );
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
    // A squash finds its tested head through its pull request (#892); without
    // the scope that lookup fails and the gate refuses every squash.
    expect(gate).toMatch(/^\s*pull-requests: read$/m);
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
      'workflow_dispatch',
    ]);
    expect(jobNamed('deploy-dev.yml', 'test').uses).toBe(CI_WORKFLOW);
  });

  // The merge gate. `dev-verified` has to be POSTED by something, or branch
  // protection requiring it blocks every PR forever.
  it('dev-verified is posted by the dev workflow', () => {
    const dev = workflowSteps('deploy-dev.yml');
    expect(dev).toContain('node scripts/commit-status.mjs dev-verified');
    expect(dev).toContain('statuses: write');
  });

  it('prod-verified is posted by the prod workflow', () => {
    const prod = workflowSteps('deploy-prod.yml');
    expect(prod).toContain('node scripts/commit-status.mjs prod-verified');
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
  type ParsedWorkflow = {
    concurrency?: string | { group?: unknown; 'cancel-in-progress'?: unknown };
    jobs?: Record<string, { steps?: { run?: unknown }[] }>;
  };
  const parsedWorkflow = (name: string) =>
    parseCleanYaml(workflow(name), name) as ParsedWorkflow;
  const changesProd = ({ jobs }: ParsedWorkflow) => {
    const scripts = Object.values(jobs ?? {})
      .flatMap((job) => (job.steps ?? []).map((step) => String(step.run ?? '')))
      .join('\n');
    return deploysProd(scripts) || rollsProdBack(scripts);
  };

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
    const judged = readers.map(({ where }) => where);
    expect(
      searched(unplaced, {
        of: judged,
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
    {
      does: 'falls shyden-site-dev back',
      environment: 'dev',
      in: (scripts: string) =>
        /node scripts\/pages\.mjs restore shyden-site-dev(?![\w.-])/.test(
          scripts,
        ),
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
    {
      does: 'reads the Access service tokens',
      environment: 'access-expiry',
      in: watchesAccessTokens,
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
    const judged = readers.map(({ where }) => where);
    expect(
      searched(misplaced, {
        of: judged,
        what: 'jobs reading a Cloudflare secret',
      }),
    ).toEqual([]);
  });

  // An unattended environment holds a production read token for one daily
  // job: `reports-count` reads production's reports table (#349),
  // `access-expiry` the Access service tokens (#796). Each holds exactly its
  // job's secrets, and nothing but that job reads them. The rule above places
  // a job by what it does; this one keeps an environment from gaining a
  // second tenant, or its token a second reader. And every tenant runs on
  // `main` alone (#877): code merged into `develop` without the operator's
  // review never reads production. One shared judge, one test per
  // environment, so each test names its own floor id literally.
  type Unattended = {
    job: string;
    environment: string;
    token: string;
    secrets: string[];
    does: (scripts: string) => boolean;
  };
  const unattended = ({
    job: what,
    environment,
    token,
    secrets: held,
    does,
  }: Unattended) => {
    const jobs = everyJob();
    const strays = jobs.flatMap(({ where, job }) => {
      const tenant = job.environment === environment;
      const readsToken = job.secrets.includes(token);
      if (!tenant)
        return readsToken
          ? [`${where} reads ${token} outside ${environment}`]
          : [];
      const findings: string[] = [];
      if (!does(job.runs.join('\n')))
        findings.push(`${where} is in ${environment} and is not ${what}`);
      if (job.condition !== "github.ref == 'refs/heads/main'")
        findings.push(
          `${where} is in ${environment} and runs on ` +
            `${job.condition ?? 'every branch'}, not main alone`,
        );
      const secrets = storedSecrets(job);
      if (secrets.join() !== held.join())
        findings.push(
          `${where} reads ${secrets.join(', ') || 'nothing'} in ` +
            `${environment}, not ${held.join(', ')}`,
        );
      return findings;
    });
    const tenants = jobs.filter(({ job }) => job.environment === environment);
    return { strays, tenants };
  };

  it('only the waiting-reports count reads secrets in reports-count, on main alone, or its token anywhere (#349, #877)', () => {
    const { strays, tenants } = unattended({
      job: 'the waiting-reports count',
      environment: 'reports-count',
      token: 'CLOUDFLARE_D1_READ_TOKEN',
      secrets: REPORTS_COUNT_SECRETS,
      does: countsWaitingReports,
    });
    expect(
      searched(strays, { of: tenants, what: 'jobs in reports-count' }),
    ).toEqual([]);
  });

  it('only the Access token expiry check reads secrets in access-expiry, on main alone, or its token anywhere (#796, #877)', () => {
    const { strays, tenants } = unattended({
      job: 'the Access token expiry check',
      environment: 'access-expiry',
      token: 'CLOUDFLARE_ACCESS_READ_TOKEN',
      secrets: ACCESS_EXPIRY_SECRETS,
      does: watchesAccessTokens,
    });
    expect(
      searched(strays, { of: tenants, what: 'jobs in access-expiry' }),
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
    const judged = prodJobs.map(({ where }) => where);
    expect(
      searched(leaks, {
        of: judged,
        what: 'jobs that deploy or verify prod',
      }),
    ).toEqual([]);
  });

  // …but an UNGUARDED dispatch would hand any feature branch a `dev-verified`
  // status, which is exactly what branch protection on `main` requires. That
  // branch could then open a PR straight into `main` and satisfy the gate
  // without ever passing through `develop` — the bypass this whole model
  // exists to prevent. Deploy and test on any ref; publish the STATUS only for
  // develop.
  it('dev-verified is only posted for develop', () => {
    const dev = workflowSteps('deploy-dev.yml');
    const post = dev.indexOf('node scripts/commit-status.mjs dev-verified');
    expect(post, 'no dev-verified status step found').toBeGreaterThan(-1);
    const step = dev.slice(Math.max(0, post - 900), post);
    expect(step).toMatch(/if:.*github\.ref_name\s*==\s*'develop'/);
  });

  it('names the job that branch protection has to require', () => {
    // The other half of the control, and the half no diff shows: a suite that
    // runs proves it DETECTS, only `required_status_checks.contexts` proves it
    // STOPS anything. Renaming this job silently de-gates develop and main,
    // because protection matches a context by NAME (#33).
    expect(workflowSteps('ci.yml')).toContain('build-and-test:');
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
    const status = prod.indexOf('node scripts/commit-status.mjs prod-verified');

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

  it('the prod sanity suite exists and is more than a stub', async () => {
    expect(
      (await plainTestsIn('tests/prod/prod-sanity.spec.ts')).length,
    ).toBeGreaterThan(0);
  });
});

/**
 * The command that runs the e2e suite: the command itself, never a longer
 * script name that merely starts with it.
 */
const E2E_SUITE_COMMAND = /(?<![\w:-])npm run test:e2e(?![\w:-])/;

/** A step script that runs the e2e suite. */
const runsTheE2eSuite = (script: string): boolean =>
  E2E_SUITE_COMMAND.test(script);

describe('every job runs under a budget of its own (#157)', () => {
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
    const judged = checkouts.map(({ where }) => where);
    expect(
      searched(findings, {
        of: judged,
        what: 'checkout steps across every workflow',
      }),
    ).toEqual([]);
  });
});

/** The workflow the dispatch path calls, as a caller job names it. */
const CI_WORKFLOW = './.github/workflows/ci.yml';

/** Where each shard writes its account, and where build-and-test reads them. */
const E2E_ACCOUNTS = 'e2e-accounts';

/** The same, for the capture shards, added up to the selection (#774). */
const CAPTURE_ACCOUNTS = 'capture-accounts';

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
    outputs?: Record<string, string>;
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

  // The laptop runs only format, typecheck and unit (operator, 2026-10-09, a
  // global rule; #653), so CI is the one place each other vitest suite runs:
  // a deleted step would leave it run nowhere, and the pre-push hook no longer
  // stands behind the guards. One test per suite CI alone runs.
  it.each(['test:guards', 'test:integration'])(
    'runs %s in a job build-and-test stands for, the only place it runs',
    (script) => {
      const jobs = workflowJobs(workflow('ci.yml'), 'ci.yml');
      const aggregate = jobNamed('ci.yml', 'build-and-test');
      const stood = jobs.filter(({ id }) => aggregate.needs.includes(id));
      expect(stood.some(({ runs }) => runs.includes(`npm run ${script}`))).toBe(
        true,
      );
    },
  );

  it('hands its verdict every job it needs, and every shard account', () => {
    const verdict = (ciParsed().jobs['build-and-test']?.steps ?? []).find(
      (step) => step.run?.includes('scripts/e2e-shards.mjs'),
    );
    // Every account FILE the download brought, never a directory for the
    // verdict to list: an unmatched glob stays the literal pattern, which the
    // verdict refuses by name (#84).
    expect(verdict?.run?.trim()).toBe(
      `node scripts/e2e-shards.mjs ${E2E_ACCOUNTS}/*.json --capture ${CAPTURE_ACCOUNTS}/*.json`,
    );
    // An env var, not an interpolation into the script: `toJSON(needs)`
    // carries job outputs, and an expression spliced into a `run:` is code.
    expect(verdict?.env?.NEEDS_JSON).toBe('${{ toJSON(needs) }}');
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
    const files = declared.map(({ file }) => file);
    expect(
      searched(inheritedPermissionsFindings(declared), {
        of: files,
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
  // repository default was never chosen for. `pull_request_target` counts
  // too (#944): a pull request starts it, with the default branch's token.
  it('no workflow a pull request can start grants a write scope to a silent job', () => {
    const PULL_REQUEST = ['pull_request', 'pull_request_target'];
    const startedByPullRequest = ({ file }: DeclaredPermissions): boolean => {
      const on = (parseCleanYaml(workflow(file), file) as { on?: unknown }).on;
      if (typeof on === 'string') return PULL_REQUEST.includes(on);
      if (Array.isArray(on))
        return on.some((event) => PULL_REQUEST.includes(String(event)));
      return (
        typeof on === 'object' &&
        on !== null &&
        PULL_REQUEST.some((event) => event in on)
      );
    };
    const onPullRequest = declaredPermissions().filter(startedByPullRequest);
    const writes = onPullRequest.flatMap(({ file, permissions }) =>
      workflowLevelWrites(permissions).map(
        (scope) => `${file} grants ${scope} at the workflow level`,
      ),
    );
    const judged = onPullRequest.map(({ file }) => file);
    expect(
      searched(writes, {
        of: judged,
        what: 'workflows a pull request can start',
      }),
    ).toEqual([]);
  });
});

// ---- the daily production reads (#349 spec 15.3, #796) --------------------
//
// Each job holds a production read token, so what it may run is pinned whole:
// two steps of Node, after checkout and setup-node. Read PARSED
// (tests/workflow-jobs.ts), so a YAML comment can neither trip nor satisfy it.
// One set of tests, run once per daily workflow: the waiting-reports count
// (#349) and the Access token expiry check (#796).
const DAILY_WORKFLOWS = [
  {
    name: 'the waiting-reports count',
    file: 'waiting-reports.yml',
    job: 'count',
    cron: '17 1 * * *',
    environment: 'reports-count',
    script: 'node scripts/waiting-reports.mjs',
    secrets: REPORTS_COUNT_SECRETS,
    jobEnv: {
      NOTICE_ISSUE: '360',
      GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
    },
    dispatchReportEnv: {
      NOTICE_ISSUE: '360',
      GITHUB_TOKEN: '${{ github.token }}',
    },
  },
  {
    name: 'the Access token expiry check',
    file: 'access-expiry.yml',
    job: 'check',
    cron: '43 1 * * *',
    environment: 'access-expiry',
    script: 'node scripts/access-expiry.mjs',
    secrets: ACCESS_EXPIRY_SECRETS,
    jobEnv: { GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}' },
    dispatchReportEnv: { GITHUB_TOKEN: '${{ github.token }}' },
  },
];

describe.each(DAILY_WORKFLOWS)('$name', (daily) => {
  const { file, job, secrets, jobEnv } = daily;
  type Step = {
    uses?: string;
    run?: string;
    if?: string;
    env?: Record<string, string>;
  };
  type DailyWorkflow = {
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
  const parsed = () => parseCleanYaml(workflow(file), file) as DailyWorkflow;
  const steps = () => parsed().jobs?.[job]?.steps ?? [];

  it(`gives the Cloudflare secrets to the ${job} step alone`, () => {
    const [, , working, reporting] = steps();
    expect(Object.keys(working.env ?? {}).sort()).toEqual(secrets);
    expect(reporting.env).toBeUndefined();
    expect(parsed().jobs?.[job]?.env).toEqual(jobEnv);
  });
});

const CAPTURE_WORKFLOW = 'visual-capture.yml';

/**
 * A CI bot never pushes to a branch (operator, 2026-10-21, every project;
 * #889). Neither bot holds a token that could, uses an action that might, or
 * runs a line that would: the permission is the stop, and the other two make
 * a change that tries it fail here rather than at GitHub.
 */
describe('neither bot can push, commit or amend (#889)', () => {
  type Step = { run?: string; uses?: string };
  type Job = { uses?: string; permissions?: unknown; steps?: Step[] };
  type Parsed = { permissions?: unknown; jobs: Record<string, Job> };
  const parsed = (file: string) =>
    parseCleanYaml(workflow(file), file) as Parsed;
  const permissionsOf = (file: string) => {
    const { permissions, jobs } = parsed(file);
    return {
      workflow: permissions,
      // A job's own `uses:` would run another workflow with its own token.
      jobs: Object.fromEntries(
        Object.entries(jobs).map(([id, { permissions, uses }]) => [
          id,
          { permissions, uses },
        ]),
      ),
    };
  };
  /** Every action a workflow's steps use, by name, lower-cased: GitHub reads them so. */
  const actionsOf = (file: string) => [
    ...new Set(
      Object.values(parsed(file).jobs).flatMap(({ steps }) =>
        (steps ?? []).flatMap(({ uses }) =>
          uses === undefined ? [] : [uses.split('@')[0]!.toLowerCase()],
        ),
      ),
    ),
  ];
  /** Every line of every step's script, trimmed, blank lines left out. */
  const scriptLines = (file: string) =>
    Object.values(parsed(file).jobs).flatMap(({ steps }) =>
      (steps ?? []).flatMap(({ run }) =>
        (run ?? '')
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line !== ''),
      ),
    );
  /**
   * A git subcommand that writes history or a ref, anywhere after `git` on
   * the line, so no global option can hide it (the old bots' push was
   * `git -c "...: basic $AUTH" push`, a quoted value with spaces in it); an
   * amend however it is spelled; or any `gh` at all, since neither bot needs
   * the API. It fails closed: a word like these in a read is refused too.
   */
  const WRITES =
    /\bgit\b.*\s(?:push|commit|merge|rebase|cherry-pick|revert|am|tag|update-ref|reset|notes|stash)\b|--amend\b|\bgh\b/;

  it('holds the capture to no token, and each of its jobs to reading the repository', () => {
    expect(permissionsOf(CAPTURE_WORKFLOW)).toEqual({
      workflow: {},
      jobs: {
        image: { permissions: { contents: 'read' }, uses: undefined },
        capture: { permissions: { contents: 'read' }, uses: undefined },
      },
    });
  });

  it('visual-capture.yml uses checkout, setup-node and upload-artifact, and no other action', () => {
    expect(actionsOf(CAPTURE_WORKFLOW).sort()).toEqual([
      './.github/actions/setup-node',
      'actions/checkout',
      'actions/upload-artifact',
    ]);
  });

  it('runs no capture line that pushes, commits or amends, and calls no gh', () => {
    const lines = scriptLines(CAPTURE_WORKFLOW);
    expect(
      searched(
        lines.filter((line) => WRITES.test(line)),
        { of: lines, what: `script lines in ${CAPTURE_WORKFLOW}` },
      ),
    ).toEqual([]);
  });

  // The pattern's own plants, written by hand (#446), one test each: every
  // form it must refuse, the old bots' own push and amend among them.
  it.each([
    'git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $AUTH" push --force-with-lease="refs/heads/$BRANCH:$SHA" origin "HEAD:refs/heads/$BRANCH"',
    'git commit --amend -F message.txt',
    'git push origin HEAD:refs/heads/x',
    'git -C "a dir" commit -m x',
    'git --git-dir=.git update-ref refs/heads/x HEAD',
    'cp a b && git tag v1',
    'gh workflow run ci.yml --ref "$BRANCH"',
    'gh api -X PATCH repos/o/r/git/refs/heads/x',
  ])('the write pattern refuses %s', (line) => {
    expect(WRITES.test(line)).toBe(true);
  });

  // And every git line the two bots run today, which it must let pass.
  it.each([
    'git rev-parse HEAD > "$RUNNER_TEMP/sha.txt"',
    'git log -1 --format=%B > "$RUNNER_TEMP/head-message.txt"',
    'git status --porcelain=v1 --untracked-files=all > "$RUNNER_TEMP/status.txt"',
    'git config --global --add safe.directory "$GITHUB_WORKSPACE"',
  ])('the write pattern lets %s pass', (line) => {
    expect(WRITES.test(line)).toBe(false);
  });
});
