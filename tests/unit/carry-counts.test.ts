import { describe, expect, it } from 'vitest';
import {
  carryCounts,
  decodeMappings,
  flattenRanges,
  placeOnTransform,
} from '../../scripts/carry-counts.mjs';

/**
 * The counts V8 took on Babel's copy of a file, carried onto the file's own
 * text (#913). The maps are Babel's own, from Playwright 1.64.1's
 * `babelTransform` of each source below (2026-10-27).
 */
describe('a source map’s mappings decode to absolute segments (#913)', () => {
  it('decodes each line’s segments, each field made absolute', () => {
    expect(decodeMappings('AAAA,MAAMA;AACNE,UAAU')).toEqual({
      lines: [
        [
          [0, 0, 0, 0],
          [6, 0, 0, 6, 0],
        ],
        [
          [0, 0, 1, 0, 2],
          [10, 0, 1, 10],
        ],
      ],
    });
  });

  it('keeps an empty line, so later lines keep their numbers', () => {
    expect(decodeMappings('AAAA;;AAEA')).toEqual({
      lines: [[[0, 0, 0, 0]], [], [[0, 0, 2, 0]]],
    });
  });

  it('refuses a character base64 does not use, naming it', () => {
    expect(decodeMappings('AAAA,MA!M')).toEqual({
      refusal:
        'carry-counts: the map’s mappings hold "!" at 7, which is not base64, so no position can be read from them',
    });
  });

  it('refuses a value cut off mid-number at the end', () => {
    expect(decodeMappings('AAAg')).toEqual({
      refusal:
        'carry-counts: the map’s mappings cut a number off at 4, so no position can be read from them',
    });
  });

  it('refuses a value cut off mid-number by a separator', () => {
    expect(decodeMappings('Ag,A')).toEqual({
      refusal:
        'carry-counts: the map’s mappings cut a number off at 2, so no position can be read from them',
    });
  });
});

describe('ranges are laid flat, each interval carrying its innermost count (#913)', () => {
  it('a block inside a function takes its own count, and the function resumes after it', () => {
    expect(
      flattenRanges([
        {
          functionName: '',
          isBlockCoverage: true,
          ranges: [
            { startOffset: 0, endOffset: 10, count: 1 },
            { startOffset: 2, endOffset: 5, count: 0 },
          ],
        },
      ]),
    ).toEqual([
      { start: 0, end: 2, count: 1 },
      { start: 2, end: 5, count: 0 },
      { start: 5, end: 10, count: 1 },
    ]);
  });

  it('a function inside the script, with a block of its own, nests across functions', () => {
    expect(
      flattenRanges([
        {
          functionName: '',
          isBlockCoverage: true,
          ranges: [{ startOffset: 0, endOffset: 20, count: 1 }],
        },
        {
          functionName: 'inner',
          isBlockCoverage: true,
          ranges: [
            { startOffset: 4, endOffset: 16, count: 3 },
            { startOffset: 8, endOffset: 12, count: 0 },
          ],
        },
      ]),
    ).toEqual([
      { start: 0, end: 4, count: 1 },
      { start: 4, end: 8, count: 3 },
      { start: 8, end: 12, count: 0 },
      { start: 12, end: 16, count: 3 },
      { start: 16, end: 20, count: 1 },
    ]);
  });

  it('two blocks side by side each keep their count', () => {
    expect(
      flattenRanges([
        {
          functionName: '',
          isBlockCoverage: true,
          ranges: [
            { startOffset: 0, endOffset: 9, count: 2 },
            { startOffset: 1, endOffset: 3, count: 0 },
            { startOffset: 3, endOffset: 6, count: 1 },
          ],
        },
      ]),
    ).toEqual([
      { start: 0, end: 1, count: 2 },
      { start: 1, end: 3, count: 0 },
      { start: 3, end: 6, count: 1 },
      { start: 6, end: 9, count: 2 },
    ]);
  });
});

/** `const twice = (n: number): number => n * 2;`, which Babel prints `const twice = n => n * 2;`. */
const ARROW_TS = [
  'const twice = (n: number): number => n * 2;',
  'globalThis.out = twice(2);',
  '',
].join('\n');
const ARROW_JS = [
  'const twice = n => n * 2;',
  'globalThis.out = twice(2);',
  '',
].join('\n');
const ARROW_MAP = {
  version: 3,
  sources: ['arrow.ts'],
  sourcesContent: [ARROW_TS],
  names: ['twice', 'n', 'globalThis', 'out'],
  mappings:
    'AAAA,MAAMA,KAAK,GAAIC,CAAS,IAAaA,CAAC,GAAG,CAAC;AAC1CC,UAAU,CAACC,GAAG,GAAGH,KAAK,CAAC,CAAC,CAAC',
};
const arrowRan = (calls: number) => [
  {
    functionName: '',
    isBlockCoverage: true,
    ranges: [{ startOffset: 0, endOffset: ARROW_JS.length, count: 1 }],
  },
  {
    functionName: 'twice',
    isBlockCoverage: true,
    ranges: [
      { startOffset: ARROW_JS.indexOf('n =>'), endOffset: 24, count: calls },
    ],
  },
];

describe('counts on a compiled copy are carried onto the file’s own text (#913)', () => {
  it('a mapped token carries the count V8 gave it in the copy', () => {
    const carried = carryCounts(
      arrowRan(1),
      { code: ARROW_JS, map: ARROW_MAP },
      ARROW_TS,
    );
    expect(carried).toEqual({
      functions: [
        {
          functionName: '',
          isBlockCoverage: true,
          ranges: [{ startOffset: 0, endOffset: ARROW_TS.length, count: 1 }],
        },
      ],
    });
  });

  // Babel drops `(` and the types, so the arrow's own-text start has no
  // segment: it takes the parameter's count, the arrow's first emitted token.
  it('a position the compile dropped takes the next mapped token’s count', () => {
    const carried = carryCounts(
      arrowRan(0),
      { code: ARROW_JS, map: ARROW_MAP },
      ARROW_TS,
    );
    expect(carried).toEqual({
      functions: [
        {
          functionName: '',
          isBlockCoverage: true,
          ranges: [
            { startOffset: 0, endOffset: ARROW_TS.length, count: 1 },
            // From the `=` Babel prints with no segment of its own, through `2`.
            { startOffset: 12, endOffset: 42, count: 0 },
          ],
        },
      ],
    });
  });

  // Babel lowers some constructs into several tokens that map to one source
  // token: the source token's count is V8's at the first of them, where its
  // own node starts in the copy.
  it('a token the copy emits twice takes the count of its first place', () => {
    const text = 'a;\n';
    const code = 'a;\na;\n';
    expect(
      carryCounts(
        [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [
              { startOffset: 0, endOffset: code.length, count: 1 },
              { startOffset: 0, endOffset: 2, count: 4 },
            ],
          },
        ],
        {
          code,
          map: {
            version: 3,
            sources: ['a.ts'],
            names: [],
            mappings: 'AAAA;AAAA',
          },
        },
        text,
      ),
    ).toEqual({
      functions: [
        {
          functionName: '',
          isBlockCoverage: true,
          ranges: [
            { startOffset: 0, endOffset: text.length, count: 1 },
            { startOffset: 0, endOffset: text.length, count: 4 },
          ],
        },
      ],
    });
  });

  // A segment of one field marks generated code with no source position.
  it('a segment that names no source position places nothing', () => {
    expect(
      carryCounts(
        arrowRan(1),
        { code: ARROW_JS, map: { ...ARROW_MAP, mappings: 'A,AAAA' } },
        ARROW_TS,
      ),
    ).toEqual({
      functions: [
        {
          functionName: '',
          isBlockCoverage: true,
          ranges: [{ startOffset: 0, endOffset: ARROW_TS.length, count: 1 }],
        },
      ],
    });
  });

  // A map of several sources would place another file's tokens in this one.
  it('refuses a map of any other number of sources than one, naming them', () => {
    expect(
      carryCounts(
        arrowRan(1),
        {
          code: ARROW_JS,
          map: { ...ARROW_MAP, sources: ['arrow.ts', 'other.ts'] },
        },
        ARROW_TS,
      ),
    ).toEqual({
      refusal:
        'carry-counts: the compiled copy’s map names 2 sources (arrow.ts, other.ts), not this file alone, so its tokens cannot all be placed in it',
    });
  });

  it('a copy V8 gave no range reads 0 throughout', () => {
    expect(
      carryCounts([], { code: ARROW_JS, map: ARROW_MAP }, ARROW_TS),
    ).toEqual({
      functions: [
        {
          functionName: '',
          isBlockCoverage: true,
          ranges: [{ startOffset: 0, endOffset: ARROW_TS.length, count: 0 }],
        },
      ],
    });
  });

  // The last line has no newline after it to say where it ends.
  it('refuses a segment past the end of a last line with no newline', () => {
    expect(
      carryCounts(
        [],
        {
          code: 'a;',
          map: {
            version: 3,
            sources: ['a.ts'],
            names: [],
            mappings: 'AAAA,EAAG',
          },
        },
        'a;',
      ),
    ).toEqual({
      refusal:
        'carry-counts: the compiled copy’s map places a token at line 1, column 3 of a line 2 characters long, so it is not this file’s map',
    });
  });

  it('refuses a segment on a line past the end of the copy, naming it', () => {
    expect(
      carryCounts(
        arrowRan(1),
        { code: ARROW_JS, map: { ...ARROW_MAP, mappings: 'AAAA;;;;AAAA' } },
        ARROW_TS,
      ),
    ).toEqual({
      refusal:
        'carry-counts: the compiled copy’s map places a token on line 5 of a copy with 3 lines, so it is not this copy’s map',
    });
  });

  it('refuses a map with no segment at all, since nothing could be placed', () => {
    expect(
      carryCounts(
        arrowRan(1),
        { code: ARROW_JS, map: { ...ARROW_MAP, mappings: ';;' } },
        ARROW_TS,
      ),
    ).toEqual({
      refusal:
        'carry-counts: the compiled copy’s map places no token in the file, so its counts have nowhere to go',
    });
  });

  it('refuses a segment past the end of the file’s own text, naming it', () => {
    expect(
      carryCounts(
        arrowRan(1),
        { code: ARROW_JS, map: { ...ARROW_MAP, mappings: 'AAAA,MAkBM' } },
        ARROW_TS,
      ),
    ).toEqual({
      refusal:
        'carry-counts: the compiled copy’s map places a token at line 19, column 6 of a file with 3 lines, so it is not this file’s map',
    });
  });

  it('refuses a segment past the end of its line, naming it', () => {
    expect(
      carryCounts(
        arrowRan(1),
        { code: ARROW_JS, map: { ...ARROW_MAP, mappings: 'AAAA,MAAyD' } },
        ARROW_TS,
      ),
    ).toEqual({
      refusal:
        'carry-counts: the compiled copy’s map places a token at line 1, column 57 of a line 43 characters long, so it is not this file’s map',
    });
  });
});

/**
 * `tests/box.ts` as Vitest 5.0.5's own transform prints it for the unit
 * project (`transformFile(file, project, 'ssr')`, captured 2026-10-27): the
 * parameter property becomes a field and an assignment mapped to the
 * parameter, and the export becomes a first line with no mapping at all.
 */
const BOX_TS = [
  'export class Box {',
  '  constructor(private size: number) {}',
  '  area(): number {',
  '    return this.size * this.size;',
  '  }',
  '}',
  '',
].join('\n');
const BOX_VITEST = {
  code: '__vite_ssr_exportName__("Box", () => { try { return Box } catch {} });\nclass Box {\n\tsize;\n\tconstructor(size) {\n\t\tthis.size = size;\n\t}\n\tarea() {\n\t\treturn this.size * this.size;\n\t}\n}\n',
  map: {
    version: 3,
    sources: ['box.ts'],
    names: [],
    mappings:
      ';AAAO,MAAM,IAAI;CACK;CAApB,YAAY,IAAQ,EAAc;EAAd;CAAe;CACnC,OAAe;EACb,OAAO,KAAK,OAAO,KAAK;CAC1B;AACF',
  },
};
/** What V8 counts on the own text: the module once, the constructor `built` times, `area` never. */
const boxRan = (built: number) => [
  {
    functionName: '',
    isBlockCoverage: true,
    ranges: [{ startOffset: 0, endOffset: BOX_TS.length, count: 1 }],
  },
  {
    functionName: 'Box',
    isBlockCoverage: true,
    ranges: [
      {
        startOffset: BOX_TS.indexOf('constructor'),
        endOffset: BOX_TS.indexOf('{}') + 2,
        count: built,
      },
    ],
  },
  {
    functionName: 'area',
    isBlockCoverage: true,
    ranges: [
      {
        startOffset: BOX_TS.indexOf('area'),
        endOffset: BOX_TS.lastIndexOf('  }') + 3,
        count: 0,
      },
    ],
  },
];

/** The count ast-v8-to-istanbul would read at `offset` of what was placed. */
const countOn = (
  placed: ReturnType<typeof placeOnTransform>,
  offset: number,
) => {
  if ('refusal' in placed) throw new Error(placed.refusal);
  return flattenRanges(placed.functions).find(
    ({ start, end }) => start <= offset && offset < end,
  )?.count;
};

describe('counts on the file’s own text are placed on Vitest’s transform of it (#913)', () => {
  it('a token the transform copies keeps the count it has in the own text', () => {
    // Babel's map read the other way: ARROW_TS is the text, ARROW_JS the transform.
    const placed = placeOnTransform(
      [
        {
          functionName: '',
          isBlockCoverage: true,
          ranges: [{ startOffset: 0, endOffset: ARROW_TS.length, count: 1 }],
        },
        {
          functionName: 'twice',
          isBlockCoverage: true,
          ranges: [
            {
              startOffset: ARROW_TS.indexOf('(n'),
              endOffset: ARROW_TS.indexOf(';'),
              count: 0,
            },
          ],
        },
      ],
      { code: ARROW_JS, map: ARROW_MAP },
      ARROW_TS,
    );
    expect(countOn(placed, ARROW_JS.indexOf('n =>'))).toBe(0);
    expect(countOn(placed, ARROW_JS.indexOf('n * 2'))).toBe(0);
    expect(countOn(placed, ARROW_JS.indexOf('globalThis'))).toBe(1);
  });

  it('a statement the transform adds takes the count of the text it is mapped to', () => {
    const placed = placeOnTransform(boxRan(3), BOX_VITEST, BOX_TS);
    expect(countOn(placed, BOX_VITEST.code.indexOf('this.size = size'))).toBe(
      3,
    );
    expect(countOn(placed, BOX_VITEST.code.indexOf('return this'))).toBe(0);
  });

  it('code before the first mapped segment takes the script’s own count', () => {
    const placed = placeOnTransform(boxRan(3), BOX_VITEST, BOX_TS);
    expect(countOn(placed, BOX_VITEST.code.indexOf('__vite_ssr'))).toBe(1);
    expect(countOn(placed, BOX_VITEST.code.indexOf('return Box'))).toBe(1);
  });

  it('a segment that names no source position continues the count before it', () => {
    const text = 'a();\nb();\n';
    const placed = placeOnTransform(
      [
        {
          functionName: '',
          isBlockCoverage: true,
          ranges: [
            { startOffset: 0, endOffset: text.length, count: 1 },
            // Through the newline, the character the inserted code follows.
            { startOffset: 0, endOffset: 5, count: 5 },
            { startOffset: 5, endOffset: 9, count: 2 },
          ],
        },
      ],
      {
        code: 'a();\nzz();\nb();\n',
        map: {
          version: 3,
          sources: ['ab.ts'],
          names: [],
          mappings: 'AAAA;A;AACA',
        },
      },
      text,
    );
    expect(countOn(placed, 'a();\nz'.length)).toBe(5);
    expect(countOn(placed, 'a();\nzz();\n'.length)).toBe(2);
  });

  it('the first range spans the whole transform and the rest lie inside it, apart', () => {
    const placed = placeOnTransform(boxRan(3), BOX_VITEST, BOX_TS);
    if ('refusal' in placed) throw new Error(placed.refusal);
    expect(placed.functions).toHaveLength(1);
    const [whole, ...inner] = placed.functions[0]?.ranges ?? [];
    expect(whole).toEqual({
      startOffset: 0,
      endOffset: BOX_VITEST.code.length,
      count: 1,
    });
    expect(inner.length).toBeGreaterThan(0);
    for (const [index, range] of inner.entries()) {
      expect(range.startOffset).toBeLessThan(range.endOffset);
      expect(range.endOffset).toBeLessThanOrEqual(BOX_VITEST.code.length);
      expect(range.count).not.toBe(1);
      expect(range.startOffset).toBeGreaterThanOrEqual(
        inner[index - 1]?.endOffset ?? 0,
      );
    }
  });

  it('unmapped code before the first mapped segment takes the script’s own count', () => {
    const text = 'a();\n';
    const placed = placeOnTransform(
      [
        {
          functionName: '',
          isBlockCoverage: true,
          ranges: [
            { startOffset: 0, endOffset: text.length, count: 1 },
            { startOffset: 0, endOffset: 4, count: 5 },
          ],
        },
      ],
      {
        code: 'zz();a();\n',
        map: { version: 3, sources: ['a.ts'], names: [], mappings: 'A,KAAA' },
      },
      text,
    );
    expect(countOn(placed, 0)).toBe(1);
    expect(countOn(placed, 'zz();'.length)).toBe(5);
  });

  it('a one-character token keeps its own count, not the next character’s', () => {
    const text = 'a;b;\n';
    const placed = placeOnTransform(
      [
        {
          functionName: '',
          isBlockCoverage: true,
          ranges: [
            { startOffset: 0, endOffset: text.length, count: 1 },
            { startOffset: 2, endOffset: 4, count: 0 },
          ],
        },
      ],
      {
        code: text,
        map: {
          version: 3,
          sources: ['ab.ts'],
          names: [],
          mappings: 'AAAA,CAAC,CAAC,CAAC',
        },
      },
      text,
    );
    expect(countOn(placed, 1)).toBe(1);
    expect(countOn(placed, 2)).toBe(0);
  });

  // grouping.ts 733, measured 2026-10-27: Vitest's map gives `}, () => ` one
  // segment, and V8's arrow range starts at its `(`, inside it.
  it('a range that starts inside a segment the transform copied starts there too', () => {
    const text = 'f({}, () => b);\n';
    const placed = placeOnTransform(
      [
        {
          functionName: '',
          isBlockCoverage: true,
          ranges: [
            { startOffset: 0, endOffset: text.length, count: 16 },
            {
              startOffset: text.indexOf('()'),
              endOffset: text.indexOf('b') + 1,
              count: 96,
            },
          ],
        },
      ],
      {
        code: text,
        map: {
          version: 3,
          sources: ['f.ts'],
          names: [],
          mappings: 'AAAA,IAAI,UAAU',
        },
      },
      text,
    );
    expect(countOn(placed, text.indexOf('}'))).toBe(16);
    expect(countOn(placed, text.indexOf('()'))).toBe(96);
    expect(countOn(placed, text.indexOf('b'))).toBe(96);
    expect(countOn(placed, text.indexOf(');'))).toBe(16);
  });

  // back-translate.ts 83-84, measured 2026-10-27: Vite prints
  // `filter((locale) =>` on one line where the own text breaks the line.
  it('whitespace the transform re-wrote is stepped over, on either side', () => {
    const text = 'f(\n  () => b);\n';
    const code = 'f(() =>  b);\n';
    const placed = placeOnTransform(
      [
        {
          functionName: '',
          isBlockCoverage: true,
          ranges: [
            { startOffset: 0, endOffset: text.length, count: 1 },
            {
              startOffset: text.indexOf('()'),
              endOffset: text.indexOf('b') + 1,
              count: 5,
            },
          ],
        },
      ],
      {
        code,
        map: { version: 3, sources: ['f.ts'], names: [], mappings: 'AAAA' },
      },
      text,
    );
    expect(countOn(placed, code.indexOf('()'))).toBe(5);
    expect(countOn(placed, code.indexOf('b'))).toBe(5);
    expect(countOn(placed, code.indexOf(');'))).toBe(1);
  });

  it('where the transform’s text stops matching, the rest of its segment keeps the last copied count', () => {
    const text = 'a;  b;\n';
    const code = 'a;\tb;\n';
    const placed = placeOnTransform(
      [
        {
          functionName: '',
          isBlockCoverage: true,
          ranges: [
            { startOffset: 0, endOffset: text.length, count: 1 },
            { startOffset: 1, endOffset: 4, count: 5 },
          ],
        },
      ],
      {
        code,
        map: {
          version: 3,
          sources: ['a.ts'],
          names: [],
          mappings: 'AAAA,GAAI',
        },
      },
      text,
    );
    expect(countOn(placed, code.indexOf(';'))).toBe(5);
    expect(countOn(placed, code.indexOf('\t'))).toBe(5);
    expect(countOn(placed, code.indexOf('b'))).toBe(1);
  });

  it('two segments at one place give no empty range', () => {
    const placed = placeOnTransform(
      boxRan(3),
      { ...BOX_VITEST, map: { ...BOX_VITEST.map, mappings: ';AAEE,AADA' } },
      BOX_TS,
    );
    // The first segment, on `area` (0), has no width: the second, on
    // `constructor` (3), starts where it does and holds the rest.
    const second = BOX_VITEST.code.indexOf('\n') + 1;
    expect(placed).toEqual({
      functions: [
        {
          functionName: '',
          isBlockCoverage: true,
          ranges: [
            { startOffset: 0, endOffset: BOX_VITEST.code.length, count: 1 },
            {
              startOffset: second,
              endOffset: BOX_VITEST.code.length,
              count: 3,
            },
          ],
        },
      ],
    });
  });

  it('refuses a map that names more than the file, naming its sources', () => {
    expect(
      placeOnTransform(
        boxRan(1),
        {
          ...BOX_VITEST,
          map: { ...BOX_VITEST.map, sources: ['box.ts', 'other.ts'] },
        },
        BOX_TS,
      ),
    ).toEqual({
      refusal:
        'carry-counts: Vitest’s transform’s map names 2 sources (box.ts, other.ts), not this file alone, so its tokens cannot all be placed in it',
    });
  });

  it('refuses a segment past the end of the file’s own text, naming it', () => {
    expect(
      placeOnTransform(
        boxRan(1),
        { ...BOX_VITEST, map: { ...BOX_VITEST.map, mappings: ';AAkBM' } },
        BOX_TS,
      ),
    ).toEqual({
      refusal:
        'carry-counts: Vitest’s transform’s map places a token at line 19, column 6 of a file with 7 lines, so it is not this file’s map',
    });
  });

  // coverage-processes.mjs 452, measured 2026-10-27: Vite rewrites
  // `import('vitest/node')` to a longer specifier and maps it character by
  // character, past the end of the line it came from.
  it('a column past the end of its line is read at the line’s end', () => {
    const text = "x = f('ab');\ny;\n";
    const placed = placeOnTransform(
      [
        {
          functionName: '',
          isBlockCoverage: true,
          ranges: [
            { startOffset: 0, endOffset: text.length, count: 1 },
            {
              startOffset: text.indexOf('y'),
              endOffset: text.length,
              count: 4,
            },
          ],
        },
      ],
      {
        code: "x = f('/long/ab');\ny;\n",
        map: {
          version: 3,
          sources: ['x.ts'],
          names: [],
          mappings: 'AAAA,YAAY,KAAK;AACjB',
        },
      },
      text,
    );
    expect(countOn(placed, 0)).toBe(1);
    // The segment mapped past the line, read at its end: the line's count.
    expect(countOn(placed, "x = f('/long/ab')".length)).toBe(1);
    expect(countOn(placed, "x = f('/long/ab');\n".length)).toBe(4);
  });

  it('refuses a map with no segment in the file, so no count is read', () => {
    expect(
      placeOnTransform(
        boxRan(1),
        { ...BOX_VITEST, map: { ...BOX_VITEST.map, mappings: 'A;A' } },
        BOX_TS,
      ),
    ).toEqual({
      refusal:
        'carry-counts: Vitest’s transform’s map places no token in the file, so its counts have nowhere to go',
    });
  });

  it('refuses mappings that do not decode, naming where', () => {
    expect(
      placeOnTransform(
        boxRan(1),
        { ...BOX_VITEST, map: { ...BOX_VITEST.map, mappings: 'A!' } },
        BOX_TS,
      ),
    ).toEqual({
      refusal:
        'carry-counts: the map’s mappings hold "!" at 1, which is not base64, so no position can be read from them',
    });
  });
});
