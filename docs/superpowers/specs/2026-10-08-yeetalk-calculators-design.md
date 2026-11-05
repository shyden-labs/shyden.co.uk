# YeeTalk Calculators: rename the Glory Points page and add a Gift Value calculator

Date: 2026-10-08. Operator decisions taken in session on 2026-10-08 (quoted as chosen). Facts below were read from `origin/develop` at `a8669e2`.

## 1. Intent

The Glory Points page holds one calculator: glory points in, the coins, beans and gift value needed out. The operator wants a second calculator on the same page, the same conversion run in reverse: **a gift value in, the beans the receiver gets and the coins those beans redeem for out.** With two calculators the page is no longer only the Glory Points calculator, so it is renamed. The Glory Points calculator stays exactly as it behaves today.

Success: a YeeTalk user who received (or is about to send) a gift of a known value can read off, in their own language and number format, the whole beans it yields and the whole coins those beans redeem for, and nobody's existing link to `/glory-points` breaks.

## 2. Decisions (operator, 2026-10-08)

| Question | Chosen |
| --- | --- |
| Rates | "Same as formula": a gift yields 40% of its value in beans; one bean redeems for 0.9 coins. 1,000 gift value gives 400 beans gives 360 coins. These are the rates `src/lib/gloryPoints.ts` already uses (`GIFT_BEAN_RATE = 0.4`, `COINS_PER_BEAN = 0.9`). |
| Rounding | "Round down": whole beans, then whole coins from those whole beans. 999 gives 399 beans (399.6 floored) gives 359 coins (359.1 floored). |
| Page name and address | "YeeTalk Calculators" at `/yeetalk-calculators`, in all five locales (`/`, `/id/`, `/zh/`, `/vi/`, `/th/`). |
| Layout | "Stacked sections": Glory Points first, Gift Value second, jump links at the top. |
| Redirect | "Site's own code": the old address answers 301 from the Cloudflare Pages middleware, beside the existing `www` redirect, with its logic unit-tested in `functions/_lib/`. |

## 3. Behaviour

### 3.1 Gift Value calculator

- Input: the gift value, a whole number. Validation is the Glory calculator's, unchanged: blank, not a whole number, zero and above 1,000,000,000 give the same four messages (`ERRORS` in `gloryPoints.ts`, localised through `t.errors`).
- `beans = floor(giftValue x 2 / 5)`; `coins = floor(beans x 9 / 10)`.
- Written in whole-number arithmetic (`2/5`, `9/10`), not `giftValue * 0.4`. Measured 2026-10-08: the decimal form floors correctly for every input 1 to 40,000,000, but only because the stored doubles for 0.4 and 0.9 sit a hair ABOVE their true values, so a product never lands below a whole number. That is a property of two particular constants, and it would silently break for a rate whose double sits below (0.7: measured, `floor(g * 0.7)` is wrong for 18,719 of the inputs 1 to 1,000,000, the first at 90, where `90 * 0.7` gives 62.99999999999999). `2g` and `9b` are exact integers below 2^53 across the whole accepted range (at most 2e9 and 3.6e9), and an IEEE division of two exact integers is correctly rounded, so the floor is exact for any rate written as a fraction. A comment says so, beside the cap, as `gloryPoints.ts` already does for its own direction.
- Small gifts are honest: 1 and 2 give 0 beans and 0 coins; 3 gives 1 bean and 0 coins; 5 gives 2 beans and 1 coin.
- Result line, localised and grouped in the reader's number convention (`formatNumber`): `1,000 gift value → 400 beans → 360 coins`, mirroring the Glory result's arrow chain.
- It reads the same two rate constants as the Glory calculator, from one home (§4.1). Whatever rounding each direction uses, the rates cannot drift apart.

### 3.2 Glory Points calculator

Unchanged in behaviour, input ids, result and errors. Its section gains a heading (it currently borrows the page's `<h1>`).

### 3.3 The page

- `<h1>` "YeeTalk Calculators"; the lead sentence names both calculators; the "For YeeTalk" link stays at the top.
- Jump links under the lead: "Glory Points Calculator" (`#glory-points`) and "Gift Value Calculator" (`#gift-value`). The section ids are part of the contract because the redirect (3.4) lands on one.
- Each calculator is its own `<section>` with an `<h2>`, its own short how-to list, its card and its own rate note. The Glory section keeps today's how-to steps; the Gift Value section gets its own three.
- The page still ships exactly the inline theme script plus its own one script (CLAUDE.md: every page ships its own scripts only; pinned by `theme-script.spec.ts`).
- The homepage card is retitled and its body mentions both calculators.

### 3.4 The old address

`/glory-points` and `/<locale>/glory-points` for every prefixed locale, with or without a trailing slash, answer `301` with `Location: /yeetalk-calculators#glory-points` (locale prefix kept, query string kept), so an old bookmark lands on the calculator it was for. Any other path is untouched. It runs on prod and dev alike, before the dev auth gate (like the `www` redirect), since a redirect reveals nothing the new public page does not.

## 4. Structure

### 4.1 Units

| Unit | Does | Depends on |
| --- | --- | --- |
| `src/lib/yeetalkRates.ts` (new) | Exports `GIFT_BEAN_RATE` and `COINS_PER_BEAN`, their whole-number forms (`2/5`, `9/10`), and the shared input validation (`parseWholeAmount`: the four errors and the 1e9 cap) that both calculators run. | nothing |
| `src/lib/gloryPoints.ts` | `calculateGlory`, now importing rates and validation from `yeetalkRates.ts`; `ERRORS` and `formatNumber` keep their exports so no caller changes. | `yeetalkRates.ts`, i18n metadata |
| `src/lib/giftValue.ts` (new) | `calculateGiftValue(raw): { ok: true, result: { giftValue, beans, coins } } \| { ok: false, error }`. Pure. | `yeetalkRates.ts` |
| `src/components/pages/YeetalkCalculatorsPage.astro` (renamed from `GloryPointsPage.astro`) | Markup and scoped style for both sections. | i18n |
| `src/scripts/yeetalk-calculators.ts` (renamed from `glory-points.ts`) | Wires both forms to their logic; the existing error-localising map is shared by both. | the two libs, i18n |
| `src/pages/yeetalk-calculators.astro`, `src/pages/[locale]/yeetalk-calculators.astro` (renamed) | Routes. | the page |
| `functions/_lib/lockdown.js` | New pure `legacyPathRedirectLocation(url)`, beside `wwwRedirectLocation`. | a written-out prefixed-locale list (this file runs as plain JS and cannot import `src/lib/i18n`, the same seam `astro.config.mjs` has), asserted equal to `PREFIXED_LOCALES` by a unit test |
| `functions/_middleware.js` | Calls it right after the `www` check. | the above |

The catalogue key `glory` in `site.ts` becomes `calculators`, holding the page copy plus two nested blocks, `glory` and `gift`, each with its heading, how-to, label, result line and rate note. The four error strings stay shared.

### 4.2 Copy (English, approved as written by the operator 2026-10-08)

- title: `YeeTalk Calculators — Shyden`
- description: `Work out YeeTalk glory points, coins, beans and gift value — instantly, in your browser.`
- heading: `YeeTalk Calculators`
- lead: `Two companion tools for YeeTalk's in-app gifting, built by Shyden. Work out what it takes to reach a glory points target, or what a gift is worth once it's received.`
- Glory section heading: `Glory Points Calculator` (its how-to, label, result line and rate note unchanged).
- Gift section heading: `Gift Value Calculator`
- Gift how-to: `Enter the value of the gift in the box below.` / `Select Calculate — or press Enter.` / `Read off the beans the gift gives and the coins those beans redeem for.`
- Gift input label: `Gift value`
- Gift result line: `{gift} gift value → {beans} beans → {coins} coins`
- Gift rate note: `Assumes gifts convert to beans at 40% and each bean redeems for 0.9 coins, rounded down to whole beans and coins.`
- Homepage card title `YeeTalk Calculators`; body `Work out the coins, beans and gift value behind a YeeTalk glory points target, or what a gift gives once it's received.`; button `Open the calculator` becomes `Open the calculators`.

id, zh, vi and th are drafted through DeepL (operator rule, always) and each read back by the pinned LibreTranslate engine before they are shown or committed. Every label of three words or fewer (`Gift value`, the two section headings, `YeeTalk Calculators`) is checked separately per `label-check.test.ts` / `verified-labels.test.ts`. "YeeTalk" stays untranslated.

## 5. Testing (written first)

- **Unit, `giftValue.test.ts`**: one test per case (repo meta-guard): 1→0→0, 2→0→0, 3→1→0, 5→2→1, 999→399→359, 1000→400→360, 1,000,000,000→400,000,000→360,000,000, and the four errors. An exactness test per case set against a `BigInt` computation of the same floors, over the boundary values and multiples of 5 and 10 near the cap (generated as separate tests). Run RED against a throwing stub first.
- **Unit, `yeetalkRates.test.ts`**: the rates pinned as literals (never against the constant they come from); the whole-number forms equal the decimal ones.
- **Unit, `gloryPoints.test.ts`**: unchanged and green, proving the refactor moved nothing.
- **Unit, `lockdown.test.ts`**: the redirect per locale and per slash form (generated), query kept, fragment set, non-matching paths (`/glory-pointsX`, `/id/glory-points/extra`, `/yeetalk-calculators`) return null; the written-out locale list equals `PREFIXED_LOCALES`. Mutation-verified in both directions.
- **e2e**: the existing `glory-points.spec.ts` and `glory-points-locale.spec.ts` move to the new path; a new `gift-value.spec.ts` (and locale spec) drives the new card on every engine: result text visible, errors visible, number grouping per locale, no horizontal scroll at 320 px, 44 px targets, and containment within the card (CLAUDE.md, page-level `scrollWidth` is not containment). Jump links scroll to their sections.
- **Registries that key by path** (`tests/site-pages.ts` `HEADING_FOR` and `TITLE_FOR`, `approved-copy.spec.ts`, the visual baselines): updated; `pageNames()` is derived from the filesystem so the rename reaches every deploy gate by itself. The list of files to touch is derived with `git grep -il glory` at implementation time (59 non-doc files at `a8669e2`), never written out here.
- **Deployed-only**: dev and prod sanity each gain a `@deployed-only` test that `/glory-points` (and one prefixed locale) answers 301 to the new address, since a preview of `dist/` runs no Pages Function.
- **Visual**: baselines for the renamed page re-captured in the pinned container (`npm run test:visual:update`), reviewed as a diff in the PR.
- Locally only the specs that visit the changed pages run; the full browser suite runs in CI.

## 6. Delivery

Two stories, each on its own branch into `develop`, each with acceptance criteria and an estimate before code:

1. **#635, Rename the page to YeeTalk Calculators, with the 301 from `/glory-points`** (estimate 8) (routes, component, script, catalogue key, homepage card, registries, the middleware redirect and its tests, visual baselines). No behaviour change to the calculator.
2. **#636, Add the Gift Value calculator** (estimate 5) (shared rates module, `giftValue.ts`, the second section, copy in five locales with read-back, its unit and e2e specs).

Story 1 lands first so story 2 adds a section to a page that already has its final name and shape.

## 7. Out of scope

- Any change to the Glory calculator's rounding or limits.
- Rates that vary by gift type, VIP level or event: the operator confirmed one fixed rate pair.
- Renaming files or ids that do not carry the page's name (e.g. `#glory-input` stays).
