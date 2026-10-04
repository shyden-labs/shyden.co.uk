import ts from 'typescript';
import { derivationOf, where, type Bound, type Closure } from './ast';

/**
 * The detector behind `anchored-presence.test.ts`, taken out of the guard so it
 * can be run over fixtures (#183). The guard asked "is the matcher a regex?"
 * and nobody could see that was the wrong question, because the only thing it
 * ever ran over was the real suite, where the answer happened to be zero.
 */

/**
 * `JSON.parse(...)`. JSON carries no comments, so nothing a comment in the
 * read says survives into what the parse returns, and a read that reaches a
 * subject only through one cannot be satisfied by a comment.
 *
 * The call, never a name (#225). The detector once exempted any subject whose
 * derivation mentioned `JSON` or `parse` anywhere, so a helper's
 * `JSON.stringify` exempted the raw read beside it. `JSON.stringify` and a
 * local `parse` helper hand text back as text, and a Markdown parser keeps
 * every `<!-- comment -->`.
 */
const isJsonParse = (call: ts.CallExpression): boolean =>
  ts.isPropertyAccessExpression(call.expression) &&
  ts.isIdentifier(call.expression.expression) &&
  call.expression.expression.text === 'JSON' &&
  call.expression.name.text === 'parse';

export interface PresenceClosures {
  /** Reaches a read of file CONTENT; only those assertions are scanned. */
  readonly readers: Closure;
  /** Reaches a comment remover, so no comment can satisfy the matcher. */
  readonly strippers: Closure;
  /**
   * Reaches a comment READER. Text built from the comments asserts the
   * documentation on purpose, and a comment satisfying it is the point.
   */
  readonly commentReaders: Closure;
}

export interface PresenceScan {
  readonly scanned: number;
  /** `scanned`, per file, for a cross-check that counts per file (#477). */
  readonly perFile: ReadonlyMap<string, number>;
  readonly findings: readonly string[];
}

/**
 * A regex body's alternatives, split only at a top-level `|`.
 *
 * A `|` inside a class, inside a group, or escaped is part of one alternative:
 * `/^(a|b)c/` pins both spellings to the line start, and `/^a|b/` pins only
 * `a` -- `b` matches anywhere, including inside a comment.
 */
function alternativesOf(body: string): string[] {
  const alternatives: string[] = [];
  let depth = 0;
  let inClass = false;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '\\') {
      i += 1;
    } else if (inClass) {
      if (ch === ']') inClass = false;
    } else if (ch === '[') {
      inClass = true;
    } else if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      depth -= 1;
    } else if (ch === '|' && depth === 0) {
      alternatives.push(body.slice(start, i));
      start = i + 1;
    }
  }
  alternatives.push(body.slice(start));
  return alternatives;
}

/**
 * Whether a regex literal pins what it matches to the start of a line.
 *
 * `^` must open EVERY top-level alternative. `$` alone does not count: `// x`
 * ends a line exactly as `x` does, so a trailing anchor is satisfied by a
 * comment. The `m` flag is not required, because a matcher over one line of
 * text (a URL, a single log line) is pinned by `^` without it. `\^` and `[^`
 * begin with something other than `^`, so neither is mistaken for an anchor.
 */
function isAnchored(literal: ts.RegularExpressionLiteral): boolean {
  const body = literal.text.slice(1, literal.text.lastIndexOf('/'));
  return alternativesOf(body).every((alternative) =>
    alternative.startsWith('^'),
  );
}

/**
 * Every `toContain`/`toMatch` in a test file whose subject reads source
 * content by a path no `JSON.parse` stands on, and the ones among them that a
 * comment could satisfy: neither stripped, nor comment-derived, nor matched
 * by an anchored regex.
 */
export function scanPresence(
  bound: Bound,
  { readers, strippers, commentReaders }: PresenceClosures,
): PresenceScan {
  const findings: string[] = [];
  let scanned = 0;
  const perFile = new Map<string, number>();
  for (const [file, sf] of bound.files) {
    if (!/\.(test|spec)\.ts$/.test(file)) continue;

    const check = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression)
      ) {
        const matcher = node.expression.name.text;
        if (matcher === 'toContain' || matcher === 'toMatch') {
          const expectCall = node.expression.expression;
          const subject = ts.isCallExpression(expectCall)
            ? expectCall.arguments[0]
            : undefined;
          if (subject) {
            // What the subject is made of, with every JSON.parse(...) a wall
            // the walk does not cross: a read behind one reaches the subject
            // as data, and a stripper behind one vouches for nothing outside.
            const { names, opaque } = derivationOf(subject, bound, {
              stopAt: isJsonParse,
            });
            const reaches = (closure: Closure) =>
              names.some((n) => closure.reaches(file, n));
            // The call graph is asked about a read only for the names the
            // walk could not see into. The graph knows that `readJson` calls
            // `readFileSync`; only the helper's body, which the walk has
            // already followed, shows that the read ends in a parse.
            const readsRaw = opaque.some((n) => readers.reaches(file, n));
            if (readsRaw) {
              scanned += 1;
              perFile.set(file, (perFile.get(file) ?? 0) + 1);
              const arg = node.arguments[0];
              const anchored =
                arg !== undefined &&
                ts.isRegularExpressionLiteral(arg) &&
                isAnchored(arg);
              if (
                !reaches(strippers) &&
                !reaches(commentReaders) &&
                !anchored
              ) {
                findings.push(
                  `${where(sf, node)} — ` +
                    node.getText().replace(/\s+/g, ' ').slice(0, 90),
                );
              }
            }
          }
        }
      }
      ts.forEachChild(node, check);
    };
    check(sf);
  }
  return { scanned, perFile, findings };
}
