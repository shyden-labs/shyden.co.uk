/**
 * Student details: the roster table.
 *
 * ONE renderer, two CSS layouts (design spec section 3, "The roster is a
 * table on a laptop and cards on a phone"). `renderRoster` below builds a
 * single `<table>` whose `<tr class="cg-student">` rows are, structurally,
 * the same elements Stage 3, Task 3's own CSS
 * (ClassroomGroupsPage.astro's `<style is:global>` block, anchored on
 * `#cg-roster`) turns into cards below ~600px purely with `display: block`
 * on the table parts under a media query — no second render path. If a
 * future change needs a second DOM shape for the card layout, stop: that is
 * exactly the drift F-03/F-04 (design spec section 13, "same content", "same
 * behaviour") exist to catch, because two renderers can each pass their own
 * tests while quietly disagreeing with each other.
 *
 * Pure DOM building and event wiring: every render is a function of the
 * `roster` array handed to it (the plan's own Architecture note), and every
 * user edit is reported upward through `handlers` rather than mutating
 * anything here. `classroom-groups.ts` is what owns the roster array (across
 * renders) and decides when to call this again — see that file's own
 * "── student roster" section. The one exception is `renderRoster`'s own
 * `liveRoster`, which does not survive past the render call that creates
 * it and exists only to fix a same-render staleness bug — see its own
 * comment, just above the `tbody` it feeds, for what it fixes and why.
 *
 * `textContent`/`.value`/`document.createElement` throughout, never
 * `innerHTML` with anything interpolated — a teacher's typed name is
 * theirs, not markup, the same rule the results grid already follows
 * (`classroom-groups.ts`'s own `render()`, `who.textContent = label(student)`).
 */
import type { Student } from '../lib/grouping';
import { button } from './dom';
import {
  MAX_ROSTER,
  availableLetters,
  rosterAtLimit,
  rosterCounts,
  rosterRoomProblem,
} from '../lib/roster';
import type { Strings } from '../lib/i18n';

export interface RosterHandlers {
  /**
   * A student's name or number was edited. Fired on the input's OWN
   * `input` event — every keystroke, not just on blur, matching this
   * file's own `form.addEventListener('input', updateStaleness)` house
   * convention. The caller must NOT re-render the table in response: the
   * input already shows exactly what was typed, and tearing the DOM down
   * to rebuild it mid-keystroke would steal the focus and the caret
   * position out from under whoever is typing — the one bug a "one
   * renderer" design would otherwise make trivial to introduce by
   * accident.
   */
  onTextChange: (next: Student[]) => void;
  /**
   * A student's sex, absence or either letter was changed. Fired on the
   * control's own `change` event — a discrete choice, never mid-keystroke,
   * so re-rendering in response (which the caller is free to do, unlike
   * `onTextChange` above) costs nothing in focus or caret position. This is
   * also what makes a newly-used together/apart letter's successor appear
   * in every OTHER row's own dropdown, not only the row it was just set on
   * — `availableLetters` (src/lib/roster.ts) is recomputed from the whole
   * roster on every render.
   */
  onSelectChange: (next: Student[]) => void;
  /** "+ Add student" — append one new anonymous row. */
  onAdd: () => void;
  /** "+ Add several…", confirmed — append `count` new anonymous rows. */
  onAddSeveral: (count: number) => void;
  /**
   * "Remove", one per row — design spec section 4: "Removing a row removes
   * the student." Fired with the roster ALREADY filtered (this row's own
   * element gone), computed from the LIVE roster (`getRoster()`, threaded
   * into `buildRow` the same way every field handler already reads it —
   * see this row's own click listener, below) rather than the snapshot
   * this render started with, so a pending, uncommitted text edit made to
   * a DIFFERENT row is not silently discarded the moment this one is
   * removed — the exact shape of bug Stage 3, Task 3 already found and
   * fixed for `onTextChange`/`onSelectChange` (see `renderRoster`'s own
   * `liveRoster` comment, below). Re-renders safely, the same reasoning
   * `onSelectChange` above already rests on: removing a row is a discrete
   * action, never mid-keystroke.
   */
  onRemove: (next: Student[]) => void;
  /**
   * "Clear all" -- design spec section 4, "Emptying the list": empties the
   * whole roster in one action, returning `#cg-count` (classroom-groups.ts's
   * own `updateStudentsBox`) to being typeable again while it keeps
   * reporting the number it last held. Needs no `next` argument, unlike
   * every other handler here -- the result of clearing a roster is always
   * the same empty array, whatever it held a moment ago, so there is
   * nothing for a caller to compute and pass in.
   */
  onClearAll: () => void;
}

/**
 * Which column a print mirror belongs to, stamped onto the span so whatever
 * refreshes it can find it BY COLUMN rather than by position.
 *
 * The row is built Absent-first (`tr.append` below, operator 2026-08-13)
 * while the values were written number-first, and a positional mapping
 * shifted all six by one cell: the printed register's Absent column was a
 * list of numbers and its Name column was a column of M and F (#253).
 */
export type PrintColumn =
  'number' | 'name' | 'sex' | 'absent' | 'together' | 'apart';

/** Every column a roster row has: the six that print, and Remove, which never does. */
type RosterColumn = PrintColumn | 'remove';

/**
 * A roster cell that carries the column it belongs to.
 *
 * The print rules that take a column off the sheet name it BY COLUMN, never
 * by `nth-child`. The ordinal was already wrong once -- left at 4 it hid Sex
 * and printed Absent, "a sheet that silently answered a different question
 * than the tick box asked" -- and #253 then shipped the same defect class in
 * the mirror mapping. A cell that declares its own identity cannot be
 * re-pointed by reordering the row, which is what #253 AC2 asks for. #253
 * named only the Absent rule; the letters box and Remove kept their ordinals
 * until #390 F73.
 */
const columnCell = (column: RosterColumn): HTMLTableCellElement => {
  const td = document.createElement('td');
  td.dataset.col = column;
  return td;
};

/**
 * The print-only text twin of a cell's control.
 *
 * An `<input>`'s VALUE is not its text content, so a printed sheet built
 * from form controls is blank to any text assertion and unreliable on paper
 * besides -- browsers disagree about whether and how a control's value
 * appears in print. This is the same DOM, in the same cell, carrying the
 * same fact as text: `@media print` hides the control and shows this.
 *
 * Kept in sync by `refreshPrintMirrors` (classroom-groups.ts), hung off the
 * one `onRosterChanged` hook every roster mutation already routes through --
 * the same pattern `relabelResults` uses for the rendered groups, and for
 * the same reason: text edits deliberately never re-render (they would steal
 * focus and the caret), so a mirror that only updated on re-render would go
 * stale on every keystroke.
 */
const printMirror = (value: string, column: PrintColumn): HTMLSpanElement => {
  const span = document.createElement('span');
  span.className = 'cg-print-value';
  span.dataset.col = column;
  span.textContent = value;
  span.setAttribute('aria-hidden', 'true');
  return span;
};

/** M/F, or an em dash for unset. NOT the glyph the <select> shows: since #249
 * the collapsed control names its own column instead, while paper keeps the
 * dash for an empty cell. */
const sexText = (student: Student, t: Strings): string =>
  student.sex === 'M'
    ? t.rosterSexMale
    : student.sex === 'F'
      ? t.rosterSexFemale
      : t.rosterUnset;

const buildOption = (value: string, label: string): HTMLOptionElement => {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  return option;
};

/** Replaces the ONE student at `index` — every field handler builds its own
 *  patch and hands it to a caller, rather than mutating `roster` (a
 *  `readonly` parameter — see `renderRoster`'s own signature) in place. */
const patched = (
  roster: readonly Student[],
  index: number,
  fields: Partial<Student>,
): Student[] => roster.map((s, i) => (i === index ? { ...s, ...fields } : s));

/**
 * The id of the "roster is full" paragraph, so the two add buttons can name
 * it from `aria-describedby` and `disabled-controls.spec.ts` can resolve it.
 * One constant rather than three string literals: a typo in any one of them
 * is a reference to nothing, and a reference to nothing is silent.
 */
export const ROSTER_LIMIT_MESSAGE_ID = 'cg-roster-limit';

/**
 * "+ Add student" / "+ Add several…" — design spec section 4, "Changing the
 * class size is then a list operation". Rendered in TWO places by
 * `renderRoster` below: alone, when the roster is empty (so there is
 * something to click to create the first row), and again inside the
 * table's own `<tfoot>` once rows exist ("appear inline in the table
 * footer"). Built fresh each call, like every other element this module
 * creates — cheap, and it is what lets the inline "how many?" reveal below
 * always start closed on a fresh render rather than needing to remember
 * whether it was open before.
 *
 * `getRoster` (not a plain `roster` array) is what both of this task's own
 * limit checks read — the LIVE roster, exactly like every field handler in
 * `buildRow` already reads it, rather than the array this particular
 * `renderRoster` call started with. For the empty-roster call site
 * (`renderRoster`'s own early return, below) that is trivially `() => []`
 * — nothing can go stale about a length of zero — but threading the same
 * shape through both call sites, rather than a bare `roster` array here
 * and a live accessor everywhere else, is one fewer thing to get right by
 * hand later.
 */
function buildToolbar(
  t: Strings,
  handlers: RosterHandlers,
  getRoster: () => readonly Student[],
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'cg-roster-toolbar';

  const addButton = button(t.rosterAddStudent, 'cg-add-student');
  addButton.addEventListener('click', () => handlers.onAdd());

  const severalButton = button(t.rosterAddSeveral, 'cg-add-several');

  // "No dialog and no prompt()" (design spec section 4) — an inline field
  // that appears in place, kept HIDDEN until asked for rather than always
  // on screen, so the common case ("+ Add student", one row at a time)
  // is not cluttered by a control most visits to this section never touch.
  const inline = document.createElement('span');
  inline.className = 'cg-add-several-inline';
  inline.hidden = true;

  const howMany = document.createElement('input');
  howMany.type = 'number';
  howMany.min = '1';
  // A VISIBLE label, not an `aria-label`. The field used to appear as a bare
  // number box beside an "Add" button with nothing on screen saying what the
  // number was for — screen-reader users had the answer and everyone else
  // guessed. A real `<label for>` gives both the same sentence.
  howMany.id = 'cg-add-several-count';
  const howManyLabel = document.createElement('label');
  howManyLabel.htmlFor = howMany.id;
  howManyLabel.className = 'cg-add-several-label';
  howManyLabel.textContent = t.rosterHowMany;

  const confirmButton = button(t.rosterAddConfirm, 'cg-add-confirm');

  // "…also refuses a number that would cross it, saying how many rows are
  // free" (design spec section 4) — right beside the field the teacher is
  // looking at, so a refused request can be corrected without reopening
  // anything. Hidden until a refused attempt writes into it; role="alert"
  // for the identical reason #cg-roster-problem is (classroom-groups.ts) —
  // this is the same shape of refusal, a keystroke/click caught and
  // explained immediately, just scoped to THIS control rather than the
  // whole roster.
  const roomMessage = document.createElement('p');
  roomMessage.className = 'cg-roster-limit-message';
  roomMessage.setAttribute('role', 'alert');
  roomMessage.hidden = true;

  const confirm = () => {
    const count = Math.trunc(Number(howMany.value));
    // A blank, zero, negative or non-numeric field is simply not confirmed
    // — no rows added, no error shown. This module has no opinion on how
    // large is too large, only on what counts as "a number at all"; the
    // real ceiling is `rosterRoomProblem` just below, which is what turns
    // a pathologically large (or merely too-large-for-the-room) count into
    // a stated refusal rather than a silent clamp — the debt this stage
    // owed since Task 2 (see MAX_ROSTER's own doc comment, src/lib/
    // roster.ts).
    if (!(Number.isFinite(count) && count >= 1)) return;
    const problem = rosterRoomProblem(getRoster(), count, t);
    if (problem) {
      roomMessage.hidden = false;
      if (roomMessage.textContent !== problem)
        roomMessage.textContent = problem;
      return;
    }
    // Cleared before handing off — a batch that fits is never announced as
    // refused, and a stale "There is room for…" from an EARLIER, since-
    // corrected attempt must not linger once a valid one succeeds. Mostly
    // redundant with the fresh render `onAddSeveral`'s own success path
    // triggers (classroom-groups.ts), which throws this whole element away
    // — kept anyway, the same "cheap insurance" reasoning `onAdd`'s own
    // defensive limit check (classroom-groups.ts) rests on, in case a
    // future change ever calls this without re-rendering.
    roomMessage.hidden = true;
    roomMessage.textContent = '';
    handlers.onAddSeveral(count);
  };
  confirmButton.addEventListener('click', confirm);
  // A plain `<input type="number">` inside `#cg-form` implicitly submits
  // the WHOLE form on Enter (the browser picks the first submit button —
  // #cg-go, "Make groups" — regardless of which field has focus), which
  // would fire a shuffle instead of confirming this count. Intercepted here
  // so Enter does what it visibly looks like it should do.
  howMany.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirm();
    }
  });

  severalButton.addEventListener('click', () => {
    inline.hidden = false;
    howMany.focus();
  });

  inline.append(howManyLabel, howMany, confirmButton, roomMessage);
  wrap.append(addButton, severalButton, inline);

  // "Clear all" -- design spec section 4, "Emptying the list... Clearing a
  // list of 24 leaves 24 in the box, so nothing jumps and nothing is
  // lost." Gated on the SAME live `getRoster()` accessor every other
  // roster-size decision in this function already reads, rather than a
  // second boolean threaded through both of `buildToolbar`'s own call
  // sites: the EMPTY-roster call site (`renderRoster`'s own early return,
  // below) always hands this `() => []`, so `getRoster().length` is
  // always 0 there and this button never appears -- there is nothing
  // destructive to offer on a roster that is already empty. Never
  // disabled, unlike `addButton`/`severalButton` below: nothing about
  // MAX_ROSTER stops a teacher clearing the roster, at any size.
  if (getRoster().length > 0) {
    const clearButton = button(t.rosterClearAll, 'cg-clear-roster');
    clearButton.addEventListener('click', () => handlers.onClearAll());
    wrap.appendChild(clearButton);
  }

  // Design spec section 4, "Adding a row at 100": both controls disabled,
  // AND the limit stated — never a bare disabled control with nothing
  // beside it explaining why (this page's own established rule, e.g.
  // #cg-sex-why, ClassroomGroupsPage.astro). Computed fresh every render
  // from the CURRENT roster, never cached, so removing a row — which
  // always re-renders, see `RosterHandlers.onRemove`'s own doc comment —
  // re-enables both controls the instant the roster drops back under the
  // limit, the same "comparison, not a one-way latch" shape this page's
  // other guards already keep (updateRosterValidation, classroom-groups.ts).
  // Remove is never disabled here -- nothing about MAX_ROSTER stops a teacher
  // removing a row, even at the ceiling; a class already full is exactly when
  // removing one first matters most. (Recorded in ClassroomGroupsPage.astro's
  // CSS until #250 replaced those per-component rules with one site-wide
  // treatment in tokens.css, which is paint and had no business holding a
  // decision about behaviour.)
  if (rosterAtLimit(getRoster())) {
    addButton.disabled = true;
    severalButton.disabled = true;
    const limitMessage = document.createElement('p');
    limitMessage.className = 'cg-roster-limit-message';
    // An id, so the paragraph a sighted teacher reads is the SAME node a
    // screen reader is handed (#250 AC10). Without it the reason was on the
    // page and unreachable from either button: `aria-describedby` can only
    // name an id. Both buttons and the paragraph are rebuilt together by this
    // function, so the reference cannot outlive what it points at.
    limitMessage.id = ROSTER_LIMIT_MESSAGE_ID;
    limitMessage.textContent = t.rosterAtLimitMessage({ max: MAX_ROSTER });
    addButton.setAttribute('aria-describedby', ROSTER_LIMIT_MESSAGE_ID);
    severalButton.setAttribute('aria-describedby', ROSTER_LIMIT_MESSAGE_ID);
    wrap.appendChild(limitMessage);
  }

  return wrap;
}

/**
 * One `<tr class="cg-student">`. Every control is wired directly (no `id`,
 * no `name` — see `#cg-form`'s own privacy comment in
 * ClassroomGroupsPage.astro: a `name` on a control holding anything a
 * teacher typed would put it in a native GET submission the moment the
 * listener that prevents one fails to attach), so nothing here needs a
 * lookup table to find the element a later change came from — the closure
 * over `index` and `getRoster` already knows.
 */
function buildRow(
  student: Student,
  index: number,
  getRoster: () => readonly Student[],
  t: Strings,
  handlers: RosterHandlers,
  togetherLetters: readonly string[],
  apartLetters: readonly string[],
): HTMLTableRowElement {
  const tr = document.createElement('tr');
  tr.className = 'cg-student';
  // Design spec section 4: "the row is tinted instead" -- a tint, a stripe
  // and the pill built into `absentLabel` below, ALL keyed off this one
  // class rather than three independent checks, so the three signals can
  // never disagree with each other about whether a given row is absent.
  // `.is-absent`'s own CSS (ClassroomGroupsPage.astro) is what turns this
  // into the tint and (at the table breakpoint) the stripe; see that
  // block's own comment for why the stripe needs a SECOND rule at that
  // breakpoint rather than this class alone.
  if (student.absent) tr.classList.add('is-absent');
  // The same fact as `.is-absent`, as an ATTRIBUTE, so the print stylesheet
  // can select on it without borrowing a class whose job on screen is the
  // tint and the stripe. One write, from the one place that already decides
  // it -- never a second check that could disagree.
  tr.dataset.absent = String(student.absent);

  // # — the number. Editable (design spec section 4: "The teacher may
  // override them"); identity is the number everywhere else in this
  // engine, so this is the one field a later task's duplicate check
  // (rosterProblems, a later task) watches.
  const numberTd = columnCell('number');
  const numberInput = document.createElement('input');
  numberInput.type = 'number';
  numberInput.min = '1';
  numberInput.className = 'cg-roster-number';
  numberInput.setAttribute('aria-label', t.rosterColNumber);
  numberInput.value = String(student.number);
  numberInput.addEventListener('input', () => {
    const n = Math.trunc(Number(numberInput.value));
    if (Number.isFinite(n) && n >= 1) {
      handlers.onTextChange(patched(getRoster(), index, { number: n }));
    }
  });
  numberTd.appendChild(numberInput);
  numberTd.appendChild(printMirror(String(student.number), 'number'));

  // Name — optional. `placeholder` previews the SAME fallback label the
  // results grid and every error message already use for this student
  // (`t.studentNumber`, via `resolveStudent` in classroom-groups.ts) so a
  // teacher who never types a name can see, right here, what this row will
  // be called.
  const nameTd = columnCell('name');
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'cg-roster-name';
  nameInput.setAttribute('aria-label', t.rosterColName);
  nameInput.placeholder = t.studentNumber({ n: student.number });
  nameInput.value = student.name ?? '';
  nameInput.addEventListener('input', () => {
    // An emptied field is `null` (no name), never `''` — matches
    // rosterCounts's own "an emptied name reads as unnamed" contract
    // (src/lib/roster.ts).
    const value = nameInput.value === '' ? null : nameInput.value;
    handlers.onTextChange(patched(getRoster(), index, { name: value }));
  });
  nameTd.appendChild(nameInput);
  nameTd.appendChild(printMirror(student.name ?? '', 'name'));

  // Sex — blank (neutral) / M / F. The <option> VALUE is always the raw
  // 'M'/'F' the engine's Student.sex type uses, in both languages; only the
  // displayed text is localised (rosterSexMale/Female — see their own
  // comment in en.ts).
  const sexTd = columnCell('sex');
  const sexSelect = document.createElement('select');
  sexSelect.setAttribute('aria-label', t.rosterColSex);
  const unsetOption = buildOption('', t.rosterColSex);
  // Once a sex has been chosen there is no way back to "—" (operator,
  // 2026-08-13). The placeholder exists to say "not answered yet", not to be
  // an answer, and leaving it selectable let a teacher undo a required field
  // by accident. Disabled rather than removed so the option a screen reader
  // already announced does not vanish mid-interaction, and so the select
  // keeps a stable option list across re-renders.
  unsetOption.disabled = student.sex !== null;
  sexSelect.append(
    unsetOption,
    buildOption('M', t.rosterSexMale),
    buildOption('F', t.rosterSexFemale),
  );
  sexSelect.value = student.sex ?? '';
  sexSelect.addEventListener('change', () => {
    const value =
      sexSelect.value === '' ? null : (sexSelect.value as 'M' | 'F');
    handlers.onSelectChange(patched(getRoster(), index, { sex: value }));
  });
  sexTd.appendChild(sexSelect);
  sexTd.appendChild(printMirror(sexText(student, t), 'sex'));

  // Absent — ticking it marks the student out of the shuffle (design spec
  // section 4). Nothing else in this row is ever disabled by it — a later
  // task's own job is the tint/stripe/pill that make an absent row visibly
  // distinct; this task wires the fact the checkbox reports, not yet its
  // presentation. The checkbox itself is drawn small (matching this page's
  // existing `.switch input` convention); the `<label>` wrapping it is the
  // real 44px tap target, the same whole-row-is-the-target pattern that
  // convention already uses.
  const absentTd = columnCell('absent');
  const absentLabel = document.createElement('label');
  absentLabel.className = 'cg-roster-absent-label';
  const absentInput = document.createElement('input');
  absentInput.type = 'checkbox';
  absentInput.setAttribute('aria-label', t.rosterColAbsent);
  absentInput.checked = student.absent;
  absentInput.addEventListener('change', () => {
    handlers.onSelectChange(
      patched(getRoster(), index, { absent: absentInput.checked }),
    );
  });
  absentLabel.appendChild(absentInput);
  // The pill: "beside the tick" (design spec section 4), so it is a
  // sibling of `absentInput` inside the SAME flex label -- not a separate
  // element elsewhere in the row, and not merely `hidden` when the student
  // is present. Built only when actually absent, matching every other
  // per-row element this module builds fresh each render: `onSelectChange`
  // (the only handler this checkbox fires) always re-renders (see
  // `RosterHandlers`' own doc comment), so there is never a stale pill to
  // clean up on the way back to present. Text stays fixed ('absent'/
  // 'tidak hadir', never "away" -- design spec section 4's own "wording is
  // uniform" rule), independent of the checkbox's own accessible name
  // (`t.rosterColAbsent`, set via `aria-label` above, which wins the
  // accessible-name computation regardless of what other text sits inside
  // the same wrapping <label>), so this adds no second, competing name for
  // the checkbox itself.
  if (student.absent) {
    const pill = document.createElement('span');
    pill.className = 'cg-absent-pill';
    pill.textContent = t.rosterAbsentPill;
    absentLabel.appendChild(pill);
  }
  absentTd.appendChild(absentLabel);
  // A ticked BOX, not a word: design spec section 10's own "the `Absent`
  // column says it in no ink and no colour". \u2611/\u2610 read identically in
  // greyscale and need no legend.
  absentTd.appendChild(
    printMirror(student.absent ? '\u2611' : '\u2610', 'absent'),
  );

  // Together / Apart — a letter each, from a dropdown that grows as needed
  // (design spec section 4; `availableLetters`, src/lib/roster.ts).
  // `togetherLetters`/`apartLetters` are computed ONCE per render, from the
  // WHOLE roster, and handed to every row — not recomputed per row, so a
  // letter that became available because ANOTHER student just used it
  // shows up here identically regardless of which row is being built.
  const togetherTd = columnCell('together');
  const togetherSelect = document.createElement('select');
  togetherSelect.setAttribute('aria-label', t.rosterColTogether);
  togetherSelect.appendChild(buildOption('', t.rosterColTogether));
  for (const letter of togetherLetters) {
    togetherSelect.appendChild(buildOption(letter, letter));
  }
  togetherSelect.value = student.together ?? '';
  togetherSelect.addEventListener('change', () => {
    const value = togetherSelect.value === '' ? null : togetherSelect.value;
    handlers.onSelectChange(patched(getRoster(), index, { together: value }));
  });
  togetherTd.appendChild(togetherSelect);
  togetherTd.appendChild(
    printMirror(student.together ?? t.rosterUnset, 'together'),
  );

  const apartTd = columnCell('apart');
  const apartSelect = document.createElement('select');
  apartSelect.setAttribute('aria-label', t.rosterColApart);
  apartSelect.appendChild(buildOption('', t.rosterColApart));
  for (const letter of apartLetters) {
    apartSelect.appendChild(buildOption(letter, letter));
  }
  apartSelect.value = student.apart ?? '';
  apartSelect.addEventListener('change', () => {
    const value = apartSelect.value === '' ? null : apartSelect.value;
    handlers.onSelectChange(patched(getRoster(), index, { apart: value }));
  });
  apartTd.appendChild(apartSelect);
  apartTd.appendChild(printMirror(student.apart ?? t.rosterUnset, 'apart'));

  // Remove — design spec section 4: "Removing a row removes the student."
  // A SEVENTH cell, with a real (visually-hidden) header of its own — see
  // this file's own `renderRoster`, the `removeTh`/`removeHeading` built
  // just above the `<tbody>` this row joins, for the accessibility
  // reasoning (fix round 1: an EARLIER version of this column had no
  // matching `<th>` at all, which left the column unlabelled to a screen
  // reader — corrected, not left, once that was raised). See
  // ClassroomGroupsPage.astro's own comment on `#cg-roster`'s `<colgroup>`
  // for the column-width side of the same change, and its CSS for why this
  // column gets its own full-width ROW in the card layout rather than
  // competing with Name or any of the other five fields for space: design
  // spec section 3's own arithmetic already proved there is no room left
  // in EITHER of the card's two existing rows for a seventh control.
  //
  // Reads the LIVE roster at the moment of the click (`getRoster()`, the
  // same accessor every field handler above already closes over), not the
  // `roster` array this row was built from — the exact protection
  // `RosterHandlers.onRemove`'s own doc comment names: a pending,
  // uncommitted edit to a DIFFERENT row (a name or number mid-keystroke,
  // which never itself re-renders) must still be in the array this filter
  // runs against, or removing one row would silently discard it.
  const removeTd = columnCell('remove');
  const removeButton = button(t.rosterRemove, 'cg-remove-student');
  removeButton.addEventListener('click', () => {
    handlers.onRemove(getRoster().filter((_, i) => i !== index));
  });
  removeTd.appendChild(removeButton);

  // Absent first — must stay in step with the header order above and with
  // every `nth-child` rule in ClassroomGroupsPage.astro.
  tr.append(absentTd, numberTd, nameTd, sexTd, togetherTd, apartTd, removeTd);
  return tr;
}

/**
 * Builds the roster's entire DOM into `container` — clears it first, then
 * rebuilds from scratch, every call. `container` is expected to be
 * `#cg-students-body`; this function does not read or write `hidden` on it
 * (that toggle is the section-open/close mechanism classroom-groups.ts
 * already wires for all four collapsible sections) and does not care
 * whether it is currently visible — pre-rendering into a hidden body is
 * exactly how the toolbar is already on screen the instant a teacher opens
 * the section.
 *
 * With an EMPTY roster, only the toolbar renders (`+ Add student` /
 * `+ Add several…`) — there is no `<table id="cg-roster">` at all until
 * there is at least one row for it to hold. `#cg-roster` existing, or not,
 * is itself meaningful to at least one later task's own test (Student
 * details refusing to open above MAX_ROSTER leaves no table behind either)
 * so an empty-but-present table was deliberately avoided here.
 */
export function renderRoster(
  container: HTMLElement,
  roster: readonly Student[],
  t: Strings,
  handlers: RosterHandlers,
): void {
  container.textContent = '';

  if (roster.length === 0) {
    // `() => []` rather than a live accessor -- nothing can go stale about
    // a length of zero, and `getRoster`/`liveRoster` (below) do not exist
    // yet at this point in the function -- see `buildToolbar`'s own doc
    // comment on why both call sites still share its shape.
    container.appendChild(buildToolbar(t, handlers, () => []));
    return;
  }

  const togetherLetters = availableLetters(roster, 'together');
  const apartLetters = availableLetters(roster, 'apart');

  const table = document.createElement('table');
  table.id = 'cg-roster';
  // `print-list` is an ALIAS, not a second element: the printed class list
  // IS this table, restyled by `@media print`. Named so the print stylesheet
  // and its tests read as being about paper rather than about the roster
  // widget that happens to be underneath.
  table.className = 'cg-roster print-list';

  // Fixed widths live in CSS (ClassroomGroupsPage.astro's own global style
  // block, anchored on #cg-roster — see that block's own comment on why
  // GLOBAL, not scoped), targeting these SEVEN <col>s by position — never
  // on the inputs themselves. An input sized by its own content is what
  // makes an empty name box shrink next to a full one (R-10); `table-
  // layout: fixed` (also in that CSS) is what makes a <col>'s width apply
  // uniformly down its whole column regardless of any one row's content.
  // Seven, not six, since Stage 3, Task 6: the seventh is Remove's own
  // column — see `buildRow`'s own comment on why it earns a <col> but not
  // a matching <th>.
  const colgroup = document.createElement('colgroup');
  for (let i = 0; i < 7; i++)
    colgroup.appendChild(document.createElement('col'));
  table.appendChild(colgroup);

  const thead = document.createElement('thead');
  // Hidden in the card layout; the table breakpoint's `#cg-roster thead`
  // rule (ClassroomGroupsPage.astro) undoes it, at an ID's specificity.
  thead.className = 'visually-hidden';
  const headRow = document.createElement('tr');
  // Absent FIRST (operator, 2026-08-13). It is the column a teacher touches
  // at the start of a lesson, before anything else on the row matters, and it
  // was buried in the middle. Every positional rule that depends on this
  // order — the card layout's `.cg-student > td:nth-child(1..7)` and the
  // table's `col:nth-child(1..7)` widths — moves with it, in
  // ClassroomGroupsPage.astro. The print rules do not: they name each column
  // by its `data-col` (#253, #390 F73).
  const headings: readonly (readonly [PrintColumn, string])[] = [
    ['absent', t.rosterColAbsent],
    ['number', t.rosterColNumber],
    ['name', t.rosterColName],
    ['sex', t.rosterColSex],
    ['together', t.rosterColTogether],
    ['apart', t.rosterColApart],
  ];
  for (const [column, heading] of headings) {
    const th = document.createElement('th');
    th.scope = 'col';
    // Same identity the cells carry, so a print rule can hide a column
    // header and its cells by NAME (#253 AC2).
    th.dataset.col = column;
    th.textContent = heading;
    headRow.appendChild(th);
  }
  // Remove's own header — fix round 1: the first pass at this task left
  // this column's `<th>` out entirely, reasoning that adding one would
  // redden a test asserting six columns. That reasoning was backwards --
  // a test pinning "six" was pinning the OLD column count, not a
  // requirement anyone chose, and the real cost of leaving it out was an
  // unlabelled table column: a screen reader building this table's own
  // headers (table-navigation commands, or the "column N of M" some
  // readers announce) would find nothing here, or -- worse, depending on
  // how the header row happens to lay out with one cell short -- borrow
  // the SIXTH column's name for the SEVENTH cell. Design spec section 4's
  // own "colour is never the only signal" is exactly the principle this
  // violated: an unlabelled column is a missing SIGNAL, the identical
  // defect class every other control on this page already refuses to
  // ship.
  //
  // Visually hidden (`.visually-hidden`, tokens.css -- the SAME recipe
  // the <thead> wears below the table breakpoint, just applied to one
  // cell's own content rather than a whole row,
  // and UNCONDITIONALLY rather than only below the table breakpoint):
  // showing "Remove" as a visible heading above a column of seven
  // identical "Remove" buttons would only repeat what every row already
  // says, the same judgement call this repo already made once for the
  // whole header row on the card layout. The `<th>` element ITSELF stays
  // an ordinary, unhidden table cell — only its inner span is clipped —
  // because an absolutely-positioned `<th>` risks being pulled out of the
  // header ROW's own layout in table mode, where the other six headers
  // really are visible; hiding the CONTENT instead of the CELL sidesteps
  // that risk entirely.
  //
  // Reuses `t.rosterRemove` -- the exact word every row's own button
  // already carries -- rather than a second, independent string: one word
  // for the column, the same word for the control inside it, matching the
  // doubling-as-accessible-name convention the other six headers already
  // keep (see this function's own header comment, above the `heading`
  // loop just above).
  const removeTh = document.createElement('th');
  removeTh.scope = 'col';
  removeTh.dataset.col = 'remove' satisfies RosterColumn;
  const removeHeading = document.createElement('span');
  removeHeading.className = 'cg-roster-remove-heading visually-hidden';
  removeHeading.textContent = t.rosterRemove;
  removeTh.appendChild(removeHeading);
  headRow.appendChild(removeTh);
  thead.appendChild(headRow);
  table.appendChild(thead);

  // Bug found while adding Stage 3, Task 3's own "editing every field
  // works" test (task-3-brief.md's own Step 1, verbatim): every row below
  // is built ONCE, here, and every field's own `patched()` call (buildRow)
  // used to close directly over THIS render's `roster` array. `onTextChange`
  // (number/name) deliberately never re-renders -- see `RosterHandlers`'
  // own doc comment, "avoiding focus/caret theft" -- so that closure went
  // stale the instant a text edit landed, and the NEXT `change` event on
  // ANY row (even a different one -- every row built in this same call
  // shared the identical stale reference) computed ITS OWN patch from that
  // same stale array, silently reverting every pending text edit back to
  // what it was when this render began. Reproduced plainly: fill a name,
  // then pick a sex -- the name reverted to empty, in BOTH the card and the
  // table layout, proving it was never a layout bug at all.
  //
  // `liveRoster` is the one place both wrapped handlers below keep current,
  // and `getRoster` -- handed to every row via `buildRow`'s own parameter
  // of the same name -- is what lets a field built in an EARLIER row still
  // read the LATEST edit, made in a later one or in itself moments before,
  // rather than the snapshot this render started with. `RosterHandlers`
  // itself is untouched: `classroom-groups.ts` still receives exactly the
  // `next: Student[]` it always did, from exactly the same two callbacks --
  // this is internal bookkeeping, not a change to the public contract.
  let liveRoster: readonly Student[] = roster;
  const getRoster = (): readonly Student[] => liveRoster;
  const liveHandlers: RosterHandlers = {
    ...handlers,
    onTextChange: (next) => {
      liveRoster = next;
      handlers.onTextChange(next);
    },
    onSelectChange: (next) => {
      liveRoster = next;
      handlers.onSelectChange(next);
    },
    // Stage 3, Task 6. Same reasoning as onTextChange/onSelectChange just
    // above: kept current here even though a removal always triggers a
    // fresh `renderRoster` call of its own (see RosterHandlers.onRemove's
    // own doc comment) -- defensive, matching this pair's own established
    // "internal bookkeeping" precedent, not a change to the public
    // contract.
    onRemove: (next) => {
      liveRoster = next;
      handlers.onRemove(next);
    },
  };

  const tbody = document.createElement('tbody');
  roster.forEach((student, index) => {
    tbody.appendChild(
      buildRow(
        student,
        index,
        getRoster,
        t,
        liveHandlers,
        togetherLetters,
        apartLetters,
      ),
    );
  });
  table.appendChild(tbody);

  // The toolbar again, "inline in the table footer" (design spec section
  // 4) — a real <tfoot>, not a sibling element after the table, so it
  // reflows exactly like every other row once a later task's CSS turns
  // this table into a stack of cards below the breakpoint.
  const tfoot = document.createElement('tfoot');
  const footRow = document.createElement('tr');
  const footCell = document.createElement('td');
  // 7, not 6: the toolbar still needs to span the WHOLE row, and the row
  // is now 7 columns wide (Remove's own column, added this task -- see
  // `buildRow`'s own comment).
  footCell.colSpan = 7;
  footCell.appendChild(buildToolbar(t, handlers, getRoster));
  footRow.appendChild(footCell);
  tfoot.appendChild(footRow);
  table.appendChild(tfoot);

  container.appendChild(table);

  // Design spec section 4: "A permanent line under the table states the
  // consequence, whether or not anyone is marked... The count line then
  // reports it." Both are real <p> siblings AFTER </table> -- neither is
  // table content, so neither can live inside it -- which is also why
  // their own CSS (ClassroomGroupsPage.astro) is anchored on #cg-roster-count
  // and .cg-roster-consequence directly rather than on any #cg-roster
  // descendant selector.
  //
  // "Under the table" only ever means "once the table exists": this
  // whole branch is already gated on `roster.length > 0` (the empty-roster
  // early return, above), matching classroom-groups-roster.spec.ts's own
  // "the consequence line is there before anyone is marked" test, which
  // opens the roster (one student, present) rather than starting from a
  // wholly empty list.
  const consequence = document.createElement('p');
  consequence.className = 'cg-roster-consequence';
  consequence.textContent = t.rosterAbsentConsequence;
  container.appendChild(consequence);

  // `rosterCounts` (src/lib/roster.ts, unit-tested there) is the ONE place
  // "how many are absent" is computed -- the same function
  // updateStudentsHeader (classroom-groups.ts) already calls for the
  // collapsed header's own "· N absent" fragment, so the header and this
  // line can never disagree about the count. `here` is the one piece
  // neither that function nor this module had a name for yet: always
  // `roster.length - absent`, computed inline rather than promoted into
  // roster.ts's own pinned export list (tests/unit/roster.test.ts's "the
  // module surface" test) for a single subtraction with no branch of its
  // own to unit-test independently of `rosterCounts.absent`, which already
  // is.
  const countLine = document.createElement('p');
  countLine.id = 'cg-roster-count';
  countLine.className = 'cg-roster-count print-foot';
  const { absent } = rosterCounts(roster);
  // The PRINT-ONLY alternative, for the sheet with absent students dropped
  // -- design spec section 10: "The sheet says how many are absent so the
  // gap is never a mystery", because the remaining numbers jump (1, 2, 3, 5)
  // and an unexplained gap reads as a mistake. Built here beside the line it
  // replaces, from the SAME three counts, so the two can never disagree
  // about how many are absent.
  const hereLine = document.createElement('p');
  hereLine.className = 'cg-roster-count-here print-foot-here';
  hereLine.setAttribute('aria-hidden', 'true');
  hereLine.textContent = t.printHereToday({
    here: roster.length - absent,
    absent,
  });

  countLine.textContent = t.rosterCountLine({
    total: roster.length,
    here: roster.length - absent,
    absent,
  });
  container.append(countLine, hereLine);
}
