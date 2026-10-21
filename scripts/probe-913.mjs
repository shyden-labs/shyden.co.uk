/**
 * PROBE for #913, never merged: under NODE_V8_COVERAGE, does Playwright's
 * compile cache hold, for every repository .ts file its processes ran, the
 * exact compiled code V8 ran (the whole-script range equals the cached code's
 * length), and its map? Converts one file with ast-v8-to-istanbul from the
 * cache and prints its statement places.
 *
 *   node scripts/probe-913.mjs <v8-dir> <cache-dir>
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convert } from 'ast-v8-to-istanbul';
import { parseAstAsync } from 'vitest/node';

/**
 * @typedef {{ startOffset: number, endOffset: number, count: number }} V8Range
 * @typedef {{ functionName: string, isBlockCoverage: boolean, ranges: V8Range[] }} V8Function
 * @typedef {{ url: string, functions: V8Function[] }} V8Script
 * @typedef {{ version: number, mappings: string, names: string[], sources: string[], sourcesContent?: string[] }} SourceMap
 */

const [v8dir = '', cacheDir = ''] = process.argv.slice(2);
const root = process.cwd();

/** @param {string} dir @returns {string[]} */
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

/** @type {Map<string, { code: string, map: SourceMap }[]>} */
const cache = new Map();
for (const file of walk(cacheDir).filter((f) => f.endsWith('.map'))) {
  const map = JSON.parse(readFileSync(file, 'utf8'));
  const text = readFileSync(file.replace(/\.map$/, '.js'), 'utf8');
  const code = text.slice(text.indexOf('\n') + 1);
  const source = path.resolve(path.dirname(file), map.sources?.[0] ?? '');
  // Keyed by the source text itself: the map names only a bare file name.
  for (const key of [map.sourcesContent?.[0] ?? '', source]) {
    const list = cache.get(key) ?? [];
    list.push({ code, map });
    cache.set(key, list);
  }
}
console.log(`cache entries with maps: ${cache.size / 2}`);
console.log(`sample sources: ${[...cache.keys()].slice(0, 6).join(' | ')}`);

/** @type {Map<string, { ranLength: number, processes: number }>} */
const ran = new Map();
for (const name of readdirSync(v8dir)) {
  const { result } = /** @type {{ result: V8Script[] }} */ (
    JSON.parse(readFileSync(path.join(v8dir, name), 'utf8'))
  );
  for (const script of result) {
    if (!script.url.startsWith('file://')) continue;
    const file = fileURLToPath(script.url.split('?')[0]);
    if (!file.startsWith(root) || file.includes('node_modules')) continue;
    if (!/\.tsx?$/.test(file)) continue;
    const top = Math.max(
      0,
      ...script.functions.flatMap((fn) => fn.ranges.map((r) => r.endOffset)),
    );
    const seen = ran.get(file) ?? { ranLength: top, processes: 0 };
    seen.processes += 1;
    if (seen.ranLength !== top) seen.ranLength = -1;
    ran.set(file, seen);
  }
}
let matched = 0;
for (const [file, { ranLength, processes }] of [...ran].sort()) {
  const rel = path.relative(root, file);
  const current = readFileSync(file, 'utf8');
  const entries = cache.get(current) ?? [];
  const match = entries.find(
    (e) =>
      e.code.length === ranLength &&
      (e.map.sourcesContent?.[0] ?? current) === current,
  );
  if (match) matched += 1;
  console.log(
    `${match ? 'MATCH' : 'NONE '} ${rel} ran=${ranLength} in ${processes} entries; cache lengths [${entries.map((e) => e.code.length).join(',')}]`,
  );
}
console.log(
  `repository .ts files run: ${ran.size}, matched in cache: ${matched}`,
);

const target = path.join(root, 'tests/device-pixels.ts');
const entry = (cache.get(readFileSync(target, 'utf8')) ?? [])[0];
if (entry) {
  for (const name of readdirSync(v8dir)) {
    const { result } = /** @type {{ result: V8Script[] }} */ (
      JSON.parse(readFileSync(path.join(v8dir, name), 'utf8'))
    );
    const script = result.find(
      (s) =>
        s.url.startsWith('file://') &&
        fileURLToPath(s.url.split('?')[0]) === target,
    );
    if (!script) continue;
    const out = JSON.parse(
      JSON.stringify(
        await convert({
          ast: parseAstAsync(entry.code),
          code: entry.code,
          wrapperLength: 0,
          sourceMap: entry.map,
          coverage: { functions: script.functions, url: script.url },
        }),
      ),
    );
    const fc = Object.values(out)[0];
    console.log(
      `device-pixels statements: ${JSON.stringify(Object.entries(fc.statementMap).map(([id, l]) => `${l.start.line}:${l.start.column}-${l.end.line}:${l.end.column}=${fc.s[id]}`))}`,
    );
    break;
  }
}
