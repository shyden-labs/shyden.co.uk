# The deal's sound and the results celebration: implementation plan (#1339)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The deal plays real recorded notes that climb and swell, the results land with a timpani roll into the Jackpot ending (6-8 s ring-out), and an "All together" celebration plays in time with it; everything stops at once when it should.

**Architecture:** Pure, unit-tested planning (which note, how loud, when each ending layer starts, which effects each fanfare stage fires) lives in `src/lib/dealSound.ts` and `src/lib/celebrationPlan.ts`. `src/scripts/deal-audio.ts` renders those plans with Web Audio and owns every node it starts, so `stop()` can silence them; `src/scripts/celebration.ts` draws the plan on one canvas plus CSS classes on the cards. `classroom-groups.ts` keeps its three hooks (`sfx.shuffle()`, `sfx.land(i)`, `sfx.done()`), now with the deal's size passed to `land`.

**Tech Stack:** TypeScript page scripts, Web Audio, Canvas 2D, CSS (global block in `ClassroomGroupsPage.astro`), AAC assets via macOS `afconvert`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-28-deal-sound-and-celebration-design.md`

## Global Constraints

- No hiss, crackle or white-noise source in any layer, the Shuffle press included (`noiseBuffer` is no longer used by any sound).
- Deal notes: marimba, harp and glockenspiel together on a major-pentatonic scale (steps 0, 2, 4, 7, 9), bases marimba G2 (MIDI 43), harp G3 (55), glockenspiel G4 (67), climbing two octaves (10 steps) then wrapping; a timpani hit on every fourth student (i % 4 === 0); loudness rises with `p = i / (n - 1)` (n = 1 gives p = 1).
- Each note plays from the nearest shipped recording, nudged by at most 3 semitones.
- Ending, relative to the moment the last student lands: timpani roll 0-1.6 s; then at R = 1.7 s whoosh (R-0.5), timpani hit + impact + low drop (R), bell shimmer (R), fanfare stages at R, R+0.5, R+1.0 (C, F, G major, browser-made), timpani hit at R+1.0, sparkle and final chord from R+0.1, glockenspiel "confetti" notes R+0.1..R+4.9, everything faded by R+7.5.
- Celebration ("All together") fires on the three fanfare stages; with `prefers-reduced-motion: reduce` only the card glow shows.
- Stop at once (fade 0.12 s) on: a new shuffle, the board closing, the sound switch turned off. The celebration clears on a new shuffle and on board close.
- Shipped audio: only the recordings the plan names, AAC 96 kbps mono, self-hosted under `src/assets/sfx/`, total under 600 KB; licence and provenance in `src/assets/sfx/CREDITS.md`.
- Tests red first; e2e red on CI first (tests-only commit on a scratch ref); laptop runs unit, format, typecheck only. Light and dark proven for any visual change.

## Review Focus

1. **A class of 100**: the scale wraps (no note above the top recording + 3 semitones) and the deal's pace is unchanged: Task 1 unit test at i = 0..99.
2. **Shuffle again mid-ending**: the ring-out and the celebration stop at once and the new deal starts clean: Task 3 unit test (every node stopped) and Task 5 e2e.
3. **Sound switched off mid-deal**: the rest of the deal and the ending are silent: Task 3 unit test.
4. **One student, or groups of one**: n = 1 plays a full-loudness note and the ending, no division by zero: Task 1 unit test.
5. **Reduced motion while the celebration would run**: glow only, no canvas drawing, sound in full: Task 5 e2e (emulated `reducedMotion: 'reduce'`).

---

### Task 1: The deal's notes and loudness (pure)

**Files:**
- Create: `src/lib/dealSound.ts`
- Test: `tests/unit/deal-sound.test.ts`

**Interfaces:**
- Produces: `DEAL_INSTRUMENTS = ['marimba', 'harp', 'glock'] as const`; `type DealInstrument`; `DEAL_BASES: Record<DealInstrument, number>` = `{ marimba: 43, harp: 55, glock: 67 }`; `dealStepMidi(base: number, i: number): number` (pentatonic, 10 steps then wrap); `dealLoudness(i: number, n: number): number` (0..1, = `i / (n - 1)`, 1 when n ≤ 1); `timpaniOnStep(i: number): boolean`; `SHIPPED_NOTES: Record<DealInstrument, readonly number[]>` (MIDI of each shipped recording); `nearestNote(instrument: DealInstrument, midi: number): { sample: number; semitones: number }`.

- [ ] **Step 1: Failing tests**: `dealStepMidi(55, 0) === 55`, `(55, 4) === 64`, `(55, 5) === 67`, `(55, 9) === 76`, `(55, 10) === 55` (wraps); for i in 0..99 and each instrument, `Math.abs(nearestNote(inst, dealStepMidi(DEAL_BASES[inst], i)).semitones) <= 3`; `dealLoudness(0, 16) === 0`, `(15, 16) === 1`, `(0, 1) === 1`; `timpaniOnStep(0) && timpaniOnStep(4) && !timpaniOnStep(3)`.
- [ ] **Step 2: Run** `npx vitest run --configLoader native tests/unit/deal-sound.test.ts`: FAIL, module not found.
- [ ] **Step 3: Implement.** `SHIPPED_NOTES` is chosen so the coverage test passes with the fewest recordings, from VSCO 2 CE's notes (marimba C2 F1 G2 B2 C4 F3 B4 G4 F5 C6; harp every recording A2-A6; glock G4 C5 G5 C6 G6 C7).
- [ ] **Step 4: Run**: PASS; mutate the wrap (`% 10` to `% 11`) once, see the coverage test fail, restore.
- [ ] **Step 5: Commit.**

### Task 2: The ending's schedule (pure)

**Files:**
- Modify: `src/lib/dealSound.ts`
- Test: `tests/unit/deal-sound.test.ts`

**Interfaces:**
- Produces: `type EndingEvent = { at: number; kind: 'roll' | 'whoosh' | 'timpaniHit' | 'impact' | 'drop' | 'bellShimmer' | 'fanfare' | 'finalChord' | 'sparkle' | 'confettiNote'; gain: number; durationS: number; rootHz?: number; notes?: readonly number[]; midi?: number; pan?: number }`; `ROLL_S = 1.6`, `REVEAL_AT_S = 1.7`, `FANFARE_STAGES_S = [0, 0.5, 1.0]` (relative to the reveal), `RING_OUT_S = 7.5`; `endingPlan(rng: () => number): EndingEvent[]` (times relative to the last landing).

- [ ] **Step 1: Failing tests**: the plan has one `roll` at 0 lasting 1.6; three `fanfare` events at 1.7, 2.2, 2.7 with `rootHz` 261.63, 349.23, 392.00 (C4, F4, G4); a `timpaniHit` at 1.7 and at 2.7; the latest `at + durationS` ≤ 1.7 + 7.5; no event of a noise kind exists (the union has none); every `confettiNote` `midi` is a glockenspiel note within `nearestNote`'s 3 semitones; the same seed gives the same plan.
- [ ] **Step 2: Run**: FAIL.
- [ ] **Step 3: Implement** with the values in Global Constraints; confetti notes: 66 at random times in [1.8, 6.6], pentatonic from 79, gain falling with time (rng-driven, `createPrng` from `sfx.ts`).
- [ ] **Step 4: Run**: PASS; mutate one fanfare time once, see it fail, restore.
- [ ] **Step 5: Commit.**

### Task 3: Playing it, and stopping it (Web Audio, unit-tested with a fake context)

**Files:**
- Create: `src/scripts/deal-audio.ts`
- Modify: `src/scripts/classroom-groups.ts` (`sfx.shuffle/land/done` at about line 2013; the deal loops at about 2355 and 2425; the sound toggle; the board's exit)
- Test: `tests/unit/deal-audio.test.ts` (a recording fake `AudioContext`, as other sfx tests stand one in)

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces: `createDealAudio(deps: { ctx: () => AudioContext; bus: () => AudioNode; sample: (name: string) => AudioBuffer | null; rng: () => number }): { shuffle(): void; land(i: number, n: number): void; done(): void; stop(fadeS?: number): void }`. Sample names: `marimba-<midi>`, `harp-<midi>`, `glock-<midi>`, `timpani-hit`, `timpani-roll`, `whoosh`, `impact`, `drop`, `bell`, `sparkle`.

- [ ] **Step 1: Failing tests**: `land(0, 16)` starts three buffer sources (marimba, harp, glock) at the right `playbackRate` (`2 ** (semitones / 12)`), plus `timpani-hit`; `land(3, 16)` starts no timpani; `done()` schedules every `endingPlan` event; `stop()` ramps every live gain to 0 within 0.12 s and stops every source; `shuffle()` after `done()` stops the ending first; with a missing sample, `land` falls back to a sine/triangle tone (no `createBufferSource` with a noise buffer anywhere: assert no buffer filled with random values is ever created).
- [ ] **Step 2: Run**: FAIL.
- [ ] **Step 3: Implement** `deal-audio.ts`; fanfare as three detuned sawtooths per note through a lowpass that opens to 2600 Hz; final chord as triangles. Wire into `classroom-groups.ts`: `sfx.land(i, cards.length)`; `sfx.shuffle()` calls `stop()` first; the sound toggle turning off and the board's exit call `stop()`; `shuffle()` plays a soft `timpani-hit` (no noise grains). Remove the old `shuffleGrainPlans`/`noiseBuffer` path.
- [ ] **Step 4: Run** unit: PASS; mutate `stop()` to skip one source once, see it fail, restore.
- [ ] **Step 5: Commit.**

### Task 4: The recordings that ship, and their credits

**Files:**
- Create: `scripts/sfx-encode.mjs` (one-off, documented: `afconvert -f m4af -d aac -b 96000 -c 1` per source, trims silence below -60 dBFS keeping 15 ms, as `CREDITS.md` already describes)
- Create: `src/assets/sfx/deal/*.m4a` (one file per `SHIPPED_NOTES` entry plus the timpani hit and roll, and the five Freesound layers)
- Modify: `src/lib/sfxAssets.ts` (`SFX_MANIFEST` lists exactly these files; the old Kenney `land-*`, `shuffle`, `done` entries and files removed), `src/assets/sfx/CREDITS.md`
- Test: `tests/unit/sfx-assets.test.ts` (existing file: extend)

**Interfaces:**
- Consumes: `SHIPPED_NOTES` (Task 1).
- Produces: one import per shipped file in `classroom-groups.ts`, keyed by the sample names of Task 3.

- [ ] **Step 1: Failing tests**: every `SHIPPED_NOTES` entry has a file in the manifest and on disk; no manifest file is unused; the folder's total size < 600 KB; `CREDITS.md` names VSCO 2 CE (CC0, github.com/sgossner/VSCO-2-CE) and each Freesound page URL with "Creative Commons 0".
- [ ] **Step 2: Run**: FAIL.
- [ ] **Step 3: Encode and commit the files; update the manifest and credits.** Measure each file's RMS and peak and record them in `CREDITS.md`'s table, as today.
- [ ] **Step 4: Run**: PASS. Ear check on the laptop: each file plays clean, no click at its end.
- [ ] **Step 5: Commit.**

### Task 5: The celebration

**Files:**
- Create: `src/lib/celebrationPlan.ts`, `src/scripts/celebration.ts`
- Modify: `src/components/pages/ClassroomGroupsPage.astro` (`<style is:global>`: `.celebrating`, `.cel-wave`, `.cel-shine`, `.cel-glow`, the canvas; `@media (prefers-reduced-motion: reduce)` keeps only the glow), `src/scripts/classroom-groups.ts` (start on `done`, clear on shuffle and board close)
- Test: `tests/unit/celebration-plan.test.ts`, `tests/e2e/classroom-groups-projector.spec.ts` (one journey per mode below)

**Interfaces:**
- Consumes: `REVEAL_AT_S`, `FANFARE_STAGES_S` (Task 2).
- Produces: `celebrationPlan(reduceMotion: boolean): { atS: number; effects: readonly ('cannons' | 'fireworks' | 'wave' | 'shine' | 'twinkles' | 'glow')[] }[]`; `startCelebration(host: HTMLElement, plan, startedAt: number): void`; `stopCelebration(host: HTMLElement): void`. The host gets `data-celebrating` while it runs.

- [ ] **Step 1: Failing tests**. Unit: three stages at 1.7, 2.2, 2.7 with all six effects across them; with `reduceMotion` only `glow`. E2E (real clicks; desktop engines, then phones): after a deal on the board, `#cg-board[data-celebrating]` appears, a `canvas.cel` over the board is visible, the cards get `cel-wave` and the bars `cel-shine`; under `page.emulateMedia({ reducedMotion: 'reduce' })` only `cel-glow` appears and the canvas draws nothing (its pixels read transparent); a second Shuffle pressed during the ring-out removes `data-celebrating` at once; Escape (board close) does too; names stay readable after the celebration ends (contrast ≥ 4.5:1, light and dark).
- [ ] **Step 2: Unit red on the laptop; e2e red on CI** (tests-only scratch commit, every new test read failing by name).
- [ ] **Step 3: Implement**, values from the approved preview (`.superpowers/brainstorm/49383-1795843130/content/preview-celebrate.html`): three cannon volleys from the bottom corners, fireworks at stage 1 (one), 2 (two), 3 (four), twinkles 60, card wave delay 110 ms per card, shine 90 ms per card, glow fading by R+6 s; particle colours are the six `--group-N` tokens of #1338; the canvas is `pointer-events: none`.
- [ ] **Step 4: Run** unit and CI: PASS, every new test listed by name from the JSON report, light and dark.
- [ ] **Step 5: Commit.**

### Task 6: Proof and sign-off

- [ ] **Step 1:** Visual baselines re-captured through `visual-capture.yml` where the board changed; each looked at.
- [ ] **Step 2:** Full device run (every target, totals quoted).
- [ ] **Step 3:** Shyden listens and watches on dev on a projector, with sound, in light and dark, and signs off; each AC posted on #1339 with its evidence.

**Order:** #1338 (the board) lands first: Task 5 needs its `--group-N` tokens and card markup.
