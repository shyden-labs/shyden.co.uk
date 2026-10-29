import { describe, expect, it } from 'vitest';
import {
  convertScripts,
  type V8Function,
  type VitestTool,
} from '../../scripts/coverage-processes.mjs';
import { fixtureReader } from '../fixture-texts';
import { remap } from '../source-map-fixtures';

/**
 * Node runs TypeScript by blanking its types to spaces, so V8's range for
 * `private parts()` starts at `parts` and for `<T>(x) => x` at `(`, while
 * Vitest's transform drops that text. A function must read the count of its
 * own V8 range, never the enclosing one: a function no test calls reading 1
 * hides it from the changed-line rule (#959). Each form carries Vitest's own
 * transform of it, measured with vite 8.3.4 and vitest 5.0.5 on 2026-10-29,
 * because the map's shape is the defect: it places `never` where `private`
 * began and the arrow's `(` inside `askForJson = `, which a map placing every
 * kept character where it was never showed (all nine passed on one, while the
 * real pair read every function 1). `tests/integration/coverage-processes-script.test.ts`
 * runs the real pair, so a vite that maps otherwise is caught there.
 */
const ROOT = '/repo';

/** Vitest's transform of exactly this form's text, as measured; any other text is refused. */
const toolMeasured = (form: Form): VitestTool => ({
  transform: async (_absolute, text) => {
    if (text !== `${form.lines.join('\n')}\n`)
      throw new Error(`${form.name}: no measured transform of this text`);
    return {
      code: form.vite.code,
      map: {
        version: 3,
        sources: ['k.ts'],
        names: [],
        mappings: form.vite.mappings,
      },
    };
  },
  remap,
});

interface Form {
  readonly name: string;
  /** the file's own text; `never` is called by no test, `called` by 7 */
  readonly lines: readonly string[];
  /** Vitest's transform of the text: its code and its map's mappings */
  readonly vite: { readonly code: string; readonly mappings: string };
  /** the identifier V8's range for each function starts at */
  readonly starts: { never: string; called: string };
}

const FORMS: readonly Form[] = [
  {
    name: 'a private method',
    lines: [
      'export class K {',
      '  private never() {',
      '    return 1;',
      '  }',
      '  private called() {',
      '    return 2;',
      '  }',
      '}',
    ],
    vite: {
      code: '__vite_ssr_exportName__("K", () => { try { return K } catch {} });\nclass K {\n\tnever() {\n\t\treturn 1;\n\t}\n\tcalled() {\n\t\treturn 2;\n\t}\n}\n',
      mappings:
        ';AAAO,MAAM,EAAE;CACb,KAAQ,GAAQ;EACd,OAAO;CACT;CACA,MAAQ,GAAS;EACf,OAAO;CACT;AACF',
    },
    starts: { never: 'never', called: 'called' },
  },
  {
    name: 'a protected method',
    lines: [
      'export class K {',
      '  protected never() {',
      '    return 1;',
      '  }',
      '  protected called() {',
      '    return 2;',
      '  }',
      '}',
    ],
    vite: {
      code: '__vite_ssr_exportName__("K", () => { try { return K } catch {} });\nclass K {\n\tnever() {\n\t\treturn 1;\n\t}\n\tcalled() {\n\t\treturn 2;\n\t}\n}\n',
      mappings:
        ';AAAO,MAAM,EAAE;CACb,KAAU,GAAQ;EAChB,OAAO;CACT;CACA,MAAU,GAAS;EACjB,OAAO;CACT;AACF',
    },
    starts: { never: 'never', called: 'called' },
  },
  {
    name: 'a public method',
    lines: [
      'export class K {',
      '  public never() {',
      '    return 1;',
      '  }',
      '  public called() {',
      '    return 2;',
      '  }',
      '}',
    ],
    vite: {
      code: '__vite_ssr_exportName__("K", () => { try { return K } catch {} });\nclass K {\n\tnever() {\n\t\treturn 1;\n\t}\n\tcalled() {\n\t\treturn 2;\n\t}\n}\n',
      mappings:
        ';AAAO,MAAM,EAAE;CACb,KAAO,GAAQ;EACb,OAAO;CACT;CACA,MAAO,GAAS;EACd,OAAO;CACT;AACF',
    },
    starts: { never: 'never', called: 'called' },
  },
  {
    name: 'an override method',
    lines: [
      'export class K extends Object {',
      '  override never() {',
      '    return 1;',
      '  }',
      '  override called() {',
      '    return 2;',
      '  }',
      '}',
    ],
    vite: {
      code: '__vite_ssr_exportName__("K", () => { try { return K } catch {} });\nclass K extends Object {\n\tnever() {\n\t\treturn 1;\n\t}\n\tcalled() {\n\t\treturn 2;\n\t}\n}\n',
      mappings:
        ';AAAO,MAAM,UAAU,OAAO;CAC5B,KAAS,GAAQ;EACf,OAAO;CACT;CACA,MAAS,GAAS;EAChB,OAAO;CACT;AACF',
    },
    starts: { never: 'never', called: 'called' },
  },
  {
    name: 'a readonly property holding an arrow',
    lines: [
      'export class K {',
      '  readonly never = () => {',
      '    return 1;',
      '  };',
      '  readonly called = () => {',
      '    return 2;',
      '  };',
      '}',
    ],
    vite: {
      code: '__vite_ssr_exportName__("K", () => { try { return K } catch {} });\nclass K {\n\tnever = () => {\n\t\treturn 1;\n\t};\n\tcalled = () => {\n\t\treturn 2;\n\t};\n}\n',
      mappings:
        ';AAAO,MAAM,EAAE;CACb,KAAS,SAAc;EACrB,OAAO;CACT;CACA,MAAS,SAAe;EACtB,OAAO;CACT;AACF',
    },
    starts: { never: '() =>', called: '() =>' },
  },
  {
    name: 'a generic arrow',
    lines: [
      'export const never = <T,>(x: T) => {',
      '  return x;',
      '};',
      'export const called = <T,>(x: T) => {',
      '  return x;',
      '};',
    ],
    vite: {
      code: '__vite_ssr_exportName__("never", () => { try { return never } catch {} });\n__vite_ssr_exportName__("called", () => { try { return called } catch {} });\nconst never = (x) => {\n\treturn x;\n};\nconst called = (x) => {\n\treturn x;\n};\n',
      mappings:
        ';;AAAO,MAAM,SAAa,MAAS;CACjC,OAAO;AACT;AACO,MAAM,UAAc,MAAS;CAClC,OAAO;AACT',
    },
    starts: { never: '(x', called: '(x' },
  },
  {
    name: 'a generic function',
    lines: [
      'export function never<T>(x: T) {',
      '  return x;',
      '}',
      'export function called<T>(x: T) {',
      '  return x;',
      '}',
    ],
    vite: {
      code: '__vite_ssr_exportName__("never", () => { try { return never } catch {} });\n__vite_ssr_exportName__("called", () => { try { return called } catch {} });\nfunction never(x) {\n\treturn x;\n};\nfunction called(x) {\n\treturn x;\n}\n',
      mappings:
        ';;AAAO,SAAS,MAAS,GAAM;CAC7B,OAAO;AACT;AACO,SAAS,OAAU,GAAM;CAC9B,OAAO;AACT',
    },
    starts: { never: 'function never', called: 'function called' },
  },
  {
    name: 'a private generic method',
    lines: [
      'export class K {',
      '  private never<T>(x: T) {',
      '    return x;',
      '  }',
      '  private called<T>(x: T) {',
      '    return x;',
      '  }',
      '}',
    ],
    vite: {
      code: '__vite_ssr_exportName__("K", () => { try { return K } catch {} });\nclass K {\n\tnever(x) {\n\t\treturn x;\n\t}\n\tcalled(x) {\n\t\treturn x;\n\t}\n}\n',
      mappings:
        ';AAAO,MAAM,EAAE;CACb,KAAQ,CAAS,GAAM;EACrB,OAAO;CACT;CACA,MAAQ,CAAU,GAAM;EACtB,OAAO;CACT;AACF',
    },
    starts: { never: 'never', called: 'called' },
  },
  {
    name: 'a private async method',
    lines: [
      'export class K {',
      '  private async never() {',
      '    return 1;',
      '  }',
      '  private async called() {',
      '    return 2;',
      '  }',
      '}',
    ],
    vite: {
      code: '__vite_ssr_exportName__("K", () => { try { return K } catch {} });\nclass K {\n\tasync never() {\n\t\treturn 1;\n\t}\n\tasync called() {\n\t\treturn 2;\n\t}\n}\n',
      mappings:
        ';AAAO,MAAM,EAAE;CACb,MAAc,QAAQ;EACpB,OAAO;CACT;CACA,MAAc,SAAS;EACrB,OAAO;CACT;AACF',
    },
    starts: { never: 'async never', called: 'async called' },
  },
  {
    name: 'a private method whose name begins as private does',
    lines: [
      'export class K {',
      '  private prune() {',
      '    return 1;',
      '  }',
      '  private pick() {',
      '    return 2;',
      '  }',
      '}',
    ],
    vite: {
      code: '__vite_ssr_exportName__("K", () => { try { return K } catch {} });\nclass K {\n\tprune() {\n\t\treturn 1;\n\t}\n\tpick() {\n\t\treturn 2;\n\t}\n}\n',
      mappings:
        ';AAAO,MAAM,EAAE;CACb,KAAQ,GAAQ;EACd,OAAO;CACT;CACA,IAAQ,GAAO;EACb,OAAO;CACT;AACF',
    },
    starts: { never: 'prune', called: 'pick' },
  },
  {
    name: 'a readonly property whose name begins as readonly does',
    lines: [
      'export class K {',
      '  readonly run = () => {',
      '    return 1;',
      '  };',
      '  readonly rest = () => {',
      '    return 2;',
      '  };',
      '}',
    ],
    vite: {
      code: '__vite_ssr_exportName__("K", () => { try { return K } catch {} });\nclass K {\n\trun = () => {\n\t\treturn 1;\n\t};\n\trest = () => {\n\t\treturn 2;\n\t};\n}\n',
      mappings:
        ';AAAO,MAAM,EAAE;CACb,GAAS,SAAY;EACnB,OAAO;CACT;CACA,IAAS,SAAa;EACpB,OAAO;CACT;AACF',
    },
    starts: { never: '() =>', called: '() =>' },
  },
  {
    name: 'a generic arrow whose type parameter holds a parenthesis',
    lines: [
      'export const never = <T extends (a: number) => void,>(x: T) => {',
      '  return x;',
      '};',
      'export const called = <T extends (a: number) => void,>(x: T) => {',
      '  return x;',
      '};',
    ],
    vite: {
      code: '__vite_ssr_exportName__("never", () => { try { return never } catch {} });\n__vite_ssr_exportName__("called", () => { try { return called } catch {} });\nconst never = (x) => {\n\treturn x;\n};\nconst called = (x) => {\n\treturn x;\n};\n',
      mappings:
        ';;AAAO,MAAM,SAAyC,MAAS;CAC7D,OAAO;AACT;AACO,MAAM,UAA0C,MAAS;CAC9D,OAAO;AACT',
    },
    starts: { never: '(x', called: '(x' },
  },
];

/** The function V8 counted: from `start` to the `}` closing its body. */
const counted = (
  text: string,
  after: string,
  start: string,
  count: number,
): V8Function => {
  const startOffset = text.indexOf(
    start,
    after === '' ? 0 : text.indexOf(after) + 1,
  );
  const endOffset = text.indexOf('}', startOffset) + 1;
  return {
    functionName: '',
    isBlockCoverage: true,
    ranges: [{ startOffset, endOffset, count }],
  };
};

/** Each function as `line=count`, in the report's order. */
const functionCounts = (report: Record<string, unknown>) => {
  const coverage = report[`${ROOT}/src/k.ts`] as {
    fnMap: Record<string, { decl: { start: { line: number } } }>;
    f: Record<string, number>;
  };
  return Object.entries(coverage.fnMap)
    .map(([id, { decl }]) => `${decl.start.line}=${coverage.f[id]}`)
    .toSorted();
};

describe('a function starting with TypeScript-only text reads its own count (#959)', () => {
  for (const form of FORMS)
    it(`${form.name}: the one no test calls reads 0, the one called reads its own count`, async () => {
      const text = `${form.lines.join('\n')}\n`;
      const never = counted(text, '', form.starts.never, 0);
      const called = counted(text, form.starts.never, form.starts.called, 7);
      // `never` is found first by indexOf in the second call's `after`
      // anchor, so `called` starts past it.
      const result = await convertScripts(
        [
          {
            url: 'file:///repo/src/k.ts',
            functions: [
              {
                functionName: '',
                isBlockCoverage: true,
                ranges: [{ startOffset: 0, endOffset: text.length, count: 1 }],
              },
              never,
              called,
            ],
          },
        ],
        fixtureReader({ 'src/k.ts': text }),
        ROOT,
        toolMeasured(form),
      );
      const lineOf = (needle: string, from: number) =>
        text.slice(0, text.indexOf(needle, from)).split('\n').length;
      const neverLine = lineOf(form.starts.never, 0);
      const calledLine = lineOf(
        form.starts.called,
        text.indexOf(form.starts.never) + 1,
      );
      expect('report' in result && functionCounts(result.report)).toEqual(
        [`${neverLine}=0`, `${calledLine}=7`].toSorted(),
      );
    });
});
