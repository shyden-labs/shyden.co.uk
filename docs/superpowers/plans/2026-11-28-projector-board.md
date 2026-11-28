# The projected board students can read from their seats: implementation plan (#1338)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The full-screen board shows each group under a coloured header bar with a large shape and number, switches light/dark from its own control, and shows numbers first when no names were entered.

**Architecture:** The board keeps moving the live `#cg-results` (`src/scripts/projector.ts`); nothing is re-rendered. `render()` in `src/scripts/classroom-groups.ts` adds a decorative mark (shape + number) and a tone to each group card, and a number span to each student; global CSS scoped to `.cg-board` turns those into the header bar. The page view hides the mark and looks as today. The board's light/dark button is the site's own `ThemeSwitch`, placed in the board bar, so `theme.inline.js` drives it unchanged.

**Tech Stack:** Astro 5, TypeScript page scripts, global CSS custom properties in `src/styles/tokens.css`, Vitest (unit, guards), Playwright (e2e, visual).

**Spec:** `docs/superpowers/specs/2026-11-28-projector-board-design.md`

## Global Constraints

- Six tones and six shapes, in this order: `●` `▲` `■` `◆` `★` `✚`; group `i` (0-based) takes tone and shape `i % 6`.
- No yellow or amber tone (amber is #999's "absent").
- Contrast, light AND dark: bar ink on each tone and names on the card ≥ 4.5:1; the board's controls ≥ 3:1.
- The group number on the board: ≥ 48px at 1024x768, and ≥ 2× the names' computed font size, at 1024x768, 1280x800 and 1920x1080.
- Names keep today's 24px floor (`fitScale`, `src/lib/fit.ts`).
- Board CSS in the `<style is:global>` block of `ClassroomGroupsPage.astro`; `gap`, never spaces, between flex children.
- The toggle reuses `ThemeSwitch.astro` and its existing `themeDarkMode` label: no new copy, so no new translation.
- No new package. Tests red first; e2e and guard tests red on CI first (tests-only commit to a scratch ref, `gh workflow run ci.yml --ref <scratch>`, every new test read failing by name) before any page code.
- Laptop runs unit, format, typecheck only; everything else on CI.
- #999 (absent numbers in amber on the same board) may land first or second: whichever merges second rebases onto the other and re-runs Task 4's journeys with an absent student in the roster.

## Review Focus

1. **More than six groups** (a class of 40 in 10 groups): shapes and tones repeat, numbers stay unique: pinned in Task 1's unit test and Task 4's e2e at 10 groups.
2. **A very long name** ("Christopher Wetherington-Smythe") at 1024x768: no card overflow, the bar's number still ≥ 48px: Task 4's e2e roster includes it.
3. **Thai and Chinese labels**: the visible mark is the shape and digits only, the localised "Group n" stays for screen readers: Task 4 runs every locale.
4. **Theme switched while the board is open, then the board closed**: the page shows the same theme, and a reload keeps it: Task 3's e2e.
5. **A roster where only some students have names**: names-mode (numbers-first only when NO student has a name): Task 2's unit test on `numbersOnly`.

---

### Task 1: Group marks (pure)

**Files:**
- Create: `src/lib/boardMarks.ts`
- Test: `tests/unit/board-marks.test.ts`

**Interfaces:**
- Produces: `export const BOARD_SHAPES = ['●', '▲', '■', '◆', '★', '✚'] as const;` `export function groupMark(index: number): { shape: string; tone: 1 | 2 | 3 | 4 | 5 | 6; number: number }` (number = index + 1). `export function numbersOnly(numbers: readonly number[], names: ReadonlyMap<number, string>): boolean` (true when no number in `numbers` has a non-blank name).

- [ ] **Step 1: Write the failing tests**: `groupMark(0)` → `{ shape: '●', tone: 1, number: 1 }`; `groupMark(5)` → `{ shape: '✚', tone: 6, number: 6 }`; `groupMark(6)` → `{ shape: '●', tone: 1, number: 7 }`; `groupMark(9).number === 10`. `numbersOnly([1,2,3], new Map())` true; `numbersOnly([1,2,3], new Map([[2,'Ayu']]))` false; `numbersOnly([1,2], new Map([[2,'  ']]))` true; `numbersOnly([1], new Map([[9,'Ayu']]))` true (a name for a student not in the deal does not count).
- [ ] **Step 2: Run `npx vitest run --configLoader native tests/unit/board-marks.test.ts`**: expect FAIL, module not found.
- [ ] **Step 3: Implement both functions in `src/lib/boardMarks.ts`.**
- [ ] **Step 4: Run the same command**: expect PASS. Mutate `% 6` to `% 5` once, see it fail, restore.
- [ ] **Step 5: Commit** `src/lib/boardMarks.ts tests/unit/board-marks.test.ts`.

### Task 2: Tones in the palette, scored for contrast

**Files:**
- Modify: `src/styles/tokens.css` (light and dark blocks)
- Modify: `tests/guards/contrast.test.ts` (`PAIRS`)

**Interfaces:**
- Produces: tokens `--group-1` … `--group-6` (the bar colour) and `--group-ink` (text on every bar), each with a light and a dark value.

- [ ] **Step 1: Write the failing guard pairs**: six pairs `{ fg: ['--group-ink'], bg: ['--group-N'], level: 'body', where: 'group N's number on its bar (projected board)' }`, plus the existing card-ink pair already covers names. Commit with the Task 4 tests (one CI red run, below).
- [ ] **Step 2: See them red on CI** (guards are CI-only): tokens missing.
- [ ] **Step 3: Add the tokens.** Light: deep tones (red `#c62828`, teal `#00695c`, blue `#1565c0`, purple `#6a1b9a`, magenta `#ad1457`, green `#2e7d32`) with `--group-ink: #ffffff`. Dark: light tones (red `#ff8a80`, teal `#4dd8b4`, blue `#82b8ff`, purple `#d6a2ff`, magenta `#ff8fc2`, green `#8be08f`) with `--group-ink` the dark ground. These are starting values; the guard's computed ratios decide, and any value under 4.5:1 is adjusted until it clears. No yellow, no amber.
- [ ] **Step 4: CI guards green.**

### Task 3: The board's own light/dark switch

**Files:**
- Modify: `src/components/pages/ClassroomGroupsPage.astro` (board markup at `#cg-board-bar`; import `ThemeSwitch`)
- Test: `tests/e2e/classroom-groups-projector.spec.ts` (one new journey)

**Interfaces:**
- Consumes: `ThemeSwitch.astro` (`data-theme-toggle`, `aria-label={t.themeDarkMode}`), driven by `src/scripts/theme.inline.js`.

- [ ] **Step 1: Write the failing journey** `the board switches light and dark from its own bar, and the page keeps the choice`: open the board with a real click; find the bar's `[data-theme-toggle]` by role and name; assert it is visible, ≥ 44×44px, reached by real Tab from the board's first control; press it with a real click → `html[data-theme]` flips and the board's computed background changes; press again with a real Space → flips back; set dark, close the board → the page is dark; reload → still dark. One test, soft assertions in named steps.
- [ ] **Step 2: Red on CI** (in the tests-only commit with Tasks 2 and 4).
- [ ] **Step 3: Put `<ThemeSwitch lang={lang} />` first inside `#cg-board-bar`**; `projector.ts` appends Shuffle and Exit after it, unchanged.
- [ ] **Step 4: Green on CI, all three desktop engines.**

### Task 4: The header bar, the shape, numbers first

**Files:**
- Modify: `src/scripts/classroom-groups.ts` (`render`, about line 2184)
- Modify: `src/components/pages/ClassroomGroupsPage.astro` (`<style is:global>` board block, about line 2064)
- Test: `tests/e2e/classroom-groups-projector.spec.ts` (one new journey per locale)

**Interfaces:**
- Consumes: `groupMark`, `numbersOnly` (Task 1); `--group-N`, `--group-ink` (Task 2).
- Produces (DOM): each `section.group` gets `data-tone="N"`; its `h3` holds `<span class="group-mark" aria-hidden="true"><span class="group-shape">●</span><span class="group-no">1</span></span><span class="group-label">Group 1</span>` (the label is `groupName(i, t)`, as today); each `li.student` gets `<span class="student-no" aria-hidden="true">3</span>` after `.who`; `#cg-tables` gets `data-numbers-only` when `numbersOnly(...)` is true.

- [ ] **Step 1: Write the failing journey, one per locale** `<locale>: the projected board reads from the back of the room`, roster of 40 with one long name, 10 groups. Real clicks only. Steps, each soft: at 1024x768, 1280x800, 1920x1080 (set and reload inside the one test), in light and dark (toggled with the bar's real switch): every `.group-no` ≥ 48px at 1024x768 and ≥ 2× its card's `.who` font size; contrast of `.group-no` on its bar ≥ 4.5:1 and `.who` on its card ≥ 4.5:1, computed from rendered colours; group 7 shows `●` and tone 1, group 10 shows `◆` and number 10; no `.group` content escapes its card (own-container containment, not page `scrollWidth`) and no sideways page scroll; `.group-label` is in the accessibility tree and not visible; on the page (board closed) `.group-mark` is not visible and the heading reads as today. Second roster, no names: `#cg-tables[data-numbers-only]`, every `.student-no` visible and ≥ 2× the size `.who` had with names, `.who` not visible.
- [ ] **Step 2: Tests-only commit** (Tasks 2, 3, 4 tests with the stubs they need to compile), push to `scratch/1338-red`, dispatch `ci.yml`, read each new test failing by name; delete the ref.
- [ ] **Step 3: Implement the render additions** in `render()`; `textContent` for every value, as today.
- [ ] **Step 4: Implement the board CSS**: on `.cg-board .group`, a header bar painted `var(--group-N)` by `[data-tone]`, `.group-mark` a flex row with `gap`, shape and number in `--group-ink`, number font-size in `em` of the board (≥ 2× the names); `.cg-board .group-label` gets the `.visually-hidden` rules; outside the board `.group-mark` and `.student-no` are `display: none`; `.cg-board #cg-tables[data-numbers-only] .who` hidden, `.student-no` shown large. Page view unchanged.
- [ ] **Step 5: Unit, typecheck, format on the laptop; push; CI green on all engines**, every new test listed passing by name from the JSON report.
- [ ] **Step 6: Commit.**

### Task 5: Baselines, phones, close-out

- [ ] **Step 1: Re-capture visual baselines** through `visual-capture.yml` (push the unpushed commit to `refs/visual/1338-projector-board`, dispatch, download, amend, push once); look at every changed PNG before merge.
- [ ] **Step 2: Real device run** (full gauntlet, every target, totals quoted) once merged, per "every device run covers every device".
- [ ] **Step 3: Post each AC with its evidence on #1338**; Shyden tries the board on dev on a projector and signs off.
