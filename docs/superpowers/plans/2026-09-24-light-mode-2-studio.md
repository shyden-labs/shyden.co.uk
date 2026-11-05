# Light mode, PR 2 of 2: Studio beside Aurora (#142) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans, inline in the main session (Native, the operator's choice on 2026-09-24). Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** approved, 2026-09-25, on review pass 5, the first pass that found nothing. Passes are logged in the Review log at the end.

**Goal:** Give the site a light identity, Studio, beside the dark one it has, Aurora, switchable in one press from the header, persisted, and following the device until the visitor chooses.

**Architecture:** Studio's values move onto bare `:root`, and Aurora's into two screen-only blocks found by their `color-scheme: dark`, so the whole site changes theme through tokens alone. One inline classic script in every `<head>` (`src/scripts/theme.inline.js`, emitted by `BaseLayout.astro`) stamps a saved choice before the first paint, reveals the switch, and handles its presses by delegation. The switch is a toggle button grouped with the language switcher. The palette model in `tests/palette.ts` reads both themes, so the contrast suite, the per-theme browser runs (each of which first proves the theme it rendered) and the visual suite's 24 baselines all measure both palettes.

**Tech Stack:** Astro 7, CSS custom properties, one inline classic script (no bundle, no request), Vitest, Playwright (five engines, the `content` project, and `visual` in the pinned `linux/amd64` container), the real-device gauntlet (Android Chrome over CDP, iOS Safari over WebDriver), TypeScript with `checkJs`.

**Spec:** `docs/superpowers/specs/2026-09-23-light-mode-design.md`. This plan covers §11 step 3: everything §3 to §8 asks for that PR 1 (#337, merged as `3640af2`) did not do. PR 1's plan is `docs/superpowers/plans/2026-09-24-light-mode-1-groundwork.md`, and this plan builds on the code it left.

## Global Constraints

- **Aurora's values do not change** (§3.1, AC1). The dark set of 12 baselines keeps its file names and differs from today's only in the header, where the switch now sits (§6.5, AC12).
- **Studio's values are §3.1's, exactly:**

  | token | Studio | Aurora |
  | --- | --- | --- |
  | `--bg` | `#eef1f4` | `#04070d` |
  | `--surface` | `#ffffff` | `#070d16` |
  | `--ink` | `#111821` | `#eaf2ff` |
  | `--ink-soft` | `#4d5866` | `#8fa6c6` |
  | `--disabled-fill` | `#dde2e8` | `#2a323f` |
  | `--accent` | `#006652` | `#38f5c8` |
  | `--accent-ink` | `#004d3e` | `#7fffe0` |
  | `--on-accent` | `#ffffff` | `#04140f` |
  | `--danger` | `#b42318` | `#ff6b5a` |
  | `--border` | `rgb(17 24 33 / 0.1)` | `rgb(255 255 255 / 0.11)` |
  | `--border-strong` | `rgb(17 24 33 / 0.55)` | `rgb(255 255 255 / 0.4)` |
  | `--glass` | `rgb(17 24 33 / 0.05)` | `rgb(255 255 255 / 0.055)` |
  | `--accent-glow` | `transparent` | `rgb(56 245 200 / 0.3)` |
  | `--dock-shadow` | `rgb(17 24 33 / 0.14)` | `rgb(0 0 0 / 0.55)` |
  | `--lift-shadow` | `rgb(17 24 33 / 0.18)` | `rgb(0 0 0 / 0.55)` |
  | `--pool-top-left` | `rgb(255 255 255 / 0.7)` | `rgb(56 245 200 / 0.08)` |
  | `--pool-top-right` | `rgb(60 80 110 / 0.045)` | `rgb(122 92 255 / 0.1)` |
  | `--pool-foot` | `rgb(30 45 65 / 0.055)` | `rgb(24 74 110 / 0.14)` |
  | `--shaft` | `rgb(255 255 255 / 0.35)` | `rgb(255 255 255 / 0.05)` |
  | `--wordmark-tile` | `#0f0d15` | `transparent` |
  | `--wordmark-pad` | `0.12em 0.42em 0.18em` | `0` |
  | `--switch-moon` | `inline-block` | `none` |
  | `--switch-sun` | `none` | `inline-block` |

  `color-scheme` is `light` on bare `:root` and `dark` in every dark block; `--switch-display` is `none` on bare `:root` and `inline-flex` under `:root[data-theme-switch]` (§4).
- **Exactly one inline theme script:** classic, inline and blocking in `<head>`, straight after the viewport `<meta>`, identical to `src/scripts/theme.inline.js`. No bundle, no network request, no cookie. It writes one `localStorage` key, `theme`, only when the switch is pressed, and only the values `light` and `dark` (§2, §5).
- **An explicit choice wins in both directions; with none, the page follows `prefers-color-scheme`, live** (§2, §4, AC2).
- **The switch** is one 44 × 44 `<button type="button">` in the header, grouped with the language switcher and before it, at every width. It is a toggle button named by the locale's `themeDarkMode` ("Dark mode" in English), with `aria-pressed="true"` when dark and no `aria-pressed` until the script adds it. It shows a moon in light and a sun in dark, draws in `currentColor` from `--ink`, has a visible focus ring, switches instantly, and does not print (§5, AC3).
- **Every guard that discovers its population asserts it with `searched()`,** and every new or rewritten guard is watched failing, then passing (§6.8, CLAUDE.md).
- **No new npm dependency** (CLAUDE.md).
- **Commit messages, the PR body and every comment say `Refs #142`,** never a closing keyword beside an issue number (CLAUDE.md).
- **Merge into `develop` with a merge commit, on a comprehensive self-review:** every check green, read by name on the head being merged; the Task 12 mutation table; a full read of the diff; a grep of `tests/dev`, `tests/prod` and `tests/device` for every changed fact. Production stays the operator's (operator, 2026-09-24).
- **The visual suite runs only in the pinned container,** and nothing else runs beside a container run. Never raise Playwright's worker count (CLAUDE.md, standing rules).

## Where this plan settles what the spec leaves open

1. **`themeDarkMode` lives in `site.ts`, typed by `SiteStrings`,** not in the tool catalogue `Catalogue` that §8 names. The switch is header chrome, and the header reads `getSiteStrings`. The effect §8 wants is the same: a locale missing the key fails `astro check`. `SITE_PAGES` in `src/lib/i18n/label-check.ts` must also name the key's page, or the build does not compile.
2. **The shipped script carries no `// @ts-check`.** `tsconfig.json` already sets `checkJs: true` (#228), which type-checks every `.js` file under `src/`, so the directive would be redundant bytes on every page. Task 12's mutation T1 proves `astro check` reads the file.
3. **`parseColour` learns `transparent`.** CSS defines it as `rgb(0 0 0 / 0)`. Studio's `--accent-glow` and Aurora's `--wordmark-tile` are both `transparent`, and a token the reader cannot parse drops out of every pair it sits in. `wcag.test.ts`'s refusal list loses `transparent` and gains a positive case (Task 1).
4. **The brand guard gains one narrow exemption.** `tests/unit/shytalk-brand.test.ts` refuses the mark's colours outside `shytalk-brand.ts`, but §3.4 deliberately puts the tile in `tokens.css` as a theme token. `tokens.css` may spell `SHYTALK_MARK.tile`, once, and nothing else of the mark, and `tokens.test.ts` holds the two equal (Task 3).
5. **The mark's contrast is scored** as two pairs at the large-text level: each tone on `--wordmark-tile` over the atmosphere, in both themes (Task 3).
6. **The palette-reading set is derived, not only §6.2's list.** It is every e2e spec that reads a computed colour. Today that adds `classroom-groups-roster.spec.ts`, `disabled-controls.spec.ts`, `locale-beta.spec.ts` and `homepage.spec.ts` to §6.2's four files. The grep that derives it is in Task 7.
7. **Most per-theme runs happen inside the test,** through `emulateTheme(page, theme)` from `tests/themes.ts`. It sets the device's scheme and then proves the theme rendered, so each run asserts its theme first, the page is set up once, and what changes is exactly what a visitor's device changes. Two cases are different. The print run with a stamped choice saves `dark` and reloads. The visual suite gives each baseline its own test, so its themes are describes.
8. **The Tab-order fact keeps one home.**
   - `chrome.spec.ts` walks Shift+Tab from the language switcher to the switch, so `tabindex="-1"` goes red there.
   - `skip-link.spec.ts` walks the header's controls, derived from the DOM.
   - `theme.spec.ts`'s keyboard test proves Enter and Space activate the switch. It focuses the switch directly, so WebKit is covered too, and its mutation is a pseudo-button that ignores the keyboard (§6.8 names the Tab walks as the observers of `tabindex="-1"`).
9. **Figures in comments are the scorer's, in paint order.** Aurora's `--ink-soft` knife edge stays 5.22:1; §3.2's table took the worse of two stacking orders, 5.05:1. Studio's figures equal the table's, because its worst subset, the two shade pools, is the same in either order (measured with the repo's own model on 2026-09-24).
10. **The real Back test runs only where an engine restores from the back-forward cache.** Playwright launches Chromium with `--disable-back-forward-cache` (read in `playwright-core`'s launch switches, 2026-09-24), so `chromium` and `mobile-chrome` skip with that reason. Measured in review pass 1: `firefox`, `webkit` and `mobile-safari` did not restore the page either, so locally the test skipped on **all five** engines. The synthetic `pageshow` case is what proves the handler, in every engine (§6.3).
11. **On iOS, the harness pins the palette by stamping `theme`**, because WebDriver cannot emulate a media feature on Safari. The privacy journey's rule "every key starts `cg-`" therefore excludes `theme` (Task 9).
12. **PR 1's two deferred minors.**
    - **(a)** The colour guard is widened to `.js` and `.mjs` (Task 4).
    - **(b)** Needs no change: nothing in PR 2 writes a CSS value into a TypeScript string, since the switch draws with `currentColor` in markup, so the documented trade-off stands.
13. **The evidence page (§6.7, AC18) is built after the merge,** from an evidence run at the merge commit, and does not gate the merge (operator, 2026-09-24).
14. **The branch continues as `142-light-mode-beside-aurora`,** fast-forwarded to `develop` at `3640af2`. `astro preview` serves `localhost`, not `127.0.0.1` (PR 1's Task 10).

## Review Focus

1. **A saved value that is not exactly `light` or `dark`**, such as an old or hand-edited `theme` of `Dark`, `auto` or `""`, is ignored. The device setting applies, nothing is stamped, `aria-pressed` follows the device, and the next press writes a valid value (Task 6).
2. **A double press** (a double-click, or a held Enter with key repeat) toggles once per press. After two presses, the page, `aria-pressed` and the saved value all agree on where it started (Task 6).
3. **An engine whose `MediaQueryList` has no `addEventListener`** (Safari 13.1, the last release without it) still switches and saves, and no error reaches the console. Only `aria-pressed`'s live follow of a device change is lost (Task 6). An engine older than Safari 13.1 cannot parse the script's `?.` and `??` at all, so it behaves as scripting off: the switch stays hidden and the device setting applies (AC7).
4. **Forced colours** (Windows High Contrast): the switch's icon stays visible, drawn in the system's own text colour, because it is `currentColor`. This runs on Chromium, the one engine that emulates `forcedColors` (Task 5).
5. **The device changes its setting while a choice is saved:** the page does not follow, because the saved choice wins, and `aria-pressed` does not flip (Task 6).

---

## Before you start

- [ ] **Confirm the base.** The branch carries this plan's own commits (the draft, its review passes and its approval) on top of `develop` at `3640af2`, so `HEAD` is never `3640af2` itself. On `142-light-mode-beside-aurora`, `git merge-base --is-ancestor 3640af27e1cab40c1af69526d556767165a51732 HEAD` must exit 0, and `git diff --stat 3640af2 HEAD` must list this plan's file and nothing else. If `develop` has moved on, `git merge origin/develop` first, then check the same diff against the new `develop` (review pass 4).
- [ ] **Take the baseline.** Run `npm run test:unit` and expect every test to pass (99 files and 2408 tests at `3640af2`). Every later run is compared with these totals.
- [ ] **Commit at every green gate, and always before mutating anything** (standing rule: `git checkout` restores `HEAD`). A bare `git status --short` always lists `HANDOVER.md`, so scope any "is the tree clean" check to a path.
- [ ] **#142's card is already In Progress** on the Shyden Site board (project 2), as PR 1 left it. Read it back with `gh issue view 142 --json projectItems`, and never write to project 1.
- [ ] **Find edits by their text, never by line number.** Every anchor below is quoted from the file as `3640af2` holds it.

## File map

| file | responsibility |
| --- | --- |
| `tests/wcag.ts`, `tests/unit/wcag.test.ts` | `parseColour` reads `transparent`. |
| `tests/palette.ts`, `tests/unit/palette.test.ts` | The palette model gains the themes: `THEMES`, `rootBlock`, `darkBlocks`, `themeTokens`, `computedForm`, `themeColour`. |
| `src/styles/tokens.css` | Studio on bare `:root`; Aurora in two screen-only dark blocks; the wordmark and switch tokens; the switch's reveal rule. |
| `tests/unit/tokens.test.ts` | The dark-block guards and the wordmark-tile guard. |
| `tests/unit/contrast.test.ts` | Every pair, pin and classification in both themes; the mark's two pairs. |
| `src/components/pages/HomePage.astro` | The ShyTalk mark on its tile. |
| `tests/unit/shytalk-brand.test.ts` | The tile's one exemption in `tokens.css`. |
| `src/scripts/theme.inline.js` (new) | The theme script, shipped as written. |
| `src/layouts/BaseLayout.astro` | Emits the script inline, after the viewport `<meta>`. |
| `src/components/ThemeSwitch.astro` (new) | The switch. |
| `src/components/Header.astro` | Groups the switch with the language switcher. |
| `src/lib/i18n/site.ts`, `src/lib/i18n/label-check.ts` | `themeDarkMode` in five locales, and its page. |
| `tests/themes.ts` (new) | `expectTheme`, `emulateTheme`, `saveTheme`, `expectTheSwitchPersists`: the per-theme browser helpers, shared by e2e, dev and prod. |
| `tests/e2e/theme-script.spec.ts` (new) | The script inventory and the static no-flash guard, on every built page (content project). |
| `tests/e2e/theme.spec.ts` (new) | The switch, rendered: §6.3 and the Review Focus. |
| `tests/e2e/theme-gallery.spec.ts` (new) | Every built page in both themes at 320 and 1280px, and the interactive states: the evidence §6.7 asks for, each capture behind an assertion. |
| `playwright.config.ts` | `theme-script.spec.ts` joins `CONTENT_ONLY_SPECS`. |
| `tests/e2e/classroom-groups.spec.ts`, `tests/unit/locale-switcher.test.ts` | The two former zero-JS guards, rewritten. |
| `README.md`, `.github/workflows/deploy-prod.yml`, `src/components/LanguageSwitcher.astro`, `tests/e2e/language-switcher.spec.ts`, `tests/e2e/recorders.ts`, `tests/unit/event-collectors.test.ts`, `tests/e2e/visual.spec.ts` (the `settle` comment) | The "zero JS" promise, restated in words, brought up to date (Task 4). |
| `tests/unit/colour-literals.test.ts` | Widened to `.js` and `.mjs`. |
| `tests/e2e/palette-controls.spec.ts`, `print-legibility.spec.ts`, `thai-typography.spec.ts`, `classroom-groups.spec.ts`, `classroom-groups-roster.spec.ts`, `disabled-controls.spec.ts`, `locale-beta.spec.ts`, `homepage.spec.ts` | The palette-reading guards, run in both themes. |
| `tests/e2e/chrome.spec.ts`, `tests/e2e/skip-link.spec.ts` | The Tab-order walks meet the switch. |
| `tests/e2e/header-room.spec.ts` | Its stand-in retires; each row must hold the real switch by name. |
| `tests/unit/isolated-context-tagging.test.ts` | A test that calls `newContext()` needs `@requires-isolated-context` too. |
| `tests/dev/dev-sanity.spec.ts`, `tests/prod/prod-sanity.spec.ts` | The switch, proven on each deployed site. |
| `tests/e2e/fixtures.ts`, `tests/device/ios/session.ts`, `tests/device/ios/journeys.journey.ts` | The phones pin the theme per run. |
| `tests/e2e/visual.spec.ts`, `tests/e2e/__screenshots__/` | 24 baselines. |
| `CLAUDE.md` | The working agreement's script line. |

---

### Task 1: The palette model reads both themes

**Files:**
- Modify: `tests/wcag.ts`, `tests/unit/wcag.test.ts`
- Modify: `tests/palette.ts`, `tests/unit/palette.test.ts`

**Interfaces:**
- Consumes: `cssRules`, `CssRule` (`tests/unit/css-rules.ts`); `parseColour` (`tests/wcag.ts`).
- Produces, in `tests/palette.ts`:
  - `THEMES: readonly ['light', 'dark']` and `type Theme = 'light' | 'dark'`;
  - `rootBlock(css: string): CssRule`;
  - `darkBlocks(css: string): CssRule[]`;
  - `themeTokens(css: string, theme: Theme): Map<string, string>`;
  - `computedForm(value: string): string`;
  - `themeColour(theme: Theme, token: string): string`.
  `rootTokens` keeps its signature.

- [ ] **Step 1: Write the failing tests.**

In `tests/unit/wcag.test.ts`, the refusal test reads:

```ts
    for (const value of ['', 'transparent', 'currentColor', '#ab', 'rgb(1,2)'])
```

Replace that line with the one below, and add the new test straight after the refusal test's closing `});`:

```ts
    for (const value of ['', 'currentColor', '#ab', 'rgb(1,2)', 'transparentish'])
```

```ts
  it('reads transparent as CSS defines it: black at zero alpha', () => {
    // #142: Studio's band glow and Aurora's wordmark tile are `transparent`,
    // and a token this reader refused would drop out of every pair it sits in.
    expect(parseColour('transparent')).toEqual({ rgb: [0, 0, 0], alpha: 0 });
    expect(parseColour(' Transparent ')).toEqual({ rgb: [0, 0, 0], alpha: 0 });
  });
```

In `tests/unit/palette.test.ts`, extend the import to

```ts
import {
  ATMOSPHERE,
  atmosphereLayers,
  computedForm,
  darkBlocks,
  rootTokens,
  subsets,
  themeTokens,
  worstContrast,
} from '../palette';
```

and append:

```ts
describe('the themes', () => {
  const css = [
    ':root {\n  color-scheme: light;\n  --bg: #eef1f4;\n  --ink: #111821;\n  --font: serif;\n}',
    "@media screen and (prefers-color-scheme: dark) {\n  :root:not([data-theme='light']) {\n    color-scheme: dark;\n    --bg: #04070d;\n    --ink: #eaf2ff;\n  }\n}",
    "@media screen {\n  :root[data-theme='dark'] {\n    color-scheme: dark;\n    --bg: #04070d;\n    --ink: #eaf2ff;\n  }\n  :root[data-theme-switch] {\n    --switch-display: inline-flex;\n  }\n}",
    '@media print {\n  :root {\n    --bg: #fff;\n  }\n}',
  ].join('\n');

  it('finds every dark block by its color-scheme, never by its selector', () => {
    expect(darkBlocks(css).map(({ chain }) => chain.join(' { '))).toEqual([
      "@media screen and (prefers-color-scheme: dark) { :root:not([data-theme='light'])",
      "@media screen { :root[data-theme='dark']",
    ]);
  });

  it('reads light from bare :root, and dark as bare :root with a dark block laid over it', () => {
    expect([...themeTokens(css, 'light')]).toEqual([
      ['--bg', '#eef1f4'],
      ['--ink', '#111821'],
      ['--font', 'serif'],
    ]);
    expect([...themeTokens(css, 'dark')]).toEqual([
      ['--bg', '#04070d'],
      ['--ink', '#eaf2ff'],
      ['--font', 'serif'],
    ]);
  });

  it('refuses a dark theme that no block declares', () => {
    expect(() => themeTokens(':root {\n  --bg: #fff;\n}', 'dark')).toThrow(
      'no block in src/styles/tokens.css declares color-scheme: dark',
    );
  });

  it('writes a colour the way getComputedStyle reports it', () => {
    expect(computedForm('#eef1f4')).toBe('rgb(238, 241, 244)');
    expect(computedForm('rgb(17 24 33 / 0.05)')).toBe('rgba(17, 24, 33, 0.05)');
    expect(computedForm('transparent')).toBe('rgba(0, 0, 0, 0)');
    expect(() => computedForm('currentColor')).toThrow('not a colour');
  });
});
```

- [ ] **Step 2: Add stubs so every new test fails on its own assertion.** A test that fails on a missing import proves nothing about the test (standing rule, #95). Add these to `tests/palette.ts`:

```ts
export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
export const darkBlocks = (_css: string): CssRule[] => {
  throw new Error('not implemented');
};
export const themeTokens = (_css: string, _theme: Theme): Map<string, string> => {
  throw new Error('not implemented');
};
export const computedForm = (_value: string): string => {
  throw new Error('not implemented');
};
```

- [ ] **Step 3: Run the tests and watch them fail.**
  - Run: `npx vitest run tests/unit/wcag.test.ts tests/unit/palette.test.ts`
  - Expected: 5 failures. 4 are the new `palette.test.ts` cases, each failing on the stub's `not implemented` in its first statement. The fifth is the new `wcag.test.ts` case, where `parseColour('transparent')` returns `null`.
  - **Every other test passes.** Note: `'transparentish'` in the refusal list is `null` both before and after this change, which is right: it is the control that keeps the new branch exact.

- [ ] **Step 4: Implement.**

In `tests/wcag.ts`, add this as the first statement after `const text = value.trim();` in `parseColour`:

```ts
  // CSS defines `transparent` as rgb(0 0 0 / 0), an exact value, not a guess.
  if (/^transparent$/i.test(text)) return { rgb: [0, 0, 0], alpha: 0 };
```

In `tests/palette.ts`, delete the Step 2 stubs. Then replace `rootTokens` and its doc comment with the block below, which redefines `THEMES` and `Theme` and adds everything else:

```ts
/** The site's two themes (#142): light on bare `:root`, dark in the blocks that declare `color-scheme: dark`. */
export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/**
 * The bare `:root` block, exactly one, found by its chain rather than by
 * coming first: the print block is `:root` one level down, and a theme block
 * is `:root` with more after it.
 */
export const rootBlock = (css: string): CssRule => {
  const roots = topLevel(css, ':root');
  if (roots.length !== 1)
    throw new Error(
      `expected one bare :root block in ${TOKENS_FILE}, found ${roots.length}`,
    );
  return roots[0];
};

/** The tokens bare `:root` declares: Studio's, the light theme. */
export const rootTokens = (css: string): Map<string, string> =>
  customProperties(rootBlock(css));

/**
 * Every block that declares `color-scheme: dark`: Aurora, written twice
 * (#142 §4). Found by that declaration rather than by selector, so a copy
 * added later is found, and compared, too.
 */
export const darkBlocks = (css: string): CssRule[] =>
  cssRules(css).filter(({ declarations }) =>
    declarations.some(
      ({ property, value }) => property === 'color-scheme' && value === 'dark',
    ),
  );

/**
 * The tokens `theme` paints. Light is bare `:root`. Dark is bare `:root` with
 * the first dark block laid over it: a dark block redefines tokens and only
 * tokens, and tokens.test.ts proves every dark block identical, so the first
 * speaks for all of them.
 */
export const themeTokens = (css: string, theme: Theme): Map<string, string> => {
  const root = rootTokens(css);
  if (theme === 'light') return root;
  const [first] = darkBlocks(css);
  if (first === undefined)
    throw new Error(`no block in ${TOKENS_FILE} declares color-scheme: dark`);
  return new Map([...root, ...customProperties(first)]);
};

/**
 * A colour in the form `getComputedStyle` reports it: `rgb(r, g, b)`, or
 * `rgba(r, g, b, a)` below full opacity. A browser assertion compares with
 * this, so the page is judged against tokens.css rather than against itself.
 */
export const computedForm = (value: string): string => {
  const colour = parseColour(value);
  if (colour === null) throw new Error(`not a colour: ${value}`);
  const [r, g, b] = colour.rgb;
  return colour.alpha === 1
    ? `rgb(${r}, ${g}, ${b})`
    : `rgba(${r}, ${g}, ${b}, ${colour.alpha})`;
};

/** `theme`'s value for a colour token, as a browser reports it (#142 §6.2). */
export const themeColour = (theme: Theme, token: string): string => {
  const value = themeTokens(tokensCss(), theme).get(token);
  if (value === undefined)
    throw new Error(`${token} is not defined in the ${theme} theme`);
  return computedForm(value);
};
```

- [ ] **Step 5: Run the tests and watch them pass.**
  - Run: `npx vitest run tests/unit/wcag.test.ts tests/unit/palette.test.ts`. Expected: every test passes.
  - Then run `npm run test:unit`. Expected: the baseline plus the 5 new tests, all passing. `tokens.css` has no dark block yet, but nothing reads the dark theme until Task 2.
  - Then run `npm run typecheck`. Expected: 0 errors, 0 warnings, 0 hints.

- [ ] **Step 6: Commit.**

```bash
npx prettier --write tests/wcag.ts tests/unit/wcag.test.ts tests/palette.ts tests/unit/palette.test.ts
npx prettier --check .
git add tests/wcag.ts tests/unit/wcag.test.ts tests/palette.ts tests/unit/palette.test.ts
git commit -m "test(unit): the palette model reads both themes

Refs #142"
```

(Every commit in this plan ends with the two attribution lines of the session's system reminder, after a blank line.)

---

### Task 2: Studio on bare `:root`, Aurora in two screen-only blocks

**Files:**
- Modify: `src/styles/tokens.css`
- Modify: `tests/unit/tokens.test.ts`, `tests/unit/contrast.test.ts`

**Interfaces:**
- Consumes: `THEMES`, `Theme`, `rootBlock`, `rootTokens`, `darkBlocks`, `themeTokens`, `customProperties`, `tokensCss` (Task 1).
- Produces: the token file every later task edits. Its anchors are the bare `:root` block, the block `@media screen and (prefers-color-scheme: dark) { :root:not([data-theme='light']) {`, the block `@media screen { :root[data-theme='dark'] {`, and the print block.

- [ ] **Step 1: Write the failing token guards.** In `tests/unit/tokens.test.ts`, replace the import of `../palette` with

```ts
import { cssRules, type CssRule } from './css-rules';
import {
  customProperties,
  darkBlocks,
  rootBlock,
  rootTokens,
  tokensCss,
} from '../palette';
```

and append:

```ts
/** A block's declarations as `property: value` lines, sorted. */
const declared = (rule: CssRule): string[] =>
  rule.declarations.map(({ property, value }) => `${property}: ${value}`).sort();

/**
 * The two themes (#142 §4). Aurora is written twice, because the unstamped
 * state needs its media query and the stamped state must not. Two copies of a
 * palette drift unless something holds them together, so every block that
 * declares `color-scheme: dark` is found by that declaration and compared.
 */
describe('the two themes (#142)', () => {
  it('declares light on bare :root', () => {
    expect(rootBlock(tokensCss()).declarations).toContainEqual({
      property: 'color-scheme',
      value: 'light',
    });
  });

  it('declares color-scheme only beside a palette', () => {
    // Compared by chain, never by identity: each reader parses afresh, so
    // the same block arrives as a different object from each of them.
    const css = tokensCss();
    const where = ({ chain }: CssRule) => chain.join(' { ');
    const palettes = new Set([rootBlock(css), ...darkBlocks(css)].map(where));
    const declaring = cssRules(css).filter(({ declarations }) =>
      declarations.some(({ property }) => property === 'color-scheme'),
    );
    const stray = declaring
      .map(where)
      .filter((chain) => !palettes.has(chain));
    expect(
      searched(stray, { of: declaring, what: 'rules declaring color-scheme' }),
    ).toEqual([]);
  });

  it('keeps every dark block screen-only, and has both states it needs', () => {
    const chains = darkBlocks(tokensCss()).map(({ chain }) =>
      chain.join(' { '),
    );
    const onPaper = chains.filter((chain) => !/^@media screen\b/.test(chain));
    expect(searched(onPaper, { of: chains, what: 'dark blocks' })).toEqual([]);
    expect(chains).toEqual(
      expect.arrayContaining([
        "@media screen and (prefers-color-scheme: dark) { :root:not([data-theme='light'])",
        "@media screen { :root[data-theme='dark']",
      ]),
    );
  });

  it('declares the same tokens, with the same values, in every dark block', () => {
    const [first, ...rest] = darkBlocks(tokensCss()).map(declared);
    const drifted = rest.flatMap((block, i) => [
      ...block
        .filter((line) => !first.includes(line))
        .map((line) => `dark block ${i + 2} adds ${line}`),
      ...first
        .filter((line) => !block.includes(line))
        .map((line) => `dark block ${i + 2} lacks ${line}`),
    ]);
    expect(
      searched(drifted, { of: rest, what: 'dark blocks after the first' }),
    ).toEqual([]);
  });

  it('defines no token only inside a dark block', () => {
    const css = tokensCss();
    const root = rootTokens(css);
    const dark = darkBlocks(css).flatMap((block) => [
      ...customProperties(block).keys(),
    ]);
    const orphans = [...new Set(dark)].filter((name) => !root.has(name));
    expect(
      searched(orphans, { of: dark, what: 'tokens the dark blocks declare' }),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Write the failing contrast suite, in both themes.** In `tests/unit/contrast.test.ts`, make these edits.
  - **The import from `../palette`** becomes:

    ```ts
    import {
      ATMOSPHERE,
      THEMES,
      TOKENS_FILE,
      atmosphereLayers,
      flatten,
      themeTokens,
      tokensCss,
      worstContrast,
      type Theme,
    } from '../palette';
    ```

  - **`colourTokens` becomes per-theme:**

    ```ts
    const colourTokens = (theme: Theme): [string, string][] =>
      nonEmpty(
        [...themeTokens(tokensCss(), theme)].filter(([, value]) =>
          isColour(value),
        ),
        `${theme} colour tokens in ${TOKENS_FILE}`,
      );
    ```

  - **Add this constant straight after `DECORATIVE`'s closing `};`:**

    ```ts
    /**
     * The disabled fill in each theme, pinned against the brief (#250, #142
     * §3.1): the level every derived guard around it is unable to assert.
     */
    const DISABLED_FILL: Record<Theme, string> = {
      light: '#dde2e8',
      dark: '#2a323f',
    };
    ```

  - **Three tests become per-theme:**
    - *every declared pair clears its required ratio*;
    - *pins the disabled fill*;
    - *every colour token is classified*.

    Wrap each in `for (const theme of THEMES) { … }` and prefix its title with `${theme}: `, so the titles read `` `${theme}: every declared pair clears its required ratio, over the worst subset of the atmosphere` ``, `` `${theme}: pins the disabled fill, and keeps it off every ground it is drawn on` `` and `` `${theme}: every colour token is classified — paired or explicitly decorative` ``.
  - **Inside those three bodies:**
    - `const from = rootTokens(css);` becomes `const from = themeTokens(css, theme);`.
    - `const from = rootTokens(tokensCss());` becomes `const from = themeTokens(tokensCss(), theme);`.
    - `expect(from.get('--disabled-fill')).toBe('#2a323f');` becomes `expect(from.get('--disabled-fill')).toBe(DISABLED_FILL[theme]);`.
    - `const all = colourTokens();` becomes `const all = colourTokens(theme);`.
    - `searched(failures, { of: PAIRS, what: 'declared colour pairs' })` becomes `searched(failures, { of: PAIRS, what: \`${theme} colour pairs\` })`.
  - **The comment above the disabled-fill test** keeps its text, except its measured example: "set the fill to `--surface`'s `#070d16`" becomes "set Aurora's fill to its `--surface`, `#070d16`".

- [ ] **Step 3: Run the new tests and watch them fail.**
  - Run: `npx vitest run tests/unit/tokens.test.ts tests/unit/contrast.test.ts`
  - Until Step 4, `tokens.css` still holds `html { color-scheme: dark }`, and `darkBlocks` finds a block by its `color-scheme: dark`. So `html` IS the one dark block at this point, and it declares no token. That decides every count below (measured in review pass 1).
  - Expected: `tokens.test.ts` fails 4 of its 5 new tests:
    - *declares light on bare :root*: no `color-scheme` on `:root`.
    - *keeps every dark block screen-only*: the failure names `html`, which sits outside any `@media screen`.
    - *declares the same tokens*: the one dark block declares none, so `rest` is empty and `searched` throws.
    - *defines no token only inside a dark block*: `searched` throws, *searched no tokens the dark blocks declare*.

    *declares color-scheme only beside a palette* passes, because `html` counts as a dark block and so as a palette. Its red is mutation U10 in Task 12.
  - `contrast.test.ts` fails 1: *light: pins the disabled fill*, because bare `:root` is still Aurora, whose `#2a323f` is not Studio's `#dde2e8`.
    - The three `dark:` tests pass: the dark theme resolves to bare `:root` (Aurora) plus `html`'s zero tokens.
    - The other two `light:` tests pass, because bare `:root` is Aurora and Aurora clears.
  - Expected total: **5 red**.

- [ ] **Step 4: Rewrite the head of `tokens.css`.** Replace everything from the file's first line down to and including the closing `}` of the bare `:root` block (the line after `--maxw: 1120px;`) with:

```css
/* src/styles/tokens.css — design tokens (see spec §4).
   Two identities share one set of token NAMES (#142). Studio, the light one,
   is defined on bare :root. Aurora (#17), the dark one, redefines the same
   tokens, and only the tokens, in the two screen-only blocks below it. Every
   value is derived against the ground it sits on and ASSERTED, in both
   themes, in tests/unit/contrast.test.ts — a comment claiming a ratio is not
   a control, which is how a 1.17:1 control boundary shipped to production
   (#133). */
@import '@fontsource-variable/bricolage-grotesque';
@import '@fontsource-variable/instrument-sans';
@import '@fontsource/space-mono/400.css';
@import '@fontsource/space-mono/700.css';

/* Studio: depth, not colour. A cool grey ground, pure white cards that sit
   forward of it, window light at the top left and cool shade falling off to
   the right and below. Its one colour is the brand green; everything else it
   paints is light and shade. `color-scheme` travels with the palette, so the
   browser draws its own controls for the ground they sit on. */
:root {
  color-scheme: light;

  --bg: #eef1f4;
  --surface: #ffffff;
  --ink: #111821;
  --ink-soft: #4d5866;

  /* A control that cannot be used right now (#250): an opaque fill, so the
     label's ratio is fixed and checkable. --ink-soft on it is 5.55:1. */
  --disabled-fill: #dde2e8;

  --accent: #006652;
  --accent-ink: #004d3e;
  --on-accent: #ffffff;
  --danger: #b42318;

  /* The ink at low alpha, judged OVER its ground. --border is decorative
     only. --border-strong draws every control boundary (WCAG 1.4.11): 3.63:1
     over the atmosphere at its worst subset, 3.83:1 on --bg and 3.97:1 on
     --surface. */
  --border: rgb(17 24 33 / 0.1);
  --border-strong: rgb(17 24 33 / 0.55);
  /* A faint ink tint, not white: white glass on a white card has no fill.
     The work-card badge's accent text reads 6.27:1 on it. */
  --glass: rgb(17 24 33 / 0.05);

  /* A glow reads as light only against darkness. On this ground the band's
     clipped glow painted a flat grey box, so there is none (#142 §3.3). */
  --accent-glow: transparent;
  /* Shadows in the ink's own hue, softer than Aurora's black. Nothing is read
     against them. */
  --dock-shadow: rgb(17 24 33 / 0.14);
  --lift-shadow: rgb(17 24 33 / 0.18);

  /* The atmosphere, painted on body::before: window light at the top left,
     cool shade at the top right and at the foot, and a bright shaft. Here
     the light layers brighten the ground under dark ink while the shade
     darkens it, so every layer at once is NOT the worst case: the two shade
     pools alone are, and --accent over them, 5.19:1, is Studio's tightest
     text pair. contrast.test.ts scores every subset, in both themes. */
  --pool-top-left: rgb(255 255 255 / 0.7);
  --pool-top-right: rgb(60 80 110 / 0.045);
  --pool-foot: rgb(30 45 65 / 0.055);
  --shaft: rgb(255 255 255 / 0.35);

  --font-head: 'Bricolage Grotesque Variable', system-ui, sans-serif;
  --font-body: 'Instrument Sans Variable', system-ui, sans-serif;
  --font-mono: 'Space Mono', ui-monospace, monospace;
  --measure: 66ch;
  --radius: 10px;
  --space: clamp(1rem, 0.6rem + 2vw, 2rem);
  --maxw: 1120px;
}

/* Aurora (#17), the dark identity, exactly as it shipped: the same tokens,
   redefined. Written TWICE (#142 §4). The unstamped state needs the media
   query, so a visitor with no saved choice follows the device, live, with no
   script involved. The stamped state must not have it, so a saved `dark`
   wins on a light device; and `:not([data-theme='light'])` lets a saved
   `light` win on a dark one.

   Both copies are screen-only, and that is load-bearing for print. Their
   selectors outrank the print block's bare :root, so on paper they would put
   Aurora's near-white ink on white paper: the blank sheet of 2026-09-11.
   tests/unit/tokens.test.ts finds every block that declares
   `color-scheme: dark`, keeps each screen-only, and proves them identical. */
@media screen and (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    color-scheme: dark;

    /* Ground and ink. --surface is only 1.04:1 against --bg, so a card is
       identified by its EDGE, not by its fill — which is why the border
       tokens below carry more weight here than on a light palette. */
    --bg: #04070d;
    --surface: #070d16;
    --ink: #eaf2ff;
    --ink-soft: #8fa6c6;

    /* A control that cannot be used right now (#250). An opaque FILL, never
       the `opacity: 0.6` this replaced: opacity composites the whole
       subtree, control AND label, with whatever happens to be behind it, so
       the label's ratio depends on the page atmosphere at that spot --
       measured at roughly 2.67:1 for --ink-soft, well under AA, in
       ClassroomGroupsPage.astro's own note. Opaque, the ratio is fixed and
       checkable: --ink-soft on this is 5.19:1, and --ink 11.46:1. 1.51:1
       against --surface and 1.56:1 against --bg, so the control still reads
       as a control on the card; WCAG 1.4.11 exempts an inactive component
       from the 3:1 boundary, and the reason paragraph beside it is what
       carries the state without colour (AC6). */
    --disabled-fill: #2a323f;

    /* Brand. --on-accent is the ink for anything sitting ON mint: white
       scores 1.39:1 there, so a filled button labelled #fff would be
       unreadable. */
    --accent: #38f5c8;
    --accent-ink: #7fffe0;
    --on-accent: #04140f;

    /* #c0392b was tuned for a near-white page and scores 3.71:1 on this
       ground — below the 4.5:1 body floor. The artifact never specified an
       error colour; the roles a design does not mention are the ones with
       nobody checking. */
    --danger: #ff6b5a;

    /* Borders, composited: alphas are judged OVER their ground, never raw.
       --border at .11 is 1.27:1 and is decorative only. Aurora's own
       --line-2 at .18 was 1.61:1.

       Control boundaries need 3:1 (WCAG 1.4.11). White reached that at alpha
       .35 while the page ground was FLAT — 3.10:1 on --bg, 3.17:1 on
       --surface. The atmosphere lightens the ground beneath a control, and
       at .35 the boundary drops to 2.96:1 there: a 1.4.11 failure introduced
       by a change three declarations away that touched no border at all. At
       .40 it is 3.44:1 over the atmosphere at its worst subset, 3.72:1 on
       --bg and 3.79:1 on --surface. */
    --border: rgb(255 255 255 / 0.11);
    --border-strong: rgb(255 255 255 / 0.4);
    --glass: rgb(255 255 255 / 0.055);

    /* The mint bloom behind the marquee band. Decorative: it is a shadow, so
       nothing is ever read against it and 1.4.11 does not reach it. */
    --accent-glow: rgb(56 245 200 / 0.3);

    /* The shadow the pinned action row on /classroom-groups casts UP over
       whatever scrolls beneath it (#188). Decorative: it separates a docked
       bar from the content passing under it, and nothing is read against it
       by design, because scroll-padding keeps a focused field clear of the
       row. */
    --dock-shadow: rgb(0 0 0 / 0.55);

    /* The phone mockup's shadow (PhoneFrame.astro). Decorative, like the dock
       shadow above: nothing is read against it. This is the value the frame
       hard-coded before it became a token (#142). */
    --lift-shadow: rgb(0 0 0 / 0.55);

    /* The atmosphere: mint at the top left, violet at the top right, deep
       blue at the foot, and a faint white shaft. Every layer lightens a
       near-black ground under light ink, so here the worst subset IS every
       layer at once: --ink-soft reads 5.22:1 over it, the knife edge. The
       hand-written stack this replaced put the shaft on top, where the
       browser never paints it, and read 5.05:1. */
    --pool-top-left: rgb(56 245 200 / 0.08);
    --pool-top-right: rgb(122 92 255 / 0.1);
    --pool-foot: rgb(24 74 110 / 0.14);
    --shaft: rgb(255 255 255 / 0.05);
  }
}

@media screen {
  /* The second copy: a saved `dark` choice, whatever the device prefers.
     Every declaration mirrors the block above, whose comments give the
     reasons; tokens.test.ts keeps the two identical. */
  :root[data-theme='dark'] {
    color-scheme: dark;
    --bg: #04070d;
    --surface: #070d16;
    --ink: #eaf2ff;
    --ink-soft: #8fa6c6;
    --disabled-fill: #2a323f;
    --accent: #38f5c8;
    --accent-ink: #7fffe0;
    --on-accent: #04140f;
    --danger: #ff6b5a;
    --border: rgb(255 255 255 / 0.11);
    --border-strong: rgb(255 255 255 / 0.4);
    --glass: rgb(255 255 255 / 0.055);
    --accent-glow: rgb(56 245 200 / 0.3);
    --dock-shadow: rgb(0 0 0 / 0.55);
    --lift-shadow: rgb(0 0 0 / 0.55);
    --pool-top-left: rgb(56 245 200 / 0.08);
    --pool-top-right: rgb(122 92 255 / 0.1);
    --pool-foot: rgb(24 74 110 / 0.14);
    --shaft: rgb(255 255 255 / 0.05);
  }
}
```

Then, in the `html` rule, delete the line `color-scheme: dark;` and replace the comment above `accent-color` with:

```css
  /* Checkboxes and radios are drawn by the browser, and `auto` means it picks
     its own blue — measured as the selected state on /classroom-groups, the
     one brand colour on the page that was not ours. `color-scheme`, declared
     with each palette above, fixes their GROUND but says nothing about the
     fill. The UA derives the tick's own colour from this, so it stays legible
     on the accent. */
```

The comment above `body::before` becomes, whole. Its old wording "the aurora is the light in the room" breaks across two lines, so it cannot be matched as one string (review pass 1):

```css
/* One fixed layer behind everything. Fixed, not absolute: the atmosphere is
   the light in the room rather than part of the document, so it does not
   scroll away and it paints exactly once however long the page is.

   The ground sits on `html`, not `body`: at z-index -1 this layer would
   otherwise paint BEHIND the body's own background and never be seen.

   The same layer paints both themes (#142); only its tokens change, so the
   geometry #141 measured the paint cost of stands.

   Zero JavaScript, and `prefers-reduced-motion` needs no rule here because
   nothing moves — it is a still gradient, not an animation. */
```

- [ ] **Step 5: Run the tests and watch them pass.**
  - Run: `npx vitest run tests/unit/tokens.test.ts tests/unit/contrast.test.ts tests/unit/palette.test.ts`. Expected: every test passes. The `light:` pair test now scores Studio, whose worst pair is `--accent` over `[--pool-top-right, --pool-foot]` at 5.19:1.
  - Then run `npm run test:unit`. Expected: every test passes, **including `literal-grounds`, `colour-literals` and `tokens`' "declares no token that nothing reads"**, since no token was added or removed.
  - Then run `npm run typecheck`. Expected: 0/0/0.

- [ ] **Step 6: Format, check, commit.** The code above is not all in prettier's shape (review pass 1: `tokens.test.ts`' `declared` runs to 81 columns, and the three wrapped tests need re-indenting), so write before checking.

```bash
npx prettier --write src/styles/tokens.css tests/unit/tokens.test.ts tests/unit/contrast.test.ts
npx prettier --check .
git add src/styles/tokens.css tests/unit/tokens.test.ts tests/unit/contrast.test.ts
git commit -m "feat(tokens): Studio on bare :root, Aurora in two screen-only blocks

Refs #142"
```

---

### Task 3: The ShyTalk mark on its own tile

**Files:**
- Modify: `src/styles/tokens.css`, `src/components/pages/HomePage.astro`
- Modify: `tests/unit/tokens.test.ts`, `tests/unit/shytalk-brand.test.ts`, `tests/unit/contrast.test.ts`

**Interfaces:**
- Consumes: `themeTokens`, `tokensCss` (Task 1); the dark blocks (Task 2); `SHYTALK_MARK` (`src/lib/shytalk-brand.ts`).
- Produces: `--wordmark-tile` and `--wordmark-pad` in every palette block and the print block.

- [ ] **Step 1: Write the failing tile guard.** In `tests/unit/tokens.test.ts`, add `themeTokens` to the `../palette` import, add `import { SHYTALK_MARK } from '../../src/lib/shytalk-brand';`, and append inside `describe('the two themes (#142)', …)`:

```ts
  it('puts the ShyTalk mark on its own tile in light, and on nothing in dark', () => {
    // The tile's colour now lives in two files (§3.4): SHYTALK_MARK, whose
    // level shytalk-brand.test.ts pins, and this token, held equal to it here.
    const css = tokensCss();
    expect(themeTokens(css, 'light').get('--wordmark-tile')).toBe(
      SHYTALK_MARK.tile,
    );
    expect(themeTokens(css, 'dark').get('--wordmark-tile')).toBe(
      'transparent',
    );
    expect(themeTokens(css, 'dark').get('--wordmark-pad')).toBe('0');
  });
```

- [ ] **Step 2: Write the failing brand exemption.** In `tests/unit/shytalk-brand.test.ts`, add this straight after `const SCAN = ['src', 'tests'];`:

```ts
/**
 * One narrower exemption (#142 §3.4). The mark's tile is also a THEME token:
 * the theme, not the component, decides whether the mark sits on it, so
 * tokens.css declares `--wordmark-tile` with the tile's hex on bare `:root`.
 * That file may spell the tile and nothing else of the mark, and only once;
 * tests/unit/tokens.test.ts holds the value equal to SHYTALK_MARK.tile.
 */
const TOKEN_HOME = 'src/styles/tokens.css';
const TOKEN_FORM = SHYTALK_MARK.tile.toLowerCase();
```

Then replace the test *exempts exactly two files, and both exist* with:

```ts
  it('exempts exactly two files and one token, and each file exists', () => {
    // An exemption naming a path that does not exist exempts nothing and
    // reads identically to one that works.
    const files = scannedFiles();
    for (const allowed of [...ALLOWED, TOKEN_HOME]) {
      expect(files, `${allowed} is not in the scanned set`).toContain(allowed);
    }
    expect(ALLOWED.size).toBe(2);
  });
```

and, in *is spelled out nowhere else in the repo*, replace the `return forms…` statement at the end of the `flatMap` callback with:

```ts
      const exempt = file === TOKEN_HOME ? [TOKEN_FORM] : [];
      const repeated = exempt.filter((form) => lower.split(form).length > 2);
      return [
        ...forms
          .filter(
            (form) =>
              lower.includes(form.toLowerCase()) && !exempt.includes(form),
          )
          .map((form) => `${file} spells out ${form}`),
        ...repeated.map((form) => `${file} spells out ${form} more than once`),
      ];
```

- [ ] **Step 3: Write the failing pairs for the mark.** In `tests/unit/contrast.test.ts`, add `import { SHYTALK_MARK } from '../../src/lib/shytalk-brand';` and append two entries to `PAIRS`, straight before its closing `];`:

```ts
  {
    fg: [SHYTALK_MARK.shy],
    bg: ['--wordmark-tile', ATMOSPHERE, '--bg'],
    level: 'large',
    where:
      'the ShyTalk mark\'s "Shy" (HomePage.astro, 2.6rem bold): on its own tile in light, and over the atmosphere in dark, where the tile is transparent (#142 §3.4)',
  },
  {
    fg: [SHYTALK_MARK.talk],
    bg: ['--wordmark-tile', ATMOSPHERE, '--bg'],
    level: 'large',
    where:
      'the ShyTalk mark\'s "Talk", on the same ground as "Shy" in each theme (#142 §3.4)',
  },
```

- [ ] **Step 4: Run them and watch them fail.**
  - Run: `npx vitest run tests/unit/tokens.test.ts tests/unit/shytalk-brand.test.ts tests/unit/contrast.test.ts`
  - Expected: **3 red.**
    - `tokens.test.ts`' tile guard fails: the token is `undefined`.
    - `contrast.test.ts`' `light:` and `dark:` pair tests fail, each on `--wordmark-tile is not defined in src/styles/tokens.css`.
  - `shytalk-brand.test.ts` stays green: `tokens.css` does not spell the tile yet.

- [ ] **Step 5: Implement.**

In `tokens.css`'s bare `:root`, straight after `--shaft: rgb(255 255 255 / 0.35);`, add:

```css

  /* The ShyTalk mark's tile (HomePage.astro, #142 §3.4). The mark's two
     tones were made for a dark ground and measure 1.28:1 and 1.70:1 on
     white, so in light it sits on ShyTalk's own tile colour, like a logo
     badge: 15.02:1 and 11.32:1. The same value as SHYTALK_MARK.tile, held
     equal by tests/unit/tokens.test.ts, because the colour now lives in two
     files. */
  --wordmark-tile: #0f0d15;
  --wordmark-pad: 0.12em 0.42em 0.18em;
```

In the first dark block, straight after `--shaft: rgb(255 255 255 / 0.05);`, add:

```css

    /* No tile: the mark was made for this ground, and zero padding keeps it
       exactly where Aurora always had it. */
    --wordmark-tile: transparent;
    --wordmark-pad: 0;
```

In the second dark block, straight after its `--shaft: rgb(255 255 255 / 0.05);`, add:

```css
    --wordmark-tile: transparent;
    --wordmark-pad: 0;
```

In the print block, straight after `--shaft: transparent;`, add:

```css

    /* The mark prints in ink (HomePage.astro), so a tile would print as a
       dark slab around dark text, if it printed at all. None on paper. */
    --wordmark-tile: transparent;
    --wordmark-pad: 0;
```

In `HomePage.astro`, the rule reading

```css
  .shytalk-wordmark {
    display: inline-block;
```

becomes

```css
  .shytalk-wordmark {
    display: inline-block;
    background: var(--wordmark-tile);
    padding: var(--wordmark-pad);
    border-radius: 14px;
```

and its comment's last line, "Colours taken from the live logo; values live in src/lib/shytalk-brand.ts.", becomes "Colours taken from the live logo; values live in src/lib/shytalk-brand.ts, and the tile's theme token in tokens.css (#142 §3.4)."

- [ ] **Step 6: Run the tests and watch them pass.**
  - Run: `npx vitest run tests/unit/tokens.test.ts tests/unit/shytalk-brand.test.ts tests/unit/contrast.test.ts`. Expected: every test passes. In light the mark scores 15.02:1 and 11.32:1 on its tile at every subset. In dark it scores over the atmosphere.
  - Then run `npm run test:unit` and `npm run typecheck`. Expected: all green, and 0/0/0. `colour-literals` does not scan `tokens.css`, and `HomePage.astro` gains only `var()` reads.

- [ ] **Step 7: Commit.**

```bash
npx prettier --write src/styles/tokens.css src/components/pages/HomePage.astro tests/unit/tokens.test.ts tests/unit/shytalk-brand.test.ts tests/unit/contrast.test.ts
npx prettier --check .
git add src/styles/tokens.css src/components/pages/HomePage.astro tests/unit/tokens.test.ts tests/unit/shytalk-brand.test.ts tests/unit/contrast.test.ts
git commit -m "feat(home): the ShyTalk mark sits on its own tile in light

Refs #142"
```

---

### Task 4: The theme script, inline in every `<head>`, and the inventory that pins it

**Files:**
- Create: `src/scripts/theme.inline.js`, `tests/themes.ts`, `tests/e2e/theme-script.spec.ts`, `tests/e2e/theme.spec.ts`
- Modify: `src/layouts/BaseLayout.astro`, `playwright.config.ts`, `tests/e2e/classroom-groups.spec.ts`, `tests/unit/locale-switcher.test.ts`, `tests/unit/colour-literals.test.ts`, `CLAUDE.md`
- Modify (the same promise, restated): `README.md`, `.github/workflows/deploy-prod.yml`, `src/components/LanguageSwitcher.astro`, `tests/e2e/language-switcher.spec.ts`, `tests/e2e/recorders.ts`, `tests/unit/event-collectors.test.ts`, `tests/e2e/visual.spec.ts`

**Interfaces:**
- Consumes: `themeColour`, `THEMES`, `Theme` (Task 1).
- Produces, in `tests/themes.ts`:
  - `THEME_SCRIPT_FILE = 'src/scripts/theme.inline.js'`;
  - `THEME_SCRIPT_SOURCE: string`, the file's text;
  - `expectTheme(page: Page, theme: Theme): Promise<void>`;
  - `emulateTheme(page: Page, theme: Theme): Promise<void>`;
  - `saveTheme(page: Page, theme: Theme): Promise<void>`.

  `tests/e2e/theme.spec.ts` exists for Tasks 5 and 6 to extend. The script stamps `data-theme` and `data-theme-switch` on `<html>`, and reads `localStorage['theme']`.

- [ ] **Step 1: Create the helpers, and an empty script to compare against.**
  - Create `src/scripts/theme.inline.js` as an **empty file**. The red run in Step 3 needs a source to read, and an empty one matches no real script.
  - Create `tests/themes.ts`:

```ts
import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { themeColour, type Theme } from './palette';

/**
 * The browser half of the palette model (#142 §6.2), shared by the e2e suite
 * and both deployed-site suites. Every expectation comes from tokens.css
 * through `themeColour`, never from the page, which would compare the page
 * with itself.
 */

/** The one script every page carries (#142 §5), and its text as shipped. */
export const THEME_SCRIPT_FILE = 'src/scripts/theme.inline.js';
export const THEME_SCRIPT_SOURCE = readFileSync(THEME_SCRIPT_FILE, 'utf8');

/**
 * Prove `page` rendered `theme`, by its ground. Every per-theme run asserts
 * this first, so a run meant to be light that rendered dark fails rather than
 * passing on the other palette. Read in screen media: on paper the ground is
 * white whatever the theme.
 */
export async function expectTheme(page: Page, theme: Theme): Promise<void> {
  await expect(
    page.locator('html'),
    `the page rendered the ${theme} theme`,
  ).toHaveCSS('background-color', themeColour(theme, '--bg'));
}

/**
 * Show `theme` as the device's own setting, in screen media, then prove the
 * page rendered it. This is what a visitor's device does, and with no choice
 * saved the page follows it live (#142 §4).
 */
export async function emulateTheme(page: Page, theme: Theme): Promise<void> {
  await page.emulateMedia({ media: 'screen', colorScheme: theme });
  await expectTheme(page, theme);
}

/**
 * Save `theme` as the visitor's choice, as the switch does, then reload so the
 * page's own script reads it before the first paint.
 */
export async function saveTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate((value) => localStorage.setItem('theme', value), theme);
  await page.reload();
}
```

- [ ] **Step 2: Write the failing browser guards.** Neither spec below declares `test.use(recorded)` yet. `evidence-recording.test.ts` refuses a spec that records without acting, and neither acts until Task 5 gives `theme.spec.ts` its first click; `theme-script.spec.ts` never acts at all (measured in review pass 1: both go red there otherwise). Create `tests/e2e/theme-script.spec.ts`:

```ts
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { searched } from '../source-files';
import { sitePaths } from '../site-pages';
import { THEME_SCRIPT_SOURCE } from '../themes';
import { LOCALES, localisePath } from '../../src/lib/i18n';

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

/** The 404 is served for any unknown path, so any unknown path reaches it. */
const NOT_FOUND = '/definitely-not-a-page';

/**
 * What each page carries of its own, besides the theme script, as the build
 * measured on 2026-09-24. Keyed by unlocalised path, so a page added to
 * src/pages has no entry and fails until someone decides what it may carry.
 */
const OWN_SCRIPTS: Record<string, readonly string[]> = {
  '/': [],
  '/glory-points': ['external module in body'],
  '/classroom-groups': ['inline classic in body', 'external module in body'],
  [NOT_FOUND]: [],
};

type Script = {
  inline: boolean;
  module: boolean;
  inHead: boolean;
  text: string;
  /** Every stylesheet that comes BEFORE this script in the document. */
  sheetsBefore: string[];
};

/** The page's scripts, and every stylesheet it carries, from the DOM. */
const scriptsOn = (page: Page): Promise<{ scripts: Script[]; sheets: string[] }> =>
  page.evaluate(() => {
    const sheetElements = [
      ...document.querySelectorAll('link[rel~="stylesheet"], style'),
    ];
    const name = (sheet: Element) =>
      sheet instanceof HTMLLinkElement ? `link ${sheet.href}` : 'style';
    return {
      sheets: sheetElements.map(name),
      scripts: [...document.scripts].map((script) => ({
        inline: !script.hasAttribute('src'),
        module: script.type === 'module',
        inHead: document.head.contains(script),
        text: script.hasAttribute('src') ? '' : (script.textContent ?? ''),
        sheetsBefore: sheetElements
          .filter(
            (sheet) =>
              !(
                script.compareDocumentPosition(sheet) &
                Node.DOCUMENT_POSITION_FOLLOWING
              ),
          )
          .map(name),
      })),
    };
  });

const kindOf = ({ inline, module, inHead }: Script): string =>
  `${inline ? 'inline' : 'external'} ${module ? 'module' : 'classic'} in ${inHead ? 'head' : 'body'}`;

const isTheme = (script: Script): boolean =>
  script.inline && script.text === THEME_SCRIPT_SOURCE;

/** Every page the build emits: each page in each locale, and the 404. */
const BUILT = [
  ...LOCALES.flatMap((locale) =>
    sitePaths().map((route) => ({ route, path: localisePath(route, locale) })),
  ),
  { route: NOT_FOUND, path: NOT_FOUND },
];

test.describe('the theme script (#142 §6.4)', () => {
  test('is compared with the real script', () => {
    // The control for every comparison below: an empty or missing source
    // would match nothing, or an empty inline script, and prove nothing.
    expect(THEME_SCRIPT_SOURCE).toContain("localStorage.getItem('theme')");
  });

  for (const { route, path } of BUILT) {
    test(`${path}: carries it exactly once, and nothing it did not carry before`, async ({
      page,
    }) => {
      const own = OWN_SCRIPTS[route];
      if (own === undefined)
        throw new Error(
          `${route} has no entry in OWN_SCRIPTS: decide what it may carry`,
        );
      await page.goto(path);
      const { scripts } = await scriptsOn(page);
      expect(scripts.filter(isTheme), 'the theme script').toHaveLength(1);
      expect(
        scripts.filter((script) => !isTheme(script)).map(kindOf),
      ).toEqual(own);
    });

    test(`${path}: runs it before the first paint: inline, classic, in <head>, ahead of every stylesheet`, async ({
      page,
    }) => {
      await page.goto(path);
      const { scripts, sheets } = await scriptsOn(page);
      const [theme] = scripts.filter(isTheme);
      expect(theme, 'the theme script is on the page').toBeDefined();
      expect(kindOf(theme)).toBe('inline classic in head');
      expect(
        searched(theme.sheetsBefore, { of: sheets, what: 'stylesheets' }),
        'a stylesheet ahead of the theme script paints before it runs',
      ).toEqual([]);
    });
  }
});
```

Create `tests/e2e/theme.spec.ts`:

```ts
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { shoot } from './evidence';
import { themeColour } from '../palette';
import { expectTheme } from '../themes';

/**
 * The switch, rendered (#142 §6.3). The project's device prefers dark, so a
 * page with no saved choice shows Aurora, and a test that needs another
 * device says so with `test.use({ colorScheme })`.
 */

/**
 * Record the ground of the first frame that paints one, from an init script,
 * before the page's own scripts run. Until the stylesheet applies, the ground
 * is the UA's transparent. The first frame with a ground is the frame a flash
 * would show in.
 */
const recordFirstGround = (page: Page) =>
  page.addInitScript(() => {
    const read = () => {
      const ground = getComputedStyle(document.documentElement).backgroundColor;
      if (ground === 'rgba(0, 0, 0, 0)') requestAnimationFrame(read);
      else document.documentElement.dataset.firstGround = ground;
    };
    requestAnimationFrame(read);
  });

test.describe('no flash of the other theme (#142 §6.3, AC5)', () => {
  for (const [saved, device] of [
    ['light', 'dark'],
    ['dark', 'light'],
  ] as const) {
    test.describe(`a saved ${saved} choice on a device preferring ${device}`, () => {
      test.use({ colorScheme: device });

      test('the first frame that paints a ground paints the saved theme', async ({
        page,
      }) => {
        await page.goto('/glory-points');
        await expectTheme(page, device);
        await page.evaluate((theme) => localStorage.setItem('theme', theme), saved);
        await recordFirstGround(page);
        await page.goto('/');
        await expect(page.locator('html')).toHaveAttribute(
          'data-first-ground',
          themeColour(saved, '--bg'),
        );
        await expectTheme(page, saved);
        await shoot(
          page,
          `a saved ${saved} choice on a ${device} device: the first painted frame is already ${saved}`,
        );
      });
    });
  }
});

test.describe('a saved value that is not exactly light or dark (Review Focus 1)', () => {
  test.use({ colorScheme: 'light' });

  test('is ignored, and the device setting applies', async ({ page }) => {
    await page.goto('/');
    for (const stale of ['Dark', ' dark', 'dark\n', '"dark"', 'auto', '']) {
      await page.evaluate((value) => localStorage.setItem('theme', value), stale);
      await page.reload();
      await expectTheme(page, 'light');
      await expect(
        page.locator('html'),
        `${JSON.stringify(stale)} stamped nothing`,
      ).not.toHaveAttribute('data-theme', /./);
    }
  });
});
```

Then make three more edits.

- **Add `'theme-script.spec.ts',` to `CONTENT_ONLY_SPECS`** in `playwright.config.ts`, straight after `'copy-reaches-a-page.spec.ts',`. What it reads is DOM order, which is identical on every engine.
- **Rewrite the first former zero-JS guard.** In `tests/e2e/classroom-groups.spec.ts`, add `import { THEME_SCRIPT_SOURCE } from '../themes';` after `import { recorded, shoot } from './evidence';`. Then replace the whole test `'the homepage still ships no JavaScript'`, from its `test(` line to its closing `});`, with:

```ts
  test('the homepage ships the theme script and nothing else', async ({
    page,
  }) => {
    // Rewritten for #142. The promise was "the homepage ships zero JS"; it
    // now ships exactly one script, the inline theme script, so this pins
    // what may exist rather than counting to zero. Two measurements still,
    // because a request recorder cannot see an inline script at all (#79):
    // the DOM says what is on the page, and the recorder that nothing was
    // fetched to run. theme-script.spec.ts pins the same on every page.
    const seen = recordRequests(page);
    await page.goto('/');
    const scripts = await page.evaluate(() =>
      [...document.scripts].map((script) => ({
        src: script.getAttribute('src') ?? '',
        text: script.textContent ?? '',
      })),
    );
    expect(scripts, 'the homepage carries the theme script alone').toEqual([
      { src: '', text: THEME_SCRIPT_SOURCE },
    ]);
    seen.expectNone(
      ({ resourceType }) => resourceType === 'script',
      'the homepage fetches no script',
    );
  });
```

  In the `// M-11.` comment above it, replace its first sentence, "The one test in this file that never touches /classroom-groups --", and the text up to the end of that comment with:

```ts
  // M-11. The one test in this file that never touches /classroom-groups --
  // CLAUDE.md's promise about what the homepage ships (one script, the theme
  // script, since #142) is site-wide, and this task's own work could put it
  // at risk only by accident (a shared layout partial, a global script tag),
  // so it earns a direct check rather than an inference.
```

- **Rewrite the second former zero-JS guard.** In `tests/unit/locale-switcher.test.ts`, replace the test `'ships no JavaScript, because the homepage ships none'` with:

```ts
  it('ships no JavaScript of its own, so it works with scripting off', () => {
    const src = source(SWITCHER);
    expect(
      /<details[\s>]/.test(src),
      'the switcher is not a <details> element, so it needs JavaScript',
    ).toBe(true);
    expect(
      /<script/.test(src),
      'a language switcher is exactly the control someone needs when ' +
        'something else has already failed: it must work with no script, ' +
        'the theme script included (#142)',
    ).toBe(false);
  });
```

- [ ] **Step 3: Write the failing colour-guard widening.** In `tests/unit/colour-literals.test.ts`, first move the walk into a function of its own, keeping its filter exactly as it is. Replace `literalsUnderSrc` with:

```ts
/** The files the guard reads: every source under src/ but the tokens themselves. */
const scannedFiles = (): string[] =>
  filesUnder(
    'src',
    (path) => /\.(astro|css|ts)$/.test(path) && path !== TOKENS_FILE,
  );

const literalsUnderSrc = (): Literal[] =>
  scannedFiles().flatMap((file) =>
    literalsIn(file, readFileSync(file, 'utf8')),
  );
```

Then append two tests inside the `describe`:

```ts
  it('reads the theme script, and every kind of source a colour can hide in', () => {
    // #142 put the first plain .js under src/, and a guard reading only
    // .astro, .css and .ts would never have opened it.
    expect(scannedFiles()).toContain('src/scripts/theme.inline.js');
  });

  it('reads a script as code, never as CSS', () => {
    expect(
      literalsIn('x.js', 'const a = { color: red }; const b = "#fff";').map(
        describeLiteral,
      ),
    ).toEqual(['x.js :: (code) writes #fff']);
  });
```

- [ ] **Step 4: Run everything new and watch it fail.**
  - Run `npx vitest run tests/unit/colour-literals.test.ts tests/unit/locale-switcher.test.ts`. Expected: **2 red.**
    - *reads the theme script*: the walk does not open `.js`.
    - *reads a script as code, never as CSS*: `literalsIn` still reads any non-`.ts` file as CSS, so it also finds `x.js :: const a = writes red` inside the object literal.
  - The rewritten locale-switcher test is green: the switcher has no script, which is the point. Its red is mutation U13 in Task 12.
  - Run `npx playwright test tests/e2e/theme-script.spec.ts tests/e2e/theme.spec.ts`, then `npx playwright test tests/e2e/classroom-groups.spec.ts -g "ships the theme script" --project=chromium`. Expected:
    - `theme-script.spec.ts` (content project): **33 red.** The source control, 16 inventory tests and 16 order tests. The empty source matches no script on any page.
    - `theme.spec.ts`: **10 red**, the two no-flash tests on 5 engines. Nothing stamps the saved choice. The Review Focus test is **green on all 5**: nothing stamps anything yet. Its red is mutation S7 in Task 12.
    - `classroom-groups.spec.ts`: **1 red**. The homepage carries no script at all.

- [ ] **Step 5: Implement.**

`src/scripts/theme.inline.js`, the part of the script this task needs: read and stamp a saved choice, and reveal the switch.

```js
(() => {
  const root = document.documentElement;
  const saved = () => {
    try {
      const theme = localStorage.getItem('theme');
      return theme === 'light' || theme === 'dark' ? theme : null;
    } catch {
      return null;
    }
  };
  const apply = () => {
    const theme = saved();
    if (theme) root.dataset.theme = theme;
    else delete root.dataset.theme;
  };
  apply();
  root.dataset.themeSwitch = '';
})();
```

In `src/layouts/BaseLayout.astro`, add `import themeScript from '../scripts/theme.inline.js?raw';` straight after `import '../styles/tokens.css';`. Then, straight after `<meta name="viewport" content="width=device-width, initial-scale=1" />`, add:

```astro
    {
      /* The theme script (#142 §5). Inline, classic and HERE, straight after
         the viewport meta and before every stylesheet, because it stamps a
         saved choice on <html> before the first paint: a visitor who chose
         light never sees a frame of dark, or the reverse. A module, `defer`
         or a later place in the document would all run after that frame.
         It also reveals the switch, which exists only for a page whose script
         ran, and handles its presses by delegation, since the switch does
         not exist yet when a head script runs.

         Its explanation lives here, where the build strips it, and not in the
         shipped file, which every page carries exactly as written. The site
         sends no Content-Security-Policy; one added later must allow this
         script by its hash, which changes only when the file does, and
         theme-script.spec.ts pins the content. The choice is one
         localStorage word, written only when the switch is pressed: no
         cookie, and nothing sent anywhere. */
    }
    <script is:inline set:html={themeScript}></script>
```

In `tests/unit/colour-literals.test.ts`, widen the walk and read every script as code:
- After the `Literal` type, add:

  ```ts
  /** Every kind of source file under src/ that a colour can be written in. */
  const SOURCE = /\.(astro|css|ts|js|mjs)$/;

  /** Code through and through: nothing in it to read as CSS by rule. */
  const isCode = (file: string): boolean => /\.(ts|js|mjs)$/.test(file);
  ```

- In `scannedFiles`, `/\.(astro|css|ts)$/.test(path)` becomes `SOURCE.test(path)`.
- In `literalsIn`, `...(file.endsWith('.ts')` becomes `...(isCode(file)`.
- `codeOf`'s doc comment, "all of a `.ts` file", becomes "all of a `.ts`, `.js` or `.mjs` file".

In `CLAUDE.md`, replace the line

```markdown
- **Homepage ships zero JS.** Only `/glory-points` and `/classroom-groups` have scripts, in both locales.
```

with

```markdown
- **Every page ships one script, the inline theme script, and the homepage nothing else.** `src/scripts/theme.inline.js` is emitted by `BaseLayout.astro` inline and classic in `<head>`, ahead of every stylesheet, so a saved light or dark choice is on `<html>` before the first paint (#142). The homepage in all five locales and the 404 carry nothing else; `/glory-points` and `/classroom-groups` add their own, in all five locales. `tests/e2e/theme-script.spec.ts` pins that inventory on every built page, read from a real DOM.
```

The same promise is restated in more places, and each becomes false the moment the script ships. Nothing checks the wording, so derive them rather than trusting this list: `git grep -n -i -E 'zero (js|javascript)|no javascript|ships no' -- ':!docs' ':!HANDOVER.md'` prints **20 lines at `3640af2`** (review pass 3). Every one is accounted for:
- **5 are edited by this task's own steps above:** `CLAUDE.md:4`, the three in `classroom-groups.spec.ts` (the M-11 comment, the test's title and its message), and `locale-switcher.test.ts`' test title.
- **8 are edited through the table below:** seven rows, one of which covers two files.
- **7 stay, because they stay true:** `deploy-prod.yml`'s `classroom-groups ships no script` error message; `Marquee.astro`'s "No JavaScript: one CSS keyframe" (the marquee needs none); `csv.ts`' "ships no third-party runtime code" (the theme script is the site's own); `404.astro`'s "needs no JavaScript"; `tokens.css`' "Zero JavaScript" about the atmosphere; and `metadata.ts` and `locale-metadata.test.ts`, which match only because `ships no` is a prefix of "ships now".

A line the command prints that is none of these is a finding: add it here before going on. Each row is edited by hand, re-wrapping the comment it sits in:

| file | today | becomes |
| --- | --- | --- |
| `README.md` | "**The homepage ships zero JavaScript**, and `deploy-prod.yml` fails the release if that ever stops being true." | "**The homepage fetches no JavaScript**: its one script, the theme script, is inline (#142), and `deploy-prod.yml` fails the release if the homepage ever fetches one." |
| `.github/workflows/deploy-prod.yml`, the prod smoke | the comment "The homepage still ships NO script — a promise this site makes and the kind of thing a bundler change breaks silently.", and the message `the homepage now ships JavaScript` | "The homepage still FETCHES no script: its one script, the theme script, is inline (#142), and a bundler change could add one silently.", and `the homepage now fetches JavaScript`. The check itself stays: its `grep` matches only `<script … src="….js">`, which the inline script is not. |
| `src/components/LanguageSwitcher.astro`, doc comment | "Zero JavaScript. The homepage ships none, and a language switcher is exactly the control a visitor needs when something else has gone wrong" | "No JavaScript of its own. A language switcher is exactly the control a visitor needs when something else has gone wrong, the theme script included (#142)" |
| the same comment, last paragraph | "so the page still ships no JavaScript" | "so the switcher still needs no JavaScript" |
| `tests/e2e/language-switcher.spec.ts`, *opens and closes without JavaScript* | "A native <details>. The homepage ships zero JS, and a language switcher is exactly the control someone needs when something else has failed." | "A native <details>, with no script of its own: a language switcher is exactly the control someone needs when something else has failed." |
| `tests/e2e/recorders.ts` and `tests/unit/event-collectors.test.ts`, each once | `` `the homepage still ships no JavaScript` `` | `` `the homepage still ships no JavaScript` (now `the homepage ships the theme script and nothing else`, #142) ``: the history stays, and the test can be found by the name it has |
| `tests/e2e/visual.spec.ts`, the comment in `settle` | "On the homepage, which ships no JavaScript at all, it is already there and this returns immediately." | "On the homepage, whose one script is the theme script and rewrites nothing, it is already there and this returns immediately." (found in review pass 3) |

- [ ] **Step 6: Run everything and watch it pass.**
  - Rerun both Step 4 commands. Expected: all green.
    - `theme-script.spec.ts`: 33 of 33.
    - `theme.spec.ts`: 15 of 15. The Review Focus test is on 5 engines.
    - `classroom-groups.spec.ts`: 1 of 1.
  - If the inventory fails only on the source comparison, the build changed the text, for example by compressing whitespace. Compare `script.textContent` with the file byte by byte, and fix the emission, never the comparison.
  - Then run `npm run test:unit` and `npm run typecheck`. Expected: all green, and 0/0/0. `astro check` now type-checks the script under `checkJs`. Formatting is checked in the commit step, after its `--write`: before it, `prettier --check .` flags `BaseLayout.astro`, `theme-script.spec.ts`, `theme.spec.ts` and `colour-literals.test.ts` (review pass 1).

- [ ] **Step 7: Commit.**

```bash
npx prettier --write src/scripts/theme.inline.js src/layouts/BaseLayout.astro tests/themes.ts tests/e2e/theme-script.spec.ts tests/e2e/theme.spec.ts tests/e2e/classroom-groups.spec.ts tests/unit/locale-switcher.test.ts tests/unit/colour-literals.test.ts playwright.config.ts CLAUDE.md README.md .github/workflows/deploy-prod.yml src/components/LanguageSwitcher.astro tests/e2e/language-switcher.spec.ts tests/e2e/recorders.ts tests/unit/event-collectors.test.ts tests/e2e/visual.spec.ts
npx prettier --check .
git add src/scripts/theme.inline.js src/layouts/BaseLayout.astro tests/themes.ts tests/e2e/theme-script.spec.ts tests/e2e/theme.spec.ts tests/e2e/classroom-groups.spec.ts tests/unit/locale-switcher.test.ts tests/unit/colour-literals.test.ts playwright.config.ts CLAUDE.md README.md .github/workflows/deploy-prod.yml src/components/LanguageSwitcher.astro tests/e2e/language-switcher.spec.ts tests/e2e/recorders.ts tests/unit/event-collectors.test.ts tests/e2e/visual.spec.ts
git commit -m "feat(layout): one inline theme script in every head, pinned by inventory

Refs #142"
```

---

### Task 5: The switch in the header

**Files:**
- Create: `src/components/ThemeSwitch.astro`
- Modify: `src/components/Header.astro`, `src/styles/tokens.css`, `src/scripts/theme.inline.js`
- Modify: `src/lib/i18n/site.ts`, `src/lib/i18n/label-check.ts`
- Test: `tests/e2e/theme.spec.ts`, `tests/e2e/header-room.spec.ts`

**Interfaces:**
- Consumes: `expectTheme` (Task 4); `THEMES`, `themeColour` (Task 1); `getSiteStrings`, `LOCALES`, `localisePath` (`src/lib/i18n`); `atLeast44` (`tests/viewport.ts`).
- Produces:
  - `SiteStrings['themeDarkMode']`;
  - the switch, `header [data-theme-toggle]`, a `<button>` with `aria-label` and, once the script runs, `aria-pressed`;
  - the tokens `--switch-display`, `--switch-moon` and `--switch-sun`.

- [ ] **Step 1: Write the failing tests.** In `tests/e2e/theme.spec.ts`:
  - **The `./evidence` import** becomes `import { recorded, shoot } from './evidence';`, and `test.use(recorded);` goes after the imports: this step gives the spec its first click, so it now acts, and `evidence-recording.test.ts` wants its recordings.
  - **The `../palette` import** becomes `import { THEMES, themeColour } from '../palette';`.
  - **Two new imports:** `import { atLeast44 } from '../viewport';` and `import { LOCALES, getSiteStrings, localisePath } from '../../src/lib/i18n';`.
  - **Two constants** go after the file's doc comment: `const SWITCH = 'header [data-theme-toggle]';` and `const toggle = (page: Page) => page.locator(SWITCH);`.
  - **Retire `header-room.spec.ts`'s stand-in**, as its own comment says #142 does "when the real switch lands". Its 44px stand-in is inserted with `bar.insertBefore(standIn, switcher)`, and once the language switcher sits inside `.controls` that call throws `NotFoundError`. Before that, the stand-in would have been a second switch beside the real one. In that file:
    - `getSiteStrings` joins the `../../src/lib/i18n` import, straight after `LOCALES,`;
    - delete the stand-in: its doc comment (the one opening *A 44 x 44px stand-in for #142's theme switch*), `STAND_IN` and `addStandIn`, down to `}, STAND_IN);` and the blank line after it;
    - in `survey`, the head becomes the block below. In `open`, the line `if (standIn) await addStandIn(page);` goes. In `measure`, the condition's last line `(standIn && !names.includes(STAND_IN))` becomes `!names.includes(themeSwitch)`;

```ts
const survey = (locale: Locale) => {
  const findings: string[] = [];
  const rows: string[] = [];
  const thin: string[] = [];
  const least = 4; // wordmark, menu or nav, theme switch, language switcher
  // The theme switch by its own name (#142): a row without it has not
  // measured the room AC5 asks for.
  const themeSwitch = getSiteStrings(locale).themeDarkMode;
  return {
```

    - and the describe's loop becomes one test per locale:

```ts
test.describe('the header row has room for everything in it (#329)', () => {
  for (const locale of LOCALES) {
    test(
      `${locale}: no header item overlaps another, at any width`,
      { tag: '@emulated-viewport' },
      async ({ page }) => {
        const paths = await pagesOf(page, locale);
        const header = survey(locale);
        for (const path of paths) {
          for (const width of await header.open(page, path)) {
            await page.setViewportSize({ width, height: 800 });
            await header.measure(page, `${path} at ${width}px`);
          }
        }
        header.expectRoom();
        // The picture comes after the verdict, so it shows a row that passed.
        await header.open(page, paths[0]);
        await page.setViewportSize({ width: 320, height: 800 });
        await shoot(
          page,
          `${paths[0]} at 320px: the header row`,
          page.locator('header'),
        );
      },
    );
  }
});
```

  - **Append:**

```ts
test.describe('the switch (#142 §5, AC3)', () => {
  for (const locale of LOCALES) {
    test(`${locale}: a toggle button named in its own language, pressed while dark`, async ({
      page,
    }) => {
      const name = getSiteStrings(locale).themeDarkMode;
      await page.goto(localisePath('/', locale));
      const button = page.getByRole('button', { name, exact: true });
      await expect(button).toHaveCount(1);
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await button.click();
      await expectTheme(page, 'light');
      await expect(button).toHaveAttribute('aria-pressed', 'false');
      await shoot(page, `${locale}: "${name}" pressed off, and the page is light`, button);
    });
  }

  test('is 44 × 44, with a visible focus ring', async ({ page }) => {
    await page.goto('/');
    await expect(toggle(page)).toBeVisible();
    await atLeast44(toggle(page), 'the theme switch');
    // A keypress first, so the focus below is keyboard focus to every
    // engine's :focus-visible heuristic.
    await page.keyboard.press('Shift');
    await toggle(page).focus();
    await expect(toggle(page)).toHaveCSS('outline-style', 'solid');
    await expect(toggle(page)).toHaveCSS('outline-width', '3px');
    await shoot(page, 'the switch focused: its ring is the accent', toggle(page));
  });

  test('Enter and Space each toggle it', async ({ page }) => {
    await page.goto('/');
    await toggle(page).focus();
    await page.keyboard.press('Enter');
    await expectTheme(page, 'light');
    await page.keyboard.press('Space');
    await expectTheme(page, 'dark');
  });

  test('switches instantly: the next frame already paints the new ground', async ({
    page,
  }) => {
    await page.goto('/');
    await expectTheme(page, 'dark');
    const next = await toggle(page).evaluate(
      (button) =>
        new Promise<string>((resolve) => {
          (button as HTMLElement).click();
          requestAnimationFrame(() =>
            resolve(getComputedStyle(document.documentElement).backgroundColor),
          );
        }),
    );
    expect(next).toBe(themeColour('light', '--bg'));
  });

  test('does not print', async ({ page }) => {
    await page.goto('/');
    await expect(toggle(page)).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await expect(toggle(page)).toHaveCount(1);
    await expect(toggle(page)).toBeHidden();
  });

  test('under forced colours, its icon draws in the system text colour (Review Focus 4)', async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== 'chromium',
      'Playwright emulates forcedColors in Chromium alone',
    );
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto('/');
    const drawn = await toggle(page).evaluate((button) => ({
      ink: getComputedStyle(button).color,
      paints: [...button.querySelectorAll('svg')]
        .filter((svg) => svg.getClientRects().length > 0)
        .flatMap((svg) => [...svg.querySelectorAll('circle, path')])
        .map((shape) => {
          const style = getComputedStyle(shape);
          return style.fill === 'none' ? style.stroke : style.fill;
        }),
    }));
    expect(drawn.paints.length, 'the visible icon draws something').toBeGreaterThan(0);
    expect([...new Set(drawn.paints)]).toEqual([drawn.ink]);
  });
});

test.describe('without JavaScript (#142 AC7)', () => {
  test.use({ javaScriptEnabled: false });

  for (const theme of THEMES) {
    test.describe(`on a device preferring ${theme}`, () => {
      test.use({ colorScheme: theme });

      test(
        'the switch is absent, and the device setting applies',
        { tag: '@requires-isolated-context' },
        async ({ page }) => {
          await page.goto('/');
          await expectTheme(page, theme);
          await expect(toggle(page)).toHaveCount(1);
          await expect(toggle(page)).toBeHidden();
          await expect(toggle(page)).not.toHaveAttribute('aria-pressed', /./);
        },
      );
    });
  }
});
```

- [ ] **Step 2: Run them and watch them fail.**
  - Run: `npx playwright test tests/e2e/theme.spec.ts tests/e2e/header-room.spec.ts`
  - Expected: the new tests fail on every engine where they run: there is no switch.
    - **Red, header-room:** its 5 locale tests on 5 engines, each for *measured only [Shyden | Toggle navigation menu | Language]* or the desktop row's equivalent: no row holds the switch by name (measured in review pass 1 by removing the switch after Step 3).
    - **Red:** the 5 locale tests, *is 44 × 44*, *Enter and Space*, *instantly* and *does not print*, on 5 engines. The forced-colours test on `chromium` and `mobile-chrome`.
    - **Skipped:** the forced-colours test on the other three.
    - **Without JavaScript:** its 2 tests are red on all 5 engines. The locator counts 0 where the test wants 1.
  - Before Step 3, `getSiteStrings(locale).themeDarkMode` is `undefined`, so `getByRole` filters by no name. The count is then not 1 wherever the page has any other button, so the failure is still red, for the reason the test states.

- [ ] **Step 3: Implement.**

**The label, in five locales.**
- In `src/lib/i18n/site.ts`, add `themeDarkMode: 'Dark mode',` after `menuLabel: 'Toggle navigation menu',` in `siteEn`.
- In `src/lib/i18n/label-check.ts`, add `themeDarkMode: CHROME,` after `menuLabel: CHROME,` in `SITE_PAGES`.
- Then write the four other locales' drafts directly into `site.ts`, each after that locale's `menuLabel`, as `themeDarkMode`. These are each platform's own standard label for the setting:

  | locale | draft |
  | --- | --- |
  | `id` | `Mode gelap` |
  | `zh` | `深色模式` |
  | `vi` | `Chế độ tối` |
  | `th` | `โหมดมืด` |

  **Do not run the translator for this label, and leave `src/lib/i18n/.translations.json` alone.** Review pass 1 dry-ran `npm run i18n:translate` for each locale. It would send **95 strings (7,370 characters) for `id` and 15 strings (721 characters) each for `zh`, `vi` and `th`**, never only "Dark mode", and `--send` would write about 110 unrelated drafts into the cache. The recent chrome keys added the same way (`a82b395`, `7198c2a`, `0bb9e3a`) never touched the cache either. The drafts stay machine-grade by design (§8), and `label-check` lists the key as `unchecked` until a witness exists. Say this, with the dry-run counts, in the PR body.

**The tokens.**
- In `tokens.css`'s bare `:root`, straight after `--wordmark-pad: 0.12em 0.42em 0.18em;`, add:

```css

  /* The theme switch (ThemeSwitch.astro, #142 §4-5). Hidden until the theme
     script has run and stamped data-theme-switch (the last rule of the
     screen block below), so with JavaScript off no dead button is offered.
     Its icon is chosen here, beside the palette it names: a moon while light
     is showing, a sun while dark is. */
  --switch-display: none;
  --switch-moon: inline-block;
  --switch-sun: none;
```

- In **both** dark blocks, straight after each one's `--wordmark-pad: 0;`, add the lines below. The print block has a `--wordmark-pad: 0;` too, which makes three in the file; the print block's is not a target, since the switch never prints (review pass 1):

```css
    --switch-moon: none;
    --switch-sun: inline-block;
```

- Inside `@media screen {`, straight after the closing `}` of `:root[data-theme='dark']`, add:

```css

  /* The switch appears only once the theme script has run (#142 §4).
     Screen-only, so it never prints; and here, in the one file that owns the
     root, because a component's scoped selectors never test an attribute on
     :root. */
  :root[data-theme-switch] {
    --switch-display: inline-flex;
  }
```

**The component.** Create `src/components/ThemeSwitch.astro`:

```astro
---
import { getSiteStrings, type Locale } from '../lib/i18n';

interface Props {
  lang: Locale;
}
const { lang } = Astro.props;
const t = getSiteStrings(lang);
---

{
  /* The theme switch (#142 §5): a toggle button whose name stays "Dark mode"
     while only its pressed state changes, the WAI-ARIA pattern. The server
     renders no aria-pressed; the theme script adds it once the page has
     parsed and keeps it accurate, so the attribute exists only while something
     maintains it. Hidden until that script has run (--switch-display in
     tokens.css): with JavaScript off, the device's own setting applies and no
     dead button is offered. The icons are decorative: a moon while light is
     showing and a sun while dark is, each shown by a token, so an icon can
     never disagree with the palette. They draw in currentColor, from --ink,
     which also lets forced colours reach them. */
}
<button
  type="button"
  class="theme-switch"
  data-theme-toggle
  aria-label={t.themeDarkMode}
>
  <svg class="moon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
    <path
      fill="currentColor"
      d="M20.4 14.1A8.6 8.6 0 1 1 9.9 3.6a7.5 7.5 0 0 0 10.5 10.5Z"
    />
  </svg>
  <svg class="sun" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
    <circle fill="currentColor" cx="12" cy="12" r="4.5" />
    <path
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"
    />
  </svg>
</button>

<style>
  .theme-switch {
    display: var(--switch-display);
    flex: none;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--ink);
    cursor: pointer;
  }
  .moon {
    display: var(--switch-moon);
  }
  .sun {
    display: var(--switch-sun);
  }
</style>
```

**The header.** In `src/components/Header.astro`:
- Add `import ThemeSwitch from './ThemeSwitch.astro';` after the `LanguageSwitcher` import.
- Replace the comment block above `<LanguageSwitcher …/>`, and that line, with:

```astro
    {/* The theme switch and the language switcher are ONE item in the bar
        (#142 §5). The bar spaces its items with `space-between`, so a fourth
        separate item would float in the middle of the row on a wide screen
        rather than sit beside the language switcher. Both live in the BAR,
        not in <nav>, for two reasons, both learned from a failing test.
        <nav> means "the site's sections" and is pinned to exactly those
        three links; these controls are a different kind of thing. And on
        mobile <nav> collapses behind the menu button, which would hide them
        from exactly the visitors most likely to want them. */}
    <div class="controls">
      <ThemeSwitch lang={lang} />
      <LanguageSwitcher lang={lang} pathname={Astro.url.pathname} />
    </div>
```

- In the `<style>` block, add, straight after the `.wordmark` rule:

```css
  .controls {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
```

**The script.** `src/scripts/theme.inline.js` becomes:

```js
(() => {
  const root = document.documentElement;
  const os = matchMedia('(prefers-color-scheme: dark)');
  const saved = () => {
    try {
      const theme = localStorage.getItem('theme');
      return theme === 'light' || theme === 'dark' ? theme : null;
    } catch {
      return null;
    }
  };
  const apply = () => {
    const theme = saved();
    if (theme) root.dataset.theme = theme;
    else delete root.dataset.theme;
  };
  const showing = () => root.dataset.theme ?? (os.matches ? 'dark' : 'light');
  const press = () => {
    for (const toggle of document.querySelectorAll('[data-theme-toggle]'))
      toggle.setAttribute('aria-pressed', String(showing() === 'dark'));
  };
  apply();
  root.dataset.themeSwitch = '';
  document.addEventListener('DOMContentLoaded', press);
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    if (!event.target.closest('[data-theme-toggle]')) return;
    root.dataset.theme = showing() === 'dark' ? 'light' : 'dark';
    press();
  });
})();
```

- [ ] **Step 4: Run everything that reads the header, and watch it pass.**
  - Run: `npx playwright test tests/e2e/theme.spec.ts tests/e2e/theme-script.spec.ts tests/e2e/header-room.spec.ts tests/e2e/chrome.spec.ts tests/e2e/language-switcher.spec.ts tests/e2e/locale-beta.spec.ts tests/e2e/skip-link.spec.ts`
  - Expected: all green, 336 passed and 7 skipped. Review pass 1 measured this run with the stand-in still in place: 336 passed, 7 skipped, and 25 failed, every one of them a stand-in test. With the stand-in retired, header-room alone passed 25 of 25. The forced-colours test skips on `firefox`, `webkit` and `mobile-safari`, and the Tab walks skip on WebKit as before. With the stand-in left in, header-room's 25 stand-in tests fail on `insertBefore`.
  - **`header-room.spec.ts` is the geometry proof of AC3.** It derives every `a[href], summary, button` in `header .bar`, the switch included, and measures overlap and wrapping in every locale at every width from 320px. A red there is the header's finding, never the guard's.
  - Then run `npm run test:unit`. Expected: all green:
    - `tokens`: *declares no token that nothing reads* sees the three switch tokens read by `ThemeSwitch.astro`;
    - `dead-copy`, `i18n`, `locale-fallbacks`, `label-check` and `verified-labels`: `themeDarkMode` has no witness, so it is `unchecked`, and nothing needs pinning;
    - `colour-literals`: `currentColor` and `none` are not colours.

    Also run `npm run typecheck` (0/0/0). Formatting is checked in Step 5, after its `--write` (before it, `ThemeSwitch.astro` and `theme.spec.ts` are flagged; review pass 1).

- [ ] **Step 5: Commit.**

```bash
npx prettier --write src/components/ThemeSwitch.astro src/components/Header.astro src/styles/tokens.css src/scripts/theme.inline.js src/lib/i18n/site.ts src/lib/i18n/label-check.ts tests/e2e/theme.spec.ts tests/e2e/header-room.spec.ts
npx prettier --check .
git add src/components/ThemeSwitch.astro src/components/Header.astro src/styles/tokens.css src/scripts/theme.inline.js src/lib/i18n/site.ts src/lib/i18n/label-check.ts tests/e2e/theme.spec.ts tests/e2e/header-room.spec.ts
git commit -m "feat(header): the theme switch, a toggle beside the language switcher

Refs #142"
```

---

### Task 6: The choice persists, and the switch follows the device

**Files:**
- Modify: `src/scripts/theme.inline.js`, `src/layouts/BaseLayout.astro`
- Test: `tests/e2e/theme.spec.ts`, `tests/unit/isolated-context-tagging.test.ts`

**Interfaces:**
- Consumes: `toggle`, `expectTheme` (Tasks 4 and 5); `emulateTheme` (Task 4); `recordErrors` (`tests/e2e/recorders.ts`).
- Produces: the final script. A press saves the choice under `theme`. `aria-pressed` follows the device when no choice is saved. A page restored from the back-forward cache re-applies the saved choice.

- [ ] **Step 1: Write the failing tests.** Add `import { recordErrors } from './recorders';` and `import { emulateTheme, expectTheme } from '../themes';` (replacing the Task 4 import of `expectTheme`) to `tests/e2e/theme.spec.ts`, then append:

```ts
test.describe('the choice persists (#142 AC4)', () => {
  test('across a reload and a second page', async ({ page }) => {
    await page.goto('/');
    await expectTheme(page, 'dark');
    await toggle(page).click();
    await expectTheme(page, 'light');
    await page.reload();
    await expectTheme(page, 'light');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await page.goto('/glory-points');
    await expectTheme(page, 'light');
    await shoot(page, 'a light choice made on the homepage holds on /glory-points', toggle(page));
  });

  test(
    'into a new session that carries the same storage',
    { tag: '@requires-isolated-context' },
    async ({ page, browser, baseURL }) => {
      await page.goto('/');
      await toggle(page).click();
      await expectTheme(page, 'light');
      const storageState = await page.context().storageState();
      const session = await browser.newContext({
        storageState,
        baseURL,
        colorScheme: 'dark',
      });
      try {
        const next = await session.newPage();
        await next.goto('/');
        await expectTheme(next, 'light');
      } finally {
        await session.close();
      }
    },
  );

  test('and a press after a stale saved value saves a valid one (Review Focus 1)', async ({
    page,
  }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('theme', 'Dark'));
    await page.reload();
    await toggle(page).click();
    await expectTheme(page, 'light');
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('light');
  });

  test('and a double press lands where it started, saving what it shows (Review Focus 2)', async ({
    page,
  }) => {
    await page.goto('/');
    await toggle(page).dblclick();
    await expectTheme(page, 'dark');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');
  });
});

test.describe('storage refused (#142 AC7)', () => {
  test('the switch still changes the page, nothing is saved, and nothing is logged', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        },
      });
    });
    const errors = recordErrors(page);
    await page.goto('/');
    await expectTheme(page, 'dark');
    await toggle(page).click();
    await expectTheme(page, 'light');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await errors.expectNone('the theme script threw where storage is refused');
    // A second page carries no refusal, so it can read what was saved.
    const probe = await page.context().newPage();
    await probe.goto('/');
    expect(await probe.evaluate(() => localStorage.getItem('theme'))).toBeNull();
    await probe.close();
  });
});

test.describe('the device (#142 AC2)', () => {
  test('with no choice saved, the page and the switch follow it, live', async ({
    page,
  }) => {
    await page.goto('/');
    await expectTheme(page, 'dark');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await emulateTheme(page, 'light');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await emulateTheme(page, 'dark');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  });

  test('with a choice saved, a change on the device changes nothing (Review Focus 5)', async ({
    page,
  }) => {
    await page.goto('/');
    await toggle(page).click();
    await expectTheme(page, 'light');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectTheme(page, 'light');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  });

  test('an engine without MediaQueryList.addEventListener still switches, and logs nothing (Review Focus 3)', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      // Safari before 14 offered only the deprecated addListener.
      Object.defineProperty(MediaQueryList.prototype, 'addEventListener', {
        configurable: true,
        value: undefined,
      });
    });
    const errors = recordErrors(page);
    await page.goto('/');
    await toggle(page).click();
    await expectTheme(page, 'light');
    await page.reload();
    await expectTheme(page, 'light');
    await errors.expectNone('the theme script threw without MediaQueryList.addEventListener');
  });
});

test.describe('Back (#142 §5 step 5, AC4)', () => {
  test('a page restored from the back-forward cache shows the theme chosen after leaving it', async ({
    page,
  }) => {
    await page.goto('/');
    await expectTheme(page, 'dark');
    await page.evaluate(() => {
      addEventListener('pageshow', (event) => {
        if (event.persisted) document.documentElement.dataset.restored = '';
      });
    });
    await page.goto('/glory-points');
    await toggle(page).click();
    await expectTheme(page, 'light');
    await page.goBack();
    await page.waitForLoadState();
    const restored = await page.evaluate(
      () => 'restored' in document.documentElement.dataset,
    );
    test.skip(
      !restored,
      'this engine reloaded the page instead of restoring it from the back-forward cache ' +
        '(Playwright launches Chromium with --disable-back-forward-cache); a reload re-runs ' +
        'the head script and would pass without the pageshow handler ever running',
    );
    await expectTheme(page, 'light');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  });

  test('the pageshow handler re-applies the saved choice, and aria-pressed with it', async ({
    page,
  }) => {
    // Runs on every engine, so the handler is proven even where every engine
    // skips the real Back above (§6.3).
    await page.goto('/');
    await expectTheme(page, 'dark');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => {
      localStorage.setItem('theme', 'light');
      dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await expectTheme(page, 'light');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  });
});
```


- **The isolated-context guard learns its second cause, red first.** *into a new session* calls `browser.newContext()`, which the real device refuses (the guard's own header says so), so it carries `@requires-isolated-context`. But `isolated-context-tagging.test.ts` accepts that tag only under a `javaScriptEnabled: false` group, and reports this one as **stale**: review pass 1 measured the unit suite going red on it at Step 4. The guard gains the second cause, which it enforces in both directions. First, append these three cases to its self-test group, *analyze() -- the scanner proven on synthetic input*:

```ts
  it('flags an untagged test that opens its own browser context, which the real device refuses', () => {
    const findings = scanned([
      "import { test, expect } from './fixtures';",
      '',
      "test('a new session', async ({ browser }) => {",
      '  const session = await browser.newContext();',
      '  await session.close();',
      '});',
      '',
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('synthetic.spec.ts:3');
    expect(findings[0]).toContain('newContext()');
    expect(findings[0]).toContain(REQUIRES_ISOLATED_CONTEXT_TAG);
  });

  it('accepts that test once tagged', () => {
    expect(
      scanned([
        "import { test, expect } from './fixtures';",
        '',
        "test('a new session', { tag: '@requires-isolated-context' }, async ({ browser }) => {",
        '  const session = await browser.newContext();',
        '  await session.close();',
        '});',
        '',
      ]),
    ).toEqual([]);
  });

  it('opens no context for a newContext() written only in a comment or a string', () => {
    const findings = scanned([
      "import { test, expect } from './fixtures';",
      '',
      "test('a note', { tag: '@requires-isolated-context' }, async ({ page }) => {",
      '  // browser.newContext() is not called here',
      "  await page.goto('/browser.newContext()');",
      '});',
      '',
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('stale');
  });
```

- [ ] **Step 2: Run them and watch them fail.**
  - Run: `npx vitest run tests/unit/isolated-context-tagging.test.ts`. Expected: 3 failed, 15 passed. The three are the corpus test (the new tag is stale), *flags an untagged test that opens its own browser context* and *accepts that test once tagged*. *opens no context for a newContext() written only in a comment or a string* passes by design: it guards the parser reading, and its red is mutation U16 in Task 12.
  - Run: `npx playwright test tests/e2e/theme.spec.ts`
  - Expected: nothing saves yet, so these are **red on every engine where they run**:
    - *across a reload and a second page*;
    - *into a new session*;
    - *a press after a stale saved value*, because nothing is saved;
    - *a double press*, because nothing is saved;
    - *the device … follow it, live*, because nothing moves `aria-pressed`;
    - *the pageshow handler*.
  - Also red: *without MediaQueryList.addEventListener*. Its reload shows dark, since nothing is saved yet. What it exists for, that nothing throws, is proven red by mutation S6 in Task 12.
  - **Green:** *storage refused* and *a change on the device changes nothing*. Each already holds for the Task 5 script. Their reds are mutations S2 and S9 in Task 12.
  - **Skipped:** *a page restored from the back-forward cache*, wherever the engine did not restore the page. Where an engine does restore, it is **red** here instead, because the Task 5 script has no `pageshow` handler yet. Review pass 1 measured no engine restoring: it skipped on all five. Record which engines ran it, locally and in CI's shards: that list goes in the PR body.

- [ ] **Step 3: Implement.** `src/scripts/theme.inline.js` becomes its final form:

```js
(() => {
  const root = document.documentElement;
  const os = matchMedia('(prefers-color-scheme: dark)');
  const saved = () => {
    try {
      const theme = localStorage.getItem('theme');
      return theme === 'light' || theme === 'dark' ? theme : null;
    } catch {
      return null;
    }
  };
  const apply = () => {
    const theme = saved();
    if (theme) root.dataset.theme = theme;
    else delete root.dataset.theme;
  };
  const showing = () => root.dataset.theme ?? (os.matches ? 'dark' : 'light');
  const press = () => {
    for (const toggle of document.querySelectorAll('[data-theme-toggle]'))
      toggle.setAttribute('aria-pressed', String(showing() === 'dark'));
  };
  apply();
  root.dataset.themeSwitch = '';
  document.addEventListener('DOMContentLoaded', press);
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    if (!event.target.closest('[data-theme-toggle]')) return;
    const theme = showing() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = theme;
    try {
      localStorage.setItem('theme', theme);
    } catch {}
    press();
  });
  addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    apply();
    press();
  });
  os.addEventListener?.('change', press);
})();
```

  The device listener is attached last, and only where it exists. An engine without `MediaQueryList.addEventListener` then still has its click and `pageshow` handlers, and throws nothing (Review Focus 3). The empty `catch` is the specified behaviour, not a silent failure. §5 says: if saving throws, the page still switches, and the choice is just not remembered. *storage refused* holds that behaviour.

  The shipped file carries no comments, so that reason goes where the script's explanation lives. In `src/layouts/BaseLayout.astro`'s template comment, the last sentence, "The choice is one localStorage word, written only when the switch is pressed: no cookie, and nothing sent anywhere.", gains a second sentence straight after it: "Where storage is refused, the save is skipped in silence and the page still switches; the choice is simply not remembered (§5), which is what the script's one empty catch is for." Review pass 1 found the empty `catch` justified only in this plan.

  **The guard's second cause.** In `tests/unit/isolated-context-tagging.test.ts`:
  - In the header comment, the paragraph beginning *THE RULE.* has its fourth line, ` * covered test carries the tag; a tagged test nothing covers is stale. A`, replaced by four, so its opening reads:

```ts
 * THE RULE. A `test.use()` that sets `javaScriptEnabled: false` covers the
 * tests Playwright applies it to: every test in its group, nested groups
 * included, or every test in the file when it is called at file level. Each
 * covered test carries the tag. So does a test whose own body calls
 * `newContext()`, since that is the call the real device refuses (#142: a
 * choice carried into a new session). A tagged test that is neither is
 * stale. A
```

    The paragraph's next line, which that `A` runs into, is unchanged.
  - Add, straight before `function staleTagMessage(`:

```ts
function newContextMessage(file: string, decl: Declaration): string {
  return (
    `${file}:${decl.line} -- test('${decl.title}') calls newContext(), and the real device ` +
    'refuses a second browser context (see tests/e2e/fixtures.ts) -- tag it ' +
    `\`${REQUIRES_ISOLATED_CONTEXT_TAG}\` so android-chrome excludes it by design instead of failing.`
  );
}

```

  - `staleTagMessage` becomes:

```ts
function staleTagMessage(file: string, decl: Declaration): string {
  return (
    `${file}:${decl.line} -- test('${decl.title}') is tagged \`${REQUIRES_ISOLATED_CONTEXT_TAG}\` ` +
    'but no test.use({ javaScriptEnabled: false }) covers it and it calls no newContext() -- ' +
    'stale tag, silently costing ' +
    'real-device coverage for a test that no longer needs excluding. Remove the tag, or ' +
    'restore the javaScriptEnabled: false use it is supposed to describe.'
  );
}

```

  - Add, straight before `/** Every group \`decl\` sits in, innermost first. */`:

```ts
/** Whether a test's own body calls `newContext()`: a call, read by the parser, so a comment or a string naming it opens nothing. */
function opensAContext(decl: Declaration): boolean {
  let opens = false;
  // A block body, so `visit` returns nothing: `ts.forEachChild` stops at the
  // first callback that returns something truthy (tests/unit/ast.ts).
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'newContext'
    )
      opens = true;
    ts.forEachChild(node, visit);
  };
  visit(decl.body);
  return opens;
}

```

  - In `analyze`, the three lines from `const tagged = …` to the stale branch become:

```ts
    const opens = opensAContext(decl);
    const tagged = decl.tags.includes(REQUIRES_ISOLATED_CONTEXT_TAG);
    if (covered && !tagged) findings.push(untaggedMessage(file, decl));
    else if (opens && !tagged) findings.push(newContextMessage(file, decl));
    else if (!covered && !opens && tagged)
      findings.push(staleTagMessage(file, decl));
```

  - The corpus group and test are retitled, so they say what they now check:

```ts
describe('a real device has one browser context', () => {
  it('every test run without JavaScript, or calling newContext(), is tagged @requires-isolated-context, and no tag is stale', () => {
```

  The match is by the parser, never by text: review pass 1's mutation M-c replaced it with `node.getText().includes('newContext(')`, and the corpus test went red on `real-device.spec.ts:40`, whose COMMENT names `playwright.request.newContext()`.

- [ ] **Step 4: Run everything and watch it pass.**
  - Run: `npx playwright test tests/e2e/theme.spec.ts tests/e2e/theme-script.spec.ts`. Expected: all green, apart from the recorded skips. The inventory still matches, because it compares with the file as it now reads.
  - Measure the shipped size with `wc -c src/scripts/theme.inline.js` and `gzip -9 -c src/scripts/theme.inline.js | wc -c`. Expected: **1,295 bytes as written, 543 gzipped** (measured in review pass 1). §5 asks for "a few hundred bytes, because every page carries it". The script ships exactly as written (§5), so that holds for what each visit transfers: every page's HTML is served compressed. It does not hold for the bytes as written. Record both figures and that reading in the PR body, so the operator can disagree with it.
  - Then run `npx vitest run tests/unit/isolated-context-tagging.test.ts` (18 passed), `npm run test:unit` and `npm run typecheck`. Formatting is checked in Step 5, after its `--write`.

- [ ] **Step 5: Commit.**

```bash
npx prettier --write src/scripts/theme.inline.js src/layouts/BaseLayout.astro tests/e2e/theme.spec.ts tests/unit/isolated-context-tagging.test.ts
npx prettier --check .
git add src/scripts/theme.inline.js src/layouts/BaseLayout.astro tests/e2e/theme.spec.ts tests/unit/isolated-context-tagging.test.ts
git commit -m "feat(theme): the choice persists, and the switch follows the device

Refs #142"
```

---

### Task 7: Every palette-reading guard runs in both themes

**Files:**
- Modify: `tests/e2e/palette-controls.spec.ts`, `tests/e2e/print-legibility.spec.ts`, `tests/e2e/thai-typography.spec.ts`, `tests/e2e/classroom-groups.spec.ts`, `tests/e2e/classroom-groups-roster.spec.ts`, `tests/e2e/disabled-controls.spec.ts`, `tests/e2e/locale-beta.spec.ts`, `tests/e2e/homepage.spec.ts`

**Interfaces:**
- Consumes: `THEMES`, `themeColour` (Task 1); `emulateTheme`, `expectTheme`, `saveTheme` (Task 4).
- Produces: nothing new. Every edit below is the same move: the assertion runs once per theme, and each run first proves its theme through `emulateTheme`.

- [ ] **Step 1: Derive the set, and check it against this task's list.**
  - Run:

    ```bash
    command grep -l -z -E "toHaveCSS\(\s*'(color|background-color|background|border-color|border-top-color|outline-color|accent-color|box-shadow|fill|stroke)'|\.(backgroundColor|borderColor|borderTopColor|outlineColor|accentColor)\b|style\.color\b|contrastRatio\(|getPropertyValue\('--" tests/e2e/*.spec.ts
    ```

  - `-z` reads each file whole, so `\s*` crosses a line break: prettier wraps a long `toHaveCSS(` call with its property on the next line, and a line-by-line grep cannot see it (review pass 3: it missed `classroom-groups-print.spec.ts:443`).
  - Expected, at `3640af2` plus Tasks 1 to 6: `classroom-groups-print`, `classroom-groups-roster`, `classroom-groups`, `disabled-controls`, `evidence-page`, `homepage`, `locale-beta`, `palette-controls` and `print-legibility`, each `.spec.ts`, plus `theme.spec.ts` from Tasks 4 to 6, which already sets its own themes.
  - **Three differences from that list, all deliberate:**
    - `evidence-page.spec.ts` reads the colours of the evidence page the scripts build, not the site's, so it stays as it is.
    - `classroom-groups-print.spec.ts` reads one colour, the printed row's transparent ground, and only under print media (its `sheet` helper emulates print before any assertion). Paper is white whatever the screen theme, and the dark blocks are screen-only, so a per-theme run would measure the same sheet twice; `print-legibility.spec.ts` is the guard that prints from each theme.
    - `thai-typography.spec.ts` reads no colour, but §6.2 names it, and a theme changes what it measures: the mark's tile padding sits in the `/th/` homepage's `h2`.

    Any other file the command prints is a finding: add it here before going on.

- [ ] **Step 2: Make each guard run per theme.** Every edit adds `import { THEMES } from '../palette';` and the helpers it uses from `'../themes'`. Where a spec already imports from one of those modules, the names join that import.

**`palette-controls.spec.ts`.** Import `emulateTheme`.
- In the per-path test:
  - The title becomes `` `${path}: every control it paints uses a palette colour, in both themes` ``.
  - Everything after `await page.goto(path);` goes inside `for (const theme of THEMES) {`, opened by `await emulateTheme(page, theme);`.
  - Inside that loop:
    - the homepage branch's `return;` becomes `continue;`;
    - the off-palette message becomes `` `${theme}: off-palette control colours on ${path}; the palette resolved to ${allowed.length} values` ``;
    - the shot's label becomes `` `${path}, ${theme}: all ${readings.length} controls drawn from the palette's ${allowed.length} values` ``.
  - The allowed set is still read off `:root` at runtime, so in light it is Studio's.
- In *the controls the browser draws use the brand accent*:
  - the title gains `, in both themes`;
  - everything after the liveness `await expect(boxes.first()).toBeVisible();` goes inside the same loop;
  - the shot's label becomes `` `${theme}: all ${await boxes.count()} browser-drawn controls use --accent ${resolved}` ``.

**`print-legibility.spec.ts`.** Import `emulateTheme`, `expectTheme` and `saveTheme` from `'../themes'`, and `THEMES` from `'../palette'`.
- Add, after `const BODY_TEXT = 4.5;`:

```ts
/**
 * The screens a sheet is printed from (#142 §6.2). Paper ignores the screen
 * theme, so each must print the same legible ink. The last run stamps a
 * saved `dark` choice on a light device: that is the state whose theme block
 * would outrank paper if it were not screen-only.
 */
const PRINT_RUNS = [
  { device: 'light', saved: null },
  { device: 'dark', saved: null },
  { device: 'light', saved: 'dark' },
] as const;

/** Ink a screen shows on its headings, pinned per theme against the brief (#117). */
const SCREEN_INK = { light: 'rgb(17, 24, 33)', dark: 'rgb(234, 242, 255)' } as const;
```

- The per-path test becomes:

```ts
  test(`${path}: every printed ink is readable on white paper, whatever the screen shows`, async ({
    page,
  }) => {
    await page.goto(path);
    for (const { device, saved } of PRINT_RUNS) {
      await emulateTheme(page, device);
      if (saved !== null) await saveTheme(page, saved);
      await prepare(page);
      // In screen media, before the switch to print: on paper the ground is
      // white whatever the theme, so this is the only place it can be read.
      await expectTheme(page, saved ?? device);
      const screen = `${saved ?? device} screen${saved ? ' (a saved choice)' : ''}`;

      await page.emulateMedia({ media: 'print' });
      const inks = await inkInUse(page);

      // Liveness: a page whose text all sat inside ancestors, or a selector
      // that stopped matching, reports zero offenders exactly like a correct
      // page.
      expect(
        inks.length,
        `${path} from a ${screen} rendered no text under print media — the guard measured nothing`,
      ).toBeGreaterThan(0);

      const illegible = inks
        .map(({ colour, where }) => ({ colour, where, rgb: inkOnPaper(colour) }))
        .filter(({ rgb }) => rgb === null || contrast(rgb, PAPER) < BODY_TEXT)
        .map(
          ({ colour, where, rgb }) =>
            `${where} — ${colour} is ${rgb ? contrast(rgb, PAPER).toFixed(2) : '?'}:1 on white`,
        );
      expect(
        searched(illegible, { of: inks, what: `distinct inks on ${path}` }),
        `${path} from a ${screen}: ink that will not survive the printer`,
      ).toEqual([]);
      // Captured while print media is still emulated, which is the whole
      // point: this image is the sheet, not the screen. A blank one IS the
      // defect.
      await shoot(
        page,
        `${path} printed from a ${screen}: all ${inks.length} inks clear ${BODY_TEXT}:1 on white`,
      );
    }
  });
```

- In *a disabled control never depends on its fill reaching paper*, everything after `await page.goto('/classroom-groups');` and the `resolve` helper goes inside `for (const theme of THEMES) {`, opened by `await emulateTheme(page, theme);`. Inside the loop, every assertion names its theme, since a failure in a loop that does not say which run it came from cannot be read (review pass 1):
  - `expect(onScreen).not.toBe('rgba(0, 0, 0, 0)');` becomes ``expect(onScreen, `${theme}: --disabled-fill on screen`).not.toBe('rgba(0, 0, 0, 0)');``;
  - `expect(await resolve('--disabled-fill')).toBe('rgba(0, 0, 0, 0)');` becomes ``expect(await resolve('--disabled-fill'), `${theme}: --disabled-fill on paper`).toBe('rgba(0, 0, 0, 0)');``;
  - the message `` `the screen disabled grey ${onScreen} reached the sheet` `` and the shot's label each gain `${theme}: ` at their start.
- *the screen palette is not dragged down with the print one* becomes:

```ts
test('the screen palette is not dragged down with the print one', async ({
  page,
}) => {
  // The inverse. Fixing print by blackening the ink everywhere would pass
  // every assertion above and ruin the site, so pin that each screen theme
  // still paints its own ink.
  await page.goto('/classroom-groups');
  for (const theme of THEMES) {
    await emulateTheme(page, theme);
    await expect(page.locator('h1')).toHaveCSS('color', SCREEN_INK[theme]);
    await shoot(
      page,
      `on a ${theme} screen the heading keeps its ink, ${SCREEN_INK[theme]}`,
      page.locator('h1'),
    );
  }
});
```

**`thai-typography.spec.ts`.** Import `emulateTheme`. Inside the route loop, everything after the status assertion goes inside `for (const theme of THEMES) {`, opened by `await emulateTheme(page, theme);`.
- The `examined` message, the `searched` `what` and the verdict message each gain `, ${theme}` after `${width}px`.
- The shot's label becomes `` `${route} at ${width}px, ${theme}: ${examined} Thai runs clear of the line above` ``.

**`classroom-groups.spec.ts`.** Extend the `'../themes'` import to `{ THEME_SCRIPT_SOURCE, emulateTheme }`.
- In *the dim stays above the WCAG AA contrast floor for normal text*, the last two statements become:

```ts
    for (const theme of THEMES) {
      await emulateTheme(page, theme);
      const contrast = await contrastRatio(
        page.locator('#cg-results .group').first(),
      );
      expect(contrast, theme).toBeGreaterThanOrEqual(4.5);
    }
```

- In *the out-of-date sentence meets the WCAG AA contrast floor*, the last two statements become:

```ts
    for (const theme of THEMES) {
      await emulateTheme(page, theme);
      expect(await contrastRatio(sentence), theme).toBeGreaterThanOrEqual(4.5);
      await shoot(
        page,
        `${theme}: the out-of-date sentence on its cream notice`,
        page.locator('#cg-stale'),
      );
    }
```

- In *the accent colour still meets the WCAG AA contrast floor*, the last two statements become:

```ts
    for (const theme of THEMES) {
      await emulateTheme(page, theme);
      const contrast = await contrastRatio(page.locator('#cg-go'));
      expect(contrast, theme).toBeGreaterThanOrEqual(4.5);
    }
```

**`classroom-groups-roster.spec.ts`.** Import `emulateTheme`.
- In *is tinted, striped and labelled*, `await expect(row).toHaveCSS('background-color', 'rgb(255, 246, 227)');` becomes:

```ts
    for (const theme of THEMES) {
      await emulateTheme(page, theme);
      await expect(row, theme).toHaveCSS('background-color', 'rgb(255, 246, 227)');
    }
```

- In the per-layout test `` `${name}: absence carries the tint, the stripe and the pill -- same element as the table` ``, the same line becomes the same loop.
- In *the pill text meets the WCAG AA contrast floor*, the last two statements become:

```ts
    for (const theme of THEMES) {
      await emulateTheme(page, theme);
      const contrast = await contrastRatio(
        page.locator('.cg-absent-pill').first(),
      );
      expect(contrast, theme).toBeGreaterThanOrEqual(4.5);
    }
```

- In *the gap warning meets the WCAG AA contrast floor*, the last two statements become:

```ts
    for (const theme of THEMES) {
      await emulateTheme(page, theme);
      expect(await contrastRatio(warning), theme).toBeGreaterThanOrEqual(4.5);
      await shoot(page, `${theme}: the gap warning on its cream ground`, warning);
    }
```

**`disabled-controls.spec.ts`.** Import `emulateTheme`.
- In *roster at the limit — the add buttons and Make groups too*, the three lines from `const { reachable, fill, ink } = await affordances(page);` to `expectDisabledPaint(reachable, fill, ink, 'at-limit');` become:

```ts
    for (const theme of THEMES) {
      await emulateTheme(page, theme);
      const { reachable, fill, ink } = await affordances(page);
      expectNoEntryCursor(reachable, `at-limit, ${theme}`);
      expectDisabledPaint(reachable, fill, ink, `at-limit, ${theme}`);
    }
```

  The next line, `expectAReasonWithoutHover(await reasons(page), 'at-limit');`, stays after the loop.
- In *the disabled placeholder option is excluded deliberately, and it exists*, everything from `const { reachable, excluded, fill, ink } = await affordances(page);` to the end of the test goes inside the same loop, opened by `await emulateTheme(page, theme);`. Its two labels become `` `a sex chosen, ${theme}` ``.

**`locale-beta.spec.ts`.** Import `emulateTheme`. *the badge clears the WCAG AA floor for normal text* becomes:

```ts
  test('the badge clears the WCAG AA floor for normal text, in both themes', async ({
    page,
  }) => {
    // Both placements: the dropdown paints its own background, so the entry
    // badge is a different composite from the one in the summary. The list
    // is opened first, so both badges are measured in each theme.
    await page.goto(localisePath('/', PREFIXED_LOCALES[0]));
    await page.locator(`${SWITCHER} > summary`).click();
    const summaryBadge = page.locator(`${SWITCHER} > summary ${BADGE}`).first();
    const entryBadge = page.locator(`${SWITCHER} li ${BADGE}`).first();
    await expect(entryBadge).toBeVisible();
    for (const theme of THEMES) {
      await emulateTheme(page, theme);
      const summaryRatio = await contrastRatio(summaryBadge);
      expect(summaryRatio, `${theme}: the summary badge`).toBeGreaterThanOrEqual(4.5);
      const entryRatio = await contrastRatio(entryBadge);
      expect(entryRatio, `${theme}: the entry badge`).toBeGreaterThanOrEqual(4.5);
      await shoot(
        page,
        `${theme}: the badge paints ${summaryRatio.toFixed(2)}:1 in the summary and ${entryRatio.toFixed(2)}:1 in the list, floor 4.5:1`,
        page.locator(SWITCHER),
      );
    }
  });
```

**`homepage.spec.ts`.** Import `THEMES` from `'../palette'`, and `emulateTheme` from `'../themes'`. Append this block at the end of *the ShyTalk showcase carries the brand wordmark and links out*:

```ts
    // #142 §3.4, AC14: the mark keeps its own tones in both themes, sits on
    // its own tile in light and on nothing in dark, and prints in the
    // page's own ink with no tile. The tile is pinned to SHYTALK_MARK, the
    // brief, never read back from tokens.css: a value read from the file the
    // page is built from moves with the page, and asserts nothing (S22).
    const tile = {
      light: asComputedRgb(SHYTALK_MARK.tile),
      dark: 'rgba(0, 0, 0, 0)',
    } as const;
    for (const theme of THEMES) {
      await emulateTheme(page, theme);
      await expect(wordmark, theme).toHaveCSS('color', asComputedRgb(SHYTALK_MARK.shy));
      await expect(wordmark, theme).toHaveCSS('background-color', tile[theme]);
    }
    await page.emulateMedia({ media: 'print' });
    const ink = await page
      .locator('body')
      .evaluate((body) => getComputedStyle(body).color);
    await expect(wordmark, 'on paper').toHaveCSS('color', ink);
    await expect(wordmark, 'on paper').toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
```

- [ ] **Step 3: Run the eight specs on every engine.**
  - Run: `npx playwright test tests/e2e/palette-controls.spec.ts tests/e2e/print-legibility.spec.ts tests/e2e/thai-typography.spec.ts tests/e2e/classroom-groups.spec.ts tests/e2e/classroom-groups-roster.spec.ts tests/e2e/disabled-controls.spec.ts tests/e2e/locale-beta.spec.ts tests/e2e/homepage.spec.ts`
  - Expected: all green. These guards already hold in dark, and Studio's pairs all clear in the unit suite.
  - **A red in the light run is a finding about the page, never about the guard.** Read the failing assertion, then check the ground in a browser before believing it, since a composite can report a ground no page paints (standing rule). Fix the component by moving it onto tokens, and re-run. Record each such finding and its fix for the PR body.
  - Then run `npm run test:unit`, which holds the meta-guards on specs: `capture-after-assertion`, `event-collectors`, `absence-liveness`, `viewport-tagging` and `evidence-recording`. Expected: all green. Every `shoot` above comes after an `expect` in the same loop.
  - Then run `npm run typecheck`. Expected: 0/0/0. Eight specs changed, and neither Playwright nor Vitest checks types (review pass 2).

- [ ] **Step 4: Commit.**

```bash
npx prettier --write tests/e2e/palette-controls.spec.ts tests/e2e/print-legibility.spec.ts tests/e2e/thai-typography.spec.ts tests/e2e/classroom-groups.spec.ts tests/e2e/classroom-groups-roster.spec.ts tests/e2e/disabled-controls.spec.ts tests/e2e/locale-beta.spec.ts tests/e2e/homepage.spec.ts
npx prettier --check .
git add tests/e2e/palette-controls.spec.ts tests/e2e/print-legibility.spec.ts tests/e2e/thai-typography.spec.ts tests/e2e/classroom-groups.spec.ts tests/e2e/classroom-groups-roster.spec.ts tests/e2e/disabled-controls.spec.ts tests/e2e/locale-beta.spec.ts tests/e2e/homepage.spec.ts
git commit -m "test(e2e): every palette-reading guard runs in both themes

Refs #142"
```

---

### Task 8: The Tab-order walks meet the switch

**Files:**
- Modify: `tests/e2e/chrome.spec.ts`, `tests/e2e/skip-link.spec.ts`

**Interfaces:**
- Consumes: the switch, `header [data-theme-toggle]` (Task 5).
- Produces: nothing new.

- [ ] **Step 1: Update the walks.**

In `chrome.spec.ts`, the test titled `'desktop: nav is keyboard-reachable in order (WCAG 2.1.1)'` gets the title `'desktop: the header is keyboard-reachable in order (WCAG 2.1.1)'`. Its statements from `await page.locator('header details.lang-switch > summary').focus();` to the end of its `for` loop become:

```ts
      const languages = page.locator('header details.lang-switch > summary');
      await languages.focus();
      // The theme switch sits immediately before the language switcher
      // (#142 §5). Reached by Shift+Tab, never focused directly, so a switch
      // taken out of the Tab order (tabindex="-1") is stepped over and this
      // fails where a direct focus() would still succeed.
      await page.keyboard.press('Shift+Tab');
      await expect(page.locator('header [data-theme-toggle]')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(languages).toBeFocused();

      for (const label of ['ShyTalk', 'Tools', 'Contact']) {
        await page.keyboard.press('Tab');
        await expect(
          page.locator('header nav a', { hasText: label }),
        ).toBeFocused();
      }
```

In *every header link can take focus, on every engine*, add `'header [data-theme-toggle]',` to the selector list, straight before `'header details.lang-switch > summary',`.

In `skip-link.spec.ts`, *it is the FIRST thing a Tab reaches*: the comment's last two lines, which break mid-phrase, so they cannot be matched as one string (review pass 1), become:

```ts
    // without it a keyboard user crosses the wordmark, the hamburger, the
    // theme switch, the language switcher and three nav links before the
    // first form field.
```

Append to the test:

```ts
    // ...and on through the header in the bar's own order (#142): every
    // control it shows, derived from the DOM, with the theme switch
    // immediately before the language switcher.
    const controls = await page.locator('header .bar').evaluate((bar) =>
      [...bar.querySelectorAll('a[href], summary, button')]
        .filter((el) => el.checkVisibility())
        .map((el, i) => {
          el.setAttribute('data-walk', String(i));
          if (el.matches('[data-theme-toggle]')) return 'theme switch';
          if (el.matches('.lang-switch > summary')) return 'language switcher';
          return el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '';
        }),
    );
    const languages = controls.indexOf('language switcher');
    expect(
      controls[languages - 1],
      `the theme switch sits right before the language switcher: ${controls.join(', ')}`,
    ).toBe('theme switch');
    for (const [i, control] of controls.entries()) {
      await page.keyboard.press('Tab');
      await expect(page.locator(':focus'), control).toHaveAttribute(
        'data-walk',
        String(i),
      );
    }
```

- [ ] **Step 2: Run both specs and watch them pass.**
  - Run: `npx playwright test tests/e2e/chrome.spec.ts tests/e2e/skip-link.spec.ts`
  - Expected: all green. The walks skip on WebKit as before. Their reds are mutation S15 in Task 12, the switch taken out of the Tab order.
  - Then run `npm run test:unit` and `npm run typecheck`. Expected: all green, and 0/0/0.

- [ ] **Step 3: Commit.**

```bash
npx prettier --write tests/e2e/chrome.spec.ts tests/e2e/skip-link.spec.ts
npx prettier --check .
git add tests/e2e/chrome.spec.ts tests/e2e/skip-link.spec.ts
git commit -m "test(e2e): the Tab-order walks expect the switch before the language switcher

Refs #142"
```

---

### Task 9: The deployed sites prove the switch, and the phones pin the theme

**Files:**
- Modify: `tests/themes.ts`, `tests/dev/dev-sanity.spec.ts`, `tests/prod/prod-sanity.spec.ts`
- Modify: `tests/e2e/fixtures.ts`, `tests/device/ios/session.ts`, `tests/device/ios/journeys.journey.ts`

**Interfaces:**
- Consumes: `expectTheme` (Task 4); `themeColour` (Task 1).
- Produces: `expectTheSwitchPersists` in `tests/themes.ts`, the deployed-site switch check.

- [ ] **Step 1: The sanity suites.** Both suites run the same check, so its body has one home: two identical bodies in two files fail `duplication.test.ts` ("a function body has one home across files", measured at 1.000 in review pass 1). Append to `tests/themes.ts`:

```ts

/**
 * The switch, proven on a deployed site (#142 §6.2): a press changes the page,
 * and the choice survives a reload. dev-sanity and prod-sanity each run it
 * against their own host, so it has one home here.
 */
export async function expectTheSwitchPersists(page: Page): Promise<void> {
  const toggle = page.locator('header [data-theme-toggle]');
  await page.goto('/');
  await expectTheme(page, 'dark');
  await toggle.click();
  await expectTheme(page, 'light');
  await page.reload();
  await expectTheme(page, 'light');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
}
```

  Then, in `tests/dev/dev-sanity.spec.ts` and in `tests/prod/prod-sanity.spec.ts`, add `import { expectTheSwitchPersists } from '../themes';` after the last import, and append:

```ts
// The switch is a rendering fact, so the deployed site's browser run proves
// it (#142 §6.2): it changes the page, and the choice survives a reload.
test('the theme switch changes the page, and the choice survives a reload', async ({
  page,
}) => {
  await expectTheSwitchPersists(page);
});
```

- [ ] **Step 2: Run both against local builds, one per suite.** Neither suite runs on a pull request (#335), so a stale fact in one fails the deploy after the merge instead.
  - **Stop every preview first:** `npx astro preview stop`, then `npx astro preview status` must say *No preview server is running*. Astro 7.3 daemonises `astro preview` when an agent runs it (`pipeline-wiring.test.ts`, the comment above *the e2e server is supervised*), and it allows **one** preview per project. With another already running, `--port 4399` prints *Preview server already running* and exits 0 having started nothing, and both suites then fail every test with `ERR_CONNECTION_REFUSED` (measured in review pass 1). Run by hand outside an agent, `npx astro preview` stays in the foreground instead: start it in the background there.
  - **dev-sanity, against a dev build,** as `deploy-dev.yml` builds it:

    ```bash
    PUBLIC_SHYTALK_URL=https://dev.shytalk.shyden.co.uk npm run build
    npx astro preview --port 4399
    for i in $(seq 1 20); do [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4399/)" = 200 ] && break; sleep 1; done
    WEB_BASE_URL=http://localhost:4399 npx playwright test -c playwright.dev.config.ts
    npx astro preview stop
    ```

    Expected: 27 passed, 2 failed. The two are *robots.txt disallows all crawling* and *an unauthenticated request is challenged with 401*, which fail on every local build: Cloudflare's `functions/_middleware.js` serves them, and `astro preview` never runs it.
  - **prod-sanity, against a production build.** A dev build fails prod-sanity's *the outbound ShyTalk link points at PROD ShyTalk* by construction, so build again without the variable:

    ```bash
    npm run build
    npx astro preview --port 4399
    for i in $(seq 1 20); do [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4399/)" = 200 ] && break; sleep 1; done
    WEB_BASE_URL=http://localhost:4399 npx playwright test -c playwright.prod.config.ts --retries=0
    npx astro preview stop
    ```

    Expected: 18 passed, 3 failed, until #338 lands. The three are *the homepage renders, and its stylesheet actually applied*, *the Glory Points calculator computes, not just loads* and *the outbound ShyTalk link points at PROD ShyTalk, never dev*. They are stale facts already on `develop`: the same three fail on a production build of `3640af2`, which review pass 1 ran as the control, and they are filed as #338.
  - In both suites the new switch test passes. Any other red is a finding.

- [ ] **Step 3: Android pins the theme per page.** In `tests/e2e/fixtures.ts`, the real device's `page` fixture:
  - its signature `page: async ({ context, baseURL }, use, testInfo) => {` becomes `page: async ({ context, baseURL, colorScheme }, use, testInfo) => {`;
  - straight after `const page = await context.newPage();`, add:

```ts
    // The theme is pinned per test (#142 §6.2). The phone's context was made
    // by Chrome, not by Playwright, so the `colorScheme` option never reaches
    // it by itself, and a run would follow the phone's own appearance setting.
    // Emulating it on each page applies the project's scheme, or a test's own
    // `test.use({ colorScheme })`, over CDP (Emulation.setEmulatedMedia).
    await page.emulateMedia({ colorScheme });
```

- [ ] **Step 4: iOS pins the theme per load.** In `tests/device/ios/session.ts`:
  - add `import { themeColour } from '../../palette';` after the file's last import;
  - in `navigateToPath`, replace `await driver.navigate(`${baseUrl}${path}`);` with:

```ts
      // The palette is pinned per load (#142 §6.2), so no journey's result
      // depends on the phone's own appearance setting. WebDriver cannot
      // emulate a media feature on Safari, so the lever is the one the page
      // itself honours: a saved choice, stamped on the origin BEFORE the
      // measured load, which the load then proves it rendered. Dark, the
      // palette every journey was written against.
      await driver.navigate(`${baseUrl}/`);
      await driver.executeScript("localStorage.setItem('theme', 'dark');");
      await driver.navigate(`${baseUrl}${path}`);
      const ground = await driver.executeScript<string>(
        'return getComputedStyle(document.documentElement).backgroundColor;',
      );
      if (ground !== themeColour('dark', '--bg'))
        throw new Error(
          `${path} rendered the ground ${ground}, not the dark theme's ` +
            `${themeColour('dark', '--bg')}: the stamped choice did not take`,
        );
```

  In `tests/device/ios/journeys.journey.ts`, Journey 10's last assertion, the one reading `Object.keys(stored).every((k) => k.startsWith('cg-'))`, becomes:

```ts
      // `theme` is the harness's own stamp (navigateToPath pins the palette,
      // #142), not a key this page writes.
      const written = Object.keys(stored).filter((key) => key !== 'theme');
      expect(
        written.every((k) => k.startsWith('cg-')),
        `every key this page writes starts "cg-" (${locale}): ${JSON.stringify(written)}`,
      ).toBe(true);
```

- [ ] **Step 5: Check what can be checked without the phones.**
  - Run `npm run test:unit`. Expected: all green, `duplication` included (the switch check has one home).
  - Run `npm run typecheck`. Expected: 0/0/0, covering `fixtures.ts`, `session.ts` and the journeys.
  - Run `npx playwright test -c playwright.device.config.ts --list`. Expected: exit 0 with no phones attached, listing 613 tests in 34 files (measured at this point in review pass 1). `theme.spec.ts` lists 22: none of its three `@requires-isolated-context` tests, the two without JavaScript and *into a new session*.
  - The gauntlet itself, `npm run test:devices`, needs the phones attached, so it is the operator's (§6.2 names it; #17's AC18 is the same kind of step). Record that in the PR body. Do not describe it as run.

- [ ] **Step 6: Commit.**

```bash
npx prettier --write tests/themes.ts tests/dev/dev-sanity.spec.ts tests/prod/prod-sanity.spec.ts tests/e2e/fixtures.ts tests/device/ios/session.ts tests/device/ios/journeys.journey.ts
npx prettier --check .
git add tests/themes.ts tests/dev/dev-sanity.spec.ts tests/prod/prod-sanity.spec.ts tests/e2e/fixtures.ts tests/device/ios/session.ts tests/device/ios/journeys.journey.ts
git commit -m "test: the deployed sites prove the switch, and the phones pin the theme

Refs #142"
```

---

### Task 10: Every page in both themes, captured behind an assertion

**Files:**
- Create: `tests/e2e/theme-gallery.spec.ts`

**Interfaces:**
- Consumes: `THEMES` (Task 1); `expectTheme` (Task 4); `expectNoHorizontalScroll` (`tests/viewport.ts`); `withGroups` (`tests/e2e/helpers.ts`); `sitePaths` (`tests/site-pages.ts`).
- Produces: the captures §6.7's evidence page is built from (Task 14).

- [ ] **Step 1: Write the spec.** Create `tests/e2e/theme-gallery.spec.ts`:

```ts
import { test, expect } from './fixtures';
import { recorded, shoot } from './evidence';
import { withGroups } from './helpers';
import { THEMES } from '../palette';
import { sitePaths } from '../site-pages';
import { expectTheme } from '../themes';
import { expectNoHorizontalScroll } from '../viewport';
import { DEFAULT_LOCALE, LOCALES, localisePath } from '../../src/lib/i18n';

/**
 * Every built page in both themes (#142 §6.7), in every locale, at the
 * narrowest width the site supports and a laptop's. The assertion is the one
 * a theme can break on any page: it renders its theme, and nothing scrolls
 * sideways. The captures are what the operator reviews on the evidence page.
 */
const WIDTHS = [320, 1280];

// File level: `recorded` sets `video`, which Playwright refuses inside a
// describe ("Cannot use({ video }) in a describe group, because it forces a
// new worker"), and every test here acts, so all of them record.
test.use(recorded);

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    for (const width of WIDTHS) {
      for (const locale of LOCALES) {
        test(
          `${locale} at ${width}px: every page renders the theme, with no sideways scroll`,
          { tag: '@emulated-viewport' },
          async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
            const paths = sitePaths().map((path) => localisePath(path, locale));
            if (locale === DEFAULT_LOCALE) paths.push('/definitely-not-a-page');
            for (const path of paths) {
              await page.goto(path);
              await expectTheme(page, theme);
              await expectNoHorizontalScroll(page);
              await shoot(page, `${path}, ${theme}, ${width}px`);
            }
          },
        );
      }
    }

    test.describe('interactive states', () => {
      test(
        'the header: the phone menu, the language list and the focused switch',
        { tag: '@emulated-viewport' },
        async ({ page }) => {
          await page.setViewportSize({ width: 390, height: 844 });
          await page.goto('/');
          await expectTheme(page, theme);
          const menu = page.locator('header details.menu > summary');
          await menu.click();
          await expect(page.locator('header nav a').first()).toBeVisible();
          await shoot(page, `${theme}: the phone menu, open`);
          await menu.click();

          const languages = page.locator('header details.lang-switch');
          await languages.locator('summary').click();
          await expect(languages.locator('a.entry').first()).toBeVisible();
          await shoot(
            page,
            `${theme}: the language list, open beside the compact label`,
            languages,
          );
          await languages.locator('summary').click();

          const toggle = page.locator('header [data-theme-toggle]');
          await page.keyboard.press('Shift');
          await toggle.focus();
          await expect(toggle).toBeFocused();
          await shoot(page, `${theme}: the theme switch, focused`, page.locator('header'));
        },
      );

      test(
        '/classroom-groups: results, the roster, the docked bar, print and the full-screen board',
        { tag: '@emulated-viewport' },
        async ({ page }) => {
          await page.setViewportSize({ width: 1280, height: 900 });
          // A refused requestFullscreen lands in the overlay on every engine,
          // so the board renders the same way wherever this runs.
          await page.addInitScript(() => {
            Element.prototype.requestFullscreen = () =>
              Promise.reject(new Error('refused'));
          });
          await withGroups(page);
          await expectTheme(page, theme);
          await expect(page.locator('#cg-results .group').first()).toBeVisible();
          await shoot(page, `${theme}: /classroom-groups with results`);

          await expect(page.locator('#cg-roster tbody tr').first()).toBeVisible();
          await shoot(page, `${theme}: the roster`, page.locator('#cg-roster'));

          await page.evaluate(() => scrollTo(0, 0));
          const bar = page.locator('p.actions');
          await expect(bar).toHaveCSS('position', 'sticky');
          // Docking is proved before the picture, as visual.spec proves it:
          // sticky holds whether or not the bar has reached the fold.
          const { bottom, fold } = await bar.evaluate((el) => ({
            bottom: el.getBoundingClientRect().bottom,
            fold: window.innerHeight,
          }));
          expect(bottom, 'the action bar rests on the fold').toBeCloseTo(fold, 0);
          await shoot(page, `${theme}: the action bar, docked`);

          await page.emulateMedia({ media: 'print' });
          await expect(page.locator('#cg-results .group').first()).toBeVisible();
          await shoot(page, `${theme}: the print preview`);
          await page.emulateMedia({ media: 'screen' });

          await page.getByRole('button', { name: 'Full screen' }).click();
          await expect(page.locator('#cg-board')).toBeVisible();
          await shoot(page, `${theme}: the full-screen board`);
        },
      );
    });
  });
}
```

- [ ] **Step 2: Run it on every engine.**
  - Run: `npx playwright test tests/e2e/theme-gallery.spec.ts`
  - Expected: green on `chromium`, `firefox`, `webkit`, `mobile-chrome` and `mobile-safari`. That is 24 tests per engine: 2 themes × (2 widths × 5 locales + 2 states).
  - Measured in review pass 1: 120 passed. Written with `test.use(recorded)` inside *interactive states*, the file failed to load at all, and it took every Playwright run that loads it down with it: the device `--list` read 0 tests. The docking assertion held in both themes on every engine (10 of 10).
  - A sideways scroll in light alone is a finding about the page. Fix it at its container, and re-run.
  - Then run `npm run test:unit`. Expected: all green, including `viewport-tagging`, `capture-after-assertion` and `evidence-recording`. Each resize sits in its tagged test's own body, and each `shoot` follows an `expect`.
  - Then run `npm run typecheck`. Expected: 0/0/0.

- [ ] **Step 3: Commit.**

```bash
npx prettier --write tests/e2e/theme-gallery.spec.ts
npx prettier --check .
git add tests/e2e/theme-gallery.spec.ts
git commit -m "test(e2e): every page in both themes, in every locale, captured behind an assertion

Refs #142"
```

---

### Task 11: The visual suite holds both themes

**Files:**
- Modify: `tests/e2e/visual.spec.ts`
- Modify: `tests/e2e/__screenshots__/`: the 12 dark baselines are re-captured, and 12 light ones are added.

**Interfaces:**
- Consumes: `THEMES` (Task 1); `expectTheme` (Task 4).
- Produces: 24 baselines. The dark set keeps its file names. The light set is `<name>-<label>-light-linux.png`.

- [ ] **Step 1: Run each view in both themes.** In `tests/e2e/visual.spec.ts`:
  - Add `import { THEMES } from '../palette';` and `import { expectTheme } from '../themes';`.
  - Wrap the whole `for (const { label, viewport } of WIDTHS) { … }` block in:

```ts
for (const theme of THEMES) {
  // Dark keeps today's file names, so its diff reads file by file against
  // the baselines it replaces; light is new, and says so (#142 §6.5).
  const suffix = theme === 'dark' ? '' : `-${theme}`;

  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    /* the existing `for (const { label, viewport } of WIDTHS)` block */
  });
}
```

  - Inside that block:
    - the three snapshot names `` `${name}-${label}.png` ``, `` `classroom-groups-roster-${label}.png` `` and `` `classroom-groups-docked-${label}.png` `` each gain `${suffix}` before `.png`;
    - each of the three tests calls `await expectTheme(page, theme);` straight after it navigates: after `page.goto`, or after `openRoster`.
  - That last addition asserts the theme before any picture is taken. A light baseline captured on a dark page would otherwise be a picture of the wrong palette, and every later run would pass against it.
  - Run `npx prettier --write tests/e2e/visual.spec.ts`, then `npm run typecheck` (0/0/0) and `npm run test:unit`: `browser-matrix` and `pipeline-wiring` read `visual.spec.ts`, and must stay green.

- [ ] **Step 2: Capture, in the pinned container, with nothing else running.**
  - Stop your own previews and background jobs first (`npx astro preview stop`, and any `npm run preview` you started). Leave any container that is not yours running: the two `sonarqube-mcp` containers are the operator's. Their memory is why the durations are worth watching.
  - Run: `npm run test:visual:update`
  - Expected:
    - 24 passed;
    - `git status --short tests/e2e/__screenshots__` lists the 12 dark baselines as modified and 12 `-light-linux.png` files as new, and nothing else.

- [ ] **Step 3: Review the dark diff, by measurement and then by eye.**
  - Extract the 12 old dark files: `mkdir -p "$S/old"`, then, for each modified file, `git show HEAD:tests/e2e/__screenshots__/<file> > "$S/old/<file>"`, where `$S` is the scratchpad.
  - Measure where every changed pixel sits, with Playwright's own PNG reader (this Mac has no other). Write `$S/diffbox.cjs`:

```js
const { createRequire } = require('module');
const req = createRequire('/Users/shyden/Developer/Repos/shyden.co.uk/package.json');
const { PNG } = req('playwright-core/lib/utilsBundle');
const fs = require('fs'); const path = require('path');
const [oldDir, newDir] = process.argv.slice(2);
for (const f of fs.readdirSync(oldDir).sort()) {
  const a = PNG.sync.read(fs.readFileSync(path.join(oldDir, f))), b = PNG.sync.read(fs.readFileSync(path.join(newDir, f)));
  if (a.width !== b.width || a.height !== b.height) { console.log(`${f}: SIZE ${a.width}x${a.height} -> ${b.width}x${b.height}`); continue; }
  let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const i = (y * a.width + x) * 4;
    if (a.data[i] !== b.data[i] || a.data[i+1] !== b.data[i+1] || a.data[i+2] !== b.data[i+2] || a.data[i+3] !== b.data[i+3]) { n++; if (x<x0)x0=x; if (y<y0)y0=y; if (x>x1)x1=x; if (y>y1)y1=y; }
  }
  console.log(`${f}: ${a.width}x${a.height}, ${n} px differ` + (n ? `, box x ${x0}-${x1}, y ${y0}-${y1}` : ''));
}
```

  - Run `node "$S/diffbox.cjs" "$S/old" tests/e2e/__screenshots__`. Expected, as measured in review passes 1 and 2: every file keeps its size, and every changed pixel sits in the header band, `y 23-44`, where the switch now sits before the language switcher. Anti-aliasing noise may add a few pixels elsewhere, each off by one channel level: pass 1 saw 5 below the header in the two roster views, and pass 2 saw none. Noise is a handful of single-level pixels; anything more is not noise.
  - Anything else is a finding. Aurora's values did not change, so nothing else may move. Stop and trace it before going on.
  - Then read by eye one old and new pair, and one light file per view. Each light file must show Studio: a cool grey ground, white cards, the mark on its dark tile, and a moon in the switch.
  - Every full-page light file also shows a faint horizontal edge at the viewport's height (900px on desktop). It is not a defect. `body::before` is `position: fixed; inset: 0`, so a full-page capture paints the atmosphere over the first viewport only, while a visitor always sees it cover the screen. The edge was always in the dark baselines too, and there it cannot be seen. Measured in review pass 2 at x = 60 on `home-en-desktop`: dark goes from `4,8,16` to `4,7,13` across y = 900, and light from `234,237,241` to `238,241,244`. Task 14 says so on the evidence page.

- [ ] **Step 4: Prove the light set compares, then watch it fail and pass (§6.5).**
  - Commit the baselines first: `git add tests/e2e/visual.spec.ts tests/e2e/__screenshots__ && git commit -m "test(visual): 24 baselines, each view in both themes" -m "Refs #142"`.
  - Run `npm run test:visual`, unchanged. Expected: 24 passed, and `git status --short tests/e2e/__screenshots__` prints nothing. It compared, and wrote nothing.
  - **A stability timeout is not a comparison.** `Failed to take two consecutive stable screenshots` under `Timeout: 5000ms` means the capture never settled inside `toHaveScreenshot`'s five seconds. The long mobile homepages can miss that under the container's `linux/amd64` emulation, because their first full-page capture is known to differ from the second. Review pass 3 met it once in its three full runs, on the light mobile `home-id` view, and that view then passed twice when run alone. Keep the failing block's text, then re-run that view alone with `-g`. Green alone goes in the PR body as a flake, with its text. Red again is a finding. Never re-capture to make it pass. This holds for every visual run in this plan, Task 13's included, and `retries` is 0 there and in CI.
  - In `tokens.css`'s bare `:root`, change `--accent: #006652;` to `--accent: #0a66c2;`. Then run `npm run test:visual -- -g "light theme"`. Expected: red. Every light view whose picture shows the accent fails, and each diff image marks the accent's regions: links, kickers and the filled buttons.
  - Restore with `git checkout HEAD -- src/styles/tokens.css`, check that `git diff --quiet HEAD -- src/styles/tokens.css` exits 0, and run `npm run test:visual` again. Expected: 24 passed, and nothing written.
  - Record the red run's count and the regions its diffs named, for the PR body.

- [ ] **Step 5: Prove the theme assertion itself.** In `visual.spec.ts`, change `test.use({ colorScheme: theme });` to `test.use({ colorScheme: theme === 'dark' ? 'light' : 'dark' });`, and run `npm run test:visual -- -g "light theme"`.
  - Expected: 12 red, each on *the page rendered the light theme*, before any picture is compared.
  - Restore with `git checkout HEAD -- tests/e2e/visual.spec.ts`, and confirm with `git diff --quiet HEAD -- tests/e2e/visual.spec.ts`.

- [ ] **Step 6: Nothing further to commit** unless Step 3 found something. The baselines and the spec were committed in Step 4.

---

### Task 12: Watch every guard fail

**Files:**
- Create (gitignored, never committed): `.superpowers/sdd/2026-09-24-light-mode-2-studio/mutate142b.mjs`, its log `mut142b.log`, and its reports.

- [ ] **Step 1: Write the harness, on a committed tree, with every prediction in it before any run.**
  - Each mutation's anchors must match exactly the number of times the mutation says, which is once unless it says otherwise, or the mutation is not run.
  - Every edited file is restored from `HEAD` and checked. A created file is deleted.
  - A run with no verdict is BROKEN, never RED. A run whose total differs from its baseline's is also BROKEN.
  - A baseline is taken once per runner and configuration, and whatever fails in it, such as dev-sanity's two Cloudflare Functions tests, is subtracted from every mutation's run.
  - Every row is exact strings, checked against the prettier-formatted files, and `--dry` checks every anchor's count without running anything. Review pass 1 ran `--dry` on a materialised tree, and all 43 rows matched.
  - A row may also name output it `says` and output it must `never` say, read from the run's messages. U7 uses them to prove its failure is the shade-pool subset, not a flat pair.
  - A row may name tests it `may` fail, when the mutation itself creates a race and the guard is not what decides it. They are allowed either way, never counted, and printed when they fail. S1 is the only such row (review pass 3).
  - `sanity()` builds twice, dev for dev-sanity and production for prod-sanity, and `serve()` stops any preview first and waits for a 200, because a second `astro preview` is a silent no-op (Task 9 Step 2).
  - Run it with no preview running: the browser runners start their own server on 4321.

```js
// mutate142b.mjs: node .superpowers/sdd/2026-09-24-light-mode-2-studio/mutate142b.mjs [--dry] [ID ...]
// From the repo root, on a committed tree, with NO preview server running
// (`npx astro preview status`). One Playwright run at a time, at the default
// worker count: never raise it (standing rule). --dry checks every anchor's
// count and runs nothing.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const DIR = '.superpowers/sdd/2026-09-24-light-mode-2-studio';
const DRY = process.argv.includes('--dry');
const IDS = process.argv.slice(2).filter((a) => a !== '--dry');
const UNIT = [
  'wcag',
  'palette',
  'tokens',
  'contrast',
  'shytalk-brand',
  'colour-literals',
  'locale-switcher',
  'isolated-context-tagging',
].map((name) => `tests/unit/${name}.test.ts`);

function unit() {
  const r = spawnSync('npx', ['vitest', 'run', ...UNIT], { encoding: 'utf8' });
  const out = `${r.stdout}\n${r.stderr}`;
  const totals = /Tests\s+(?:(\d+) failed \| )?(\d+) passed \((\d+)\)/.exec(out);
  if (!totals) return { broken: 'no totals line' };
  return {
    total: Number(totals[3]),
    failing: [...out.matchAll(/^\s+× (.+?)(?: \d+ms)?$/gm)].map((m) => m[1]),
    out,
  };
}

function typecheck() {
  const r = spawnSync('npx', ['astro', 'check'], { encoding: 'utf8' });
  const out = `${r.stdout}\n${r.stderr}`;
  const errors = /^- (\d+) errors?$/m.exec(out);
  if (!errors) return { broken: 'no error count' };
  return {
    total: 1,
    failing: Number(errors[1]) > 0 ? [`astro check: ${errors[1]} errors`] : [],
    out,
  };
}

/** One Playwright run; every unexpected result by project and title path, and every error message, from its JSON report. */
function playwright(args, env = {}) {
  const report = `${DIR}/report.json`;
  rmSync(report, { force: true });
  const r = spawnSync('npx', ['playwright', 'test', ...args, '--reporter=json'], {
    encoding: 'utf8',
    env: { ...process.env, ...env, PLAYWRIGHT_JSON_OUTPUT_NAME: report },
  });
  if (!existsSync(report)) return { broken: `no report, exit ${r.status}: ${r.stderr.slice(-300)}` };
  const json = JSON.parse(readFileSync(report, 'utf8'));
  if ((json.errors ?? []).length > 0)
    return { broken: json.errors.map((e) => e.message).join('; ').slice(0, 300) };
  const failing = [];
  const messages = [];
  let total = 0;
  const walk = (suite, path) => {
    for (const spec of suite.specs ?? [])
      for (const t of spec.tests) {
        total += 1;
        if (t.status !== 'unexpected') continue;
        failing.push(`${t.projectName} › ${[...path, spec.title].join(' › ')}`);
        for (const result of t.results) for (const e of result.errors ?? []) messages.push(e.message ?? '');
      }
    for (const child of suite.suites ?? []) walk(child, [...path, child.title]);
  };
  for (const suite of json.suites) walk(suite, []);
  return { total, failing, out: messages.join('\n') };
}

const e2e = (files, projects) => () =>
  playwright([...files, ...projects.map((p) => `--project=${p}`)]);

/** Serve dist/ on 4399 and prove it answers. `npx astro preview` returns at once only because Astro 7.3 daemonises it under agent detection (pipeline-wiring.test.ts); it allows ONE preview per project, so a preview already running makes this a silent no-op (#142 pass 1, finding 30). */
function serve() {
  spawnSync('npx', ['astro', 'preview', 'stop']);
  spawnSync('npx', ['astro', 'preview', '--port', '4399'], { encoding: 'utf8' });
  const up = spawnSync('curl', ['-s', '-o', '/dev/null', '--retry', '20', '--retry-connrefused', '--retry-delay', '1', '-w', '%{http_code}', 'http://localhost:4399/'], { encoding: 'utf8' });
  return up.stdout.trim() === '200';
}

/** The deployed-site suites against local builds, as Task 9 runs them: a dev build for dev-sanity, a production build for prod-sanity. */
function sanity() {
  const suites = [
    ['playwright.dev.config.ts', { PUBLIC_SHYTALK_URL: 'https://dev.shytalk.shyden.co.uk' }],
    ['playwright.prod.config.ts', {}],
  ];
  const runs = [];
  try {
    for (const [config, buildEnv] of suites) {
      const env = { ...process.env, ...buildEnv };
      if (!('PUBLIC_SHYTALK_URL' in buildEnv)) delete env.PUBLIC_SHYTALK_URL;
      if (spawnSync('npm', ['run', 'build'], { encoding: 'utf8', env }).status !== 0) return { broken: `build for ${config} failed` };
      if (!serve()) return { broken: `no 200 on 4399 for ${config}` };
      runs.push(playwright(['-c', config, '--retries=0'], { WEB_BASE_URL: 'http://localhost:4399' }));
      spawnSync('npx', ['astro', 'preview', 'stop']);
    }
  } finally {
    spawnSync('npx', ['astro', 'preview', 'stop']);
  }
  const broken = runs.find((r) => r.broken);
  if (broken) return { broken: broken.broken };
  return {
    total: runs.reduce((n, r) => n + r.total, 0),
    failing: runs.flatMap((r) => r.failing),
    out: runs.map((r) => r.out).join('\n'),
  };
}

const RUNNERS = {
  unit,
  typecheck,
  sanity,
  theme: e2e(['tests/e2e/theme.spec.ts'], ['chromium']),
  walks: e2e(['tests/e2e/chrome.spec.ts', 'tests/e2e/skip-link.spec.ts'], ['chromium']),
  room: e2e(['tests/e2e/header-room.spec.ts'], ['chromium']),
  script: e2e(['tests/e2e/theme-script.spec.ts'], ['content']),
  print: e2e(['tests/e2e/print-legibility.spec.ts'], ['chromium']),
  palette: e2e(['tests/e2e/palette-controls.spec.ts'], ['chromium']),
  home: e2e(['tests/e2e/homepage.spec.ts'], ['chromium']),
  gallery: e2e(['tests/e2e/theme-gallery.spec.ts'], ['chromium']),
};

const TOKENS = 'src/styles/tokens.css';
const SCRIPT = 'src/scripts/theme.inline.js';
const SWITCH = 'src/components/ThemeSwitch.astro';
const LAYOUT = 'src/layouts/BaseLayout.astro';
const GUARD = 'tests/unit/isolated-context-tagging.test.ts';
const SAVE = "    try {\n      localStorage.setItem('theme', theme);\n    } catch {}\n";
const U8 = { file: TOKENS, anchor: '  --wordmark-tile: #0f0d15;', to: '  --wordmark-tile: #0f0d16;' };

// Each row: { id, runner, edits: [{ file, anchor, to, count? }] | create + body, fails: [title
// substrings], count, may?: [title substrings], says?: [output substrings], never?: [output
// substrings] }. Each `fails` substring must match a newly failing title, newly failing titles
// outside `may` must number `count`, and the run's output must hold every `says` and no `never`.
// `may` names a test the mutation can fail by a race it creates, not by the guard: it is allowed
// either way and never counted.
const MUTATIONS = [
  { id: 'U1', runner: 'unit', edits: [{ file: 'tests/wcag.ts', anchor: '  if (/^transparent$/i.test(text)) return { rgb: [0, 0, 0], alpha: 0 };\n', to: '' }],
    fails: ['reads transparent as CSS defines it', 'writes a colour the way getComputedStyle reports it', 'dark: every declared pair clears'], count: 3 },
  { id: 'U2', runner: 'unit', edits: [{ file: 'tests/palette.ts', anchor: 'cssRules(css).filter(({ declarations }) =>', to: 'cssRules(css).filter(({ chain, declarations }) => chain.at(-1) === ":root[data-theme=\'dark\']" &&' }],
    fails: ['finds every dark block by its color-scheme', 'keeps every dark block screen-only, and has both states it needs', 'declares the same tokens', 'declares color-scheme only beside a palette'], count: 4 },
  { id: 'U3', runner: 'unit', edits: [{ file: 'tests/palette.ts', anchor: "  if (theme === 'light') return root;", to: "  if (theme === 'light' || theme === 'dark') return root;" }],
    fails: ['reads light from bare :root, and dark as', 'refuses a dark theme that no block declares', 'dark: pins the disabled fill', 'puts the ShyTalk mark on its own tile'], count: 4 },
  { id: 'U4', runner: 'unit', edits: [{ file: TOKENS, anchor: '--danger: #ff6b5a;\n    --border: rgb(255 255 255 / 0.11);', to: '--danger: #ff6b5b;\n    --border: rgb(255 255 255 / 0.11);' }],
    fails: ['declares the same tokens, with the same values, in every dark block'], count: 1 },
  { id: 'U5', runner: 'unit', edits: [{ file: TOKENS, anchor: '    color-scheme: dark;\n', to: '    color-scheme: dark;\n    --orphan: 1px;\n', count: 2 }],
    fails: ['defines no token only inside a dark block'], count: 1 },
  { id: 'U6', runner: 'unit', edits: [{ file: TOKENS, anchor: '@media screen and (prefers-color-scheme: dark) {', to: '@media (prefers-color-scheme: dark) {' }],
    fails: ['keeps every dark block screen-only'], count: 1 },
  { id: 'U7', runner: 'unit', edits: [{ file: TOKENS, anchor: '  --ink-soft: #4d5866;', to: '  --ink-soft: #5a6573;' }],
    fails: ['light: every declared pair clears'], count: 1,
    says: ['--pool-top-right', '--pool-foot'], never: ['--ink-soft on --disabled-fill'] },
  { id: 'U8', runner: 'unit', edits: [U8], fails: ['puts the ShyTalk mark on its own tile'], count: 1 },
  { id: 'U9', runner: 'unit', edits: [{ file: TOKENS, anchor: 'None on paper. */\n    --wordmark-tile: transparent;', to: 'None on paper. */\n    --wordmark-tile: #0f0d15;' }],
    fails: ['is spelled out nowhere else in the repo'], count: 1 },
  { id: 'U10', runner: 'unit', edits: [{ file: TOKENS, anchor: 'html {\n  background: var(--bg);', to: 'html {\n  color-scheme: dark;\n  background: var(--bg);' }],
    // html becomes a dark block by its color-scheme: dark, so the palette-only guard
    // passes and two others catch it; U17 is the row that reaches that guard.
    fails: ['keeps every dark block screen-only', 'declares the same tokens, with the same values, in every dark block'], count: 2 },
  { id: 'U11', runner: 'unit', create: 'src/scripts/zz-probe.js', body: "export const probe = 'white';\n",
    fails: ['writes no colour literal outside tokens.css but the allowed ones'], count: 1 },
  { id: 'U12', runner: 'unit', edits: [{ file: 'tests/unit/colour-literals.test.ts', anchor: '/\\.(ts|js|mjs)$/.test(file)', to: '/\\.ts$/.test(file)' }],
    fails: ['reads a script as code, never as CSS'], count: 1 },
  { id: 'U13', runner: 'unit', edits: [{ file: 'src/components/LanguageSwitcher.astro', anchor: '</details>\n', to: "</details>\n<script>console.info('switcher');</script>\n" }],
    fails: ['ships no JavaScript of its own'], count: 1 },
  { id: 'U14', runner: 'unit', edits: [{ file: GUARD, anchor: '    else if (opens && !tagged) findings.push(newContextMessage(file, decl));\n', to: '' }],
    fails: ['flags an untagged test that opens its own browser context'], count: 1 },
  { id: 'U15', runner: 'unit', edits: [{ file: GUARD, anchor: '    else if (!covered && !opens && tagged)\n', to: '    else if (!covered && tagged)\n' }],
    fails: ['calling newContext(), is tagged @requires-isolated-context, and no tag is stale', 'accepts that test once tagged'], count: 2 },
  { id: 'U16', runner: 'unit', edits: [{ file: GUARD, anchor: "    if (\n      ts.isCallExpression(node) &&\n      ts.isPropertyAccessExpression(node.expression) &&\n      node.expression.name.text === 'newContext'\n    )\n", to: "    if (node.getText().includes('newContext('))\n" }],
    fails: ['calling newContext(), is tagged @requires-isolated-context, and no tag is stale', 'opens no context for a newContext() written only in a comment or a string'], count: 2 },
  { id: 'U17', runner: 'unit', edits: [{ file: TOKENS, anchor: 'html {\n  background: var(--bg);', to: 'html {\n  color-scheme: light;\n  background: var(--bg);' }],
    fails: ['declares color-scheme only beside a palette'], count: 1 },
  { id: 'T1', runner: 'typecheck', edits: [{ file: SCRIPT, anchor: 'const root = document.documentElement;', to: 'const root = document.documentElemnt;' }],
    fails: ['astro check'], count: 1 },
  { id: 'S1', runner: 'theme', edits: [{ file: SCRIPT, anchor: "  apply();\n  root.dataset.themeSwitch = '';", to: "  setTimeout(apply, 200);\n  root.dataset.themeSwitch = '';" }],
    // press() runs at DOMContentLoaded, before the delayed apply(), so aria-pressed
    // reads the device after a reload as well. Under load the timer fires after the
    // test's click, and apply() then deletes the stamp the click set where storage is
    // refused: 1 run in 4 at the default workers, 0 in 5 at one (review pass 3).
    fails: ['the first frame that paints a ground paints the saved theme', 'across a reload and a second page'], count: 3,
    may: ['the switch still changes the page, nothing is saved, and nothing is logged'] },
  { id: 'S2', runner: 'theme', edits: [{ file: SCRIPT, anchor: SAVE, to: "    localStorage.setItem('theme', theme);\n" }],
    fails: ['the switch still changes the page, nothing is saved, and nothing is logged'], count: 1 },
  { id: 'S3', runner: 'theme', edits: [{ file: SCRIPT, anchor: SAVE, to: '' }],
    fails: ['across a reload and a second page', 'into a new session', 'a press after a stale saved value', 'a double press', 'an engine without MediaQueryList.addEventListener'], count: 5 },
  { id: 'S4', runner: 'theme', edits: [{ file: SCRIPT, anchor: "  addEventListener('pageshow', (event) => {\n    if (!event.persisted) return;\n    apply();\n    press();\n  });\n", to: '' }],
    fails: ['the pageshow handler re-applies the saved choice'], count: 1 },
  { id: 'S5', runner: 'theme', edits: [{ file: SCRIPT, anchor: "  os.addEventListener?.('change', press);\n", to: '' }],
    fails: ['with no choice saved, the page and the switch follow it, live'], count: 1 },
  { id: 'S6', runner: 'theme', edits: [{ file: SCRIPT, anchor: 'os.addEventListener?.(', to: 'os.addEventListener(' }],
    fails: ['an engine without MediaQueryList.addEventListener'], count: 1 },
  { id: 'S7', runner: 'theme', edits: [{ file: SCRIPT, anchor: "      return theme === 'light' || theme === 'dark' ? theme : null;", to: '      return theme;' }],
    fails: ['is ignored, and the device setting applies', 'a press after a stale saved value'], count: 2 },
  { id: 'S8', runner: 'sanity', edits: [{ file: SCRIPT, anchor: "document.addEventListener('click', (event) => {", to: "document.addEventListener('click-never', (event) => {" }],
    fails: ['the theme switch changes the page, and the choice survives a reload'], count: 2 },
  { id: 'S9', runner: 'theme', edits: [{ file: SCRIPT, anchor: "  os.addEventListener?.('change', press);", to: "  os.addEventListener?.('change', () => {\n    delete root.dataset.theme;\n    press();\n  });" }],
    fails: ['with a choice saved, a change on the device changes nothing'], count: 1 },
  { id: 'S10', runner: 'theme', edits: [{ file: TOKENS, anchor: '  --switch-display: none;', to: '  --switch-display: inline-flex;' }],
    fails: ['the switch is absent, and the device setting applies', 'does not print'], count: 3 },
  { id: 'S11', runner: 'theme', edits: [{ file: TOKENS, anchor: '  :root[data-theme-switch] {\n    --switch-display: inline-flex;\n  }\n}', to: '}\n:root[data-theme-switch] {\n  --switch-display: inline-flex;\n}' }],
    fails: ['does not print'], count: 1 },
  { id: 'S12', runner: 'theme', edits: [{ file: TOKENS, anchor: 'html {\n  background: var(--bg);', to: 'html {\n  transition: background-color 0.2s;\n  background: var(--bg);' }],
    fails: ['switches instantly'], count: 1 },
  { id: 'S13', runner: 'theme', edits: [{ file: SWITCH, anchor: '  aria-label={t.themeDarkMode}\n', to: '' }],
    fails: ['a toggle button named in its own language'], count: 5 },
  { id: 'S14', runner: 'theme', edits: [{ file: SWITCH, anchor: '<button\n  type="button"', to: '<span\n  role="button"\n  tabindex="0"' }, { file: SWITCH, anchor: '</button>', to: '</span>' }],
    fails: ['Enter and Space each toggle it'], count: 1 },
  { id: 'S15', runner: 'walks', edits: [{ file: SWITCH, anchor: '  data-theme-toggle\n', to: '  data-theme-toggle\n  tabindex="-1"\n' }],
    fails: ['desktop: the header is keyboard-reachable in order', 'it is the FIRST thing a Tab reaches', 'every header link can take focus, on every engine'], count: 3 },
  { id: 'S16', runner: 'theme', edits: [{ file: SWITCH, anchor: '<circle fill="currentColor"', to: '<circle fill="#eaf2ff"' }],
    fails: ['under forced colours, its icon draws in the system text colour'], count: 1 },
  { id: 'S17', runner: 'script', edits: [{ file: LAYOUT, anchor: '<script is:inline set:html={themeScript}></script>', to: '<script is:inline type="module" set:html={themeScript}></script>' }],
    fails: ['runs it before the first paint'], count: 16 },
  { id: 'S18', runner: 'script', edits: [{ file: LAYOUT, anchor: '    <script is:inline set:html={themeScript}></script>\n', to: '' }, { file: LAYOUT, anchor: '    <Footer lang={lang} />\n', to: '    <Footer lang={lang} />\n    <script is:inline set:html={themeScript}></script>\n' }],
    fails: ['runs it before the first paint'], count: 16 },
  { id: 'S19', runner: 'script', edits: [{ file: 'src/components/pages/HomePage.astro', anchor: '<section id="shytalk" class="wrap showcase">', to: '<script is:inline>document.documentElement.dataset.extra = \'\';</script>\n  <section id="shytalk" class="wrap showcase">' }],
    fails: ['carries it exactly once, and nothing it did not carry before'], count: 5 },
  { id: 'S20', runner: 'print', edits: [{ file: TOKENS, anchor: '@media screen and (prefers-color-scheme: dark) {', to: '@media (prefers-color-scheme: dark) {' }, { file: TOKENS, anchor: '@media screen {\n  /* The second copy', to: '@media all {\n  /* The second copy' }],
    fails: ['every printed ink is readable on white paper, whatever the screen shows', 'a disabled control never depends on its fill reaching paper'], count: 4 },
  { id: 'S21', runner: 'palette', edits: [{ file: 'tests/themes.ts', anchor: 'colorScheme: theme });', to: "colorScheme: theme === 'dark' ? 'light' : 'dark' });" }],
    fails: ['every control it paints uses a palette colour, in both themes', 'the controls the browser draws use the brand accent'], count: 5 },
  { id: 'S22', runner: 'home', edits: [U8], fails: ['the ShyTalk showcase carries the brand wordmark and links out'], count: 1 },
  { id: 'S23', runner: 'home', edits: [{ file: TOKENS, anchor: 'None on paper. */\n    --wordmark-tile: transparent;\n', to: 'None on paper. */\n' }],
    fails: ['the ShyTalk showcase carries the brand wordmark and links out'], count: 1 },
  { id: 'S24', runner: 'gallery', edits: [{ file: 'tests/e2e/theme-gallery.spec.ts', anchor: 'test.use({ colorScheme: theme });', to: "test.use({ colorScheme: theme === 'dark' ? 'light' : 'dark' });" }],
    fails: ['every page renders the theme, with no sideways scroll', 'the header: the phone menu', '/classroom-groups: results, the roster'], count: 24 },
  { id: 'S25', runner: 'room', edits: [{ file: 'src/components/Header.astro', anchor: '      <ThemeSwitch lang={lang} />\n', to: '' }],
    fails: ['no header item overlaps another, at any width'], count: 5, says: ['measured only ['] },
];

const restore = (file) => {
  spawnSync('git', ['checkout', 'HEAD', '--', file]);
  if (spawnSync('git', ['diff', '--quiet', 'HEAD', '--', file]).status !== 0) throw new Error(`NOT RESTORED: ${file}`);
};

if (!DRY && spawnSync('git', ['diff', '--quiet', 'HEAD', '--', 'src', 'tests', 'playwright.config.ts']).status !== 0)
  throw new Error('uncommitted changes: commit before mutating');

const baselines = {};
const baseline = (runner) => {
  if (!baselines[runner]) {
    const base = RUNNERS[runner]();
    if (base.broken) throw new Error(`${runner} baseline broken: ${base.broken}`);
    console.log(`BASELINE ${runner}: total=${base.total} failing=${JSON.stringify(base.failing)}`);
    baselines[runner] = base;
  }
  return baselines[runner];
};

for (const m of MUTATIONS.filter((x) => IDS.length === 0 || IDS.includes(x.id))) {
  // Anchors first, against the file as committed, before anything is written.
  const counts = (m.edits ?? []).map(({ file, anchor, count = 1 }) => {
    const found = readFileSync(file, 'utf8').split(anchor).length - 1;
    return { file, found, count };
  });
  const wrong = counts.filter(({ found, count }) => found !== count);
  if (wrong.length > 0) {
    for (const w of wrong) console.log(`${m.id} ANCHOR IN ${w.file} MATCHED ${w.found} TIMES, WANTED ${w.count}: not run`);
    continue;
  }
  if (DRY) {
    console.log(`${m.id} anchors ok`);
    continue;
  }
  const base = baseline(m.runner);
  if (m.create) writeFileSync(m.create, m.body);
  else
    for (const { file, anchor, to } of m.edits) {
      const before = readFileSync(file, 'utf8');
      writeFileSync(file, before.split(anchor).join(to));
      console.log(`${m.id} applied in ${file}: ${JSON.stringify(to).slice(0, 120)}`);
    }
  let after;
  try {
    after = RUNNERS[m.runner]();
  } finally {
    if (m.create) rmSync(m.create);
    else for (const { file } of m.edits) restore(file);
  }
  if (after.broken || after.total !== base.total) {
    console.log(`${m.id} BROKEN (${after.broken ?? `total ${after.total} vs ${base.total}`})`);
    continue;
  }
  const newly = after.failing.filter((t) => !base.failing.includes(t));
  const allowed = newly.filter((t) => (m.may ?? []).some((s) => t.includes(s)));
  const counted = newly.filter((t) => !allowed.includes(t));
  const said = (m.says ?? []).every((s) => after.out.includes(s)) && (m.never ?? []).every((s) => !after.out.includes(s));
  const ok =
    counted.length === m.count &&
    m.fails.every((s) => counted.some((t) => t.includes(s))) &&
    counted.every((t) => m.fails.some((s) => t.includes(s))) &&
    said;
  console.log(`${m.id} ${counted.length === 0 ? 'GREEN (NOT CAUGHT)' : ok ? 'RED as predicted' : 'RED, NOT as predicted'}` +
    (allowed.length > 0 ? `, and the race it creates failed ${JSON.stringify(allowed)}` : ''));
  if (!ok) console.log(`   newlyFailing(${newly.length})=${JSON.stringify(newly)}${said ? '' : '  says/never NOT met'}`);
}
```

- [ ] **Step 2: Run the mutations.** One per guard branch, at least. The rows map to §6.8 as shown. A GREEN is investigated through its three causes before anything else (CLAUDE.md, #250): a weak guard, a mutation that never reached what was run, or a mutation the medium makes impossible. A branch no row can observe is deleted, or given its own fixture.

**Unit** (runner `unit`):

| id | mutation | must turn red (count) | §6.8 |
| --- | --- | --- | --- |
| U1 | `tests/wcag.ts`: the `transparent` branch removed | *reads transparent as CSS defines it*; *writes a colour the way getComputedStyle reports it*; *dark: every declared pair clears* (the mark's tile is unreadable) (3) | — |
| U2 | `tests/palette.ts`: `darkBlocks` finds by selector: `cssRules(css).filter(({ declarations }) =>` becomes ``cssRules(css).filter(({ chain, declarations }) => chain.at(-1) === ":root[data-theme='dark']" &&`` | *finds every dark block by its color-scheme*; *keeps every dark block screen-only, and has both states it needs*; *declares the same tokens*; *declares color-scheme only beside a palette* (4) | — |
| U3 | `tests/palette.ts`: `if (theme === 'light') return root;` becomes `if (theme === 'light' \|\| theme === 'dark') return root;` | *reads light from bare :root, and dark as*; *refuses a dark theme that no block declares*; *dark: pins the disabled fill*; *puts the ShyTalk mark on its own tile* (4) | — |
| U4 | `tokens.css`: in the second dark block, `--danger: #ff6b5a;\n    --border: rgb(255 255 255 / 0.11);` becomes `--danger: #ff6b5b;` followed by the same border | *declares the same tokens, with the same values, in every dark block* (1) | one token changed in only one dark block |
| U5 | `tokens.css`: `    color-scheme: dark;\n` (count 2) becomes the same line followed by `    --orphan: 1px;\n` | *defines no token only inside a dark block* (1) | a token declared only inside a dark block |
| U6 | `tokens.css`: `@media screen and (prefers-color-scheme: dark) {` becomes `@media (prefers-color-scheme: dark) {` | *keeps every dark block screen-only* (1) | the dark blocks' `@media screen` wrapper removed (unit half; S20 is the print half) |
| U7 | `tokens.css`: `  --ink-soft: #4d5866;` becomes `  --ink-soft: #5a6573;`, which clears every flat pair (5.23:1 on `--bg`, 4.55:1 on `--disabled-fill`) and all four layers (5.52:1), but is 4.43:1 over the two shade pools alone | *light: every declared pair clears*, whose output must name `--pool-top-right` and `--pool-foot` and never `--ink-soft on --disabled-fill` (1). Review pass 1: the old `#5f6a78` also failed `--disabled-fill` (4.22:1), so it did not isolate the subset | `--ink-soft` lightened so it fails over the shade pools alone |
| U8 | `tokens.css`: `  --wordmark-tile: #0f0d15;` becomes `  --wordmark-tile: #0f0d16;` | *puts the ShyTalk mark on its own tile* (1) | the light `--wordmark-tile` changed |
| U9 | `tokens.css`: `None on paper. */\n    --wordmark-tile: transparent;` becomes the same with `#0f0d15` | *is spelled out nowhere else in the repo* (tokens.css spells the tile twice) (1) | — |
| U10 | `tokens.css`: `html {\n  background: var(--bg);` becomes `html {\n  color-scheme: dark;\n  background: var(--bg);` | *keeps every dark block screen-only*; *declares the same tokens, with the same values, in every dark block* (2). `html` becomes a dark block by its own `color-scheme: dark`, so the palette-only guard passes here; U17 is the row that reaches it | — |
| U11 | create `src/scripts/zz-probe.js` holding `export const probe = 'white';\n` | *writes no colour literal outside tokens.css but the allowed ones* (1) | `color: #fff` written into a component, here in the `.js` kind this PR opened |
| U12 | `colour-literals.test.ts`: `/\.(ts\|js\|mjs)$/.test(file)` becomes `/\.ts$/.test(file)` | *reads a script as code, never as CSS* (1) | — |
| U13 | `LanguageSwitcher.astro`: `</details>\n` becomes `</details>\n<script>console.info('switcher');</script>\n` | *ships no JavaScript of its own* (1) | — |
| U14 | `isolated-context-tagging.test.ts`: `    else if (opens && !tagged) findings.push(newContextMessage(file, decl));\n` removed | *flags an untagged test that opens its own browser context* (1) | — (Task 6's second cause) |
| U15 | `isolated-context-tagging.test.ts`: `    else if (!covered && !opens && tagged)\n` becomes `    else if (!covered && tagged)\n` | the corpus test, whose title ends *calling newContext(), is tagged @requires-isolated-context, and no tag is stale*; *accepts that test once tagged* (2) | — |
| U16 | `isolated-context-tagging.test.ts`: the parser's match in `opensAContext` becomes `if (node.getText().includes('newContext('))` | the corpus test (`real-device.spec.ts:40`'s COMMENT names `request.newContext()`); *opens no context for a newContext() written only in a comment or a string* (2) | — |
| U17 | `tokens.css`: `html {\n  background: var(--bg);` becomes `html {\n  color-scheme: light;\n  background: var(--bg);` | *declares color-scheme only beside a palette* (1) | — |

**Types** (runner `typecheck`):

| id | mutation | must turn red | §6.8 |
| --- | --- | --- | --- |
| T1 | `theme.inline.js`: `const root = document.documentElement;` becomes `const root = document.documentElemnt;` | `astro check` reports an error: `checkJs` reads the shipped script (ruling 2) | — |

**Browser** (the runner named in each row, on `chromium` unless it says `content`):

| id | runner | mutation | must turn red (count) | §6.8 |
| --- | --- | --- | --- | --- |
| S1 | theme | `  apply();\n  root.dataset.themeSwitch = '';` becomes `  setTimeout(apply, 200);\n  root.dataset.themeSwitch = '';` | *the first frame that paints a ground paints the saved theme*, in both directions; *across a reload and a second page*, because `press()` runs at `DOMContentLoaded`, before the delayed `apply()`, so `aria-pressed` reads the device (3). May also fail, uncounted: *storage refused*, when the timer fires after its click and `apply()` deletes the stamp (review pass 3: 1 run in 4) | the stamp delayed by a `setTimeout` |
| S2 | theme | the `try { … } catch {}` around `localStorage.setItem('theme', theme);` removed, the call kept | *the switch still changes the page, nothing is saved, and nothing is logged* (1) | the `try`/`catch` around the save removed |
| S3 | theme | the same `try { … } catch {}` removed with its call | *across a reload and a second page*; *into a new session*; *a press after a stale saved value*; *a double press*; *an engine without MediaQueryList.addEventListener* (its reload) (5) | the save removed |
| S4 | theme | the `pageshow` listener removed | *the pageshow handler re-applies the saved choice* (1). The real Back skips on `chromium`, as Task 6 recorded | the `pageshow` handler removed |
| S5 | theme | `  os.addEventListener?.('change', press);\n` removed | *with no choice saved, the page and the switch follow it, live* (1) | the OS-change listener removed |
| S6 | theme | `os.addEventListener?.(` becomes `os.addEventListener(` | *an engine without MediaQueryList.addEventListener* (1) | — |
| S7 | theme | `      return theme === 'light' \|\| theme === 'dark' ? theme : null;` becomes `      return theme;` | *is ignored, and the device setting applies*; *a press after a stale saved value* (2) | — |
| S8 | sanity | `document.addEventListener('click', (event) => {` becomes `document.addEventListener('click-never', (event) => {` | *the theme switch changes the page, and the choice survives a reload*, on dev and on prod (2) | the click delegation removed, with the sanity suites run against local builds, dev and production |
| S9 | theme | `  os.addEventListener?.('change', press);` becomes `  os.addEventListener?.('change', () => {\n    delete root.dataset.theme;\n    press();\n  });` | *with a choice saved, a change on the device changes nothing* (1) | — |
| S10 | theme | `  --switch-display: none;` becomes `  --switch-display: inline-flex;` | *the switch is absent, and the device setting applies*, in both themes; *does not print* (3) | `--switch-display` shown on bare `:root` |
| S11 | theme | the reveal rule moved out of `@media screen`: `  :root[data-theme-switch] {\n    --switch-display: inline-flex;\n  }\n}` becomes `}\n:root[data-theme-switch] {\n  --switch-display: inline-flex;\n}` | *does not print* (1) | the reveal rule taken out of `@media screen` |
| S12 | theme | `html {\n  background: var(--bg);` becomes `html {\n  transition: background-color 0.2s;\n  background: var(--bg);` | *switches instantly* (1) | `transition: background-color 0.2s` added to `html` |
| S13 | theme | `ThemeSwitch.astro`: the `aria-label={t.themeDarkMode}` line removed | the 5 *a toggle button named in its own language* tests (5) | the switch's accessible name removed |
| S14 | theme | `ThemeSwitch.astro`: `<button\n  type="button"` becomes `<span\n  role="button"\n  tabindex="0"`, and `</button>` becomes `</span>` | *Enter and Space each toggle it* (1) | — (ruling 8) |
| S15 | walks | `ThemeSwitch.astro`: `  data-theme-toggle\n` becomes `  data-theme-toggle\n  tabindex="-1"\n` | *desktop: the header is keyboard-reachable in order*; *it is the FIRST thing a Tab reaches*; *every header link can take focus, on every engine* (3) | the switch given `tabindex="-1"` |
| S16 | theme | `ThemeSwitch.astro`: `<circle fill="currentColor"` becomes `<circle fill="#eaf2ff"` | *under forced colours, its icon draws in the system text colour* (1) | — |
| S17 | script (content) | `BaseLayout.astro`: `<script is:inline set:html={themeScript}></script>` becomes `<script is:inline type="module" set:html={themeScript}></script>` | all 16 *runs it before the first paint* (16) | the theme script made a module |
| S18 | script (content) | `BaseLayout.astro`: the script removed from `<head>`, and `<Footer lang={lang} />` becomes `<Footer lang={lang} />\n    <script is:inline set:html={themeScript}></script>` | all 16 *runs it before the first paint* (16) | …or moved to the end of `<body>` |
| S19 | script (content) | `HomePage.astro`: `<section id="shytalk" class="wrap showcase">` becomes `<script is:inline>document.documentElement.dataset.extra = '';</script>\n  <section id="shytalk" class="wrap showcase">` | the 5 homepages' *carries it exactly once, and nothing it did not carry before* (5) | a second inline script on the homepage |
| S20 | print | `tokens.css`: `@media screen and (prefers-color-scheme: dark) {` becomes `@media (prefers-color-scheme: dark) {`, and `@media screen {\n  /* The second copy` becomes `@media all {\n  /* The second copy` | the 3 *every printed ink is readable on white paper, whatever the screen shows*; *a disabled control never depends on its fill reaching paper* (4) | the dark blocks' `@media screen` wrapper removed |
| S21 | palette | `tests/themes.ts`: `colorScheme: theme });` becomes `colorScheme: theme === 'dark' ? 'light' : 'dark' });` | the 4 per-path tests and *the controls the browser draws use the brand accent* (5) | a per-theme run set to the other scheme |
| S22 | home | = U8's change | *the ShyTalk showcase carries the brand wordmark and links out* (1) | the light `--wordmark-tile` changed (rendered half) |
| S23 | home | `tokens.css`: `None on paper. */\n    --wordmark-tile: transparent;\n` becomes `None on paper. */\n` | *the ShyTalk showcase carries the brand wordmark and links out* (1) | — (AC14's "prints in ink") |
| S24 | gallery | `theme-gallery.spec.ts`: `test.use({ colorScheme: theme });` becomes `test.use({ colorScheme: theme === 'dark' ? 'light' : 'dark' });` | all 24 gallery tests (24) | a per-theme run set to the other scheme, in the gallery |
| S25 | room | `Header.astro`: `      <ThemeSwitch lang={lang} />\n` removed | the 5 *no header item overlaps another, at any width* tests, each saying *measured only [* (5) | — (Task 5: the row holds the real switch by name) |

  §6.8's one remaining row, a project's `colorScheme` removed or a config added without one, guards code this PR does not change. It was proven in #337 by mutations S1 to S4 there, and is not re-run.

  The visual suite's own controls are Task 11 Step 4: a Studio token recoloured, and the scheme swapped.

- [ ] **Step 3: Keep the log** (`mut142b.log`) for the PR body. Record, for each row, the predicted count, the actual count and the verdict. If a row reads *RED, NOT as predicted*, reproduce it by hand with full output before believing either the guard or the prediction (standing rule).

---

### Task 13: Prove it locally, then deliver

- [ ] **Step 1: The whole local verdict.**
  - `npm run test:unit`: every test passes. Compare the totals with the baseline plus this PR's new tests.
  - `npm run typecheck`: 0/0/0.
  - `npx prettier --check .`: clean, `HANDOVER.md` included (the pre-push hook reads the working tree).
  - `npx playwright test tests/e2e/theme.spec.ts tests/e2e/theme-script.spec.ts tests/e2e/theme-gallery.spec.ts tests/e2e/header-room.spec.ts`: green on every engine, apart from the recorded skips.
  - `npm run test:visual`: 24 passed, and nothing written. A stability timeout is handled as Task 11 Step 4 says.

- [ ] **Step 2: Grep what runs only after the merge.** Look in `tests/dev`, `tests/prod` and `tests/device` for every fact this PR changed:

  ```bash
  command grep -rn -E "234, 242, 255|4, 7, 13|--bg|--ink|colorScheme|color-scheme|data-theme|aria-pressed|theme\.inline|Dark mode|zero JS|ships no JavaScript" tests/dev tests/prod tests/device
  ```

  Expected hits, and only these, as measured in review pass 1 on the materialised tree: the two lines of Task 9's ground check in `tests/device/ios/session.ts`, both `themeColour('dark', '--bg')`.
  - The sanity suites' switch check lives in `tests/themes.ts`, and the configs' `colorScheme: 'dark'` at the repo root, so neither is under the three directories this searches.
  - Journey 10's `theme` exclusion matches no pattern here.
  - Review pass 1 also grepped these directories for the other facts this PR changes (a script on every page, the header's controls, the Tab order, `localStorage`). It found no stale fact. `real-device.spec.ts`'s storage probe reads its own key, and the device fixture clears storage between tests.

  Anything else is a stale fact in a suite no pull request runs (#335). Fix it before the push.

- [ ] **Step 3: Push and open the PR.**
  - Run `npx prettier --write HANDOVER.md`, then `git push -u origin 142-light-mode-beside-aurora`.
  - Open a PR into `develop` titled "Light mode: Studio beside Aurora, switchable from the header (#142)". The body carries:
    - `Refs #142`;
    - what changed, task by task;
    - the mutation table with its results (Task 12);
    - the visual control sequence's counts (Task 11);
    - the dark diff's review ("header only");
    - which engines ran the real Back test and which skipped it, with the reason;
    - the shipped script's size;
    - the four label drafts, written directly, with the translator's dry-run counts that ruled it out;
    - every finding Task 7 or Task 10 fixed;
    - that `npm run test:devices` is the operator's, with the phones;
    - the two local sanity runs (Task 9 Step 2), and that prod-sanity's three reds are #338's, which predate this PR.
  - Check it with `node scripts/closing-keywords.mjs <file> "this pull request body"`.

- [ ] **Step 4: Wait for CI by name, on the head.**
  - Write `gh pr view <n> --json headRefOid --jq .headRefOid` to a file, and compare the run's SHA with it.
  - All twelve checks must be green, by name, on that head: `checks`, `closing-keywords`, `e2e shard 1 of 8` to `e2e shard 8 of 8`, `build-and-test` and `visual`.
  - Branch protection requires only two of them. In review pass 1, the protection on `develop` read `{strict: true, contexts: [build-and-test, visual]}`. `build-and-test` stands for `checks` and the shards. `closing-keywords` is not required until #278, so a red there would not stop the merge, and this step is what does.
  - `back-translation` also runs, because `src/lib/i18n` changed. It is advisory: read its summary for `themeDarkMode`'s scores and record them. A red there means the review read nothing, which is a finding to report, not a gate.

- [ ] **Step 5: Self-review, then merge.**
  - Read the whole diff against `develop` once more, with the mutation log beside it.
  - Then run `gh pr merge <n> --merge --match-head-commit "$(cat <file holding the head>)"`.
  - Watch `deploy-dev.yml` for the merge commit. Read every job by name, and `dev-verified` off the merge commit. A skipped verify job still concludes `success` (#157).
  - The verify job runs dev-sanity against the deployed site, with the switch test Task 9 added. That run is the switch's first proof on a real deployment, and the robots.txt and 401 tests pass there as they cannot locally.

---

### Task 14: The evidence page, and close-out

§6.7 and AC18. The operator reviews the whole board at the end (2026-09-24), so this page does not gate the merge; it is how the review happens.

- [ ] **Step 1: Capture the evidence at the merge commit.**
  - `git switch develop && git pull --ff-only`, then confirm `git rev-parse HEAD` is the merge commit.
  - Run `EVIDENCE_DIR="$S/evidence142" npm run test:e2e -- tests/e2e/theme-gallery.spec.ts tests/e2e/theme.spec.ts tests/e2e/print-legibility.spec.ts tests/e2e/palette-controls.spec.ts --project=chromium --workers=2`, where `$S` is the scratchpad. `--workers=2`, never the default, because an evidence run records video for every test. At the default 3 workers one swapped and failed six tests that pass alone in 13.7s (memory: *an evidence capture swaps at default workers*, measured 2026-09-21). Expected: green, with the captures and `manifest.jsonl` in `$S/evidence142`, and `report.json` beside them.

- [ ] **Step 2: Write the content file,** `$S/content142.json`, in the evidence builder's schema: `title`, `eyebrow`, `headline`, `lede`, `sections` (`{ heading, body }` each), `mutations` (`{ id, what, predicted, actual }` each, from `mut142b.log`), `signoffKey` and `notCovered`.
  - Headline: "Light mode: Studio beside Aurora". `signoffKey`: `ticket-142`.
  - Sections: the palette, the switch, what the pages show in each theme, print, and what was measured.
  - The section on the pages says that every full-page capture shows a faint edge at the viewport's height, and why (Task 11 Step 3): in Studio it is visible, and a reviewer who is not told will read it as a defect of the page.
  - `notCovered`: the real-device gauntlet, which is the operator's with the phones, and the real Back test wherever an engine did not restore the page (Playwright launches the two Chromium engines without the back-forward cache, and review pass 1 measured the other three not restoring either). The synthetic `pageshow` test is what proves the handler.

- [ ] **Step 3: Build and publish.** This is the two-pass flow the builder documents (#268). Load the `artifact-capabilities` skill before passing any capability.
  1. `node scripts/build-evidence-page.mjs --plan --evidence "$S/evidence142" --out "$S/evidence142.html"` writes the upload list, `$S/evidence142.html.uploads.json`.
  2. Publish a first version of the page as a new artifact, with the capabilities the builder's page needs: `assets` for the captures, `db` for the sign-off it writes.
  3. Upload the listed files to its asset store, 25 at a time, by short relative paths (memory: evidence uploads go by short relative paths). Then list the store with `scope: "assets"` and save the listing's text to `$S/assets142.txt`.
  4. `node scripts/upload-evidence-assets.mjs --plan "$S/evidence142.html.uploads.json" --listing "$S/assets142.txt" --out "$S/assets142.json"`. This pairs every capture with its asset by sha256, never by hand.
  5. `node scripts/build-evidence-page.mjs --evidence "$S/evidence142" --content "$S/content142.json" --assets "$S/assets142.json" --out "$S/evidence142.html"`, then republish that file to the same artifact.
  6. Read the published page back with `grep`, never with `Artifact action: "read"` (standing rule), and confirm that every capture resolves.

- [ ] **Step 4: Close the ticket.**
  - Post the evidence page's link and PR 2's results on #142, with `Refs`, after checking the comment with `node scripts/closing-keywords.mjs <file> "this comment"`.
  - Then close it deliberately with `gh issue close 142`.
  - Move #142's card to **Done** on the Shyden Site board. Resolve the board from its recorded node id, assert its title is "Shyden Site" before the write, and read the item's `project { title }` and status back afterwards. Never project 1.

- [ ] **Step 5: Hand over.** Rewrite `HANDOVER.md` with the branch, the SHAs from `git rev-parse` written to files, what is done, and the next ticket. Then send a `PushNotification`, and say that the session is safe to `/clear`.

---

## Review log

Each pass runs every mechanical check, then reads the whole plan (operator, 2026-09-24: _"review the plan on a /loop until there's no findings, then approve it"_). The loop ends on a pass that finds nothing.

**Pass 1, 2026-09-24 06:29Z to 2026-09-25 00:35Z, in two sessions. It found 32 problems, now fixed above.**

- **What was read.** Session 1 read every line of the plan (1 to 3038) and the spec (433 lines) in one sitting. Session 2 re-read Tasks 5 to 14 and the header sections while materialising them. The mechanical half spans both sessions.
- **The mechanical checks.** Every task was materialised on a local scratch branch, exactly as written, and run as its steps say:
  - the unit baseline (99 files, 2408 tests) and every figure;
  - each task's red and green counts, on the engines it names;
  - Task 7's eight specs on five engines (1,145 passed);
  - both sanity suites against local builds, with a production build of `develop` as the control;
  - the device `--list`;
  - Task 11's capture and control sequence, in the pinned container;
  - the Task 12 harness: `--dry` on all 43 rows, then 22 rows run for real (U1 to U17, T1, S1, S15, S16 and S20). 19 were red as first predicted, U10 and S1 were corrected and re-run red, and U17 was added and ran red. The other 21 rows had their anchors checked only; the implementation runs them all.
- **What it found** (numbered as in the review's working file):
  - Wrong predictions or counts: 1 (Task 2 Step 3 is 5 red, not 9), 5 and 28 (the real Back test skips on all five engines here), 35 (U10 never reached its guard, so U17 was added), 36 (S1 catches 3).
  - Anchors that could not match: 2, 4, 29 (text that breaks across lines, or matches three times).
  - Steps in the wrong order: 3 and 12 (formatting checked before it was written).
  - Code that fails as written:
    - 13 (a spec records without acting);
    - 24 (header-room's stand-in throws once the switch lands);
    - 26 (the isolated-context guard called the new tag stale);
    - 32 (a `test.use(recorded)` in a describe fails to load);
    - 33 (two identical sanity bodies).
  - Procedures that could not work: 9, 23 and 30 (one build for both sanity suites; a second `astro preview` is a silent no-op), 14 (the translator would send 95 strings, not one), 22 (evidence capture at default workers).
  - Imprecise or unverifiable wording: 6, 7, 10, 11, 15, 16, 17, 18, 25, 27, 34.
  - One pre-existing defect outside #142: prod-sanity's three stale facts on `develop` (31), filed as #338.
- **Cleared by measurement, no change:** 19 (`command grep` handles `\s` and `\b` here), 21 (the device list exits 0 with no phones), 20 (resolved into 32). Finding 8 was withdrawn in session 1.
- **Next:** pass 2 reruns every mechanical check on a fresh scratch branch, and reads the whole plan again.

**Pass 2, 2026-09-25 00:40Z to 01:40Z, one session. It found 8 problems, now fixed above.**

- **What was read.** Every line of the plan, 1 to 3496, in order, while materialising it; the spec's §10 against the plan, criterion by criterion.
- **The mechanical checks,** on a fresh local scratch branch from `4c24484`, every task materialised from the text as it then read:
  - every red and green count matched: Task 1 (5 red; 2413), 2 (5; 2421), 3 (3; 2422), 4 (2 unit and 43 + 1 browser red, then 48 + 1 green; 2424), 5 (82 red, 3 skipped, 15 passed; then 336 passed, 7 skipped), 6 (3 unit and 35 browser red; then 18 and 150 green; 2427), 7 (1,145 passed in 7.2 min), 8 (91 passed, 4 skipped), 9 (dev 27/2, prod 18/3 as the #338 control says; device `--list` 613 in 34 files, `theme.spec.ts` 22), 10 (120 passed), 11 (24 captured, 12 modified and 12 new; unchanged compare 24 with nothing written; accent recoloured 12 red; restored 24; scheme swapped 12 red on the theme assertion, no picture compared);
  - every ratio quoted in a `tokens.css` comment, recomputed with `worstContrast`: all exact, and the mark's 15.02, 11.32, 1.28 and 1.70;
  - the script's size, 1,295 and 543 bytes; Task 7's derivation grep (plus a wider `getComputedStyle` probe, which found only geometry reads outside the listed set); Task 13's post-merge grep; the evidence builder's flags and schema keys;
  - the Task 12 harness, extracted from this plan and byte-identical to the working copy: `--dry` 43 of 43, then **all 43 rows run for real**. 42 were red as predicted.
- **What it found:**
  - **P2-8, a guard that could not fail.** S22 stayed GREEN: the homepage's rendered tile was compared with `themeColour(theme, '--wordmark-tile')`, read from `tokens.css`, the file the mutation edits, so both sides moved together. Task 7's homepage block now pins the tile to `SHYTALK_MARK.tile` (dark: `rgba(0, 0, 0, 0)`), and re-run, S22 and S23 are red and the spec passes 80 of 80 on five engines. Every other `themeColour` read in the tests says which theme rendered, not what its value is; the values are pinned by the contrast suite and the 24 baselines.
  - **P2-1, a promise restated where no step reached it.** Six statements that the homepage ships no JavaScript (`README.md`, the prod smoke's comment and message, `LanguageSwitcher.astro` twice, `language-switcher.spec.ts`, and two comments naming the old test title) now have their replacements in Task 4. The prod smoke itself still passes: it greps for an external script.
  - **P2-3, gates missing from four tasks.** Tasks 7, 8, 10 and 11 edited TypeScript without running `npm run typecheck`, and Task 11 without the unit suite that reads `visual.spec.ts`. All four were clean when run here.
  - **P2-6, a capture artefact a reviewer would read as a defect.** Every full-page light capture shows an edge at the viewport's height, because `body::before` is fixed. Task 11 Step 3 and Task 14 now say so, with the measurement.
  - Wording and order: P2-2 ("keeps it true" in the switch's comment, where `true` is also the attribute's value), P2-4 (Task 11's proof sat under "Nothing further to commit"), P2-5 (anti-aliasing noise stated as certain; pass 2 saw none), P2-7 (a list item's full stop).
- **Next:** pass 3, from a fresh scratch branch at this commit. The loop ends on a pass that finds nothing.

**Pass 3, 2026-09-25 01:47Z to 02:47Z, one session. It found 4 problems, now fixed above.**

- **What was read.** Every line of the plan, 1 to 3534, in order, while materialising it; the spec's §10, AC1 to AC19, each mapped to the task that proves it.
- **The mechanical checks,** on a fresh local scratch branch from `413d5ab`, every task materialised from the text as it then read:
  - every red and green count matched: Task 1 (5 red; 2413), 2 (5; 2421), 3 (3; 2422), 4 (2 unit and 43 + 1 browser red, then 15, 48 and 1 green; 2424; prettier flagged exactly the four predicted files), 5 (82 red, 3 skipped, 15 passed; then 336 passed, 7 skipped), 6 (3 unit and 35 browser red; then 18 and 150 green; 2427), 7 (1,145 passed), 8 (91 passed, 4 skipped), 9 (dev 27/2, prod 18/3 with #338 still open; device `--list` 613 in 34 files, `theme.spec.ts` 22), 10 (120 passed), 11 (24 captured, 12 modified and 12 new; every dark change inside y 23-44; accent recoloured 12 red; scheme swapped 12 red on the theme assertion); `npm run typecheck` 0/0/0 after every task;
  - every ratio in a `tokens.css` comment, recomputed with `worstContrast` to five places: all round to the stated figure;
  - the script's size (1,295 and 543 bytes); Task 13's post-merge grep (the two `session.ts` lines); the CI job names and `develop`'s protection; the evidence builder's flags and content keys; the mutation tables against the harness rows (43 of 43 agree);
  - the Task 12 harness, extracted from this plan and byte-identical to pass 2's: `--dry` 43 of 43, then all 43 rows run. 42 were red as predicted, S22 included.
- **What it found:**
  - **P3-1, a restated promise the sweep missed.** `visual.spec.ts`' `settle` comment says the homepage "ships no JavaScript at all". The plan's own derivation grep prints it, and 6 more hits the plan neither edited nor excused. Task 4 now gives the grep's count at `3640af2` (20) and a disposition for every line, and a seventh table row.
  - **P3-2, a derivation that could not see wrapped calls.** Task 7's grep read line by line, so a `toHaveCSS(` with its property on the next line was invisible (`classroom-groups-print.spec.ts:443`). It now reads each file whole (`-z`), and the print spec is named as a deliberate difference: it reads colour only under print media.
  - **P3-3, a known flake with no instruction.** One of three full visual runs failed on a stability timeout, on the light mobile `home-id` view, which passed twice when run alone. Task 11 Step 4 now says what that failure is and what to do, and Task 13 points to it.
  - **P3-4, a mutation whose count was a race.** S1 caught a fourth test, *storage refused*, in 1 harness run in 4 (0 in 5 at one worker): under load the delayed `apply()` fires after the click and deletes its stamp. Harness rows gain `may`, allowed and uncounted but printed, and S1 names that test. The edited harness was re-extracted: `--dry` 43 of 43, S1 red as predicted, and a probe proved the new branch.
- **Next:** pass 4, from a fresh scratch branch at this commit. The loop ends on a pass that finds nothing.

**Pass 4, 2026-09-25 05:38Z to 06:40Z, one session. It found 1 problem, now fixed above.**

- **What was read.** Every line of the plan, 1 to 3567, in order, before materialising it; the spec's §10, AC1 to AC19, each mapped to the task that proves it.
- **The mechanical checks,** on a fresh local scratch branch from `3e7c182`, every task materialised from the text as it then read:
  - every red and green count matched: the baseline (99 files, 2408), Task 1 (5 red, each on the stub's `not implemented` or `null`; 2413), 2 (5; 2421), 3 (3; 2422), 4 (2 unit and 43 + 1 browser red, 5 green; then 15, 48 and 1 green; 2424; prettier flagged exactly the four predicted files), 5 (82 red, 3 skipped, 15 passed, with 470 lines of *measured only [*; then 336 passed, 7 skipped; 2424; prettier flagged the two predicted files), 6 (3 unit and 35 browser red, seven tests on five engines; then 18 and 150 green, 8 skipped; 2427), 7 (1,145 passed), 8 (91 passed, 4 skipped), 9 (dev 27/2, prod 18/3 with #338 still open, the switch test green in both; device `--list` 613 in 34 files, `theme.spec.ts` 22), 10 (120 passed), 11 (24 captured, 12 modified and 12 new; every dark change inside y 23-44 but 4 pixels in the desktop roster view, each one level on each channel; unchanged compare 24 with nothing written; accent recoloured 12 red, 420 to 174,811 px; restored 24; scheme swapped 12 red on the theme assertion, no picture compared); `npm run typecheck` 0/0/0 after every task;
  - pass 3's four edits: Task 4's grep prints 20 lines at `3640af2`, and each is in exactly one of its three groups; Task 7's `-z` grep prints the ten files listed; Task 11 Step 4's stability-timeout bullet is present (no timeout occurred this pass); the harness carries `may`;
  - every ratio in a `tokens.css` comment, recomputed with `worstContrast` to five places: all round to the stated figure;
  - the script's size (1,295 and 543 bytes); Task 13's post-merge grep (the two `session.ts` lines); the CI job names and `develop`'s protection (`{strict: true, contexts: [build-and-test, visual]}`); the evidence builder's flags, content keys and `.uploads.json` name; the mutation tables against the harness rows (43 of 43, ids, runners and counts);
  - the Task 12 harness, extracted from this plan and byte-identical to pass 3's: `--dry` 43 of 43, then all 43 rows run. **All 43 were red as predicted**; S1's race did not fire this time.
- **What it found:**
  - **P4-1, a base check no implementer could pass.** *Confirm the base* said `git rev-parse HEAD` prints `3640af2`, but the branch carries this plan's own commits on top of it, so `HEAD` never does. It now checks ancestry and that the diff from `3640af2` is this plan alone, both run here against `3e7c182`.
- **Next:** pass 5, from a fresh scratch branch at this commit. The loop ends on a pass that finds nothing.

**Pass 5, 2026-09-25 07:42Z to 11:45Z, in two sessions. It found nothing, so the plan is approved.**

- **What was read.** Every line of the plan, 1 to 3580, in order, before materialising it.
- **The mechanical checks,** on a fresh local scratch branch from `1fbcc51`, every task materialised from the text as it then read:
  - the base check: `git merge-base --is-ancestor 3640af2 1fbcc51` exits 0, and `git diff --stat 3640af2 1fbcc51` lists this plan alone;
  - every red and green count matched: the baseline (99 files, 2408), Task 1 (5 red, each on the stub's `not implemented` or `null`; 2413), 2 (5; 2421), 3 (3; 2422), 4 (2 unit and 43 + 1 browser red, 5 green; then 48 and 1 green; 2424; prettier flagged exactly the four predicted files; the promise grep printed 20 lines at `3640af2`, each in one of its three groups), 5 (82 red, 3 skipped, 15 passed, with 470 lines of _measured only [_; then 336 passed, 7 skipped; 2424; prettier flagged the two predicted files), 6 (3 unit and 35 browser red; then 18 and 150 green; 2427; the script 1,295 and 543 bytes), 7 (the `-z` grep printed the ten listed files; 1,145 passed; 2427), 8 (91 passed, 4 skipped), 9 (dev 27/2 and prod 18/3, the named #338 reds, with the switch test green in both; device `--list` 613 tests in 34 files, 22 in `theme.spec.ts`), 10 (120 passed);
  - Task 11's control sequence, in the pinned container: 24 captured (12 dark modified, every change inside y 23 to 44, and 12 light added); an unchanged compare of all 24 with nothing written; the accent recoloured, 12 red; restored, 24 green with nothing written; the scheme swapped, 12 red on _the page rendered the light theme_ with no screenshot compared;
  - every ratio in a `tokens.css` comment, recomputed with `worstContrast`: all exact;
  - Task 13's post-merge grep (the two `session.ts` lines); the CI job names and `develop`'s protection (`{strict: true, contexts: [build-and-test, visual]}`); the evidence builders' flags against Task 14's;
  - the Task 12 harness, extracted from this plan and byte-identical to pass 4's: `--dry` 43 of 43, then all 43 rows run for real, **in two parts**: 26 rows (U1 to U17, T1, S1 to S8) in the first session, stopped during S9 for a `/clear`; then S8 to S25 in the second, so S8 ran twice and was red both times. **All 43 were red as predicted**; S1's race did not fire.
- **What it found:** nothing.
