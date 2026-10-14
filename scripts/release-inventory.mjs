/**
 * What a release carries (#362): every commit on the first-parent line from
 * production to the head being released, with the files each one brought to
 * that line, and the tests whose captures show it.
 *
 * TWO SHAPES OF "ONE PULL REQUEST", ONE RULE
 *
 * `develop` took squash merges until #157 and merge commits after it, so a
 * walk over merges alone skips the squash era, and with it the whole zh/vi/th
 * rollout (#22). Every first-parent commit is read, and each is diffed against
 * ITS FIRST PARENT: what it brought to the line, whichever shape it has. A
 * merge's two parents are never diffed against each other. For a branch that
 * sat behind `develop`, that reports everything `develop` gained meanwhile as
 * the pull request's own work: #108's merge counted three `src/` files it
 * never touched.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import ts from 'typescript';
import { messageOf } from './errors.mjs';

/** The directories whose files a visitor receives. */
export const VISITOR_PREFIXES = Object.freeze([
  'src/',
  'functions/',
  'migrations/',
  'public/',
]);

/** @typedef {(args: string[]) => string} Git */

/**
 * @typedef {object} Commit
 * @property {string} sha
 * @property {string[]} parents
 * @property {string} subject
 * @property {string[]} files
 */

/**
 * @typedef {object} Entry
 * @property {string} sha
 * @property {string} subject
 * @property {number | null} pr
 * @property {number | null} ticket
 * @property {string[]} files
 * @property {boolean} visitorFacing
 * @property {string[]} areas
 */

/** @param {string} text */
const linesOf = (text) => text.split('\n').filter((line) => line !== '');

/**
 * @param {{ base: string, head: string, git: Git }} input
 * @returns {Commit[]}
 */
export const readCommits = ({ base, head, git }) => {
  try {
    git(['merge-base', '--is-ancestor', base, head]);
  } catch (error) {
    // `--is-ancestor` answers no with status 1. Any other failure is git's
    // own, such as a name that is no commit, and its message says which.
    if (/** @type {{ status?: unknown } | null} */ (error)?.status !== 1)
      throw error;
    throw new Error(
      `release-inventory: ${base} is not an ancestor of ${head}, so no line of commits runs from one to the other`,
    );
  }
  return linesOf(
    git(['rev-list', '--first-parent', '--reverse', `${base}..${head}`]),
  ).map((sha) => {
    const [, ...parents] = git(['rev-list', '--parents', '-n', '1', sha])
      .trim()
      .split(' ');
    const [first] = parents;
    if (first === undefined || parents.length > 2)
      throw new Error(
        `release-inventory: ${sha} has ${parents.length} parents; a release reads merges (2) and squashes (1), and anything else needs its own rule`,
      );
    return {
      sha,
      parents,
      subject: git(['log', '-1', '--format=%s', sha]).trim(),
      files: linesOf(git(['diff', '--name-only', first, sha])),
    };
  });
};

const MERGE = /^Merge pull request #(\d+) from [^/\s]+\/(\S+)/;
const REF = /\(#(\d+)\)/g;

/**
 * @param {readonly Commit[]} commits
 * @returns {Entry[]}
 */
export const inventoryOf = (commits) =>
  commits.map(({ sha, subject, files }) => {
    const merge = MERGE.exec(subject);
    const refs = [...subject.matchAll(REF)].map((m) => Number(m[1]));
    /** @type {number | null} */
    let pr = null;
    /** @type {number | null} */
    let ticket = null;
    if (merge) {
      pr = Number(merge[1]);
      const lead = /^(\d+)-/.exec(merge[2] ?? '');
      ticket = lead ? Number(lead[1]) : null;
    } else if (refs.length > 0) {
      pr = refs[refs.length - 1] ?? null;
      ticket = refs.length > 1 ? (refs[0] ?? null) : null;
    }
    return {
      sha,
      subject,
      pr,
      ticket,
      files,
      visitorFacing: files.some((file) =>
        VISITOR_PREFIXES.some((prefix) => file.startsWith(prefix)),
      ),
      areas: [
        ...new Set(
          files.map((file) =>
            file.includes('/') ? file.slice(0, file.indexOf('/')) : '(root)',
          ),
        ),
      ].sort(),
    };
  });

/**
 * @param {{ base: string, head: string, git: Git }} input
 * @returns {{ base: string, head: string, entries: Entry[] }}
 */
export const inventoryFor = ({ base, head, git }) => {
  /** @param {string} ref */
  const full = (ref) =>
    git(['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  const from = full(base);
  const to = full(head);
  return {
    base: from,
    head: to,
    entries: inventoryOf(readCommits({ base: from, head: to, git })),
  };
};

/**
 * The line of every `test(` call in a spec that captures evidence of the
 * site: its callback calls `shoot(`, or a function of the same file that
 * does, followed to a fixed point, because `classroom-groups-projector` captures
 * only through `expectNothingOutOfReach`. Parsed, not grepped, so a comment
 * naming `shoot(` decides nothing. The evidence tooling's own spec, which
 * imports `../evidence-fixture`, captures a fixture page, not the site.
 *
 * @param {string} file
 * @param {string} source
 * @returns {number[]}
 */
const capturingLines = (file, source) => {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  /**
   * The names `root` calls: every bare callee, and `shoot` reached through a
   * namespace import (`evidence.shoot(`, #465). Any other property call is
   * left out, so `page.once(` never stands for a helper named `once`.
   *
   * @param {ts.Node} root
   */
  const callsIn = (root) => {
    /** @type {Set<string>} */
    const names = new Set();
    /** @param {ts.Node} node */
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (ts.isIdentifier(callee)) names.add(callee.text);
        else if (
          ts.isPropertyAccessExpression(callee) &&
          callee.name.text === 'shoot'
        )
          names.add('shoot');
      }
      ts.forEachChild(node, visit);
    };
    visit(root);
    return names;
  };
  /** @type {Map<string, Set<string>>} */
  const functions = new Map();
  /** @type {{ line: number, calls: Set<string> }[]} */
  const tests = [];
  let tooling = false;
  /** @param {ts.Node} node */
  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === '../evidence-fixture'
    )
      tooling = true;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    )
      functions.set(node.name.text, callsIn(node.initializer));
    if (ts.isFunctionDeclaration(node) && node.name)
      functions.set(node.name.text, callsIn(node));
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'test'
    ) {
      const callback = node.arguments[node.arguments.length - 1];
      if (node.arguments.length >= 2 && callback)
        tests.push({
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          calls: callsIn(callback),
        });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (tooling) return [];
  const shooting = new Set(['shoot']);
  for (let grew = true; grew;) {
    grew = false;
    for (const [name, calls] of functions)
      if (!shooting.has(name) && [...calls].some((c) => shooting.has(c))) {
        shooting.add(name);
        grew = true;
      }
  }
  return [
    ...new Set(
      tests
        .filter((t) => [...t.calls].some((c) => shooting.has(c)))
        .map((t) => t.line),
    ),
  ].sort((a, b) => a - b);
};

/**
 * @param {readonly string[]} files
 * @param {(file: string) => string} read
 * @returns {string[]} `file:line` of every capturing test
 */
export const releaseTests = (files, read) =>
  files.flatMap((file) =>
    capturingLines(file, read(file)).map((line) => `${file}:${line}`),
  );

const USAGE =
  'usage: release-inventory.mjs --base <sha> --head <sha> | --tests';

const main = () => {
  /** @type {{ base?: string, head?: string, tests?: boolean }} */
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        base: { type: 'string' },
        head: { type: 'string' },
        tests: { type: 'boolean' },
      },
    }));
  } catch (error) {
    console.error(`release-inventory: ${messageOf(error)}`);
    console.error(USAGE);
    process.exit(2);
  }
  /** @type {Git} */
  const git = (args) =>
    execFileSync('git', args, {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
  if (values.tests) {
    // The specs git tracks: the capture runs what is committed, and git's list
    // cannot disagree with that, where a directory read can.
    const files = git(['ls-files', '-z', '--', 'tests/e2e/*.spec.ts'])
      .split('\0')
      .filter((file) => /^tests\/e2e\/[^/]+\.spec\.ts$/.test(file))
      .sort();
    const selection = releaseTests(files, (file) => readFileSync(file, 'utf8'));
    if (selection.length === 0) {
      console.error(
        'release-inventory: no test captures the site; an empty selection would run every test',
      );
      process.exit(1);
    }
    console.log(selection.join('\n'));
    return;
  }
  if (!values.base || !values.head) {
    console.error(USAGE);
    process.exit(2);
  }
  console.log(
    JSON.stringify(
      inventoryFor({ base: values.base, head: values.head, git }),
      null,
      2,
    ),
  );
};

if (import.meta.main) main();
