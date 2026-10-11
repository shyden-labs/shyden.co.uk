import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { filesUnder, searched } from '../source-files';
import { floorBreach } from '../floors';
import { codeWithoutComments } from '../unit/source-text';

/**
 * Every custom property `src` reads is defined somewhere in `src` (#390 F62).
 *
 * `PhoneFrame.astro` drew its bezel with `border: 2px solid var(--line)`, and
 * no `--line` existed. A `var()` naming nothing makes its whole declaration
 * invalid at computed-value time, so the border fell back to `none`: the
 * "minimal bezel" the component describes was never painted, and no test
 * could see a border that was not there. A fallback does not excuse it either:
 * `var(--muted, inherit)` paints `inherit` forever and reads as a choice.
 *
 * A property is defined by a declaration (`--x:` in a stylesheet, a style
 * block or a style attribute), by a `define:vars` key, or by
 * `style.setProperty('--x', …)`. Comments are stripped first in each file's
 * own language, or a comment spelling `--x:` would define it and a comment
 * naming `var(--x)` would read it.
 */
const DECLARED = /(--[A-Za-z0-9_-]+)['"]?\s*:/g;
const SET_PROPERTY = /setProperty\(\s*['"](--[A-Za-z0-9_-]+)/g;
const DEFINE_VARS = /define:vars=\{\{([\s\S]*?)\}\}/g;
const VARS_KEY = /([A-Za-z_][A-Za-z0-9_]*)\s*:/g;
const READ = /var\(\s*(--[A-Za-z0-9_-]+)/g;

const all = (pattern: RegExp, text: string): string[] =>
  [...text.matchAll(pattern)].map((match) => match[1]);

interface Properties {
  defined: Set<string>;
  read: Map<string, string[]>;
}

/** What each file defines and reads, keyed by property, with where each read is. */
function propertiesOf(files: ReadonlyMap<string, string>): Properties {
  const defined = new Set<string>();
  const read = new Map<string, string[]>();
  for (const [path, raw] of files) {
    const text = codeWithoutComments(path, raw);
    for (const name of [...all(DECLARED, text), ...all(SET_PROPERTY, text)])
      defined.add(name);
    for (const block of all(DEFINE_VARS, text))
      for (const key of all(VARS_KEY, block)) defined.add(`--${key}`);
    for (const name of all(READ, text))
      read.set(name, [...(read.get(name) ?? []), path]);
  }
  return { defined, read };
}

const undefinedReads = ({ defined, read }: Properties): string[] =>
  [...read]
    .filter(([name]) => !defined.has(name))
    .map(
      ([name, paths]) => `${name} (read in ${[...new Set(paths)].join(', ')})`,
    );

const undefinedIn = (files: Record<string, string>): string[] =>
  undefinedReads(propertiesOf(new Map(Object.entries(files))));

/** Every var() read written in `files`, comments included: what the scan must judge. */
const readsWritten = (files: Record<string, string>): string[] =>
  Object.values(files).flatMap((raw) => all(READ, raw));

describe('propertiesOf reads definitions and reads, not comments', () => {
  it('names a property read and never defined', () => {
    expect(undefinedIn({ 'a.css': '.a { color: var(--line); }' })).toEqual([
      '--line (read in a.css)',
    ]);
  });

  it('does not excuse a read that carries a fallback', () => {
    expect(
      undefinedIn({ 'a.css': '.a { color: var(--muted, inherit); }' }),
    ).toEqual(['--muted (read in a.css)']);
  });

  it('accepts a property defined in another file', () => {
    const files = {
      'tokens.css': ':root { --ink: #000; }',
      'a.astro': '<style>.a { color: var(--ink); }</style>',
    };
    const reads = readsWritten(files);
    expect(
      searched(undefinedIn(files), {
        of: reads,
        what: 'var() reads in the fixture',
      }),
    ).toEqual([]);
    expect(
      floorBreach('custom-properties/other-file-reads', reads.length),
    ).toBeUndefined();
  });

  it('accepts a define:vars key as a definition', () => {
    const files = {
      'a.astro':
        '<style define:vars={{ frameWidth: `${w}px` }}>.a { width: var(--frameWidth); }</style>',
    };
    const reads = readsWritten(files);
    expect(
      searched(undefinedIn(files), {
        of: reads,
        what: 'var() reads in the fixture',
      }),
    ).toEqual([]);
    expect(
      floorBreach('custom-properties/define-vars-reads', reads.length),
    ).toBeUndefined();
  });

  it('accepts setProperty and a quoted style key as definitions', () => {
    const files = {
      'a.ts': "el.style.setProperty('--x', '1');",
      'b.astro': "<div style={{ '--y': 2 }} />",
      'c.css': '.c { a: var(--x); b: var(--y); }',
    };
    const reads = readsWritten(files);
    expect(
      searched(undefinedIn(files), {
        of: reads,
        what: 'var() reads in the fixture',
      }),
    ).toEqual([]);
    expect(
      floorBreach('custom-properties/set-property-reads', reads.length),
    ).toBeUndefined();
  });

  it('lets no comment define a property', () => {
    expect(
      undefinedIn({
        'a.css': '/* --line: #ccc; */ .a { color: var(--line); }',
      }),
    ).toEqual(['--line (read in a.css)']);
  });

  it('lets no comment read a property', () => {
    const files = { 'a.astro': '<style>/* var(--muted) */ .a {}</style>' };
    const reads = readsWritten(files);
    expect(
      searched(undefinedIn(files), {
        of: reads,
        what: 'var() reads in the fixture',
      }),
    ).toEqual([]);
    expect(
      floorBreach('custom-properties/comment-reads', reads.length),
    ).toBeUndefined();
  });
});

describe('no custom property is read without a definition (#390 F62)', () => {
  it('every var() in src names a property src defines', () => {
    const paths = filesUnder('src', (path) =>
      /\.(astro|css|ts|js|mjs)$/.test(path),
    );
    const properties = propertiesOf(
      new Map(paths.map((path) => [path, readFileSync(path, 'utf8')])),
    );
    const read = [...properties.read.keys()];
    expect(
      searched(undefinedReads(properties), {
        of: read,
        what: 'custom properties read',
      }),
    ).toEqual([]);
    expect(
      floorBreach('custom-properties/read-properties', read.length),
    ).toBeUndefined();
  });
});
