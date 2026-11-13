import type { Page } from '@playwright/test';
import { visibleLinesReaderScript } from '../visible-text';

/**
 * The rendered-text scan's readers, moved out of rendered-text.spec.ts so the
 * page walk (#1086) can run them without that file's tests registering twice.
 * See rendered-text.spec.ts for what the scan exists to catch.
 */

/**
 * Punctuation glued directly to what follows it.
 *
 * Held as source strings, not RegExp literals, and compiled fresh at every
 * use. A shared `/g` regex carries `lastIndex` between calls, so the second
 * test to touch one would silently start scanning from halfway through the
 * page — the kind of defect that shows up as one flaky run in twenty.
 */
export const GLUE_PATTERNS: Array<{ source: string; why: string }> = [
  {
    // "ends.Kembali" · "apart,And" — sentence or clause boundary with the
    // space missing. A real sentence never runs a capital onto punctuation.
    source: '[a-z][.,:][A-Z]',
    why: 'punctuation glued to the next sentence',
  },
  {
    // "No.17110487" — the exact defect that shipped.
    source: '[a-z]\\.\\d',
    why: 'a word glued to a number',
  },
  {
    // "office:71-75" — the other one. Anchored on a letter before the colon
    // so clock times ("9:30") are not swept up.
    source: '[a-z]:\\d',
    why: 'a label glued to its value',
  },
];

export const scan = (text: string) =>
  GLUE_PATTERNS.flatMap(({ source, why }) =>
    [...text.matchAll(new RegExp(source, 'g'))].map((m) => ({
      why,
      at: m.index ?? 0,
    })),
  );

/**
 * The text a visitor actually reads, with the conditional fields revealed.
 *
 * innerText and not textContent: textContent concatenates block elements with
 * no separator at all, so every `</p><p>` would look like a defect. innerText
 * inserts the line breaks the layout implies, which is precisely the join
 * being tested. `hidden` is stripped first so the fields behind the radio
 * buttons are scanned too, and every `<details>` is opened: innerText leaves
 * a closed one's content out, so every report form's words passed both scans
 * below on all thirteen beta pages (RT1, RT2).
 */
export const renderedText = (page: Page) =>
  page.evaluate(() => {
    document
      .querySelectorAll('[hidden]')
      .forEach((el) => el.removeAttribute('hidden'));
    document
      .querySelectorAll('details')
      .forEach((details) => (details.open = true));
    return document.body.innerText;
  });

/**
 * Joins that are meant to be there: ordinary typography, never one sentence.
 * The full-width shapes arrived with #390 F65, when the 404 stopped putting an
 * English space into its Chinese line. A Chinese sentence glued to its link
 * WITHOUT a full stop is still a finding.
 */
export const INTENTIONAL_JOINS: Array<{
  left: RegExp;
  right: RegExp;
  why: string;
}> = [
  {
    left: /Shy$/,
    right: /^Talk/,
    why: 'the ShyTalk wordmark is one word rendered in two colours',
  },
  {
    left: /\S$/,
    right: /^[.,。，]$/,
    why: 'punctuation closing a sentence that ended in a link',
  },
  {
    left: /\/[a-z][\w-]*$/,
    right: /^\/[a-z][\w-]*/,
    why:
      'a URL path the API docs draw one segment per element, /api then ' +
      '/report: one path, read as one word (#781)',
  },
  {
    left: /[。！？]$/,
    right: /^\S/,
    why:
      'a full-width stop carries its own space: Chinese sets the next ' +
      'sentence straight after it (#390 F65)',
  },
];

/**
 * Every place two neighbouring nodes render side by side on one line with no
 * gap between them.
 *
 * This is the seam defect stated as what a visitor sees, rather than guessed
 * at from punctuation. The purely textual scan above only knows Latin
 * letters: delete the 404 page's `{' '}` and it finds the Indonesian and
 * Vietnamese sentences glued to their links, while this finds those two and
 * the Chinese and Thai ones as well (measured, #198). The Chinese one has had
 * no space since #390 F65, by design: it ends in `。`, which the allow-list
 * below accepts.
 *
 * Measured rather than reasoned about, because the obvious implementations
 * are both wrong. Comparing text alone reports 172 joins on this site, nearly
 * all of them block elements that legitimately touch. Filtering by CSS
 * `display` still mis-reads inline-blocks that CSS margins hold apart. Asking
 * the browser where the boxes actually landed reports ten (two shapes, in five
 * languages), and all ten are deliberate.
 *
 * Both sides of a join are read as the lines of text a visitor can see, and
 * nothing else (#198). At phone width every page failed on a join nobody could
 * see: the header's last text box was a `.visually-hidden` label inside the closed
 * language menu, and the "line" it touched was the hero section's 550px
 * border box, which `Range.getClientRects()` returns alongside the text
 * inside it. Hidden text is left out of the neighbours too, so the visible
 * text either side of it is compared directly.
 */
export const visualJoins = (page: Page) =>
  page.evaluate((readerScript) => {
    // What a visitor can see of a text node, read in its one home
    // (`tests/visible-text.ts`) and shipped in as text.
    const visibleLines = new Function(readerScript)() as (
      node: Text,
    ) => DOMRect[];
    const out: Array<{ left: string; right: string; tag: string }> = [];
    const skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);

    type Seen = { text: string; lines: DOMRect[] };

    // What a visitor sees of a node: its text, and the lines that text sits
    // on, in document order. Only text nodes have lines, so an element's own
    // border box never stands in for one.
    const seenCache = new Map<Node, Seen>();
    const seen = (node: Node): Seen => {
      const cached = seenCache.get(node);
      if (cached) return cached;
      let result: Seen = { text: '', lines: [] };

      if (node instanceof Text) {
        const lines = visibleLines(node);
        if (lines.length) result = { text: node.data, lines };
      } else if (node instanceof Element && !skip.has(node.tagName)) {
        const parts = [...node.childNodes].map(seen);
        result = {
          text: parts.map((part) => part.text).join(''),
          lines: parts.flatMap((part) => part.lines),
        };
      }

      seenCache.set(node, result);
      return result;
    };

    const walk = (el: Element) => {
      if (skip.has(el.tagName)) return;
      const kids = [...el.childNodes].map(seen).filter((kid) => kid.text);

      for (let i = 0; i < kids.length - 1; i++) {
        const left = kids[i];
        const right = kids[i + 1];
        if (!left.text.trim() || !right.text.trim()) continue;
        // A space on either side of the join means the join is fine.
        if (/\s$/.test(left.text) || /^\s/.test(right.text)) continue;

        const a = left.lines.at(-1);
        const b = right.lines[0];
        if (!a || !b) continue;

        const sameLine =
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
        if (sameLine && b.left - a.right < 1) {
          out.push({ tag: el.tagName, left: left.text, right: right.text });
        }
      }
      for (const child of el.children) walk(child);
    };

    walk(document.body);
    return out;
  }, visibleLinesReaderScript());

/**
 * Cases for the join detector itself.
 *
 * Each case is laid out on its own: the left text ends at the middle of the
 * page, the right text starts there, both on the same top edge, and the two
 * are neighbours with nothing between them. So they touch, and the only thing
 * that can keep a join from being reported is the detector ruling a side out.
 * What comes back is the names of the cases whose join was reported, read off
 * the right-hand text, which every case leaves in view.
 *
 * Built as elements, not parsed from HTML: a stray newline in a markup string
 * becomes a text node, and that node, not the right text, would then be the
 * neighbour the detector compares.
 */
export type Fixture =
  string | { tag: string; style: string; children: Fixture[] };

/** One element of a case: `el('p', 'margin: 0', 'text')`. */
export const el = (
  tag: string,
  style: string,
  ...children: Fixture[]
): Fixture => ({
  tag,
  style,
  children,
});

export const LEFT =
  'position: absolute; top: 0; right: 50%; white-space: nowrap';
export const RIGHT =
  'position: absolute; top: 0; left: 50%; white-space: nowrap';
export const ONE_PIXEL = 'width: 1px; height: 1px; overflow: hidden';

export async function joinsReportedFor(
  page: Page,
  cases: Record<string, { left: Fixture; right?: Fixture }>,
): Promise<string[]> {
  const rows = Object.entries(cases).map(([name, { left, right }]) =>
    el(
      'div',
      'position: relative; height: 5em',
      left,
      right ?? el('span', RIGHT, `${name}-right`),
    ),
  );

  // The caller is on '/' already: the homepage's walk (#1086) runs this last,
  // since it replaces the page's body.
  await page.evaluate((fixtures) => {
    const build = (fixture: Fixture): Node => {
      if (typeof fixture === 'string') return document.createTextNode(fixture);
      const node = document.createElement(fixture.tag);
      node.setAttribute('style', fixture.style);
      node.append(...fixture.children.map(build));
      return node;
    };
    document.body.replaceChildren(...fixtures.map(build));
  }, rows);

  const names = (await visualJoins(page)).map((join) =>
    join.right.replace(/-right$/, ''),
  );
  return [...new Set(names)].sort();
}
