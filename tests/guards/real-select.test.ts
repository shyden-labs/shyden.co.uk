import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { filesUnder, searched } from '../source-files';
import { withoutTsComments } from '../unit/source-text';

/**
 * Every browser test chooses a dropdown the way a visitor does (#1027).
 * Playwright's `selectOption()` sets `option.selected` in an injected script
 * and dispatches `input` and `change` itself, so no click, tap or key press
 * reaches the select. Choosing goes through `chooseOption`
 * (`tests/real-select.ts`). The only mention left in the browser suites is
 * the phone's refusal list in `tests/device/no-mouse-on-phone.ts`, which names
 * the method without calling it. Unit tests keep their mocks and are not
 * read here.
 */
const SUITES = [
  'tests/e2e',
  'tests/dev',
  'tests/prod',
  'tests/functions',
  'tests/device',
];
const files = [
  ...SUITES.flatMap((dir) => filesUnder(dir, (path) => /\.ts$/.test(path))),
  'tests/make-groups.ts',
].map((path) => ({
  path,
  code: withoutTsComments(readFileSync(path, 'utf8')),
}));

describe('every browser test chooses a dropdown with real input (#1027)', () => {
  it('no browser test calls selectOption()', () => {
    const hits = searched(files, { of: files, what: 'browser test files' })
      .filter(({ code }) => /selectOption\s*\(/.test(code))
      .map(({ path }) => path);
    expect(hits).toEqual([]);
  });

  it("the phone's refusal list still names selectOption", () => {
    const refusal = files.find(
      ({ path }) => path === 'tests/device/no-mouse-on-phone.ts',
    );
    expect(refusal?.code.match(/'selectOption'/g)).toHaveLength(2);
  });
});
