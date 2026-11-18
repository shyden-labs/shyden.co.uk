import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { shoot } from './evidence';
import { filesUnder, searched } from '../source-files';
import { THEMES, ribbonLayers, tokensCss } from '../palette';
import { emulateTheme } from '../themes';
import { contrast, over, parseColour, type RGB } from '../wcag';

/**
 * Every piece of text the aurora ribbon sits behind clears WCAG AA, measured
 * on the rendered page (#371).
 *
 * `contrast.test.ts` scores the atmosphere by stacking every layer at full
 * strength under one letter. The ribbon's three fields are separate soft
 * ellipses that never meet at one point, so that model failed the ribbon at
 * 2.76:1, a stack no page paints. The operator chose, 2026-09-27, to measure
 * real text instead: this renders each built page, hides its text,
 * photographs the ground, and holds every text run the ribbon reaches to
 * 4.5:1 against the pixels behind its own line boxes. Each run annotates the
 * tightest text it found.
 *
 * 4.5:1 for every run, headings included: the large-text allowance would be
 * a second rule to get right, and no heading here needs it.
 */
const AA = 4.5;
const WIDTHS = [390, 1280] as const;

/** Every built page as a path the preview serves; the 404 by a miss. */
const builtPaths = (): string[] =>
  filesUnder('dist', (path) => path.endsWith('.html')).map((file) =>
    file === 'dist/404.html'
      ? '/no-such-page-for-the-ribbon-check'
      : file.replace(/^dist/, '').replace(/index\.html$/, ''),
  );

interface Run {
  where: string;
  ratio: number;
}

/** A ratio as a reader should see it: cut, never rounded up past 4.5. */
const shown = (ratio: number): string =>
  `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;

/**
 * Every text run on the page the ribbon reaches, scored against the ground.
 *
 * A run is a text node's own line boxes (a `Range`), never its element's box,
 * which would take in a control's fill beside the words. Text whose ground is
 * an OPAQUE fill colour of an ancestor (a card, a button) is skipped: the
 * ribbon cannot show through it, and `contrast.test.ts` already scores that
 * fill. Glass (a fill with alpha below 1) lets the ribbon through and is
 * scored, and so is text over a background image, against its real pixels.
 *
 * The browser only reads: the runs, then every colour in the photograph
 * behind each one. The arithmetic happens here in node, against the one copy
 * of the WCAG formula (`tests/wcag.ts`, #277). An `evaluate` callback cannot
 * import, so one that did the maths would be a second copy, and this spec's
 * first version was one, linearising at its own constant.
 */
const scoreRuns = async (
  page: Page,
  path: string,
): Promise<{ runs: Run[]; seen: number }> => {
  const { found: runs, seen } = await page.evaluate(() => {
    const opaque = (el: Element) => {
      const c = getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
      return c !== null && (c.length === 3 || Number(c[3]) === 1);
    };
    const onRibbon = (el: Element) => {
      for (
        let e: Element | null = el;
        e && e !== document.body;
        e = e.parentElement
      )
        if (opaque(e)) return false;
      return true;
    };
    // The opacity the text is drawn at: its own times every ancestor's.
    const opacity = (el: Element) => {
      let drawn = 1;
      for (let e: Element | null = el; e; e = e.parentElement)
        drawn *= Number(getComputedStyle(e).opacity);
      return drawn;
    };
    // The ribbon is placed against the top of the document, not the body.
    const ribbon =
      parseFloat(getComputedStyle(document.body, '::after').height) - scrollY;
    const found: {
      text: string;
      ink: string;
      opacity: number;
      rects: number[][];
    }[] = [];
    // Readable text anywhere on the first screen, over the band or not: the
    // producer the narrowed population above is taken from.
    let seen = 0;
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || !node.textContent?.trim()) continue;
      if (
        !parent.checkVisibility({
          opacityProperty: true,
          visibilityProperty: true,
        })
      )
        continue;
      if (!onRibbon(parent)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const readable = [...range.getClientRects()].filter(
        (r) => r.width > 4 && r.height > 4 && r.bottom <= innerHeight,
      );
      if (readable.length) seen += 1;
      const rects = readable
        .filter((r) => r.top < ribbon)
        .map((r) => [r.x + 1, r.y + 1, r.width - 2, r.height - 2]);
      if (rects.length)
        found.push({
          text: node.textContent.trim().slice(0, 40),
          ink: getComputedStyle(parent).color,
          opacity: opacity(parent),
          rects,
        });
    }
    const hide = document.createElement('style');
    hide.textContent =
      '* { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }';
    document.head.append(hide);
    return { found, seen };
  });
  // In CSS pixels: the mobile and Safari projects emulate a 2-3x display,
  // and a device-pixel image read at CSS coordinates samples the wrong
  // place (it reported 1.82:1 for text chromium measured at 6:1).
  const shot = (await page.screenshot({ scale: 'css' })).toString('base64');
  // Every colour in the photograph behind each run, packed as 0xRRGGBB.
  const grounds = await page.evaluate(
    async ({ shot, boxes }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${shot}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const g = canvas.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      return boxes.map((rects) => {
        const seen = new Set<number>();
        for (const [x, y, w, h] of rects) {
          const d = g.getImageData(
            Math.floor(x),
            Math.floor(y),
            Math.max(1, Math.floor(w)),
            Math.max(1, Math.floor(h)),
          ).data;
          for (let i = 0; i < d.length; i += 4)
            seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
        }
        return [...seen];
      });
    },
    { shot, boxes: runs.map((run) => run.rects) },
  );
  const scored = runs.map((run, n) => {
    const where = `${path} "${run.text}"`;
    const ink = parseColour(run.ink);
    if (ink === null) throw new Error(`unreadable ink ${run.ink} at ${where}`);
    // No pixels would score Infinity, a pass nobody measured.
    if (grounds[n].length === 0)
      throw new Error(`no ground was read behind ${where}`);
    const drawn = { rgb: ink.rgb, alpha: ink.alpha * run.opacity };
    const ratio = grounds[n].reduce((worst, packed) => {
      const ground: RGB = [packed >> 16, (packed >> 8) & 255, packed & 255];
      return Math.min(worst, contrast(over(drawn, ground), ground));
    }, Infinity);
    return { where, ratio };
  });
  return { runs: scored, seen };
};

for (const theme of THEMES)
  for (const width of WIDTHS)
    test(
      `${theme} at ${width}px: every text run over the ribbon clears AA, on every page`,
      { tag: '@emulated-viewport' },
      async ({ page }) => {
        // Sixteen pages, each rendered and photographed: more than the default
        // 30 s on the emulated phones.
        test.setTimeout(120_000);
        await page.setViewportSize({ width, height: 900 });
        // The ribbon exists and paints its tokens, or there is nothing here
        // to measure and a clean result would mean nothing.
        expect(ribbonLayers(tokensCss()).length).toBe(3);
        const paths = builtPaths();
        const runs: Run[] = [];
        const unread: string[] = [];
        const belowTheBand: string[] = [];
        for (const path of paths) {
          await page.goto(path);
          await emulateTheme(page, theme);
          const scan = await scoreRuns(page, path);
          if (scan.seen === 0) unread.push(path);
          if (path === '/') {
            // The release evidence (#362) pictures the ribbon here: the
            // homepage's first screen, where the band sits behind the hero.
            expect(
              scan.seen,
              "the homepage's first screen was read",
            ).toBeGreaterThan(0);
            // The scan left every glyph transparent to photograph the ground,
            // so the picture is of a fresh load, as a visitor sees it.
            await page.goto(path);
            await emulateTheme(page, theme);
            await expect(page.locator('.hero h1')).toBeVisible();
            await shoot(
              page,
              `${theme} at ${width}px: the homepage under the ribbon`,
            );
          }
          if (scan.runs.length === 0) belowTheBand.push(path);
          runs.push(...scan.runs);
        }
        const tightest = [...runs].sort((a, b) => a.ratio - b.ratio)[0];
        test.info().annotations.push(
          {
            type: 'tightest',
            description: tightest
              ? `${tightest.where} ${shown(tightest.ratio)}`
              : 'none',
          },
          // Layout, not a fault: at this width these pages' text all starts
          // below the band, so none of it is over the ribbon.
          {
            type: 'no text over the ribbon',
            description: belowTheBand.join(' ') || 'none',
          },
        );
        const failing = runs
          .filter((run) => run.ratio < AA)
          .map((run) => `${run.where} ${shown(run.ratio)}`);
        expect(
          searched(failing, { of: runs, what: 'text runs over the ribbon' }),
        ).toEqual([]);
        // Every page was read: its first screen held text the scan could see.
        // A page can have nothing over the band, but a page with nothing seen
        // at all is a scan that did not run there.
        expect(searched(unread, { of: paths, what: 'built pages' })).toEqual(
          [],
        );
      },
    );
