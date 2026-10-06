import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { filesUnder, searched } from '../source-files';
import { floorBreach } from '../floors';
import { scopedClassReport } from './scoped-classes';

/**
 * A scoped rule reaches only the elements its own file builds (#331).
 *
 * Astro scopes a component's `<style>` by stamping `data-astro-cid-*` onto
 * every element the component builds and onto every selector, so a rule for
 * a class that none of those elements can carry styles nothing. It fails
 * silently, and twice in one week: #329 removed a `.lang` rule that no
 * element carried, and #331 found the dealt cards' reduced-motion rule
 * written for cards that `classroom-groups.ts` builds at runtime, where no
 * scope attribute ever reaches them. Its comment claimed a job that
 * `tokens.css` does.
 *
 * The fixtures below are the controls: each shape the reader must see, and
 * the two real rules it exists to catch, reported as they stood.
 */

const astro = (...lines: string[]): string => lines.join('\n');

describe('scopedClassReport', () => {
  it("reports develop's .lang rule, which no element carried (#329)", () => {
    // Header.astro as develop had it, reduced to what decides the verdict:
    // `lang` is a prop, an argument and a component's attribute, never a class.
    const header = astro(
      '---',
      "import LanguageSwitcher from './LanguageSwitcher.astro';",
      'interface Props {',
      '  lang: Locale;',
      '}',
      'const { lang } = Astro.props;',
      'const t = getSiteStrings(lang);',
      "const home = localisePath('/', lang);",
      '---',
      '<header>',
      '  <div class="bar">',
      '    <a class="wordmark" href={home}>{t.name}</a>',
      '    <details class="menu"><summary><span class="bars"></span></summary></details>',
      '    <LanguageSwitcher lang={lang} pathname={Astro.url.pathname} />',
      '  </div>',
      '</header>',
      '<style>',
      '  .bar { display: flex; }',
      '  .wordmark { font-weight: 700; }',
      '  .menu .bars { width: 1rem; }',
      '  .lang { margin-left: auto; }',
      '</style>',
    );
    expect(scopedClassReport(header).dead).toEqual(['lang']);
  });

  it("reports the dealt cards' reduced-motion rule, which only a script's cards could match (#331)", () => {
    // ClassroomGroupsPage.astro before #331: every card is built by
    // classroom-groups.ts, so no card carries the component's scope.
    const page = astro(
      '<div id="cg-results" class="tables"></div>',
      '<script src="../../scripts/classroom-groups.ts"></script>',
      '<style is:global>',
      '  #cg-results .student { opacity: 0; }',
      '  #cg-results .student.dealt { opacity: 1; }',
      '</style>',
      '<style>',
      '  .tables { display: grid; }',
      '  @media (prefers-reduced-motion: reduce) {',
      '    #cg-results .student,',
      '    #cg-results .student.dealt {',
      '      opacity: 1;',
      '      transform: none;',
      '      transition: none;',
      '    }',
      '  }',
      '</style>',
    );
    expect(scopedClassReport(page).dead).toEqual(['student', 'dealt']);
  });

  it('reads a template literal, and the values its prop is declared to take', () => {
    // Button.astro: `variant` reaches the class through `${variant}`, and its
    // declared type is the whole list of what it can be.
    const button = astro(
      '---',
      'interface Props {',
      '  href: string;',
      "  variant?: 'primary' | 'secondary';",
      '}',
      "const { href, variant = 'primary' } = Astro.props;",
      '---',
      '<a class={`btn ${variant}`} href={href}><slot /></a>',
      '<style>',
      '  .btn { display: inline-flex; }',
      '  .primary { background: var(--accent); }',
      '  .secondary { background: none; }',
      '  .tertiary { background: none; }',
      '</style>',
    );
    const report = scopedClassReport(button);
    expect(report.named).toEqual(['btn', 'primary', 'secondary', 'tertiary']);
    expect(report.dead).toEqual(['tertiary']);
  });

  it('reads the frontmatter only through a name a class expression uses', () => {
    const page = astro(
      '---',
      "const ghost = 'ghost';",
      "const tone = 'warm';",
      '---',
      '<p class={tone}>x</p>',
      '<style>',
      '  .warm { color: red; }',
      '  .ghost { color: blue; }',
      '</style>',
    );
    expect(scopedClassReport(page).dead).toEqual(['ghost']);
  });

  it.each([
    "classList.add('open')",
    "classList.toggle('open', true)",
    "classList.replace('shut', 'open')",
    "className = 'menu open'",
    "setAttribute('class', 'menu open')",
  ])(
    'recognises a class a script adds to an element the page built: %s',
    (write) => {
      const page = astro(
        '<nav id="menu" class="menu"></nav>',
        '<script>',
        `  document.getElementById('menu')!.${write};`,
        '</script>',
        '<style>',
        '  .menu.open { display: block; }',
        '</style>',
      );
      const report = scopedClassReport(page);
      expect(report.named).toEqual(['menu', 'open']);
      expect(report.dead).toEqual([]);
    },
  );

  it('does not count a class a script gives an element it created', () => {
    const page = astro(
      '<ul id="list"></ul>',
      '<script>',
      "  const item = document.createElement('li');",
      "  item.className = 'card';",
      "  document.getElementById('list')!.append(item);",
      '</script>',
      '<style>',
      '  .card { padding: 1rem; }',
      '</style>',
    );
    expect(scopedClassReport(page).dead).toEqual(['card']);
  });

  it('reads class:list strings, arrays and object keys', () => {
    const page = astro(
      '---',
      'const { on } = Astro.props;',
      '---',
      "<p class:list={['lead', { active: on, 'is-wide': !on }, on && 'bold']}>x</p>",
      '<style>',
      '  .lead { font-size: 1.2rem; }',
      '  .active { color: red; }',
      '  .is-wide { width: 100%; }',
      '  .bold { font-weight: 700; }',
      '  .never { color: blue; }',
      '</style>',
    );
    expect(scopedClassReport(page).dead).toEqual(['never']);
  });

  it('checks only what Astro scopes: not is:global, not is:inline, not :global()', () => {
    const page = astro(
      '<div class="frame"></div>',
      '<style is:global>.nowhere-global { color: red; }</style>',
      '<style is:inline>.nowhere-inline { color: red; }</style>',
      '<style>',
      '  .frame :global(.from-a-slot) { display: block; }',
      '</style>',
    );
    const report = scopedClassReport(page);
    expect(report.named).toEqual(['frame']);
    expect(report.dead).toEqual([]);
  });

  it('reads selectors, never declarations, conditions or attribute values', () => {
    const page = astro(
      '<a class="doc"></a><div class="wide"></div>',
      '<style>',
      '  .doc { margin: 0.5rem; background: url(icon.png); }',
      '  @supports selector(.probe) { .wide { padding: 1rem; } }',
      '  @keyframes spin { from { opacity: 0.5; } to { opacity: 1; } }',
      '  a[href$=".pdf"] { text-decoration: none; }',
      '</style>',
    );
    expect(scopedClassReport(page).named).toEqual(['doc', 'wide']);
  });

  it('never counts a class a comment names, in the template or the style', () => {
    const page = astro(
      '{/* <b class="kept"> */}',
      '<p class="real">x</p>',
      '<style>',
      '  /* .mentioned only here */',
      '  .real { color: red; }',
      '  .kept { color: blue; }',
      '</style>',
    );
    const report = scopedClassReport(page);
    expect(report.named).toEqual(['real', 'kept']);
    expect(report.dead).toEqual(['kept']);
  });

  it.each([
    ['a call', "import { tone } from '../lib/tone';", 'tone()'],
    [
      'a prop whose type names no values',
      'interface Props { lang: Locale }\nconst { lang } = Astro.props;',
      'lang',
    ],
  ])(
    'reports an expression it cannot read, rather than guessing: %s',
    (_shape, frontmatter, expression) => {
      const page = astro(
        '---',
        frontmatter,
        '---',
        `<p class={${expression}}>x</p>`,
        '<style>.warm { color: red; }</style>',
      );
      expect(scopedClassReport(page).unreadable).toEqual([expression]);
    },
  );
});

describe('every class a scoped rule names is one its own file can carry', () => {
  /** Read inside each test: a report built at collection hides a failure. */
  const reports = () =>
    filesUnder('src', (path) => path.endsWith('.astro')).map((file) => ({
      file,
      ...scopedClassReport(readFileSync(file, 'utf8')),
    }));

  it('holds for every .astro file under src/', () => {
    const all = reports();
    const dead = all.flatMap(({ file, dead }) =>
      dead.map((name) => `${file}: .${name}`),
    );
    const judged = all.flatMap(({ named }) => named);
    expect(
      searched(dead, {
        of: judged,
        what: 'classes named in scoped styles',
      }),
    ).toEqual([]);
    expect(
      floorBreach('scoped-classes/named-classes', judged.length),
    ).toBeUndefined();
  });

  it('can read every class those files write', () => {
    const all = reports();
    const unreadable = all.flatMap(({ file, unreadable }) =>
      unreadable.map((expression) => `${file}: ${expression}`),
    );
    const judged = all.flatMap(({ read }) => read);
    expect(
      searched(unreadable, {
        of: judged,
        what: 'class values read',
      }),
    ).toEqual([]);
    expect(
      floorBreach('scoped-classes/read-class-values', judged.length),
    ).toBeUndefined();
  });
});
