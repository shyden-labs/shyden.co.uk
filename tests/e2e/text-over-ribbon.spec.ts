import { test, expect } from './fixtures';
import { PUBLISHED_ROUTES, withoutTrailingSlash } from './published-paths';
import { builtPaths } from './checks/ribbon';

/**
 * Every piece of text the aurora ribbon sits behind clears WCAG AA, measured
 * on the rendered page (#371): see checks/ribbon.ts. This holds the walk's
 * routes to the pages the build emits.
 */
test('the ribbon is measured on every built page', () => {
  expect(PUBLISHED_ROUTES.map(withoutTrailingSlash).sort()).toEqual(
    builtPaths().map(withoutTrailingSlash).sort(),
  );
});

// Every page's text over the ribbon is scored on its walk, at each width:
// checks/ribbon.ts (#1086).
