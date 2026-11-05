# Light mode: Studio beside Aurora (#142)

**Status:** approved by the operator on 2026-09-23 (UTC), after the four design parts and the review passes logged in §12. Next: the implementation plan, which is reviewed before any code.

**Comparison and review page:** https://claude.ai/artifact/RXZDsNzcjVEosHnYMAnqBw (version 3: the three candidates as rendered, Studio refined, the two wordmark options, and the work cards with the refined badge).

## 1. What this is

Aurora (#17) becomes the site's **dark** mode, exactly as it ships today. A second identity, **Studio**, becomes its **light** mode. One button in the header switches between them instantly, and the visitor's choice persists. Until a visitor chooses, the site follows the device's own setting.

Studio answers the question Aurora answers with glow: _what carries the atmosphere when there is no darkness to glow against?_ Its answer is **depth, not colour**. A cool grey ground, pure white cards that sit forward of it, window light at the top left and cool shade falling off to the right and below. Its palette has one colour, the brand green; everything else it paints is light and shade. What a page shows, such as the ShyTalk mark, the flags and the app screenshot, keeps its own colours in both themes.

The #142 body says this work branches from `17-aurora`. That branch has since merged, so this work branches from `develop`.

## 2. Decisions on record

| date       | decision                                                                                                                                                                                                                                                                         | source       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 2026-09-11 | _"the current design should be considered 'dark mode' and we should be able to toggle between dark mode and light mode easily … instantly switchable by the click of a single button and be persisted."_ And: _"a background that's non-intrusive and compatible with each mode."_ | #142 body    |
| 2026-09-11 | The zero-JS invariant is amended: **exactly one inline theme script**, with no bundle and no network request. It must be inline and blocking in `<head>`.                                                                                                                          | #142 body    |
| 2026-09-11 | The default follows `prefers-color-scheme`: an explicit choice wins, then the OS preference. The stated cost was accepted: a visitor on a light-mode device never sees Aurora unless they toggle.                                                                                  | #142 body    |
| 2026-09-11 | _"its own identity, not an inversion."_ No mechanical inversion, and no reuse of Aurora's hues at lower alpha. The background is the **same mechanism in both themes**: one `body::before` layer whose token values change.                                                       | #142 comment |
| 2026-09-23 | **Studio** is chosen over Paper and Sea glass.                                                                                                                                                                                                                                    | interactive  |
| 2026-09-23 | Design part 1 approved (the palette and its three refinements). Part 2: the **ShyTalk mark on its own tile**. Part 3 approved (the switch, including the English label "Dark mode"). Part 4 approved (tests and cleanup).                                                            | interactive  |
| 2026-09-23 | **At narrow widths the language switcher shows a compact label**: its flag, a short code and the BETA mark, with the full name in its open list. This fixes #329 and makes room for the switch.                                                                                  | #329 comment |
| 2026-09-23 | **Aurora's atmosphere stays as it is.** The #142 body had read "non-intrusive" as also an instruction to tone the dark atmosphere down. The operator kept Aurora as #17 shipped it.                                                                                               | #142 comment |

## 3. The palette

### 3.1 Tokens

Every colour token is defined on bare `:root` with its **Studio** value. Aurora redefines the tokens, and only the tokens (§4). "Unchanged" means today's Aurora value.

| token             | Studio (light, bare `:root`) | Aurora (dark)              | role                                                              |
| ----------------- | ---------------------------- | -------------------------- | ----------------------------------------------------------------- |
| `--bg`            | `#eef1f4`                    | `#04070d` unchanged        | page ground                                                       |
| `--surface`       | `#ffffff`                    | `#070d16` unchanged        | cards                                                             |
| `--ink`           | `#111821`                    | `#eaf2ff` unchanged        | text                                                              |
| `--ink-soft`      | `#4d5866`                    | `#8fa6c6` unchanged        | secondary text                                                    |
| `--disabled-fill` | `#dde2e8`                    | `#2a323f` unchanged        | an unavailable control (#250)                                     |
| `--accent`        | `#006652`                    | `#38f5c8` unchanged        | links, kickers, filled buttons                                    |
| `--accent-ink`    | `#004d3e`                    | `#7fffe0` unchanged        | the deeper accent: hover fills and emphasised accent text         |
| `--on-accent`     | `#ffffff`                    | `#04140f` unchanged        | ink on an accent fill                                             |
| `--danger`        | `#b42318`                    | `#ff6b5a` unchanged        | errors                                                            |
| `--border`        | `rgb(17 24 33 / 0.1)`        | `rgb(255 255 255 / 0.11)`  | decorative rules only                                             |
| `--border-strong` | `rgb(17 24 33 / 0.55)`       | `rgb(255 255 255 / 0.4)`   | every control boundary (WCAG 1.4.11)                              |
| `--glass`         | `rgb(17 24 33 / 0.05)`       | `rgb(255 255 255 / 0.055)` | the badge on a work card                                          |
| `--accent-glow`   | `transparent`                | `rgb(56 245 200 / 0.3)`    | the glow behind the language band (§3.3)                          |
| `--dock-shadow`   | `rgb(17 24 33 / 0.14)`       | `rgb(0 0 0 / 0.55)`        | the docked action row's shadow (#188)                             |
| `--lift-shadow`   | `rgb(17 24 33 / 0.18)`       | `rgb(0 0 0 / 0.55)`        | **new**: the phone mockup's shadow (§3.3)                         |
| `--pool-top-left` | `rgb(255 255 255 / 0.7)`     | `rgb(56 245 200 / 0.08)`   | **renamed** from `--aurora-mint`                                  |
| `--pool-top-right` | `rgb(60 80 110 / 0.045)`    | `rgb(122 92 255 / 0.1)`    | **renamed** from `--aurora-violet`                                |
| `--pool-foot`     | `rgb(30 45 65 / 0.055)`      | `rgb(24 74 110 / 0.14)`    | **renamed** from `--aurora-deep`                                  |
| `--shaft`         | `rgb(255 255 255 / 0.35)`    | `rgb(255 255 255 / 0.05)`  | **renamed** from `--aurora-shaft`                                 |
| `--wordmark-tile` | `#0f0d15`                    | `transparent`              | **new**: the ShyTalk mark's tile (§3.4)                           |
| `--wordmark-pad`  | `0.12em 0.42em 0.18em`       | `0`                        | **new**: the tile's padding, zero in dark so Aurora does not move |
| `--switch-moon`   | `inline-block`               | `none`                     | **new**: the switch shows a moon in light…                        |
| `--switch-sun`    | `none`                       | `inline-block`             | **new**: …and a sun in dark (§5)                                  |

`color-scheme` travels with the palette: `light` on bare `:root` and `dark` in the dark blocks. The `html { color-scheme: dark }` rule that sits outside the tokens today is removed. `accent-color: var(--accent)` stays as it is.

Three tokens are retired because no page uses them (0 `var()` references under `src/`): `--violet`, `--deep` and `--glass-2`. Their `DECORATIVE` entries and the pairs naming them in `contrast.test.ts` go with them. That note calls `--violet` and `--deep` "gradient stops in the page atmosphere", but the atmosphere draws from its own `--aurora-*` values, so it describes something that is not drawn.

### 3.2 Contrast, measured

The maths is `tests/wcag.ts`. The pairs are those of `contrast.test.ts`, corrected to the grounds the site actually paints (§6.1): the glass pair sits on the card it is drawn on, and the link-hover colour gains its pair over the atmosphere. Any pair drawn over the atmosphere is scored against **all 16 subsets** of its four layers, in **both** stacking orders, and the worst result is kept. Every row passes. The figures come from the scorer's output file and were not typed by hand:

| foreground | ground | needs | Studio (light) | Aurora (dark) |
| --- | --- | --- | --- | --- |
| `--ink` | `--bg` | 4.5 | 15.75 | 17.90 |
| `--ink` | `--surface` | 4.5 | 17.85 | 17.29 |
| `--ink-soft` | `--bg` | 4.5 | 6.38 | 8.10 |
| `--ink-soft` | `--surface` | 4.5 | 7.23 | 7.83 |
| `--accent` | `--bg` | 4.5 | 6.13 | 14.46 |
| `--accent` | `--surface` | 4.5 | 6.95 | 13.97 |
| `--accent` | `--glass over --surface` | 4.5 | 6.27 | 12.51 |
| `--accent-ink` | `--bg` | 4.5 | 8.69 | 16.60 |
| `--accent-ink` | `--surface` | 4.5 | 9.85 | 16.03 |
| `--on-accent` | `--accent` | 4.5 | 6.95 | 13.54 |
| `--on-accent` | `--accent-ink` | 4.5 | 9.85 | 15.54 |
| `--danger` | `--bg` | 4.5 | 5.80 | 7.20 |
| `--danger` | `--surface` | 4.5 | 6.57 | 6.96 |
| `--ink` | `atmosphere over --bg` | 4.5 | 13.33 | 11.16 |
| `--ink-soft` | `atmosphere over --bg` | 4.5 | 5.40 | 5.05 |
| `--accent` | `atmosphere over --bg` | 4.5 | 5.19 | 9.02 |
| `--accent-ink` | `atmosphere over --bg` | 4.5 | 7.36 | 10.34 |
| `--border-strong over atmosphere over --bg` | `atmosphere over --bg` | 3 | 3.63 | 3.38 |
| `--border-strong over --bg` | `--bg` | 3 | 3.83 | 3.72 |
| `--border-strong over --surface` | `--surface` | 3 | 3.97 | 3.79 |
| `--ink-soft` | `--disabled-fill` | 4.5 | 5.55 | 5.19 |

Studio's tightest body-text pair is the accent over the shade pools, at 5.19:1. Its tightest control boundary is `--border-strong` over the atmosphere, at 3.63:1 against the 3:1 floor.

### 3.3 Refinements approved in part 1

- **The language band has no glow in light mode.** `Marquee.astro` paints `box-shadow: 0 0 50px var(--accent-glow)` inside a container with `overflow: clip`. On a light ground the clipped glow painted a flat grey box. A glow reads as light only against darkness, so in Studio `--accent-glow` is `transparent`.
- **The phone mockup's shadow becomes a token.** `PhoneFrame.astro:77` hard-codes `rgb(0 0 0 / 0.55)`. It becomes `var(--lift-shadow)`, which keeps that value in Aurora, so dark is pixel-identical, and takes a softer one in Studio.
- **The atmosphere tokens are renamed by position.** The same layer carries window light in one theme and mint in the other, so a name that describes Aurora's hue is wrong for half the site.

### 3.4 The ShyTalk mark (part 2)

The mark keeps ShyTalk's own two tones: `SHYTALK_MARK.shy` `#e8e0f0` and `.talk` `#d0bcff`. They were made for a dark ground and measure 1.28:1 and 1.70:1 on white.

- **Light mode.** The mark sits on **ShyTalk's own tile colour**, `SHYTALK_MARK.tile` `#0f0d15`, like a logo badge. It uses `background: var(--wordmark-tile)`, `padding: var(--wordmark-pad)` and a 14px radius, as rendered on the review page. On the tile the two tones measure 15.02:1 and 11.32:1.
- **Dark mode.** The tile is transparent and the padding is zero, so Aurora does not move.
- **Print.** The existing rule still renders the mark in ink, and the print block sets the tile transparent and the padding to zero.

A unit guard asserts that the light `--wordmark-tile` equals `SHYTALK_MARK.tile`, because the colour now lives in two files.

## 4. How the three states resolve

```css
:root {
  /* Studio: every token, plus color-scheme: light */
  --switch-display: none;
}

@media screen and (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    /* Aurora tokens, color-scheme: dark */
  }
}

@media screen {
  :root[data-theme='dark'] {
    /* the same Aurora tokens, color-scheme: dark */
  }

  :root[data-theme-switch] {
    --switch-display: inline-flex;
  }
}

@media print {
  :root {
    /* paper, unchanged from today */
  }
}
```

- **An explicit choice wins in both directions.** `[data-theme="light"]` defeats a dark OS through the `:not()` guard. `[data-theme="dark"]` applies whatever the OS says.
- **No choice follows the OS, live.** The media query re-evaluates when the device's setting changes, with no script involved.
- **Both dark blocks are screen-only.** This is load-bearing for print. The dark blocks' selectors carry specificity (0,2,0), and the print block's `:root` carries (0,1,0). If the dark blocks applied in print, a visitor in dark mode would print Aurora's near-white ink onto white paper, the blank-sheet defect found on 2026-09-11. Screen-only, they never reach the print cascade, and paper keeps being measured against white alone.
- **The Aurora palette is written twice**, because the unstamped state needs the media query and the stamped state must not. A **dark block** is any rule in `tokens.css` that declares `color-scheme: dark`. A unit guard finds them by that declaration, with comments stripped, and asserts they all declare the same tokens with the same values. A third copy added later is compared the same way.
- **No colour has its only definition inside a theme block.** A unit guard asserts that every token a dark block declares is also declared on bare `:root`.
- **The switch appears only once the script has run.** Its `display` comes from `--switch-display`: `none` on bare `:root`, and `inline-flex` under the script's `data-theme-switch` stamp. That rule is screen-only, so the switch never prints. It lives here, beside the theme blocks, because **no component ever tests an attribute on `:root`**: Astro scopes a component's selectors, and a rule that reads the root belongs to the one file that owns the root.

## 5. The switch (part 3)

**Placement.** A 44 × 44px button in the header, immediately before the language switcher, at every width. It is never inside the phone menu, so it is always one tap.

The switch and the language switcher form **one group** in the header row. The row is `justify-content: space-between`, so a fourth separate item would float in the middle of the row on a wide screen rather than sit beside the language switcher.

At narrow widths the language switcher shows the **compact label decided for #329**: its flag, a short code and the BETA mark, with the full name in its open list. That is what makes room. Today, at 320px, the switcher is 110px wide in English, 133px in Thai, 138px in Chinese, 172px in Vietnamese and 184px in Indonesian, and in Indonesian the header's three items already need 14px more than the row has (#329). #329 lands first. Its geometry guard derives the header's items, so from the day the switch exists it proves that nothing in the header overlaps, in every locale, at every width from 320px.

**What it is.** A `<button type="button">` exposed as a **toggle button**. Its accessible name is **"Dark mode"** in English, and in each locale its own translation of the catalogue key `themeDarkMode`. `aria-pressed="true"` means dark is on. The name stays fixed; only the pressed state changes, which is the WAI-ARIA toggle-button pattern. The icons are decorative (`aria-hidden`): a moon while light is showing and a sun while dark is showing, each shown by `display: var(--switch-moon)` / `var(--switch-sun)`, so the icon cannot disagree with the palette. The server-rendered switch carries no `aria-pressed`. The script adds it on `DOMContentLoaded`, so the attribute exists only while something keeps it true. It looks like the header's menu button (`Header.astro:75`): no fill, a 44 × 44 target, and an icon drawn in `currentColor`, inherited from `--ink`. With no fill or border, the icon is what identifies the control under SC 1.4.11, and `--ink` clears 3:1 over every ground in both themes: 13.33:1 at worst in Studio and 11.16:1 in Aurora (§3.2). `currentColor` also keeps the icon correct under forced colours, where the browser substitutes the system's own. The switch has a visible focus ring, and switching is instant, with no transition. It does not print (§4): it is a screen affordance, not part of the record.

**The one script.** It lives in one source file, `src/scripts/theme.inline.js`. It is plain JavaScript because it ships exactly as written. It is type-checked through `// @ts-check` and kept to a few hundred bytes, because every page carries it. Its explanation lives in a template comment beside the place where `BaseLayout.astro` emits it, which the build strips, rather than in the shipped file.

`BaseLayout.astro` emits it as a classic inline script, `<script is:inline set:html={themeScript}>`, straight after the viewport `<meta>`. On today's build that puts it before both stylesheet links (checked on the built homepage), so it is parsed and run before the first paint and makes no request.

The site sends no Content-Security-Policy: none is set in `public/_headers`, in `functions/_middleware.js` or anywhere under `src/`, which is why `/classroom-groups`'s own inline script runs today. The theme script relies on that. If a policy is ever added, it must allow this script by its hash in `script-src`, or every page flashes and the switch stops working. Because the inventory guard pins the script's content (§6.4), its hash changes only when the file does.

Storing the choice sets no cookie and sends nothing anywhere. It writes one word, and only when the visitor presses the switch, which is the same footing on which `/classroom-groups` already keeps `'cg-sound'`.

It does five things:

1. **Reads the saved choice.** It calls `localStorage.getItem('theme')` inside `try`/`catch`, the same guard `/classroom-groups` uses for `'cg-sound'`, because some privacy modes throw `SecurityError` on touching storage. If the value is exactly `light` or `dark`, it stamps `data-theme` on `<html>`.
2. **Reveals the switch.** It stamps `data-theme-switch` on `<html>`, which turns `--switch-display` on (§4). So **with JavaScript off the switch never appears** and the device setting applies.
3. **Handles clicks by delegation** on `document`, because the switch does not exist yet when a head script runs. A click computes the current theme (the stamp, or `matchMedia('(prefers-color-scheme: dark)')` when unstamped), stamps the opposite and saves it. If saving throws, the page still switches; the choice just is not remembered.
4. **Keeps `aria-pressed` true to the theme**: on `DOMContentLoaded`, after a click, and when the OS setting changes while no choice is saved.
5. **Re-applies the saved choice, and `aria-pressed` with it, on `pageshow`** when the page comes back from the back-forward cache. Without this, a visitor who switches theme and presses Back would see the page they left, in the theme they left.

**Not included, deliberately:**

- a third "follow the device" option in the interface, because the operator asked for a single button;
- syncing open tabs, because a tab picks the choice up on its next page load;
- a cookie. The pages are prerendered files, so a cookie would only help if something rendered the theme into each response. That would put `functions/` on the path of every page view for a preference `localStorage` already keeps without sending it anywhere;
- a `theme-color` meta. The site sets none (checked under `src/`), so a phone's browser bar follows the page's own background in either theme.

## 6. How it is proven (part 4)

### 6.1 Contrast, in both themes

`contrast.test.ts` reads **both** palettes: light from bare `:root`, and dark from a dark block (§4). It runs every pair against each. Four defects in the current model are fixed on the way:

- **Stacking order.** CSS paints the **first** background layer on top, so `body::before` puts the shaft at the **bottom**, while the test's `ATMOSPHERE` stacks it on top. In dark mode the test's order was only stricter (`--ink-soft` 5.05:1, against 5.22:1 in paint order). The stack is now **derived from the `body::before` rule itself**, the `var()` names in declaration order, so it cannot disagree with what the browser paints.
- **The worst case.** "Every stop composited at once" is the worst case only when every layer moves the ground towards the ink. That holds in Aurora, where every layer lightens a near-black ground under light ink, and **fails in Studio**, where the shaft brightens the ground under dark ink while the pools darken it. The worst case is now taken over **every subset** of the four layers. Measured while designing: Studio's first draft passed with all four layers at once (5.15:1 in paint order) and failed at 3.92:1 against its two shade pools alone.
- **The glass pairs.** The suite composites `--glass` over the page ground, `--bg`. The site's one glass fill, `.work-card-badge` (`WorkCard.astro:60`), sits inside a card whose own background is the opaque `--surface`, and it carries `--accent` text. The pairs become the stack that is drawn: `--accent` on `--glass` over `--surface`. The `--ink` and `--ink-soft` on glass pairs describe text no page puts there, so they go.
- **Pairs follow the painted ground.** `--accent-ink` is the link hover colour (`a:hover` in `tokens.css`), drawn wherever links are, so it gains the pair over the atmosphere that `--accent` already has. `--danger` gains no pair over the atmosphere, and its existing flat pairs stay: its one use, the Glory Points error, sits in `div.card` on `--surface`, as a real DOM showed. Scored over the full atmosphere it would read 4.49:1 in Aurora, a failure on a ground that is never painted behind it. Each pair's ground is checked in a browser before a failure is believed.

The stale claim in `tokens.css`, that `--ink-soft` over the atmosphere scores 5.11:1, is corrected to the measured figures.

### 6.2 Every Playwright project declares its scheme

No Playwright config sets `colorScheme` today, so every project runs under Playwright's **default, which is light**. The day Studio lands, every existing e2e test, dev-sanity, prod-sanity and the device suite would silently start testing a different palette. So:

- **every project in every config declares `colorScheme`.** That covers `playwright.config.ts`, `playwright.dev.config.ts`, `playwright.device.config.ts` and `playwright.prod.config.ts`. The unit guard **derives the configs from the filesystem** (`playwright*.config.ts`) rather than from this list, so a fifth config cannot slip past it. The general suite declares **dark**, so every existing test keeps testing the palette it tests today;
- **the palette-reading guards run once per theme.** Those are `palette-controls.spec.ts`, `print-legibility.spec.ts`, `thai-typography.spec.ts`, and every assertion in `classroom-groups.spec.ts` that reads a computed colour. Print runs under both themes, and additionally with a stamped `dark` choice, proving that paper ignores the screen theme. **Every per-theme run first asserts the theme it rendered**, by reading the page's computed ground against that theme's `--bg`, so a run that was meant to be light but rendered dark fails rather than passing on the other palette. A print run makes this assertion in screen media, before it switches to print, because on paper the ground is white whatever the theme. The device gauntlet makes the same assertion on each phone;
- **dev-sanity and prod-sanity** each prove on their deployed site that the switch toggles and that the choice survives a reload. The switch is a rendering fact, so it belongs in the browser runs, not the `curl` smoke;
- **the device gauntlet pins the theme per run**: Android Chrome over CDP through `Emulation.setEmulatedMedia`, and iOS Safari by stamping a saved choice before the measured load. Its results therefore never depend on the phone's own setting.

### 6.3 The switch, rendered

A new `theme.spec.ts` covers:

- **no flash, both directions.** One case is a saved `light` choice on a device preferring dark; the other is a saved `dark` choice on a device preferring light. An init script records `getComputedStyle(documentElement).backgroundColor` in the first animation frame, which runs before the first paint, and it must equal the saved theme's `--bg`. A static guard backs it on every built page: the theme script is inline, classic (no `type="module"`, which would defer it), inside `<head>` and before every stylesheet. The static guard covers a script that is moved or made a module, which a fast page could otherwise hide from a timing test;
- **persistence** across a reload, a second page, and a new browser context carrying the same storage;
- **Back**: switch on page B, go back to page A from the back-forward cache, and A shows the new theme. The test asserts that `pageshow` reported `persisted: true`, because a page reloaded instead of restored re-runs the head script and would pass without the handler ever running. An engine that never restores from the cache in the test browser reports a skip with that reason, never a pass. So that the handler is proven even if every engine skips, a second case runs in every engine: it changes the saved choice underneath an open page, dispatches a `pageshow` with `persisted: true`, and asserts that the theme and `aria-pressed` follow. That case is the one the §6.8 mutation turns red;
- **storage refused**: `localStorage` throws, the switch still changes the page, no error reaches the console, and nothing is saved;
- **the OS changes** while no choice is saved: emulated `colorScheme` flips, the page follows, and so does `aria-pressed`;
- **instant**: in the first animation frame after the click, the page's ground is already the new theme's `--bg`. Nothing transitions;
- **not printed**: under emulated print media, the switch is not rendered;
- **without JavaScript** the switch is absent and the device setting applies;
- **accessibility**: the name is the locale's own `themeDarkMode` in each of the five locales, `aria-pressed` is correct in each state, the target is 44 × 44, and the focus ring is visible;
- **keyboard**: Enter and Space each toggle the switch. The two existing walks through the Tab order, in `chrome.spec.ts` and `skip-link.spec.ts`, are updated to expect the switch at its place in the header, before the language switcher. They are not loosened to step past it.

### 6.4 The script inventory, pinned

The two guards that hold "the homepage ships no JavaScript" are rewritten to pin **what may exist** rather than count to zero: `locale-switcher.test.ts:112` (_ships no JavaScript, because the homepage ships none_) and `classroom-groups.spec.ts:2087` (_the homepage still ships no JavaScript_).

What exists today was measured in a browser on all 16 built pages:

- the homepage in all five locales, and the 404, carry no script;
- `/glory-points` in each locale carries one module;
- `/classroom-groups` in each locale carries one module and one small inline script of its own (505 bytes, in the body).

After this change, **every page carries the theme script exactly once**: inline, in `<head>`, and identical in content to `src/scripts/theme.inline.js`. The homepage in all five locales and the 404 carry **nothing else**, and the tool pages' own scripts are unchanged.

The inventory is read from a real DOM (`document.scripts`), never by matching `<script` in the HTML text. On today's build a text match counts a comment on `/classroom-groups` that only mentions the tag.

### 6.5 Visual baselines, both themes

Each of the visual suite's 12 views is captured in both themes, so **12 baselines become 24**. The light set is new, named with a `-light` suffix. The dark set keeps today's file names, so that its diff can be reviewed file by file. The existing 12 are re-captured once, because the switch now sits in every header, and their diff against today's is reviewed to show changes in the header alone: the switch, and the header items it moves along. Both sets are captured and compared in the pinned `linux/amd64` Playwright image, as today. The light set goes through the repo's control sequence before it counts: capture; run unchanged and confirm it compared and wrote nothing; recolour one Studio token and confirm red, with the diff naming the region; restore and confirm green. A set that was only ever written has compared nothing.

### 6.6 No colour a theme cannot see

Theme logic lives only in `tokens.css`. Components read tokens and never test the theme, so a colour written straight into a component is the one thing a theme cannot reach.

A unit guard scans every `.astro`, `.css` and `.ts` file under `src/` except `tokens.css`, with comments stripped by `tests/unit/source-text.ts`. It covers TypeScript because colours reach styles from there too: `shytalk-brand.ts` feeds the mark through `define:vars`. It refuses any colour literal that is not on a short allowlist, and every allowlist entry carries its reason. A colour literal is a hex value, `rgb()`/`rgba()`, `hsl()`/`hsla()`, or a named colour; `transparent` and `currentColor` are not colours a theme needs to reach. Today's literals set the allowlist's shape:

- the light callouts on `/classroom-groups`, which carry their own ground, ink and border in either theme;
- print-only rules;
- a scrim and shadows that read on both grounds;
- ShyTalk's brand constants (`shytalk-brand.ts`), the same in both themes by design;
- the flag artwork (`flags.ts`).

The phone mockup's shadow leaves the list by becoming `--lift-shadow`. The dead `var(--…, fallback)` values leave with the §7 cleanup.

### 6.7 Evidence for sign-off

The evidence page for the operator's sign-off shows every built page in both themes at 320px and 1280px, in all five locales. It also shows the interactive states:

- the phone menu open;
- the language list open, showing the compact label;
- the switch focused;
- `/classroom-groups` with results, on the full-screen board, with the roster, and with the docked bar;
- the print preview of `/classroom-groups`.

### 6.8 Every guard watched failing

Every new or rewritten guard is mutation-verified in both directions before it lands, following the repo rule. Every guard that **discovers** its population asserts that population with the repo's `searched()` liveness control, counted by content, so an empty discovery cannot pass. That covers the built pages, the Playwright configs, the dark blocks, the scanned source files and the header's items. These are the minimum mutations, one per guard:

| mutation                                                                | must turn red                             |
| ----------------------------------------------------------------------- | ----------------------------------------- |
| a second inline script on the homepage                                  | the script-inventory guard                |
| the theme script made a module, or moved to the end of `<body>`         | the static no-flash guard                 |
| the stamp delayed by a `setTimeout`                                     | the first-frame no-flash test             |
| one token changed in only one dark block                                | the dark-blocks-identical guard           |
| a token declared only inside a dark block                               | the bare-`:root` completeness guard       |
| the dark blocks' `@media screen` wrapper removed                        | print legibility with a stamped dark choice |
| `--ink-soft` lightened so it fails over the shade pools alone           | the subset worst-case contrast test       |
| a project's `colorScheme` removed, or a new config added without one    | the scheme-declared guard                 |
| the `try`/`catch` around the save removed                               | storage refused (page still switches)     |
| the save removed                                                        | persistence                               |
| the `pageshow` handler removed                                          | Back (the synthetic `pageshow` case)      |
| the OS-change listener removed                                          | the OS changes                            |
| `--switch-display` shown on bare `:root`                                | without JavaScript                        |
| the light `--wordmark-tile` changed                                     | the wordmark-tile guard                   |
| `color: #fff` written into a component                                  | the colour-literal guard                  |
| `transition: background-color 0.2s` added to `html`                     | instant                                   |
| the reveal rule taken out of `@media screen`                            | not printed                               |
| the switch's accessible name removed                                    | accessibility                             |
| the switch given `tabindex="-1"`                                         | keyboard, and both Tab-order walks        |
| a per-theme project set to the other scheme                             | that run's own theme assertion            |
| the click delegation removed, with the sanity suites run against a local build | the dev-sanity and prod-sanity switch checks |

## 7. Cleanup in the same ticket (part 4)

- `ClassroomGroupsPage.astro` still quotes the pre-Aurora palette. The comment near line 1094 (`--ink` `#16171c`, `--bg` `#f7f6f2`) is corrected, and the fallbacks `var(--bg, #f7f6f2)` and `var(--border, #e7e4dc)` near line 2871 are dropped. So are `LanguageSwitcher.astro`'s `var(--surface, …)` fallbacks, since every token is always defined.
- `--violet`, `--deep` and `--glass-2` are removed (§3.1).
- The 5.11:1 comment in `tokens.css` is corrected (§6.1).
- The atmosphere tokens are renamed (§3.3), and every reference follows, including `contrast.test.ts`.
- `CLAUDE.md`'s working agreement reads "Homepage ships zero JS. Only `/glory-points` and `/classroom-groups` have scripts, in both locales." It is amended to say that the homepage ships exactly one inline script, the theme script, and to name the guard that pins it. "In both locales" becomes the five locales the site builds.
- #141's paint-cost figure stands. The atmosphere keeps its four gradients and their geometry; only the colour values change.

## 8. Translation

One new catalogue key, `themeDarkMode`, reads "Dark mode" in English. It is typed through `Catalogue`, so a missing locale fails `astro check`. The id, zh, vi and th values are machine-drafted like the rest of those catalogues. The label is two words, so it goes through the short-label guards (`label-check.test.ts`, `verified-labels.test.ts`) and the back-translation gate like every other label, and `locale-fallbacks.test.ts` refuses English left in zh, vi or th.

## 9. Risks

| risk                                                                  | answer                                                                                                                                 |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| a component colour a theme cannot reach                               | §6.6: every literal outside `tokens.css` is refused unless it is allowlisted with its reason                                          |
| a whole suite silently changes palette                                | §6.2: every project declares its scheme, and a guard derived from the filesystem enforces it                                          |
| the two Aurora blocks drift apart                                     | §4: a guard finds every dark block by its `color-scheme` and asserts they are equal                                                    |
| print follows a dark screen                                           | §4: the dark blocks are screen-only, proven with a stamped dark choice                                                                 |
| the header runs out of room in a long-label locale                    | §5: the compact label from #329, whose geometry guard covers every header item in every locale                                        |
| Back shows a page in the theme the visitor just left                  | §5: the saved choice is re-applied on `pageshow`                                                                                       |
| a real phone's own setting changes the gauntlet's results             | §6.2: the device harness pins the scheme per run                                                                                       |
| a visitor's storage is refused                                        | §5: the page still switches; the choice just is not remembered                                                                         |
| a Content-Security-Policy added later blocks the inline script        | §5: the policy must allow the script by its hash, which is stable because §6.4 pins the script's content                               |

## 10. Acceptance criteria

These replace the criteria in the #142 issue body once this spec is approved.

1. The Studio palette (§3.1) is complete on bare `:root`. Aurora redefines only tokens, in screen-only blocks that a unit guard finds by their `color-scheme: dark` and proves identical. No token is defined only inside a theme block. Aurora's values are unchanged.
2. Three states: a `[data-theme]` stamp wins in both directions, and with no stamp the page follows `prefers-color-scheme` live.
3. One 44 × 44px switch in the header, grouped with the language switcher and before it, at every width. At narrow widths it sits beside #329's compact language label, and nothing in the header overlaps, in every locale, at every width from 320px. It is a toggle button named by the locale's `themeDarkMode` ("Dark mode" in English), pressed when dark, showing a moon in light and a sun in dark, with a visible focus ring. Tab reaches it before the language switcher, and Enter or Space toggles it. It switches instantly.
4. The choice persists across pages, reloads, sessions and Back.
5. No flash in either direction, proven by the first-frame test and by the static guard (inline, classic, in `<head>`, before every stylesheet), both mutation-verified.
6. Every built page carries the theme script exactly once, inline in `<head>` and identical to `src/scripts/theme.inline.js`. The homepage in all five locales and the 404 carry no other script. The inventory is read from a real DOM. The two former zero-JS guards are rewritten to pin this and are mutation-verified.
7. Without JavaScript the switch is absent and the device setting applies. With storage refused, the switch works for the page and nothing is saved.
8. One `body::before` layer in both themes, painting Studio's values in light mode. The language band has no glow in light mode, and the phone mockup's shadow comes from `--lift-shadow`.
9. Contrast: every pair passes in both themes, taking the worst over every subset of the atmosphere layers, in the paint order derived from `body::before`, with the glass pairs as drawn (§6.1).
10. Print is measured against white alone and is identical whichever theme the screen shows, including a stamped dark choice. The switch does not print.
11. The palette-reading guards (§6.2) run once per theme, and each run first asserts the theme it rendered (a print run does so in screen media).
12. The visual suite holds 24 baselines, each of its 12 views in both themes. The dark set keeps today's file names and differs from today's only in the header. The light set carries a `-light` suffix and has been through the capture, compare and mutate sequence (§6.5).
13. Every project in every `playwright*.config.ts` declares `colorScheme`, enforced by a guard that derives the configs from the filesystem. Dev-sanity and prod-sanity prove the switch on their deployed sites. The device gauntlet pins the scheme per run.
14. The ShyTalk mark sits on `SHYTALK_MARK.tile` in light mode (guarded), is unchanged in dark mode, and prints in ink.
15. No colour literal outside `tokens.css` except the allowlisted ones, each with its reason (§6.6).
16. The §7 cleanup is done, and the atmosphere tokens carry their positional names everywhere.
17. `themeDarkMode` exists in all five catalogues and passes every locale guard.
18. The evidence page (§6.7) covers every page, both themes, all five locales and the listed states.
19. Every new or rewritten guard has been watched failing and then passing, and every guard that discovers its population asserts that population with `searched()`. §6.8 lists the minimum mutations.

## 11. Delivery

Three pull requests, in this order:

1. **#142 groundwork, changing no pixel.** It renames the atmosphere tokens, retires the unused ones, corrects the stale comments and fallbacks, introduces `--lift-shadow`, and moves the contrast suite to the derived paint order, the subset worst case and the glass pairs as drawn. It also declares `colorScheme` in every project and adds the colour-literal guard. The unchanged visual suite proves nothing moved.
2. **#329, the compact language label.** It is its own ticket, with its own geometry guard. It can land before, after or beside the groundwork, but always before step 3.
3. **#142 light mode.** Studio, the dark blocks, the script, the switch, the translation, `theme.spec.ts`, the palette guards per theme, the light baselines and the `CLAUDE.md` amendment.

Splitting it keeps the light-mode pull request's diff to the feature itself. It also means a rename that missed a reference fails loudly while no colour has changed yet to hide it.

## 12. Review log

**Pass 1, 2026-09-23.** It checked every factual claim against the repo and a real browser, and found 24 problems. The substantive ones:

- the switch's placement had been measured in English only; #329 was filed, and the operator decided the compact label;
- the site builds **five** locales, not two;
- there are **four** Playwright configs, not three;
- the site has `functions/`, so "no server" was false;
- `defer` does nothing on an inline script, so it could not be the mutation;
- the glass pairs modelled a stack no page draws;
- a return from the back-forward cache would have shown the stale theme;
- nothing guarded against a colour a theme cannot reach;
- the #142 body's "tone Aurora down" conflicted with this spec, and the operator kept Aurora.

**Pass 2, 2026-09-23.** It found 11 problems, all within the spec:

- the colour guard's scope missed TypeScript, where `shytalk-brand.ts` and `flags.ts` hold colours;
- "a named colour" did not say `transparent` and `currentColor` were exempt;
- `a:hover` paints `--accent-ink` as text over the atmosphere, and it had no pair there. It now has one (7.36:1 and 10.34:1);
- a pair for `--danger` over the atmosphere was tried and rejected, because a real DOM showed its only use sits on a card;
- the switch's reveal rule would have had a component test `:root`, so it moved into `tokens.css` as `--switch-display`;
- `aria-pressed` had no stated value before the script runs;
- prod-sanity did not prove the switch;
- the absence of `theme-color` was unstated;
- the rest were a grammar slip and two places that pointed at the old reveal rule.

**Pass 3, 2026-09-23.** It found 6 problems:

- Studio's `--glass` was white on a white card, so the work-card badge had no visible fill. It now has a faint ink tint, rendered on the real cards (the accent reads 6.27:1 on it);
- the Back test could pass on a reload, so it now asserts `persisted: true`;
- guards that discover their population needed `searched()` liveness;
- one mutation described the scenario under test rather than a break in it: making the save throw *is* storage refused. It is now the removal of the `try`/`catch`;
- two references had gone stale since pass 2.

**Pass 4, 2026-09-23.** It found 2 problems, both omissions:

- AC3 did not state the switch's focus ring, which §6.3 tests;
- a return from the back-forward cache re-applied the theme but did not say it refreshes `aria-pressed`, which would otherwise announce the old state.

The review page gained the work cards as refined in pass 3.

**Pass 5, 2026-09-23.** A second lens: it checked that each acceptance criterion can be decided by a test, that each of the 30 § references resolves (all do), that each number traces to a measurement, and that each mechanism can be built. It found 3 problems:

- "switches instantly" (AC3) had no test;
- "the switch does not print" (AC10) had no test;
- if no test engine restores from the back-forward cache, every Back case skips and the `pageshow` mutation could never go red. A synthetic `pageshow` case now runs in every engine.

**Pass 6, 2026-09-23.** Read as the developer who has to build it. It found 2 problems:

- the light baselines had no stated names, and "the dark set differs only in the header" can only be reviewed if the dark set keeps today's names;
- the three rendered checks added in pass 5 and the accessibility check had no mutations, against "one per guard".

It confirmed that `tests/unit/source-text.ts` already reads `.astro` files (`withoutAstroComments`, `astroCodeViews`, `astroStyleViews`).

**Pass 7, 2026-09-23.** It traced every mechanism to the test that proves it, and every test to the mutation that breaks it. It found 2 liveness gaps:

- the light baselines did not name the capture, compare and mutate sequence, without which a written set proves nothing;
- the per-theme runs never asserted which theme they rendered, so a misconfigured light run would pass on the dark palette.

**Pass 8, 2026-09-23.** A read of the head of the spec and of §6.2 to §7, with every lens at once. It found 1 problem: pass 7's per-theme assertion compared the rendered ground against the theme's `--bg`, which a print run could never satisfy, since paper is white in either theme. A print run now asserts its theme in screen media, before switching to print.

**Pass 9, 2026-09-23.** A read of §3 to §6.1 and of §8 to the end. It found 4 problems, all of one kind: acceptance criteria lagging behind requirements added to the body. AC11 lacked the per-theme assertion, AC12 the baselines' names and control sequence, and AC19 the `searched()` liveness. Separately, "`--danger` keeps only its card pairs" contradicted the table's `--danger` on `--bg` row. Every requirement added in passes 5 to 8 was then checked against §10, and each now has its criterion.

**Pass 10, 2026-09-23.** It re-read every region changed since its last full reading, and checked mechanically that all 26 body requirements have their criterion and all 33 § references resolve. It then applied the two lenses no pass had used. It found 2 unstated assumptions:

- **security:** the inline script works only because the site sends no Content-Security-Policy (checked in `_headers`, the middleware and `src/`), which is now stated, together with what a future policy must allow;
- **privacy:** the basis for storing the choice on the visitor's device was unstated.

**Pass 11, 2026-09-23.** A read of §5 adding the lenses not yet applied: accessibility beyond the switch's semantics, forced colours, performance and rollback. It found 1 problem: the switch's look was unspecified. With no fill or border, its icon is what identifies it under SC 1.4.11, so the icon's colour matters. It now follows the header's menu button: `currentColor` from `--ink`, 13.33:1 at worst. Performance (a few hundred inline bytes, no request) and rollback (a stale `theme` key is ignored by a site without the script) raised nothing.

**Pass 12, 2026-09-23.** The first pass to read every line of the spec in a single sitting; passes 8 to 11 had each covered the changed regions and some spans. It found 3 problems:

- §1 said the brand green was "the only colour on the page", but the page also carries the ShyTalk mark, the flags and the app screenshot. The claim is now about Studio's palette;
- §9's risk table lacked the future Content-Security-Policy that pass 10 wrote into §5;
- the entries for passes 8, 9 and 11 claimed complete reads that were partial. They now say what each actually read.

**Pass 13, 2026-09-23.** A second read of every line in one sitting. It found 1 problem: the switch checks added to dev-sanity and prod-sanity in pass 2 are new guards, but §6.8 gave them no mutation. They run against deployed sites, so their mutation runs the same suites against a local build.

**Pass 14, 2026-09-23.** A mechanical check that each of the 20 guards named in the body has its mutation (all do), then a read of every line. It found 1 problem: the switch is a new focusable element in every header, so the two existing Tab-order walks (`chrome.spec.ts`, `skip-link.spec.ts`) will meet it. §6.2's "every existing test keeps testing exactly what it tests today" held only for the palette. The walks now expect the switch, keyboard activation is tested, and the sentence says what it means.

**Pass 15, 2026-09-23.** A read of every line. It found 1 problem, a repeat of pass 9's kind: pass 14 added a keyboard requirement to §6.3 but not to §10, so AC3 now states it. The mechanical check that every body requirement has its criterion, first run in pass 10, now runs on every pass rather than once.

**Pass 16, 2026-09-23.** Every mechanical check at once: all 50 § references resolve, all 21 guards have their mutation, all 28 body requirements have their criterion, and no corrected phrase has come back. Then a read of every line. **It found nothing**, so the review loop ended here.

The findings per pass ran 24, 11, 6, 2, 3, 2, 2, 1, 4, 2, 1, 3, 1, 1, 1 and then 0.
