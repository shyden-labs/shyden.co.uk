import { describe, it, expect } from 'vitest';
import {
  RUNNER_DEFAULT_TIMEOUT_MINUTES,
  checkoutSteps,
  isAggregate,
  jobsDownstreamOfAConditionalJob,
  skippedUpstreamFindings,
  unboundedJobFindings,
  workflowJobs,
  type WorkflowJob,
} from '../workflow-jobs';
import { searched } from '../source-files';
import { floorBreach } from '../floors';

/**
 * The rule behind the pipeline guard, proved on fixtures before it is trusted
 * on a real workflow (#157).
 *
 * Each case is one way `verify-dev` could be written. The shipped one is run
 * 34742940098: deployed, verify skipped, no `dev-verified`. These fixtures are
 * the mutation matrix kept permanently, so a later edit to the rule that stops
 * seeing one of them goes red here rather than passing a real workflow.
 */

/** deploy-dev.yml's graph after #159: one of two gates skips on every event. */
const releaseDevShape = (verifyCondition: string): string => `
jobs:
  gate:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
  test:
    if: github.event_name != 'push'
    runs-on: ubuntu-latest
  deploy:
    needs: [gate, test]
    if: >-
      !failure() && !cancelled() &&
      (needs.gate.result == 'success' || needs.test.result == 'success')
    runs-on: ubuntu-latest
  verify:
    needs: deploy
${verifyCondition}    runs-on: ubuntu-latest
`;

const findingsFor = (verifyCondition: string): string[] =>
  skippedUpstreamFindings(
    workflowJobs(releaseDevShape(verifyCondition), 'fixture.yml'),
  );

const NO_STATUS_FUNCTION = /^verify's if: calls none of always\(\)/;

describe('a job downstream of a conditional job states its own condition (#157)', () => {
  it('flags the job as shipped: no condition, so the skipped gate skips it too', () => {
    expect(findingsFor('')).toEqual([
      expect.stringMatching(/^verify declares no if:.*deploy, gate, test/),
    ]);
  });

  it('flags a condition calling no status function, since success() is still added', () => {
    expect(findingsFor("    if: needs.deploy.result == 'success'\n")).toEqual([
      expect.stringMatching(NO_STATUS_FUNCTION),
    ]);
  });

  it('is not satisfied by a status function in a trailing YAML comment', () => {
    expect(
      findingsFor("    if: needs.deploy.result == 'success' # !cancelled()\n"),
    ).toEqual([expect.stringMatching(NO_STATUS_FUNCTION)]);
  });

  it('is not satisfied by a status function inside a string literal', () => {
    expect(
      findingsFor(
        "    if: needs.deploy.result == 'success' && github.event_name != 'always()'\n",
      ),
    ).toEqual([expect.stringMatching(NO_STATUS_FUNCTION)]);
  });

  it('flags an explicit success(), which the skipped gate makes false as well', () => {
    expect(
      findingsFor(
        "    if: ${{ !cancelled() && success() && needs.deploy.result == 'success' }}\n",
      ),
    ).toEqual([expect.stringMatching(/^verify's if: calls success\(\)/)]);
  });

  it('flags a status function alone, which would verify a deploy that never happened', () => {
    expect(findingsFor('    if: ${{ !cancelled() }}\n')).toEqual([
      expect.stringMatching(
        /^verify's if: never requires needs\.deploy\.result == 'success'/,
      ),
    ]);
  });

  it('refuses an unquoted leading !, which YAML reads as a tag, not an expression', () => {
    expect(() =>
      findingsFor("    if: !cancelled() && needs.deploy.result == 'success'\n"),
    ).toThrow(/not clean YAML/);
  });

  it('passes the condition deploy-dev.yml ships, judged over a live population', () => {
    const jobs = workflowJobs(
      releaseDevShape(
        "    if: >-\n      !cancelled() && needs.deploy.result == 'success'\n",
      ),
      'fixture.yml',
    );
    const downstream = jobsDownstreamOfAConditionalJob(jobs).map(
      ({ job }) => job.id,
    );
    expect(downstream).toEqual(['deploy', 'verify']);
    expect(
      searched(skippedUpstreamFindings(jobs), {
        of: downstream,
        what: 'fixture jobs downstream of a conditional job',
      }),
    ).toEqual([]);
    expect(
      floorBreach(
        'workflow-jobs/deploy-dev-downstream-jobs',
        downstream.length,
      ),
    ).toBeUndefined();
  });

  it('follows a skip through every hop, not only the nearest need', () => {
    const jobs = workflowJobs(
      `
jobs:
  gate:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
  deploy:
    needs:
      - gate
    runs-on: ubuntu-latest
  verify:
    needs: deploy
    runs-on: ubuntu-latest
`,
      'fixture.yml',
    );
    expect(skippedUpstreamFindings(jobs)).toEqual([
      expect.stringMatching(
        /^deploy declares no if:.*whenever gate is skipped/,
      ),
      expect.stringMatching(
        /^verify declares no if:.*whenever gate is skipped/,
      ),
    ]);
  });

  it('leaves a graph with no conditional job alone', () => {
    const jobs = workflowJobs(
      `
jobs:
  deploy:
    runs-on: ubuntu-latest
  verify:
    needs: deploy
    runs-on: ubuntu-latest
`,
      'fixture.yml',
    );
    expect(
      searched(jobsDownstreamOfAConditionalJob(jobs), {
        of: jobs,
        what: 'fixture jobs',
      }),
    ).toEqual([]);
    expect(
      floorBreach('workflow-jobs/unconditional-graph-jobs', jobs.length),
    ).toBeUndefined();
  });

  it('refuses a need naming a job the workflow does not define', () => {
    const jobs = workflowJobs(
      `
jobs:
  verify:
    needs: deplyo
    runs-on: ubuntu-latest
`,
      'fixture.yml',
    );
    expect(() => skippedUpstreamFindings(jobs)).toThrow(
      /job 'verify' needs 'deplyo', which the workflow does not define/,
    );
  });
});

/** A workflow holding one job, so each case states only the lines it is about. */
const onlyJob = (lines: string): WorkflowJob => {
  const [job, ...others] = workflowJobs(
    `jobs:\n  only:\n    runs-on: ubuntu-latest\n${lines}`,
    'fixture.yml',
  );
  if (job === undefined || others.length > 0)
    throw new Error('a fixture here defines exactly one job');
  return job;
};

describe("a job's own budget and scripts, as the runner reads them (#157)", () => {
  it('reads a job-level timeout-minutes as minutes', () => {
    expect(onlyJob('    timeout-minutes: 45\n').timeoutMinutes).toBe(45);
  });

  it('reads a budget carrying a trailing comment, which a whole-line match reads as none', () => {
    expect(onlyJob('    timeout-minutes: 45 # was 25\n').timeoutMinutes).toBe(
      45,
    );
  });

  it('reads no budget from a comment, even one sitting above the real line', () => {
    expect(
      onlyJob('    # timeout-minutes: 45\n    timeout-minutes: 20\n')
        .timeoutMinutes,
    ).toBe(20);
    expect(
      onlyJob('    # timeout-minutes: 45\n').timeoutMinutes,
    ).toBeUndefined();
  });

  it("takes a job's budget from the job alone, never from a step inside it", () => {
    const steps =
      '    steps:\n      - run: npm ci\n        timeout-minutes: 45\n';
    expect(onlyJob(`    timeout-minutes: 30\n${steps}`).timeoutMinutes).toBe(
      30,
    );
    // The job around a budgeted step still runs on the runner's default.
    expect(onlyJob(steps).timeoutMinutes).toBeUndefined();
  });

  it('refuses a budget it cannot read as minutes, rather than judging a guess', () => {
    expect(() => onlyJob('    timeout-minutes: ${{ vars.BUDGET }}\n')).toThrow(
      /fixture\.yml job 'only': timeout-minutes is not a number of minutes/,
    );
  });

  it("lists each step's run script in file order, and none for a uses: step", () => {
    expect(
      onlyJob(
        '    steps:\n' +
          '      - uses: actions/checkout@v7\n' +
          '      - run: npm ci\n' +
          '      - name: e2e\n' +
          '        run: |\n' +
          '          npm run build\n' +
          '          npm run test:e2e\n',
      ).runs,
    ).toEqual(['npm ci', 'npm run build\nnpm run test:e2e\n']);
  });

  it('reads a script from run: alone, never from a step name or a comment', () => {
    // The named step has NO run: of its own. Named beside a run, as this case
    // first was, a parser reading the names of run-less steps passed it (MR7).
    expect(
      onlyJob(
        '    steps:\n' +
          '      # - run: npm run test:e2e\n' +
          '      - name: npm run test:e2e\n' +
          '        uses: actions/checkout@v7\n' +
          '      - name: install\n' +
          '        run: npm ci\n',
      ).runs,
    ).toEqual(['npm ci']);
  });

  it('lists no scripts for a job with no steps', () => {
    expect(onlyJob('').runs).toEqual([]);
  });

  it('refuses steps that are not a list of mappings with script runs', () => {
    expect(() => onlyJob('    steps: npm test\n')).toThrow(
      /fixture\.yml job 'only': steps is not a list/,
    );
    expect(() => onlyJob('    steps:\n      - npm test\n')).toThrow(
      /fixture\.yml job 'only': step 1 is not a mapping/,
    );
    expect(() => onlyJob('    steps:\n      - run: [npm, test]\n')).toThrow(
      /fixture\.yml job 'only': step 1's run is not a script/,
    );
  });
});

/** One job per budget line, named job0, job1, … in order. */
const jobsBudgeted = (...budgets: string[]): WorkflowJob[] =>
  workflowJobs(
    `jobs:\n${budgets
      .map((budget, i) => `  job${i}:\n    runs-on: ubuntu-latest\n${budget}`)
      .join('')}`,
    'fixture.yml',
  );

const OUT_OF_RANGE = 'is not a whole number of minutes from 1 to 359';

describe('no job runs on the runner default budget (#157)', () => {
  it('pins the default a job with no budget inherits, as GitHub documents it', () => {
    expect(RUNNER_DEFAULT_TIMEOUT_MINUTES).toBe(360);
  });

  it('flags a job declaring no budget, naming what the runner gives it', () => {
    expect(unboundedJobFindings(jobsBudgeted(''))).toEqual([
      'job0 declares no timeout-minutes, so the runner gives it 360 minutes',
    ]);
  });

  it('flags a budget at the default or above, which bounds nothing the default does not', () => {
    expect(
      unboundedJobFindings(
        jobsBudgeted(
          '    timeout-minutes: 360\n',
          '    timeout-minutes: 720\n',
        ),
      ),
    ).toEqual([
      `job0's timeout-minutes of 360 ${OUT_OF_RANGE}`,
      `job1's timeout-minutes of 720 ${OUT_OF_RANGE}`,
    ]);
  });

  it('flags a budget that is no whole, positive number of minutes', () => {
    expect(
      unboundedJobFindings(
        jobsBudgeted(
          '    timeout-minutes: 0\n',
          '    timeout-minutes: -5\n',
          '    timeout-minutes: 2.5\n',
        ),
      ),
    ).toEqual([
      `job0's timeout-minutes of 0 ${OUT_OF_RANGE}`,
      `job1's timeout-minutes of -5 ${OUT_OF_RANGE}`,
      `job2's timeout-minutes of 2.5 ${OUT_OF_RANGE}`,
    ]);
  });

  it('passes whole minutes from 1 to 359, judged over a live population', () => {
    const jobs = jobsBudgeted(
      '    timeout-minutes: 1\n',
      '    timeout-minutes: 359\n',
    );
    expect(
      searched(unboundedJobFindings(jobs), { of: jobs, what: 'fixture jobs' }),
    ).toEqual([]);
    expect(
      floorBreach('workflow-jobs/whole-minute-jobs', jobs.length),
    ).toBeUndefined();
  });

  // GitHub refuses `timeout-minutes` on a job that calls a reusable workflow.
  // Such a job runs nothing itself: the jobs it calls do, and each of those
  // carries its own budget, which this same rule judges in its own file. So
  // the call is bounded exactly when the called file is one this repo's guards
  // read (#163).
  it('reads a job-level uses: as the workflow the job calls', () => {
    const [caller, ordinary] = workflowJobs(
      'jobs:\n  test:\n    uses: ./.github/workflows/ci.yml\n' +
        '  build:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n',
      'fixture.yml',
    );
    expect(caller.uses).toBe('./.github/workflows/ci.yml');
    // GitHub refuses `runs-on` beside a job-level `uses:`, so a caller asks
    // for no runner of its own; the jobs it calls do.
    expect(caller.runsOn).toEqual([]);
    expect(ordinary.uses).toBeUndefined();
    expect(ordinary.runsOn).toEqual(['ubuntu-latest']);
  });

  it('passes a job calling a workflow in this repository, whose own jobs carry the budgets', () => {
    const jobs = workflowJobs(
      'jobs:\n  test:\n    uses: ./.github/workflows/ci.yml\n',
      'fixture.yml',
    );
    expect(
      searched(unboundedJobFindings(jobs), { of: jobs, what: 'fixture jobs' }),
    ).toEqual([]);
    expect(
      floorBreach('workflow-jobs/local-caller-jobs', jobs.length),
    ).toBeUndefined();
  });

  it('flags a job calling a workflow in another repository, whose budgets no guard here can read', () => {
    const elsewhere =
      'octo/elsewhere/.github/workflows/ci.yml@0123456789abcdef0123456789abcdef01234567';
    expect(
      unboundedJobFindings(
        workflowJobs(`jobs:\n  test:\n    uses: ${elsewhere}\n`, 'fixture.yml'),
      ),
    ).toEqual([
      `test calls ${elsewhere}, a workflow outside this repository whose budgets no guard here can read`,
    ]);
  });
});

/**
 * The secrets a job reads, and the environment it reads them in (#241).
 *
 * A job that names an environment reads that environment's secrets. Every
 * other job reads only repository secrets, and a repository secret reaches any
 * branch's workflow. So which secrets a job reads, and where from, is
 * structural, and the pipeline pins in `pipeline-wiring.test.ts` judge it from
 * these two fields. Each case below is one way a secret can be read, or seem
 * to be read and not be.
 */
describe('the secrets a job reads, and the environment it reads them in (#241)', () => {
  it('reads the environment a job names, in both forms GitHub accepts', () => {
    expect(onlyJob('    environment: dev\n').environment).toBe('dev');
    expect(
      onlyJob(
        '    environment:\n      name: prod\n      url: https://shyden.co.uk\n',
      ).environment,
    ).toBe('prod');
    expect(onlyJob('').environment).toBeUndefined();
  });

  it('refuses an environment it cannot read as a name, rather than judging a guess', () => {
    expect(() =>
      onlyJob('    environment:\n      url: https://shyden.co.uk\n'),
    ).toThrow(/fixture\.yml job 'only': environment names no environment/);
    expect(() => onlyJob('    environment: [dev]\n')).toThrow(
      /fixture\.yml job 'only': environment names no environment/,
    );
    // The environment decides which secrets the job gets, and only the runner
    // can resolve this one.
    expect(() => onlyJob('    environment: ${{ inputs.target }}\n')).toThrow(
      /fixture\.yml job 'only': environment is an expression/,
    );
  });

  it("lists every secret a job reads, from its env, a step's env, with: and run:", () => {
    expect(
      onlyJob(
        '    env:\n' +
          '      A: ${{ secrets.JOB_ENV }}\n' +
          '    steps:\n' +
          '      - uses: some/action@v1\n' +
          '        with:\n' +
          '          token: ${{ secrets.STEP_WITH }}\n' +
          '      - env:\n' +
          '          B: ${{ secrets.STEP_ENV }}\n' +
          '        run: echo "${{ secrets.RUN_SCRIPT }}"\n',
      ).secrets,
    ).toEqual(['JOB_ENV', 'RUN_SCRIPT', 'STEP_ENV', 'STEP_WITH']);
  });

  it('lists each secret once, reading the bracket form and a name in any case', () => {
    // Secret names are case-insensitive, so `lower_case` names LOWER_CASE.
    expect(
      onlyJob(
        '    env:\n' +
          "      A: ${{ secrets['BRACKETED'] }}\n" +
          '      B: ${{ secrets.lower_case }}\n' +
          '      C: ${{ secrets.BRACKETED }}\n',
      ).secrets,
    ).toEqual(['BRACKETED', 'LOWER_CASE']);
  });

  it("reads a secret in a run script's shell comment, which the runner expands first, never one in a YAML comment", () => {
    expect(
      onlyJob(
        '    steps:\n' +
          '      # - run: echo ${{ secrets.YAML_COMMENT }}\n' +
          '      - run: |\n' +
          '          # ${{ secrets.SHELL_COMMENT }}\n' +
          '          true\n',
      ).secrets,
    ).toEqual(['SHELL_COMMENT']);
  });

  it('never reads the word secrets outside an expression, or in a string literal inside one', () => {
    expect(
      onlyJob(
        '    steps:\n' +
          '      - run: echo "set secrets.OUTSIDE in the repository settings"\n' +
          '      - run: echo "${{ \'secrets.IN_A_LITERAL\' }}"\n' +
          '      - run: echo "${{ secrets.READ }}"\n',
      ).secrets,
    ).toEqual(['READ']);
  });

  it("attributes a secret in the workflow's own env to every job, since each job reads it", () => {
    const jobs = workflowJobs(
      'env:\n' +
        '  SHARED: ${{ secrets.WORKFLOW_ENV }}\n' +
        'jobs:\n' +
        '  one:\n' +
        '    runs-on: ubuntu-latest\n' +
        '  two:\n' +
        '    runs-on: ubuntu-latest\n' +
        '    env:\n' +
        '      OWN: ${{ secrets.JOB_ENV }}\n',
      'fixture.yml',
    );
    expect(jobs.map(({ id, secrets }) => [id, secrets])).toEqual([
      ['one', ['WORKFLOW_ENV']],
      ['two', ['JOB_ENV', 'WORKFLOW_ENV']],
    ]);
  });

  it('refuses a job handed the whole secrets context, rather than guessing which it uses', () => {
    expect(() => onlyJob('    secrets: inherit\n')).toThrow(
      /fixture\.yml job 'only' reads every secret/,
    );
    expect(() =>
      onlyJob('    env:\n      ALL: ${{ toJSON(secrets) }}\n'),
    ).toThrow(/fixture\.yml job 'only' reads every secret/);
  });

  it('lists GITHUB_TOKEN like any other secret, and none for a job reading none', () => {
    expect(
      onlyJob('    env:\n      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n')
        .secrets,
    ).toEqual(['GITHUB_TOKEN']);
    expect(onlyJob('    steps:\n      - run: npm ci\n').secrets).toEqual([]);
  });
});

describe('a checkout leaves no token behind (#395)', () => {
  const CHECKOUT = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';
  const withInput = (input: string) => `
on: push
jobs:
  build:
    runs-on: ubuntu-26.04
    steps:
      - uses: ${CHECKOUT} # v7.0.1${input}
      - run: npm ci
`;
  const persists = (input: string) =>
    checkoutSteps(withInput(input), 'fixture.yml').map(
      ({ persistsCredentials }) => persistsCredentials,
    );

  it('reads persist-credentials: false as leaving nothing behind', () => {
    expect(
      persists('\n        with:\n          persist-credentials: false'),
    ).toEqual([false]);
  });

  it.each([
    ['no with: at all', ''],
    ['a with: that does not say', '\n        with:\n          fetch-depth: 0'],
    ['true', '\n        with:\n          persist-credentials: true'],
    [
      "the string 'false'",
      "\n        with:\n          persist-credentials: 'false'",
    ],
    [
      'false in a trailing comment only',
      '\n        with: # persist-credentials: false\n          fetch-depth: 0',
    ],
  ])('flags %s as persisting the token', (_, input) => {
    expect(persists(input)).toEqual([true]);
  });

  it('names the file, the job and the step', () => {
    expect(checkoutSteps(withInput(''), 'fixture.yml')).toEqual([
      { where: "fixture.yml job 'build': step 1", persistsCredentials: true },
    ]);
  });

  it('finds a checkout at any version, and no other action', () => {
    const text = `
on: push
jobs:
  a:
    runs-on: ubuntu-26.04
    steps:
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020
      - run: echo actions/checkout@v7
      - uses: actions/checkout@v4
  b:
    runs-on: ubuntu-26.04
    steps:
      - uses: ${CHECKOUT}
        with:
          persist-credentials: false
`;
    expect(checkoutSteps(text, 'f.yml')).toEqual([
      { where: "f.yml job 'a': step 3", persistsCredentials: true },
      { where: "f.yml job 'b': step 1", persistsCredentials: false },
    ]);
  });
});

/**
 * An aggregate judges its needs in a step (#163, #582): it runs `always()`, so
 * a skip upstream never skips it, and an `always()` step is handed every
 * need's result. Only that exact shape is excused from asking for success in
 * its condition; every near miss is still flagged.
 */
const aggregateShape = ({
  condition = '    if: always()\n',
  stepIf = '        if: always()\n',
  env = "'${{ toJSON(needs) }}'",
} = {}) => `name: fixture
on: pull_request
jobs:
  maybe:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
  aggregate:
    needs: [maybe]
${condition}    runs-on: ubuntu-latest
    steps:
      - name: Judge every need
${stepIf}        env:
          NEEDS_JSON: ${env}
        run: node judge.mjs
`;

const aggregateJob = (shape: Parameters<typeof aggregateShape>[0]) =>
  workflowJobs(aggregateShape(shape), 'fixture.yml').find(
    ({ id }) => id === 'aggregate',
  ) as WorkflowJob;

const NEVER_REQUIRES =
  "aggregate's if: never requires needs.maybe.result == 'success', so it can run after maybe was skipped or failed";

describe('an aggregate judges its needs in a step, and only that shape is excused (#582)', () => {
  it('excuses the aggregate from asking for success in its condition', () => {
    expect(isAggregate(aggregateJob({}))).toBe(true);
    expect(
      skippedUpstreamFindings(workflowJobs(aggregateShape(), 'fixture.yml')),
    ).toEqual([]);
  });

  it.each([
    ['a judging step with no condition', { stepIf: '' }],
    [
      'a judging step that runs only on success',
      { stepIf: '        if: success()\n' },
    ],
    [
      'a job condition that is more than always()',
      { condition: '    if: always() && true\n' },
    ],
    [
      'a job condition of !cancelled()',
      { condition: '    if: ${{ !cancelled() }}\n' },
    ],
    [
      'a step handed one need, not every need',
      { env: "'${{ toJSON(needs.maybe) }}'" },
    ],
    ['a step handed something else', { env: "'${{ toJSON(github) }}'" }],
  ])('still flags %s', (_, shape) => {
    expect(isAggregate(aggregateJob(shape))).toBe(false);
    expect(
      skippedUpstreamFindings(
        workflowJobs(aggregateShape(shape), 'fixture.yml'),
      ),
    ).toContain(NEVER_REQUIRES);
  });
});
