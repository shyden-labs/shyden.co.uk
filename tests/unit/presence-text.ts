import ts from 'typescript';
import { codeWithoutLiterals } from './ast';

/**
 * Presence assertions over raw file text, counted as TEXT (#477).
 *
 * `scanPresence` finds them by dataflow: a `toContain`/`toMatch` whose
 * subject derives, through the program's bindings and its call graph, from a
 * `readFileSync` no `JSON.parse` stands on. This reads the same thing with
 * none of that machinery, so anchored-presence can check, per file, that its
 * reader judged exactly what plain text shows: a reader blind to one form
 * judges fewer in that file, and one counting a read that is not one judges
 * more.
 *
 * It follows bindings only inside one file, and only `const`/`let`/`var` and
 * `function` declarations, each visible in the innermost `describe`/`it`/
 * `test` callback that makes it, or the module. A subject read through a
 * helper another file exports is beyond it: none does today, and
 * anchored-presence names the file if one appears.
 *
 * Read in code with every literal and comment removed (`codeWithoutLiterals`),
 * so a bracket inside a string never unbalances the walk below, and a fixture
 * spelling an assertion is not one.
 */
export function presenceOverRawText(sf: ts.SourceFile): number {
  const code = codeWithoutLiterals(sf);

  const scopes: Span[] = [[0, code.length]];
  for (const match of code.matchAll(SCOPE)) {
    const open = match.index + match[0].length - 1;
    const close = partner(code, open);
    if (close > 0) scopes.push([open, close]);
  }
  const innermost = (at: number): Span =>
    scopes
      .filter(([from, to]) => from <= at && at <= to)
      .reduce((a, b) => (b[1] - b[0] < a[1] - a[0] ? b : a));

  const bindings: Binding[] = [];
  for (const match of code.matchAll(DECLARED)) {
    const from = match.index + match[0].length;
    bindings.push({
      name: match[1],
      at: match.index,
      made: code.slice(from, statementEnd(code, from)),
      scope: innermost(match.index),
    });
  }
  for (const match of code.matchAll(FUNCTION)) {
    const open = code.indexOf('{', match.index);
    bindings.push({
      name: match[1],
      at: match.index,
      made: code.slice(open, partner(code, open) + 1),
      scope: innermost(match.index),
    });
  }

  const raw = new Set<Binding>();
  const readsRaw = (text: string, at: number): boolean =>
    !text.includes('JSON.parse(') &&
    (text.includes('readFileSync(') ||
      bindings.some(
        (binding) =>
          raw.has(binding) &&
          binding.scope[0] <= at &&
          at <= binding.scope[1] &&
          names(text, binding.name),
      ));
  // To a fixed point: a binding may name one declared below it.
  for (let grew = true; grew;) {
    grew = false;
    for (const binding of bindings)
      if (!raw.has(binding) && readsRaw(binding.made, binding.at)) {
        raw.add(binding);
        grew = true;
      }
  }

  let count = 0;
  for (const match of code.matchAll(ASSERTED)) {
    const open = match.index + match[0].length - 1;
    const close = partner(code, open);
    if (close < 0 || !PRESENCE.test(code.slice(close + 1))) continue;
    if (readsRaw(firstArgument(code.slice(open + 1, close)), match.index))
      count += 1;
  }
  return count;
}

type Span = readonly [number, number];

interface Binding {
  readonly name: string;
  /** Where the declaration starts. */
  readonly at: number;
  /** What it is made of: an initializer, or a function's body. */
  readonly made: string;
  readonly scope: Span;
}

/** A callback scope a binding can be shared across. */
const SCOPE = /\b(?:describe|it|test)(?:\.[A-Za-z]+)*\(/g;
const DECLARED = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*/g;
const FUNCTION = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
const ASSERTED = /\bexpect(?:\.soft)?\(/g;
/** The matcher directly after `expect(…)`: a `.not` between is an inverse. */
const PRESENCE = /^\s*\.(?:toContain|toMatch)\(/;

/** Whether `text` refers to `name`: not part of a longer name, nor a property. */
const names = (text: string, name: string): boolean =>
  new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(text);

/** From the opening bracket at `open`, the index of its partner, or -1. */
function partner(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if ('([{'.includes(code[i])) depth += 1;
    else if (')]}'.includes(code[i])) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** `inner` up to its first comma outside brackets. */
function firstArgument(inner: string): string {
  let depth = 0;
  for (let i = 0; i < inner.length; i += 1) {
    if ('([{'.includes(inner[i])) depth += 1;
    else if (')]}'.includes(inner[i])) depth -= 1;
    else if (inner[i] === ',' && depth === 0) return inner.slice(0, i);
  }
  return inner;
}

/** Where a statement starting at `from` ends: `;` at its depth, or a close. */
function statementEnd(code: string, from: number): number {
  let depth = 0;
  for (let i = from; i < code.length; i += 1) {
    if ('([{'.includes(code[i])) depth += 1;
    else if (')]}'.includes(code[i])) {
      depth -= 1;
      if (depth < 0) return i;
    } else if (code[i] === ';' && depth === 0) return i;
  }
  return code.length;
}
