import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { CHECKOUT } from '../scripts/checkout-path.mjs';

/**
 * A fresh scratch folder inside this checkout, for a test that hands a script
 * a path on its command line.
 *
 * A script accepts a CLI path only inside the checkout (#1275, Shyden's ruling
 * 2026-11-25), so the system temp folder is refused. The folder sits under the
 * git-ignored, prettier-ignored `.superpowers/`, and the test removes it after
 * itself as it did the temp folder.
 *
 * @param prefix names the folder, as `mkdtemp`'s prefix does
 */
export const checkoutScratch = (prefix: string): string => {
  const base = join(CHECKOUT, '.superpowers', 'scratch');
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, `${prefix}-`));
};
