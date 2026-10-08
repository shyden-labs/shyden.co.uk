import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  DEPENDABOT,
  declaredLabels,
  labelRefusal,
  missingLabels,
} from '../../scripts/dependabot-labels.mjs';
import { workflowJobs } from '../workflow-jobs';
import { nonEmpty, searched } from '../source-files';
import { floorBreach } from '../floors';

/**
 * `.github/dependabot.yml` names labels; the repository either has them or it
 * does not.
 *
 * The half a unit test CAN reach is the derivation — which labels the config
 * asks for — and whether anything in CI goes on to check them. The other half
 * needs a token and lives in `scripts/dependabot-labels.mjs`, run by
 * `ci.yml`'s `checks` job (dependabot-labels-script.test.ts drives it).
 *
 * Why the file exists at all: Dependabot creates a label only when no
 * `labels:` key names one. This repo set that key, so `npm` and
 * `github-actions` were asked for, never created, dropped from every pull
 * request and replaced by a configuration-error comment — from 2026-09-21
 * until #299 measured it a day later.
 */

const CI = '.github/workflows/ci.yml';
const REQUIRED_JOB = 'build-and-test';

const config = () => readFileSync(DEPENDABOT, 'utf8');

describe('the labels dependabot.yml asks for', () => {
  it('are derived from every ecosystem, not from a list someone typed', () => {
    const labels = nonEmpty(
      declaredLabels(config()),
      `labels declared in ${DEPENDABOT}`,
    );

    // An exact set, not three memberships: `toContain` would pass on a config
    // that had quietly gained a fourth label nobody created, which is the very
    // failure this file exists for. The ecosystem labels are the point of the
    // `labels:` key -- without them a dependency PR says only `dependencies`,
    // and an npm bump is indistinguishable from an action bump at a glance.
    expect(labels).toEqual(['dependencies', 'docker', 'github-actions', 'npm']);
  });

  it('come from the parsed document, so a comment cannot add one', () => {
    const invented = 'a-label-that-only-a-comment-names';
    const withComment = `${config()}\n# labels:\n#   - '${invented}'\n`;

    // `searched` sits INSIDE the expectation, which is the idiom
    // `absence-liveness.test.ts` recognises: a population bound to a variable
    // first is invisible to it, and widening that detector to see my spelling
    // is how a mandatory control acquires an escape hatch (#118).
    const declared = declaredLabels(withComment);
    expect(
      searched(
        declared.filter((name) => name === invented),
        { of: declared, what: 'declared labels' },
      ),
    ).toHaveLength(0);
    expect(
      floorBreach('dependabot-labels/declared-labels', declared.length),
    ).toBeUndefined();
  });

  it('are deduplicated and sorted, so the refusal reads the same every run', () => {
    const labels = declaredLabels(config());

    expect(labels).toEqual([...new Set(labels)].sort());
  });

  it('are none at all when the config declares none — the liveness control', () => {
    // The whole check is satisfied for free by an empty set, which is why the
    // script refuses one rather than reporting a clean pass (#112, #118).
    // An empty `updates` has no entry to walk, so the units here are the
    // document's own lines: what the reader parsed before finding none.
    const bare = 'version: 2\nupdates: []\n';
    const lines = bare.split('\n').filter((line) => line !== '');
    expect(
      searched(declaredLabels(bare), {
        of: lines,
        what: 'lines of the label-less config',
      }),
    ).toHaveLength(0);
    expect(
      floorBreach('dependabot-labels/label-less-config-lines', lines.length),
    ).toBeUndefined();
  });

  it('refuse a label YAML does not read as text, rather than dropping it', () => {
    // `7`, `1.0`, `~` and `true` parse as a number, a number, null and a
    // boolean. Filtering them out left a label nobody checked, and `1.0` is
    // not even the text the author wrote once it has been read.
    const config =
      'version: 2\nupdates:\n  - package-ecosystem: npm\n' +
      '    labels: [npm, 7, 1.0, ~, true]\n';

    expect(() => declaredLabels(config)).toThrow(
      `${DEPENDABOT} names labels YAML does not read as text: 7, 1, null, true.\n` +
        "Quote each one, e.g. labels: ['7'].",
    );
  });

  it('refuse a config that does not parse, naming the file', () => {
    expect(() => declaredLabels('updates: [\n')).toThrow(
      `cannot parse ${DEPENDABOT}: `,
    );
  });
});

describe('a declared label with nothing behind it', () => {
  it('is reported missing', () => {
    expect(missingLabels(['npm', 'dependencies'], ['dependencies'])).toEqual([
      'npm',
    ]);
  });

  it('is not reported when the repository spells it in another case', () => {
    // GitHub treats two labels differing only in case as the same label, so an
    // exact match would go red on a repository that is perfectly configured.
    const declared = ['GitHub-Actions'];
    expect(
      searched(missingLabels(declared, ['github-actions']), {
        of: declared,
        what: 'declared labels',
      }),
    ).toHaveLength(0);
    expect(
      floorBreach('dependabot-labels/respelled-labels', declared.length),
    ).toBeUndefined();
  });

  it('names itself and the command that creates it in the refusal', () => {
    const refusal = labelRefusal(['npm'], ['dependencies', 'javascript']);

    expect(refusal).toContain('npm');
    expect(refusal).toContain('gh label create');
    // The reader is in a CI log with no repository in front of them, so the
    // refusal carries what the repository does have.
    expect(refusal).toContain('javascript');
  });
});

describe('the check that reads repository state', () => {
  it(`runs inside ${REQUIRED_JOB} or a job it stands for, the context branch protection requires`, () => {
    const jobs = nonEmpty(
      workflowJobs(readFileSync(CI, 'utf8'), CI),
      `jobs in ${CI}`,
    );
    const job = jobs.find(({ id }) => id === REQUIRED_JOB);
    expect(job, `${CI} has no ${REQUIRED_JOB} job`).toBeDefined();

    // A job outside `required_status_checks.contexts` is not a gate however
    // green it is (#33), so the check belongs in the context already required
    // rather than in a new job of its own. Since the suite was split (#163)
    // that context stands for the jobs it needs, passing only when each of
    // them SUCCEEDED (scripts/e2e-shards.mjs), so a job it needs gates as
    // surely as a step of its own.
    const gating = jobs.filter(
      ({ id }) => id === REQUIRED_JOB || (job?.needs ?? []).includes(id),
    );
    const runs = gating.flatMap((each) => each.runs);
    const invocations = searched(
      runs.filter((run) => run.includes('scripts/dependabot-labels.mjs')),
      {
        of: runs,
        what: `run steps in ${REQUIRED_JOB} and the jobs it stands for`,
      },
    );

    expect(invocations).toHaveLength(1);
    expect(
      floorBreach('dependabot-labels/gating-run-steps', runs.length),
    ).toBeUndefined();
  });
});
