/**
 * Cross-file duplicated function bodies, found structurally rather than by
 * name.
 *
 * #227's scan compared TOP-LEVEL declarations only, and that one choice is
 * what its report could not see: a copy living inside another function body
 * — or inside a `page.evaluate()` callback, which is how three copies of the
 * WCAG luminance formula came to sit in the e2e suite disagreeing with each
 * other about the linearisation constant (#277). Every function-like node at
 * any depth is collected here for that reason.
 *
 * Printed by TypeScript's own printer with `removeComments`, so prose
 * differences are not behaviour; an arrow assigned to a `const` is printed
 * WITHOUT its name, so a renamed copy is still found.
 *
 * The printer normalises indentation but takes its LINE BREAKS from the
 * original positions, so the same body written across two lines and on one
 * scores below 1. Harmless here only because prettier formats every file in
 * this tree, which makes the layout a function of the code — a copy pasted
 * into a differently-wrapped context is formatted back into agreement before
 * it can be committed.
 *
 * KNOWN LIMITS, stated so nobody trusts this further than it goes:
 *  - Only CROSS-FILE pairs. Two copies in one file are a different concern
 *    and a different fix (one of them is usually local by intent).
 *  - Only `.ts` and `.mjs`. A duplicate inside an `.astro` frontmatter block
 *    or a `<script>` tag is invisible.
 *  - Similarity is a proxy for behaviour, never proof of it. Two predicates
 *    over two different sets have the same shape and must stay separate
 *    (`isLocale`/`isMvpLocale`, #277). Every pair needs a human verdict.
 */
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { parseSource } from './ast';

/**
 * One function-like node, printed for comparison.
 *
 * Named `FunctionBody` rather than `Declaration`, and read by
 * `functionBodiesIn` rather than `declarationsIn`, because
 * `tests/playwright-declarations.ts` already owns both of those names for a
 * different thing. This scan found that collision the hard way: the call
 * graph in `ast.ts` resolves a call by BARE NAME when the file has no local
 * binding for it, so a second `declarationsIn` that reads a file donated
 * "derives from the filesystem" to four unrelated guards, and 25 assertions
 * nobody had touched were reported as unproved. One name, two behaviours is
 * the other half of the hazard this module hunts — a renamed copy is one
 * behaviour under two names.
 */
export interface FunctionBody {
  /** `path/to/file.ts:42`, repo-relative, for a finding a human has to open. */
  readonly at: string;
  readonly file: string;
  /** The name it is known by, or `anonymous` for a callback. */
  readonly name: string;
  /** Printed with comments removed. */
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export interface DuplicatePair {
  readonly ratio: number;
  readonly a: FunctionBody;
  readonly b: FunctionBody;
}

/**
 * The shortest printed body worth comparing, in characters.
 *
 * Below this every one-expression arrow in the tree matches every other one
 * — `(a) => a.name`, `() => []` — and the report becomes noise a reader
 * stops opening. Measured on this tree: at 0 the scan returns thousands of
 * pairs, at 120 it returns tens. The three `lin`/`luminance` copies #277 was
 * filed against print to roughly 300 characters together with the
 * `evaluate` callback that holds them, so they are well clear of it.
 */
export const MIN_PRINTED_LENGTH = 120;

/** Below this a pair is two different functions that rhyme. */
export const DUPLICATE_RATIO = 0.85;

const printer = ts.createPrinter({ removeComments: true });

const isComparableFunction = (node: ts.Node): boolean =>
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) ||
  ts.isMethodDeclaration(node);

/**
 * The name a function is known by — declared, assigned, the property it is
 * the value of, or the titled call it is passed to. `declaredName` in
 * `ast.ts` answers the first two for a call graph; a scan that collects
 * callbacks needs the rest and a fallback, because an argument to `evaluate`
 * has no name at all.
 *
 * A test's callback is known by its title, `it('…')`: as `anonymous`, every
 * test in a file shared one name, so a verdict keyed by name excused any
 * copy between the same two files (#477).
 */
const nameOfBody = (node: ts.Node): string => {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name))
    return node.name.text;
  const parent = node.parent;
  if (
    parent &&
    ts.isVariableDeclaration(parent) &&
    ts.isIdentifier(parent.name)
  )
    return parent.name.text;
  if (parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name))
    return parent.name.text;
  if (parent && ts.isCallExpression(parent)) {
    const [title] = parent.arguments;
    if (title && title !== node && isTitle(title))
      return `${parent.expression.getText()}(${title.getText()})`;
  }
  return 'anonymous';
};

/** A string, written in any quote, that a call takes as its title. */
const isTitle = (node: ts.Node): boolean =>
  ts.isStringLiteral(node) ||
  ts.isNoSubstitutionTemplateLiteral(node) ||
  ts.isTemplateExpression(node);

/**
 * Every function-like node in `source`, at any depth.
 *
 * Takes SOURCE as well as a path, for the reason `definesADirectoryWalker`
 * in `one-home.test.ts` gives: a detector nobody has watched catch anything
 * is worth what #79's guards over an empty array were worth. The fixtures
 * are that watching, and they need a body this scan has not read off disk.
 */
export function functionBodiesOf(source: string, file: string): FunctionBody[] {
  const sf = parseSource(source, file);
  const found: FunctionBody[] = [];
  const visit = (node: ts.Node): void => {
    if (isComparableFunction(node)) {
      const text = printer.printNode(ts.EmitHint.Unspecified, node, sf);
      if (text.length >= MIN_PRINTED_LENGTH)
        found.push({
          at: `${file}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`,
          file,
          name: nameOfBody(node),
          text,
          start: node.getStart(),
          end: node.end,
        });
    }
    ts.forEachChild(node, (child) => {
      // Returns nothing on purpose. `forEachChild` STOPS at the first child
      // whose callback returns something truthy, so a point-free body that
      // happens to return an array visits exactly one child per node (#118).
      visit(child);
    });
  };
  visit(sf);
  return found;
}

/** Every function-like node in the file at `file`, at any depth. */
export const functionBodiesIn = (file: string): FunctionBody[] =>
  functionBodiesOf(readFileSync(file, 'utf8'), file);

/**
 * Levenshtein distance, stopped as soon as it cannot come in under `max`.
 *
 * The exact distance is never wanted — only whether the pair clears the
 * ratio — so this is Ukkonen's band: no cell further than `max` from the
 * diagonal can ever hold a value that small, and a row whose every cell has
 * already exceeded `max` settles the question. Returns `max + 1` for "further
 * apart than that", which is all a caller can act on.
 *
 * The common prefix and suffix are trimmed first, which is what makes the
 * near-identical pairs — the ones worth finding — the cheap ones.
 */
const boundedDistance = (a: string, b: string, max: number): number => {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  if (x.length === 0) return y.length;
  if (y.length === 0) return x.length;
  if (Math.abs(x.length - y.length) > max) return max + 1;

  const beyond = max + 1;
  let prev = new Int32Array(y.length + 1).fill(beyond);
  let row = new Int32Array(y.length + 1).fill(beyond);
  for (let j = 0; j <= Math.min(y.length, max); j++) prev[j] = j;
  for (let i = 1; i <= x.length; i++) {
    const lo = Math.max(1, i - max);
    const hi = Math.min(y.length, i + max);
    row.fill(beyond);
    row[0] = i <= max ? i : beyond;
    let best = beyond;
    for (let j = lo; j <= hi; j++) {
      const value = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
      row[j] = value;
      if (value < best) best = value;
    }
    if (best > max) return beyond;
    [prev, row] = [row, prev];
  }
  return prev[y.length];
};

/**
 * A character histogram, computed ONCE per declaration.
 *
 * Every character one string holds and the other does not must be deleted or
 * substituted, so half the L1 distance between two histograms is a lower
 * bound on the edit distance — O(128) against Levenshtein's O(n*m). Built
 * per comparison it cost more than the distance it was saving: the first run
 * of this scan spent 136 s of the unit suite, almost all of it rebuilding
 * these maps inside the sweep.
 *
 * Everything above U+007E folds into one bucket. Merging two characters can
 * only make the measured surplus SMALLER, so the result stays a lower bound
 * and the scan stays safe — it can lose time, never a finding.
 */
const HISTOGRAM_BUCKETS = 128;

const histogram = (text: string): Int32Array => {
  const counts = new Int32Array(HISTOGRAM_BUCKETS);
  for (let i = 0; i < text.length; i++)
    counts[Math.min(text.charCodeAt(i), HISTOGRAM_BUCKETS - 1)]++;
  return counts;
};

const histogramDistance = (a: Int32Array, b: Int32Array): number => {
  let surplus = 0;
  for (let i = 0; i < HISTOGRAM_BUCKETS; i++) surplus += Math.abs(a[i] - b[i]);
  return surplus / 2;
};

/** The ratio, with both cheap bounds applied first. `0` means "below". */
const boundedSimilarity = (
  a: string,
  b: string,
  ha: Int32Array,
  hb: Int32Array,
  minRatio: number,
): number => {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  // The edit distance can never be less than the difference in length.
  if (Math.min(a.length, b.length) / longest < minRatio) return 0;
  if (1 - histogramDistance(ha, hb) / longest < minRatio) return 0;
  // The largest distance a pair at `minRatio` may have, so the band below is
  // exactly as wide as the question being asked and no wider.
  const allowed = Math.floor((1 - minRatio) * longest);
  const apart = boundedDistance(a, b, allowed);
  return apart > allowed ? 0 : 1 - apart / longest;
};

/**
 * How alike two printed bodies are, in [0, 1]. `1` is character-identical.
 *
 * One home with the sweep below, which passes histograms it has already
 * built rather than computing them again.
 */
export const similarity = (
  a: string,
  b: string,
  minRatio = DUPLICATE_RATIO,
): number => boundedSimilarity(a, b, histogram(a), histogram(b), minRatio);

const encloses = (outer: FunctionBody, inner: FunctionBody): boolean =>
  outer.file === inner.file &&
  outer.start <= inner.start &&
  outer.end >= inner.end &&
  !(outer.start === inner.start && outer.end === inner.end);

/**
 * Every cross-file pair at or above `minRatio`, with subsumed pairs dropped.
 *
 * A duplicated region reports ONCE. Collecting nested nodes means a copied
 * function inside a copied callback matches at every level, and a report
 * that lists the same finding four times at four depths is one a reader
 * triages by scrolling past. A pair is kept only when no larger accepted
 * pair already encloses both of its halves.
 */
export function duplicatePairs(
  declarations: readonly FunctionBody[],
  minRatio = DUPLICATE_RATIO,
): DuplicatePair[] {
  // Sorted by printed length, so the inner loop is a sliding window: once a
  // candidate is longer than `text.length / minRatio` no later one can be
  // short enough either, and the sweep stops instead of running to the end.
  const bySize = [...declarations]
    .sort((a, b) => a.text.length - b.text.length)
    .map((decl) => ({ decl, hist: histogram(decl.text) }));
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < bySize.length; i++)
    for (let j = i + 1; j < bySize.length; j++) {
      const [a, b] = [bySize[i], bySize[j]];
      if (b.decl.text.length > a.decl.text.length / minRatio) break;
      if (a.decl.file === b.decl.file) continue;
      const ratio = boundedSimilarity(
        a.decl.text,
        b.decl.text,
        a.hist,
        b.hist,
        minRatio,
      );
      if (ratio > 0) pairs.push({ ratio, a: a.decl, b: b.decl });
    }
  const bySpan = [...pairs].sort(
    (x, y) =>
      y.a.text.length + y.b.text.length - (x.a.text.length + x.b.text.length),
  );
  const kept: DuplicatePair[] = [];
  for (const pair of bySpan) {
    const subsumed = kept.some(
      (outer) =>
        (encloses(outer.a, pair.a) && encloses(outer.b, pair.b)) ||
        (encloses(outer.a, pair.b) && encloses(outer.b, pair.a)),
    );
    if (!subsumed) kept.push(pair);
  }
  return kept.sort((x, y) => y.ratio - x.ratio || x.a.at.localeCompare(y.a.at));
}
