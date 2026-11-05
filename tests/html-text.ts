/** The named entities the build emits, as a reader sees them. */
const NAMED: Readonly<Record<string, string>> = {
  quot: '"',
  apos: "'",
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
};

/**
 * Built HTML's text as a reader sees it: entity-decoded and
 * whitespace-flattened.
 *
 * Both are load-bearing for a scan that looks for catalogue strings in built
 * pages. An apostrophe is served as `&#39;`, so "what you're building" never
 * matches the source raw; and HTML wraps freely, so a sentence can be split
 * across lines between any two words.
 *
 * ONE pass, every entity matched by the same expression. The scan it came out
 * of (`copy-reaches-a-page.spec.ts`) replaced one entity at a time with
 * `&amp;` before `&lt;`, so text served as `&amp;lt;` came back as `<`,
 * decoded twice; and `fromCharCode` cut anything above U+FFFF in half
 * (#390 F115). An entity outside the table is left as written.
 */
export const renderedText = (html: string): string =>
  html
    .replace(
      /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi,
      (entity, decimal?: string, hex?: string, name?: string) => {
        if (decimal !== undefined) return String.fromCodePoint(Number(decimal));
        if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16));
        return NAMED[(name ?? '').toLowerCase()] ?? entity;
      },
    )
    .replace(/\s+/g, ' ');
