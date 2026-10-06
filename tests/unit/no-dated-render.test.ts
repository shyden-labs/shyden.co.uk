import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { filesUnder, searched } from '../source-files';
import {
  astroCodeViews,
  astroTemplate,
  withoutTsComments,
} from './source-text';
import { floorBreach } from '../floors';

/**
 * No `.astro` source reads the clock, so no built page carries a date and no
 * visual baseline can bake one in (#370).
 *
 * This replaces a mask. The footer's copyright line was built from
 * `new Date().getFullYear()`, so `visual.spec.ts` masked it, or every
 * baseline would have failed each 1 January for no change to any code. The
 * line went with the dissolved company, and the mask with it. Rather than
 * leave a mask standing ready for a date that might return, this refuses the
 * date itself: a page that needs one has to get past this guard, which says
 * why.
 */
const CLOCK = /\bnew Date\(|\bDate\.now\(|\.getFullYear\(/;

/** A view with its comments stripped, or nothing when it read nothing. */
const readView = (view: string): string[] => {
  const code = withoutTsComments(view);
  return code.trim() === '' ? [] : [code];
};

/**
 * What a date could be read in, in each `.astro` source: its code (the
 * frontmatter, then each `<script>`) and its markup, comments stripped. A
 * view is the whole file with the rest blanked, so one that is all blank
 * read nothing. Kept apart so the cross-check below asks about the views the
 * verdict judged, not about a second reading.
 */
const readSource = (text: string) => {
  const code = astroCodeViews(text).flatMap(readView);
  const markup = readView(astroTemplate(text));
  return { code, markup, views: [...code, ...markup] };
};

/** Every view of `text` a date could be read in. */
const viewsOf = (text: string): string[] => readSource(text).views;

/**
 * A file that plainly holds code, read as text: frontmatter opening the
 * file, or a `<script` tag. Independent of `astroCodeViews`, so a reader
 * gone blind to one region is caught by the file it read no code in (#446).
 */
const HOLDS_CODE = /^---|<script\b/;

const read = () =>
  filesUnder('src', (path) => path.endsWith('.astro')).map((path) => {
    const text = readFileSync(path, 'utf8');
    return { path, text, ...readSource(text) };
  });

describe('no page is rendered from the clock (#370)', () => {
  it('no .astro source reads the date, in its code or its markup', () => {
    // The population is the views read, not the files opened: a reader blind
    // to every region would open each file, find no date, and pass (#446).
    const views = read().flatMap(({ path, views }) =>
      views.map((view) => ({ path, view })),
    );
    const dated = views
      .filter(({ view }) => CLOCK.test(view))
      .map(({ path }) => path);
    const judged = views.map(({ view }) => view);
    expect(
      searched(dated, { of: judged, what: '.astro code and markup views' }),
    ).toEqual([]);
    expect(
      floorBreach('no-dated-render/date-checked-views', judged.length),
    ).toBeUndefined();
  });

  it('reads every view the sources hold, and as many as there are', () => {
    const sources = read();
    const codeUnread = sources
      .filter(({ text, code }) => HOLDS_CODE.test(text) && code.length === 0)
      .map(({ path }) => path);
    expect(
      searched(codeUnread, { of: sources, what: '.astro sources' }),
    ).toEqual([]);
    const markupUnread = sources
      .filter(({ markup }) => markup.length === 0)
      .map(({ path }) => path);
    expect(
      searched(markupUnread, { of: sources, what: '.astro sources' }),
    ).toEqual([]);
    // After the verdict, so a population that grew never hides a finding.
    expect(
      floorBreach(
        'no-dated-render/views',
        sources.flatMap(({ views }) => views).length,
      ),
    ).toBeUndefined();
  });

  it.each([
    [
      'its frontmatter',
      '---\nconst year = new Date().getFullYear();\n---\n<p>x</p>',
    ],
    ['a script', '<p>x</p>\n<script>\n  const at = Date.now();\n</script>'],
    ['its markup', '<footer>{new Date().getFullYear()}</footer>'],
    [
      'a year read off any date',
      '---\nconst y = built.getFullYear();\n---\n<p>x</p>',
    ],
  ])('finds a date read in %s', (_where, source) => {
    expect(viewsOf(source).filter((view) => CLOCK.test(view))).toHaveLength(1);
  });

  it('is not tripped by a date named in a comment', () => {
    const source =
      '---\n// was: new Date().getFullYear()\n---\n<p>{/* Date.now() */}x</p>';
    // The markup is still read once the comment is gone, so the empty
    // verdict is over a view, not over nothing.
    const views = viewsOf(source);
    expect(
      searched(
        views.filter((view) => CLOCK.test(view)),
        { of: views, what: 'views of the fixture' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('no-dated-render/comment-fixture-views', views.length),
    ).toBeUndefined();
  });
});
