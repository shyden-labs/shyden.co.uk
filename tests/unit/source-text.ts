/**
 * Comment stripping for the guards that assert against source text. #24.
 *
 * Several suites in this repo read a file as TEXT and assert that something
 * appears in it, or does not. Every one of them is exposed to the same defect,
 * and this repo has now shipped it three times:
 *
 * 1. #23 — `supply-chain.test.ts` asserted `dependabot.yml` contained
 *    `"actions/cache*"`, and the file's own explanatory NOTE spelled that
 *    pattern out verbatim. No group was configured at all; the suite was
 *    green.
 * 2. #21 Stage 4 — `pipeline-wiring.test.ts`'s first dev-sanity check searched
 *    raw text, and pointing the run step at a different config left it green,
 *    because that file's own comment explaining the fix contained the filename
 *    it was looking for.
 * 3. #35 — the pre-push hook guard asserted the hook source contained
 *    `npm run test:unit`. It passed while the hook did NOT run it: the string
 *    survived inside the failure hint the hook prints telling you how to run
 *    it by hand.
 *
 * All three read as obviously correct. None was found by review; each was
 * found by mutation, which is why the standing rule pairs the two: assert on
 * the stripped text, and watch it fail.
 *
 * THE INVERSE IS ALSO A DEFECT and is easier to miss, because nothing goes
 * red. `dead-copy.test.ts` asserts ABSENCE — a key is dead if nothing
 * references it — so a comment naming a key keeps a dead key looking alive and
 * SUPPRESSES a finding rather than satisfying an assertion. Same cause, no
 * symptom.
 */

/**
 * YAML with comments removed, inline ones included, and blank lines dropped.
 *
 * `# vX.Y.Z` beside a pinned action SHA is meaningful data, not prose, so
 * anything checking those version comments must read the RAW text — this is
 * for config bodies where a `#` is always commentary.
 */
export const withoutYamlComments = (text: string): string =>
  text
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, ''))
    .filter((line) => line.trim() !== '')
    .join('\n');

/**
 * `.npmrc`/INI text with its comments removed, inline ones included.
 *
 * A genuinely different dialect, not a parameter on `withoutYamlComments`:
 * npm's config format opens a comment with EITHER `#` or `;`. It lived as a
 * private regex in `node-contract.test.ts` until #85 — one of two `#`-dialect
 * strippers `one-home.test.ts` could not see, because that rule only ever
 * looked for `//`.
 *
 * A marker opens a comment only at the start of a line or after whitespace.
 * `//registry.npmjs.org/:_authToken` is a real key and `key=a;b` is a real
 * value, so a naive split on the marker would corrupt both.
 *
 * Blank lines are KEPT, unlike `withoutYamlComments`: callers here read the
 * file line by line and drop what does not parse, so removing lines would
 * only make a reported line number wrong.
 */
export const withoutIniComments = (text: string): string =>
  text
    .split('\n')
    .map((line) => line.replace(/(^|\s)[#;].*$/, ''))
    .join('\n');

/**
 * YAML with its scalar quote characters removed.
 *
 * Quoting in YAML is a STYLE, not a meaning: `'actions/cache*'` and
 * `"actions/cache*"` are the same scalar. A guard that greps for one spelling
 * reports a correct config as missing, which is a false ALARM rather than a
 * false pass -- the safe direction, but it reddens CI on config that is right
 * and sends whoever hits it hunting a problem that does not exist.
 *
 * Found by building the org template repository against this repo's own
 * supply-chain guard. The template configured the sub-path group in this
 * repo's own house style (single quotes, as `'npm'` and `'develop'` are
 * written) and the guard called it ungrouped.
 *
 * Only the quote characters go; separators and structure stay, so `['a','b']`
 * becomes `[a,b]` and two scalars cannot merge into one.
 */
export const withoutYamlQuotes = (text: string): string =>
  text.replace(/['"]/g, '');

/**
 * Text with whole-line comments removed, for a given marker.
 *
 * Deliberately leaves trailing comments alone: a GitHub workflow's `run:`
 * blocks are shell, where `#` inside a quoted string is not a comment, and
 * removing those would change the very commands being asserted about.
 *
 * Shares its per-line test with `isMarkerCommentLine` above rather than
 * spelling the same `trimStart().startsWith(marker)` twice — a caller that
 * needs the comments themselves, instead of the text without them, takes the
 * predicate. `marker` is REQUIRED there: it is never used point-free, and a
 * defaulted second parameter is what broke `isCommentLine`.
 */
export const isMarkerCommentLine = (line: string, marker: string): boolean =>
  line.trimStart().startsWith(marker);

export const withoutCommentLines = (text: string, marker = '#'): string =>
  text
    .split('\n')
    .filter((line) => !isMarkerCommentLine(line, marker))
    .join('\n');

/**
 * An HTML comment, closed at its first `-->`. One constant, because the two
 * readers below that skip markup comments must agree on where one ends.
 */
const MARKUP_COMMENT = /<!--[\s\S]*?-->/g;

/**
 * Markup with its `<!-- … -->` comments removed.
 *
 * `.astro` files are HTML as well as TypeScript, and an HTML comment is
 * invisible to the TS scanner below — different grammar, different delimiters.
 * A suite reading `src/**` sees both in one file.
 *
 * It matters most where a guard asserts ABSENCE. `dead-copy.test.ts` calls a
 * key dead when nothing references it, so `<!-- heroSubheading removed in
 * #17 -->` keeps a dead key looking alive and SUPPRESSES the finding, with
 * nothing going red to say so.
 *
 * Found by sweeping for source-text readers rather than trusting the list of
 * them in #24 — which was hand-written, and missed `flags.test.ts`. That file
 * was not vulnerable (it had already written this same stripper locally,
 * citing #23), but its private copy is what this replaces, and the HTML case
 * it covered was missing from the shared module the other suites use.
 */
export const withoutMarkupComments = (text: string): string =>
  text.replace(MARKUP_COMMENT, '');

/**
 * A `/` either opens a regex literal or divides, and only the token before it
 * tells them apart, and the old scanner tracked neither (#65). Two concrete
 * breakages, both the shape of a comment-stripping regex — which is exactly
 * what these guards read: `/\/\*x\*\//g` ends in `//`, so the scanner cut
 * the literal short as a line comment; and `/['"]/g` opened a string at the
 * quote inside the character class, so comments went unstripped until the
 * next apostrophe in the file.
 */
function startsRegex(tail: string): boolean {
  if (tail === '') return true;
  if (/[=(,:[!&|?{};+\-*%~^<>]$/.test(tail)) return true;
  return /(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)$/.test(
    tail,
  );
}

/**
 * TypeScript with `//` and block comments removed, STRING LITERALS INTACT.
 *
 * A regex cannot do this correctly and the failures are the ones that matter:
 * `https://…` is not a comment, and `expect(x).toContain('// ')` is a string
 * whose content is the point. Since these guards exist to stop text in the
 * wrong place satisfying an assertion, a stripper that mangles the right place
 * is the same bug wearing the opposite coat — so this scans rather than
 * matches. Quotes, template literals, escapes and regex literals (`startsRegex`,
 * above) are tracked; that is the whole of the grammar this needs.
 *
 * A template's `${…}` is code, and that code may hold a template of its own,
 * so each open substitution keeps its own brace depth on a stack, and its
 * closing `}` returns to the template text it came from. Read backtick to
 * backtick instead, a nested template turns inside out: its text is scanned
 * as code, `</b>` there opens a phantom regex, and a later backtick opens a
 * template that never closes, keeping every comment in the rest of the file
 * (#364, found by #362's `renderChangeMap`).
 *
 * A block comment goes WITH the line breaks inside it, so after one, a line
 * counted in this output is not the file's line (#218: `dev-sanity.spec.ts`
 * line 79 was reported as line 48). A guard that reports lines reads the
 * parse tree, or `blankCommentLines` below, which keeps every line in place.
 */
export function withoutTsComments(source: string): string {
  let out = '';
  let quote: string | null = null;
  /** Last 16 non-whitespace characters emitted, for the decision above. */
  let tail = '';
  /** The brace depth inside each open `${`, innermost last. */
  const substitutions: number[] = [];

  const emit = (text: string) => {
    out += text;
    const dense = text.replace(/\s+/g, '');
    if (dense) tail = (tail + dense).slice(-16);
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (quote) {
      emit(char);
      if (char === '\\') {
        emit(source[i + 1] ?? '');
        i += 1;
      } else if (quote === '`' && char === '$' && next === '{') {
        emit(next);
        i += 1;
        substitutions.push(0);
        quote = null;
      } else if (char === quote) quote = null;
      continue;
    }

    const depth = substitutions.length - 1;
    if (depth >= 0 && char === '{') substitutions[depth] += 1;
    if (depth >= 0 && char === '}') {
      if (substitutions[depth] === 0) {
        substitutions.pop();
        quote = '`';
        emit(char);
        continue;
      }
      substitutions[depth] -= 1;
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      emit(char);
      continue;
    }

    if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }

    if (char === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/'))
        i += 1;
      i += 1;
      continue;
    }

    if (char === '/' && startsRegex(tail)) {
      emit(char);
      i += 1;
      let inClass = false;
      for (; i < source.length; i += 1) {
        const c = source[i];
        emit(c);
        if (c === '\\') {
          emit(source[i + 1] ?? '');
          i += 1;
        } else if (c === '\n') break;
        else if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
      }
      continue;
    }

    emit(char);
  }

  return out;
}

/**
 * True for a line that is ENTIRELY a comment: a `//` line, a `/*` opener, or
 * a ` * ` continuation. Exposed separately because a caller may need to walk
 * backwards over the comment block above a line rather than transform a whole
 * file — `parked-tests.test.ts` does, to attribute a parked test to the note
 * that explains it.
 *
 * Takes ONE parameter, and must keep taking one: it is used point-free as
 * `lines.map(isCommentLine)`, where a second optional parameter would silently
 * receive the ARRAY INDEX. An `marker?: string` overload was written here and
 * `astro check` caught it the same minute — `startsWith(0)` coerces to `'0'`
 * and every call site quietly returns false. `isMarkerCommentLine` below is
 * the marker-taking form, and it requires its marker for the same reason.
 */
export function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*')
  );
}

/**
 * Blanks whole comment lines while keeping the line COUNT identical, so a line
 * number derived from the result still points at the right line of the
 * original file. The removers above cannot do that — dropping a comment shifts
 * every number after it — which is why three suites had each grown their own
 * copy of this before #65 gave it a home.
 */
export function blankCommentLines(text: string): string {
  return text
    .split('\n')
    .map((line) => (isCommentLine(line) ? '' : line))
    .join('\n');
}

/**
 * CSS with block comments removed, STRING LITERALS INTACT.
 *
 * A much smaller grammar than `withoutTsComments` above — CSS has no line
 * comments and no regex literals — but still not a plain regex. A block
 * delimiter can appear inside a `content:` string or a `url("…")`, and a
 * naive replace would cut the file from there to the next delimiter anywhere
 * below it, silently un-stripping everything in between. That is the same
 * failure the `#65` scanner had, and it is invisible: the guard reading the
 * result asserts against raw prose again and stays green.
 *
 * Lives here rather than beside its caller because comment stripping has
 * exactly one home in this repo — `one-home.test.ts` enforces it, and seven
 * private copies are how that rule came to exist.
 */
export function withoutCssComments(source: string): string {
  return scanCss(source).code;
}

/**
 * Every comment `withoutCssComments` removes from `source`, in the order it
 * meets them.
 *
 * A guard asking "did a comment survive this read?" has to name the span it
 * is hunting, and naming comment syntax outside this file is exactly what
 * `one-home.test.ts` refuses (#203). So the scanner that removes them hands
 * them back, and no caller has to spell the delimiters to find one.
 */
export function cssComments(source: string): string[] {
  return scanCss(source).comments;
}

/**
 * One quote-aware pass over CSS, producing the code and the comments together.
 *
 * Together rather than twice: two passes are two scanners, and a second one
 * written to find what the first removed is the seventh private copy this
 * file exists to prevent.
 */
function scanCss(source: string): { code: string; comments: string[] } {
  let code = '';
  const comments: string[] = [];
  let i = 0;
  let quote: string | null = null;

  while (i < source.length) {
    const ch = source[i];

    if (quote !== null) {
      code += ch;
      if (ch === '\\') {
        code += source[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      code += ch;
      i += 1;
      continue;
    }

    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      comments.push(source.slice(i, stop));
      i = stop;
      continue;
    }

    code += ch;
    i += 1;
  }

  return { code, comments };
}

/**
 * SQL with its `--` and block comments removed, STRING LITERALS and quoted
 * identifiers intact (#390 F160).
 *
 * An anchored match over raw SQL (`/^\s*quote\s+TEXT .../m`) was taken as
 * proof a column is real, and a block comment holding the old line, below the
 * table, satisfied it while the column itself had changed: an anchor pins a
 * match to a line, and a block comment's inner lines are lines. A quote
 * doubles to escape itself in SQL, so `'it''s'` is one literal: closing at
 * the first `'` and reopening at the second reads it the same way.
 */
export function withoutSqlComments(source: string): string {
  let code = '';
  let i = 0;
  let quote: string | null = null;

  while (i < source.length) {
    const ch = source[i];

    if (quote !== null) {
      code += ch;
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      code += ch;
      i += 1;
      continue;
    }

    if (ch === '-' && source[i + 1] === '-') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
      continue;
    }

    if (ch === '/' && source[i + 1] === '*') {
      // Unclosed runs to the end, as SQLite reads it.
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }

    code += ch;
    i += 1;
  }

  return code;
}

/**
 * `.astro` is three languages in one file — TypeScript frontmatter, markup,
 * and CSS — so no single scanner strips it. THREE PASSES, in this order:
 *
 *  1. whole-line `//`, which lands regardless of quote state. `.astro`
 *     TEMPLATE TEXT can carry an apostrophe ("don't") that opens a quote the
 *     TS scanner never sees closed; from there it stops stripping. It never
 *     DELETES anything in that state — quote mode copies verbatim — so the
 *     failure mode is under-stripping, and this pass limits the blast radius.
 *  2. `<!-- ... -->`, invisible to a TypeScript scanner.
 *  3. `//` and the block form, quote- and regex-aware.
 *
 * Residual, named rather than chased: a TRAILING comment that follows an
 * unbalanced apostrophe in template text.
 */
export const withoutAstroComments = (text: string): string =>
  withoutTsComments(withoutMarkupComments(withoutCommentLines(text, '//')));

/** A line holding nothing but a frontmatter fence. */
const FENCE = /^---[ \t]*$/gm;

/** A `<script>` element, as its opening tag and then its body. */
const SCRIPT = /(<script\b[^>]*>)([\s\S]*?)<\/script\s*>/g;

/** A `<style>` element, as its opening tag and then its body. */
const STYLE = /(<style\b[^>]*>)([\s\S]*?)<\/style\s*>/g;

/** A span of a file, from its start offset up to but not including its end. */
type Region = readonly [start: number, end: number];

/** `text` with every character but CR and LF turned to a space. */
const blanked = (text: string): string => text.replace(/[^\r\n]/g, ' ');

/**
 * An `.astro` file made ready for a tag search: its frontmatter's region, when
 * it has one, and its markup, which is the whole file with that frontmatter
 * and every markup comment blanked.
 *
 * Both are blanked before any tag is looked for, because either can name one:
 * `ClassroomGroupsPage.astro` explains in an `<!-- … -->` why its first script
 * must be `is:inline`, and says "every plain `<script>`" while doing it. A tag
 * search over the raw markup opens an element body in that prose and runs it
 * on into the real element below (#175).
 */
function astroParts(text: string): { frontmatter?: Region; markup: string } {
  const [open, close] = [...text.matchAll(FENCE)];
  const hasFrontmatter = open?.index === 0 && close !== undefined;
  const markupStart = hasFrontmatter ? close.index + close[0].length : 0;
  const markup =
    blanked(text.slice(0, markupStart)) +
    text.slice(markupStart).replace(MARKUP_COMMENT, blanked);
  return hasFrontmatter
    ? { frontmatter: [open[0].length, close.index], markup }
    : { markup };
}

/**
 * The body of each `element` in `markup` whose opening tag `keep` accepts, as
 * a region of the file.
 */
const bodies = (
  markup: string,
  element: RegExp,
  keep: (tag: string) => boolean = () => true,
): Region[] =>
  [...markup.matchAll(element)]
    .filter((match) => keep(match[1]))
    .map((match) => {
      const start = match.index + match[1].length;
      return [start, start + match[2].length] as const;
    });

/** The whole of `text` with everything outside `region` blanked. */
const viewOf = (text: string, [start, end]: Region): string =>
  blanked(text.slice(0, start)) +
  text.slice(start, end) +
  blanked(text.slice(end));

/** `text` with every one of `regions` blanked, offsets and lines intact. */
const withRegionsBlanked = (text: string, regions: readonly Region[]): string =>
  regions.reduce(
    (out, [start, end]) =>
      out.slice(0, start) + blanked(out.slice(start, end)) + out.slice(end),
    text,
  );

/**
 * The code an `.astro` file holds — its frontmatter, then each `<script>`
 * body — as one view per region, for a parser to read.
 *
 * Every view is the WHOLE file with everything outside its region blanked and
 * each CR and LF kept, so a position or line a parser reports in a view is
 * that position or line in the file itself. No caller carries an offset it
 * could get wrong.
 *
 * Case-sensitive on purpose: to Astro, `<Script>` is a component. Residual,
 * named rather than chased: a `>` inside a script tag's attribute value ends
 * the tag early, and `<script>` spelled inside a markup expression reads as
 * a tag.
 */
export function astroCodeViews(text: string): string[] {
  const { frontmatter } = astroParts(text);
  const head = frontmatter === undefined ? [] : [viewOf(text, frontmatter)];
  return [...head, ...astroScriptViews(text)];
}

/**
 * The frontmatter of an `.astro` file as a view, or the whole file blanked
 * when it has none.
 *
 * The first of `astroCodeViews`, taken on its own: a guard reading a
 * component's props must not read its scripts (#331), and "the first view"
 * cannot be trusted to be the frontmatter, because in a file without one it is
 * the first script. Blank rather than absent, so a parser handed it reads an
 * empty program and no caller has a missing case to forget.
 */
export function astroFrontmatterView(text: string): string {
  const { frontmatter } = astroParts(text);
  return frontmatter === undefined ? blanked(text) : viewOf(text, frontmatter);
}

/**
 * Each `<script>` body in an `.astro` file, as a view: the rest of
 * `astroCodeViews`, for a guard that must read a page's scripts and never its
 * frontmatter (#331).
 */
export function astroScriptViews(text: string): string[] {
  return bodies(astroParts(text).markup, SCRIPT).map((region) =>
    viewOf(text, region),
  );
}

/**
 * The CSS an `.astro` file holds — each `<style>` body — as one view per
 * element, in the same shape as `astroCodeViews` and for the same reason
 * (#200).
 *
 * Residuals, named rather than chased: `<style>` spelled inside a script body
 * reads as a tag, and a `style` attribute is not read at all. Neither occurs
 * under `src/` as this is written.
 */
export function astroStyleViews(text: string): string[] {
  return bodies(astroParts(text).markup, STYLE).map((region) =>
    viewOf(text, region),
  );
}

/**
 * A `<style>` tag Astro leaves unscoped: `is:global` opts out of scoping, and
 * `is:inline` out of processing altogether.
 */
const UNSCOPED = /\bis:(?:global|inline)\b/;

/**
 * The CSS Astro scopes to an `.astro` file's own elements, comment-free: each
 * `<style>` body whose tag carries neither `is:global` nor `is:inline` (#331).
 *
 * A rule here reaches only the elements the component builds, because Astro
 * stamps its `data-astro-cid-*` onto those elements and onto every selector.
 * It lives here rather than beside its guard for the reason `stylesheetCss`
 * gives: the stripper has no caller outside this file.
 */
export const astroScopedCss = (text: string): string[] =>
  bodies(astroParts(text).markup, STYLE, (tag) => !UNSCOPED.test(tag)).map(
    (region) => withoutCssComments(viewOf(text, region)),
  );

/**
 * An `.astro` file's template, the markup its elements are written in, with
 * the frontmatter, every script and style body, and every comment removed
 * (#331).
 *
 * What a guard reads to learn which classes a component's own elements can
 * carry: a class spelled in a script body belongs to whatever that script
 * builds, and one spelled in a comment belongs to nothing. Not a view, since
 * the comments are removed rather than blanked, so a caller can ask what the
 * template holds but not where.
 *
 * Residual, named rather than chased: `withoutAstroComments`'s own, a
 * trailing comment after an unbalanced apostrophe in template text.
 */
export const astroTemplate = (text: string): string => {
  const { markup } = astroParts(text);
  return withoutAstroComments(
    withRegionsBlanked(markup, [
      ...bodies(markup, SCRIPT),
      ...bodies(markup, STYLE),
    ]),
  );
};

/**
 * The CSS a file holds: a `.css` file whole, an `.astro` file's `<style>`
 * bodies as one view each.
 *
 * The distinction is the whole of #203. `withoutCssComments` tracks quotes,
 * so over a WHOLE `.astro` file the first apostrophe in frontmatter or
 * template text ("don't") opens a string it never sees closed, and every
 * comment below that point is copied out as if it were live CSS. Eight of
 * the 141 comments in `src/` survived that read.
 */
export const stylesheetsIn = (file: string, text: string): string[] =>
  file.endsWith('.astro') ? astroStyleViews(text) : [text];

/**
 * The CSS a file holds, comment-free: what a stylesheet guard should scan.
 *
 * Callers take this rather than `withoutCssComments` so that reading an
 * `.astro` file the wrong way is not something a call site can express —
 * `one-home.test.ts` asserts the stripper itself has no caller outside this
 * file, which a guard passing a whole `.astro` file would break.
 */
export const stylesheetCss = (file: string, text: string): string[] =>
  stylesheetsIn(file, text).map(withoutCssComments);

/**
 * The non-CSS text of an `.astro` file: the whole file with every `<style>`
 * body blanked, offsets and lines intact.
 *
 * The complement of `astroStyleViews`, and the other half of reading an
 * `.astro` file safely: a scanner that must see the WHOLE file still must
 * not read a `<style>` body as if it were TypeScript.
 */
export const withoutAstroStyles = (text: string): string =>
  withRegionsBlanked(text, bodies(astroParts(text).markup, STYLE));

/**
 * An `.astro` file's frontmatter, template and scripts, with every `<style>`
 * blanked and every comment stripped: the half of `codeWithoutComments` that
 * is not CSS, for a guard that reads the CSS itself by rule.
 */
export const astroCode = (text: string): string =>
  withoutAstroComments(withoutAstroStyles(text));

/**
 * A source file's code with its comments stripped, chosen by extension: what
 * a guard searching a file for a spelling should scan.
 *
 * `.astro` is three languages in one file, so it is read in two halves — its
 * CSS through `astroStyleViews`, its remainder through `withoutAstroComments`
 * — and the halves are joined for a caller that searches. Joining rather than
 * interleaving is safe because every caller asks whether a spelling appears
 * anywhere in the file, never where.
 */
export const codeWithoutComments = (file: string, text: string): string => {
  if (file.endsWith('.css')) return withoutCssComments(text);
  if (!file.endsWith('.astro')) {
    return withoutTsComments(withoutCssComments(text));
  }
  return [astroCode(text), ...stylesheetCss(file, text)].join('\n');
};
