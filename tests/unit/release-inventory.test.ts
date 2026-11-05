import { describe, expect, it } from 'vitest';
import { releaseTests } from '../../scripts/release-inventory.mjs';
import { fixtureReader } from '../fixture-texts';

describe('the capture selection (#362)', () => {
  const sources: Record<string, string> = {
    'tests/e2e/direct.spec.ts': `
import { shoot } from './evidence';
test('shoots directly', async ({ page }) => {
  await expect(page).toHaveTitle('x');
  await shoot(page, 'shown');
});
test('never shoots', async ({ page }) => {
  // shoot(page, 'a comment naming it decides nothing');
  await expect(page).toHaveTitle('x');
});
for (const locale of ['en', 'id'])
  test(\`\${locale}: shoots in a loop\`, async ({ page }) => {
    await shoot(page, locale);
  });
`,
    'tests/e2e/helper.spec.ts': `
const outer = async (page) => { await inner(page); };
const inner = async (page) => { await shoot(page, 'deep'); };
async function once(page) { await shoot(page, 'once'); }
test('through a helper', async ({ page }) => { await once(page); });
test("through a helper's helper", async ({ page }) => { await outer(page); });
test('calls a helper that never shoots', async ({ page }) => { await quiet(page); });
const quiet = async (page) => { await page.goto('/'); };
`,
    'tests/e2e/tooling.spec.ts': `
import { evidencePageOf } from '../evidence-fixture';
test('the evidence page itself', async ({ page }) => { await shoot(page, 'x'); });
`,
  };
  const read = fixtureReader(sources);

  it('selects each capturing test by file:line, through helpers to a fixed point', () => {
    expect(releaseTests(Object.keys(sources), read)).toEqual([
      'tests/e2e/direct.spec.ts:3',
      'tests/e2e/direct.spec.ts:12',
      'tests/e2e/helper.spec.ts:5',
      'tests/e2e/helper.spec.ts:6',
    ]);
  });
});

describe('a capture through a namespace import (#465)', () => {
  /** The selection of one spec file holding `source`. */
  const select = (source: string) =>
    releaseTests(['tests/e2e/case.spec.ts'], () => source);

  it('selects a test whose only capture is a namespace call', () => {
    expect(
      select(`
import * as evidence from './evidence';
test('shoots through the namespace', async ({ page }) => {
  await evidence.shoot(page, 'x');
});
`),
    ).toEqual(['tests/e2e/case.spec.ts:3']);
  });

  it('follows a helper whose capture is a namespace call', () => {
    expect(
      select(`
import * as evidence from './evidence';
const once = async (page) => { await evidence.shoot(page, 'x'); };
test('through a helper', async ({ page }) => { await once(page); });
`),
    ).toEqual(['tests/e2e/case.spec.ts:4']);
  });

  // Each case below keeps a capturing test beside the one it leaves out, so
  // the selection is never empty: a reader that stopped reading fails here
  // as surely as one that reads too much.
  it('never reads a property call to another name as a capture', () => {
    expect(
      select(`
test('takes a screenshot', async ({ page }) => { await page.screenshot(); });
test('shoots', async ({ page }) => { await shoot(page, 'x'); });
`),
    ).toEqual(['tests/e2e/case.spec.ts:3']);
  });

  // `page.once` is a Playwright method: a property call is a capture only by
  // the name `shoot`, never by sharing a name with a capturing helper.
  it("never mistakes a method sharing a capturing helper's name for the helper", () => {
    expect(
      select(`
const once = async (page) => { await shoot(page, 'x'); };
test('listens once', async ({ page }) => { page.once('load', () => {}); });
test('shoots once', async ({ page }) => { await once(page); });
`),
    ).toEqual(['tests/e2e/case.spec.ts:4']);
  });
});
