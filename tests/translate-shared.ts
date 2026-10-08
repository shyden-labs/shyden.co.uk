import { en } from '../src/lib/i18n/en';
import { siteEn } from '../src/lib/i18n/site';
import { CSV_LOCALES } from '../src/lib/csv-locale';
import { stringLeaves } from '../src/lib/catalogue-leaves';
import { translationUnits } from '../src/lib/i18n/translate';

/**
 * #21 Stage 5. The DeepL harness, minus the network.
 *
 * Built before it was run (operator instruction, 2026-09-09): the logic,
 * unit-tested, so that when #22 ran it for zh, vi and th the decisions had
 * already been reviewed: which host the key routes to, what DeepL calls each
 * language, and which strings must never be sent at all.
 *
 * Pure, exactly as CLAUDE.md requires of `gloryPoints.ts` and `grouping.ts`:
 * `scripts/i18n-translate.mjs` only wires the I/O and the fetch. Everything
 * below can therefore be tested without a key, without a network, and without
 * spending a character of a free-tier quota.
 */

/**
 * Every distinct unit the harness sends -- from all three catalogues, not
 * just `en`, and each message as the sentences it can say (#136).
 *
 * Walked here rather than imported from the script, so this does not depend
 * on the thing it checks. Scoped to `en` alone until #22, which is half of
 * why the 400 on "Registered in England & Wales." went unpredicted: the guard
 * was looking at a catalogue the offending string was not in. A hand-written
 * list of things to check misses the one that breaks -- CLAUDE.md's own words,
 * and the second time this repo has paid for it.
 */
export function collectCatalogue(): string[] {
  const units = [en, siteEn, CSV_LOCALES.en].flatMap((table) =>
    stringLeaves(table).flatMap(([, value]) => translationUnits(value)),
  );
  return [...new Set(units)];
}
