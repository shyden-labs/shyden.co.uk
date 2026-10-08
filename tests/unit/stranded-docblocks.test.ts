import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { floorBreach } from '../floors';
import { commentsIn, parseSource } from './ast';
import { astroCodeViews } from './source-text';
import { SOURCE_FILE, walkedSource } from '../git-questions';
import { ignoredByGit, searched, trackedFiles } from '../source-files';

/**
 * A docblock documents the declaration directly below it, so a docblock
 * sitting directly on ANOTHER docblock documents nothing: the lower one owns
 * the code, and the upper one describes something else, or nothing at all.
 *
 * Nine had accumulated by #175, most of them the shape of a declaration
 * inserted between an existing docblock and its code. `mediaType`'s "What a
 * capture actually is" ended up on top of `PUBLISH_NOTE`'s own docblock, with
 * `mediaType` further down and undocumented.
 *
 * A blank line after a docblock is the convention for a file or section
 * overview, and this leaves it alone.
 */

/** The files that hold code here (`SOURCE_FILE`, one home); an `.astro` file is read by its regions. */
const SOURCE = SOURCE_FILE;

/** Every source file on disk that git does not ignore, from the one walk. */
function scannedSource(): string[] {
  const candidates = walkedSource();
  const ignored = ignoredByGit(candidates);
  return candidates.filter((path) => !ignored.has(path));
}

/**
 * Every source file git tracks that the working tree still holds.
 *
 * A control on the walk, not a second source for it: the walk skips
 * dot-directories by design (`source-files.ts`), so a tracked script under
 * one would otherwise go unread without a word.
 */
function trackedSource(): string[] {
  return trackedFiles((path) => SOURCE.test(path));
}

interface DocblockScan {
  /** Every docblock read, by its text: what a clean verdict was drawn from. */
  readonly docblocks: readonly string[];
  /** Each docblock sitting directly on another, naming both files and lines. */
  readonly stranded: readonly string[];
}

/** True for a docblock: a block comment opened by `/**`, but not the empty one. */
const isDocblock = (text: string, comment: ts.CommentRange): boolean =>
  comment.kind === ts.SyntaxKind.MultiLineCommentTrivia &&
  text.startsWith('/**', comment.pos) &&
  !text.startsWith('/**/', comment.pos);

/** True when `gap` is whitespace alone, by the scanner's own definition. */
const isWhitespace = (gap: string): boolean =>
  gap.split('').every((ch) => ts.isWhiteSpaceLike(ch.charCodeAt(0)));

/** The line breaks in `gap`, by the scanner's definition, a CRLF counted once. */
const lineBreaksIn = (gap: string): number =>
  gap
    .split('')
    .filter(
      (ch, i) =>
        ts.isLineBreak(ch.charCodeAt(0)) &&
        !(ch === '\r' && gap[i + 1] === '\n'),
    ).length;

/**
 * The docblocks in one file, and each one sitting directly on another.
 *
 * Takes SOURCE, not a path, so the fixtures below can hand it text that is
 * not on disk; `file` names the findings and picks the grammar. An `.astro`
 * file is read one region at a time (`astroCodeViews`), each in a view that
 * keeps the file's own positions, so a line found there is a line of the file.
 *
 * Directly means the next comment is a docblock too, and only whitespace
 * separates them, with at most one line break: no blank line.
 */
function scanDocblocks(file: string, text: string): DocblockScan {
  const docblocks: string[] = [];
  const stranded: string[] = [];
  const views = file.endsWith('.astro') ? astroCodeViews(text) : [text];
  for (const view of views) {
    const sf = parseSource(view, file);
    const lineOf = (pos: number): number =>
      sf.getLineAndCharacterOfPosition(pos).line + 1;
    const comments = commentsIn(sf);
    comments.forEach((comment, i) => {
      if (!isDocblock(view, comment)) return;
      docblocks.push(view.slice(comment.pos, comment.end));
      const next = comments[i + 1];
      if (next === undefined || !isDocblock(view, next)) return;
      const gap = view.slice(comment.end, next.pos);
      if (isWhitespace(gap) && lineBreaksIn(gap) <= 1)
        stranded.push(
          `${file}:${lineOf(comment.pos)} sits directly on ${file}:${lineOf(next.pos)}`,
        );
    });
  }
  return { docblocks, stranded };
}

/** Each scanned file, its text, and what the detector found in it. */
const SCANS = scannedSource().map((file) => {
  const text = readFileSync(file, 'utf8');
  return { file, text, ...scanDocblocks(file, text) };
});

/** What the detector finds stranded in `source`, read as `file`. */
const strandedIn = (source: string, file = 'fixture.ts'): readonly string[] =>
  scanDocblocks(file, source).stranded;

describe('no docblock in tracked source sits directly on another', () => {
  it('reads every source file git tracks', () => {
    const tracked = trackedSource();
    const read = new Set(SCANS.map((scan) => scan.file));
    expect(
      searched(
        tracked.filter((path) => !read.has(path)),
        { of: tracked, what: 'tracked source files' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('stranded-docblocks/tracked-sources', tracked.length),
    ).toBeUndefined();
  });

  it('reads the kinds of source the ticket names, and no others', () => {
    // A pin, not a derivation. The walk and the git control above both filter
    // through SOURCE, so a narrowed SOURCE leaves them agreeing: mutation M12
    // dropped `.astro` and nothing went red. The kinds are the acceptance
    // criterion's own list.
    const paths = [
      'a.ts',
      'a.tsx',
      'a.mjs',
      'a.js',
      'a.astro',
      'a.css',
      'a.md',
      'a.json',
    ];
    expect(paths.filter((path) => SOURCE.test(path))).toEqual([
      'a.ts',
      'a.tsx',
      'a.mjs',
      'a.js',
      'a.astro',
    ]);
  });

  it('finds a docblock in every kind of source that holds one', () => {
    // Two independent readers. The raw bytes over-count, since a string can
    // spell a docblock, so a kind they find and the parser does not is a kind
    // the scan has gone blind to: an `.astro` reader returning no regions.
    const kindsOf = (scans: typeof SCANS) => [
      ...new Set(scans.map((scan) => extname(scan.file))),
    ];
    const read = kindsOf(SCANS.filter((scan) => scan.docblocks.length > 0));
    const held = kindsOf(SCANS.filter((scan) => scan.text.includes('/**')));
    expect(
      searched(
        held.filter((kind) => !read.includes(kind)),
        { of: held, what: 'kinds of source holding a docblock' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('stranded-docblocks/docblock-kinds', held.length),
    ).toBeUndefined();
  });

  it('finds none sitting directly on another', () => {
    const docblocks = SCANS.flatMap((scan) => scan.docblocks);
    expect(
      searched(
        SCANS.flatMap((scan) => scan.stranded),
        {
          of: docblocks,
          what: 'docblocks in tracked source',
        },
      ),
    ).toEqual([]);
    expect(
      floorBreach('stranded-docblocks/judged-docblocks', docblocks.length),
    ).toBeUndefined();
  });
});

describe('the detector catches a docblock sitting directly on another', () => {
  it('catches one on the line above another', () => {
    expect(
      strandedIn(['/** Upper. */', '/** Lower. */', 'const x = 1;'].join('\n')),
    ).toEqual(['fixture.ts:1 sits directly on fixture.ts:2']);
  });

  it('names the line each docblock starts on, not the line it ends on', () => {
    const source = [
      'const a = 1;',
      '',
      '/**',
      ' * Upper.',
      ' */',
      '/** Lower. */',
      'const x = 1;',
    ].join('\n');
    expect(strandedIn(source)).toEqual([
      'fixture.ts:3 sits directly on fixture.ts:6',
    ]);
  });

  it('catches two on one line', () => {
    expect(strandedIn('/** Upper. */ /** Lower. */ const x = 1;')).toEqual([
      'fixture.ts:1 sits directly on fixture.ts:1',
    ]);
  });

  it('counts a CRLF as one line break', () => {
    expect(
      strandedIn('/** Upper. */\r\n/** Lower. */\r\nconst x = 1;'),
    ).toEqual(['fixture.ts:1 sits directly on fixture.ts:2']);
  });

  it('catches an upper docblock sharing a line with the code before it', () => {
    // A trailing comment: `getLeadingCommentRanges` alone never returns it.
    const source = [
      'const a = 1; /** Upper. */',
      '/** Lower. */',
      'const x = 1;',
    ].join('\n');
    expect(strandedIn(source)).toEqual([
      'fixture.ts:1 sits directly on fixture.ts:2',
    ]);
  });

  it('catches a pair before a closing brace, which starts no node', () => {
    const source = [
      'function f() {',
      '  run();',
      '  /** Upper. */',
      '  /** Lower. */',
      '}',
    ].join('\n');
    expect(strandedIn(source)).toEqual([
      'fixture.ts:3 sits directly on fixture.ts:4',
    ]);
  });

  it('catches a pair at the end of the file', () => {
    expect(
      strandedIn(
        ['const x = 1;', '/** Upper. */', '/** Lower. */', ''].join('\n'),
      ),
    ).toEqual(['fixture.ts:2 sits directly on fixture.ts:3']);
  });

  it('catches every pair in a run of three', () => {
    const source = [
      '/** One. */',
      '/** Two. */',
      '/** Three. */',
      'const x = 1;',
    ];
    expect(strandedIn(source.join('\n'))).toEqual([
      'fixture.ts:1 sits directly on fixture.ts:2',
      'fixture.ts:2 sits directly on fixture.ts:3',
    ]);
  });
});

describe('the detector leaves alone a docblock that is not stranded', () => {
  it('is not fired across a blank line, the mark of an overview', () => {
    const source = ['/** Overview. */', '', '/** Lower. */', 'const x = 1;'];
    expect(scanDocblocks('fixture.ts', source.join('\n'))).toEqual({
      docblocks: ['/** Overview. */', '/** Lower. */'],
      stranded: [],
    });
  });

  it('is not fired by a line comment between two docblocks', () => {
    const source = [
      '/** Upper. */',
      '// A note.',
      '/** Lower. */',
      'const x = 1;',
    ];
    expect(scanDocblocks('fixture.ts', source.join('\n'))).toEqual({
      docblocks: ['/** Upper. */', '/** Lower. */'],
      stranded: [],
    });
  });

  it('is not fired by code between two docblocks on one line', () => {
    expect(
      scanDocblocks(
        'fixture.ts',
        '/** Upper. */ const a = 1; /** Lower. */ const x = 1;',
      ),
    ).toEqual({ docblocks: ['/** Upper. */', '/** Lower. */'], stranded: [] });
  });

  it('is not fired by a plain block comment, or an empty one', () => {
    const source = ['/* Plain. */', '/**/', '/** Lower. */', 'const x = 1;'];
    expect(scanDocblocks('fixture.ts', source.join('\n'))).toEqual({
      docblocks: ['/** Lower. */'],
      stranded: [],
    });
  });

  it('is not fired by docblock syntax in a string, a template or a regex', () => {
    const source = [
      "const s = '/** Upper. */ /** Lower. */';",
      'const t = `',
      '/** Upper. */',
      '/** Lower. */',
      '`;',
      'const r = /[/**]*/',
      '/** Lower. */',
      'const x = 1;',
    ];
    expect(scanDocblocks('fixture.ts', source.join('\n'))).toEqual({
      docblocks: ['/** Lower. */'],
      stranded: [],
    });
  });

  it('is not fired by docblock syntax in JSX text', () => {
    const source = [
      '/** The element. */',
      'const el = <p>/** Upper. */ /** Lower. */</p>;',
    ];
    expect(scanDocblocks('fixture.tsx', source.join('\n'))).toEqual({
      docblocks: ['/** The element. */'],
      stranded: [],
    });
  });

  it('is not fired by docblock syntax written just after a JSDoc link', () => {
    // JSDoc parses a `{@link}` into nodes INSIDE the comment, and the text
    // node after the link starts exactly at this second opener. Asked for
    // trivia there, the scanner reads a docblock sitting on the real one.
    const source = [
      '/** Matches {@link isDocblock} /** openers, never empty ones. */',
      'const x = 1;',
    ];
    expect(scanDocblocks('fixture.ts', source.join('\n'))).toEqual({
      docblocks: [
        '/** Matches {@link isDocblock} /** openers, never empty ones. */',
      ],
      stranded: [],
    });
  });
});

describe('the detector reads an .astro file by its code, at its own lines', () => {
  it('reads the frontmatter and each script, and not the markup', () => {
    const page = [
      '---',
      '/** Upper. */',
      '/** Lower. */',
      "const title = 'x';",
      '---',
      '<p>/** Markup. */ /** Is not code. */</p>',
      '<script>',
      '  /** Upper. */',
      '  /** Lower. */',
      '  run();',
      '</script>',
    ].join('\n');
    expect(strandedIn(page, 'page.astro')).toEqual([
      'page.astro:2 sits directly on page.astro:3',
      'page.astro:8 sits directly on page.astro:9',
    ]);
  });
});
