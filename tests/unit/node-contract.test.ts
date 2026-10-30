import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { nonEmpty, searched } from '../source-files';
import { withoutIniComments, withoutYamlComments } from './source-text';

/**
 * The Node version this repo runs on is stated ONCE, and everything agrees.
 *
 * `.nvmrc` is the single source of truth. Every CI job reads it via
 * `node-version-file:`, so CI cannot drift. But `.nvmrc` is invisible to npm:
 * a contributor on volta, asdf, fnm-without-nvmrc, or a system Node installs
 * happily on Node 20 and the failure surfaces much later, at build or test
 * time, as a confusing runtime error instead of at install time as a clear
 * one. `engines` + `engine-strict` is what closes that hole (#31).
 *
 * Three ways the contract can rot, and this file guards all three:
 *
 * 1. `.nvmrc` is bumped and `engines` is not — npm now permits a Node that CI
 *    never exercises.
 * 2. `engines` is bumped and `.nvmrc` is not — CI now runs a Node that npm
 *    refuses to install on.
 * 3. A NEW workflow hardcodes `node-version: 20` instead of reading the file,
 *    quietly reintroducing the drift that `node-version-file:` removed. Found
 *    by the #31 sweep: all six existing references were already correct, but
 *    nothing stopped a seventh from being wrong.
 *
 * PARSED, NOT GREPPED. Every value below is read structurally — JSON.parse for
 * package.json, key=value for .npmrc, comment-stripped text for workflows.
 * A source-text guard is satisfied by the file's own documentation: the
 * dependabot sub-path guard passed for weeks against a COMMENT while no group
 * was configured at all (#23). Prose must never be able to satisfy an
 * assertion here.
 */

const WORKFLOWS = '.github/workflows';

/** `.nvmrc` as a major integer. `24`, `v24`, and trailing newlines all mean 24. */
const nvmrcMajor = (): number => {
  const raw = readFileSync('.nvmrc', 'utf8').trim().replace(/^v/i, '');
  const major = Number(raw.split('.')[0]);
  if (!Number.isInteger(major)) {
    throw new Error(
      `.nvmrc is not a parseable version: ${JSON.stringify(raw)}`,
    );
  }
  return major;
};

/**
 * `content`, a `.nvmrc`, as one exact `x.y.z` release, or a refusal naming
 * what it holds (#982). A bare major lets setup-node fetch the newest release
 * on every run, so CI's Node would change with no pull request.
 */
const exactNodeVersion = (content: string): string => {
  const raw = content.trim().replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(raw)) {
    throw new Error(
      `.nvmrc must name one exact release (x.y.z), not ${JSON.stringify(content.trim())}`,
    );
  }
  return raw;
};

const packageJson = (): Record<string, unknown> =>
  JSON.parse(readFileSync('package.json', 'utf8'));

/** `engines.node` as written. */
const enginesRange = (): string => {
  const engines = packageJson().engines as { node?: string } | undefined;
  const range = engines?.node;
  if (typeof range !== 'string') {
    throw new Error('package.json has no engines.node');
  }
  return range;
};

/**
 * The FLOOR of each alternative `engines.node` admits, as
 * `[major, minor, patch]`, in the order written.
 *
 * A range may hold alternatives (`^24.16.0 || >=26.3.0`, #646: Dependabot's
 * npm updater installs on Node 24, so 24 stays admitted while `.nvmrc` moves
 * to 26). Each one is read on its own. Deliberately tolerant of how a floor is
 * written (`>=24`, `>= 24.0.0`, `^24.0.0`) but strict that every alternative
 * states one: an alternative with no lower bound states no contract and must
 * not pass. A part the range leaves out reads as 0, the way npm reads `>=24`.
 */
const enginesFloors = (): [number, number, number][] => {
  const range = enginesRange();
  return range.split('||').map((alternative) => {
    const floor = alternative
      .trim()
      .match(/^(?:>=|\^|~)?\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!floor) {
      throw new Error(
        `engines.node alternative ${JSON.stringify(alternative.trim())} states no floor: ${JSON.stringify(range)}`,
      );
    }
    return [Number(floor[1]), Number(floor[2] ?? 0), Number(floor[3] ?? 0)];
  });
};

/** The major of a caret or exact version (`^26.6.5`, `26.6.5`). */
const majorOf = (version: string): number => {
  const major = version.match(/^\^?(\d+)\.\d+\.\d+$/);
  if (!major) {
    throw new Error(`not a caret or exact version: ${JSON.stringify(version)}`);
  }
  return Number(major[1]);
};

/** Negative, zero or positive as version `a` is below, at or above `b`. */
const compareVersions = (a: readonly number[], b: readonly number[]): number =>
  a.map((part, i) => part - b[i]).find((difference) => difference !== 0) ?? 0;

/** `.npmrc` parsed as key=value, comments and blank lines discarded. */
const npmrc = (): Map<string, string> => {
  const entries = new Map<string, string>();
  if (!existsSync('.npmrc')) return entries;
  for (const line of withoutIniComments(readFileSync('.npmrc', 'utf8')).split(
    '\n',
  )) {
    const stripped = line.trim();
    if (!stripped.includes('=')) continue;
    const [key, ...rest] = stripped.split('=');
    entries.set(key.trim(), rest.join('=').trim());
  }
  return entries;
};

/** Workflow files with comments stripped, so prose cannot satisfy a guard. */
const workflowBodies = (): [string, string][] =>
  nonEmpty(
    readdirSync(WORKFLOWS).filter(
      (f) => f.endsWith('.yml') || f.endsWith('.yaml'),
    ),
    `workflow files in ${WORKFLOWS}`,
  ).map((f) => [
    f,
    withoutYamlComments(readFileSync(join(WORKFLOWS, f), 'utf8')),
  ]);

describe('the Node version contract is stated once and agreed everywhere', () => {
  it('declares engines.node in package.json', () => {
    expect(packageJson().engines).toBeDefined();
    expect(enginesFloors().length).toBeGreaterThan(0);
  });

  // The levels themselves, as literals (#646, global rule 2026-10-08: every
  // project on Node 26, 26.3 or later). A figure asserted against the file it
  // was read from would move with it and pin nothing.
  it('runs on Node 26 (#646)', () => {
    expect(nvmrcMajor()).toBe(26);
  });

  // One exact release, so CI's Node changes only in the pull request that
  // bumps it (#982, global rule 2026-10-29). The literal moves with each bump.
  it('names the exact release every project runs (#982)', () => {
    expect(exactNodeVersion(readFileSync('.nvmrc', 'utf8'))).toBe('26.12.1');
  });

  it.each(['26', '26.12', '26.x', 'lts/*', 'node', '', '26.12.1-rc.1'])(
    'refuses an .nvmrc of %j, which names no one release (#982)',
    (content) => {
      expect(() => exactNodeVersion(`${content}\n`)).toThrow(
        `.nvmrc must name one exact release (x.y.z), not ${JSON.stringify(content)}`,
      );
    },
  );

  it('reads an exact release whatever its v prefix or newline (#982)', () => {
    expect(exactNodeVersion('v26.12.1\n')).toBe('26.12.1');
  });

  it('admits Node 26.3 or later, and the 24 line Dependabot installs on (#646)', () => {
    // dependabot-core's npm_and_yarn image installs on Node 24, and
    // engine-strict would refuse an install there if 24 left the range.
    expect(enginesRange()).toBe('^24.16.0 || >=26.3.0');
  });

  it('enforces engines at install time via .npmrc engine-strict', () => {
    // Advisory `engines` only WARNS and lets the wrong Node through, which
    // defeats the point of declaring it. Operator decision on #31: strict.
    expect(npmrc().get('engine-strict')).toBe('true');
  });

  // #929: on 2026-10-22 from about 02:30 to 03:15Z every CI job's `npm ci`
  // took 301-303 s instead of 5 (47 jobs over three runs), npm's default
  // 300 s fetch-timeout waited out in silence, and sanity-on-build's 5-minute
  // limit cancelled it on every pull request. A stalled request now fails at
  // once, naming its URL, and is never retried (Shyden, 2026-10-02: a retry
  // is not a fix).
  it('retries no request npm makes (#929)', () => {
    expect(npmrc().get('fetch-retries')).toBe('0');
  });

  it('fails a request at the measured fetch-timeout (#929)', () => {
    // Measured on probe run 39731697441: 20 installs in CI's image, 10 with
    // the npm cache and 10 cold, all green in 4-8 s; the slowest single
    // request 6,770 ms (the astro tarball, cold), the slowest warm 2,011 ms
    // (the audit). 60 s is about nine times the slowest.
    expect(npmrc().get('fetch-timeout')).toBe('60000');
  });

  it('lets no workflow or package script set npm’s fetch settings over .npmrc (#929)', () => {
    // A flag (`--fetch-retries=2`) or an environment variable
    // (`npm_config_fetch_timeout`) beats .npmrc for that one install.
    const sources: [string, string][] = [
      ...workflowBodies(),
      ...Object.entries(
        (packageJson().scripts as Record<string, string> | undefined) ?? {},
      ).map(([name, script]): [string, string] => [
        `package.json › ${name}`,
        script,
      ]),
    ];
    const overriding = sources
      .filter(([, body]) =>
        /fetch[-_](?:retries|retry[-_]|timeout)/i.test(body),
      )
      .map(([source]) => source);
    expect(
      searched(overriding, {
        of: sources,
        what: 'workflow files and package scripts',
      }),
    ).toEqual([]);
    expect(
      floorBreach('node-contract/fetch-setting-sources', sources.length),
    ).toBeUndefined();
  });

  it('keeps the highest engines.node floor and .nvmrc on the same major, in both directions', () => {
    // One assertion, two failure modes: bumping either file alone breaks it.
    // The highest floor is the line CI runs; a lower alternative (#646's 24)
    // stays admitted for installers that cannot move yet.
    const majors = enginesFloors().map(([major]) => major);
    expect(Math.max(...majors)).toBe(nvmrcMajor());
  });

  it('names floors that ship import.meta.main, which every entry script relies on (#221)', () => {
    // From Node's changelog, not from memory: v24.2.0 (2025-06-09) lists
    // "import.meta.main is now available", commit adef9af3ae, nodejs/node#57804.
    // Below it the expression is `undefined`, so every script that asks it
    // would skip `main()` and exit 0 without a word (`script-entry.test.ts`).
    // Every alternative is a Node npm will install on, so every one is judged.
    const floors = enginesFloors();
    const below = floors
      .filter((floor) => compareVersions(floor, [24, 2, 0]) < 0)
      .map((floor) => floor.join('.'));
    expect(
      searched(below, { of: floors, what: 'engines.node alternatives' }),
    ).toEqual([]);
    expect(
      floorBreach('node-contract/engine-alternatives', floors.length),
    ).toBeUndefined();
  });

  // The types describe the Node CI runs, not the newest one, nor the older
  // one npm would otherwise resolve through vitest and vite (#646, operator
  // 2026-10-09: declare it).
  it('declares @types/node on the major .nvmrc names (#646)', () => {
    const declared = (
      packageJson().devDependencies as Record<string, string> | undefined
    )?.['@types/node'];
    expect(declared, 'devDependencies["@types/node"]').toBeTypeOf('string');
    expect(majorOf(declared ?? '')).toBe(nvmrcMajor());
  });

  it('installs @types/node on the major .nvmrc names (#646)', () => {
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
      packages?: Record<string, { version?: string }>;
    };
    const installed = lock.packages?.['node_modules/@types/node']?.version;
    expect(installed, 'the lock installs @types/node').toBeTypeOf('string');
    expect(majorOf(installed ?? '')).toBe(nvmrcMajor());
  });

  it('reads Node from .nvmrc in every workflow that sets Node up', () => {
    for (const [file, body] of workflowBodies()) {
      const setups = body.match(/uses:\s*actions\/setup-node@/g)?.length ?? 0;
      const fromFile = body.match(/node-version-file:\s*\.nvmrc/g)?.length ?? 0;
      expect(
        fromFile,
        `${file}: ${setups} setup-node step(s) but ${fromFile} reading .nvmrc`,
      ).toBe(setups);
    }
  });

  it('never hardcodes a Node version in a workflow', () => {
    // `node-version-file:` does not match: the char after "node-version" is
    // "-", not ":". Only a literal `node-version: 20` trips this.
    for (const [file, body] of workflowBodies()) {
      expect(body, `${file} hardcodes a Node version`).not.toMatch(
        /node-version:\s*\S/,
      );
    }
  });
});

describe('the Node running this suite reads the plural rules CI reads (#953)', () => {
  // A version number does not fix Intl's data. Homebrew rebuilt Node 26.12.1
  // against the Mac's own ICU, CLDR moved from 48 to 49 under the same
  // number, and Vietnamese gained a `one` plural on the Mac alone. The plural
  // tests, message-parity and the translation tool all read Intl, so they are
  // written for one CLDR: the official build's, which CI installs.
  //
  // The pin is an alarm, and stays one (Shyden 2026-10-26: "if it's failing
  // then it needs to be addressed, not hidden"). CI takes each new Node 26
  // release, so the one that brings CLDR 49 fails every pull request here;
  // the failure names the fix prepared for that day (#955).
  const cldrAlarm = (
    versions: Readonly<Record<string, string | undefined>>,
  ): string | undefined => {
    const { cldr, icu } = versions;
    if (cldr === '48.0' && icu?.split('.')[0] === '78') return undefined;
    return (
      `this Node reads CLDR ${cldr} on ICU ${icu}, and the plural tests are written for CLDR 48 on ICU 78. ` +
      `If CI reads it too, a Node release moved its language data: the fix is prepared in #955, on branch 955-cldr-49. ` +
      `If only this Mac does, run the official nodejs.org build (~/.local/share/node/current/bin), as CI does.`
    );
  };

  it('is CLDR 48 on ICU 78, the official Node build', () => {
    expect(cldrAlarm(process.versions)).toBeUndefined();
  });

  it('accepts a later ICU 78 patch, which keeps CLDR 48', () => {
    expect(cldrAlarm({ cldr: '48.0', icu: '78.9' })).toBeUndefined();
  });

  it('a Node on other plural rules is told where the prepared fix is', () => {
    const alarm = cldrAlarm({ cldr: '49.0', icu: '79.1' });
    expect(alarm).toContain('CLDR 49.0 on ICU 79.1');
    expect(alarm).toContain('#955');
    expect(alarm).toContain('branch 955-cldr-49');
    expect(alarm).toContain('~/.local/share/node/current/bin');
  });

  it('a CLDR change inside ICU 78 still sounds the alarm', () => {
    expect(cldrAlarm({ cldr: '48.1', icu: '78.3' })).toContain('#955');
  });

  it('a new ICU major sounds the alarm even before its CLDR moves', () => {
    expect(cldrAlarm({ cldr: '48.0', icu: '79.1' })).toContain('#955');
  });
});
