import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { filesUnder, searched } from '../source-files';
import { parseFile, parseSource, where } from './ast';
import { scriptCheckout, type ScriptCheckout } from './script-checkout';

/**
 * A script asks "was I run directly?" with `import.meta.main`, and with
 * nothing else (#221).
 *
 * `scripts/` spelled that question three ways, every one a comparison against
 * `process.argv[1]`, and every one wrong for some checkout:
 *
 * - against a `file://` template around the raw path, which fails on any
 *   character a URL encodes, a space included, because `import.meta.url` is
 *   encoded and `argv[1]` is not;
 * - against `fileURLToPath(import.meta.url)`, which fails through a symlink,
 *   because Node resolves the link in the URL and not in `argv[1]`;
 * - with `endsWith` on the script's own name, which is true for ANY entry file
 *   whose name ends that way.
 *
 * Every failure is silent: `main()` never runs, the process exits 0, and
 * whatever runs next reads a stale result or none. Node has answered the
 * question itself since v24.2.0, so no path is compared at all; the floor that
 * guarantees it is pinned in `node-contract.test.ts`.
 *
 * Judged on the parse tree, so a comment can neither trip a rule nor satisfy
 * one.
 */

/** `process.argv[1]`, with or without `?.`. */
const isArgvEntry = (node: ts.Node): boolean =>
  ts.isElementAccessExpression(node) &&
  ts.isNumericLiteral(node.argumentExpression) &&
  node.argumentExpression.text === '1' &&
  ts.isPropertyAccessExpression(node.expression) &&
  node.expression.name.text === 'argv' &&
  ts.isIdentifier(node.expression.expression) &&
  node.expression.expression.text === 'process';

/** Where a file reads `process.argv[1]`. */
const argvEntryReads = (sf: ts.SourceFile): string[] => {
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (isArgvEntry(node)) found.push(where(sf, node));
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
};

/** `import.meta.main`, spelled exactly. */
const isImportMetaMain = (node: ts.Node): boolean =>
  ts.isPropertyAccessExpression(node) &&
  node.name.text === 'main' &&
  ts.isMetaProperty(node.expression) &&
  node.expression.keywordToken === ts.SyntaxKind.ImportKeyword;

/** Every `main()` call made while the file loads, outside any function body. */
const loadTimeMainCalls = (sf: ts.SourceFile): ts.CallExpression[] => {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'main'
    )
      calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return calls;
};

/** A condition a call sits under, and whether the call runs when it holds. */
interface Gate {
  readonly condition: ts.Expression;
  readonly holds: boolean;
}

const SHORT_CIRCUIT = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

/**
 * Every condition between a call and the top of its file, innermost first.
 * The call runs when an `if`, a `?:` or an `&&` holds, and when an `else`,
 * the other arm of a `?:`, an `||` or a `??` fails.
 */
const gatesOf = (call: ts.Node): Gate[] => {
  const gates: Gate[] = [];
  let child: ts.Node = call;
  for (let node = call.parent; node; child = node, node = node.parent) {
    if (ts.isIfStatement(node) && child !== node.expression)
      gates.push({
        condition: node.expression,
        holds: child === node.thenStatement,
      });
    else if (ts.isConditionalExpression(node) && child !== node.condition)
      gates.push({ condition: node.condition, holds: child === node.whenTrue });
    else if (
      ts.isBinaryExpression(node) &&
      child === node.right &&
      SHORT_CIRCUIT.has(node.operatorToken.kind)
    )
      gates.push({
        condition: node.left,
        holds:
          node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken,
      });
  }
  return gates;
};

/** A load-time `main()` call some condition decides. */
interface Decision {
  readonly at: string;
  /** Each condition as written, `not (...)` where the call needs it to fail. */
  readonly under: readonly string[];
  readonly byImportMetaMain: boolean;
}

/**
 * Every place a file decides whether to run `main()` as it loads. A call no
 * condition governs is not a decision: it runs every time, so it can never
 * be skipped in silence.
 */
const entryDecisions = (sf: ts.SourceFile): Decision[] =>
  loadTimeMainCalls(sf)
    .map((call) => ({ call, gates: gatesOf(call) }))
    .filter(({ gates }) => gates.length > 0)
    .map(({ call, gates }) => ({
      at: where(sf, call),
      under: gates.map(({ condition, holds }) =>
        holds ? condition.getText(sf) : `not (${condition.getText(sf)})`,
      ),
      byImportMetaMain:
        gates.length === 1 &&
        gates[0].holds &&
        isImportMetaMain(gates[0].condition),
    }));

/** A fixture parsed as a module, as every script is. */
const fixture = (body: string) =>
  parseSource(`import 'node:process';\n${body}\n`, 'fixture.mjs');

/** What the rules make of a fixture: how many decisions, and the wrong ones. */
const judge = (body: string) => {
  const decisions = entryDecisions(fixture(body));
  return {
    decided: decisions.length,
    wrong: decisions.filter((d) => !d.byImportMetaMain).map((d) => d.under),
  };
};

describe('the entry-check rules read the parse tree (#221)', () => {
  it.each([
    ['if (import.meta.main) main();'],
    ['if (import.meta.main) await main();'],
    ['import.meta.main && main();'],
    ['import.meta.main ? main() : null;'],
    ['/* if (process.argv[1] === x) main(); */ if (import.meta.main) main();'],
  ])('accepts a decision made by import.meta.main alone: %s', (body) => {
    expect(judge(body)).toEqual({ decided: 1, wrong: [] });
  });

  it.each([
    ['await main();'],
    ['main().catch(() => process.exit(1));'],
    ["process.on('SIGINT', () => { if (x) main(); });"],
  ])('sees no decision where nothing is decided at load: %s', (body) => {
    expect(judge(body)).toEqual({ decided: 0, wrong: [] });
  });

  it.each([
    [
      'if (import.meta.url === `file://${process.argv[1]}`) main();',
      [['import.meta.url === `file://${process.argv[1]}`']],
    ],
    [
      'if (process.argv[1] === fileURLToPath(import.meta.url)) main();',
      [['process.argv[1] === fileURLToPath(import.meta.url)']],
    ],
    [
      "if (process.argv[1]?.endsWith('x.mjs')) await main();",
      [["process.argv[1]?.endsWith('x.mjs')"]],
    ],
    ['/* import.meta.main */ if (x) main();', [['x']]],
    ['if (import.meta.main && x) main();', [['import.meta.main && x']]],
    ['if (import.meta.main) { if (x) main(); }', [['x', 'import.meta.main']]],
    ['if (import.meta.main) {} else main();', [['not (import.meta.main)']]],
    ['import.meta.main || main();', [['not (import.meta.main)']]],
    ['x ? null : main();', [['not (x)']]],
  ])('reports any other decision: %s', (body, wrong) => {
    expect(judge(body)).toEqual({ decided: 1, wrong });
  });

  it.each([
    ['console.log(process.argv[1]);', 1],
    ["process.argv[1]?.endsWith('x');", 1],
    ['const a = process.argv?.[1];', 1],
    ['process.argv.slice(2);', 0],
    ['process.argv[2];', 0],
    ['other.argv[1];', 0],
    ['process.env[1];', 0],
    ['// process.argv[1]', 0],
  ])('counts the reads of process.argv[1] in: %s', (body, reads) => {
    expect(argvEntryReads(fixture(body))).toHaveLength(reads);
  });
});

/**
 * Whether a node DOES something when it is evaluated, as against merely
 * being a value. A call, a construction and an await are the three shapes
 * that can reach the world outside the expression.
 */
const isWorkNode = (node: ts.Node): boolean =>
  ts.isCallExpression(node) ||
  ts.isNewExpression(node) ||
  ts.isAwaitExpression(node);

/** What a work node does, named by its callee, or `await` for an await. */
const workText = (sf: ts.SourceFile, node: ts.Node): string =>
  ts.isCallExpression(node) || ts.isNewExpression(node)
    ? node.expression.getText(sf).split('\n')[0].slice(0, 48)
    : 'await';

/**
 * Modules whose exports change something outside this process: the file
 * system, another process, the network. Listed by what they DO rather than
 * by a list of pure builtins to exempt, because the pure set is unbounded
 * and this one is not.
 */
const IO_MODULES = new Set([
  'node:fs',
  'node:fs/promises',
  'fs',
  'fs/promises',
  'node:child_process',
  'child_process',
  'node:http',
  'node:https',
  'node:net',
  'node:dgram',
  'http',
  'https',
  'net',
  'dgram',
]);

/**
 * The local names an I/O module is reached by in this file: each named or
 * default import, and a namespace import, whose every member counts.
 */
const ioBindings = (sf: ts.SourceFile): ReadonlySet<string> => {
  const names = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier))
      continue;
    if (!IO_MODULES.has(st.moduleSpecifier.text)) continue;
    const clause = st.importClause;
    if (!clause) continue;
    if (clause.name) names.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
    else for (const element of bindings.elements) names.add(element.name.text);
  }
  return names;
};

/** Whether a call reaches an I/O module, directly or through its namespace. */
const callsIo = (node: ts.Node, io: ReadonlySet<string>): boolean => {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee))
    return io.has(callee.text) || callee.text === 'fetch';
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    io.has(callee.expression.text)
  );
};

/** Whether any condition between a node and the top of its file is `import.meta.main`. */
const underImportMetaMain = (node: ts.Node): boolean =>
  gatesOf(node).some(
    ({ condition, holds }) => holds && isImportMetaMain(condition),
  );

/** Work a module does as it loads: where it is, and what it does. */
interface LoadTimeWork {
  readonly at: string;
  readonly what: string;
}

/** A statement that only declares things, and so builds the module rather than running it. */
const isDeclarationOnly = (st: ts.Statement): boolean =>
  ts.isVariableStatement(st) ||
  ts.isFunctionDeclaration(st) ||
  ts.isClassDeclaration(st) ||
  ts.isInterfaceDeclaration(st) ||
  ts.isTypeAliasDeclaration(st) ||
  ts.isEnumDeclaration(st) ||
  ts.isImportDeclaration(st) ||
  ts.isExportDeclaration(st) ||
  ts.isEmptyStatement(st);

/**
 * Everything a file does while it is being imported, outside an
 * `import.meta.main` decision.
 *
 * The line is drawn by STATEMENT KIND, not by a list of calls held to be
 * pure. Module scope exists to build the module, so a declaration is allowed
 * to call things -- `path.join`, `new Set`, `Object.fromEntries` and
 * `createRequire` all run at load time in scripts that are entirely correct,
 * and an allowlist of pure calls would have to grow forever to keep saying
 * so. A statement evaluated for its EFFECT alone -- an expression statement,
 * an `if`, a loop, a `try` -- is the program running, and importing the
 * module runs it.
 *
 * Two shapes cross that line and are caught anyway: a declaration whose
 * initialiser awaits, because a top-level await is the program running by
 * another spelling, and one that calls an I/O module directly, because
 * `const out = spawnSync(...)` spawns a process on import however it is
 * spelled. What remains uncovered is a declaration calling a LOCAL helper
 * that does I/O; stated rather than hidden, because a guard whose limits are
 * not written down is read as covering everything.
 *
 * This is the gap #221's rules left. They ask which condition decides a
 * load-time `main()`, so a script calling `main()` unconditionally produces
 * no decision and a script with no `main()` at all produces nothing to look
 * at: both were invisible to every rule meant to govern them (#276).
 */
const loadTimeWork = (sf: ts.SourceFile): LoadTimeWork[] => {
  const io = ioBindings(sf);
  const found: LoadTimeWork[] = [];

  for (const st of sf.statements) {
    const declaresOnly = isDeclarationOnly(st);
    if (ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) continue;

    let reported = false;
    const visit = (node: ts.Node): void => {
      if (reported || ts.isFunctionLike(node)) return;
      if (isWorkNode(node) && !underImportMetaMain(node)) {
        // A declaration may call; it may not await, and it may not do I/O.
        const offends = declaresOnly
          ? ts.isAwaitExpression(node) || callsIo(node, io)
          : true;
        if (offends) {
          found.push({ at: where(sf, node), what: workText(sf, node) });
          reported = true;
          return;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(st);
  }
  return found;
};

/**
 * What the load-time rule makes of a source: what it does as it loads, and
 * how many statements it read to decide. The count is the liveness control --
 * `work: []` over nothing examined is not a clean verdict, it is silence, and
 * an assertion that cannot tell them apart is the vacuity #118 was filed
 * about.
 */
const judgeSource = (sf: ts.SourceFile) => ({
  examined: sf.statements.filter(
    (st) => !ts.isImportDeclaration(st) && !ts.isExportDeclaration(st),
  ).length,
  work: loadTimeWork(sf).map(({ what }) => what),
});

/** What the load-time rule makes of a fixture body. */
const judgeWork = (body: string) => judgeSource(fixture(body));

describe('the load-time rule reads the parse tree (#276)', () => {
  it.each([
    ['a guarded entry point', 'if (import.meta.main) await main();'],
    ['work inside the guard', 'if (import.meta.main) { writeFileSync(a, b); }'],
    ['a constant built from a call', "const R = '='.repeat(72);"],
    ['a constant built with new', 'const S = new Set([1, 2]);'],
    ['a path joined at load', "const P = path.join(a, 'b');"],
    ['an immediately-invoked builder', 'export const Q = (() => 90)();'],
    [
      'a function that does the work',
      'function main() { writeFileSync(a, b); }',
    ],
    ['an arrow that does the work', 'const go = () => { console.log(1); };'],
    [
      'a handler registered inside a function',
      'function m() { process.once(s, f); }',
    ],
    [
      'a comment describing work',
      '/* console.log(1); process.exit(0); */ const X = 1;',
    ],
  ])('allows %s', (_name, body) => {
    // One statement read, nothing done: the count is what makes the empty
    // list a verdict rather than silence.
    expect(judgeWork(body)).toEqual({ examined: 1, work: [] });
  });

  it.each([
    ['printing', 'console.log(1);', ['console.log']],
    ['exiting', 'process.exit(0);', ['process.exit']],
    ['an unconditional entry point', 'await main();', ['await']],
    ['a refusal guarded by an if', 'if (!t) die(USAGE);', ['die']],
    [
      'work behind any other condition',
      'if (x) writeFileSync(a, b);',
      ['writeFileSync'],
    ],
    [
      'a handler registered at load',
      'for (const s of S) { process.once(s, f); }',
      ['process.once'],
    ],
    [
      'a try around a spawn',
      'try { execFileSync(a, b); } catch (e) { console.log(e); }',
      ['execFileSync'],
    ],
    [
      'a top-level await in a declaration',
      'const r = await draftAll(p);',
      ['await'],
    ],
  ])('refuses %s', (_name, body, what) => {
    expect(judgeWork(body)).toEqual({ examined: 1, work: what });
  });

  it.each([
    [
      'a spawn assigned to a constant',
      "import { spawnSync } from 'node:child_process';\nconst out = spawnSync('git', []);",
      ['spawnSync'],
    ],
    [
      'a read through a namespace',
      "import * as fs from 'node:fs';\nconst t = fs.readFileSync(p);",
      ['fs.readFileSync'],
    ],
    ['a fetch assigned to a constant', 'const r = fetch(url);', ['fetch']],
  ])('refuses I/O even in a declaration: %s', (_name, body, what) => {
    expect(judgeSource(parseSource(`${body}\n`, 'fixture.mjs'))).toEqual({
      examined: 1,
      work: what,
    });
  });
});

/** Every file the rules can read: modules in JavaScript or TypeScript. */
const MODULE = /\.[cm]?[jt]s$/;

const files = filesUnder('scripts', () => true);
const modules = files.filter((file) => MODULE.test(file));
const decisionsIn = (file: string) => entryDecisions(parseFile(file));

/**
 * Each script that decides whether it was run directly, run as a script with
 * an input it refuses. A refusal is the cheapest proof that `main()` ran: a
 * non-zero exit carrying the script's own words, where a skipped `main()` is
 * a silent 0.
 */
interface Probe {
  readonly args: readonly string[];
  /** Variables to set; `undefined` removes one the parent had. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly status: number;
  /** Words only the script's own refusal prints. */
  readonly says: string;
}

const PROBES: Readonly<Record<string, Probe>> = {
  // With no file to check there is nothing it could report, so it refuses.
  // That refusal is also the only cheap proof its entry point ran at all: a
  // skipped `main()` exits 0 in silence, which reads exactly like a clean
  // message (#278).
  'closing-keywords.mjs': {
    args: [],
    status: 1,
    says: 'usage: node scripts/closing-keywords.mjs',
  },
  // Without its three paths it prints its usage and refuses.
  'build-evidence-page.mjs': {
    args: [],
    status: 2,
    says: 'usage: build-evidence-page.mjs',
  },
  // With no plan and no listing it has nothing to pair, so it refuses before
  // reading anything. Its refusal is also the only cheap proof its entry point
  // ran: a skipped `main()` exits 0 in silence.
  'upload-evidence-assets.mjs': {
    args: [],
    status: 2,
    says: 'usage: upload-evidence-assets.mjs',
  },
  // With no page and no sign-off to read it can give no verdict, so it
  // refuses with 2, which is neither a sign-off nor an out-of-date one (#197).
  'signoff-status.mjs': {
    args: [],
    status: 2,
    says: 'usage: signoff-status.mjs',
  },
  // Without the API it can prove nothing, so it refuses to proceed.
  'deploy-gate.mjs': {
    args: [],
    env: { GITHUB_REPOSITORY: undefined, GITHUB_TOKEN: undefined },
    status: 1,
    says: 'GITHUB_REPOSITORY and GITHUB_TOKEN are required',
  },
  // With no needs to read and no shard accounts, build-and-test's verdict has
  // nothing to vouch for, so it refuses rather than pass on nothing (#163).
  'e2e-shards.mjs': {
    args: [],
    env: { NEEDS_JSON: undefined },
    status: 1,
    says: 'build-and-test REFUSED',
  },
  // Playwright rejects the option, so the run writes no report, and the
  // reconciliation refuses rather than call that a pass.
  'test-e2e.mjs': {
    args: ['--no-such-flag'],
    env: { EVIDENCE_DIR: undefined },
    status: 1,
    says: 'E2E RECONCILIATION FAILED',
  },
  // Neither of these takes an argument, so one is a mistake they refuse
  // before doing any work (#227). They earned probes by gaining an entry
  // decision: until then each called `main()` unconditionally, so importing
  // either ran it -- which is why `dashboard.mjs` kept its own copies of
  // three helpers rather than importing them.
  'dashboard.mjs': {
    args: ['--no-such-flag'],
    status: 1,
    says: 'dashboard.mjs takes no arguments',
  },
  'test-devices.mjs': {
    args: ['--no-such-flag'],
    status: 1,
    says: 'test-devices.mjs takes no arguments',
  },
  // With no `docker` on PATH it refuses rather than compare nothing (#202).
  'visual.mjs': {
    args: [],
    env: { PATH: '/nonexistent' },
    status: 1,
    says: 'docker is not available',
  },
  // With no command it does nothing it could report, so it refuses by name
  // before reading a file or calling GitHub (#459).
  'visual-rebaseline.mjs': {
    args: [],
    status: 1,
    says: 'unknown command (none); expected qualify, classify, stage, find, locked or commit',
  },
  // With no command it can decide nothing, so it refuses by name before it
  // reads a variable or calls GitHub, and the status stays pending (#459).
  'operator-review.mjs': {
    args: [],
    status: 1,
    says: 'unknown command (none); expected head or verdict',
  },
  // The three that did all their work at module scope until #276. Each refuses
  // on `argv` alone, before it reads the cache or the catalogue, so the probe
  // proves the entry point ran without touching either.
  'i18n-scaffold.mjs': {
    args: [],
    status: 1,
    says: 'name a locale: npm run i18n:scaffold -- zh',
  },
  'i18n-translate.mjs': {
    args: [],
    status: 1,
    says: 'usage: npm run i18n:translate -- <locale>',
  },
  // With no engine it could read nothing back, so it refuses before any
  // request (#95) -- and a skipped `main()` would exit 0 in silence.
  // Without a database to read it has nothing to review, so it refuses with
  // the usage before it reaches for wrangler or the network (#348).
  'reports-review.mjs': {
    args: [],
    status: 2,
    says: 'usage: npm run reports:review <shyden-reports-dev|shyden-reports>',
  },
  'i18n-back-translate.mjs': {
    args: [],
    env: { BACK_TRANSLATE_URL: undefined },
    status: 1,
    says: 'BACK_TRANSLATE_URL must be the engine',
  },
  // Takes no arguments either, and refuses one before it reads the config or
  // reaches for `gh` -- so the probe proves the entry point ran without a
  // token, a network call or a repository (#299).
  'dependabot-labels.mjs': {
    args: ['--no-such-flag'],
    status: 1,
    says: 'usage: node scripts/dependabot-labels.mjs',
  },
  // Without a token and an account it has nothing to prove, so it refuses
  // with the usage before any request reaches Cloudflare (#415).
  'token-reach.mjs': {
    args: [],
    env: { CLOUDFLARE_API_TOKEN: undefined, CLOUDFLARE_ACCOUNT_ID: undefined },
    status: 1,
    says: 'usage: CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node scripts/token-reach.mjs',
  },
  // It takes no arguments, and refuses one before it reads the lockfile or
  // asks mcr.microsoft.com anything (#454).
  'playwright-image.mjs': {
    args: ['--no-such-flag'],
    status: 1,
    says: 'usage: node scripts/playwright-image.mjs (takes no arguments)',
  },
  // It had no refusal at all, being written never to fail an install, so #276
  // gave it the one the other argument-free scripts have. `prepare` passes
  // nothing, so nothing that is not already a mistake reaches it.
  'install-hooks.mjs': {
    args: ['--no-such-flag'],
    status: 1,
    says: 'install-hooks.mjs takes no arguments',
  },
  // With no range and no --tests it has nothing to read, so it refuses (#362).
  'release-inventory.mjs': {
    args: [],
    status: 2,
    says: 'usage: release-inventory.mjs',
  },
  // Without a release file and a head it can build nothing, so it refuses (#362).
  'build-release-content.mjs': {
    args: [],
    status: 2,
    says: 'usage: build-release-content.mjs',
  },
};

const runAsScript = (script: string, probe: Probe) => {
  const env = { ...process.env };
  for (const [name, value] of Object.entries(probe.env ?? {}))
    if (value === undefined) delete env[name];
    else env[name] = value;
  return spawnSync(process.execPath, [script, ...probe.args], {
    encoding: 'utf8',
    env,
  });
};

describe('a script asks whether it was run directly with import.meta.main alone (#221)', () => {
  it('reads every file under scripts/', () => {
    const unread = files.filter((file) => !MODULE.test(file));
    expect(
      searched(unread, { of: files, what: 'files under scripts/' }),
      'a file these rules cannot parse is a file they do not guard',
    ).toEqual([]);
  });

  it('never reads process.argv[1]', () => {
    const reads = modules.flatMap((file) => argvEntryReads(parseFile(file)));
    expect(searched(reads, { of: modules, what: 'scripts' })).toEqual([]);
  });

  it('decides on import.meta.main alone', () => {
    const decisions = modules.flatMap(decisionsIn);
    const wrong = decisions.filter((d) => !d.byImportMetaMain);
    expect(
      searched(wrong, { of: decisions, what: 'load-time main() decisions' }),
    ).toEqual([]);
  });

  it('probes exactly the scripts that decide', () => {
    const deciding = modules
      .filter((file) => decisionsIn(file).length > 0)
      .map((file) => relative('scripts', file))
      .sort();
    expect(deciding).toEqual(Object.keys(PROBES).sort());
  });
});

describe('every script that decides still acts when run as one (#221)', () => {
  let checkout: ScriptCheckout;
  beforeAll(() => {
    checkout = scriptCheckout();
  });
  afterAll(() => checkout.remove());

  const places: Readonly<Record<string, () => string>> = {
    'this checkout': () => 'scripts',
    'a checkout whose path holds a space': () => checkout.spaced,
    'a checkout reached through a symlink': () => checkout.linked,
  };

  for (const [script, probe] of Object.entries(PROBES))
    for (const [place, dir] of Object.entries(places))
      it(`${script} refuses from ${place}`, () => {
        const run = runAsScript(join(dir(), script), probe);
        expect(`${run.stdout}${run.stderr}`).toContain(probe.says);
        expect(run.status).toBe(probe.status);
      });
});

/**
 * A guarded entry means the module can be IMPORTED without running the
 * program -- which is the whole point of guarding it (#227). Before this,
 * `dashboard.mjs` kept its own copies of `waitUntil`, `pidsListeningOnPort`
 * and `killByPort` for exactly this reason, and the copies had already
 * drifted: its `killByPort` gave a shutting-down process 5 s to release the
 * port where the original gave 10 s.
 *
 * Observed in a child process rather than this one: a module imported into
 * the test runner cannot be unloaded, and anything it started would outlive
 * the assertion.
 */
describe('a guarded script can be imported without running (#227)', () => {
  const importsSilently = (script: string, exported?: string) =>
    spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        // Where the module exports something, checking it is the liveness
        // control, and it doubles as proof that the helper has one home.
        // `dashboard.mjs` exports nothing, so it has none -- which is sound
        // here only because an unresolvable path THROWS: a wrong filename
        // arrives as a non-zero exit with a stack on stderr, never as the
        // silence this asserts.
        `const m = await import(${JSON.stringify(pathToFileURL(join('scripts', script)).href)});
         ${
           exported
             ? `if (typeof m.${exported} !== 'function')
                  throw new Error('${script} exports no ${exported}');`
             : ''
         }`,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );

  it('test-devices.mjs imports without starting the gauntlet', () => {
    const run = importsSilently('test-devices.mjs', 'killByPort');
    expect(`${run.stdout}${run.stderr}`).toBe('');
    expect(run.status).toBe(0);
  });

  it('dashboard.mjs imports without binding its port', () => {
    const run = importsSilently('dashboard.mjs');
    expect(`${run.stdout}${run.stderr}`).toBe('');
    expect(run.status).toBe(0);
  });

  // The three from #276. `i18n-translate.mjs` is the one that mattered: until
  // it was guarded, importing it read DEEPL_API_KEY, sent the whole catalogue
  // to DeepL and rewrote the cache. Each exports `main`, and checking that the
  // export is a function is the liveness control -- a module that failed to
  // resolve is exactly as quiet as one that loaded and did nothing.
  it.each([
    ['i18n-scaffold.mjs'],
    ['i18n-translate.mjs'],
    ['install-hooks.mjs'],
  ])('%s imports without running', (script) => {
    const run = importsSilently(script, 'main');
    expect(`${run.stdout}${run.stderr}`).toBe('');
    expect(run.status).toBe(0);
  });
});

/**
 * The rule #221 could not reach.
 *
 * `decisionsIn` answers "which condition decides this load-time `main()`?",
 * so it is silent about a script that calls `main()` unconditionally and
 * blind to one with no `main()` at all: both were in neither the set it
 * judged nor the `PROBES` table it derived from that set, and the guard
 * covered exactly the scripts that were already correct (#276).
 *
 * Measured when it was written: `i18n-scaffold.mjs`, `i18n-translate.mjs`
 * and `install-hooks.mjs` did all their work at module scope, and
 * `test-devices.mjs` registered two signal handlers there -- importing
 * `i18n-translate.mjs` would have sent the catalogue to DeepL, and importing
 * `test-devices.mjs` left a SIGTERM handler that runs `adb` cleanup in
 * whatever process did the importing.
 */
describe('a script does no work while it loads (#276)', () => {
  it('leaves every effect to an import.meta.main decision', () => {
    const work = modules.flatMap((file) =>
      loadTimeWork(parseFile(file)).map(({ at, what }) => `${at} ${what}`),
    );
    expect(
      searched(work, { of: modules, what: 'scripts' }),
      'a module that works while it loads runs its program on import',
    ).toEqual([]);
  });
});
