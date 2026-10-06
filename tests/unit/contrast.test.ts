import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { floorBreach } from '../floors';
import { filesUnder, nonEmpty, searched } from '../source-files';
import { stylesheetCss } from './source-text';
import { contrast, parseColour } from '../wcag';
import {
  ATMOSPHERE,
  THEMES,
  TOKENS_FILE,
  atmosphereLayers,
  ribbonLayers,
  flatten,
  themeTokens,
  tokensCss,
  worstContrast,
  type Theme,
} from '../palette';
import { SHYTALK_MARK } from '../../src/lib/shytalk-brand';

/**
 * WCAG AA contrast, COMPUTED from the tokens rather than promised in a comment.
 *
 * Until this file existed, the AA floor in this repo was enforced by a comment
 * beside `--accent` reading "do NOT lighten past AA", and nothing anywhere
 * computed a contrast ratio. Writing the sentence is not the control; the
 * assertion is. The first run found `--border` at 1.17:1 drawing the only
 * visual boundary on every form control on the site — a WCAG 2.1 SC 1.4.11
 * failure that had shipped to production, invisible to the visual suite
 * because the baseline had always been wrong (#133).
 */

const SRC = 'src';

const isColour = (value: string): boolean => parseColour(value) !== null;

/** Contrast between two literal CSS colours — for the WCAG pin only. */
const ratioOf = (a: string, b: string): number => {
  const [x, y] = [parseColour(a), parseColour(b)];
  if (x === null || y === null)
    throw new Error(`unreadable colour: ${a} / ${b}`);
  return contrast(x.rgb, y.rgb);
};

const colourTokens = (theme: Theme): [string, string][] =>
  nonEmpty(
    [...themeTokens(tokensCss(), theme)].filter(([, value]) => isColour(value)),
    `${theme} colour tokens in ${TOKENS_FILE}`,
  );

/** 4.5 for body copy, 3 for large text and for anything identifying a control. */
const LEVELS = { body: 4.5, large: 3, ui: 3 } as const;

type Pair = {
  /** Layer stack, TOP-FIRST, ending in an opaque base. */
  fg: readonly string[];
  bg: readonly string[];
  level: keyof typeof LEVELS;
  where: string;
};

/**
 * Which colour sits on which, and at what level.
 *
 * Hand-written deliberately: WHICH pairs the design puts together is a design
 * fact no filesystem walk can answer, and resolving it from the cascade would
 * need a browser. What IS derived is exhaustiveness — every colour token must
 * appear here or in `DECORATIVE`, so a new token cannot be added unclassified.
 *
 * The page atmosphere is judged here as well, not left to a later pass: a
 * pair drawn over it names the `ATMOSPHERE` placeholder from `../palette` in
 * its stack rather than the flat `--bg`.
 */
const PAIRS: Pair[] = [
  {
    fg: ['--ink'],
    bg: ['--bg'],
    level: 'body',
    where: 'body copy on the page ground',
  },
  {
    fg: ['--ink'],
    bg: ['--surface'],
    level: 'body',
    where: 'body copy on a card',
  },
  {
    fg: ['--ink-soft'],
    bg: ['--bg'],
    level: 'body',
    where: 'secondary copy on the page ground',
  },
  {
    fg: ['--ink-soft'],
    bg: ['--surface'],
    level: 'body',
    where: 'secondary copy on a card',
  },
  {
    fg: ['--accent'],
    bg: ['--bg'],
    level: 'body',
    where:
      'link text, and the :focus-visible ring — the ring needs only 3:1 under 1.4.11 but shares this pair, so the stricter 4.5 governs',
  },
  {
    fg: ['--accent'],
    bg: ['--surface'],
    level: 'body',
    where: 'link text on a card',
  },
  {
    fg: ['--accent'],
    bg: ['--glass', '--surface'],
    level: 'body',
    where:
      "a tool's status badge: accent text on its glass fill, inside a card whose own background is the opaque --surface (StatusBadge.astro in WorkCard.astro). --glass is drawn only by that badge, and never under --ink or --ink-soft",
  },
  {
    fg: ['--accent'],
    bg: ['--glass', ATMOSPHERE, '--bg'],
    level: 'body',
    where:
      'a product\'s "Coming soon" badge: the same glass fill straight over the page atmosphere, beside its heading on the homepage (#403)',
  },
  {
    fg: ['--accent-ink'],
    bg: ['--bg'],
    level: 'body',
    where: 'link hover on the page ground',
  },
  {
    fg: ['--accent-ink'],
    bg: ['--surface'],
    level: 'body',
    where: 'link hover on a card',
  },
  {
    fg: ['--on-accent'],
    bg: ['--accent'],
    level: 'body',
    where: 'the label on a filled button',
  },
  {
    fg: ['--on-accent'],
    bg: ['--accent-ink'],
    level: 'body',
    where: 'the label on a filled button, hovered',
  },
  {
    fg: ['--danger'],
    bg: ['--bg'],
    level: 'body',
    where: 'error text on the page ground',
  },
  {
    fg: ['--danger'],
    bg: ['--surface'],
    level: 'body',
    where: 'error text on a card',
  },
  {
    fg: ['--ink'],
    bg: [ATMOSPHERE, '--bg'],
    level: 'body',
    where: 'body copy over the atmosphere, at its worst subset of layers',
  },
  {
    fg: ['--ink-soft'],
    bg: [ATMOSPHERE, '--bg'],
    level: 'body',
    where:
      'secondary copy over the atmosphere, the lowest-scoring text pair drawn over it',
  },
  {
    fg: ['--accent'],
    bg: [ATMOSPHERE, '--bg'],
    level: 'body',
    where: 'link text and section kickers over the atmosphere',
  },
  {
    fg: ['--accent-ink'],
    bg: [ATMOSPHERE, '--bg'],
    level: 'body',
    where:
      'link hover (a:hover in tokens.css), drawn wherever a link sits, so over the atmosphere too',
  },
  {
    fg: ['--border-strong', ATMOSPHERE, '--bg'],
    bg: [ATMOSPHERE, '--bg'],
    level: 'ui',
    where: 'control boundaries over the atmosphere (WCAG 1.4.11)',
  },
  {
    fg: ['--border-strong', '--bg'],
    bg: ['--bg'],
    level: 'ui',
    where: 'control boundaries on the page ground (WCAG 1.4.11)',
  },
  {
    fg: ['--border-strong', '--surface'],
    bg: ['--surface'],
    level: 'ui',
    where: 'control boundaries on a card (WCAG 1.4.11)',
  },
  {
    fg: ['--ink-soft'],
    bg: ['--disabled-fill'],
    level: 'body',
    where:
      'the label of a disabled control on its own fill (#250). PAIRS and not DECORATIVE: the fill sits directly behind text the teacher reads, the reasoning that puts every ground a text colour sits on into a pair. The stack is one layer because the fill is OPAQUE, and that is the point of the token -- `opacity: 0.6` composited the label with whatever was behind it and dropped this same ink to roughly 2.67:1, so the ratio a guard could compute was not the ratio the user received',
  },
  {
    fg: [SHYTALK_MARK.shy],
    bg: ['--wordmark-tile', ATMOSPHERE, '--bg'],
    level: 'large',
    where:
      'the ShyTalk mark\'s "Shy" (HomePage.astro, 2.6rem bold): on its own tile in light, and over the atmosphere in dark, where the tile is transparent (#142 §3.4)',
  },
  {
    fg: [SHYTALK_MARK.talk],
    bg: ['--wordmark-tile', ATMOSPHERE, '--bg'],
    level: 'large',
    where:
      'the ShyTalk mark\'s "Talk", on the same ground as "Shy" in each theme (#142 §3.4)',
  },
];

/**
 * Colour tokens deliberately in no pair, each with the reason.
 *
 * `--border` is here because 1.4.11 reaches only information REQUIRED to
 * identify a component. A card outline or a table rule is not that; a form
 * field's only edge is, which is why those use `--border-strong`.
 */
const DECORATIVE: Record<string, string> = {
  '--border':
    'decorative separators only — card outlines, header and footer rules, table rules. Every control boundary uses --border-strong.',
  '--accent-glow':
    'the mint bloom behind the marquee band. A box-shadow: nothing is ever read against it, and 1.4.11 reaches only what identifies a control.',
  '--dock-shadow':
    'the shadow the pinned action row on /classroom-groups casts up over what scrolls beneath it (#188). Nothing is read against it by design: scroll-padding keeps a focused field clear of the row, and 1.4.11 reaches only what identifies a control.',
  '--lift-shadow':
    "the phone mockup's shadow (PhoneFrame.astro). A box-shadow: nothing is read against it, and 1.4.11 reaches only what identifies a control.",
};

/**
 * Tokens scored on the RENDERED page rather than here (#371). The aurora
 * ribbon is read over, so it is not decorative; but its three fields never
 * meet at one point, and stacking them at full strength under one letter
 * scored a page that does not exist (2.76:1, where every text run on the
 * rendered pages clears 4.5:1). Operator decision, 2026-09-27: measure real
 * text.
 * `text-over-ribbon.spec.ts` renders every built page in both themes at two
 * widths and holds every text run to 4.5:1 against the pixels behind it. The
 * keys must be exactly the tokens body::after paints, asserted below, so
 * nothing else can be parked here.
 */
const RENDERED: Record<string, string> = {
  '--ribbon-a': "the ribbon's teal field, scored by text-over-ribbon.spec.ts",
  '--ribbon-b': "the ribbon's violet field, scored by text-over-ribbon.spec.ts",
  '--ribbon-c': "the ribbon's blue field, scored by text-over-ribbon.spec.ts",
};

/**
 * The disabled fill in each theme, pinned against the brief (#250, #142
 * §3.1): the level every derived guard around it is unable to assert.
 */
const DISABLED_FILL: Record<Theme, string> = {
  light: '#dde2e8',
  dark: '#2a323f',
};

const pairName = (p: Pair) =>
  `${p.fg.join(' over ')} on ${p.bg.join(' over ')} (${p.where})`;

/**
 * Each theme's floor, spelled once: a recorded id is a string under tests/,
 * never built at runtime (`literal-floors.test.ts`).
 */
const PAIRS_FLOOR: Readonly<Record<Theme, string>> = {
  light: 'contrast/light/pairs',
  dark: 'contrast/dark/pairs',
};
const GROUNDS_FLOOR: Readonly<Record<Theme, string>> = {
  light: 'contrast/light/grounds',
  dark: 'contrast/dark/grounds',
};
const TOKENS_FLOOR: Readonly<Record<Theme, string>> = {
  light: 'contrast/light/colour-tokens',
  dark: 'contrast/dark/colour-tokens',
};

describe('the palette meets WCAG AA by computation, not by comment', () => {
  it('reads the atmosphere from body::before, top-first, named by position', () => {
    expect(atmosphereLayers(tokensCss())).toEqual([
      '--pool-top-left',
      '--pool-top-right',
      '--pool-foot',
      '--shaft',
    ]);
  });

  /**
   * The ratio function pinned against WCAG's OWN published boundary.
   *
   * Without this, every assertion below is satisfied by a `contrast()` that
   * returns 21 for everything — a value checked only against the palette it
   * was computed from proves the relationship, never the level (#117).
   * `#767676` is the canonical darkest grey that still clears 4.5:1 on white,
   * and `#777777` the lightest that does not: they pin the function to within
   * 0.07 of the threshold that matters.
   */
  it('computes the ratios WCAG itself publishes', () => {
    expect(ratioOf('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(ratioOf('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(ratioOf('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(ratioOf('#777777', '#ffffff')).toBeLessThan(4.5);
    expect(ratioOf('#fff', '#000')).toBeCloseTo(21, 5);
    expect(ratioOf('#0a7d66', '#0a7d66')).toBeCloseTo(1, 5);
  });

  /**
   * Compositing pinned independently of the palette, for the same reason.
   *
   * 50% white over black is the one case anyone can check by hand, and an
   * opaque layer must pass through unchanged or every stack is silently wrong.
   */
  it('composites an alpha the way a browser does', () => {
    const from = new Map([
      ['--half', 'rgb(255 255 255 / 0.5)'],
      ['--black', '#000000'],
      ['--opaque', '#123456'],
    ]);
    expect(flatten(['--half', '--black'], from)).toEqual([128, 128, 128]);
    expect(flatten(['--opaque', '--black'], from)).toEqual([18, 52, 86]);
    expect(flatten(['--black'], from)).toEqual([0, 0, 0]);
    expect(flatten(['--missing', '--black'], from)).toBe(
      '--missing is not defined in src/styles/tokens.css',
    );
    expect(flatten(['--half'], from)).toBe(
      'the base of [--half] is translucent — nothing is behind it',
    );
  });

  for (const theme of THEMES) {
    it(`${theme}: every declared pair clears its required ratio, over the worst subset of the atmosphere`, () => {
      const css = tokensCss();
      const from = themeTokens(css, theme);
      const layers = atmosphereLayers(css);
      const failures = PAIRS.flatMap((pair) => {
        const scored = worstContrast(pair.fg, pair.bg, layers, from);
        if (typeof scored === 'string')
          return [`${pairName(pair)} — ${scored}`];
        const need = LEVELS[pair.level];
        return scored.ratio >= need
          ? []
          : [
              `${pairName(pair)} — ${scored.ratio.toFixed(2)}:1 over ` +
                `[${scored.subset.join(', ') || 'no layer'}], needs ${need}:1`,
            ];
      });

      expect(
        searched(failures, { of: PAIRS, what: `${theme} colour pairs` }),
      ).toEqual([]);
      expect(floorBreach(PAIRS_FLOOR[theme], PAIRS.length)).toBeUndefined();
    });
  }

  /**
   * The disabled fill's LEVEL, pinned to a literal — the half every guard
   * around it is structurally unable to assert.
   *
   * `every declared pair clears its required ratio` computes `--ink-soft` on
   * `--disabled-fill`, and `a disabled control is filled, not dimmed`
   * (disabled-controls.spec.ts) reads `--disabled-fill` off `:root` at
   * runtime and compares the control's own background to it. Both sides of
   * both move with the token, so both hold at ANY level (#117). Measured:
   * set Aurora's fill to its `--surface`, `#070d16` and the label still scores
   * 7.5:1 and the control's background still equals the token — every guard
   * green, and a teacher sees no control at all. A level is pinned against
   * the brief, separately from anything derived from it.
   */
  for (const theme of THEMES) {
    it(`${theme}: pins the disabled fill, and keeps it off every ground it is drawn on`, () => {
      const from = themeTokens(tokensCss(), theme);
      expect(from.get('--disabled-fill')).toBe(DISABLED_FILL[theme]);

      /* The class the literal cannot state, and the reason it is not simply a
       second literal: the grounds are DERIVED. `Pair.bg` is a stack written
       top-first ENDING IN AN OPAQUE BASE, so its last layer is a ground by
       construction, and a ground added or renamed next year is covered the
       day it appears. Compared as parsed colour, so `#070d16` and
       `rgb(7 13 22)` are one finding rather than two spellings. */
      const fill = parseColour(from.get('--disabled-fill') ?? '');
      if (fill === null) throw new Error('--disabled-fill is not a colour');

      const grounds = [
        ...new Set(PAIRS.map((pair) => pair.bg[pair.bg.length - 1])),
      ].filter((name) => name !== '--disabled-fill');
      const collisions = grounds.filter((name) => {
        const ground = parseColour(from.get(name) ?? '');
        return (
          ground !== null &&
          ground.alpha === fill.alpha &&
          ground.rgb.every((channel, i) => channel === fill.rgb[i])
        );
      });

      expect(
        searched(collisions, { of: grounds, what: 'opaque grounds' }),
      ).toEqual([]);
      expect(floorBreach(GROUNDS_FLOOR[theme], grounds.length)).toBeUndefined();
    });
  }

  for (const theme of THEMES) {
    it(`${theme}: every colour token is classified — paired or explicitly decorative`, () => {
      const layers = atmosphereLayers(tokensCss());
      const paired = new Set(
        PAIRS.flatMap((p) => [...p.fg, ...p.bg]).flatMap((layer) =>
          layer === ATMOSPHERE ? layers : [layer],
        ),
      );
      const all = colourTokens(theme);
      const unclassified = all
        .map(([name]) => name)
        .filter(
          (name) =>
            !paired.has(name) && !(name in DECORATIVE) && !(name in RENDERED),
        );

      expect(
        searched(unclassified, { of: all, what: 'colour tokens' }),
      ).toEqual([]);
      expect(floorBreach(TOKENS_FLOOR[theme], all.length)).toBeUndefined();
    });
  }

  it('leaves to the rendered check exactly the tokens the ribbon paints, and no other', () => {
    expect(Object.keys(RENDERED).sort()).toEqual(
      [...ribbonLayers(tokensCss())].sort(),
    );
  });
});

/**
 * Every `var(--border)` site in the source, with the selector it sits under.
 *
 * Selector tracking is the last line ending in `{`. Every border usage in this
 * repo is written under a single-line selector; a multi-line selector list
 * would be recorded under its final line, which still classifies uniquely and
 * still fails loudly if it is not classified at all.
 */
type Declaration = { file: string; selector: string; declaration: string };

const declarationsMatching = (
  matches: (declaration: string) => boolean,
): Declaration[] => {
  const files = nonEmpty(
    filesUnder(SRC, (path) => path.endsWith('.astro') || path.endsWith('.css')),
    `.astro and .css files under ${SRC}/`,
  );

  return files.flatMap((file) =>
    // One sheet at a time, so a selector cannot be carried from one `<style>`
    // into the next, and so no line outside a `<style>` can become one.
    stylesheetCss(file, readFileSync(file, 'utf8')).flatMap((css) => {
      let selector = '(none)';
      const found: Declaration[] = [];

      for (const line of css.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.endsWith('{') && !trimmed.startsWith('@')) {
          selector = trimmed.slice(0, -1).trim();
        }
        if (matches(trimmed)) {
          found.push({
            file: file.replace(/^src\//, ''),
            selector,
            declaration: trimmed,
          });
        }
      }
      return found;
    }),
  );
};

const borderUsages = (): Declaration[] =>
  declarationsMatching((declaration) => declaration.includes('var(--border)'));

/**
 * Every `file :: selector` the source declares anything under.
 *
 * A declaration line rather than a selector line, because a selector with no
 * declarations under it styles nothing and is not a place a control can be
 * drawn.
 */
const declaredSelectors = (): string[] =>
  declarationsMatching((declaration) => declaration.includes(':')).map(key);

const key = (u: { file: string; selector: string }) =>
  `${u.file} :: ${u.selector}`;

/** Selectors whose border is the ONLY thing identifying a control (#133). */
const CONTROL_SELECTORS = [
  'components/Button.astro :: .secondary',
  'components/LanguageSwitcher.astro :: ul',
  'components/pages/GloryPointsPage.astro :: .for-yeetalk a',
  'components/pages/GloryPointsPage.astro :: input',
  "components/pages/ClassroomGroupsPage.astro :: input[type='number']",
  'components/pages/ClassroomGroupsPage.astro :: select',
  'components/pages/ClassroomGroupsPage.astro :: #cg-roster select',
  'components/pages/ClassroomGroupsPage.astro :: #cg-io-both-toggle',
  'components/pages/ClassroomGroupsPage.astro :: .cg-print-open',
  'components/pages/ClassroomGroupsPage.astro :: .cg-print-actions button',
  'components/pages/ClassroomGroupsPage.astro :: .cg-board-bar button',
  'components/pages/ClassroomGroupsPage.astro :: .cg-io-confirm-buttons button',
  'components/pages/ClassroomGroupsPage.astro :: .cg-add-several-inline input',
];

/** Selectors whose border separates or outlines but identifies no control. */
const DECORATIVE_SELECTORS = [
  'components/PhoneFrame.astro :: .frame',
  'components/WorkCard.astro :: .work-card',
  'components/StatusBadge.astro :: .status-badge',
  'components/pages/HomePage.astro :: .contact',
  'components/Footer.astro :: footer',
  'components/Header.astro :: header',
  'components/Header.astro :: .menu[open] ~ nav',
  'components/pages/GloryPointsPage.astro :: .card',
  'components/pages/ClassroomGroupsPage.astro :: #cg-results .group',
  'components/pages/ClassroomGroupsPage.astro :: #cg-roster .cg-student',
  'components/pages/ClassroomGroupsPage.astro :: #cg-roster td',
  'components/pages/ClassroomGroupsPage.astro :: #cg-roster .cg-student > td',
  'components/pages/ClassroomGroupsPage.astro :: .cg-io-confirm',
  'components/pages/ClassroomGroupsPage.astro :: .cg-print-panel',
  'components/pages/ClassroomGroupsPage.astro :: .cg-print-panel fieldset',
  'components/pages/ClassroomGroupsPage.astro :: .tool-section',
  'components/pages/ClassroomGroupsPage.astro :: .actions',
  'pages/404.astro :: hr',
];

describe('a control is never identified by the decorative border alone', () => {
  it('no control selector draws its boundary with --border', () => {
    const usages = borderUsages();
    const offenders = usages
      .filter((u) => CONTROL_SELECTORS.includes(key(u)))
      .map((u) => `${key(u)} → ${u.declaration}`);

    expect(
      searched(offenders, { of: usages, what: 'var(--border) usages in src/' }),
    ).toEqual([]);
    expect(
      floorBreach('contrast/border-usages-judged-as-controls', usages.length),
    ).toBeUndefined();
  });

  it('every --border usage is classified as control or decorative', () => {
    const usages = borderUsages();
    const classified = new Set([...CONTROL_SELECTORS, ...DECORATIVE_SELECTORS]);
    const unclassified = usages
      .filter((u) => !classified.has(key(u)))
      .map((u) => `${key(u)} → ${u.declaration}`);

    expect(
      searched(unclassified, {
        of: usages,
        what: 'var(--border) usages in src/',
      }),
    ).toEqual([]);
    expect(
      floorBreach('contrast/border-usages-classified', usages.length),
    ).toBeUndefined();
  });

  /**
   * Both lists above are hand-written, and an entry the reader cannot find
   * classifies nothing while reading exactly like one that works — the shape
   * `shytalk-brand.test.ts` guards with "an exemption naming a path that does
   * not exist exempts nothing".
   *
   * It is not hypothetical here. Until #203 this file read an `.astro` file's
   * CSS with a whole-file strip, and `Header.astro`'s frontmatter carries the
   * prose "on /id/* pages" — which a CSS scanner reads as a comment OPENER,
   * deleting everything up to the next close 92 lines later. So
   * `Header.astro :: header` sat in DECORATIVE_SELECTORS for a usage neither
   * assertion above could reach, and both were green over it.
   *
   * The two lists make DIFFERENT claims, so they need different controls. A
   * decorative entry says a `var(--border)` usage exists and is decorative. A
   * control entry says a selector exists that must NOT use one — so its own
   * liveness is the selector, and asserting it against the usages would ask
   * every control to break the rule it is listed for.
   */
  it('calls a border decorative only where the reader finds one', () => {
    const usages = borderUsages();
    const present = new Set(usages.map(key));
    const stale = DECORATIVE_SELECTORS.filter(
      (selector) => !present.has(selector),
    );

    expect(
      searched(stale, { of: usages, what: 'var(--border) usages in src/' }),
    ).toEqual([]);
    expect(
      floorBreach('contrast/border-usages-for-decorative', usages.length),
    ).toBeUndefined();
  });

  it('names a control only where the reader finds that selector', () => {
    const selectors = declaredSelectors();
    const declared = new Set(selectors);
    const stale = CONTROL_SELECTORS.filter(
      (selector) => !declared.has(selector),
    );

    expect(
      searched(stale, { of: selectors, what: 'declared selectors in src/' }),
    ).toEqual([]);
    expect(
      floorBreach('contrast/declared-selectors', selectors.length),
    ).toBeUndefined();
  });
});

/**
 * AC3's second clause (#250), which was held up by a comment until now.
 *
 * `tokens.css` states that its site-wide rule "enforces AC3's 'never a list of
 * per-component overrides': a component cannot quietly invent a second
 * disabled look" — and nothing tested that claim. `!important` only wins
 * against a component rule that is not itself `!important`, so the
 * enforcement was a convention rather than a control, and a comment is not an
 * implementation.
 */
describe('one disabled look, defined in one place', () => {
  /** What paints a control. `color-scheme` is not one of these. */
  const PAINT =
    /^(background(-color|-image)?|color|cursor|opacity|-webkit-text-fill-color)\s*:/;

  /**
   * A selector's SUBJECT is its last compound, and it is what decides here.
   *
   * `.switch input:disabled + span` paints the switch TRACK — a sibling the
   * site-wide rule cannot reach, because that rule matches the input while
   * the visible switch is the span. Its subject carries no `:disabled`, so it
   * is not a second look. A rule whose own subject IS the disabled control is.
   */
  const subjectIsDisabled = (selector: string): boolean =>
    selector.split(',').some((part) => /:disabled$/.test(part.trim()));

  it('no component paints a disabled control for itself', () => {
    const painted = declarationsMatching((declaration) =>
      PAINT.test(declaration),
    ).filter((usage) => subjectIsDisabled(usage.selector));
    const paintedAt = painted.map(
      (usage) => `${usage.file} :: ${usage.selector}`,
    );
    const elsewhere = painted.filter(
      (usage) => usage.file !== 'styles/tokens.css',
    );

    // The population includes tokens.css's own rules, so it is live by
    // construction — and deleting the site-wide treatment empties it, which
    // `searched` refuses rather than reporting as a clean bill of health.
    expect(
      searched(elsewhere, {
        of: paintedAt,
        what: 'paint declarations on a :disabled subject',
      }),
    ).toEqual([]);
    expect(
      floorBreach('contrast/disabled-paint', paintedAt.length),
    ).toBeUndefined();
  });
});
