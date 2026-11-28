# The projected board students can read from their seats (#1338)

Date: 2026-11-28. Approved designs and answers are Shyden's; everything marked **my call** is the builder's default, open to his correction.

## Why

Shyden: _"The group number text is hard to read on a projector also. The students will be seeing this and regularly i see them having to come closer to the board to see which group they are in. They shouldn't have to."_

Success: from the back of a classroom, every student finds their group without walking up, in a bright room or a dimmed one.

## Goals

1. Each group's number reads from the back of the room on a projector.
2. The full-screen board switches between light and dark on its own control (Shyden: _"it needs to be able to switch between light and dark mode easily. you can do this from the non-full screen mode. it needs adding to the full screen mode too."_), because the room is sometimes bright and sometimes dimmed.
3. One board style, chosen by Shyden from mockups: **A, header bar + shape**.
4. The board shows names when names were entered, and numbers first when only numbers were.

## Non-goals

- Changing the page's own (non-full-screen) look.
- A choice of board styles (Shyden chose one style, not a picker).
- The sound of the deal: that is #1339, designed separately.

## Anti-goals

- Colour as the only cue (colour-blind students): every group also carries a shape and its number.
- A group colour that can be mistaken for the amber "absent" marking #999 brings.
- Anything that makes the board shrink type below today's 24px floor or scroll sideways.

## The design (approved: finalist A)

Each group card has a full-width coloured **header bar** holding the group's **shape** and **number**, large and in the card's ground colour; the names (or numbers) sit below in heavy type. Mockup: `.superpowers/brainstorm/49383-1795843130/content/board-finalists.html` (finalist A), light and dark.

```
┌───────────────────────┐ ┌───────────────────────┐ ┌───────────────────────┐
│ ●  1                  │ │ ▲  2                  │ │ ■  3                  │  ← coloured bar
├───────────────────────┤ ├───────────────────────┤ ├───────────────────────┤
│ Ayu Lestari  Budi S.  │ │ Eka Putri  Fajar N.   │ │ Indah P.   Joko S.    │
│ Christopher  Dimas P. │ │ Gita Sari  Hendra W.  │ │ Kartika A. Lukman H.  │
└───────────────────────┘ └───────────────────────┘ └───────────────────────┘
                                         [ ☾ Dark ]  [ Shuffle again ]  [ Close ]   ← board bar
```

- **Six group colours and six shapes** (● ▲ ■ ◆ ★ ✚), one pair per group, repeating from group 7 (the number stays unique). Each colour has a light-theme and a dark-theme value. **My call:** no yellow or amber in the set, so #999's amber "absent" stays unmistakable; the mockup's dark-mode yellow is replaced.
- **Numbers-first** (Shyden: it varies by class): when no student in the roster has a name, each student's number is the card's content at a larger size; with names, names as today. **My call:** decided per board render from the roster, no setting.
- **The board's light/dark control** is a button in the board's control bar carrying `data-theme-toggle`, so the page's existing theme script (`src/scripts/theme.inline.js`) handles it: same saved choice, same `aria-pressed`, the page and the board switch together. At least 44px, reachable by Tab, labelled in all five languages.
- **Everything already on the board stays** (Shyden, 2026-11-28: _"i still need to keep the other design pieces. things like absent students, class name, student numbers etc."_): the class name heading, the "numbers … are absent" note and absent list (and #999's amber marking), every avatar and name.
- **A named student's number shows beside the name**, smaller than the name (Shyden's answer, 2026-11-28); with no names, the numbers alone, large.
- **Size**: the header bar's number is at least twice the names' size. **My call:** the type floor (`fitScale`, 24px) applies to names; the bar's number never goes below 48px at 1024x768.

## Constraints

- WCAG AA in both themes: bar text on bar colour and names on card at least 4.5:1, controls at least 3:1; `tests/guards/contrast.test.ts` scores the new tokens.
- Board CSS is `<style is:global>`, because the board's content is rendered by script.
- Use `gap`, never spaces, between flex children (the `display: flex` rule in CLAUDE.md).
- No new package; fonts and everything else stay self-hosted.
- Shares its screen with #999 (all numbers shown, absent in amber): both land on the same board; whichever merges second rebases onto the other.

## Approaches considered

1. **Restyle the existing board in CSS, theme tokens per group (chosen, my call).** The board already reuses `#cg-results`; header bars, colours and shapes come from global CSS keyed on each group's position, plus one shape element and one toggle button added by script. Smallest change, one render path kept.
2. A separate board rendering. Rejected: `projector.ts` deliberately moves `#cg-results` instead of re-rendering, so the board can never disagree with the page.
3. A style picker with several styles. Rejected by Shyden (one style).

## Proof (each AC on the ticket)

- Rendered board measured at 1024x768, 1280x800 and 1920x1080, in light and dark, in all five languages: number size, contrast, no card overflow, no sideways scroll.
- The toggle pressed with a real click and a real key press switches the board at once and is remembered after a reload.
- A roster with no names shows numbers first; one with names shows names.
- Tests are written and seen red first; the e2e ones are red on CI before the code exists. Visual baselines are re-captured through `visual-capture.yml` and each is looked at.

## Left to the builder

The exact six colour values per theme (chosen by computed contrast), the shape glyphs' font coverage (fallback to inline SVG if a glyph is missing in a self-hosted font), and the five-language label for the toggle (read back by Google before commit).
