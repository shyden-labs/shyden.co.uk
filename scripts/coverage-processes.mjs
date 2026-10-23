/**
 * Converts raw V8 coverage from processes Node ran outside Vitest's workers
 * into the Istanbul shape `scripts/coverage-merge.mjs` joins (#899).
 *
 * `NODE_V8_COVERAGE=<dir>` makes every Node process, and every process it
 * starts, write one `coverage-*.json` there. An entry counts only when Node
 * ran the file's own text: plain JavaScript, or TypeScript Node stripped of
 * its types (the types become spaces, so every offset is the file's own, and
 * Node appends `\n\n//# sourceURL=<url>`). Anything else under the same URL is
 * code a tool transformed first (a process that loads TypeScript through
 * Vite, say), which this text cannot describe, so it is skipped and named. A file Vitest's own
 * report measures still reaches the merge from there.
 *
 *   node scripts/coverage-processes.mjs <raw-dir> <suite> [--cache <dir>] [--recorded-root <path>]
 *
 * `--cache` is Playwright's compile cache (`PWTEST_CACHE_DIR`, #913): code it
 * compiled converts through the cached copy and map, and an entry found
 * neither as its own text nor there is refused. `--recorded-root` is the
 * checkout the processes ran in, when that is another path than this one (a
 * CI container's); files are read from here.
 *
 * writes `coverage/<suite>/coverage-final.json`. A directory with no measured
 * entry is refused, never written as an empty report that reads as "nothing
 * ran". `tests/unit/coverage-processes.test.ts` holds the conversion;
 * `tests/integration/coverage-processes-script.test.ts` runs it on a real
 * child process.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { convert } from 'ast-v8-to-istanbul';
import { parse } from 'vite';
import {
  MEASURED,
  NOT_MEASURED,
  PLAYWRIGHT_MEASURE,
} from '../tests/coverage-options.ts';
import { die, messageOf, nonEmpty } from './errors.mjs';
import { processRuns } from './process-runs.mjs';

/**
 * One V8 function's block counts, and one script's functions, as
 * `NODE_V8_COVERAGE` writes them.
 *
 * @typedef {{ startOffset: number, endOffset: number, count: number }} V8Range
 * @typedef {{ functionName: string, ranges: V8Range[], isBlockCoverage: boolean }} V8Function
 * @typedef {{ url: string, functions: V8Function[] }} V8Script
 * @typedef {import('./coverage-merge.mjs').FileCoverage} FileCoverage
 * @typedef {{ file: string, url: string, reason: string }} Skipped
 * @typedef {{ version: number, sources: string[], sourcesContent?: (string | null)[], names: string[], mappings: string }} SourceMap
 * @typedef {{ code: string, map: SourceMap }} Compiled one file a tool compiled, as its cache keeps it
 */

const TYPESCRIPT = /\.[mc]?tsx?$/;

/**
 * The repository-relative file an entry ran, or null when it is not one the
 * coverage measures (a built-in, a dependency, a test, outside the root).
 *
 * @param {string} url
 * @param {string} root the repository, absolute
 * @param {import('../tests/coverage-options.ts').Measure} [measure] the measured set, the shared one unless a run names its own
 * @returns {string | null}
 */
export const fileOf = (
  url,
  root,
  measure = { include: MEASURED, exclude: NOT_MEASURED },
) => {
  if (!url.startsWith('file://')) return null;
  const relative = path.posix.relative(
    root,
    fileURLToPath(url.split('?')[0] ?? url),
  );
  if (relative.startsWith('..') || path.posix.isAbsolute(relative)) return null;
  const measured =
    measure.include.some((glob) => path.posix.matchesGlob(relative, glob)) &&
    !measure.exclude.some((glob) => path.posix.matchesGlob(relative, glob));
  return measured ? relative : null;
};

/** @param {V8Script} script */
const ranLength = (script) =>
  Math.max(
    0,
    ...script.functions.flatMap((fn) => fn.ranges.map((r) => r.endOffset)),
  );

/**
 * The lengths of code Node runs from this file's own text.
 *
 * @param {string} file
 * @param {string} text
 * @param {string} url
 * @returns {number[]}
 */
const ownLengths = (file, text, url) =>
  TYPESCRIPT.test(file)
    ? [text.length, text.length + `\n\n//# sourceURL=${url}`.length]
    : [text.length];

/**
 * The names a binding pattern binds: `a`, `{ a, b: c, ...d }`, `[a, , b = 1]`.
 *
 * @param {any} node
 * @returns {string[]}
 */
const patternNames = (node) => {
  switch (node?.type) {
    case 'Identifier':
      return [node.name];
    case 'ObjectPattern':
      return node.properties.flatMap((/** @type {any} */ property) =>
        patternNames(
          property.type === 'RestElement' ? property.argument : property.value,
        ),
      );
    case 'ArrayPattern':
      return node.elements.flatMap((/** @type {any} */ element) =>
        patternNames(element),
      );
    case 'AssignmentPattern':
      return patternNames(node.left);
    case 'RestElement':
      return patternNames(node.argument);
    case 'TSParameterProperty':
      return patternNames(node.parameter);
    default:
      return [];
  }
};

/**
 * Every name the program binds, once per binding: declarations, function and
 * class names, parameters, catch parameters and imports.
 *
 * @param {any} program
 * @returns {Map<string, number>}
 */
const bindingCounts = (program) => {
  /** @type {Map<string, number>} */
  const counts = new Map();
  /** @param {readonly string[]} names */
  const bind = (names) => {
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  };
  /** @param {any} node */
  const visit = (node) => {
    switch (node.type) {
      case 'VariableDeclarator':
        bind(patternNames(node.id));
        break;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        bind([...patternNames(node.id), ...node.params.flatMap(patternNames)]);
        break;
      case 'ClassDeclaration':
      case 'ClassExpression':
        bind(patternNames(node.id));
        break;
      case 'CatchClause':
        bind(patternNames(node.param));
        break;
      case 'ImportSpecifier':
      case 'ImportDefaultSpecifier':
      case 'ImportNamespaceSpecifier':
        bind([node.local.name]);
        break;
    }
    for (const value of Object.values(node))
      for (const child of Array.isArray(value) ? value : [value])
        if (
          child &&
          typeof child === 'object' &&
          typeof child.type === 'string'
        )
          visit(child);
  };
  visit(program);
  return counts;
};

/**
 * The declarators Vitest's coverage never counts (#928): vite's SSR transform
 * rewrites an imported `X.prop` as `__vite_ssr_import_N__.X.prop`, and
 * coverage-v8 5.0.5 ignores every declarator initialised that way
 * (`provider.js`, "SSR transformed import binding"). A namespace import is
 * the `__vite_ssr_import_N__` object itself, so its `ns.prop` keeps its count.
 * Measured on Vitest's own route (`tests/unit/coverage-processes.test.ts`).
 * The transform follows scope, which this does not: where the import's name
 * is bound again, such a read is refused rather than guessed.
 *
 * @param {any} program
 * @param {string} text
 * @param {string} file
 * @returns {{ skip: Set<number> } | { refusal: string }} the declarators to skip, by start offset
 */
const importReads = (program, text, file) => {
  const imported = new Set(
    program.body
      .filter((/** @type {any} */ node) => node.type === 'ImportDeclaration')
      .flatMap((/** @type {any} */ declaration) => declaration.specifiers)
      .filter(
        (/** @type {any} */ specifier) =>
          specifier.type !== 'ImportNamespaceSpecifier',
      )
      .map((/** @type {any} */ specifier) => specifier.local.name),
  );
  /** @type {Set<number>} */
  const skip = new Set();
  if (imported.size === 0) return { skip };
  const counts = bindingCounts(program);
  /** @type {string | undefined} */
  let refusal;
  /** @param {any} node */
  const visit = (node) => {
    if (refusal !== undefined) return;
    if (
      node.type === 'VariableDeclarator' &&
      node.init?.type === 'MemberExpression' &&
      node.init.object.type === 'Identifier' &&
      imported.has(node.init.object.name)
    ) {
      const name = node.init.object.name;
      if ((counts.get(name) ?? 0) > 1) {
        const line = text.slice(0, node.start).split('\n').length;
        refusal = `coverage-processes: ${file} binds ${name} again, and a declarator on line ${line} reads ${text.slice(node.init.start, node.init.end)}, so whether it reads the import (which Vitest skips) cannot be told`;
        return;
      }
      skip.add(node.start);
    }
    for (const value of Object.values(node))
      for (const child of Array.isArray(value) ? value : [value])
        if (
          child &&
          typeof child === 'object' &&
          typeof child.type === 'string'
        )
          visit(child);
  };
  visit(program);
  return refusal === undefined ? { skip } : { refusal };
};

/**
 * Playwright's compile cache, indexed by each entry's SOURCE text (#913):
 * its map names the source by a bare file name, so the text itself is the
 * key. An entry is `<hash>.js` (a first line `// <sha1 of the code>`, then
 * the code) beside `<hash>.map`; one whose code fails its own hash is
 * refused, as Playwright refuses it.
 *
 * @param {readonly { js: string, map: string }[]} entries
 * @returns {Map<string, Compiled[]>}
 */
export const indexCompileCache = (entries) => {
  /** @type {Map<string, Compiled[]>} */
  const index = new Map();
  for (const entry of entries) {
    // The first line is `// ` and the code's sha1, the rest the code.
    const newline = entry.js.indexOf('\n');
    const hash = entry.js.slice('// '.length, newline);
    if (!entry.js.startsWith('// ') || !/^[0-9a-f]{40}$/.test(hash))
      throw new Error(
        'coverage-processes: a compile-cache entry has no hash line',
      );
    const code = entry.js.slice(newline + 1);
    if (createHash('sha1').update(code).digest('hex') !== hash)
      throw new Error(
        'coverage-processes: a compile-cache entry does not match its hash',
      );
    /** @type {SourceMap} */
    const map = JSON.parse(entry.map);
    const source = map.sourcesContent?.[0];
    if (typeof source !== 'string') continue;
    const list = index.get(source) ?? [];
    list.push({ code, map });
    index.set(source, list);
  }
  return index;
};

/**
 * Each entry recorded under `from` moved onto `to` (#913): a CI container
 * runs the checkout at another path than the job that converts it, and every
 * later step reads this checkout. Only a URL inside `from` itself moves.
 *
 * @param {readonly V8Script[]} scripts
 * @param {string} from the checkout the processes ran in
 * @param {string} to this checkout
 * @returns {V8Script[]}
 */
export const rebaseUrls = (scripts, from, to) => {
  const prefix = `${pathToFileURL(from).href}/`;
  const onto = `${pathToFileURL(to).href}/`;
  return scripts.map((script) =>
    script.url.startsWith(prefix)
      ? { ...script, url: onto + script.url.slice(prefix.length) }
      : script,
  );
};

/**
 * The compile cache's files as code-and-map pairs (#913): `<name>.js` beside
 * `<name>.map`, in whatever folders Playwright files them, other files left.
 * Half a pair is a cache cut short, and refused by name.
 *
 * @param {readonly string[]} files paths inside the cache
 * @returns {{ pairs: { js: string, map: string }[] } | { refusal: string }}
 */
export const pairCacheFiles = (files) => {
  const present = new Set(files);
  /** @type {{ js: string, map: string }[]} */
  const pairs = [];
  for (const file of files) {
    const js = file.replace(/\.map$/, '.js');
    const map = file.replace(/\.js$/, '.map');
    if (file.endsWith('.js') && !present.has(map))
      return {
        refusal: `coverage-processes: the compile cache holds ${file} with no map beside it`,
      };
    if (file.endsWith('.map') && !present.has(js))
      return {
        refusal: `coverage-processes: the compile cache holds ${file} with no code beside it`,
      };
    if (file.endsWith('.js')) pairs.push({ js: file, map });
  }
  return pairs.length > 0
    ? { pairs }
    : {
        refusal:
          'coverage-processes: the compile cache holds no code with its map',
      };
};

/**
 * @param {FileCoverage} into
 * @param {FileCoverage} from
 */
const addCounts = (into, from) => {
  for (const [id, count] of Object.entries(from.s))
    into.s[id] = (into.s[id] ?? 0) + count;
  for (const [id, counts] of Object.entries(from.b))
    into.b[id] = counts.map((count, i) => (into.b[id]?.[i] ?? 0) + count);
  for (const [id, count] of Object.entries(from.f))
    into.f[id] = (into.f[id] ?? 0) + count;
};

/**
 * @param {readonly V8Script[]} scripts every process's entries
 * @param {(file: string) => string} read a file's text, by its relative path
 * @param {string} root the repository, absolute
 * @param {{ compiled?: ReadonlyMap<string, readonly Compiled[]>, measure?: import('../tests/coverage-options.ts').Measure }} [tool] a tool's compiled copies, by source text, and the set its run measures (#913); given copies, every entry that is not the file's own text must be found in them
 * @returns {Promise<{ report: Record<string, FileCoverage>, skipped: Skipped[] } | { refusal: string }>}
 */
export const convertScripts = async (scripts, read, root, tool = {}) => {
  const { compiled, measure } = tool;
  /** @type {Record<string, FileCoverage>} */
  const report = {};
  /** @type {Skipped[]} */
  const skipped = [];
  for (const script of scripts) {
    const file = fileOf(script.url, root, measure);
    if (file === null) continue;
    const text = read(file);
    const lengths = ownLengths(file, text, script.url);
    const ran = ranLength(script);
    const copies = compiled?.get(text) ?? [];
    const copy = copies.find(({ code }) => code.length === ran);
    if (!lengths.includes(ran) && !copy) {
      const ownText = `${lengths.join(', or ')}${lengths.length > 1 ? ' with the sourceURL Node appends' : ''}`;
      const cached =
        copies.length > 0
          ? ` nor any compiled copy cached (${copies.map(({ code }) => code.length).join(', ')})`
          : compiled
            ? ' and no compiled copy of it is cached'
            : '';
      const reason = `ran code ${ran} characters long, not its own text (${ownText})${cached}`;
      // A cache that holds no copy of what ran lost an entry, so its counts
      // are refused, never left out; with no cache, the entry is another
      // tool's transformed code (Vitest's workers), listed as skipped.
      if (compiled) return { refusal: `coverage-processes: ${file} ${reason}` };
      skipped.push({ file, url: script.url, reason });
      continue;
    }
    const absolute = path.posix.join(root, file);
    // Converted through the file's own text when that is what ran, else
    // through the compiled copy of exactly the length that ran, which is
    // JavaScript whatever the source was, and its map (#913).
    const own = lengths.includes(ran);
    const code = own ? text : /** @type {Compiled} */ (copy).code;
    // The options Vitest's own (deprecated) parseAstAsync passes, so the tree
    // is the one its report places statements on. `parse` reports a syntax
    // error beside an empty program instead of throwing, so it is refused
    // here, never converted as a file with no statements.
    const parsed = await parse(file, code, {
      lang: own && TYPESCRIPT.test(file) ? 'ts' : 'js',
      preserveParens: false,
    });
    if (parsed.errors.length > 0)
      return {
        refusal: `coverage-processes: ${file}${own ? '' : "'s compiled copy"} does not parse (${parsed.errors[0]?.message}), so its counts have nowhere to go`,
      };
    // Read in the text that was parsed: the file's own, or the compiled copy
    // whose offsets the tree carries. Whether a tool's compiled output keeps
    // the import shape Vitest skips is measured where its runs are wired
    // (#913); where it does not, the merge refuses the file by name.
    const reads = importReads(parsed.program, code, file);
    if ('refusal' in reads) return reads;
    /** @type {Record<string, FileCoverage>} */
    const converted = JSON.parse(
      JSON.stringify(
        await convert({
          ast: parsed.program,
          code,
          ...(own ? {} : { sourceMap: /** @type {Compiled} */ (copy).map }),
          wrapperLength: 0,
          coverage: { functions: script.functions, url: script.url },
          ignoreNode: (node, type) =>
            type === 'statement' &&
            node.type === 'VariableDeclarator' &&
            // The tree is vite's (oxc), whose nodes carry offsets the ESTree
            // type ast-v8-to-istanbul declares does not.
            reads.skip.has(
              /** @type {{ start: number }} */ (/** @type {unknown} */ (node))
                .start,
            )
              ? true
              : undefined,
        }),
      ),
    );
    const coverage = Object.values(converted)[0];
    if (coverage === undefined) continue;
    coverage.path = absolute;
    const seen = report[absolute];
    if (seen) addCounts(seen, coverage);
    else report[absolute] = coverage;
  }
  if (Object.keys(report).length === 0)
    return {
      refusal:
        'coverage-processes: no process ran a measured file, so there is nothing to report',
    };
  return { report, skipped };
};

/**
 * The pid Node writes into a raw file's name, `coverage-<pid>-<time>-<n>.json`
 * (#936), or undefined for a file Node did not name.
 *
 * @param {string} name
 * @returns {number | undefined}
 */
export const writerPid = (name) => {
  const match = /^coverage-(\d+)-\d+-\d+\.json$/.exec(name);
  return match ? Number(match[1]) : undefined;
};

/** How often a running writer is looked at again, in ms. */
const WRITER_LOOK_MS = 50;

/**
 * Waits for every process named by a raw file's name to exit (#936). Node
 * writes a process's file as that process exits, so a file whose writer
 * still runs may be unfinished: once in 16 integration runs the reader met
 * cut-off JSON. A writer still running at the ceiling is refused, named,
 * never read half-written.
 *
 * @param {string[]} names
 * @param {{ isRunning: (pid: number) => boolean, pause: (ms: number) => Promise<void>, now: () => number, ceilingMs: number }} how
 * @returns {Promise<{ waitedFor: number[] } | { refusal: string }>}
 */
export const awaitWriters = async (
  names,
  { isRunning, pause, now, ceilingMs },
) => {
  const pids = [
    ...new Set(names.map(writerPid).filter((pid) => pid !== undefined)),
  ];
  const start = now();
  /** @type {Set<number>} */
  const waitedFor = new Set();
  for (;;) {
    const running = pids.filter((pid) => isRunning(pid));
    if (running.length === 0) return { waitedFor: [...waitedFor] };
    for (const pid of running) waitedFor.add(pid);
    if (now() - start >= ceilingMs) {
      const files = names.filter((name) =>
        running.includes(writerPid(name) ?? -1),
      );
      return {
        refusal: `coverage-processes: process ${running.join(', ')} was still running after ${ceilingMs} ms, so its raw coverage file may be unfinished (${files.join(', ')})`,
      };
    }
    await pause(WRITER_LOOK_MS);
  }
};

/**
 * One raw file's entries, or a refusal naming the file, its size and its
 * writer (#936): `Unexpected end of JSON input` alone named nothing.
 *
 * @param {string} name
 * @param {string} text
 * @param {boolean} running whether the writer named in `name` still runs
 * @returns {{ result: V8Script[] } | { refusal: string }}
 */
export const readRaw = (name, text, running) => {
  try {
    return {
      result: /** @type {{ result: V8Script[] }} */ (JSON.parse(text)).result,
    };
  } catch (error) {
    const pid = writerPid(name);
    const writer =
      pid === undefined
        ? 'an unnamed process'
        : `process ${pid}, which ${running ? 'is still running' : 'has exited'}`;
    return {
      refusal: `coverage-processes: ${name} (${Buffer.byteLength(text)} bytes, written by ${writer}) is not whole JSON: ${messageOf(error)}`,
    };
  }
};

/**
 * A stated ceiling, not a measured one: how long a writer still exiting when
 * the reader starts may take to finish its file. The whole integration suite
 * runs in about 40 s (probe run 39856943389), and the largest file it leaves
 * is 4.4 MB.
 */
const WRITER_CEILING_MS = 30_000;

/**
 * What the ledger says about a raw file's writer (#936): every process a test
 * starts writes `ledger/<pid>.json` as it starts (`tests/coverage-ledger.mjs`),
 * so a file its writer left unfinished names the command that wrote it.
 *
 * @param {number | undefined} pid the writer, from the file's name
 * @param {string | undefined} text its ledger line, or undefined when none
 * @returns {string} a note to follow the refusal, empty when no pid is named
 */
export const ledgerNote = (pid, text) => {
  if (pid === undefined) return '';
  if (text === undefined) return `; no ledger line names process ${pid}`;
  try {
    const { argv } = /** @type {{ argv: string[] }} */ (JSON.parse(text));
    return `; process ${pid} was started as: ${argv.join(' ')}`;
  } catch {
    return `; the ledger line for process ${pid} is not whole JSON`;
  }
};

/** @param {string} dir Playwright's compile cache */
const readCompileCache = (dir) => {
  /** @type {string[]} */
  let files;
  try {
    // Every entry under it, folders too: pairCacheFiles reads only the
    // `.js` and `.map` names, wherever Playwright files them.
    files = nonEmpty(
      readdirSync(dir, { recursive: true, encoding: 'utf8' }),
      `entries in the compile cache ${dir}`,
    );
  } catch (error) {
    die(messageOf(error));
  }
  const paired = pairCacheFiles(files);
  if ('refusal' in paired) die(`${paired.refusal} (read ${dir})`);
  try {
    return indexCompileCache(
      paired.pairs.map(({ js, map }) => ({
        js: readFileSync(path.join(dir, js), 'utf8'),
        map: readFileSync(path.join(dir, map), 'utf8'),
      })),
    );
  } catch (error) {
    die(`${messageOf(error)} (read ${dir})`);
  }
};

const main = async () => {
  const usage =
    'usage: coverage-processes.mjs <raw-dir> <suite> [--cache <dir>] [--recorded-root <path>]';
  const args = (() => {
    try {
      return parseArgs({
        args: process.argv.slice(2),
        options: {
          cache: { type: 'string' },
          'recorded-root': { type: 'string' },
        },
        allowPositionals: true,
      });
    } catch (error) {
      return die(`${messageOf(error)}\n${usage}`);
    }
  })();
  const [dir, suite, ...rest] = args.positionals;
  if (!dir || !suite || rest.length > 0) die(usage);
  const root = process.cwd();
  const recorded = args.values['recorded-root'];
  const compiled =
    args.values.cache === undefined
      ? undefined
      : readCompileCache(args.values.cache);
  // An empty directory means no process was measured at all; one holding
  // only processes that ran no measured file is refused by convertScripts.
  // Either refusal, and a directory that is not there, ends in one line, not
  // a stack trace.
  /** @type {string[]} */
  let names;
  try {
    names = nonEmpty(readdirSync(dir), `raw V8 coverage files in ${dir}`);
  } catch (error) {
    die(messageOf(error));
  }
  const raw = names.filter((name) => name.endsWith('.json'));
  const waited = await awaitWriters(raw, {
    isRunning: processRuns,
    pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    ceilingMs: WRITER_CEILING_MS,
  });
  if ('refusal' in waited) die(waited.refusal);
  else if (waited.waitedFor.length > 0)
    console.log(
      `coverage-processes: waited for process ${waited.waitedFor.join(', ')} to finish writing`,
    );
  /** @type {V8Script[]} */
  const scripts = raw.flatMap((name) => {
    const pid = writerPid(name);
    const read = readRaw(
      name,
      readFileSync(path.join(dir, name), 'utf8'),
      pid !== undefined && processRuns(pid),
    );
    if ('refusal' in read) {
      const line = path.join(dir, 'ledger', `${pid}.json`);
      die(
        `${read.refusal}${ledgerNote(pid, pid !== undefined && existsSync(line) ? readFileSync(line, 'utf8') : undefined)}`,
      );
    }
    return read.result;
  });
  const result = await convertScripts(
    recorded === undefined ? scripts : rebaseUrls(scripts, recorded, root),
    (file) => readFileSync(path.join(root, file), 'utf8'),
    root,
    // A compile cache is a Playwright run's, which measures its own set.
    compiled === undefined ? {} : { compiled, measure: PLAYWRIGHT_MEASURE },
  );
  if ('refusal' in result) die(`${result.refusal} (read ${dir})`);
  mkdirSync(path.join('coverage', suite), { recursive: true });
  writeFileSync(
    path.join('coverage', suite, 'coverage-final.json'),
    `${JSON.stringify(result.report)}\n`,
  );
  // Transformed code is listed in a file beside the report, counted here.
  writeFileSync(
    path.join('coverage', suite, 'skipped.txt'),
    result.skipped.map(({ file, reason }) => `${file}: ${reason}\n`).join(''),
  );
  console.log(
    `coverage-processes: ${scripts.length} entries, ${Object.keys(result.report).length} files measured, ${result.skipped.length} skipped (coverage/${suite}/skipped.txt)`,
  );
};

if (import.meta.main) await main();
