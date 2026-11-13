import { test, expect } from './fixtures';
import { LOCALES } from '../../src/lib/i18n';

/**
 * Thai marks must not run into the line above (#22): measured on each Thai
 * page's walk, at every width, by checks/thai.ts (#1086).
 */

test.describe('Thai typography', () => {
  test('th is one of the locales this suite is allowed to assume', () => {
    // Derived, not assumed: if Thai were dropped from LOCALES these routes
    // would 404 and every measurement would pass on an empty page.
    expect(LOCALES).toContain('th');
  });
});
