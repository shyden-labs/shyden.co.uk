import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { filesUnder, searched } from '../source-files';
import { floorBreach } from '../floors';
import { stylesheetCss } from './source-text';
import {
  colourLiterals,
  cssRules,
  onPaper,
  type CssDeclaration,
} from './css-rules';

/**
 * A ground written as a literal carries its own ink (#332).
 *
 * `/classroom-groups`'s stale notice and gap warning painted a cream
 * `#fff6e3` and took their text from `--ink`. The palette they were written
 * for made that near-black. Aurora (#17) made `--ink` near-white and left the
 * literal where it was, and both read 1.05:1 on `develop`: sentences nobody
 * could read, beside a suite that was entirely green, because no token pair
 * names a literal and no rendered check opened either notice. Light mode
 * (#142) moves every token a second time.
 *
 * So the invariant is structural rather than a list of callouts: where a rule
 * fixes its ground with a literal, it fixes its ink with one too, and nothing
 * a theme does can separate them.
 */

/** The properties that paint an element's own ground. */
const GROUND = new Set(['background', 'background-color', 'background-image']);
const INK = new Set(['color']);

/** A value that fixes a colour: it writes one, and reads no token. */
const fixesAColour = (declaration: CssDeclaration): boolean =>
  !declaration.value.includes('var(') &&
  colourLiterals(declaration.value).length > 0;

/** A value that paints something, from a token or from a literal. */
const paints = (declaration: CssDeclaration): boolean =>
  declaration.value.includes('var(') || fixesAColour(declaration);

type Joined = { chain: readonly string[]; declarations: CssDeclaration[] };

/**
 * Every selector chain in a file, with the declarations of every rule that
 * shares it in source order.
 *
 * The LAST of each property is the one the cascade keeps, and the one read
 * here. `.roster-warning` was split over two rules, so a guard reading one
 * rule at a time would have judged half a selector.
 */
const joinedRules = (file: string, text: string): Joined[] => {
  const chains = new Map<string, Joined>();
  for (const css of stylesheetCss(file, text))
    for (const rule of cssRules(css)) {
      const key = JSON.stringify(rule.chain);
      const joined = chains.get(key) ?? {
        chain: rule.chain,
        declarations: [],
      };
      joined.declarations.push(...rule.declarations);
      chains.set(key, joined);
    }
  return [...chains.values()];
};

const lastOf = (
  joined: Joined,
  properties: ReadonlySet<string>,
): CssDeclaration | undefined =>
  joined.declarations
    .filter((declaration) => properties.has(declaration.property))
    .at(-1);

type Ground = {
  file: string;
  chain: readonly string[];
  ground: CssDeclaration;
  /** The last `color` the chain declares; absent when it inherits. */
  ink?: CssDeclaration;
};

/** Every selector chain in a file that paints a literal ground, with its ink. */
const literalGrounds = (file: string, text: string): Ground[] =>
  joinedRules(file, text).flatMap((joined) => {
    const ground = lastOf(joined, GROUND);
    if (ground === undefined || !fixesAColour(ground)) return [];
    return [{ file, chain: joined.chain, ground, ink: lastOf(joined, INK) }];
  });

/** A selector list's members, split only at commas outside brackets. */
const members = (selector: string): string[] => {
  const found: string[] = [];
  let depth = 0;
  let start = 0;
  [...selector].forEach((ch, i) => {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      found.push(selector.slice(start, i).trim());
      start = i + 1;
    }
  });
  return [...found, selector.slice(start).trim()];
};

/** Whether `selector` names something inside what `ancestor` names. */
const within = (selector: string, ancestor: string): boolean =>
  members(selector).some((member) =>
    members(ancestor).some(
      (outer) =>
        member.startsWith(`${outer} `) || member.startsWith(`${outer}>`),
    ),
  );

type InkInside = {
  file: string;
  chain: readonly string[];
  ink: CssDeclaration;
  inside: Ground;
};

/**
 * Rules that colour text INSIDE a literal ground with a token.
 *
 * `.stale-notice p { color: var(--ink) }` is what the stale sentence
 * actually wore: whatever `.stale-notice` itself declared, the paragraph's
 * own rule won. A rule whose selector continues a ground's selector, that
 * paints no ground of its own and takes its ink from a token, puts
 * theme-moved text on a ground no theme moves, so it answers to the ground.
 *
 * Matched by selector text within one file. A descendant styled from
 * another file, or named by an id that does not continue the ground's
 * selector, is not seen here: the rendered contrast checks on each notice
 * are what measure the painted result.
 */
const tokenInkInside = (file: string, text: string): InkInside[] => {
  const grounds = literalGrounds(file, text).filter(
    ({ chain }) => !exempt(chain),
  );
  return joinedRules(file, text).flatMap((joined) => {
    const ink = lastOf(joined, INK);
    const ground = lastOf(joined, GROUND);
    if (ink === undefined || !ink.value.includes('var(')) return [];
    if (exempt(joined.chain) || (ground !== undefined && paints(ground)))
      return [];
    const selector = joined.chain.at(-1) ?? '';
    return grounds
      .filter((inside) => within(selector, inside.chain.at(-1) ?? ''))
      .map((inside) => ({ file, chain: joined.chain, ink, inside }));
  });
};

/** Where a literal ground needs no ink of its own, each with its reason. */
const EXEMPT: {
  reason: string;
  covers: (chain: readonly string[]) => boolean;
}[] = [
  {
    reason:
      'paper: the print block in tokens.css fixes every token, so on paper the ink cannot move away from a literal ground',
    covers: onPaper,
  },
  {
    reason:
      'a ::backdrop holds no text: it is the scrim behind a modal, and nothing is read on it',
    covers: (chain) => /::backdrop$/.test(chain.at(-1) ?? ''),
  },
];

const exempt = (chain: readonly string[]): boolean =>
  EXEMPT.some((exemption) => exemption.covers(chain));

/** The grounds that break the invariant: not exempt, and no literal ink. */
const offending = (grounds: readonly Ground[]): Ground[] =>
  grounds
    .filter(({ chain }) => !exempt(chain))
    .filter(({ ink }) => ink === undefined || !fixesAColour(ink));

const describeGround = ({ file, chain, ground, ink }: Ground): string =>
  `${file} :: ${chain.join(' { ')} paints ${ground.value} ` +
  `under ${ink === undefined ? 'inherited ink' : `color: ${ink.value}`}`;

const describeInkInside = ({ file, chain, ink, inside }: InkInside): string =>
  `${file} :: ${chain.join(' { ')} sets color: ${ink.value} on text inside ` +
  `${inside.chain.join(' { ')}, which paints ${inside.ground.value}`;

const sheets = (): string[] =>
  filesUnder('src', (path) => path.endsWith('.css') || path.endsWith('.astro'));

const groundsUnderSrc = (): Ground[] =>
  sheets().flatMap((file) => literalGrounds(file, readFileSync(file, 'utf8')));

describe('a ground written as a literal carries its own ink (#332)', () => {
  it('every literal ground under src/ paints a literal ink, or is exempt with its reason', () => {
    const grounds = groundsUnderSrc();
    const judged = grounds.map(describeGround);
    expect(
      searched(offending(grounds).map(describeGround), {
        of: judged,
        what: 'literal grounds under src/',
      }),
    ).toEqual([]);
    expect(
      floorBreach('literal-grounds/ink-checked-grounds', judged.length),
    ).toBeUndefined();
  });

  it('no rule under src/ puts token ink on text inside a literal ground', () => {
    const grounds = groundsUnderSrc();
    const inside = sheets().flatMap((file) =>
      tokenInkInside(file, readFileSync(file, 'utf8')),
    );
    const judged = grounds.map(describeGround);
    expect(
      searched(inside.map(describeInkInside), {
        of: judged,
        what: 'literal grounds under src/',
      }),
    ).toEqual([]);
    expect(
      floorBreach('literal-grounds/inside-checked-grounds', judged.length),
    ).toBeUndefined();
  });

  it('judges the text inside a ground by the rule that colours it', () => {
    const notice = '.n { background: #fff6e3; color: #1a1a1a; }\n';
    expect(
      tokenInkInside(
        'x.css',
        `${notice}.n p { margin: 0; color: var(--ink); }\n`,
      ).map(describeInkInside),
    ).toEqual([
      'x.css :: .n p sets color: var(--ink) on text inside .n, which paints #fff6e3',
    ]);
    expect(
      tokenInkInside(
        'x.css',
        // `.n>p` unspaced, so the child combinator is matched on its own
        // rather than by the space a spaced `.n > p` also starts with.
        `${notice}.m, .n>p { color: var(--ink); }\n@media (min-width: 560px) {\n  .n em { color: var(--accent); }\n}\n`,
      ).map(({ chain }) => chain),
    ).toEqual([['.m, .n>p'], ['@media (min-width: 560px)', '.n em']]);
  });

  it('leaves alone what carries its own ground, what is not inside, and paper', () => {
    const notice = '.n { background: #fff6e3; color: #1a1a1a; }\n';
    // The same paragraph rule as above, with its token ink: found, so the
    // cases below are empty because of what they change, not by default.
    const control = tokenInkInside(
      'x.css',
      `${notice}.n p { color: var(--ink); }\n`,
    );
    const leftAlone = tokenInkInside(
      'x.css',
      notice +
        '.n p { color: #1a1a1a; }\n' +
        '.n button { background: var(--accent); color: var(--on-accent); }\n' +
        '.n[hidden] { color: var(--ink); }\n' +
        '.n-note p { color: var(--ink); }\n' +
        '@media print {\n  .n p { color: var(--ink); }\n}\n' +
        // A ground painted on paper only: on screen `.q` paints nothing
        // literal, so the screen text inside it is not on that cream.
        '@media print {\n  .q { background: #fff; }\n}\n' +
        '.q p { color: var(--ink); }\n',
    );
    expect(
      searched(leftAlone.map(describeInkInside), {
        of: control,
        what: 'the paragraph rule with token ink',
      }),
    ).toEqual([]);
    expect(
      floorBreach('literal-grounds/left-alone-controls', control.length),
    ).toBeUndefined();
  });

  it('exempts only grounds the reader finds', () => {
    const grounds = groundsUnderSrc();
    const idle = EXEMPT.filter(
      (exemption) => !grounds.some(({ chain }) => exemption.covers(chain)),
    ).map((exemption) => exemption.reason);
    const judged = grounds.map(describeGround);
    expect(
      searched(idle, {
        of: judged,
        what: 'literal grounds under src/',
      }),
    ).toEqual([]);
    expect(
      floorBreach('literal-grounds/exemption-checked-grounds', judged.length),
    ).toBeUndefined();
  });

  it('joins a selector split over several rules, keeping the last of each property', () => {
    const split = literalGrounds(
      'x.css',
      '.a { margin: 0; }\n.a { background: #fff; }\n.a { color: #111; }\n',
    );
    expect(split.map(describeGround)).toEqual([
      'x.css :: .a paints #fff under color: #111',
    ]);
    expect(
      searched(offending(split), { of: split, what: 'grounds in the fixture' }),
    ).toEqual([]);
    expect(
      floorBreach('literal-grounds/joined-grounds', split.length),
    ).toBeUndefined();

    const overridden = literalGrounds(
      'x.css',
      '.a { background: #fff; color: #111; }\n.a { color: var(--ink); }\n',
    );
    expect(offending(overridden).map(describeGround)).toEqual([
      'x.css :: .a paints #fff under color: var(--ink)',
    ]);

    // The same literal ground, before and after a later rule hands it to a
    // token: found first, so its absence after is the override's doing.
    const literal = literalGrounds('x.css', '.a { background: #fff; }\n');
    const handedToAToken = literalGrounds(
      'x.css',
      '.a { background: #fff; }\n.a { background: var(--bg); }\n',
    );
    expect(
      searched(handedToAToken, {
        of: literal,
        what: 'the ground before the override',
      }),
    ).toEqual([]);
    expect(
      floorBreach('literal-grounds/overridden-grounds', literal.length),
    ).toBeUndefined();
  });

  it('reads a token with a literal fallback as a token, on the ground and on the ink', () => {
    const literal = literalGrounds('x.css', '.a { background: #f7f6f2; }');
    expect(
      searched(
        literalGrounds('x.css', '.a { background: var(--bg, #f7f6f2); }'),
        { of: literal, what: 'the same colour written as a literal' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('literal-grounds/fallback-grounds', literal.length),
    ).toBeUndefined();
    expect(
      offending(
        literalGrounds(
          'x.css',
          '.a { background: #fff; color: var(--ink, #111); }',
        ),
      ).map(describeGround),
    ).toEqual(['x.css :: .a paints #fff under color: var(--ink, #111)']);
  });

  it('tells the same selector on screen and on paper apart, and exempts only paper', () => {
    const grounds = literalGrounds(
      'x.css',
      '.a { background: #fff; }\n@media print {\n  .a { background: #fff; }\n}\n',
    );
    expect(grounds.map(({ chain }) => chain)).toEqual([
      ['.a'],
      ['@media print', '.a'],
    ]);
    expect(offending(grounds).map(({ chain }) => chain)).toEqual([['.a']]);
  });

  it('exempts a ::backdrop, and nothing that merely contains the word', () => {
    const grounds = literalGrounds(
      'x.css',
      '.panel::backdrop { background: rgb(0 0 0 / 45%); }\n.backdrop-note { background: #fff; }\n',
    );
    expect(offending(grounds).map(({ chain }) => chain)).toEqual([
      ['.backdrop-note'],
    ]);
  });

  it('reads the <style> bodies of an .astro file, and nothing outside them', () => {
    const grounds = literalGrounds(
      'x.astro',
      '---\nconst note = ".a { background: #fff; }";\n---\n<p class="a">x</p>\n<style is:global>\n  .b { background: #fff6e3; }\n</style>\n',
    );
    expect(grounds.map(describeGround)).toEqual([
      'x.astro :: .b paints #fff6e3 under inherited ink',
    ]);
  });
});
