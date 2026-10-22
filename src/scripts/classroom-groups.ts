/**
 * Classroom Group Creator — DOM wiring, animation and sound.
 *
 * Per the repo's working agreement, the logic lives in src/lib/grouping.ts
 * and src/lib/roster.ts, and this file only drives the page. It computes
 * the arrangement FIRST, writes it into the DOM as real text, and only
 * then animates. That ordering is what
 * makes "skip the animation", a screen reader, and a finished deal all expose
 * exactly the same result — the animation is a presentation of the answer, never
 * the means of producing it.
 */
import {
  anonymousStudent,
  buildGroups,
  plannedGroups,
  type GroupingInput,
  type Student,
  type Mode,
  type Leftovers,
  type SexMode,
} from '../lib/grouping';
import {
  serialiseForCompare,
  nextNumber,
  rosterAtLimit,
  rosterCounts,
  rosterOpenProblem,
  rosterProblems,
  rosterRoomProblem,
  rosterWarnings,
  studentsBoxLocked,
} from '../lib/roster';
import {
  renderRoster,
  type RosterHandlers,
  type PrintColumn,
} from './roster-ui';
import {
  envelopeTotalS,
  landVoicePlan,
  doneVoicePlans,
  shuffleGrainPlans,
  DONE_STAGGER_S,
  DONE_RISER,
  DONE_REVERB_SEND,
  SHUFFLE_SUB,
  SHUFFLE_REVERB_SEND,
  MASTER_GAIN,
  MASTER_HIGHPASS_HZ,
  MASTER_LOWPASS_HZ,
  MASTER_COMPRESSOR,
  REVERB_RETURN_GAIN,
  generateReverbImpulseResponse,
  generateSaturatorCurve,
  createPrng,
  admitVoice,
  FAST_STEP_S,
  NORMAL_STEP_S,
  type Envelope,
  type VoicePlan,
} from '../lib/sfx';
import {
  getStrings,
  isLocale,
  renderError,
  renderWarning,
  renderNumbersProblem,
  groupName,
  resultsHeadingText,
  type Locale,
  type Strings,
} from '../lib/i18n';
import {
  parseNumberSets,
  studentsForInput,
  type NumberFields,
  type NumberSetsProblem,
} from '../lib/numberSets';
import { sexWhy, sexWhyReturning } from '../lib/sexOptions';
import { renderIo } from './io-ui';
import { renderPrintPanel } from './print-ui';
import { renderProjector } from './projector';
import { travel } from './board-travel';
import { travelOrder, travelSchedule } from '../lib/travel';
import { todayISO } from '../lib/csv';
import { sectionState } from '../lib/sections';
import { staleReason, type Snapshot } from '../lib/staleness';
import { avatarSymbolId } from '../lib/avatars';
import { keyboardOverlap } from '../lib/keyboard-dock';
import { landAssetIndex, SFX_ASSET_GAIN } from '../lib/sfxAssets';
// Six real, mastered CC0 samples (src/assets/sfx/CREDITS.md has provenance
// and licence) -- imported through Vite so a missing file fails the BUILD,
// not a 404 nobody notices at runtime, and so each becomes a content-hashed,
// same-origin URL string with no code here needing to know or care what
// that hash is. See the "── sound" section below for how each is used.
import shuffleAssetUrl from '../assets/sfx/shuffle.m4a';
import land1AssetUrl from '../assets/sfx/land-1.m4a';
import land2AssetUrl from '../assets/sfx/land-2.m4a';
import land3AssetUrl from '../assets/sfx/land-3.m4a';
import land4AssetUrl from '../assets/sfx/land-4.m4a';
import doneAssetUrl from '../assets/sfx/done.m4a';
import { enhanceReportForm } from './report-form';

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T | null;

// ── the roster ────────────────────────────────────────────────────────────
// One array, module scope, never persisted -- declared here, ahead of the
// `if (form)` guard below, for two reasons. First, stage 4 imports
// getRoster/setRoster regardless of whether #cg-form exists on whatever
// page pulls this module in -- a top-level `export function` cannot live
// inside a block anyway. Second, neither function touches the DOM itself;
// only the notification callback they invoke does that, and it is
// registered from inside the guard, below, once the element it needs is
// known to exist.
let roster: Student[] = [];

/**
 * What the roster looked like the last time it was saved. Export and
 * import (stage 4; neither exists yet) both call
 * `setRoster(next, { saved: true })` to update this and clear `dirty`.
 * Starts equal to `roster` -- both empty -- which is what keeps `dirty`
 * false on load: with nothing yet to lose, there is nothing to differ
 * from.
 */
let lastSaved: Student[] = [];

/**
 * Design spec section 11: the Import/export header reads "unsaved changes
 * — export to keep them" the moment a teacher has changed anything, and
 * "nothing to save yet" otherwise (`sectionState`, src/lib/sections.ts).
 * Stage 2 declared this field on `ToolState` and could never make it true,
 * because a roster is what gets lost and there was no roster -- this is
 * where it becomes real.
 *
 * A COMPARISON against `lastSaved`, not a flag that only ever turns on --
 * the same reasoning `staleReason`'s own doc comment (staleness.ts) gives
 * for why staleness is a comparison too: adding a student and then
 * removing that same student must read as nothing to save again, not stay
 * stuck warning about a change that no longer exists.
 */
let dirty = false;

/**
 * Set from inside the `if (form)` guard below, the moment #cg-io's own
 * header element is known to exist. `setRoster` calls it unconditionally
 * on every change; a page that never wired it (or a bare import, e.g. a
 * future test that never runs the guarded setup) simply gets no DOM
 * write, which is correct rather than a crash.
 */
let onRosterChanged: ((previous: readonly Student[]) => void) | null = null;

/** Stage 4 reads this to export the roster, and to know what to diff an
 *  import against. `readonly` in the type only -- `setRoster`, immediately
 *  below, is what has to change; see ITS doc comment for why an accessor
 *  pair exists here at all rather than an exported `let`. */
export function getRoster(): readonly Student[] {
  return roster;
}

/**
 * The ONLY way the roster changes. Every future call site -- a later
 * task's "Add student", remove, "Add several", "Clear all", stage 4's
 * import -- routes through this one function rather than assigning
 * `roster` directly. An exported `let` would give a second reference that
 * could drift from the one the renderer reads, and nothing would catch
 * that; one setter instead gives `dirty` and the re-render a single place
 * to hang off, so neither can be forgotten by a new call site.
 *
 * `dirty` becomes true exactly when the roster is non-empty AND differs
 * from the last saved copy -- content, not just presence, per that
 * variable's own doc comment above. `{ saved: true }` is how export and
 * import (stage 4) mark the CURRENT roster as the new baseline and clear
 * the flag; nothing in this stage ever passes it, since neither exists
 * yet.
 */
export function setRoster(next: Student[], opts?: { saved?: boolean }): void {
  // Captured BEFORE the reassignment, and handed to the hook below.
  // `sexWhyReturning` (src/lib/sexOptions.ts) needs the roster as it was to
  // tell "Dewi came back" from "Dewi was always here" -- and this is the
  // only moment in the page's life where both versions exist at once. A
  // listener trying to recover it afterwards would be reconstructing a
  // value that was in scope right here and then thrown away.
  const previous = roster;
  roster = next;
  if (opts?.saved) {
    lastSaved = next;
    dirty = false;
  } else {
    dirty =
      next.length > 0 && JSON.stringify(next) !== JSON.stringify(lastSaved);
  }
  onRosterChanged?.(previous);
}

const form = $<HTMLFormElement>('cg-form');
if (form) {
  // The FIRST statement in the module, before anything that could throw.
  //
  // A <form> with no `action` natively GETs its own url, so a native submit
  // is the one path by which anything typed on this page could reach a URL,
  // a history entry or an access log. Everything below is enhancement; this
  // line is the privacy promise, and it is deliberately not guarded by any
  // condition, wrapped in any try, or placed after any work that might fail.
  // The markup carries no `name` on a data field either — two independent
  // barriers, because one of them is one careless edit from being removed.
  form.addEventListener('submit', (e) => e.preventDefault());

  // A focused `<input type="number">` treats a mouse wheel as increment/
  // decrement, so scrolling the PAGE past a field a teacher happened to click
  // silently rewrites the class size — or, in the roster, a student's number.
  // It looks like nothing happened until the groups come out wrong, which
  // makes it a data bug wearing a styling bug's clothes. CSS cannot prevent
  // it; only a non-passive listener can.
  //
  // Bound on the document in CAPTURE, not per input: the roster builds its
  // rows after this runs, so any per-element wiring would cover the two
  // static fields and miss every row a teacher adds. Blur rather than merely
  // preventDefault so the page still scrolls — the field simply stops being
  // the wheel's target.
  document.addEventListener(
    'wheel',
    (e) => {
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement &&
        el.type === 'number' &&
        e.target === el
      ) {
        el.blur();
      }
    },
    { capture: true, passive: true },
  );

  /**
   * Storage is a convenience, never a dependency. Safari's "Block all
   * cookies", partitioned third-party contexts and some managed device
   * profiles throw SecurityError on the mere act of touching localStorage.
   * Uncaught, that throw would abort this module — and a dead module is
   * precisely the state the guard above exists to survive.
   */
  const remember = {
    read: (key: string): string | null => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    write: (key: string, value: string): void => {
      try {
        localStorage.setItem(key, value);
      } catch {
        // The preference cannot follow them to their next lesson. The toggle
        // still works for this one, which is the part that matters now.
      }
    },
  };

  // ── how to use ────────────────────────────────────────────────────────
  // #cg-howto is page chrome, not one of the tool's sections (see
  // ClassroomGroupsPage.astro's own comment on it), so it is wired here,
  // ahead of everything below that reads the roster or the engine, and
  // ahead of `reduceMotion`'s window.matchMedia call further down -- which
  // is a real throw site (see classroom-groups-privacy.spec.ts's "a
  // mid-module failure still cannot leak the class list"). Wiring this
  // first means the one thing a visitor can always still open or close is
  // this section, even if something later in the module dies. The
  // collapsed/expanded state is a UI preference, never class data, so it
  // goes through the same try/catch-wrapped `remember` the sound toggle
  // below also uses -- see H-07 in the stage-2 traceability table.
  //
  // Collapsed by DEFAULT since design spec section 2's operator ruling 2
  // (2026-08-08). '0' is the only stored value that means "a teacher left
  // this open"; absent (nothing stored yet) or '1' both mean collapsed --
  // which is why the read below is `!== '0'` rather than `=== '1'`: the
  // same key, the same two written values, just a different answer for
  // "nothing stored yet". ClassroomGroupsPage.astro's own inline script
  // reads this exact key the exact same way, synchronously, before this
  // deferred module has even loaded -- see that script's own comment for
  // why a deferred module cannot prevent the first-paint flash on its own.
  // The call below is therefore usually a no-op against DOM state that
  // inline script already set; it stays as the source of truth for
  // anywhere that inline script could not run (its own try/catch covers
  // when that is).
  const HOWTO_KEY = 'cg-howto-collapsed';
  const howToToggle = $<HTMLButtonElement>('cg-howto-toggle');
  const howToBody = $<HTMLElement>('cg-howto-body');
  if (howToToggle && howToBody) {
    const applyHowTo = (isCollapsed: boolean) => {
      // Only the BODY ever gets `hidden`. The toggle itself is never
      // hidden by either state -- a control that hides itself is a trap,
      // and this is the only way back open once it is closed.
      howToBody.hidden = isCollapsed;
      howToToggle.setAttribute('aria-expanded', String(!isCollapsed));
    };
    applyHowTo(remember.read(HOWTO_KEY) !== '0');
    howToToggle.addEventListener('click', () => {
      const next = !howToBody.hidden;
      applyHowTo(next);
      remember.write(HOWTO_KEY, next ? '1' : '0');
    });
  }

  // ── three of the tool's four collapsible sections ───────────────────────
  // Grouping options, Import / export, Sound & animation. Same reason this
  // is wired here, ahead of `reduceMotion`'s throw site below, as
  // #cg-howto's own toggle just above: a mid-module failure further down
  // must not be able to leave any section header un-openable. Unlike
  // #cg-howto, nothing here is read from or written to `remember` -- design
  // doc section 11 names exactly two UI preferences allowed to persist (the
  // how-to collapsed state, and a later print panel), and these are not one
  // of them, so every visit starts collapsed with no localStorage involved.
  // This loop only opens and closes the SECTION -- `cg-sound`'s own checkbox
  // and its remembered on/off state are separate, wired further down under
  // "settings", the same separation `cg-grouping`'s section toggle here and
  // its leftovers-radio listener (`updateGroupingHeader`, further down)
  // already have.
  //
  // `cg-students` is deliberately NOT in this list, as of Stage 3, Task 6:
  // design spec section 4's "Opening Student details with the count above
  // 100 -- the section refuses to open and says why" needs `readCount()`
  // and `getRoster()`, neither available yet this early in the module --
  // wired separately, alongside the rest of the roster's own machinery, in
  // "── student roster" below (see that section's own `#cg-students-toggle`
  // listener).
  for (const id of ['cg-grouping', 'cg-io', 'cg-sound']) {
    const toggle = $<HTMLButtonElement>(`${id}-toggle`);
    const body = $<HTMLElement>(`${id}-body`);
    if (!toggle || !body) continue;
    toggle.addEventListener('click', () => {
      const opening = body.hidden;
      body.hidden = !opening;
      toggle.setAttribute('aria-expanded', String(opening));
    });
  }

  const t: Strings = getStrings(document.documentElement.lang);
  // The SAME source `t` is read from, so the strings on the page and the
  // language of the file it writes can never disagree -- `getStrings` falls
  // back to English for an unknown value and this falls back with it.
  const pageLocale: Locale = isLocale(document.documentElement.lang)
    ? document.documentElement.lang
    : 'en';
  // The engine's errors (and warnings) carry student NUMBERS, never names --
  // identity is the number, and grouping.ts has no roster to resolve one
  // from (see Student.number's doc comment there). `rosterNames` is where a
  // number would resolve to a name; it is empty today because nothing yet
  // populates it -- Student details' table (a later task) is what will,
  // each time a name is typed. Named `rosterNames` rather than `roster`
  // now that this module also holds a real roster ARRAY of that name (see
  // getRoster/setRoster above, declared ahead of this `if (form)` guard):
  // a number-to-name lookup and the Student[] records it would be derived
  // from are different things, and this is exactly the task where the two
  // would otherwise collide.
  // `resolveStudent` reads `rosterNames`, falling back to the same numbered
  // label `renderError` itself defaults to when no resolver is passed at
  // all. `label` below calls this exact function instead of reading a name
  // of its own, so there is only ONE place a number becomes display text --
  // which is what makes it true, not just intended, that the results grid
  // and every rendered error can never drift apart: nothing is left that
  // could resolve the two differently.
  const rosterNames = new Map<number, string>();
  const resolveStudent = (n: number): string =>
    rosterNames.get(n) ?? t.studentNumber({ n });
  const errorBox = $<HTMLParagraphElement>('cg-error')!;
  const results = $<HTMLElement>('cg-results')!;
  const resultsHeadingEl = $<HTMLHeadingElement>('cg-results-h')!;
  // #188, AC13. Says how many were actually grouped when that differs from
  // the number typed, so a teacher never has to notice a missing pupil by
  // counting the cards.
  const groupedNoteEl = $<HTMLParagraphElement>('cg-grouped-note')!;
  const classInput = $<HTMLInputElement>('cg-class')!;
  const summary = $<HTMLParagraphElement>('cg-summary')!;
  // Stage 3, Task 9. The <ul> a successful shuffle's own `warnings` render
  // into -- see the submit handler below, and the element's own comment in
  // ClassroomGroupsPage.astro for why it is a list rather than a paragraph.
  const warningsList = $<HTMLUListElement>('cg-warnings')!;
  // `print-groups` is an ALIAS, like the roster's own `print-list`: the
  // printed groups ARE these cards, restyled. Added here rather than in the
  // markup because this element is where every card is appended.
  const tables = $<HTMLDivElement>('cg-tables')!;
  tables.classList.add('print-groups');
  // 'cg-sound' now names the collapsible SECTION (wired in the loop above,
  // ClassroomGroupsPage.astro's own comment has the reasoning) -- the
  // checkbox itself is 'cg-sound-check'.
  const soundToggle = $<HTMLInputElement>('cg-sound-check')!;
  const soundText = $<HTMLSpanElement>('cg-sound-text')!;
  const speedSelect = $<HTMLSelectElement>('cg-speed')!;
  const goButton = $<HTMLButtonElement>('cg-go')!;

  // Issue 853: Safari's on-screen keyboard shrinks only the visual viewport,
  // so the Make Groups row, docked to the layout viewport's bottom, sat
  // behind the keys while a teacher typed. The row's `bottom` reads
  // `--keyboard-overlap` (ClassroomGroupsPage.astro), kept here at what the
  // keyboard hides; where the keyboard resizes the page instead (Android,
  // issue 807) that is 0 and the row stays where it was.
  const dockedRow = goButton.parentElement!;
  const view = window.visualViewport;
  if (view) {
    const keepAboveKeyboard = () =>
      dockedRow.style.setProperty(
        '--keyboard-overlap',
        `${keyboardOverlap(window.innerHeight, view)}px`,
      );
    view.addEventListener('resize', keepAboveKeyboard);
    view.addEventListener('scroll', keepAboveKeyboard);
    keepAboveKeyboard();
  }

  // A localStorage KEY, not a DOM id -- deliberately left as the literal
  // 'cg-sound' rather than renamed alongside the checkbox above: a teacher
  // who already muted sound before this task has that preference stored
  // under this exact string, and changing it would silently reset them to
  // the default (sound ON) the next time they load the page. The two
  // namespaces only ever coincided by accident; nothing requires them to
  // match.
  const SOUND_KEY = 'cg-sound';
  const reduceMotion = window.matchMedia?.(
    '(prefers-reduced-motion: reduce)',
  ).matches;

  // ── sound asset network prefetch ────────────────────────────────────────
  // Declared here, ahead of "── settings" below, purely because that section
  // is the first thing that needs to CALL prefetchSoundAssets (on load, if
  // sound is already wanted) -- top-to-bottom module evaluation means a
  // `const` used before its own declaration line throws, so this cannot sit
  // in its more natural home alongside the rest of the sound machinery
  // further down ("── sound") without moving that whole section earlier
  // too. Deliberately network-only: nothing here ever touches AudioContext,
  // which is what keeps this able to run at PAGE LOAD without changing WHEN
  // the lazily-created AudioContext itself first appears -- see the "shares
  // exactly one AudioContext"/"creates no AudioContext at all" e2e tests
  // (classroom-groups.spec.ts), both about the CONTEXT specifically, both
  // unaffected by a plain fetch() happening or not. Decoding (which does
  // need one) stays down in "── sound", triggered only from inside an
  // actual effect call -- exactly where AudioContext creation already
  // happened before this task.
  const landAssetUrls: readonly string[] = [
    land1AssetUrl,
    land2AssetUrl,
    land3AssetUrl,
    land4AssetUrl,
  ];
  const allSfxAssetUrls: readonly string[] = [
    shuffleAssetUrl,
    ...landAssetUrls,
    doneAssetUrl,
  ];

  /** Resolved bytes per URL, or `null` once a fetch has failed -- fetched at
   *  most once per URL regardless of how many times ensureBytesLoading is
   *  called, because both triggers below (on load, on toggle-on) can
   *  legitimately fire for the SAME urls in one page visit. */
  const assetBytes = new Map<string, Promise<ArrayBuffer | null>>();

  const ensureBytesLoading = (url: string): Promise<ArrayBuffer | null> => {
    let pending = assetBytes.get(url);
    if (!pending) {
      pending = fetch(url)
        .then((response) => (response.ok ? response.arrayBuffer() : null))
        .catch(() => null); // offline, blocked, or any other fetch failure
      assetBytes.set(url, pending);
    }
    return pending;
  };

  /**
   * "Sound is known to be wanted", per the brief, is two triggers:
   *
   * - on load, only if a real effect could actually fire at the settings
   *   this page loaded with (checked AND not `skip` -- `speed === 'skip'`
   *   never calls sfx.shuffle/land/done at all, see animate() below, so
   *   prefetching for it would spend a phone's data for nothing a
   *   reduced-motion visitor was promised they would not pay);
   * - at the moment the toggle is switched ON, unconditionally -- a
   *   deliberate asymmetry: an active click is the visitor naming their own
   *   intent, worth six small requests (52KB total, CREDITS.md) regardless
   *   of the CURRENT speed selection, where the passive page-load trigger
   *   has to honour the stronger, explicit "downloads nothing" promise a
   *   reduced-motion visitor is owed.
   *
   * Both call sites are further down (the on-load one at the end of
   * "── settings", after reduceMotion has had its chance to force `skip`;
   * the toggle-on one inside soundToggle's own `change` listener).
   */
  const prefetchSoundAssets = (): void => {
    for (const url of allSfxAssetUrls) ensureBytesLoading(url);
  };

  // ── settings ────────────────────────────────────────────────────────────
  // Sound defaults ON (operator decision). A stored preference wins, so a
  // teacher who muted it once is not surprised again on their next lesson.
  const stored = remember.read(SOUND_KEY);
  if (stored !== null) soundToggle.checked = stored === 'on';
  const syncSoundLabel = () => {
    soundText.textContent = soundToggle.checked ? t.soundOn : t.soundOff;
  };
  syncSoundLabel();
  soundToggle.addEventListener('change', () => {
    remember.write(SOUND_KEY, soundToggle.checked ? 'on' : 'off');
    syncSoundLabel();
    // "at the moment the toggle is switched on" -- the second of the two
    // prefetch triggers (see prefetchSoundAssets's own doc comment above).
    if (soundToggle.checked) prefetchSoundAssets();
  });

  // A device asking for reduced motion gets the result without the show, but
  // the teacher can still opt back in — it is a default, not a lock.
  if (reduceMotion) speedSelect.value = 'skip';

  // The first of the two prefetch triggers: sound already wanted AND an
  // effect could actually fire at the settings this page loaded with.
  // Placed after the reduceMotion line immediately above, not before it,
  // because it has to read speedSelect.value AFTER that line has had its
  // chance to force it to 'skip'.
  if (soundToggle.checked && speedSelect.value !== 'skip') {
    prefetchSoundAssets();
  }

  // ── conditional fields ──────────────────────────────────────────────────
  const showFor = (attr: string, value: string) => {
    document.querySelectorAll<HTMLElement>(`[data-${attr}]`).forEach((el) => {
      el.hidden = el.dataset[attr] !== value;
    });
  };
  const readRadio = (name: string) =>
    (
      form.querySelector(
        `input[name="${name}"]:checked`,
      ) as HTMLInputElement | null
    )?.value ?? '';

  // `mode`/`leftovers`/`sexMode`/`count` -- ONE function each, called from
  // every place that needs the live value (submit, the grouping header,
  // and the staleness snapshot further down) so none of the four can ever
  // read a different answer than the others. Two call sites computing the
  // same fact by hand is how a header ends up disagreeing with reality
  // (see the fix recorded on #cg-grouping's own header, Task 3) -- the same
  // failure mode a staleness snapshot built from its OWN separate reads
  // could reintroduce.
  //
  // `readMode` returns the exact shape buildGroups expects, not just the
  // radio's own value: #cg-size or #cg-groups can change while the radio
  // itself stays put, and staleReason's own doc comment (src/lib/staleness.ts)
  // is why the snapshot needs the WHOLE shape, JSON-stringified, in one
  // comparison rather than the number and the kind compared separately.
  const readMode = (): Mode =>
    readRadio('mode') === 'groupCount'
      ? {
          kind: 'groupCount',
          count: Number(($('cg-groups') as HTMLInputElement).value),
        }
      : {
          kind: 'perGroup',
          size: Number(($('cg-size') as HTMLInputElement).value),
        };
  const readLeftovers = (): Leftovers =>
    readRadio('leftovers') === 'bunch' ? 'bunch' : 'spread';
  const sexMix = $<HTMLInputElement>('cg-sex-mix');
  const sexSeparate = $<HTMLInputElement>('cg-sex-separate');
  const sexWhyEl = $<HTMLParagraphElement>('cg-sex-why');

  // LIVE as of Stage 3, Task 9. It returned a hard-coded `'off'` from stage
  // 2 until now, because the two switches were permanently `disabled` --
  // there was no roster on this page, so `sexWhy` (src/lib/sexOptions.ts)
  // always returned its "no list at all" reason. Task 2 built the roster,
  // Task 4 built absence, and `updateSexSwitches` below now opens and
  // closes them from the live list, so `.checked` finally has something to
  // say.
  //
  // The `disabled` guard is not belt-and-braces. Un-checking on disable
  // would throw away a teacher's choice every time one student's sex goes
  // blank mid-edit; keeping it means the switch comes back the way they
  // left it. But a checked-AND-disabled box must not reach `buildGroups` --
  // that is exactly the state design spec section 6 exists to forbid ("both
  // are DISABLED unless every student being grouped has M or F"). So the
  // check state is remembered in the DOM and ignored here, which is the
  // same rule a native form already applies to a disabled control's value
  // at submission.
  //
  // `separate` is tested first only to make this a total function. The two
  // are mutually exclusive by the listener below, so the both-checked state
  // it would disambiguate cannot actually arise -- and a precedence rule
  // that CAN be reached is a rule someone has to remember.
  const readSexMode = (): SexMode => {
    if (sexSeparate?.checked && !sexSeparate.disabled) return 'separate';
    if (sexMix?.checked && !sexMix.disabled) return 'mix';
    return 'off';
  };

  // "Mix evenly" and "keep separate" are contradictory instructions, and
  // `SexMode` has no value meaning both -- but stage 2 built them as two
  // independent checkboxes, so until now nothing stopped a teacher ticking
  // each. Ticking one clears the other, which is what the pair already
  // MEANT; the alternative is a precedence rule in `readSexMode` silently
  // ignoring half of what the page shows as ticked.
  for (const [one, other] of [
    [sexMix, sexSeparate],
    [sexSeparate, sexMix],
  ] as const) {
    one?.addEventListener('change', () => {
      if (one.checked && other) other.checked = false;
    });
  }

  // #cg-count ("Number of students") -- the same ONE-function reasoning as
  // mode/leftovers/sexMode above. Submit and `readRoster` (below) both need
  // the exact live value; reading it inline at each call site is exactly
  // the duplication this file's own comment, just above, warns is how two
  // places end up disagreeing.
  const readCount = (): number =>
    Number(($('cg-count') as HTMLInputElement).value);

  // `roster` (module scope, declared ahead of this `if (form)` guard) is
  // what the class list currently IS. With a roster present,
  // `serialiseForCompare` (src/lib/roster.ts) is authoritative: everything
  // about it that could change who ends up with whom, folded into one
  // string, the NAME deliberately excluded -- see that function's own doc
  // comment for why a rename must not mark the groups out of date. With no
  // roster -- still the only case this stage can actually reach, since
  // nothing yet populates one -- #cg-count remains the sole population
  // control, exactly as stage 2 left it: this branch is that same
  // behaviour, unchanged, which is what keeps "changing the number of
  // students marks them out of date" (classroom-groups.spec.ts) passing.
  // JSON.stringify'd in that branch, the same way `readMode` stringifies
  // its own shape above, so the result is always a primitive `snapshot()`'s
  // comparison can compare by VALUE -- see staleReason's own
  // `assertComparable` (src/lib/staleness.ts), which throws if a future
  // call site ever skips this and hands it something that is not already a
  // string.
  const readRoster = (): string =>
    roster.length > 0
      ? serialiseForCompare(roster)
      : JSON.stringify({ count: readCount() });

  // The Grouping options header names the two choices made inside that
  // section: the sex switches and the leftovers radios. It must never go on
  // reporting "none" once either is chosen. The form's `change` handler
  // (below) refreshes it for both. The switches carry no `name`, so they are
  // matched by identity; until #390 only the radios were, and ticking "Mix
  // boys and girls evenly" left the header saying "none" in every locale.
  // `updateSexSwitches` refreshes it too, because a roster edit that
  // disables the switches changes what `readSexMode` returns without any
  // switch changing. Calls the SAME `sectionState` that produced the
  // header's build-time text (see ClassroomGroupsPage.astro's own
  // `initialToolState`), so the two can never disagree by computing the
  // sentence two different ways; the roster fields it leaves at their
  // defaults belong to the Student details header, not this one.
  const groupingStateEl = document.querySelector<HTMLElement>(
    '#cg-grouping .state',
  );
  const updateGroupingHeader = () => {
    if (!groupingStateEl) return;
    groupingStateEl.textContent = sectionState(
      {
        named: 0,
        absent: 0,
        together: 0,
        apart: 0,
        rosterSize: 0,
        sexMode: readSexMode(),
        leftovers: readLeftovers(),
        dirty: false,
      },
      t,
    ).groupingOptions;
  };

  // `#cg-io`'s own header -- the Import/export section's collapsed-state
  // text. Same shape as `updateGroupingHeader` just above: `sectionState`
  // returns three fields, this one only ever reads `.importExport`, so
  // every field it does not need is a placeholder -- design spec section
  // 11's rule ("unsaved changes — export to keep them" / "nothing to save
  // yet") depends on nothing but `dirty`. Registering this as
  // `onRosterChanged` (module scope, above) is what turns `dirty` from a
  // private variable nobody could observe into the real, rendered header
  // stage 2 declared but could never set. Called once now, matching
  // `syncSoundLabel()`'s own pattern further down in "── settings", so the
  // header stays provably in sync with `dirty`'s starting value -- today
  // always `false`, the same default the Astro build already rendered
  // (`initialToolState.dirty`, ClassroomGroupsPage.astro), so this call is
  // a same-text no-op until a later task gives `setRoster` its first real
  // caller.
  const ioStateEl = document.querySelector<HTMLElement>('#cg-io .state');
  const updateIoHeader = () => {
    if (!ioStateEl) return;
    ioStateEl.textContent = sectionState(
      {
        named: 0,
        absent: 0,
        together: 0,
        apart: 0,
        rosterSize: 0,
        sexMode: 'off',
        leftovers: 'spread',
        dirty,
      },
      t,
    ).importExport;
  };

  // `#cg-students`'s own header. Nothing before this task wired
  // `sectionState`'s `.studentDetails` half live, so the header would
  // otherwise go on reading its build-time "none added" forever, even once
  // a roster exists -- exactly the "collapsing never means forgetting" rule
  // design spec section 3 states for every one of these headers, and a real
  // gap the plan's own per-task traceability lines never assigned to any
  // task. Picked up here, alongside the roster table this task is what
  // first gives something to report. Reuses `rosterCounts` (src/lib/
  // roster.ts, unit-tested there) rather than recomputing the four counts
  // by hand -- the same "one function" reasoning `updateGroupingHeader`/
  // `updateIoHeader` already rest on.
  const studentsStateEl = document.querySelector<HTMLElement>(
    '#cg-students .state',
  );
  const updateStudentsHeader = () => {
    if (!studentsStateEl) return;
    studentsStateEl.textContent = sectionState(
      {
        ...rosterCounts(roster),
        rosterSize: roster.length,
        sexMode: readSexMode(),
        leftovers: readLeftovers(),
        dirty,
      },
      t,
    ).studentDetails;
  };

  // #cg-count ("Number of students") -- design spec section 4, "The
  // Students box — an input, then a read-out". `studentsBoxLocked`
  // (src/lib/roster.ts, unit-tested there) is the ONE fact this depends
  // on: whether a roster exists at all. `countInput`/`countHelpEl`/
  // `countLockedEl` are cached consts, matching `rosterProblemEl`/
  // `rosterWarningEl`/`studentsLimitEl` above -- every one of these is
  // read AND written on every call, unlike `readCount()`'s own single,
  // one-shot `$()` lookup.
  const countInput = $<HTMLInputElement>('cg-count')!;
  const countHelpEl = $<HTMLParagraphElement>('cg-count-help')!;
  const countLockedEl = $<HTMLParagraphElement>('cg-count-locked')!;

  // #188. The three number fields, cached the same way `countInput` above
  // is, and for the same reason: each is read AND written on every pass.
  const absentInput = $<HTMLInputElement>('cg-numbers-absent')!;
  const togetherInput = $<HTMLInputElement>('cg-numbers-together')!;
  const apartInput = $<HTMLInputElement>('cg-numbers-apart')!;
  const numbersLockedEl = $<HTMLParagraphElement>('cg-numbers-locked')!;
  const numbersProblemEl = $<HTMLParagraphElement>('cg-numbers-problem')!;
  // Which help paragraph describes which field is read from the MARKUP's own
  // `aria-describedby`, not from a second list here. A list would be a
  // second place the pairing is written, and the two would drift the first
  // time an id changed.
  const numberFields = [absentInput, togetherInput, apartInput].map((input) => {
    const helpId = input.getAttribute('aria-describedby')!;
    return { input, helpId, help: $<HTMLParagraphElement>(helpId)! };
  });

  /**
   * The three fields, parsed against whatever `#cg-count` holds right now.
   *
   * The FIRST problem wins, absent then together then apart, matching the
   * order they appear on the page -- `updateRosterValidation` renders
   * `problems[0]` for the identical reason: a teacher fixes one thing, then
   * is told the next, rather than being handed a list to triage.
   */
  const readNumberFields = (): {
    fields: NumberFields;
    problem: NumberSetsProblem | null;
  } => {
    const count = readCount();
    const absent = parseNumberSets(absentInput.value, {
      count,
      kind: 'absent',
    });
    const together = parseNumberSets(togetherInput.value, {
      count,
      kind: 'pairing',
    });
    const apart = parseNumberSets(apartInput.value, { count, kind: 'pairing' });
    return {
      fields: {
        absent: absent.sets,
        together: together.sets,
        apart: apart.sets,
      },
      problem: absent.problem ?? together.problem ?? apart.problem,
    };
  };

  /**
   * The fields' problem, but only while a teacher can act on it.
   *
   * A list locks the fields (AC14) and then decides alone who is grouped, so
   * whatever text the locked fields still hold refuses nothing: it neither
   * holds the shuffle nor shows a refusal. Both readers ask HERE rather than
   * checking the lock themselves (#390 F68): the button used to read the
   * locked fields directly, and a number refused before the list existed
   * kept it disabled with its stated reason hidden.
   */
  const standingNumbersProblem = (): NumberSetsProblem | null =>
    studentsBoxLocked(getRoster()) ? null : readNumberFields().problem;

  /**
   * The ONE writer of `goButton.disabled`, reading BOTH things that can
   * stand between a teacher and a shuffle.
   *
   * Two writers would be rivals: whichever ran last would win, so a clean
   * number field could silently clear a roster problem that still stands.
   * `updateRosterValidation` therefore hands the decision here rather than
   * setting the property itself.
   */
  // Filled once the board exists (#743): its button follows this same fact,
  // and `updateGoButton` first runs during set-up, before the board does.
  let onShuffleReadinessChanged: (() => void) | null = null;
  const updateGoButton = () => {
    // Copied, not passed straight through: `getRoster()` hands back a
    // `readonly Student[]` and `rosterProblems` takes a mutable one, which
    // is the same reason `updateRosterValidation` below spreads it too.
    const rosterStops = rosterProblems([...getRoster()], t).length > 0;
    const numbersStop = standingNumbersProblem() !== null;
    goButton.disabled = rosterStops || numbersStop;
    // ...and the ONE writer of the reason too, for the reason it is the one
    // writer of `disabled`: two writers would be rivals, and a button that
    // says nothing about why it will not move is #250's whole subject. The
    // ids name the very paragraphs `updateRosterValidation` and
    // `updateNumbersValidation` fill, so the text a screen reader is handed
    // and the text on the page are the same node (AC10), and the description
    // names only the problems that are actually standing right now.
    const describedBy = [
      rosterStops ? 'cg-roster-problem' : null,
      numbersStop ? 'cg-numbers-problem' : null,
    ].filter((id) => id !== null);
    if (describedBy.length > 0) {
      goButton.setAttribute('aria-describedby', describedBy.join(' '));
    } else {
      goButton.removeAttribute('aria-describedby');
    }
    onShuffleReadinessChanged?.();
  };

  /**
   * Hide/show the region, THEN write into it -- the same ordering
   * `updateRosterValidation` keeps, so a live region is never announced as
   * already-populated.
   */
  const updateNumbersValidation = () => {
    const problem = standingNumbersProblem();
    if (problem === null) {
      numbersProblemEl.hidden = true;
      numbersProblemEl.textContent = '';
    } else {
      numbersProblemEl.hidden = false;
      const message = renderNumbersProblem(problem, readCount(), t);
      if (numbersProblemEl.textContent !== message) {
        numbersProblemEl.textContent = message;
      }
    }
    updateGoButton();
  };

  /**
   * AC14. The list and these fields are never both in charge, exactly as
   * the list and `#cg-count` are never both in charge -- `studentsBoxLocked`
   * is the same single fact behind both, which is why this asks it rather
   * than deciding for itself.
   *
   * A locked field cannot be edited, so a refusal it was showing is about
   * text nobody can change any more: `standingNumbersProblem` drops it,
   * leaving the roster's own problems as the only thing that can hold the
   * button. Unlocking re-validates the same way, so text the class can no
   * longer hold is refused again with its reason on screen.
   */
  const updateNumberFields = () => {
    const locked = studentsBoxLocked(getRoster());
    for (const field of numberFields) {
      field.input.disabled = locked;
      field.input.setAttribute(
        'aria-describedby',
        locked ? 'cg-numbers-locked' : field.helpId,
      );
      field.help.hidden = locked;
    }
    numbersLockedEl.hidden = !locked;
    updateNumbersValidation();
  };

  const updateStudentsBox = () => {
    if (studentsBoxLocked(getRoster())) {
      // "Reports the list" -- overwritten to the roster's own length on
      // every call, never whatever a teacher last typed. Guarded, not
      // unconditional, purely to skip a no-op DOM write on every edit
      // this fires for that leaves `.length` unchanged (a name, a letter,
      // marking someone absent) -- `#cg-count` is `disabled` in this
      // branch, so there is no caret or focus here to protect, unlike the
      // guards elsewhere in this file that exist for exactly that reason.
      const value = String(getRoster().length);
      if (countInput.value !== value) countInput.value = value;
      countInput.disabled = true;
      countInput.setAttribute('aria-describedby', 'cg-count-locked');
      countHelpEl.hidden = true;
      countLockedEl.hidden = false;
    } else {
      // Emptying the list (Clear all, or the last row removed) lands
      // here. `.value` is deliberately left UNTOUCHED -- the last write
      // the branch above made, while the list still existed, is still
      // sitting in it, which is what "keeps the number it was last
      // reporting" (design spec section 4) actually means: there is no
      // separate "remembered count" to restore, because nothing ever
      // overwrote it on the way out.
      countInput.disabled = false;
      countInput.setAttribute('aria-describedby', 'cg-count-help');
      countHelpEl.hidden = false;
      countLockedEl.hidden = true;
    }
  };

  /**
   * Design spec section 6, all three of its branches, live off the roster.
   *
   * `sexWhyReturning` first, `sexWhy` second -- see the former's own doc
   * comment (src/lib/sexOptions.ts) for why the name-specific message is a
   * separate function taking two snapshots rather than a parameter on the
   * first. `??`, not `||`: both return `string | null`, and `||` would
   * treat a legitimately empty message as absent. Neither can return `''`
   * today; the operator that cannot be wrong is still the one to use.
   *
   * BOTH switches take the same state from the same value, in one place --
   * design spec section 6 gives them one condition, and the markup already
   * gives them one shared `#cg-sex-why`. Two call sites deciding this
   * separately is how a control and the sentence explaining it drift apart.
   *
   * Deliberately does NOT un-check a switch it disables: see `readSexMode`
   * above, which ignores a checked-but-disabled box, so the teacher's
   * choice survives a mid-edit blank sex without ever reaching the engine.
   */
  const updateSexSwitches = (previous: readonly Student[]) => {
    const current = getRoster() as Student[];
    const why =
      sexWhyReturning(previous as Student[], current, t) ?? sexWhy(current, t);
    if (sexMix) sexMix.disabled = why !== null;
    if (sexSeparate) sexSeparate.disabled = why !== null;
    if (sexWhyEl) {
      sexWhyEl.hidden = why === null;
      sexWhyEl.textContent = why ?? '';
    }
    // A disabled switch no longer counts (`readSexMode`), so the header
    // that names it must drop it too.
    updateGroupingHeader();
  };

  /**
   * Keep every roster row's print-only text twin in step with its control.
   *
   * Hung off the same `onRosterChanged` hook as `relabelResults` below, and
   * for the same reason: a TEXT edit deliberately never re-renders the row
   * (that would steal focus and the caret -- see roster-ui.ts's own split
   * handlers), so a mirror updated only on re-render would go stale on
   * every keystroke and print a name the teacher had already changed.
   *
   * Reads the LIVE roster by row index, not the control's own value: the
   * roster array is what the sheet is a picture of, and one source means
   * the paper and the engine cannot disagree.
   */
  const refreshPrintMirrors = () => {
    const current = getRoster();
    const rows = document.querySelectorAll<HTMLElement>(
      '#cg-roster .cg-student',
    );
    rows.forEach((row, i) => {
      const student = current[i];
      if (!student) return;
      row.dataset.absent = String(student.absent);
      // Keyed by COLUMN, never by position. The row is built Absent-first
      // and these values are written number-first, so the positional mapping
      // this replaced put every value one cell early -- see `PrintColumn`'s
      // own comment in roster-ui.ts for what that printed (#253). A mirror
      // carries the column it belongs to, so reordering the table can no
      // longer re-point them without anyone noticing.
      const texts: Record<PrintColumn, string> = {
        number: String(student.number),
        name: student.name ?? '',
        sex:
          student.sex === 'M'
            ? t.rosterSexMale
            : student.sex === 'F'
              ? t.rosterSexFemale
              : t.rosterUnset,
        absent: student.absent ? '\u2611' : '\u2610',
        together: student.together ?? t.rosterUnset,
        apart: student.apart ?? t.rosterUnset,
      };
      row.querySelectorAll<HTMLElement>('.cg-print-value').forEach((el) => {
        const column = el.dataset.col as PrintColumn | undefined;
        const text = column === undefined ? undefined : texts[column];
        if (text !== undefined && el.textContent !== text) {
          el.textContent = text;
        }
      });
    });
  };

  /**
   * A rename must reach the groups already on screen.
   *
   * `serialiseForCompare` (src/lib/roster.ts) deliberately excludes the
   * name, so typing one onto a student who was already in the shuffle does
   * NOT mark the groups out of date -- correctly: it changes nothing about
   * who ended up with whom. But without this, the sheet then goes on saying
   * "Student 1" with no notice inviting a reshuffle either, which is the
   * worst of both: the teacher's edit appears to have done nothing at all.
   *
   * Re-labels in place from `resolveStudent`, the SAME lookup `render`'s
   * own `label` uses, rather than re-rendering the cards: a re-render would
   * rebuild every `<li>` and lose the `.dealt` class the deal animation
   * sets, so a rename mid-deal would blank the board. The number lives on
   * the element itself (`data-number`, written by `render`) because the
   * `Student` objects the shuffle was built from are not kept anywhere
   * after it finishes -- and re-deriving position from the roster would be
   * wrong anyway, since the roster's order is not the groups' order.
   */
  const relabelResults = () => {
    for (const el of tables.querySelectorAll<HTMLElement>('.student')) {
      const number = Number(el.dataset.number);
      const who = el.querySelector<HTMLElement>('.who');
      if (!who || !Number.isFinite(number)) continue;
      const next = resolveStudent(number);
      if (who.textContent !== next) who.textContent = next;
    }
  };

  // ONE hook, every header (and now the Students box, the sex switches and
  // the rendered groups too) -- the same reasoning `setRoster`'s own doc
  // comment (above) gives for having a single `onRosterChanged` at all:
  // anything else that needs to know "the roster changed" must not have to
  // be remembered by every future call site.
  onRosterChanged = (previous) => {
    // FIRST, before anything below reads it. `rosterNames` is the
    // number-to-name lookup `resolveStudent` answers from, and
    // `relabelResults` two lines down is one of its readers -- rebuilt
    // fresh from the roster rather than patched, so it can never drift
    // from what the roster array actually says.
    //
    // It used to be rebuilt in `onRosterEdited`, AFTER its `setRoster`
    // call. That was already fragile and became a real bug the moment this
    // hook gained a reader: `setRoster` fires this hook before returning,
    // so every hook body ran against the PREVIOUS names and a rename
    // reached the roster, the headers and staleness while the groups on
    // screen went on saying "Student 1". Moved here, where the one hook
    // every roster mutation already routes through can keep it true --
    // exactly the reasoning `setRoster`'s own doc comment gives for the
    // hook existing at all.
    rosterNames.clear();
    for (const s of getRoster()) if (s.name) rosterNames.set(s.number, s.name);
    updateIoHeader();
    updateStudentsHeader();
    updateStudentsBox();
    updateNumberFields();
    updateSexSwitches(previous);
    relabelResults();
    refreshPrintMirrors();
    refreshPrintAvailability();
  };
  updateIoHeader();
  updateStudentsHeader();
  updateStudentsBox();
  updateNumberFields();
  // The initial call passes the CURRENT roster as its own "previous": on
  // first paint nothing has changed yet, and `sexWhyReturning` comparing a
  // roster against itself finds nobody who came back, which is the truth.
  // It falls through to `sexWhy`, reproducing exactly the build-time state
  // ClassroomGroupsPage.astro already rendered.
  updateSexSwitches(getRoster());

  // ── staleness ────────────────────────────────────────────────────────────
  // Design spec section 8. `lastSnapshot` is what the groups ON SCREEN were
  // actually made from -- set once, at the end of a successful shuffle
  // (below), and never touched anywhere else. Every input/change event on
  // the form compares it against a FRESH read of the form (`snapshot()`),
  // so undoing a change needs no code of its own: the comparison simply
  // comes back equal again. `null` until the first shuffle, so nothing is
  // ever reported stale before there is anything on screen to be stale
  // about. See staleReason's own doc comment (src/lib/staleness.ts) for why
  // a comparison, not a flag, is the whole point.
  let lastSnapshot: Snapshot | null = null;
  const staleNotice = $<HTMLElement>('cg-stale')!;
  const staleText = $<HTMLParagraphElement>('cg-stale-text')!;
  /**
   * Where all three stale refusals speak.
   *
   * Declared HERE, beside `#cg-stale`'s own text, rather than down with the
   * three predicates that write it: `updateStaleness` clears it, and
   * `updateStaleness` runs during setup -- a `const` declared later is in
   * its temporal dead zone at that moment and throws, which nothing in this
   * repo would have caught before a visitor did (`astro check` cannot see
   * the order a function is called in, and `astro build` strips types
   * without checking them).
   *
   * ONE element for all three exits, because a teacher does one thing at a
   * time and three boxes would be three places to look.
   */
  const refusalEl = $<HTMLParagraphElement>('cg-refusal')!;

  const snapshot = (): Snapshot => ({
    mode: JSON.stringify(readMode()),
    leftovers: readLeftovers(),
    sexMode: readSexMode(),
    roster: readRoster(),
  });

  const updateStaleness = () => {
    // No notice before there are groups to be stale (`lastSnapshot` is
    // still null), and none while the results section itself is hidden --
    // an error refusal already hides #cg-results (see the submit handler's
    // failure branch below), which takes this notice out of view with it;
    // there is nothing useful to compare against a shuffle that did not
    // happen.
    const reason =
      lastSnapshot && !results.hidden
        ? staleReason(lastSnapshot, snapshot(), t)
        : null;
    results.classList.toggle('stale', reason !== null);
    if (reason === null) {
      staleNotice.hidden = true;
      // Not just hidden -- CLEARED. `hidden` takes it out of the a11y tree,
      // but the text node itself would otherwise still sit in the DOM, and
      // a query that finds text regardless of visibility (Playwright's own
      // `getByText`, same as a browser extension or any other DOM-reading
      // tool) would still report "These groups are out of date" as present
      // on the page. Caught this exact way: "shuffling clears it" failed
      // with `getByText('out of date')` still resolving to 1 element,
      // hidden but not gone, before this line existed.
      staleText.textContent = '';
      // …and with it the refusal that staleness produced. `refuse()` is the
      // only writer of `#cg-refusal` and used to be its only clearer, so a
      // teacher who pressed Print while stale and then UNDID the edit was
      // left with a role="alert" still saying the groups were out of date
      // while everything else on the page said they were fine. Cleared
      // HERE, beside the notice it accompanies, so the two cannot disagree.
      refusalEl.hidden = true;
      refusalEl.textContent = '';
      return;
    }
    // Joins the tree before the sentence is written -- same reason
    // #cg-error/#cg-summary do, see the submit handler's own comment on
    // announcement ordering. Guarded so an unchanged reason (most
    // keystrokes, once already stale) does not re-write the same text into
    // a live region and risk a spurious re-announcement.
    staleNotice.hidden = false;
    if (staleText.textContent !== reason) staleText.textContent = reason;
  };

  form.addEventListener('change', (e) => {
    // Changing anything means the teacher has stopped watching the deal.
    finishDealNow();
    const target = e.target as HTMLInputElement;
    if (target.name === 'mode') showFor('mode', target.value);
    if (
      target.name === 'leftovers' ||
      target === sexMix ||
      target === sexSeparate
    )
      updateGroupingHeader();
    updateStaleness();
  });
  // The brief's own instruction: recompute on every `change` AND `input`
  // event, so a teacher typing a new group size sees the notice the moment
  // they type it, not only once the field loses focus.
  form.addEventListener('input', () => {
    finishDealNow();
    updateStaleness();
    // #188, AC12. This listener is delegated across the WHOLE form, so it
    // fires for `#cg-count` as well as for the three number fields:
    // lowering the count below a number already typed re-validates the
    // moment it happens, rather than waiting to fail at "Make groups".
    updateNumbersValidation();
  });

  // ── student roster (Student details' table) ─────────────────────────────
  // Design spec sections 3/4. `renderRoster` (roster-ui.ts) is a pure
  // function of the CURRENT roster -- called again only when the roster's
  // STRUCTURE changes (a row added), never on a single field's own edit. A
  // field edit writes straight into the roster array via `setRoster` (and,
  // for a name, into `rosterNames` too) with NO re-render:
  // `RosterHandlers.onTextChange`'s own doc comment (roster-ui.ts) is why --
  // rebuilding the table mid-keystroke would tear down the very input a
  // teacher is typing into, stealing focus and the caret position.
  // `onSelectChange` (sex, absent, either letter) DOES re-render, safely,
  // since a native `change` event never fires mid-keystroke -- and it is
  // what makes a newly-used together/apart letter's successor appear in
  // every OTHER row's own dropdown the moment it is used, not only the row
  // it was set on (`availableLetters`, src/lib/roster.ts, is recomputed
  // from the whole roster on every render).
  const studentsBody = $<HTMLElement>('cg-students-body');

  // Stage 3, Task 5. Static siblings of #cg-students-body, never rebuilt by
  // renderRoster -- see ClassroomGroupsPage.astro's own comment on this
  // markup for why. `!` because both are unconditionally in the page's own
  // markup, the same certainty errorBox/results/staleNotice/staleText
  // above already rely on.
  const rosterProblemEl = $<HTMLParagraphElement>('cg-roster-problem')!;
  const rosterWarningEl = $<HTMLParagraphElement>('cg-roster-warning')!;

  // Stage 3, Task 6. A THIRD static sibling, the same shape as the two
  // above (never rebuilt by renderRoster, always in the page's own markup)
  // -- design spec section 4's "Opening Student details with the count
  // above 100" refusal. `#cg-students-toggle` itself is pulled out of the
  // generic 3-section loop above specifically so this can be wired here,
  // where `readCount`/`getRoster` are already in scope.
  const studentsToggle = $<HTMLButtonElement>('cg-students-toggle');
  const studentsLimitEl = $<HTMLParagraphElement>('cg-students-limit')!;
  if (studentsToggle && studentsBody) {
    studentsToggle.addEventListener('click', () => {
      const opening = studentsBody.hidden;
      // Only ever a refusal on the way IN -- closing an already-open
      // section has nothing to refuse. Re-evaluated on every click, never
      // cached: the same "comparison, not a one-way latch" shape every
      // other guard on this page keeps (updateStaleness, dirty,
      // updateRosterValidation) -- a teacher who lowers the count and
      // clicks again must see the section actually open, not stay
      // refused over a fact that is no longer true.
      const problem = opening
        ? rosterOpenProblem(getRoster().length, readCount(), t)
        : null;
      if (problem) {
        // Revealed, THEN written: a live region is never announced as
        // already-populated (updateNumbersValidation's ordering). Written the
        // other way round, a screen reader said nothing at all (#390 F108).
        studentsLimitEl.hidden = false;
        if (studentsLimitEl.textContent !== problem) {
          studentsLimitEl.textContent = problem;
        }
        // The section's own open/closed state is untouched: "refuses to
        // open" means exactly that -- `studentsBody.hidden` and
        // `aria-expanded` both stay exactly as they were, so a teacher who
        // has never opened this section still cannot, and one who
        // impossibly already had it open (count raised past the limit
        // without ever closing it first) is not forced shut either. Only
        // this notice appears, explaining why acting on the toggle did
        // nothing.
        return;
      }
      studentsLimitEl.hidden = true;
      studentsLimitEl.textContent = '';
      studentsBody.hidden = !opening;
      studentsToggle.setAttribute('aria-expanded', String(opening));
    });
  }

  /**
   * Design spec section 4: a duplicate number or a together/apart clash is
   * "refused in the table, as it is typed" -- BLOCKING, so `goButton`
   * itself is what "as it is typed" ultimately has to mean; a gap is
   * "non-blocking", so it only ever writes a notice, never touches
   * `disabled`. Both live regions follow the exact hide/show/write order
   * `updateStaleness` above already established for #cg-stale-text: a live
   * region that appears already-populated is announced by nobody (this
   * page's own announcements spec), so the element is unhidden BEFORE the
   * new sentence is written into it, never after. Guarded the same way
   * too -- `if (...textContent !== message)` -- so an unchanged reason
   * across a run of keystrokes does not re-write the same text into a live
   * region and risk a spurious re-announcement.
   *
   * A COMPARISON against the CURRENT roster, not a flag that only ever
   * turns on -- the same reasoning `dirty` (above) and `staleReason`
   * (staleness.ts) both rest on: fixing a duplicate must read as fixed
   * again, not stay stuck disabled over a problem that no longer exists.
   *
   * `problems[0]`/`warnings[0]` only, deliberately, mirroring
   * `staleReason`'s own "picks exactly one... so two things changing at
   * once still reads as ONE clear sentence, not a list" (staleness.ts) --
   * the identical shape of decision, made here for the identical reason.
   */
  const updateRosterValidation = () => {
    const currentRoster = [...getRoster()];
    const problems = rosterProblems(currentRoster, t);
    const warnings = rosterWarnings(currentRoster, t);

    if (problems.length === 0) {
      rosterProblemEl.hidden = true;
      rosterProblemEl.textContent = '';
    } else {
      rosterProblemEl.hidden = false;
      const message = problems[0].message;
      if (rosterProblemEl.textContent !== message) {
        rosterProblemEl.textContent = message;
      }
    }

    if (warnings.length === 0) {
      rosterWarningEl.hidden = true;
      rosterWarningEl.textContent = '';
    } else {
      rosterWarningEl.hidden = false;
      const message = warnings[0];
      if (rosterWarningEl.textContent !== message) {
        rosterWarningEl.textContent = message;
      }
    }

    // Handed to the ONE writer rather than set here -- see `updateGoButton`'s
    // own doc comment for why two writers of this property would be rivals.
    updateGoButton();
  };

  /** The one place a per-field roster edit becomes real. `setRoster`'s own
   *  `onRosterChanged` hook (above) keeps `dirty`, `#cg-io`, `#cg-students`,
   *  `rosterNames`, the two sex switches and the rendered groups' own
   *  labels in sync -- Stage 3, Task 9 moved the `rosterNames` rebuild out
   *  of this function and into that hook, because a hook body that reads
   *  `rosterNames` runs BEFORE this function's next line (see the hook's own
   *  comment for the bug that caused).
   *  `updateStaleness` is called explicitly rather than relied on purely
   *  through event bubbling (every field this section wires lives inside
   *  #cg-form, whose own `input`/`change` listeners just above already call
   *  it too, for free, on every one of these same events) -- a harmless
   *  second call, and one that keeps this function correct standing on its
   *  own rather than depending on where in the DOM its caller happens to
   *  sit. */
  const onRosterEdited = (next: Student[]) => {
    setRoster(next);
    updateStaleness();
    updateRosterValidation();
  };

  const renderStudentsBody = () => {
    if (studentsBody) {
      renderRoster(studentsBody, getRoster(), t, rosterHandlers);
    }
  };

  const rosterHandlers: RosterHandlers = {
    onTextChange: onRosterEdited,
    onSelectChange: (next) => {
      onRosterEdited(next);
      renderStudentsBody();
    },
    onAdd: () => {
      // Design spec section 4, "Adding a row at 100": `+ Add student` is
      // `disabled` the instant the roster reaches MAX_ROSTER
      // (rosterAtLimit, roster-ui.ts's own buildToolbar) -- a disabled
      // button never fires a click, so this should be unreachable.
      // Defensive re-check anyway, the same "cheap insurance" reasoning
      // this call site already gave `nextNumber`'s own invariant, just
      // below: relying on the disabled attribute silently is exactly the
      // kind of thing a later change could break without this call site
      // ever being touched again to notice.
      if (rosterAtLimit(getRoster())) return;
      const next = [...getRoster()];
      next.push(anonymousStudent(nextNumber(next)));
      setRoster(next);
      updateStaleness();
      // `nextNumber` always assigns exactly one past the current highest,
      // so adding a row can neither collide with an existing number nor
      // change which numbers were already missing below the old highest
      // (rosterWarnings' own doc comment, src/lib/roster.ts) -- this call
      // is therefore a no-op TODAY. Kept anyway, deliberately: relying on
      // that invariant silently is exactly the kind of thing a later
      // change (removing a student, say -- Stage 3, Task 6, this same
      // task) could break without this call site ever being touched again
      // to notice. Cheap at MAX_ROSTER's own 100-row ceiling, so there is
      // no real cost to paying for the guarantee outright rather than
      // trusting the proof.
      updateRosterValidation();
      renderStudentsBody();
    },
    onAddSeveral: (count) => {
      // Stage 3, Task 6. roster-ui.ts's own `confirm()` (buildToolbar)
      // already refuses -- via this exact same pure function, on the exact
      // same roster -- any count that would not fit, and never calls this
      // handler in that case; see that function's own comment. Defensive
      // re-check anyway, the identical reasoning `onAdd`'s own guard just
      // above rests on: cheap, and it is what keeps a future change to
      // roster-ui.ts's own gate from silently becoming this handler's
      // problem too. Replaces the OLD `Math.min(count, room)` clamp
      // against MAX_STUDENTS (a crash-prevention ceiling only, per that
      // constant's own doc comment in grouping.ts) -- MAX_ROSTER's own
      // 100-row ceiling is now what bounds this path, and a batch that
      // does not fit is refused WHOLE, never silently truncated down to
      // whatever room remained (design spec section 4: "refuses a number
      // that would cross it", never "adds as many as will fit" -- the
      // silent clamp this stage owed fixing since Task 2, see MAX_ROSTER's
      // own doc comment, src/lib/roster.ts).
      const current = getRoster();
      if (rosterRoomProblem(current, count, t) !== null) return;
      const next = [...current];
      for (let i = 0; i < count; i++) {
        next.push(anonymousStudent(nextNumber(next)));
      }
      setRoster(next);
      updateStaleness();
      updateRosterValidation(); // see onAdd's own comment, just above
      renderStudentsBody();
    },
    // Design spec section 4: "Removing a row removes the student." `next`
    // arrives ALREADY filtered (roster-ui.ts's own buildRow computed it
    // from the LIVE roster, not a stale render-time snapshot -- see
    // RosterHandlers.onRemove's own doc comment there), so this is exactly
    // `onSelectChange`'s own shape: fold it through the same
    // `onRosterEdited` every other roster edit already uses (keeping
    // `rosterNames`, `dirty`, staleness and validation all in sync in ONE
    // place), then re-render -- a removed row is a discrete action, never
    // mid-keystroke, so re-rendering costs nothing in focus or caret
    // position (the identical reasoning `onSelectChange` already rests
    // on).
    //
    // Identity: `next` never renumbers anyone. Every remaining student's
    // OWN `.number` (and every other field) is untouched -- this is a
    // plain array filter, not a map that reassigns numbers by position --
    // so a together/apart letter, or a future pin, keeps meaning exactly
    // the same student it meant before the removal. Removing #2 from
    // [#1, #2, #3] leaves [#1, #3], a gap, never a renumbered [#1, #2] --
    // the same "gaps allowed, a number belongs to a student, not a
    // position" rule this stage's `nextNumber`/`rosterWarnings` (src/lib/
    // roster.ts) already keep for every OTHER way the roster changes.
    onRemove: (next) => {
      onRosterEdited(next);
      renderStudentsBody();
    },
    // Design spec section 4, "Emptying the list": one action, the whole
    // roster gone. Same shape as `onRemove` just above -- fold the change
    // through the SAME `onRosterEdited` every other roster edit already
    // uses (so `rosterNames`, `dirty`, staleness, validation AND
    // `updateStudentsBox` all react in one place), then re-render -- just
    // with `next` fixed at `[]` rather than a filtered array, since
    // clearing the roster always produces the same empty result whatever
    // it held a moment ago.
    onClearAll: () => {
      onRosterEdited([]);
      renderStudentsBody();
    },
  };

  renderStudentsBody();
  updateRosterValidation();

  // ── import / export (stage 4) ──────────────────────────────────────────
  //
  // `lastGroups` is what the sheet on screen is showing, or `null` before
  // the first shuffle and after a refusal -- the ONE fact "Export groups"
  // depends on, kept here beside `lastSnapshot` rather than re-derived from
  // the DOM. Reading the rendered cards back would be re-parsing our own
  // output, and would silently export a stale arrangement while the notice
  // above the sheet says the groups are out of date.
  let lastGroups: Student[][] | null = null;

  // Stage 5, Task 1. The print panel shares `remember` with the how-to
  // toggle above rather than reaching for `localStorage` itself, so every
  // preference on this page goes through the one wrapper that survives a
  // privacy profile throwing on the mere act of touching storage.
  // The sheet's own header: the class name a teacher typed and the date,
  // both hidden on screen. Rewritten at every print rather than once at
  // load, so a class name typed after the page opened still reaches the
  // paper -- the same "read fresh at every submit" rule the results heading
  // already follows. `todayISO` is stage 4's own formatter (src/lib/csv.ts),
  // so the sheet and the exported CSV cannot describe one shuffle with two
  // date formats.
  const printHead = $<HTMLElement>('cg-print-head');
  const writePrintHead = () => {
    if (!printHead) return;
    printHead.textContent = '';
    const name = classInput.value.trim();
    if (name !== '') {
      const who = document.createElement('strong');
      // `.textContent`, never `.innerHTML`: a teacher's class name is
      // theirs, not markup -- the same rule the results heading follows.
      who.textContent = name;
      printHead.appendChild(who);
    }
    const when = document.createElement('span');
    when.textContent = t.printedOn({ on: todayISO() });
    printHead.appendChild(when);
  };

  // Ctrl/Cmd+P is a browser action, not one this page can route through its
  // own Print panel — and `writePrintHead` used to run ONLY from that panel's
  // apply. A teacher who printed the way people actually print got a sheet
  // with no class name and no date on it, while the same sheet printed via
  // the in-page button carried both. `beforeprint` is the only hook that
  // covers every route to paper, including the print dialog opened from the
  // browser menu.
  window.addEventListener('beforeprint', writePrintHead);

  const printPanel = renderPrintPanel(document, remember, {
    onApply: writePrintHead,
    refuseReason: () => refusePrint(),
  });
  // Declared as a wrapper so the panel can be built before `refuse` exists
  // -- the panel needs a predicate, not an answer, and the predicate is
  // only ever called on a click.
  let refusePrint: () => string | null = () => null;

  /**
   * There is something to print when there is a roster OR groups on screen
   * -- not only once groups exist. Design spec section 10's "What to print:
   * Class list" is exactly the teacher who wants the register and no
   * shuffle, and gating the button on the results would have made that
   * combination unreachable. Found by running Task 2's own tests, which
   * build a roster and never press Make Groups.
   */
  const refreshPrintAvailability = () =>
    printPanel?.setAvailable(getRoster().length > 0 || lastGroups !== null);

  // Stage 5, Task 5. The board needs GROUPS, not merely a roster -- unlike
  // the print panel, which can print a register on its own.
  /**
   * The one place a stale refusal is spoken, for all three exits.
   *
   * `staleReason` (src/lib/staleness.ts) already decides whether the groups
   * on screen still match the form; this only turns that into the sentence
   * for the thing the teacher was about to do. Three sentences, not one:
   * being told "shuffle again before saving them" after pressing Print is
   * someone else's message.
   */
  const groupsAreStale = () =>
    lastSnapshot !== null && staleReason(lastSnapshot, snapshot(), t) !== null;
  const refuse = (message: string): string | null => {
    if (!groupsAreStale()) {
      refusalEl.hidden = true;
      refusalEl.textContent = '';
      return null;
    }
    // Unhidden before the text lands -- the same live-region ordering every
    // other alert on this page follows.
    refusalEl.hidden = false;
    refusalEl.textContent = message;
    return message;
  };

  refusePrint = () => refuse(t.staleRefusePrint);

  const projector = renderProjector(document, t, {
    // The SAME submit path the button in the form uses, requested rather
    // than reimplemented: one code path means a shuffle from the board can
    // never behave differently from one triggered on the page.
    onShuffle: () => form.requestSubmit(goButton),
    // The SAME fact the page's own deal button uses, read rather than
    // duplicated: `updateGoButton` disables it only when the roster cannot
    // be dealt, never for a deal in progress. A second press mid-deal is
    // superseded by `dealToken`, whichever button made it.
    cannotDeal: () => goButton.disabled,
    refuseReason: () => refuse(t.staleRefuseBoard),
    // Design spec section 8: the reveal is animation, and the two ways a
    // teacher can already turn animation off both apply here. `#cg-speed`
    // is the one to read, because `reduceMotion` above has already forced
    // it to `skip` -- one fact, read once, rather than two checks that
    // could disagree.
    animates: () => speedSelect.value !== 'skip',
    // #743: opened before the first deal, the board waits with empty cards;
    // closed without one, the page is left as it was (AC4).
    onEnter: () => {
      if (lastGroups === null) showWaiting();
    },
    onLeave: () => {
      finishDealNow(); // #744: a deal still travelling lands at once
      if (lastGroups !== null) return;
      hideWaiting();
      tables.textContent = '';
      results.hidden = true;
    },
  });
  // #743 AC1: the board opens whenever the page's own Shuffle can run, to
  // deal with the class watching, as well as once groups exist. It reads
  // `goButton.disabled` itself, the fact `updateGoButton` alone writes.
  const refreshBoardAvailability = () =>
    projector?.setAvailable(lastGroups !== null || !goButton.disabled);
  onShuffleReadinessChanged = refreshBoardAvailability;
  refreshBoardAvailability();

  const ioBody = $<HTMLElement>('cg-io-body');
  const io = ioBody
    ? renderIo(ioBody, t, pageLocale, {
        getRoster,
        getGroups: () => lastGroups,
        // Design spec section 8's third exit. `io-ui` asks before it
        // downloads; the answer, and the sentence, are decided here.
        refuseExport: () => refuse(t.staleRefuseExport),
        getClassName: () => classInput.value,
        // An import REPLACES the roster wholesale and is a SAVE point:
        // `{ saved: true }` is what makes `dirty` false, because what is on
        // screen now is exactly what is in a file the teacher already has.
        // Design spec section 11's own rule, and the other half of the pair
        // export completes.
        // Exporting is the OTHER save point. `io-ui` has no setter and no
        // business having one, so it reports the moment a file left the
        // page and this marks the roster saved -- the same
        // `{ saved: true }` an import uses, for the same reason: what is on
        // screen is now exactly what is in a file the teacher holds.
        onExported: () => setRoster([...getRoster()], { saved: true }),
        onImport: (imported, className) => {
          // The class name follows the roster WHOLESALE, blank included.
          // `if (className !== '')` left the old name in place: import 8C's
          // list (a hand-made file, or one exported before a name was
          // typed -- `classLine` omits the line for a blank name) over a
          // page showing 7B, and the roster is replaced while the heading,
          // the printed sheet's header and the NEXT export filename all
          // still say 7B. A teacher is handed a mislabelled paper register.
          // The name belonged to the class that has just been replaced.
          classInput.value = className;
          setRoster(imported, { saved: true });
          renderStudentsBody();
          updateStaleness();
          updateRosterValidation();
        },
      })
    : null;

  // ── sound (six real CC0 samples; synthesis is the fallback) ─────────────
  // src/assets/sfx/ ships six mastered CC0 recordings -- shuffle.m4a,
  // land-1..4.m4a, done.m4a; provenance and licence in that directory's own
  // CREDITS.md -- imported above through Vite so a missing file fails the
  // BUILD, not a 404 nobody notices at runtime. That is now the PRIMARY
  // path for all three effects. Synthesis (src/lib/sfx.ts, unchanged by
  // this task) is the FALLBACK: it plays instead, per sound, whenever the
  // matching sample is not decoded YET (so the very first shuffle, fired
  // before prefetching has had time to finish, is never silent), a fetch
  // failed, or decodeAudioData rejected (a browser with no AAC support) --
  // see sampleFor below. Both paths share the same lazily-created
  // AudioContext/destination -- see ensureAudio below -- so which one
  // played on a given call is invisible to anything outside this block.
  //
  // Everything that SHAPES the SYNTH fallback -- the inharmonic partials,
  // the envelopes, the scale and chord, the grain cloud, the reverb IR's
  // own generation, every gain -- is pure data/functions in src/lib/sfx.ts,
  // unit-tested there (tests/unit/sfx.test.ts) with no AudioContext in
  // sight; the REAL samples' own role→file manifest, round-robin and gain
  // are pure data/functions in src/lib/sfxAssets.ts, unit-tested there
  // (tests/unit/sfxAssets.test.ts) the same way. Everything below this
  // comment is wiring only, exactly the split CLAUDE.md asks for. The synth
  // signal chain, per voice, then the shared master bus (the real samples
  // do NOT run through this -- they are already mastered; see
  // sampleFor/playSample below):
  //
  //   voice ─┬─ partials: 3 oscillators, independent gain+pitch envelope
  //          ├─ transient: a short noise burst through a resonant bandpass
  //          └─ sub: a sine with its own falling pitch
  //                 │
  //                 ├─ voice gain (ADSR) → saturator (WaveShaper) → panner
  //                 │        ├─ dry ─────────────────────────────→ master
  //                 │        └─ send → convolver (synthesised IR) → master
  //   master → highpass → lowpass → compressor → destination
  let audio: AudioContext | null = null;
  let master: GainNode | null = null;
  let reverbConvolver: ConvolverNode | null = null;
  let saturatorCurve: Float32Array<ArrayBuffer> | null = null;
  let variationRng: (() => number) | null = null;

  /** Seeded once, lazily, from `Math.random()` -- fine here, this is Web
   *  Audio wiring, not the pure module sfx.ts (which the brief explicitly
   *  forbids `Math.random()` in, so its own output stays reproducible from
   *  a seed for tests). Threaded through every land()/shuffle()/done()
   *  call, exactly the way `buildGroups` above is handed `random:
   *  Math.random` rather than reading it internally. */
  const ensureVariationRng = (): (() => number) => {
    if (!variationRng)
      variationRng = createPrng(Math.floor(Math.random() * 0xffffffff));
    return variationRng;
  };

  /**
   * Creates the AudioContext, the master bus and the shared reverb
   * convolver lazily, on first use -- exactly once, same as before this
   * task (see the "reuses it" e2e test in classroom-groups.spec.ts). Every
   * voice's DRY signal connects to `master`; every voice's WET send
   * connects to `reverbConvolver`, which itself feeds back into `master`
   * -- a shared send/return bus, not one convolver per voice, per the
   * signal chain above.
   */
  const ensureAudio = (): {
    ctx: AudioContext;
    master: GainNode;
    reverbConvolver: ConvolverNode;
  } => {
    if (!audio || !master || !reverbConvolver) {
      audio = new (window.AudioContext ?? (window as any).webkitAudioContext)();
      const ctx = audio;

      const highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = MASTER_HIGHPASS_HZ;
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = MASTER_LOWPASS_HZ;
      lowpass.Q.value = 0.707; // flat/Butterworth -- "gentle", no resonant peak
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = MASTER_COMPRESSOR.thresholdDb;
      compressor.knee.value = MASTER_COMPRESSOR.kneeDb;
      compressor.ratio.value = MASTER_COMPRESSOR.ratio;
      compressor.attack.value = MASTER_COMPRESSOR.attackS;
      compressor.release.value = MASTER_COMPRESSOR.releaseS;
      highpass.connect(lowpass).connect(compressor).connect(ctx.destination);

      master = ctx.createGain();
      master.gain.value = MASTER_GAIN;
      master.connect(highpass);

      // The reverb IR is GENERATED, never fetched or bundled -- this send
      // only ever colours the SYNTH fallback (see this block's own header
      // comment on when that plays instead of a real sample), so there was
      // never a recording for it to use in the first place. Its level is
      // fixed mathematically at generation time (see REVERB_NORMALIZE_PEAK's
      // own doc comment in sfx.ts), so `normalize` is turned OFF here: Web
      // Audio's own auto-normalise would re-scale it a second, uncontrolled
      // time on top of that.
      const ir = generateReverbImpulseResponse(
        ctx.sampleRate,
        ensureVariationRng(),
      );
      const irBuffer = ctx.createBuffer(2, ir.left.length, ctx.sampleRate);
      irBuffer.getChannelData(0).set(ir.left);
      irBuffer.getChannelData(1).set(ir.right);
      reverbConvolver = ctx.createConvolver();
      reverbConvolver.normalize = false;
      reverbConvolver.buffer = irBuffer;
      const reverbReturn = ctx.createGain();
      reverbReturn.gain.value = REVERB_RETURN_GAIN;
      reverbConvolver.connect(reverbReturn);
      reverbReturn.connect(master);

      saturatorCurve = new Float32Array(generateSaturatorCurve());
    }
    return { ctx: audio, master, reverbConvolver };
  };

  /** A fresh buffer of white noise -- generated in memory from
   *  Math.random(), never fetched or bundled. Reused by every noise-based
   *  layer of the SYNTH FALLBACK specifically: land's transient, shuffle's
   *  grains, done's riser -- the real samples (see sampleFor/playSample
   *  below) need none of this. */
  const noiseBuffer = (ctx: AudioContext, durationS: number): AudioBuffer => {
    const length = Math.max(1, Math.round(ctx.sampleRate * durationS));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  };

  /**
   * attack -> decay -> release, ramped on the GainParam of whichever node
   * the caller built -- scheduled entirely against `startTime` (always an
   * `audio.currentTime`-derived value; see sfx.shuffle/land/done below),
   * never `setTimeout`. `0.0001` is the floor every ramp starts and ends
   * on: `exponentialRampToValueAtTime` requires a strictly positive
   * target, so the true "silence" a browser could give us is not
   * representable. Returns the envelope's own total duration so the
   * caller knows when to `.stop()` its node.
   */
  const FLOOR_GAIN = 0.0001;
  const applyEnvelope = (
    gainParam: AudioParam,
    peakGain: number,
    envelope: Envelope,
    startTime: number,
  ): number => {
    const totalS = envelopeTotalS(envelope);
    gainParam.setValueAtTime(FLOOR_GAIN, startTime);
    gainParam.exponentialRampToValueAtTime(
      Math.max(FLOOR_GAIN, peakGain),
      startTime + envelope.attackS,
    );
    gainParam.exponentialRampToValueAtTime(
      Math.max(FLOOR_GAIN, peakGain * envelope.sustainLevel),
      startTime + envelope.attackS + envelope.decayS,
    );
    gainParam.exponentialRampToValueAtTime(FLOOR_GAIN, startTime + totalS);
    return totalS;
  };

  /** Everything currently needed to force a voice silent early -- see
   *  admitAndTrack, which steals the oldest once MAX_POLYPHONY (sfx.ts) is
   *  exceeded. `sources` covers every oscillator/buffer-source the voice
   *  started, so stopNow() can stop all of them, not just the audible
   *  one. */
  interface VoiceHandle {
    bodyGain: GainNode;
    sources: (OscillatorNode | AudioBufferSourceNode)[];
    stopNow: () => void;
  }

  /** How long a stolen voice takes to fade to silence, rather than being
   *  cut instantly -- an instant gain-node cut can click (a discontinuous
   *  jump in the waveform); a short forced ramp to the floor avoids that
   *  even when a voice is being stolen well before its own natural
   *  release would have reached it. */
  const STEAL_FADE_S = 0.015;

  /**
   * Builds one full struck voice (land's own note, or one note of done's
   * chord) from a resolved VoicePlan -- the signal chain in this section's
   * own header comment, node for node: 3 partial oscillators + a noise
   * transient + a falling sub, merged into one voice-gain node (the ADSR),
   * through the shared saturator curve, through a panner, then split into
   * a dry path to `master` and a send path (scaled by the plan's own
   * `reverbSend`) into the shared convolver.
   */
  const scheduleVoice = (plan: VoicePlan, startTime: number): VoiceHandle => {
    const { ctx, master: bus, reverbConvolver: convolver } = ensureAudio();

    const bodyGain = ctx.createGain();
    const bodyTotalS = applyEnvelope(
      bodyGain.gain,
      plan.bodyPeakGain,
      plan.bodyEnvelope,
      startTime,
    );

    const saturator = ctx.createWaveShaper();
    saturator.curve = saturatorCurve!; // built above, in ensureAudio, before this can run
    saturator.oversample = '2x';

    const panner = ctx.createStereoPanner();
    panner.pan.value = plan.pan;

    bodyGain.connect(saturator).connect(panner);
    panner.connect(bus);
    const sendGain = ctx.createGain();
    sendGain.gain.value = plan.reverbSend;
    panner.connect(sendGain);
    sendGain.connect(convolver);

    const sources: (OscillatorNode | AudioBufferSourceNode)[] = [];

    for (const partial of plan.partials) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(partial.freqStartHz, startTime);
      osc.frequency.exponentialRampToValueAtTime(
        partial.freqEndHz,
        startTime + partial.pitchGlideS,
      );
      const gain = ctx.createGain();
      applyEnvelope(
        gain.gain,
        partial.relativeGain,
        partial.envelope,
        startTime,
      );
      osc.connect(gain).connect(bodyGain);
      osc.start(startTime);
      osc.stop(startTime + bodyTotalS + 0.02);
      sources.push(osc);
    }

    const transientTotalS = envelopeTotalS(plan.transient.envelope);
    const transientSrc = ctx.createBufferSource();
    transientSrc.buffer = noiseBuffer(ctx, transientTotalS);
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = plan.transient.filterCenterHz;
    bandpass.Q.value = plan.transient.q;
    const transientGain = ctx.createGain();
    applyEnvelope(
      transientGain.gain,
      plan.transient.relativeGain,
      plan.transient.envelope,
      startTime,
    );
    transientSrc.connect(bandpass).connect(transientGain).connect(bodyGain);
    transientSrc.start(startTime);
    transientSrc.stop(startTime + transientTotalS + 0.02);
    sources.push(transientSrc);

    const subTotalS = envelopeTotalS(plan.sub.envelope);
    const subOsc = ctx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(plan.sub.freqStartHz, startTime);
    subOsc.frequency.exponentialRampToValueAtTime(
      plan.sub.freqEndHz,
      startTime + subTotalS,
    );
    const subGain = ctx.createGain();
    applyEnvelope(
      subGain.gain,
      plan.sub.relativeGain,
      plan.sub.envelope,
      startTime,
    );
    subOsc.connect(subGain).connect(bodyGain);
    subOsc.start(startTime);
    subOsc.stop(startTime + subTotalS + 0.02);
    sources.push(subOsc);

    const stopNow = (): void => {
      try {
        const now = ctx.currentTime;
        bodyGain.gain.cancelScheduledValues(now);
        bodyGain.gain.setValueAtTime(
          Math.max(FLOOR_GAIN, bodyGain.gain.value),
          now,
        );
        bodyGain.gain.exponentialRampToValueAtTime(
          FLOOR_GAIN,
          now + STEAL_FADE_S,
        );
        for (const src of sources) src.stop(now + STEAL_FADE_S + 0.005);
      } catch {
        // A stolen voice that goes silent a little abruptly is not worth
        // breaking the tool over -- same "audio is decoration" reasoning
        // as `play` below.
      }
    };

    return { bodyGain, sources, stopNow };
  };

  /** MAX_POLYPHONY (sfx.ts) voices at once; the oldest is stolen (faded
   *  and stopped early) the instant a 9th would otherwise start. Long
   *  reverb tails (done's release runs to ~0.9s) plus a big class landing
   *  many groups in a fast run must not pile up an unbounded number of
   *  simultaneously-ringing voices. */
  let activeVoices: VoiceHandle[] = [];
  const admitAndTrack = (handle: VoiceHandle): void => {
    const { activeVoices: next, stolen } = admitVoice(activeVoices, handle);
    activeVoices = next;
    stolen?.stopNow();
  };

  /** Sound only plays when the toggle is checked, and audio is decoration:
   *  a browser refusing any part of this must never break the tool. */
  const play = (effect: () => void): void => {
    if (!soundToggle.checked) return;
    try {
      effect();
    } catch {
      // Audio is decoration. If the browser refuses, the tool still works.
    }
  };

  /** Decoded AudioBuffer per URL, populated lazily -- see sampleFor below.
   *  Absence covers all three of the brief's fallback triggers identically:
   *  not decoded yet, a fetch that failed, or a decodeAudioData rejection --
   *  there is deliberately no separate "failed" state to check, because
   *  every one of those is "fall back to synthesis for THIS call" alike. */
  const decodedSamples = new Map<string, AudioBuffer>();
  /** Which URLs have ever had a decode ATTEMPTED, so a call that finds "not
   *  ready yet" does not restart the same decode on every subsequent call
   *  while the first attempt is still in flight (or has already failed). */
  const decodeAttempted = new Set<string>();

  /**
   * Synchronous readiness check: returns the decoded buffer if (and only
   * if) it is ready RIGHT NOW, so a caller never has to await anything or
   * schedule a setTimeout to find out -- exactly what lets shuffle()/land()/
   * done() below decide, on every call, without blocking or delaying that
   * call by even one tick. If nothing is ready yet, kicks off
   * (fire-and-forget) whatever work is still needed -- awaiting the bytes
   * this file's own prefetch may already have started, or starting them
   * itself if nothing did -- so a LATER call within the same shuffle, or the
   * next shuffle entirely, has a real chance of finding it ready. Never
   * throws and never leaves an unhandled rejection: audio is decoration,
   * per `play` above -- the same guarantee, just reached a different way,
   * since this runs outside `play`'s own try/catch (fire-and-forget, not
   * awaited by anything `play` wraps).
   */
  const sampleFor = (url: string): AudioBuffer | undefined => {
    const ready = decodedSamples.get(url);
    if (ready) return ready;
    if (!decodeAttempted.has(url)) {
      decodeAttempted.add(url);
      void (async () => {
        try {
          const bytes = await ensureBytesLoading(url);
          if (!bytes) return; // fetch failed -- stays absent, forever synth
          const { ctx } = ensureAudio();
          const buffer = await ctx.decodeAudioData(bytes);
          decodedSamples.set(url, buffer);
        } catch {
          // decodeAudioData rejected -- e.g. a browser with no AAC support.
          // Stays absent from decodedSamples; every future call for this
          // URL keeps using the synth fallback, silently and correctly.
        }
      })();
    }
    return undefined;
  };

  /** Plays an already-decoded real sample: BufferSource → gain →
   *  destination, straight to the shared AudioContext's own destination,
   *  deliberately NOT through the synth's master/reverb/compressor bus --
   *  these files are already mastered (src/assets/sfx/CREDITS.md); running
   *  a finished recording through processing built for raw oscillators
   *  would only recolour it. Still the SAME lazily-created AudioContext as
   *  the synth path (ensureAudio's own cache), which is what keeps it true
   *  that only one AudioContext ever exists regardless of which path a
   *  given call actually took. */
  const playSample = (buffer: AudioBuffer, gain: number): void => {
    const { ctx } = ensureAudio();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gainNode = ctx.createGain();
    gainNode.gain.value = gain;
    source.connect(gainNode).connect(ctx.destination);
    source.start(ctx.currentTime);
  };

  const sfx = {
    // The real recording, if ready (shuffle.m4a); otherwise a granular
    // riffle SYNTH FALLBACK: 16-22 independently-filtered noise grains over
    // a soft arch, plus one onset thump -- see shuffleGrainPlans' own doc
    // comment in sfx.ts for why this reads as discrete objects in motion
    // rather than one continuous whoosh.
    shuffle: () =>
      play(() => {
        const sample = sampleFor(shuffleAssetUrl);
        if (sample) {
          playSample(sample, SFX_ASSET_GAIN.shuffle);
          return;
        }

        const { ctx, master: bus, reverbConvolver: convolver } = ensureAudio();
        const startTime = ctx.currentTime;
        const rng = ensureVariationRng();

        for (const grain of shuffleGrainPlans(rng)) {
          const grainStart = startTime + grain.onsetS;
          const grainTotalS = envelopeTotalS(grain.envelope);
          const src = ctx.createBufferSource();
          src.buffer = noiseBuffer(ctx, grainTotalS);
          const bandpass = ctx.createBiquadFilter();
          bandpass.type = 'bandpass';
          bandpass.frequency.value = grain.filterCenterHz;
          bandpass.Q.value = grain.q;
          const gain = ctx.createGain();
          applyEnvelope(gain.gain, grain.peakGain, grain.envelope, grainStart);
          const panner = ctx.createStereoPanner();
          panner.pan.value = grain.pan;
          src.connect(bandpass).connect(gain).connect(panner);
          panner.connect(bus);
          const sendGain = ctx.createGain();
          sendGain.gain.value = SHUFFLE_REVERB_SEND;
          panner.connect(sendGain);
          sendGain.connect(convolver);
          src.start(grainStart);
          src.stop(grainStart + grainTotalS + 0.02);
        }

        const subOsc = ctx.createOscillator();
        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(SHUFFLE_SUB.startHz, startTime);
        subOsc.frequency.exponentialRampToValueAtTime(
          SHUFFLE_SUB.endHz,
          startTime + SHUFFLE_SUB.durationS,
        );
        const subGain = ctx.createGain();
        applyEnvelope(
          subGain.gain,
          SHUFFLE_SUB.gain,
          {
            attackS: 0.005,
            decayS: 0,
            sustainLevel: 1,
            releaseS: SHUFFLE_SUB.durationS,
          },
          startTime,
        );
        subOsc.connect(subGain).connect(bus);
        subOsc.start(startTime);
        subOsc.stop(startTime + SHUFFLE_SUB.durationS + 0.02);
      }),
    // The real recording, if ready -- round-robin over the four land-*.m4a
    // takes (landAssetIndex, src/lib/sfxAssets.ts) so two consecutive
    // groups never land on the same one. Otherwise a SYNTH FALLBACK: a
    // soft, weighted struck voice -- inharmonic partials, a contact
    // transient and a falling sub -- pitched from the pentatonic scale and
    // stepping with the group index. See scheduleVoice's own doc comment.
    land: (i: number) =>
      play(() => {
        const sample = sampleFor(landAssetUrls[landAssetIndex(i)]);
        if (sample) {
          playSample(sample, SFX_ASSET_GAIN.land);
          return;
        }

        const { ctx } = ensureAudio();
        const startTime = ctx.currentTime;
        admitAndTrack(
          scheduleVoice(landVoicePlan(i, ensureVariationRng()), startTime),
        );
      }),
    // The real recording, if ready (done.m4a); otherwise a SYNTH FALLBACK:
    // a riser swelling into a sus2/add9 cluster, each note the same
    // struck-voice architecture as `land`, staggered and stretched to a
    // much longer release -- "an arrival, not a snap-off". Every note
    // scheduled against THIS SAME audio-clock startTime, offset by
    // DONE_STAGGER_S, never by setTimeout.
    done: () =>
      play(() => {
        const sample = sampleFor(doneAssetUrl);
        if (sample) {
          playSample(sample, SFX_ASSET_GAIN.done);
          return;
        }

        const { ctx, master: bus, reverbConvolver: convolver } = ensureAudio();
        const startTime = ctx.currentTime;
        const rng = ensureVariationRng();

        const riserTotalS = DONE_RISER.durationS + DONE_RISER.releaseS;
        const riserSrc = ctx.createBufferSource();
        riserSrc.buffer = noiseBuffer(ctx, riserTotalS);
        const riserFilter = ctx.createBiquadFilter();
        riserFilter.type = 'highpass';
        riserFilter.Q.value = DONE_RISER.q;
        riserFilter.frequency.setValueAtTime(DONE_RISER.startHz, startTime);
        riserFilter.frequency.exponentialRampToValueAtTime(
          DONE_RISER.endHz,
          startTime + DONE_RISER.durationS,
        );
        const riserGain = ctx.createGain();
        applyEnvelope(
          riserGain.gain,
          DONE_RISER.gain,
          {
            attackS: DONE_RISER.durationS,
            decayS: 0,
            sustainLevel: 1,
            releaseS: DONE_RISER.releaseS,
          },
          startTime,
        );
        riserSrc.connect(riserFilter).connect(riserGain);
        riserGain.connect(bus);
        const riserSend = ctx.createGain();
        riserSend.gain.value = DONE_REVERB_SEND;
        riserGain.connect(riserSend);
        riserSend.connect(convolver);
        riserSrc.start(startTime);
        riserSrc.stop(startTime + riserTotalS + 0.02);

        doneVoicePlans(rng).forEach((plan, j) => {
          admitAndTrack(scheduleVoice(plan, startTime + DONE_STAGGER_S[j]));
        });
      }),
  };

  // ── rendering ───────────────────────────────────────────────────────────

  /**
   * `<svg class="avatar"><use href="#avatar-m"></use></svg>` -- the small
   * per-student INSTANCE, referencing one of the three `<symbol>`s
   * ClassroomGroupsPage.astro builds once, statically, at build time
   * (`avatarSvg`, src/lib/avatars.ts: `AVATAR_SEXES.map(avatarSvg).join('')`,
   * injected via `set:html` into a visually-hidden sprite). Interpolates
   * `avatarSymbolId(student.sex)` into markup -- safe despite the
   * interpolation, unlike a teacher's typed NAME just below, because that
   * function (src/lib/avatars.ts, unit-tested there) is normalised to
   * always return one of exactly three fixed, developer-authored strings,
   * never anything shaped by what a teacher types or picks; `student.sex`
   * itself only ever arrives from the roster table's own Sex <select>,
   * whose options are `''`/`'M'`/`'F'` (roster-ui.ts) -- never free text.
   *
   * `aria-hidden`, matching the AVATAR_SVG constant this replaces --
   * decorative, since `who.textContent` right after it already carries the
   * identity a screen reader needs (avatars.ts's own `avatarSvg` still
   * marks the un-rendered `<symbol>` `role="img"`/`aria-label`, so a
   * consumer that DOES surface it directly still gets a real label; see
   * that module's own doc comment on `LABEL` for why both are correct at
   * once).
   */
  const avatarHtml = (student: Student) =>
    `<svg class="avatar" viewBox="0 0 40 40" focusable="false" aria-hidden="true">` +
    `<use href="#${avatarSymbolId(student.sex)}"></use>` +
    `</svg>`;

  const label = (student: Student) => resolveStudent(student.number);

  const render = (groups: Student[][]) => {
    tables.textContent = '';
    groups.forEach((group, i) => {
      const card = document.createElement('section');
      card.className = 'group';
      const h = document.createElement('h3');
      // Stage 3, Task 8: groups are always numbered now -- the themed
      // branch groupName() used to have, and the naming radio that chose
      // it, are both gone (design spec section 5).
      h.textContent = groupName(i, t);
      const ul = document.createElement('ul');
      group.forEach((student) => {
        const li = document.createElement('li');
        li.className = 'student';
        // Stage 3, Task 9. The identity, carried on the element, so a
        // rename after the shuffle can find this row again -- see
        // `relabelResults`'s own doc comment for why re-rendering the cards
        // instead would blank a deal in progress. A number, never a name:
        // nothing a teacher typed goes into an attribute.
        li.dataset.number = String(student.number);
        li.innerHTML = avatarHtml(student); // see avatarHtml's own doc comment
        const who = document.createElement('span');
        who.className = 'who';
        who.textContent = label(student); // the untrusted value, set as TEXT
        li.appendChild(who);
        ul.appendChild(li);
      });
      card.append(h, ul);
      tables.appendChild(card);
    });
  };

  // The deal is interruptible (operator, 2026-08-13). Two ways out, and they
  // mean different things:
  //
  //   `dealToken`  — a NEWER deal has started. This one abandons quietly and
  //                  touches nothing, because the new one owns the cards now.
  //   `dealSkip`   — the teacher changed a detail mid-deal. The animation is
  //                  no longer worth watching, so it finishes INSTANTLY:
  //                  every remaining card lands at once rather than the deal
  //                  being cancelled and leaving a half-dealt sheet.
  //
  // Neither disables the button. Pressing "Shuffle again" during a deal
  // starts a new one from the top, which is what the button says it does.
  // ── the waiting board (#743) ────────────────────────────────────────────
  const waiting = $<HTMLElement>('cg-waiting')!;
  const waitingList = $<HTMLUListElement>('cg-waiting-list')!;
  const waitingError = $<HTMLParagraphElement>('cg-waiting-error')!;

  /** Everyone the deal will place who is not already seated (#743). */
  const waitingPool = (input: ReturnType<typeof dealInput>): Student[] => {
    const pinned = new Set(input.pinned.flat().map((s) => s.number));
    return (
      typeof input.students === 'number'
        ? Array.from({ length: input.students }, (_, i) =>
            anonymousStudent(i + 1),
          )
        : input.students.filter((s) => !s.absent)
    ).filter((s) => !pinned.has(s.number));
  };

  /** The waiting list, shown: every student in `pool`, numbered (#743). */
  const showList = (pool: readonly Student[]) => {
    waitingList.textContent = '';
    for (const student of pool) {
      const li = document.createElement('li');
      li.className = 'waiting-student';
      li.dataset.number = String(student.number);
      const number = document.createElement('span');
      number.className = 'number';
      number.textContent = String(student.number);
      li.appendChild(number);
      const name = rosterNames.get(student.number);
      if (name) {
        const who = document.createElement('span');
        who.className = 'who';
        who.textContent = name; // the untrusted value, set as TEXT
        li.appendChild(who);
      }
      waitingList.appendChild(li);
    }
    waitingError.hidden = true;
    waitingError.textContent = '';
    waiting.hidden = false;
  };

  /**
   * A board opened before the first deal: the heading, one card per group
   * the deal will make (`plannedGroups`, the deal's own code, so the count
   * cannot disagree), and every student the deal will place, numbered, with
   * the name beside the number where the roster has one. Rendered into
   * `#cg-results` through the same `render` a deal uses: one element, one
   * render path (AC2).
   */
  const showWaiting = () => {
    const input = dealInput();
    resultsHeadingEl.textContent = resultsHeadingText(classInput.value, t);
    render(plannedGroups(input) ?? []);
    // A pinned member is already in place: nothing deals it in.
    tables
      .querySelectorAll('.student')
      .forEach((c) => c.classList.add('dealt'));
    showList(waitingPool(input));
    results.hidden = false;
    projector?.setShuffleLabel(t.makeGroups);
  };

  /** The waiting board is gone: by a deal, or by leaving without one. */
  const hideWaiting = () => {
    waiting.hidden = true;
    waitingList.textContent = '';
    waitingError.hidden = true;
    waitingError.textContent = '';
  };

  let dealToken = 0;
  let dealSkip = false;
  // #744: the travelling deal's way out. `finish` lands everyone now (a
  // detail changed, or the board closed); `superseded` is a newer deal.
  let travelling: AbortController | null = null;
  const finishDealNow = () => {
    dealSkip = true;
    travelling?.abort('finish');
  };

  const animate = async (speed: string) => {
    const myDeal = ++dealToken;
    dealSkip = false;
    const cards = Array.from(tables.querySelectorAll<HTMLElement>('.student'));
    const landAll = () => cards.forEach((c) => c.classList.add('dealt'));
    if (speed === 'skip') {
      landAll();
      return;
    }
    // FAST_STEP_S/NORMAL_STEP_S live in sfx.ts, not here, so
    // LAND_TRANSIENT_PLUS_BODY_S/LAND_RELEASE_S and this step can be
    // compared in one place (sfx.test.ts) instead of trusting a
    // hand-copied 45/110 to stay in sync with whatever this line actually
    // uses.
    const step = (speed === 'fast' ? FAST_STEP_S : NORMAL_STEP_S) * 1000;
    sfx.shuffle();
    for (let i = 0; i < cards.length; i++) {
      // Superseded: a newer deal is running and owns these cards.
      if (myDeal !== dealToken) return;
      // Asked to finish: land the rest in one frame, then fall out of the
      // loop to the same completion path a full deal takes.
      if (dealSkip) break;
      cards[i].classList.add('dealt');
      sfx.land(i);
      await new Promise((r) => setTimeout(r, step));
    }
    if (myDeal !== dealToken) return;
    // Unconditional, not only on the skip path: a deal that ran to the end
    // has already landed every card, so this is a no-op there and the single
    // guarantee that no sheet is ever left half-dealt.
    landAll();
    sfx.done();
  };

  /**
   * What the deal is asked to group, read from the form: the ONE reading,
   * shared by the deal and by the waiting board's plan (#743), so the cards
   * shown before a shuffle are the cards the shuffle fills.
   */
  const dealInput = (): Omit<GroupingInput, 'random' | 'searchNodeCap'> => {
    const count = readCount();
    // The roster takes over the moment it is non-empty; `count` is the
    // fallback for the case where a teacher never opens Student details at
    // all. `roster` here is the SAME module-scope array getRoster/setRoster
    // manage -- see their own doc comment above -- so this can never read a
    // different roster than the one a later stage's table renders or exports.
    //
    // #188. A roster still wins outright. Otherwise the three number fields
    // decide, and `studentsForInput` hands back the bare `count` while all
    // three are empty (AC7), so a teacher who never touches them takes
    // exactly the path they always did.
    //
    // Held in a const rather than built inline, because AC13's note below has
    // to compare what went IN against what came out. Re-reading the fields
    // down there could disagree with what was actually grouped.
    const students =
      roster.length > 0
        ? roster
        : studentsForInput(count, readNumberFields().fields);
    return {
      students,
      mode: readMode(),
      leftovers: readLeftovers(),
      sexMode: readSexMode(), // live as of Stage 3, Task 9 -- see that function
      pinned: [], // a later stage wires the pins
    };
  };

  /** The board's travelling deal (#744): order, schedule, then the flights. */
  const travelDeal = async (
    groups: Student[][],
    input: ReturnType<typeof dealInput>,
  ) => {
    ++dealToken; // a page deal still running stops, as a newer deal says
    const pinned = new Set(input.pinned.flat().map((s) => s.number));
    for (const row of tables.querySelectorAll<HTMLElement>('.student'))
      if (pinned.has(Number(row.dataset.number))) row.classList.add('dealt');
    const order = travelOrder(groups, pinned);
    const schedule = travelSchedule(
      order.length,
      speedSelect.value === 'fast' ? 'fast' : 'normal',
    );
    if (!schedule) {
      tables
        .querySelectorAll('.student')
        .forEach((c) => c.classList.add('dealt'));
      hideWaiting();
      projector?.refit();
      return;
    }
    const controller = new AbortController();
    travelling = controller;
    sfx.shuffle();
    const outcome = await travel({
      list: waitingList,
      tables,
      order,
      schedule,
      signal: controller.signal,
      hideList: hideWaiting,
      refit: () => projector?.refit(),
      onLand: (i) => sfx.land(i),
    });
    if (travelling === controller) travelling = null;
    if (outcome === 'dealt') sfx.done();
  };

  // ── submit ──────────────────────────────────────────────────────────────
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.hidden = true;

    const input = dealInput();
    const { students } = input;
    const outcome = buildGroups({ ...input, random: Math.random });

    if (!outcome.ok) {
      // From the waiting board the cards and the list stay up, and the
      // reason is said there as well as on the page (#743 AC5).
      if (waiting.hidden) {
        results.hidden = true;
      } else {
        waitingError.hidden = false;
        waitingError.textContent = renderError(
          outcome.error,
          t,
          resolveStudent,
        );
      }
      // The sheet is gone, so "Export groups" must go with it -- otherwise
      // it stays offering the arrangement from before the refusal, which is
      // not on screen any more.
      lastGroups = null;
      io?.refresh();
      refreshPrintAvailability();
      refreshBoardAvailability();
      // Unhidden BEFORE the text lands. A live region only reports mutations
      // to something already in the accessibility tree, so writing first and
      // revealing second announced nothing at all — the visitor pressed the
      // button and heard silence.
      errorBox.hidden = false;
      errorBox.textContent = renderError(outcome.error, t, resolveStudent);
      // No focus move: role="alert" is what announces this. The old
      // errorBox.focus?.() was neither a guard (focus always exists on an
      // HTMLElement, so the ?. never short-circuits) nor a focus move (a <p>
      // with no tabindex is not focusable) — it only looked like both.

      // The results are gone, so the button must stop offering to reshuffle
      // them. Left alone it still read "Shuffle again" from the last success.
      goButton.textContent = t.makeGroups;
      return;
    }

    const { groups, warnings } = outcome.result;
    // #744: on the board with animation on, the deal travels from the list,
    // so the list is (re)shown for it; ruling 2 brings everyone back to it
    // on a second Shuffle too. Anywhere else the list goes, as before.
    const travels =
      (projector?.isOpen() ?? false) && speedSelect.value !== 'skip';
    travelling?.abort('superseded');
    travelling = null;
    if (travels) showList(waitingPool(input));
    else hideWaiting();
    projector?.setShuffleLabel(t.boardShuffle);
    // What the sheet is showing, for "Export groups" -- see `lastGroups`'s
    // own comment where it is declared.
    lastGroups = groups;
    io?.refresh();
    refreshPrintAvailability();
    refreshBoardAvailability();

    // Read fresh at every submit -- never cached -- so a class name typed
    // or changed between two shuffles is picked up on the next one. Set
    // through `.textContent`, never `.innerHTML`: a teacher's typed text is
    // theirs, not markup, the same rule the results grid already follows
    // for a student's own name below (`who.textContent = label(student)`).
    // See resultsHeadingText's own doc comment (src/lib/i18n/index.ts) for
    // why the value is threaded through untrimmed. Written here, alongside
    // render() and before `results.hidden = false`, because -- like the
    // group cards `render()` builds -- this is structural content inside a
    // non-live section, not the `role="status"` region itself; only
    // `summary` below needs the write-after-reveal ordering that makes a
    // live-region announcement actually fire.
    resultsHeadingEl.textContent = resultsHeadingText(classInput.value, t);
    // Text first, animation second — see the note at the top of this file.
    render(groups);
    // Same ordering rule as the error path: the region joins the tree, and
    // only then is the sentence written into it.
    results.hidden = false;
    // AFTER `render()` and after the section is visible -- `refit` measures
    // `scrollHeight`, and measuring before the new cards exist sizes the
    // board to the PREVIOUS shuffle. The stage is `overflow: hidden` until
    // `fitScale` says it scrolls, so a taller arrangement measured against
    // the old one loses its bottom group off the board with no scrollbar,
    // in front of a class. It was called before `render` until this fix.
    projector?.refit();
    summary.textContent = t.resultsSummary({
      groups: groups.length,
      students: groups.flat().length,
    });

    // A success can still carry `warnings` -- "Gita and Sari have joined a
    // group of boys because there were not enough girls…" -- see
    // grouping.ts's own module doc. RENDERED as of Stage 3, Task 9 (G-11):
    // `sexMode` above is live now, so this array can finally be non-empty,
    // and until this task the script read it only to `void` it.
    //
    // EVERY warning, not `warnings[0]`: this is an array because one
    // shuffle can have more than one true thing to say about it, and
    // rendering the first would silently drop the rest -- the roster's own
    // validation box shows one message at a time on purpose, but that is a
    // teacher mid-keystroke, not a finished result.
    //
    // Emptied first, every time: the previous shuffle's warnings are about
    // groups that no longer exist, and a stale warning under fresh groups
    // is a lie about them. Written AFTER `results.hidden = false`, the same
    // ordering `summary` above needs and for the same reason -- a live
    // region only announces mutations to something already in the
    // accessibility tree. `.textContent` per item, never `.innerHTML`:
    // `renderWarning` resolves student numbers into names a teacher typed.
    warningsList.textContent = '';
    warningsList.hidden = warnings.length === 0;
    for (const warning of warnings) {
      const li = document.createElement('li');
      li.textContent = renderWarning(warning, t, resolveStudent);
      warningsList.appendChild(li);
    }

    // #188, AC13. How many were actually grouped, shown only when that
    // differs from how many went in -- "a teacher must never be left to
    // notice a missing pupil by counting".
    //
    // DERIVED by subtracting what came out from what went in, rather than
    // re-reading the three number fields: one rule then covers a roster with
    // absences ticked in Student details exactly as well as typed numbers,
    // and it cannot disagree with what was really grouped.
    //
    // Cleared, then hidden or shown, then written -- the same three steps in
    // the same order the warnings above take, and for the same reason: a
    // `role="status"` region only announces a mutation to something already
    // in the accessibility tree.
    const placed = groups.flat();
    const placedNumbers = new Set(placed.map((s) => s.number));
    const typed = typeof students === 'number' ? students : students.length;
    const missing =
      typeof students === 'number'
        ? []
        : students
            .map((s) => s.number)
            .filter((number) => !placedNumbers.has(number));
    groupedNoteEl.textContent = '';
    groupedNoteEl.hidden = missing.length === 0;
    if (missing.length > 0) {
      groupedNoteEl.textContent = t.groupedNote({
        grouped: placed.length,
        typed,
        absent: missing,
      });
    }

    goButton.textContent = t.again;
    // A fresh shuffle is, by definition, made from exactly what the form
    // says right now -- comparing that against itself returns null, which
    // is what clears any notice left over from before this shuffle. Set
    // AFTER results.hidden = false so updateStaleness's own guard sees a
    // visible section, though staleReason would return null either way.
    lastSnapshot = snapshot();
    updateStaleness();

    try {
      if (travels) await travelDeal(groups, input);
      else await animate(speedSelect.value);
    } finally {
      // The deal no longer disables this button at all (see `animate`), so
      // this is not an "undo the disable" step — it re-derives the button's
      // state from the CURRENT roster. A teacher can edit Student details
      // while the deal plays, and a duplicate typed in that window must not
      // be silently cleared the moment the animation ends. Still in a
      // `finally` so a rejection inside the deal cannot skip it and leave
      // the button reporting a roster state that is no longer true.
      updateRosterValidation();
    }
  });
}

// The footer's report form exists only in beta locales (#97).
const reportForm =
  document.querySelector<HTMLFormElement>('[data-report-form]');
if (reportForm) enhanceReportForm(reportForm);
