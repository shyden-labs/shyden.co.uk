import { readFileSync } from 'node:fs';
import { cssRules, type CssRule } from './unit/css-rules';
import { stylesheetCss } from './unit/source-text';
import { contrast, over, parseColour, type RGB, type RGBA } from './wcag';

/**
 * The palette as tokens.css declares it: the one model the contrast suite,
 * the token guards and the per-theme browser runs share, so none of them can
 * disagree about what the palette is (#142).
 */
export const TOKENS_FILE = 'src/styles/tokens.css';

/** tokens.css with its comments stripped: the only form a guard reads. */
export const tokensCss = (): string =>
  stylesheetCss(TOKENS_FILE, readFileSync(TOKENS_FILE, 'utf8')).join('\n');

/** The custom properties a block declares, the last of each name kept. */
export const customProperties = (rule: CssRule): Map<string, string> =>
  new Map(
    rule.declarations
      .filter(({ property }) => property.startsWith('--'))
      .map(({ property, value }) => [property, value]),
  );

/** The rules whose whole chain is `selector`: top level, inside no at-rule. */
const topLevel = (css: string, selector: string): CssRule[] =>
  cssRules(css).filter(
    ({ chain }) => chain.length === 1 && chain[0] === selector,
  );

/** The site's two themes (#142): light on bare `:root`, dark in the blocks that declare `color-scheme: dark`. */
export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/**
 * The bare `:root` block, exactly one, found by its chain rather than by
 * coming first: the print block is `:root` one level down, and a theme block
 * is `:root` with more after it.
 */
export const rootBlock = (css: string): CssRule => {
  const roots = topLevel(css, ':root');
  if (roots.length !== 1)
    throw new Error(
      `expected one bare :root block in ${TOKENS_FILE}, found ${roots.length}`,
    );
  return roots[0];
};

/** The tokens bare `:root` declares: Studio's, the light theme. */
export const rootTokens = (css: string): Map<string, string> =>
  customProperties(rootBlock(css));

/**
 * Every block that declares `color-scheme: dark`: Aurora, written twice
 * (#142 §4). Found by that declaration rather than by selector, so a copy
 * added later is found, and compared, too.
 */
export const darkBlocks = (css: string): CssRule[] =>
  cssRules(css).filter(({ declarations }) =>
    declarations.some(
      ({ property, value }) => property === 'color-scheme' && value === 'dark',
    ),
  );

/**
 * The tokens `theme` paints. Light is bare `:root`. Dark is bare `:root` with
 * the first dark block laid over it: a dark block redefines tokens and only
 * tokens, and tokens.test.ts proves every dark block identical, so the first
 * speaks for all of them.
 */
export const themeTokens = (css: string, theme: Theme): Map<string, string> => {
  const root = rootTokens(css);
  if (theme === 'light') return root;
  const [first] = darkBlocks(css);
  if (first === undefined)
    throw new Error(`no block in ${TOKENS_FILE} declares color-scheme: dark`);
  return new Map([...root, ...customProperties(first)]);
};

/**
 * A colour in the form `getComputedStyle` reports it: `rgb(r, g, b)`, or
 * `rgba(r, g, b, a)` below full opacity. A browser assertion compares with
 * this, so the page is judged against tokens.css rather than against itself.
 */
export const computedForm = (value: string): string => {
  const colour = parseColour(value);
  if (colour === null) throw new Error(`not a colour: ${value}`);
  const [r, g, b] = colour.rgb;
  return colour.alpha === 1
    ? `rgb(${r}, ${g}, ${b})`
    : `rgba(${r}, ${g}, ${b}, ${colour.alpha})`;
};

/** `theme`'s value for a colour token, as a browser reports it (#142 §6.2). */
export const themeColour = (theme: Theme, token: string): string => {
  const value = themeTokens(tokensCss(), theme).get(token);
  if (value === undefined)
    throw new Error(`${token} is not defined in the ${theme} theme`);
  return computedForm(value);
};

/** A comma-separated list, split only at commas outside parentheses. */
const layersOf = (value: string): string[] => {
  const layers: string[] = [];
  let depth = 0;
  let start = 0;
  [...value].forEach((ch, i) => {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      layers.push(value.slice(start, i).trim());
      start = i + 1;
    }
  });
  return [...layers, value.slice(start).trim()];
};

/**
 * The page atmosphere's layers as `body::before` paints them, TOP-FIRST. CSS
 * paints the first `background` layer on top, so declaration order IS the
 * stack. Derived, never written down: the suite's hand-written stack once put
 * the shaft on top of a stack the browser paints with the shaft at the bottom.
 *
 * Every layer must take its colour from exactly one token, or no pair could
 * score it: a literal layer would be invisible to every contrast check.
 *
 * NOT `body::after`. The aurora ribbon (#371) is three separate soft fields
 * that never meet at one point, so stacking them at full strength under one
 * letter scores a page that does not exist (2.76:1, while every text run on
 * the rendered pages clears 4.5:1). The operator chose, 2026-09-27, to score it where text
 * really sits: `tests/e2e/text-over-ribbon.spec.ts` renders every page and
 * measures each text run against the pixels behind it.
 */
export const atmosphereLayers = (css: string): string[] =>
  layerTokens(css, 'body::before');

/**
 * The aurora ribbon's layers as `body::after` paints them, top-first (#371):
 * the tokens `text-over-ribbon.spec.ts` renders and measures, and the only
 * tokens `contrast.test.ts` may leave to it.
 */
export const ribbonLayers = (css: string): string[] =>
  layerTokens(css, 'body::after');

/**
 * The aurora ribbon's box height, and how far down the page each of its
 * fields reaches before it has faded out, top-first, all in rem (#371).
 *
 * A field is `radial-gradient(<rx>rem <ry>rem at <x>% <y>rem, var(--token),
 * transparent <stop>%)`. Its colour is gone `stop` of the way out along the
 * ellipse, so it reaches `y + ry * stop` down from the top of the box. A
 * field written any other way is refused, because its reach could not be
 * derived, and a guard that skipped it would pass over the one field that
 * outgrew the box.
 */
export const ribbonGeometry = (
  css: string,
): { height: number; reaches: number[] } => {
  const height = /^(\d+(?:\.\d+)?)rem$/.exec(
    declarationOf(css, 'body::after', 'height'),
  );
  if (height === null)
    throw new Error(
      "body::after's height must be one length in rem, to be compared with how far its fields reach",
    );
  const reaches = layersOf(declarationOf(css, 'body::after', 'background')).map(
    (layer, i) => {
      const field = RIBBON_FIELD.exec(layer);
      if (field === null)
        throw new Error(
          `cannot derive how far field ${i + 1} reaches: write it as ` +
            'radial-gradient(<rx>rem <ry>rem at <x>% <y>rem, var(--token), transparent <stop>%), ' +
            `not ${layer}`,
        );
      const [, , ry, y, stop] = field.map(Number);
      return y + (ry * stop) / 100;
    },
  );
  return { height: Number(height[1]), reaches };
};

/** A ribbon field's radii, centre height and fade stop (see ribbonGeometry). */
const REM = String.raw`(\d+(?:\.\d+)?)rem`;
const RIBBON_FIELD = new RegExp(
  String.raw`^radial-gradient\(\s*${REM}\s+${REM}\s+at\s+\d+(?:\.\d+)?%\s+${REM}\s*,` +
    String.raw`\s*var\(\s*--[\w-]+\s*\)\s*,\s*transparent\s+(\d+(?:\.\d+)?)%\s*\)$`,
);

/** The value of `property` in `selector`'s one top-level rule, declared once. */
const declarationOf = (
  css: string,
  selector: string,
  property: string,
): string => {
  const rules = topLevel(css, selector);
  if (rules.length !== 1)
    throw new Error(
      `expected one top-level ${selector} rule in ${TOKENS_FILE}, found ${rules.length}`,
    );
  const values = rules[0].declarations.filter(
    (declaration) => declaration.property === property,
  );
  if (values.length !== 1)
    throw new Error(
      `${selector} declares ${property} ${values.length} times, expected once`,
    );
  return values[0].value.trim();
};

/** One atmosphere rule's `background` layers, top-first, as token names. */
const layerTokens = (css: string, selector: string): string[] =>
  layersOf(declarationOf(css, selector, 'background')).map((layer, i) => {
    const tokens = [...layer.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);
    if (tokens.length !== 1)
      throw new Error(
        `${selector} layer ${i + 1} names ${tokens.length} tokens; ` +
          `each layer must take its colour from exactly one: ${layer}`,
      );
    return tokens[0];
  });

/** Every subset of `items`, each keeping their order; the empty one first. */
export const subsets = <T>(items: readonly T[]): T[][] =>
  items.reduce<T[][]>(
    (all, item) => [...all, ...all.map((subset) => [...subset, item])],
    [[]],
  );

/**
 * Flatten a layer stack, written TOP-FIRST, onto its opaque base.
 *
 * `['--border-strong', '--bg']` is the border as the eye actually receives it.
 * Comparing the declared `rgb(255 255 255 / 0.4)` against `--bg` directly
 * scores 20.17:1 — the ratio of pure white to near-black, a colour that is
 * never drawn anywhere. An alpha judged un-composited is a guard measuring a
 * pixel that does not exist, and it fails OPEN.
 */
export const flatten = (
  layers: readonly string[],
  from: ReadonlyMap<string, string>,
): RGB | string => {
  const parsed: RGBA[] = [];
  for (const layer of layers) {
    const value = layer.startsWith('--') ? from.get(layer) : layer;
    if (value === undefined) return `${layer} is not defined in ${TOKENS_FILE}`;
    const colour = parseColour(value);
    if (colour === null) return `${layer} is not a readable colour: ${value}`;
    parsed.push(colour);
  }

  const base = parsed[parsed.length - 1];
  if (base.alpha !== 1)
    return `the base of [${layers.join(', ')}] is translucent — nothing is behind it`;

  return parsed
    .slice(0, -1)
    .reduceRight<RGB>((ground, layer) => over(layer, ground), base.rgb);
};

/** A stack entry standing for the atmosphere, replaced by each subset in turn. */
export const ATMOSPHERE = '(the atmosphere)';

/**
 * The worst contrast a pair can have. Each subset of the atmosphere's layers
 * takes ATMOSPHERE's place, in both stacks at once, since a mark and its
 * ground sit on the same pixel.
 *
 * "Every layer at once" is the worst case only when every layer moves the
 * ground towards the ink. It holds in Aurora. In #142's Studio the shaft
 * brightens the ground under dark ink while the pools darken it, and a
 * draft that passed with all four layers failed at 3.92:1 against two.
 */
export const worstContrast = (
  fg: readonly string[],
  bg: readonly string[],
  layers: readonly string[],
  from: ReadonlyMap<string, string>,
): { ratio: number; subset: readonly string[] } | string => {
  const named = fg.includes(ATMOSPHERE) || bg.includes(ATMOSPHERE);
  let worst: { ratio: number; subset: readonly string[] } | undefined;
  for (const subset of named ? subsets(layers) : [[]]) {
    const expand = (stack: readonly string[]) =>
      stack.flatMap((layer) => (layer === ATMOSPHERE ? subset : [layer]));
    const ink = flatten(expand(fg), from);
    const ground = flatten(expand(bg), from);
    if (typeof ink === 'string') return ink;
    if (typeof ground === 'string') return ground;
    const ratio = contrast(ink, ground);
    if (worst === undefined || ratio < worst.ratio) worst = { ratio, subset };
  }
  if (worst === undefined) throw new Error('subsets() returned nothing');
  return worst;
};
