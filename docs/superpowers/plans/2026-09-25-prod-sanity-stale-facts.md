# #338 — prod-sanity's three stale facts

Branch `338-prod-sanity-stale-facts`, from `develop` at `73aeafaccdf244bbffe32bbb95ea36fc47e950b7`.

## What is wrong, measured

`tests/prod/prod-sanity.spec.ts` runs only in `deploy-prod.yml`, after a production merge. Against a production build of `develop`, three of its 21 tests fail on a correct page:

| Test                                                          | Reads                                          | Why it is stale                                                                                                                                  |
| ------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| _the homepage renders, and its stylesheet actually applied_   | `getComputedStyle(document.body).backgroundColor` | Aurora paints the ground on `html` (`tokens.css:238`, `html { background: var(--bg) }`), so `body` is transparent on every correct deploy.    |
| _the Glory Points calculator computes, not just loads_        | `#glory-error` `toBeHidden()`                    | `.error` carries `min-height: 1.5rem` (`GloryPointsPage.astro:146`), reserving its line so the layout does not jump. Empty, it is still a visible box. |
| _the outbound ShyTalk link points at PROD ShyTalk, never dev_  | the first `a[href*="shytalk"]`                    | The first match is now the header's in-page anchor `/#shytalk`, so it fails before it reads an outbound link.                                   |

## Design

1. **Stylesheet.** Read `getComputedStyle(document.documentElement).backgroundColor`. Unstyled, the root's background is `rgba(0, 0, 0, 0)`; styled, it is `--bg` in either theme. The comment says where the ground is painted and why `body` is the wrong element.
2. **Glory Points.** The handler (`src/scripts/glory-points.ts:33`) fills exactly one of `#glory-result` and `#glory-error`. The test waits for that answer, whichever it is, and asserts the no-error invariant FIRST, so it runs even when the calculation fails (the proxy-before-invariant lesson from PR #156). "No error shown" is `toHaveText('')`: an empty box shows no error whether or not it takes space, and a box holding text shows one. Then the result is visible and not empty.
3. **ShyTalk.** One home for "which ShyTalk links leave this site": `tests/shytalk-links.ts` exports `outboundShyTalkHosts(page)`. It resolves every `a[href]` against the page (`el.href`), keeps those whose resolved HOST names ShyTalk, and returns those hosts. The host is what makes a ShyTalk link outbound: `/#shytalk` resolves to the site's own host, which never names ShyTalk, while the attribute-substring selector it replaces matched the fragment. No separate origin filter: with the host test in place it could never change the answer, and a branch no mutation can observe is dead (memory `plan-a-mutation-per-branch`). Prod asserts every one is `shytalk.shyden.co.uk`; dev-sanity (AC3, the one sibling that exists) moves onto the same helper and asserts `dev.shytalk.shyden.co.uk`. Both keep `searched()` as the liveness control, since both assertions are absences. This also widens dev's reach: its selector `a[href*="shytalk.shyden.co.uk"]` could not see a leak to any other ShyTalk host.

AC3's other two facts have no sibling in `dev-sanity.spec.ts`: dev's homepage test reads no background, and its Glory Points test only loads the page. Nothing to correct there, and the pull request says so.

## Tasks

1. **Red baseline.** `npm run build` (no `PUBLIC_SHYTALK_URL`), `npx astro preview --port 4399`, then `WEB_BASE_URL=http://localhost:4399 npx playwright test -c playwright.prod.config.ts --retries=0`. Prediction: 18 passed, 3 failed, and the three are the tests above.
2. **Implement** the three changes and the helper. `npx prettier --write` the touched files.
3. **Green.** The same run: 21 passed. Also `npm run test:unit` and `npm run typecheck` (the helper is new; `duplication.test.ts` pairs prod-sanity's anonymous functions, so a moved line may move a pair).
4. **Mutations, each run whole and predicted first** (committed at the green gate before any):
   - M1: strip every `<link rel="stylesheet">` and `<style>` from `dist/index.html` → the stylesheet test RED, naming `rgba(0, 0, 0, 0)`.
   - M2: the test's input `1000` → `abc` → the Glory test RED on the error text, not on the result.
   - M3: rebuild with `PUBLIC_SHYTALK_URL=https://dev.shytalk.shyden.co.uk` → the ShyTalk test RED, naming the dev host.
   - M4: the helper matches the `href` ATTRIBUTE for `shytalk` instead of the resolved host (the old selection) → prod's ShyTalk test RED naming `localhost:4399`, proving the host test is what keeps the in-page anchor out.
   - M5: the helper returns `[]` → the ShyTalk test RED on the `searched` liveness control.
   - Restore, rebuild, confirm 21 passed.
   Dev-sanity cannot be run locally in full (memory `a-local-dev-suite-cannot-pass-the-function-tests`), so its ShyTalk test runs alone against the same preview with `-g`, once green on a dev-URL build and once red on the prod-URL build.
5. **Grep** `tests/dev`, `tests/prod` and `tests/device` for `body).backgroundColor`, `glory-error` and `href*="shytalk` to confirm no other copy of a stale fact survives.
6. **PR** into `develop` with the runs and the mutation table, `Refs #338`. After CI is green by name on the head: merge with a merge commit, read `dev-verified` off the merge commit, close #338, move its card to Done.

## Review log

- **Pass 1** (checked: every cited path and line against the tree, `build`/`typecheck`/`test:unit` in `package.json`, the `/#shytalk` anchor at `Header.astro:24`, `playwright.dev.config.ts` running without `DEV_BASIC_AUTH_PASSWORD`, then a full read). One finding: the planned origin filter could never change the helper's answer once the host test was in place, so M4 as written could never go red. Removed the filter; M4 now reverts to attribute matching, the selection that actually failed.

- **Pass 2** (the same mechanical checks, each mutation traced to the assertion it should redden and why, AC1-AC4 mapped to tasks, then a full read). No findings. **Approved.**
