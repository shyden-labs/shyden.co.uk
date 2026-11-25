import { describe, expect, it } from 'vitest';
import { FETCHED_SCRIPT } from '../fetched-script';

/**
 * The production smoke's "fetches no script" check reads served HTML with
 * this pattern. It matched only a double-quoted `src` ending exactly in
 * `.js`, so a fetched script written any other way passed it (#390 F51).
 */
describe('FETCHED_SCRIPT', () => {
  it.each([
    '<script type="module" src="/_astro/page.abc.js"></script>',
    "<script src='/_astro/page.abc.js'></script>",
    '<script src=/_astro/page.js></script>',
    '<script type="module" src="/_astro/page.abc.mjs"></script>',
    '<script src="/_astro/page.js?v=2"></script>',
    '<SCRIPT SRC="/x.js"></SCRIPT>',
  ])('finds a fetched script: %s', (html) => {
    expect(html).toMatch(FETCHED_SCRIPT);
  });

  it.each([
    '<script>document.documentElement.dataset.theme = "dark"</script>',
    '<script type="application/ld+json">{"src":"x.js"}</script>',
    '<img src="/a.js.png">',
    '<noscript>no src here</noscript>',
  ])('finds none in: %s', (html) => {
    expect(html).not.toMatch(FETCHED_SCRIPT);
  });
});
