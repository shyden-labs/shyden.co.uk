/**
 * Carries the counts V8 took on a compiled copy of a file onto the file's own
 * text, through the copy's source map (#913).
 *
 * Playwright compiles TypeScript with Babel before Node runs it, and Babel's
 * output is not the code Vitest's report is placed on: it adds statements and
 * branch arms of its own (`src/lib/grouping.ts`: 285 arms against Vitest's
 * 267). The file's own text, read as Node strips it, yields exactly Vitest's
 * statements and arms, so the conversion places Playwright's counts there.
 * Shyden chose this route on 2026-10-27 over excluding the measured files
 * from Babel.
 *
 * Every position in the own text takes the count of the token it belongs to:
 * a mapped token's own count, read at the first place the copy emits it. A
 * position the copy dropped (an arrow's parenthesis, a type) takes the next
 * mapped token's count, since a node's first emitted token is the one after
 * the text the compile removed; a position inside a word keeps that word's
 * count, since the converter reads one past the start of a braceless
 * consequent, inside its `return`. Measured against a type-stripped run of
 * the same code (2026-10-27, 53 files, 5,076 counts): every count agreed but
 * 10, each one the type-stripped run's own misreading (#959).
 *
 * `placeOnTransform` goes the other way, from the own text onto Vitest's own
 * transform of the file, so the conversion lists exactly Vitest's places
 * (layer 2, Shyden's "Both suites" of 2026-10-27). Measured the same way:
 * in all 5,076 places of each run, every count equals the own-text route's.
 */

/**
 * @typedef {import('./coverage-processes.mjs').V8Function} V8Function
 * @typedef {import('./coverage-processes.mjs').V8Range} V8Range
 * @typedef {import('./coverage-processes.mjs').Compiled} Compiled
 * @typedef {{ start: number, end: number, count: number }} Span
 * @typedef {number[][][]} Mappings each generated line's segments: [column, source, line, column, name?]
 * @typedef {{ map: string, code: string, pastLineEnd: 'refused' | 'read at its end' }} Whose how a refusal names a map and the code it maps (Playwright's compiled copy, read back to the own text, or Vitest's transform, written from it), and what a column past its line's end means
 */

/**
 * A source map's `mappings`, decoded from base64 VLQ, with each field made
 * absolute.
 *
 * @param {string} mappings
 * @returns {{ lines: Mappings } | { refusal: string }}
 */
export const decodeMappings = (mappings) => {
  const refuse = (/** @type {string} */ why) => ({
    refusal: `carry-counts: the map’s mappings ${why}, so no position can be read from them`,
  });
  /** @type {Mappings} */
  const lines = [[]];
  // Source, original line, original column and name run on across segments
  // and lines; the generated column starts again on each line.
  const state = [0, 0, 0, 0, 0];
  /** @type {number[]} */
  let fields = [];
  let value = 0;
  let shift = 0;
  let inside = false;
  const endSegment = () => {
    if (fields.length === 0) return;
    const segment = fields.map((field, index) => {
      state[index] = /** @type {number} */ (state[index]) + field;
      return /** @type {number} */ (state[index]);
    });
    /** @type {number[][]} */ (lines.at(-1)).push(segment);
    fields = [];
  };
  for (let at = 0; at < mappings.length; at++) {
    const char = mappings.charAt(at);
    if (char === ',' || char === ';') {
      if (inside) return refuse(`cut a number off at ${at}`);
      endSegment();
      if (char === ';') {
        lines.push([]);
        state[0] = 0;
      }
      continue;
    }
    const digit = BASE64.indexOf(char);
    if (digit < 0)
      return refuse(`hold "${char}" at ${at}, which is not base64`);
    value += (digit & 31) << shift;
    inside = (digit & 32) !== 0;
    shift = inside ? shift + 5 : 0;
    if (!inside) {
      fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
    }
  }
  if (inside) return refuse(`cut a number off at ${mappings.length}`);
  endSegment();
  return { lines };
};

const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Every range of every function, laid flat: intervals that do not overlap,
 * each carrying the count of the innermost range around it.
 *
 * @param {readonly V8Function[]} functions
 * @returns {Span[]}
 */
export const flattenRanges = (functions) => {
  // Outer before inner: V8's ranges nest, within a function and across them.
  const ranges = functions
    .flatMap(({ ranges }) => ranges)
    .toSorted(
      (a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset,
    );
  /** @type {Span[]} */
  const flat = [];
  /** @type {V8Range[]} */
  const open = [];
  let at = 0;
  const emit = (/** @type {number} */ end, /** @type {number} */ count) => {
    if (end > at) flat.push({ start: at, end, count });
    at = Math.max(at, end);
  };
  const close = (/** @type {number} */ before) => {
    for (
      let top = open.at(-1);
      top && top.endOffset <= before;
      top = open.at(-1)
    ) {
      emit(top.endOffset, top.count);
      open.pop();
    }
  };
  for (const range of ranges) {
    close(range.startOffset);
    const around = open.at(-1);
    if (around) emit(range.startOffset, around.count);
    at = range.startOffset;
    open.push(range);
  }
  close(Infinity);
  return flat;
};

/**
 * The count of the interval holding `offset`, 0 where none does.
 *
 * @param {readonly Span[]} flat
 * @param {number} offset
 */
const countAt = (flat, offset) => {
  let low = 0;
  let high = flat.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const span = /** @type {Span} */ (flat[middle]);
    if (offset < span.start) high = middle - 1;
    else if (offset >= span.end) low = middle + 1;
    else return span.count;
  }
  return 0;
};

/**
 * Where each line of `text` starts.
 *
 * @param {string} text
 */
const lineStarts = (text) => {
  const starts = [0];
  for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1))
    starts.push(at + 1);
  return starts;
};

const WORD = /^[\w$]*/;
const WHITESPACE = /^\s$/;

/** @type {Whose} */
const COPY = {
  map: 'the compiled copy’s map',
  code: 'copy',
  pastLineEnd: 'refused',
};
// Vite rewrites `import('vitest/node')` to a longer specifier and maps it
// character by character, past the end of the line it came from
// (coverage-processes.mjs 452, measured 2026-10-27), which Vitest's own reader
// accepts: such a column is read at its line's end, inside the string.
/** @type {Whose} */
const TRANSFORM = {
  map: 'Vitest’s transform’s map',
  code: 'transform',
  pastLineEnd: 'read at its end',
};

/**
 * Every segment of a map from generated code back to one file's own text, in
 * the map's order: the offset the code emits it at, and the own-text offset it
 * stands for, or undefined for a segment that names no source position.
 *
 * @param {Compiled} compiled the generated code and its map
 * @param {string} text the file's own text
 * @param {Whose} whose
 * @returns {{ segments: { emitted: number, own: number | undefined }[] } | { refusal: string }}
 */
const segmentsOf = (compiled, text, whose) => {
  const { sources } = compiled.map;
  if (sources.length !== 1)
    return {
      refusal: `carry-counts: ${whose.map} names ${sources.length} sources (${sources.join(', ')}), not this file alone, so its tokens cannot all be placed in it`,
    };
  const decoded = decodeMappings(compiled.map.mappings);
  if ('refusal' in decoded) return decoded;
  const generated = lineStarts(compiled.code);
  const own = lineStarts(text);
  /** @type {{ emitted: number, own: number | undefined }[]} */
  const segments = [];
  for (const [line, lineSegments] of decoded.lines.entries())
    for (const [column = 0, , sourceLine, sourceColumn] of lineSegments) {
      /** @type {number | undefined} */
      let offset;
      if (sourceLine !== undefined && sourceColumn !== undefined) {
        const lineStart = own[sourceLine];
        if (lineStart === undefined)
          return {
            refusal: `carry-counts: ${whose.map} places a token at line ${sourceLine + 1}, column ${sourceColumn} of a file with ${own.length} lines, so it is not this file’s map`,
          };
        const lineLength =
          (own[sourceLine + 1] ?? text.length + 1) - 1 - lineStart;
        if (sourceColumn > lineLength && whose.pastLineEnd === 'refused')
          return {
            refusal: `carry-counts: ${whose.map} places a token at line ${sourceLine + 1}, column ${sourceColumn} of a line ${lineLength} characters long, so it is not this file’s map`,
          };
        offset = lineStart + Math.min(sourceColumn, lineLength);
      }
      const emittedLine = generated[line];
      if (emittedLine === undefined)
        return {
          refusal: `carry-counts: ${whose.map} places a token on line ${line + 1} of a ${whose.code} with ${generated.length} lines, so it is not this ${whose.code}’s map`,
        };
      segments.push({ emitted: emittedLine + column, own: offset });
    }
  if (segments.every(({ own }) => own === undefined))
    return {
      refusal: `carry-counts: ${whose.map} places no token in the file, so its counts have nowhere to go`,
    };
  return { segments };
};

/**
 * The script's own count: its outermost range's, which a block starting at
 * offset 0 would hide from a lookup there.
 *
 * @param {readonly V8Function[]} functions
 */
const outermostCount = (functions) =>
  functions
    .flatMap(({ ranges }) => ranges)
    .reduce(
      (outer, range) =>
        range.startOffset < outer.startOffset ||
        (range.startOffset === outer.startOffset &&
          range.endOffset > outer.endOffset)
          ? range
          : outer,
      { startOffset: Infinity, endOffset: -Infinity, count: 0 },
    ).count;

/**
 * One block-coverage function for `length` characters of code: the whole
 * code at the script's own count, then each span whose count differs, with
 * neighbours that agree joined.
 *
 * @param {number} length
 * @param {number} whole
 * @param {readonly V8Range[]} spans in order, end to end
 * @returns {V8Function[]}
 */
const asFunction = (length, whole, spans) => {
  /** @type {V8Range[]} */
  const joined = [];
  for (const span of spans) {
    const last = joined.at(-1);
    if (
      last &&
      last.endOffset === span.startOffset &&
      last.count === span.count
    )
      last.endOffset = span.endOffset;
    else joined.push({ ...span });
  }
  return [
    {
      functionName: '',
      isBlockCoverage: true,
      ranges: [
        { startOffset: 0, endOffset: length, count: whole },
        // The whole-code range already says what a span with its count would.
        ...joined.filter(({ count }) => count !== whole),
      ],
    },
  ];
};

/**
 * The compiled copy's counts, as one function whose ranges lie on the file's
 * own text, so the own text converts as if Node had run it.
 *
 * @param {readonly V8Function[]} functions what V8 counted on the copy
 * @param {Compiled} compiled the copy and its map back to `text`
 * @param {string} text the file's own text
 * @returns {{ functions: V8Function[] } | { refusal: string }}
 */
export const carryCounts = (functions, compiled, text) => {
  const mapped = segmentsOf(compiled, text, COPY);
  if ('refusal' in mapped) return mapped;
  const flat = flattenRanges(functions);
  /** each own-text offset a token is mapped to, and the first place the copy emits it */
  const firstEmitted = new Map();
  for (const { emitted, own } of mapped.segments)
    if (own !== undefined && !(firstEmitted.get(own) <= emitted))
      firstEmitted.set(own, emitted);
  const tokens = [...firstEmitted.keys()].toSorted((a, b) => a - b);
  // A token's text runs from the end of the word before it (or the character
  // after the token before it) to the start of the next token's.
  const starts = tokens.map((token, index) => {
    if (index === 0) return 0;
    const before = /** @type {number} */ (tokens[index - 1]);
    // The pattern matches every text, the empty one included.
    const word = /** @type {RegExpExecArray} */ (
      WORD.exec(text.slice(before, token))
    )[0].length;
    return Math.min(token, before + Math.max(1, word));
  });
  return {
    functions: asFunction(
      text.length,
      outermostCount(functions),
      tokens.map((token, index) => ({
        startOffset: /** @type {number} */ (starts[index]),
        endOffset: starts[index + 1] ?? text.length,
        count: countAt(flat, firstEmitted.get(token)),
      })),
    ),
  };
};

/**
 * The counts V8 took on a file's own text, as one function whose ranges lie
 * on Vitest's transform of it, so the transform converts as Vitest's own
 * report does: its statements, functions and arms are Vitest's by
 * construction (204 of 204 files, measured 2026-10-27). Each segment of the
 * transform's map, up to the next, takes the own-text count where it is
 * mapped; a segment that names no source position is code the transform
 * wrote (an import binding, an export), which continues the count before it,
 * and code before the first mapped segment takes the script's own count.
 *
 * @param {readonly V8Function[]} functions what V8 counted on the own text
 * @param {Compiled} transformed Vitest's transform of the file, and its map back to `text`
 * @param {string} text the file's own text
 * @returns {{ functions: V8Function[] } | { refusal: string }}
 */
export const placeOnTransform = (functions, transformed, text) => {
  const mapped = segmentsOf(transformed, text, TRANSFORM);
  if ('refusal' in mapped) return mapped;
  const flat = flattenRanges(functions);
  const whole = outermostCount(functions);
  const { length } = transformed.code;
  // A map lists each line's segments in the order the code emits them.
  const { segments } = mapped;
  let count = whole;
  /** @type {V8Range[]} */
  const spans = [];
  /** @param {number} startOffset @param {number} endOffset */
  const span = (startOffset, endOffset) => {
    const last = spans.at(-1);
    if (last && last.endOffset === startOffset && last.count === count)
      last.endOffset = endOffset;
    else if (endOffset > startOffset)
      spans.push({ startOffset, endOffset, count });
  };
  for (const [index, { emitted, own }] of segments.entries()) {
    const end = segments[index + 1]?.emitted ?? length;
    if (own === undefined) {
      span(emitted, end);
      continue;
    }
    // One segment can hold several of the own text's tokens (`}, () => ` in
    // grouping.ts, whose arrow's range starts at its `(`): while the
    // transform copies the own text, each character takes its own count.
    // Whitespace either side re-wrote is stepped over (`filter(\n  (locale)`
    // printed `filter((locale)`, back-translate.ts); from the first other
    // change, the rest takes the last copied character's count.
    let at = emitted;
    let from = own;
    count = countAt(flat, own);
    while (at < end) {
      const printed = transformed.code.charCodeAt(at);
      const written = text.charCodeAt(from);
      if (printed === written) {
        count = countAt(flat, from);
        span(at, at + 1);
        at++;
        from++;
      } else if (WHITESPACE.test(text.charAt(from))) from++;
      else if (WHITESPACE.test(transformed.code.charAt(at))) {
        span(at, at + 1);
        at++;
      } else break;
    }
    span(at, end);
  }
  return { functions: asFunction(length, whole, spans) };
};
