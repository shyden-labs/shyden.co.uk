import { describe, it, expect } from 'vitest';
import {
  astroCodeViews,
  astroFrontmatterView,
  astroScopedCss,
  astroScriptViews,
  astroStyleViews,
  astroTemplate,
  blankCommentLines,
  codeWithoutComments,
  cssComments,
  isCommentLine,
  stylesheetCss,
  stylesheetsIn,
  withoutAstroStyles,
  withoutCssComments,
  withoutSqlComments,
  withoutYamlComments,
  withoutYamlQuotes,
  withoutCommentLines,
  withoutIniComments,
  withoutTsComments,
  withoutMarkupComments,
} from './source-text';
import { floorBreach } from '../floors';
import { searched } from '../source-files';

/**
 * The stripper the source-text guards depend on. #24.
 *
 * If this is wrong, every guard built on it is wrong in one of two directions:
 * strip too little and a comment can satisfy an assertion (the defect this
 * exists to prevent), strip too much and real code disappears, which turns a
 * presence check green-by-deletion and an absence check red for no reason.
 */
describe('withoutTsComments', () => {
  it('removes a whole-line comment', () => {
    expect(withoutTsComments('// gone\nconst a = 1;')).not.toContain('gone');
  });

  it('removes a trailing comment but keeps the code before it', () => {
    const out = withoutTsComments('const a = 1; // @emulated-viewport');
    expect(out).toContain('const a = 1;');
    expect(out).not.toContain('@emulated-viewport');
  });

  it('removes block and doc comments', () => {
    expect(withoutTsComments('/** doc */ const a = 1;')).not.toContain('doc');
    expect(withoutTsComments('/* b */const a = 1;')).toContain('const a = 1;');
  });

  it('does NOT treat a URL as a comment', () => {
    // The regex version of this helper eats the rest of the line here, which
    // would hide any real code after a URL on the same line.
    const out = withoutTsComments("const u = 'https://a.test/x'; const b = 2;");
    expect(out).toContain('https://a.test/x');
    expect(out).toContain('const b = 2;');
  });

  it('keeps a comment marker that is inside a string literal', () => {
    // The string is the assertion's subject, not commentary about it.
    expect(withoutTsComments("expect(x).toContain('// TODO');")).toContain(
      "'// TODO'",
    );
  });

  it('keeps an escaped quote from ending the string early', () => {
    const out = withoutTsComments("const a = 'it\\'s'; // gone");
    expect(out).toContain("it\\'s");
    expect(out).not.toContain('gone');
  });

  it('handles template literals', () => {
    expect(withoutTsComments('const a = `a // b`;')).toContain('a // b');
  });
});

describe('withoutYamlComments', () => {
  it('removes an inline comment and drops the blank line it leaves', () => {
    expect(withoutYamlComments('key: v # note\n\nother: w')).toBe(
      'key: v\nother: w',
    );
  });
});

describe('withoutCommentLines', () => {
  it('removes a whole-line comment but leaves a trailing one alone', () => {
    // Trailing `#` in a workflow `run:` block can be inside a shell string,
    // and removing it would change the command being asserted about.
    const out = withoutCommentLines('# gone\nrun: echo "a # b"');
    expect(out).not.toContain('gone');
    expect(out).toContain('echo "a # b"');
  });
});

describe('withoutIniComments', () => {
  // npm's config format opens a comment with EITHER marker, which YAML does
  // not. `node-contract.test.ts` carried this as a private regex until #85 --
  // one of two `#`-dialect strippers the one-home guard could not see,
  // because that guard only ever looked for `//`.
  it('removes a # comment, a ; comment, and both inline', () => {
    // Distinctive tokens on purpose: `not.toContain('a')` would fail on
    // `save-exact` and prove nothing about comment stripping.
    const out = withoutIniComments(
      '# ALPHA\n; BETA\nengine-strict=true # GAMMA\nsave-exact=true ; DELTA',
    );
    for (const gone of ['ALPHA', 'BETA', 'GAMMA', 'DELTA'])
      expect(out, `${gone} survived`).not.toContain(gone);
    expect(out).toContain('engine-strict=true');
    expect(out).toContain('save-exact=true');
  });

  it('leaves a value alone when it carries neither marker', () => {
    expect(withoutIniComments('registry=https://registry.npmjs.org/')).toBe(
      'registry=https://registry.npmjs.org/',
    );
  });

  it('only treats a marker as one when it opens a field', () => {
    // `//registry...:_authToken` is a real .npmrc key. A `;` or `#` must be at
    // the start of a line or after whitespace to open a comment, which is why
    // this is not a naive split on the marker.
    expect(withoutIniComments('key=a;b')).toBe('key=a;b');
  });
});

describe('withoutYamlQuotes', () => {
  /**
   * YAML quoting is a style, not a meaning. `'actions/cache*'` and
   * `"actions/cache*"` are the same scalar, and a guard that matches one but
   * not the other fails on correct configuration.
   *
   * Found by building the org template repository against this repo's own
   * supply-chain guard: the group was written in this file's house style
   * (single quotes, as `'npm'` and `'develop'` are) and the guard reported it
   * ungrouped. A false alarm rather than a false pass, so the safe direction
   * -- but it would have reddened CI on a correct config and sent whoever hit
   * it looking for a problem that was not there.
   */
  it('treats single and double quoted scalars as the same text', () => {
    expect(withoutYamlQuotes("- 'actions/cache*'")).toBe(
      withoutYamlQuotes('- "actions/cache*"'),
    );
  });

  it('leaves an unquoted scalar alone', () => {
    expect(withoutYamlQuotes('- actions/cache*')).toContain('actions/cache*');
  });

  it('does not merge two adjacent scalars into one', () => {
    // `['a','b']` must not become `a,b` in a way that matches a pattern
    // spanning both -- the separator has to survive.
    expect(withoutYamlQuotes("['a','b']")).toBe('[a,b]');
  });
});

describe('withoutMarkupComments', () => {
  /**
   * `.astro` files are HTML as well as TypeScript, and `<!-- … -->` is a
   * comment the TS scanner cannot see.
   *
   * This matters most for `dead-copy.test.ts`, which asserts ABSENCE: a key is
   * dead if nothing references it, so an HTML comment naming a key keeps a
   * dead key looking alive and suppresses the finding with nothing going red.
   */
  it('removes an HTML comment', () => {
    expect(withoutMarkupComments('<!-- heroSubheading -->')).not.toContain(
      'heroSubheading',
    );
  });

  it('removes a multi-line HTML comment', () => {
    expect(
      withoutMarkupComments('<!--\n  removed in #17: heroSubheading\n-->'),
    ).not.toContain('heroSubheading');
  });

  it('leaves the markup around it intact', () => {
    expect(withoutMarkupComments('<p>a</p><!-- x --><p>b</p>')).toBe(
      '<p>a</p><p>b</p>',
    );
  });

  it('does not eat a lone angle bracket in text', () => {
    expect(withoutMarkupComments('<p>a < b</p>')).toContain('a < b');
  });
});

describe('withoutTsComments understands regex literals', () => {
  it('keeps code following a regex literal that contains a quote', () => {
    // The trailing comment is the real assertion: without regex support the
    // scanner opens a fake string at the `'` inside the class, stops seeing
    // comments, and passes this test by emitting the whole input verbatim.
    const kept = withoutTsComments(
      `const a = /['"]/g; // gone\nconst b = 2;\n`,
    );
    expect(kept).toContain('const b = 2;');
    expect(kept).not.toContain('gone');
  });

  it('keeps a regex literal that contains comment syntax', () => {
    const kept = withoutTsComments(
      `const r = /\\/\\*x\\*\\//g; // gone\nconst b = 2;\n`,
    );
    expect(kept).toContain('/\\/\\*x\\*\\//g');
    expect(kept).not.toContain('gone');
    expect(kept).toContain('const b = 2;');
  });

  it('still treats a slash after a value as division, not a regex', () => {
    const kept = withoutTsComments(`const x = a / b; // gone\nconst c = 3;\n`);
    expect(kept).toContain('a / b;');
    expect(kept).not.toContain('gone');
    expect(kept).toContain('const c = 3;');
  });

  it('strips a comment that follows a comment-stripping regex', () => {
    // Characterisation, not a reproduction: this shape survived the old
    // scanner too, because the backslashes keep the slashes non-adjacent.
    // It is here so the line-comment stripper's own shape stays covered.
    const kept = withoutTsComments(
      `const strip = (s: string) => s.replace(/\\/\\/.*$/gm, ''); // gone\nconst b = 2;\n`,
    );
    expect(kept).toContain('const b = 2;');
    expect(kept).not.toContain('gone');
  });
});

describe('blankCommentLines keeps line numbers intact', () => {
  it('blanks a comment line without removing it', () => {
    const out = blankCommentLines('a;\n// note\nb;\n');
    expect(out.split('\n')).toEqual(['a;', '', 'b;', '']);
  });

  it('blanks JSDoc openers and continuations too', () => {
    // A JSDoc quoting `test.fixme(` must not register as a parked test.
    expect(
      blankCommentLines('/**\n * test.fixme(\n */\nc;').split('\n'),
    ).toEqual(['', '', '', 'c;']);
  });

  it('leaves a trailing comment alone — whole lines only', () => {
    expect(blankCommentLines('a; // kept\n')).toBe('a; // kept\n');
  });

  it('exposes the per-line predicate for callers that walk backwards', () => {
    expect(['// x', ' * x', '/* x', 'code'].map(isCommentLine)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });
});

describe('astroCodeViews reads only the code an .astro file holds', () => {
  /**
   * A view keeps the file's length and every line break, so a parser reading
   * it reports the file's own positions and lines (#175).
   */
  it('reads the frontmatter, on its own lines', () => {
    const page = ['---', "const title = 'x';", '---', '<p>hi</p>'].join('\n');
    expect(astroCodeViews(page).map((view) => view.split('\n'))).toEqual([
      ['   ', "const title = 'x';", '   ', ' '.repeat(9)],
    ]);
  });

  it('reads each script body as a view of its own, and no markup', () => {
    const page = [
      '---',
      'const a = 1;',
      '---',
      '<p>two</p>',
      '<script>',
      '  go();',
      '</script>',
      '<script is:inline>stop();</script>',
    ].join('\n');
    expect(astroCodeViews(page).map((view) => view.trim())).toEqual([
      'const a = 1;',
      'go();',
      'stop();',
    ]);
  });

  it('keeps every CR and LF where the file has them', () => {
    const page =
      '---\r\nconst a = 1;\r\n---\r\n<script>\r\n  go();\r\n</script>\r\n';
    expect(astroCodeViews(page).map((view) => view.split('\r\n'))).toEqual([
      [
        '   ',
        'const a = 1;',
        '   ',
        ' '.repeat(8),
        ' '.repeat(7),
        ' '.repeat(9),
        '',
      ],
      [
        '   ',
        ' '.repeat(12),
        '   ',
        ' '.repeat(8),
        '  go();',
        ' '.repeat(9),
        '',
      ],
    ]);
  });

  it('never opens a script inside a markup comment that names one', () => {
    const page = [
      '<!-- every plain <script> is bundled, so this one is inline -->',
      '<script is:inline>',
      '  run();',
      '</script>',
    ].join('\n');
    expect(astroCodeViews(page).map((view) => view.trim())).toEqual(['run();']);
  });

  it('finds no code in a file with no frontmatter and no script', () => {
    const cases = [
      {
        case: 'markup only, no frontmatter, no script',
        page: '<p>only markup</p>',
      },
    ];
    expect(
      searched(
        cases.flatMap(({ page }) => astroCodeViews(page)),
        { of: cases, what: 'files handed to astroCodeViews' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('source-text/files-without-code', cases.length),
    ).toBeUndefined();
  });
});

describe('astroStyleViews reads only the CSS an .astro file holds', () => {
  /**
   * The same view shape as `astroCodeViews`, so a caller reading CSS reports
   * the file's own positions exactly as a caller reading code does (#200).
   */
  it('reads each style body as a view of its own, whatever its attributes', () => {
    const page = [
      '---',
      "const title = 'x';",
      '---',
      '<p>two</p>',
      '<style>',
      '  .a { color: red; }',
      '</style>',
      '<style is:global>.b { margin: 0; }</style>',
    ].join('\n');
    const views = astroStyleViews(page);
    expect(views.map((view) => view.length)).toEqual([
      page.length,
      page.length,
    ]);
    expect(views.map((view) => view.trim())).toEqual([
      '.a { color: red; }',
      '.b { margin: 0; }',
    ]);
  });

  it('never opens a style inside a markup comment that names one', () => {
    const page = [
      '<!-- every <style> here is scoped to this component -->',
      '<style>',
      '  .a { color: red; }',
      '</style>',
    ].join('\n');
    expect(astroStyleViews(page).map((view) => view.trim())).toEqual([
      '.a { color: red; }',
    ]);
  });

  it('never opens a style inside frontmatter that names one', () => {
    const page = [
      '---',
      '// the <style> below hides the headings',
      '---',
      '<style>.a { color: red; }</style>',
    ].join('\n');
    expect(astroStyleViews(page).map((view) => view.trim())).toEqual([
      '.a { color: red; }',
    ]);
  });

  it('finds no CSS in a file with no style', () => {
    const cases = [
      {
        case: 'frontmatter and markup, no style',
        page: '---\nconst a = 1;\n---\n<p>b</p>',
      },
    ];
    expect(
      searched(
        cases.flatMap(({ page }) => astroStyleViews(page)),
        { of: cases, what: 'files handed to astroStyleViews' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('source-text/files-without-a-style', cases.length),
    ).toBeUndefined();
  });
});

describe('astroFrontmatterView and astroScriptViews read what astroCodeViews joins', () => {
  /**
   * A guard that must tell a component's props from its scripts needs the two
   * apart (#331): a prop named `lang` is not a class a script could add.
   */
  const page = [
    '---',
    "const a = 'fm';",
    '---',
    '<p>two</p>',
    '<script>',
    "  go('sc');",
    '</script>',
    '<script is:inline>stop();</script>',
  ].join('\n');

  it('reads the frontmatter alone, as a view of the whole file', () => {
    const view = astroFrontmatterView(page);
    expect(view.length).toBe(page.length);
    expect(view.trim()).toBe("const a = 'fm';");
  });

  it('reads a file with no frontmatter as blank, never as an error', () => {
    const markupOnly = '<p>only markup</p>';
    expect(astroFrontmatterView(markupOnly)).toBe(
      ' '.repeat(markupOnly.length),
    );
  });

  it('reads each script body, and never the frontmatter', () => {
    expect(astroScriptViews(page).map((view) => view.trim())).toEqual([
      "go('sc');",
      'stop();',
    ]);
  });
});

describe('astroScopedCss reads only the CSS Astro scopes', () => {
  /**
   * Astro stamps its scope onto a plain `<style>` alone: `is:global` opts out
   * of scoping, and `is:inline` out of processing altogether (#331).
   */
  it('reads a plain style, and neither an is:global nor an is:inline one', () => {
    const page = [
      '<p>x</p>',
      '<style>.scoped { color: red; }</style>',
      '<style is:global>.global { margin: 0; }</style>',
      '<style is:inline>.inline { margin: 0; }</style>',
    ].join('\n');
    expect(astroScopedCss(page).map((css) => css.trim())).toEqual([
      '.scoped { color: red; }',
    ]);
  });

  it('scopes a style whatever its other attributes', () => {
    const page =
      '<style define:vars={{ hue }}>.tinted { color: var(--hue); }</style>';
    expect(astroScopedCss(page).map((css) => css.trim())).toEqual([
      '.tinted { color: var(--hue); }',
    ]);
  });

  it('strips the comments, so a class a comment names is not a selector', () => {
    const page = '<style>/* .ghost is gone */ .kept { color: red; }</style>';
    expect(astroScopedCss(page).map((css) => css.trim())).toEqual([
      '.kept { color: red; }',
    ]);
  });
});

describe('astroTemplate reads the markup a page is written in', () => {
  it('drops the frontmatter, every script and style body, and every comment', () => {
    const page = [
      '---',
      'const a = \'<b class="fm">\';',
      '---',
      '<!-- <b class="markup-comment"> -->',
      '{/* <b class="expression-comment"> */}',
      '<p class="kept">text</p>',
      '<script>const markup = \'<b class="sc">\';</script>',
      '<style>.st { content: \'class="st"\'; }</style>',
    ].join('\n');
    expect(astroTemplate(page).match(/class="[^"]*"/g)).toEqual([
      'class="kept"',
    ]);
  });
});

/**
 * The CSS stripper, which until #203 had no test of its own — the suite that
 * proves the strippers work proved every dialect but this one, and the defect
 * #203 records lived in its callers for as long.
 */
describe('withoutSqlComments (#390 F160)', () => {
  // An anchored match over raw SQL was taken as proof the line is real, and a
  // block comment holding the old line satisfied it while the column below
  // had changed. SQL has both comment forms and quotes that double to escape.
  it('removes a line comment and keeps the line break', () => {
    expect(withoutSqlComments('a INT, -- gone\nb INT')).toBe('a INT, \nb INT');
  });

  it('removes a block comment, across lines', () => {
    expect(withoutSqlComments('a INT,\n/*\n  b INT,\n*/\nc INT')).toBe(
      'a INT,\n\nc INT',
    );
  });

  it('keeps comment syntax inside a string, through a doubled quote', () => {
    const sql = "SELECT '--x', 'it''s /* kept */' -- gone";
    expect(withoutSqlComments(sql)).toBe("SELECT '--x', 'it''s /* kept */' ");
  });

  it('keeps comment syntax inside a quoted identifier', () => {
    expect(withoutSqlComments('SELECT "a--b" FROM t /* gone */')).toBe(
      'SELECT "a--b" FROM t ',
    );
  });

  it('reads an unclosed block comment to the end, as SQLite does', () => {
    expect(withoutSqlComments('a INT /* never closed\nb INT')).toBe('a INT ');
  });
});

describe('withoutCssComments', () => {
  it('removes a block comment and keeps the declarations around it', () => {
    expect(withoutCssComments('a{b:c} /* gone */ d{e:f}')).toBe(
      'a{b:c}  d{e:f}',
    );
  });

  it('keeps comment syntax that sits inside a string', () => {
    const css = "a { content: '/* not a comment */'; }";
    expect(withoutCssComments(css)).toBe(css);
  });

  it('keeps an escaped quote from ending the string it is in', () => {
    const css = "a { content: '\\'/* still a string */'; }";
    expect(withoutCssComments(css)).toBe(css);
  });

  it('runs an unterminated comment to the end, rather than copying it out', () => {
    expect(withoutCssComments('a{b:c} /* never closed')).toBe('a{b:c} ');
  });
});

describe('cssComments', () => {
  it('hands back every comment the strip removes, in order', () => {
    expect(cssComments('/* one */ a{b:c} /* two */')).toEqual([
      '/* one */',
      '/* two */',
    ]);
  });

  it('hands back the unterminated one it ran to the end', () => {
    expect(cssComments('a{b:c} /* never closed')).toEqual(['/* never closed']);
  });

  it('finds none where comment syntax is quoted', () => {
    const cases = [
      {
        case: 'comment syntax inside a quoted string',
        css: "a { content: '/* not a comment */'; }",
      },
    ];
    expect(
      searched(
        cases.flatMap(({ css }) => cssComments(css)),
        { of: cases, what: 'stylesheets handed to cssComments' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('source-text/quoted-comment-syntax', cases.length),
    ).toBeUndefined();
  });

  it('and the code it keeps is the code the stripper keeps', () => {
    // The two are one scan, and this is what says so: a second scanner
    // written to find what the first removed is the copy this file prevents.
    const css = "/* a */ x{y:'/* b */'} /* c */";
    expect(
      cssComments(css).reduce(
        (rest, comment) => rest.replace(comment, ''),
        css,
      ),
    ).toBe(withoutCssComments(css));
  });
});

/**
 * Reading an `.astro` file's CSS as CSS (#203).
 *
 * The apostrophe is the whole defect: over a WHOLE `.astro` file it opens a
 * string `withoutCssComments` never sees closed, and every comment below it
 * is copied out as if it were live CSS.
 */
const PAGE_WITH_APOSTROPHE = [
  '---',
  "const label = 'x';",
  '---',
  "<p>don't</p>",
  '<style>',
  '  /* the ink */',
  '  a { color: red; }',
  '</style>',
].join('\n');

describe('stylesheetsIn and stylesheetCss', () => {
  it('reads a .css file as one whole sheet', () => {
    expect(stylesheetsIn('t.css', 'a{b:c}')).toEqual(['a{b:c}']);
  });

  it('reads an .astro file as one sheet per style element', () => {
    const page = '<style>a{b:c}</style><p>x</p><style>d{e:f}</style>';
    expect(stylesheetsIn('p.astro', page).map((s) => s.trim())).toEqual([
      'a{b:c}',
      'd{e:f}',
    ]);
  });

  it('strips a style comment that a whole-file read leaves standing', () => {
    expect(withoutCssComments(PAGE_WITH_APOSTROPHE)).toContain('the ink');
    expect(
      stylesheetCss('p.astro', PAGE_WITH_APOSTROPHE).join('\n'),
    ).not.toContain('the ink');
  });

  it('keeps every line, so a sheet is read at the file\u2019s own line numbers', () => {
    const [sheet] = stylesheetCss('p.astro', PAGE_WITH_APOSTROPHE);
    expect(sheet?.split('\n')).toHaveLength(
      PAGE_WITH_APOSTROPHE.split('\n').length,
    );
    expect(sheet?.split('\n')[6]?.trim()).toBe('a { color: red; }');
  });
});

describe('withoutAstroStyles', () => {
  it('blanks a style body and leaves the rest of the file alone', () => {
    const out = withoutAstroStyles(PAGE_WITH_APOSTROPHE);
    expect(out).toHaveLength(PAGE_WITH_APOSTROPHE.length);
    expect(out).toContain("don't");
    expect(out).not.toContain('the ink');
    expect(out).not.toContain('color: red');
  });

  it('leaves a file with no style element untouched', () => {
    const page = '---\nconst a = 1;\n---\n<p>b</p>';
    expect(withoutAstroStyles(page)).toBe(page);
  });
});

describe('codeWithoutComments', () => {
  it('reads a .css file as CSS', () => {
    expect(codeWithoutComments('t.css', '/* x */ a{b:c}').trim()).toBe(
      'a{b:c}',
    );
  });

  it('reads a .ts file as TypeScript', () => {
    expect(codeWithoutComments('t.ts', 'const a = 1; // x').trim()).toBe(
      'const a = 1;',
    );
  });

  it('reads an .astro file in both halves, so neither kind of comment survives', () => {
    const page = [
      '---',
      '// a frontmatter note',
      "const label = 'x';",
      '---',
      '<!-- a markup note -->',
      "<p>don't</p>",
      '<style>',
      '  /* a style note */',
      '  a { color: red; }',
      '</style>',
    ].join('\n');
    const code = codeWithoutComments('p.astro', page);

    expect(code).not.toContain('a frontmatter note');
    expect(code).not.toContain('a markup note');
    expect(code).not.toContain('a style note');
    // ...and the code of all three halves is still there to be searched.
    expect(code).toContain("const label = 'x'");
    expect(code).toContain("don't");
    expect(code).toContain('color: red');
  });

  it('still sees a value spelled in markup, which no style view carries', () => {
    // Not a real brand colour: `shytalk-brand.test.ts` searches every file
    // under `tests/` for one, and caught this fixture when it was.
    const page = '<p style="color: #123456">x</p>';
    expect(codeWithoutComments('p.astro', page)).toContain('#123456');
  });
});

describe('withoutTsComments reads substitutions inside template literals (#364)', () => {
  // A template is text, `${` opens code, and that code may hold a template of
  // its own. Scanning backtick-to-backtick reads a nested template inside out:
  // its text as code, where `</b>` starts a phantom regex, and a later
  // backtick opens a template that never closes, keeping every comment below.
  it('strips a comment after a nested template whose text holds a slash', () => {
    const template = "`${xs.map((x) => `<b>${x}</b>`).join('')}</p>`";
    const out = withoutTsComments(
      `const a = ${template}; // gone\nconst b = 2;\n`,
    );
    expect(out).toContain(template);
    expect(out).toContain('const b = 2;');
    expect(out).not.toContain('gone');
  });

  it('strips past the line that found it, in release-map.mjs (#362)', () => {
    const line =
      '`${otherAreas.map(([area, n]) => `${esc(area)} <span class="mono">${n}</span>`).join(\' · \')}</p>`';
    const out = withoutTsComments(
      `const others = ${line};\n// gone\n/** gone too */\nconst c = 3;\n`,
    );
    expect(out).toContain(line);
    expect(out).toContain('const c = 3;');
    expect(out).not.toContain('gone');
  });

  it('keeps comment syntax that is text in a nested template', () => {
    const template = '`${urls.map((u) => `https://x.test/${u} /* kept */`)}`';
    const out = withoutTsComments(`const a = ${template}; // gone\n`);
    expect(out).toContain(template);
    expect(out).not.toContain('gone');
  });

  it('strips a comment written inside a substitution', () => {
    const out = withoutTsComments('const a = `x${ /* gone */ b }y`;\n');
    expect(out).toContain('`x${');
    expect(out).toContain('b }y`');
    expect(out).not.toContain('gone');
  });

  it('nests three templates deep and comes back out', () => {
    const template = '`a${`b${`c${d}/c`}/b`}/a`';
    const out = withoutTsComments(
      `const x = ${template}; // gone\nconst e = 1;\n`,
    );
    expect(out).toContain(template);
    expect(out).toContain('const e = 1;');
    expect(out).not.toContain('gone');
  });

  // Each edge below puts a comment in the substitution's code AFTER the
  // construct under test. Closing the substitution early reads that code as
  // template text, and template text keeps comments, so only a comment there
  // can tell an early close from a right one (an early close was green here
  // until the comment was added).
  it('closes a substitution at its own brace, past an object literal holding a backtick', () => {
    const out = withoutTsComments(
      "const x = `${ {a: '`'}.a /* gone */ } // kept`; // gone too\n",
    );
    expect(out).toContain("`${ {a: '`'}.a  } // kept`");
    expect(out).not.toContain('gone');
  });

  it('is not closed by a brace inside a string or a regex in a substitution', () => {
    for (const [source, kept] of [
      ["`${'}' /* gone */} // kept`", "`${'}' } // kept`"],
      [
        "`${a.replace(/}/g, '') /* gone */} // kept`",
        "`${a.replace(/}/g, '') } // kept`",
      ],
    ] as const) {
      const out = withoutTsComments(`const x = ${source}; // gone too\n`);
      expect(out, source).toContain(kept);
      expect(out, source).not.toContain('gone');
    }
  });

  it('reads an escaped \\${ and a lone $ as text, not code', () => {
    for (const template of ['`\\${ not code // kept`', '`cost $5 // kept`']) {
      const out = withoutTsComments(`const x = ${template}; // gone\n`);
      expect(out, template).toContain(template);
      expect(out, template).not.toContain('gone');
    }
  });
});
