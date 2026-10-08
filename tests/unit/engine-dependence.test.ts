import ts from 'typescript';
import { describe, it, expect } from 'vitest';
import { searched } from '../source-files';
import { floorBreach } from '../floors';
import { nodesIn, parseSource } from './ast';
import {
  EMULATED_VIEWPORT_TAG,
  ENGINE_DEPENDENT_NAMES,
  engineDependence,
} from './engine-dependence';

/**
 * The detector behind the content-only boundary (#198).
 *
 * A spec is content-only when its verdict cannot depend on the engine or the
 * viewport, and the guard used to decide that with `src.includes(...)` on two
 * names that DRIVE the viewport. `rendered-text.spec.ts` never drove it; it
 * READ layout, through `getClientRects`, so it was classed content-only, ran
 * only at 1280px on one engine, and failed on every page of a real phone.
 *
 * Every fixture below is a place where reading the text and reading the code
 * give different answers. Each passes its own name set, so what is proved here
 * is the machinery; which names belong in the set is pinned separately. The
 * fixtures are source text handed to a parser: `$eval` and `evaluate` inside
 * them are Playwright API names being read, and nothing here executes them.
 */

const names = (...list: string[]): ReadonlySet<string> => new Set(list);

/** Every identifier the detector compares against its name set, in the code it was handed. */
const identifiersIn = (source: string): ts.Node[] =>
  nodesIn(parseSource(source), ts.isIdentifier);

describe('engineDependence finds a name wherever the code uses it', () => {
  it('as a call', () => {
    const src =
      'await page.evaluate(() => document.body.getClientRects().length);';
    expect(engineDependence(src, names('getClientRects'))).toEqual([
      'getClientRects',
    ]);
  });

  it('as a property read', () => {
    const src = 'const w = await el.evaluate((n) => n.offsetWidth);';
    expect(engineDependence(src, names('offsetWidth'))).toEqual([
      'offsetWidth',
    ]);
  });

  it('as an option key', () => {
    const src = "await expect(nav).toHaveText('Home', { useInnerText: true });";
    expect(engineDependence(src, names('useInnerText'))).toEqual([
      'useInnerText',
    ]);
  });

  it('as a fixture destructured from the test', () => {
    const src = "test('t', async ({ page, browserName }) => { void page; });";
    expect(engineDependence(src, names('browserName'))).toEqual([
      'browserName',
    ]);
  });

  it('split across lines the way prettier writes it', () => {
    const src = [
      'await expect(',
      "  page.locator('.skip-link'),",
      ').not.toBeInViewport();',
    ].join('\n');
    expect(engineDependence(src, names('toBeInViewport'))).toEqual([
      'toBeInViewport',
    ]);
  });
});

describe('engineDependence reads code, never prose', () => {
  it('ignores the name in a line comment, a block comment and a docblock', () => {
    const src = [
      '// getClientRects is what rendered-text reads',
      '/* offsetWidth, too */',
      '/** innerText depends on CSS */',
      "await expect(page).toHaveTitle('Shyden');",
    ].join('\n');
    expect(
      searched(
        engineDependence(
          src,
          names('getClientRects', 'offsetWidth', 'innerText'),
        ),
        { of: identifiersIn(src), what: 'identifiers in the code' },
      ),
    ).toEqual([]);
    expect(
      floorBreach(
        'engine-dependence/comment-fixture-identifiers',
        identifiersIn(src).length,
      ),
    ).toBeUndefined();
  });

  it('ignores the name in a test title and in any other plain string', () => {
    const src = [
      "test('never reads innerText', async ({ page }) => {",
      "  const label = 'getClientRects';",
      '  await page.goto(`/${label}`);',
      '});',
    ].join('\n');
    expect(
      searched(engineDependence(src, names('innerText', 'getClientRects')), {
        of: identifiersIn(src),
        what: 'identifiers in the code',
      }),
    ).toEqual([]);
    expect(
      floorBreach(
        'engine-dependence/string-fixture-identifiers',
        identifiersIn(src).length,
      ),
    ).toBeUndefined();
  });
});

describe('engineDependence reads code a page function receives as a string', () => {
  it('in evaluate, parsed as code rather than searched as text', () => {
    const src = "await page.evaluate('document.documentElement.scrollWidth');";
    expect(engineDependence(src, names('scrollWidth'))).toEqual([
      'scrollWidth',
    ]);
  });

  it('in $eval, whose code is the second argument', () => {
    const src = "await page.$eval('main', 'el => el.innerText');";
    expect(engineDependence(src, names('innerText'))).toEqual(['innerText']);
  });

  it('in a template literal with a substitution', () => {
    const src =
      'await page.evaluate(`document.querySelector(${sel}).offsetHeight`);';
    expect(engineDependence(src, names('offsetHeight'))).toEqual([
      'offsetHeight',
    ]);
  });

  it('but never reads a selector as code', () => {
    const src = "await page.$eval('.innerText', (el) => el.id);";
    expect(
      searched(engineDependence(src, names('innerText')), {
        of: identifiersIn(src),
        what: 'identifiers in the code',
      }),
    ).toEqual([]);
    expect(
      floorBreach(
        'engine-dependence/selector-fixture-identifiers',
        identifiersIn(src).length,
      ),
    ).toBeUndefined();
  });

  it('and still ignores a comment inside that code', () => {
    const src =
      "await page.evaluate('/* offsetWidth */ document.title.length');";
    expect(
      searched(engineDependence(src, names('offsetWidth')), {
        of: identifiersIn(src),
        what: 'identifiers in the code',
      }),
    ).toEqual([]);
    expect(
      floorBreach(
        'engine-dependence/commented-page-code-identifiers',
        identifiersIn(src).length,
      ),
    ).toBeUndefined();
  });
});

describe('engineDependence finds the emulated-viewport tag', () => {
  it('in a tag option and in a title', () => {
    for (const src of [
      `test('menu', { tag: '${EMULATED_VIEWPORT_TAG}' }, async () => {});`,
      `test('menu ${EMULATED_VIEWPORT_TAG}', async () => {});`,
    ]) {
      expect(engineDependence(src, names())).toEqual([EMULATED_VIEWPORT_TAG]);
    }
  });

  it('but not in a comment that names it', () => {
    const src = `// no ${EMULATED_VIEWPORT_TAG} here\ntest('t', async () => {});`;
    expect(
      searched(engineDependence(src, names()), {
        of: identifiersIn(src),
        what: 'identifiers in the code',
      }),
    ).toEqual([]);
    expect(
      floorBreach(
        'engine-dependence/commented-tag-identifiers',
        identifiersIn(src).length,
      ),
    ).toBeUndefined();
  });
});

describe('engineDependence reports what it found', () => {
  it('each signal once, sorted, so a failure reads the same every run', () => {
    const src = [
      'const a = await el.evaluate((n) => n.offsetWidth);',
      'const b = await el.evaluate((n) => n.offsetWidth);',
      'const box = await el.boundingBox();',
    ].join('\n');
    expect(engineDependence(src, names('offsetWidth', 'boundingBox'))).toEqual([
      'boundingBox',
      'offsetWidth',
    ]);
  });

  it('nothing, for a spec that only asserts content', () => {
    const src = [
      "test('the sitemap lists the page', async ({ request }) => {",
      "  const res = await request.get('/sitemap-0.xml');",
      "  expect(await res.text()).toContain('/classroom-groups');",
      '});',
    ].join('\n');
    expect(
      searched(engineDependence(src), {
        of: identifiersIn(src),
        what: 'identifiers in the code',
      }),
    ).toEqual([]);
    expect(
      floorBreach(
        'engine-dependence/content-only-identifiers',
        identifiersIn(src).length,
      ),
    ).toBeUndefined();
  });
});

describe('the default name set', () => {
  it('holds every name #198 lists, and the two that drive the viewport', () => {
    for (const name of [
      'getClientRects',
      'getBoundingClientRect',
      'offsetWidth',
      'offsetHeight',
      'elementFromPoint',
      'innerText',
      'setViewportSize',
    ]) {
      expect(ENGINE_DEPENDENT_NAMES.has(name), name).toBe(true);
    }
  });

  it('is exactly the set chosen for #198: every layout read, not only those listed', () => {
    // Operator decision, 2026-09-18. Playwright can read layout with no DOM
    // call at all (`toBeInViewport`), and a spec that asks `browserName` has
    // said its verdict depends on the engine. Removing a name here re-opens
    // the boundary for every spec that uses it.
    expect(new Set(ENGINE_DEPENDENT_NAMES)).toEqual(
      new Set([
        ...['setViewportSize', 'viewport', 'isMobile', 'hasTouch'],
        ...['deviceScaleFactor', 'getClientRects', 'getBoundingClientRect'],
        ...['offsetWidth', 'offsetHeight', 'elementFromPoint', 'innerText'],
        ...['elementsFromPoint', 'offsetTop', 'offsetLeft', 'clientWidth'],
        ...['clientHeight', 'scrollWidth', 'scrollHeight', 'checkVisibility'],
        ...['getComputedStyle', 'matchMedia', 'innerWidth', 'innerHeight'],
        ...['boundingBox', 'toBeInViewport', 'isVisible', 'toBeVisible'],
        ...['isHidden', 'toBeHidden', 'scrollIntoViewIfNeeded', 'viewportSize'],
        ...['useInnerText', 'toHaveScreenshot', 'browserName'],
      ]),
    );
  });
});
