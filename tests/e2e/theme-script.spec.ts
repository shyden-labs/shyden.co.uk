import { test, expect } from './fixtures';
import { THEME_SCRIPT_SOURCE } from '../themes';

/**
 * The one script every page carries, pinned by what MAY exist (#142 §6.4).
 *
 * The homepage's promise was "no JavaScript", held by counting to zero. With
 * the theme script it ships exactly one, so the promise is pinned as an
 * inventory instead: the theme script on every page exactly once, identical
 * to its source, and nothing else on a page that carried nothing before.
 *
 * Read from a real DOM (`document.scripts`), never by matching `<script` in
 * the HTML: /classroom-groups carries a comment that only mentions the tag,
 * and a text match counts it.
 */

test.describe('the theme script (#142 §6.4)', () => {
  test('is compared with the real script', () => {
    // The control for every comparison below: an empty or missing source
    // would match nothing, or an empty inline script, and prove nothing.
    expect(THEME_SCRIPT_SOURCE).toContain("localStorage.getItem('theme')");
  });

  // Each built page carries it exactly once and runs it before the first
  // paint: both read on each page's walk, checks/served-page.ts (#1086).
});
