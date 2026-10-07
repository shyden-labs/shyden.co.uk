/**
 * English — the REFERENCE locale.
 *
 * Every other catalogue is typed `Catalogue`, which is derived from this
 * object, so a translation cannot be written with a key missing: a missing
 * translation must never degrade into an English sentence on another
 * language's page.
 *
 * A message that takes values is a TEMPLATE (#136): declared here with the
 * values its slots take -- `'Group {n}' as Message<{ n: number }>` -- and
 * written as plain prose with the same slots in every other catalogue. The
 * format is documented in `message.ts`. `getStrings` compiles templates into
 * functions, so a page calls `t.groupLabel({ n: 3 })` and formats nothing
 * itself.
 *
 * Types promise the shape; tests keep the rest: i18n.test.ts walks every
 * locale for missing keys, blank values and untranslated copy, and the message
 * guards hold every translation to the English template's slots. Treat this
 * file as a review surface.
 */

import type { Compiled, Message, Translatable } from './message';

export const en = {
  title: 'Classroom Group Creator',
  description:
    'Split your class into groups instantly — in your browser, with nothing sent anywhere.',
  heading: 'Classroom Group Creator',
  // The lead says WHO the tool is for and WHY it was built, not only what it
  // does. That paragraph was How to use's part 1 (design spec section 3) until
  // the operator swapped the two on 2026-09-30 (#384), so it is read before
  // anything is opened. Every locale swaps its own pair; the placement is
  // pinned per locale by classroom-groups-placement.test.ts.
  lead: 'Built for teachers, by Shyden. Splitting a class fairly takes time you do not have, and doing it by hand invites an argument about favourites. This does it in one press — free, with no sign-up, and with nothing about your class ever leaving your browser.',
  privacy:
    'Everything happens in your browser. No class list ever leaves this page.',

  howToHeading: 'How to use',
  // Part 1 of How to use says WHAT the tool does (the page's lead until #384).
  // Kept as one string in the locale file, never written across template
  // lines: whitespace between two nodes in the Astro template survives only
  // while they share a line, and prettier re-wraps long lines -- the seam
  // that has already shipped three broken sentences on this site (see
  // rendered-text.spec.ts).
  howToWhat:
    'Tell it how big your class is and how many students you want per group. It shuffles and deals everyone out, and no group ever ends up smaller than you asked for.',
  // Rewritten alongside `howToWhat` above: the old step 1 ("...or paste their
  // names, one per line") described the free-text names box removed when the
  // engine was rewritten to a numbered roster (see grouping.ts's
  // GroupingInput and classroom-groups.ts's own roster comment). Naming it
  // here rather than leaving it for the locale-sweep task, since this task's
  // own copy work already rewrites this exact array.
  howToSteps: [
    'Say how many students are in your class.',
    'Choose how to split them.',
    // Matches the button's own label (`makeGroups` below) capital-for-capital,
    // so an instruction to "press Make Groups" names exactly what is on screen.
    'Press Make Groups.',
  ],

  // `classHeading` ("Your class") and `groupsHeading` ("How to split
  // them") were the legends of the two `<fieldset>`s Stage 2 Tasks 1 and 5
  // shipped -- folded into one compact "Top row" by design spec section 3
  // (ClassroomGroupsPage.astro's own comment on `.top-row` has the
  // reasoning). Removed here rather than left unreferenced: once neither
  // `<legend>` renders, dead-copy.test.ts fails a defined string nothing
  // renders, and both would be exactly that. Every field underneath keeps
  // its own accessible name regardless -- a <label>, or for the two mode
  // radios the same `aria-labelledby="cg-mode-label"` pattern the naming
  // and leftovers radiogroups elsewhere on this page already use -- so
  // nothing loses a label; only the two purely organisational headings do.
  //
  // Design spec section 3's own top-row ordering: "Class (optional) ·
  // Students · Split by". Stage 2, Task 5. The literal "(optional)" is
  // pinned by the uncommitted #9 task brief's own test (`getByLabel('Class (optional)')`)
  // -- the field carries no `required`, no pattern and no `maxlength` to
  // match: design spec section 8 says plainly "Blank is fine and nothing is
  // blocked", and section 9 says the name a teacher types is never altered
  // anywhere it is shown.
  classLabel: 'Class (optional)',
  studentsLabel: 'Number of students',
  // Task 8, the locale sweep. Used to read "Leave the names box empty to
  // use numbered students." -- the paste-names box it described was removed
  // by Task 1's engine rewrite (see classroom-groups.spec.ts's own 'the
  // paste-names box and the keep-apart box are gone'), so this sentence had
  // been describing a control absent from the page since stage 2 began.
  // Rewritten to say what is true today: every student this field produces
  // is anonymous and numbered, the exact form `studentNumber` below renders
  // ("Student N"). Not a forward reference to Student details -- that
  // section's body is still empty (stage 3 fills it; see
  // ClassroomGroupsPage.astro's own comment on `#cg-students-body`), so a
  // sentence pointing a teacher there today would trade one broken promise
  // for another.
  studentsHelp:
    'Students are anonymous and numbered — Student 1, Student 2, and so on.',
  // Stage 3, Task 7 (design spec section 4, "The Students box — an input,
  // then a read-out"). The literal approved copy, verbatim: "Underneath it,
  // in every state, the reason is shown... Never a bare greyed-out box. A
  // disabled control that does not say why is a defect." Shown in place OF
  // `studentsHelp` above, never alongside it -- classroom-groups.ts's own
  // `updateStudentsBox` swaps one for the other, because `studentsHelp`
  // ("Students are anonymous and numbered") stops being true the moment a
  // roster can hold a real name, and showing a now-false claim beside the
  // real reason would be worse than showing neither.
  studentsLockedReason:
    'Set by your list. Add or remove students in Student details to change it.',

  // #188. Three fields beside the Students box, so a teacher can say "not
  // number 7 today", "keep 3 with 9" and "keep 2 away from 5" without
  // opening Student details and hand-building a row per pupil. The labels
  // are the operator's own, from the ticket's design block (2026-09-16).
  absentNumbersLabel: 'Student numbers',
  keepTogetherLabel: 'Keep together',
  keepApartLabel: 'Keep apart',
  // Two help lines, not one shared: the absent field takes a flat list and
  // the two pairing fields take SETS, which is a different thing to type.
  // One sentence covering both would have to describe a separator that does
  // not apply to the field it sits under.
  // "absent", never "away": the page keeps one word for this, and
  // classroom-groups-roster.spec.ts asserts `/\baway\b/` appears nowhere in
  // the body. This copy said "who are away" and turned that guard red.
  absentNumbersHelp:
    'The student numbers of anyone absent, separated by commas.',
  pairNumbersHelp:
    'A comma joins a pair; a semicolon starts another — 3,9; 14,15.',
  // AC14, mirroring `studentsLockedReason` above: the list and these fields
  // are never both in charge either, and a disabled control that does not
  // say why is a defect (design spec section 4).
  numbersLockedReason:
    'Set by your list. Mark absences and pairings in Student details to change them.',

  // Seven refusals, seven sentences. They name the SAME kind of mistake but
  // need different remedies, which is the reasoning the three size-limit
  // messages further down already follow: a teacher is told what to do, not
  // merely what is wrong. `text` is the offending text exactly as they typed
  // it (`NumberSetsProblem`, src/lib/numberSets.ts).
  numbersNotWholeMessage:
    '"{text}" is not a whole number. Type register numbers from 1 to {count}.' as Message<{
      text: string;
      count: number;
    }>,
  numbersAboveCountMessage:
    'There is no number {text}. You have {count} students.' as Message<{
      text: string;
      count: number;
    }>,
  // Separate from the one above because the remedy is different: this one
  // cannot be solved by changing the Students box, since the page itself
  // goes no higher.
  numbersAboveMaximumMessage:
    'There is no number {text}. This page goes up to {max} students.' as Message<{
      text: string;
      max: number;
    }>,
  numbersDuplicateMessage:
    'Number {text} is listed twice. Each number belongs in one place.' as Message<{
      text: string;
    }>,
  numbersLonelySetMessage:
    'A pair needs at least two numbers, and {text} is on its own.' as Message<{
      text: string;
    }>,
  numbersTooManySetsMessage:
    'That is more pairs than this page can hold. {text} is one too many.' as Message<{
      text: string;
    }>,
  // The count box is what is at fault here, not anything typed in these
  // fields, so the sentence points at the box rather than blaming the
  // numbers a teacher just wrote.
  numbersNoCountMessage: 'Fill in the number of students first.',

  // AC13. Shown under the results heading ONLY when fewer were grouped than
  // typed -- a teacher must never be left to notice a missing pupil by
  // counting. The heading itself is untouched (operator decision,
  // 2026-09-16): folding the ratio into it would have needed a second
  // variant of both the named and unnamed forms, which is the drift
  // `resultsHeadingText` exists to prevent.
  //
  // Built like `rosterGapWarning` below -- a `number[]` slot the platform
  // punctuates in the page's own language, with the plural branch on the
  // count of absentees, since a class can genuinely be missing exactly one.
  groupedNote:
    '{grouped} of {typed} grouped — {absent, plural, one {number {absent} is} other {numbers {absent} are}} absent.' as Message<{
      grouped: number;
      typed: number;
      absent: number[];
    }>,

  modeLabel: 'Split by',
  modePerGroup: 'Students per group',
  modeGroupCount: 'Number of groups',
  groupSizeLabel: 'Students in each group',
  groupCountLabel: 'How many groups',

  // Design spec section 6 ("Grouping by sex"), read by src/lib/sexOptions.ts
  // (`sexWhy`), the one function that decides why the two switches below
  // are disabled -- so its messages live together here rather than
  // scattered by call site. `sexWhyNoList` and `sexWhyUnset` are both
  // reachable and unit-tested against synthetic rosters today
  // (tests/unit/sexOptions.test.ts); only `sexWhyNoList` is reachable from
  // the page itself, because there is no roster until stage 3 -- see
  // ClassroomGroupsPage.astro's own comment on `#cg-students-body`.
  sexMixLabel: 'Mix boys and girls evenly',
  sexSeparateLabel: 'Keep boys and girls separate',
  sexWhyNoList:
    'Add your students in Student details and set M or F for each to use these.',
  // The literal approved copy (design spec section 6) at unset=3,
  // grouped=22. Branches "has"/"have" and "student"/"students" for
  // grammaticality at the edges -- id.ts needs neither branch: Bahasa
  // Indonesia does not inflect for plural (see every sibling comment on
  // this in this file's own `errors` table).
  sexWhyUnset:
    '{unset} of the {grouped} {grouped, plural, one {student} other {students}} being grouped {unset, plural, one {has} other {have}} no sex set. Open Student details and set M or F for them to use these.' as Message<{
      unset: number;
      grouped: number;
    }>,
  // Design spec sections 6 and 13, the third message: for the moment
  // un-ticking ONE student's absence is what closes the switches. Read by
  // `sexWhyReturning` (src/lib/sexOptions.ts) -- see that function's own
  // doc comment for why it takes two rosters rather than a control name,
  // and why it defers to `sexWhyUnset` above whenever two students return
  // together or the switches were already shut. `who` arrives already
  // labelled (a typed name, or "Student 7"), never a raw field, so this
  // string is the same shape in both locales and neither has to know the
  // fallback rule.
  sexWhyReturning:
    '{who} is back and has no sex set. These options need one for every student being grouped.' as Message<{
      who: string;
    }>,

  leftoversLabel: 'If students are left over',
  leftoversSpread: 'Share them out evenly',
  leftoversBunch: 'Put them all in one group',
  leftoversHelp:
    'Either way, no group is ever smaller than the size you chose.',

  soundOn: 'Sound on',
  soundOff: 'Sound off',
  speedLabel: 'Speed',
  speedNormal: 'Normal',
  speedFast: 'Fast',
  speedSkip: 'Skip the animation',

  // The tool's four collapsible sections (design spec section 3), in the
  // spec's own order: Student details, Grouping options, Import / export,
  // Sound & animation (Stage 2, Task 7 -- see ClassroomGroupsPage.astro's
  // own comment on the restructuring that gave it a real section, folding
  // in what used to be a plain fieldset here under `playbackHeading`).
  // Sound & animation carries no `· state` half of its own -- see
  // sections.ts's own doc comment on why `sectionState` returns three
  // fields, not four -- so this is the whole button label for that one,
  // with nothing to join it to.
  sectionStudentsHeading: 'Student details',
  sectionGroupingHeading: 'Grouping options',
  sectionImportExportHeading: 'Import / export',
  sectionSoundHeading: 'Sound and animation',

  // Stage 3, Task 2. The roster table (src/scripts/roster-ui.ts) -- column
  // headers, doubling as each cell's own aria-label so the header a sighted
  // teacher reads and the name a screen reader announces for that column's
  // control are the same word, never two independent spellings. Order
  // matches design spec section 3's own six columns, and the literal test
  // that pins it (classroom-groups-roster.spec.ts, "the table has the six
  // columns, in order"). `rosterColNumber` stays the bare glyph "#" in both
  // languages -- it is a symbol, not English, so it needs no translation
  // (see i18n.test.ts's own ALLOWED_IDENTICAL for why this is expected, not
  // an oversight).
  rosterColNumber: '#',
  rosterColName: 'Name',
  rosterColSex: 'Sex',
  rosterColAbsent: 'Absent',
  rosterColTogether: 'Together',
  rosterColApart: 'Apart',
  // The first option in every Sex/Together/Apart <select> -- "blank
  // (neutral)" for sex, "no letter" for the two constraints (design spec
  // section 4). One shared symbol for "nothing chosen" rather than three
  // separate sentences, and -- like `rosterColNumber` above -- punctuation,
  // not English, so it is the same character in both languages.
  rosterUnset: '—',
  // The <option> VALUE stays the fixed 'M'/'F' the engine's own Student.sex
  // type uses (grouping.ts) in both languages -- identity a locale must
  // never change -- only the DISPLAYED text varies; id.ts uses "L"/"P",
  // matching design spec section 9's own Indonesian sex convention (already
  // established there for CSV, and carried into this table for the same
  // reason: a Bahasa Indonesia reader should not have to learn an English
  // abbreviation to read this column).
  rosterSexMale: 'M',
  rosterSexFemale: 'F',
  // Design spec section 4, "Changing the class size is then a list
  // operation": the two ways a row is added, and the inline confirm for the
  // second. The literal leading "+" is the spec's own wording -- kept as
  // real button text, not CSS-generated content, since a pseudo-element's
  // own text is inconsistently exposed to assistive tech, and helpers.ts's
  // `openRoster`/`addSeveral` read these from the page's own catalogue and
  // match them exactly, "+" included.
  rosterAddStudent: '+ Add student',
  rosterAddSeveral: '+ Add several…',
  // The inline count field's own label, and the button that confirms it.
  // `rosterAddConfirm` is matched EXACTLY (`{ name: 'Add', exact: true }`)
  // by later stages' own tests, precisely so it is never mistaken for
  // `rosterAddStudent` above, whose text also contains the word "Add".
  rosterHowMany: 'How many to add?',
  rosterAddConfirm: 'Add',

  // Stage 3, Task 4 (design spec section 4, "Absence"). Two lines rendered
  // "under the table" by renderRoster (roster-ui.ts) once the roster is
  // non-empty -- NOT part of the `state*` group below, which feeds only the
  // collapsed Student-details HEADER (sectionState); these feed the table's
  // own footer instead, so they live with the rest of this `roster*` group.
  //
  // `rosterAbsentPill` is the pill text beside the tick -- lowercase, the
  // design doc's own literal example ("a small pill reading `absent`") --
  // distinct from `rosterColAbsent` above, the column HEADING, which is
  // capitalised.
  rosterAbsentPill: 'absent',
  // The permanent consequence line: present "whether or not anyone is
  // marked" (design spec section 4), so a plain string, not a function --
  // nothing about it varies with the roster's own state. The literal
  // approved wording, verbatim.
  rosterAbsentConsequence:
    'Students marked absent are not included when groups are made.',
  // The live count line underneath it -- design spec section 4's own
  // example: "24 students · 22 here · 2 absent". English inflects
  // (`resultsSummary`'s own identical reasoning, above) for the leading
  // noun; "here"/"absent" are used predicatively and never pluralise, the
  // same as `stateAbsent`/`stateTogether` below never branch on their own
  // count.
  rosterCountLine:
    '{total} {total, plural, one {student} other {students}} · {here} here · {absent} absent' as Message<{
      total: number;
      here: number;
      absent: number;
    }>,

  // Stage 3, Task 5 (design spec section 4). Both are BLOCKING --
  // rosterProblems (src/lib/roster.ts) is what "Make groups" is disabled
  // on -- and both mirror a refusal the ENGINE already makes on the exact
  // same data (ERROR_CODES.duplicateNumber / .togetherApartClash above),
  // just caught one keystroke earlier and phrased for the moment of typing
  // rather than the moment of shuffling: this one names WHO already holds
  // the number, which DUPLICATE_NUMBER above cannot -- the engine has no
  // roster to resolve a name from. The approved copy (the uncommitted #9 task brief,
  // verbatim) is a fixed two-part sentence with no singular/plural branch,
  // because a duplicate always names exactly one prior holder.
  rosterDuplicateMessage:
    'Number {number} is already used by {name}. Every student needs their own.' as Message<{
      number: number;
      name: string;
    }>,
  // Sex is required for every student (operator, 2026-08-13). Phrased like
  // every other roster refusal on this page: it names WHO, and what to do.
  rosterNoSexMessage:
    '{names} still {names, plural, one {needs} other {need}} M or F. Every student needs one before you can make groups.' as Message<{
      names: string[];
    }>,
  // `names` arrives pre-resolved (rosterProblems), the same "the caller
  // resolves numbers to labels" contract TOGETHER_APART_CLASH above already
  // keeps. The two sentences are deliberately different wording (this one
  // is written for the moment of typing, see the comment above); the list
  // inside both is punctuated by the platform, in the page's language
  // (#136). `names.length` is always >= 2 by construction -- a clash needs
  // at least two holders of the same apart-letter within one together-block
  // -- so, like TOGETHER_APART_CLASH, this never branches for singular/plural.
  rosterClashMessage:
    '{names} are kept together, so they cannot also be kept apart.' as Message<{
      names: string[];
    }>,
  // Design spec section 4, "Numbers": "A gap raises a non-blocking warning:
  // the class list appears to be incomplete, check it by opening Student
  // details." NON-blocking -- rosterWarnings (src/lib/roster.ts) never
  // reaches the goButton.disabled check rosterProblems above does. Branches
  // singular/plural (English inflects, same reasoning as every other
  // counted message in this file) since a roster can genuinely be missing
  // exactly one number.
  rosterGapWarning:
    'Your class list looks incomplete. {missing, plural, one {Number {missing} is} other {Numbers {missing} are}} missing. That is fine if those children have left — open Student details to check.' as Message<{
      missing: number[];
    }>,

  // Stage 3, Task 6 (design spec section 4, "Two size limits, not one").
  // Three refusals, three sentences, deliberately NOT sharing one message:
  // each names the SAME limit but a DIFFERENT remedy, because a different
  // fact is true in each case.
  //
  // `rosterOpenRefusedMessage` — the approved copy (design spec section 4)
  // verbatim: "the section refuses to open and says why... Lower the
  // number to list this class individually" is the only remedy that makes
  // sense here, because there is no list yet, only a count.
  rosterOpenRefusedMessage:
    'Student details holds up to {max} students. Lower the number to list this class individually.' as Message<{
      max: number;
    }>,
  // `rosterAtLimitMessage` — a LIST already exists and already holds the
  // maximum, so "lower the number" is not even a control on screen at this
  // point (design spec section 4's own "the moment a list exists, the box
  // becomes a read-out"); the only way out is to remove somebody first.
  // Shares its OPENING clause with `rosterOpenRefusedMessage` above
  // (deliberately — both name the same fact) but never its remedy.
  rosterAtLimitMessage:
    'Student details holds up to {max} students. Remove a student to add another.' as Message<{
      max: number;
    }>,
  // `rosterRoomMessage` — "+ Add several…" refusing a batch that would
  // cross the ceiling even from under it, naming exactly how many rows are
  // free rather than the ceiling itself (the teacher already knows how
  // many they asked for; what they need is how many will actually fit).
  // English inflects (this file's established convention, e.g.
  // `rosterCountLine`) for exactly one free row.
  rosterRoomMessage:
    'There is room for {room} more {room, plural, one {student} other {students}}.' as Message<{
      room: number;
    }>,
  // The per-row "Remove" button (design spec section 4: "Removing a row
  // removes the student"). Matched EXACTLY the same way `rosterAddConfirm`
  // already is by later tests, scoped to one `.cg-student` row at a time —
  // every row carries the identical word, and the row itself is what
  // disambiguates which button a test means, the same way `row.getByLabel
  // ('Name')` already does for a field every row also has.
  rosterRemove: 'Remove',
  // Stage 3, Task 7 (design spec section 4, "Emptying the list"). The one
  // way a teacher empties a roster in one action rather than removing every
  // row by hand -- returns #cg-count to being typeable again, keeping the
  // number it was last reporting (see `studentsLockedReason`, above, and
  // `updateStudentsBox`, classroom-groups.ts). Only ever rendered once
  // there is something to clear -- see `buildToolbar`'s own comment,
  // roster-ui.ts.
  rosterClearAll: 'Clear all',

  // Every value below is read ONLY through sectionState (src/lib/sections.ts)
  // -- never interpolated into a page directly -- so a key here with no
  // matching branch in that function, or a branch reading a key missing
  // here, is exactly the drift the whole function exists to prevent. Order
  // matches the design doc's own progression: none -> named -> +absent ->
  // +letters, mirrored exactly by sections.test.ts.
  stateNoneAdded: 'none added',
  stateNamed: '{n} named' as Message<{ n: number }>,
  stateAbsent: '{n} absent' as Message<{ n: number }>,
  stateTogether: '{n} together' as Message<{ n: number }>,
  stateApart: '{n} apart' as Message<{ n: number }>,
  // The roster exists but nothing else is true of it yet: everyone present,
  // nobody named, no letters set. Distinct from `stateNoneAdded` (no roster
  // at all) -- see sections.ts's own fallback branch.
  stateAdded: '{n} added' as Message<{ n: number }>,
  stateNone: 'none',
  stateMixed: 'mixed by sex',
  stateSeparated: 'separated by sex',
  stateBunched: 'leftovers in one group',
  stateNothingToSave: 'nothing to save yet',
  stateUnsaved: 'unsaved changes — export to keep them',

  makeGroups: 'Make Groups',
  again: 'Shuffle again',
  needsJs: 'This tool needs JavaScript enabled.',

  resultsHeading: 'Your groups',
  // Heads the results when a class name was given (design spec section 8's
  // own literal example: "7B — your groups"). The tail stays lowercase
  // because it continues the sentence the class name started, unlike
  // `resultsHeading` above -- which IS the whole sentence on its own, and is
  // therefore capitalised. Composed against the class name exactly as
  // typed, never trimmed here: see resultsHeadingText's own doc comment
  // (src/lib/i18n/index.ts) for where the two are combined, and why.
  resultsHeadingNamed: '{className} — your groups' as Message<{
    className: string;
  }>,
  // English inflects; the tool's own headline case (7 students in groups of
  // 4 is ONE group of 7) hits the singular every time.
  resultsSummary:
    '{groups} {groups, plural, one {group} other {groups}} from {students} {students, plural, one {student} other {students}}.' as Message<{
      groups: number;
      students: number;
    }>,
  groupLabel: 'Group {n}' as Message<{ n: number }>,
  studentNumber: 'Student {n}' as Message<{ n: number }>,

  // Design spec section 8, "When the class changes after a shuffle". Each
  // reason names WHAT changed, not merely that something did -- "These
  // groups are out of date" alone sends a teacher hunting for what they
  // touched. staleReason (src/lib/staleness.ts) picks exactly one of these
  // per recompute, in a fixed priority order, so two things changing at
  // once still reads as ONE clear sentence, not a list.
  staleMode: 'These groups are out of date — the group size changed.',
  staleLeftovers:
    'These groups are out of date — the leftovers choice changed.',
  // Unreachable from this page today: the two sex switches render (Stage 2,
  // Task 4) but stay permanently disabled until stage 3 gives them a
  // roster to enable on -- see classroom-groups.ts's own `readSexMode`.
  // Defined now, not left for stage 3, because Snapshot's shape (and
  // staleReason's own branch) already exist -- see that interface's own
  // doc comment for why a comparison, not a flag, is what lets a later
  // stage add a trigger by filling in a field rather than hunting down
  // every place that could clear one.
  staleSexMode:
    'These groups are out of date — how boys and girls are grouped changed.',
  // Unreachable from this page today: `roster` stays '' on both sides of
  // every comparison until stage 3 builds a real roster to summarise (see
  // Snapshot's own doc comment). Generic, not per-student ("Dewi is now
  // marked absent") -- Snapshot compares ONE string, so it can only say a
  // roster changed, not which fact about it did; stage 3's own roster work
  // owns deciding whether a finer-grained comparison is worth building.
  staleRoster: 'These groups are out of date — the class list changed.',

  // ── CSV import/export (design spec section 9) ───────────────────────────
  //
  // Stage 4. Every refusal is written in the language of the PAGE, never of
  // the file, and names the tokens THAT page accepts -- telling an
  // Indonesian teacher to "use M, F" is advice that would fail again. The
  // accepted tokens are therefore passed IN, from CSV_LOCALES
  // (src/lib/csv-locale.ts), rather than written here a second time: two
  // copies of the same token list is how the parser and the message it
  // prints come to disagree.
  //
  // Row numbers count DATA rows, not file lines, so a `#` comment sitting
  // between two students never shifts the row a teacher is sent to.
  csvProblemEmptyFile: 'This file is empty.',
  // The file could not be READ at all -- moved, renamed or re-saved between
  // the picker and the read, or a cloud file that failed to materialise.
  // Distinct from every problem below it, which are about a file that WAS
  // read and could not be understood.
  csvProblemUnreadable: 'That file could not be read. Try choosing it again.',
  csvProblemNoNumberColumn:
    'This file has no number column. Every student needs one.',
  csvProblemNumberBlank:
    'Row {row} — number is blank. Every student needs one.' as Message<{
      row: number;
    }>,
  csvProblemNumberNotWhole:
    "Row {row} — number '{value}' is not a whole number." as Message<{
      row: number;
      value: string;
    }>,
  csvProblemDuplicateNumber:
    'Row {row} — number {value} is already used by row {firstRow}.' as Message<{
      row: number;
      value: number;
      firstRow: number;
    }>,
  csvProblemSex:
    "Row {row} — sex '{value}' not understood. Use {accepted}, or leave blank." as Message<{
      row: number;
      value: string;
      accepted: string;
    }>,
  csvProblemAbsent:
    "Row {row} — absent '{value}' not understood. Use {accepted}, or leave blank." as Message<{
      row: number;
      value: string;
      accepted: string;
    }>,
  csvProblemLetter:
    "Row {row} — {column} '{value}' is not a single letter." as Message<{
      row: number;
      column: string;
      value: string;
    }>,
  csvProblemTooMany:
    'This file has {found} students. Student details holds up to {max}.' as Message<{
      found: number;
      max: number;
    }>,
  // Design spec section 9's own approved refusal, verbatim. The LANGUAGE
  // NAMES are parameters rather than baked in, so this one sentence serves
  // however many locales the site grows: `csvLanguageName` below is what
  // each locale calls the OTHER language, in its own words.
  csvWrongLanguage:
    'This looks like a {language} class list. Open the {version} version of this page to import it.' as Message<{
      language: string;
      version: string;
    }>,
  // How this locale names each language, for the sentence above. Written
  // as English speakers write them: "Bahasa Indonesia" is the endonym in
  // ordinary English use, and the design spec's own approved copy uses it.
  //
  // All five MVP locales, because `csvLanguageName[found]` is indexed by the
  // locale the parser DETECTED: a map missing a language cannot name the file
  // a teacher just chose. `Bahasa Indonesia` stays the endonym because that is
  // ordinary English usage and the design spec's approved copy uses it; for
  // the other three, ordinary English is the exonym.
  csvLanguageName: {
    en: 'English',
    id: 'Bahasa Indonesia',
    zh: 'Chinese',
    vi: 'Vietnamese',
    th: 'Thai',
  },
  csvLanguageVersion: {
    en: 'English',
    id: 'Indonesian',
    zh: 'Chinese',
    vi: 'Vietnamese',
    th: 'Thai',
  },

  // ── The Import/export section's own controls (stage 4, Task 5) ──────────
  //
  // Design spec section 9. `ioReplaceWarning` names BOTH counts because the
  // spec is explicit that the warning says "how much of it was filled in by
  // hand" -- a teacher who typed thirty names needs to know that is what is
  // about to go, and "30 students" alone does not say it. It fires even when
  // the counts match, because the same count can be a completely different
  // class.
  ioExportClassList: 'Export class list',
  ioExportGroups: 'Export groups',
  ioDownloadTemplate: 'Download template',
  ioImportLabel: 'Import a class list',
  ioProblemsHeading: 'This file was not imported:',
  ioReplaceWarning:
    'This will replace your current class list — {total} {total, plural, one {student} other {students}}, {named} named.' as Message<{
      total: number;
      named: number;
    }>,
  ioReplaceConfirm: 'Replace it',
  ioReplaceCancel: 'Keep what I have',
  ioImported:
    'Imported {total} {total, plural, one {student} other {students}}.' as Message<{
      total: number;
    }>,

  // ── The two-language handover (stage 4, Task 6; design spec section 9) ──
  //
  // The roster crosses between tabs IN MEMORY, over a BroadcastChannel.
  // sessionStorage was rejected: it writes children's names into
  // browser-managed storage for the length of a page load, which can
  // survive a crash on a shared classroom machine. A URL is worse -- that
  // is the exact defect closed as C1 in PR #8.
  ioBothLanguages: 'Also export in another language',
  ioBothLanguagesHint:
    'Your file saves now, in this language. A second tab opens in the language you pick, with the same class list, for you to check and save there. Nothing is stored and nothing is sent anywhere.',
  ioHandoverBlocked:
    'The second tab could not be opened. Your class list is still here — allow pop-ups and try again.',
  ioHandoverTimedOut:
    'The second tab never asked for the class list. Your class list is still here — close that tab and try again.',
  // The receiver's own side of the same failure. Without it a tab that
  // loaded too slowly to be answered sat there looking like an ordinary
  // empty tool page, while the failure was reported in the OTHER tab -- the
  // one the teacher had just been taken away from.
  ioHandoverNotOffered:
    'No class list arrived. Go back to the other tab and try again.',
  // Takes the language it opened, because there is no longer "the other"
  // one to point at -- the teacher picked from a list. The NATIVE name is
  // what goes in (`LOCALE_METADATA.nativeName`, the same label the button
  // they just pressed carried): a teacher who chose 中文 is looking for
  // 中文 in the confirmation, not for the English word "Chinese".
  ioHandoverSent: 'Your class list is now open in {language}.' as Message<{
    language: string;
  }>,

  // ── The print panel (stage 5; design spec section 10) ───────────────────
  //
  // A panel rather than a bare button: "the teacher decides what goes on
  // the paper -- the operator was explicit that this is theirs to choose,
  // not ours to fix."
  //
  // The two class-list tick boxes are INDEPENDENT, which is why they are
  // tick boxes rather than three named sheets: all four combinations are
  // reachable, including "only who is here, with the letters" -- a
  // combination named sheets could not express.
  printOpen: 'Print',
  printHeading: 'Print',
  printWhat: 'What to print',
  printWhatClassList: 'Class list',
  printWhatGroups: 'Group results',
  printWhatBoth: 'Both',
  printOnTheClassList: 'On the class list',
  printShowAbsent: 'Show students who are absent',
  printShowLetters: 'Show sex and the together/apart letters',
  printIncludeAvatars: 'Include avatars',
  printCancel: 'Cancel',
  printConfirm: 'Print',
  // The sheet's own two headings and its date line. `printedOn` takes the
  // date as a parameter so it comes from stage 4's `todayISO` -- the sheet
  // and the exported file can never describe the same shuffle with two
  // date formats.
  printClassListHeading: 'Class list',
  printGroupsHeading: 'Groups',
  printedOn: 'Printed {on}' as Message<{ on: string }>,
  // Design spec section 10: with absent students dropped, "the sheet says
  // how many are absent so the gap is never a mystery" -- because the
  // remaining numbers then jump (1, 2, 3, 5) and an unexplained gap reads
  // as a mistake.
  printHereToday:
    '{here} {here, plural, one {student} other {students}} here today · {absent} absent' as Message<{
      here: number;
      absent: number;
    }>,

  // ── The projector view (stage 5; design spec section 10's board) ────────
  //
  // The groups, on the wall, for the class to read. The overlay MOVES the
  // results element rather than re-rendering it, so what is on the board
  // and what is on the page are the same DOM and cannot disagree -- see
  // projector.ts's own doc comment.
  boardOpen: 'Full screen',
  boardExit: 'Exit full screen',
  // Named for what it does here, not for the button it mirrors: on the
  // board this is the only control besides Exit, and "Shuffle again" is
  // what the results section already calls it.
  boardShuffle: 'Shuffle again',

  // Design spec section 8's rule, applied at the three places groups LEAVE
  // the screen. Three separate sentences, not one: each names the thing the
  // teacher was about to do, and a teacher told "shuffle again before
  // saving them" when they pressed Print has been given someone else's
  // message.
  staleRefuseExport:
    'These groups are out of date. Shuffle again before saving them.',
  staleRefusePrint:
    'These groups are out of date. Shuffle again before printing them.',
  staleRefuseBoard:
    'These groups are out of date. Shuffle again before showing them.',

  errors: {
    // Whole-branch review, I-4. `noStudents` fires from TWO different
    // triggers in grouping.ts -- an empty roster (no count, no names) and a
    // non-empty roster where every single student is marked absent -- and
    // carries no data to tell them apart (see the call sites' own comments
    // for why that collapse was deliberate). The old copy ("Add some
    // students first...") was only ever checked against the first trigger;
    // a 30-student roster with everyone unticked got told to add students
    // it already had. This wording is true for both: "add some" fixes an
    // empty roster, "make sure at least one ... is not marked absent" fixes
    // the second trigger, and neither clause claims the other's problem is
    // also present -- same "either/or, only one need apply" shape the rest
    // of this file's multi-remedy copy already uses (see
    // BOTH_RULES_NO_ARRANGEMENT below, for one).
    NO_STUDENTS:
      'Add some students, or make sure at least one of them is not marked absent.',
    TOO_MANY_STUDENTS:
      'That is more students than this tool will take. The most is {max}.' as Message<{
        max: number;
      }>,
    DUPLICATE_NUMBER:
      'Student number {number} is used twice. Give each student their own number.' as Message<{
        number: number;
      }>,
    INVALID_GROUP_SIZE: 'Each group needs at least 1 student.',
    INVALID_GROUP_COUNT: 'You need at least 1 group.',
    TOO_MANY_GROUPS:
      'There are not enough students for that many groups. The most you can have is {max}.' as Message<{
        max: number;
      }>,
    // Carries `students: number[]`, never names -- identity is the number
    // (Student.number). Same resolver pattern as KEEP_APART_IMPOSSIBLE below:
    // renderError maps each number through `resolveStudent` before this
    // function ever sees it, so `names` here is already display text.
    TOGETHER_APART_CLASH:
      '{names} are marked to stay together and to be kept apart from each other at the same time. Remove the together letter or the apart letter from one of them.' as Message<{
        names: string[];
      }>,
    TOGETHER_UNIT_TOO_LARGE:
      'The letter "{letter}" has {unit} students, but the largest group here only holds {groupSize}. Make the groups bigger, or give the letter "{letter}" to fewer students.' as Message<{
        letter: string;
        unit: number;
        groupSize: number;
      }>,
    // Says only what an exhaustive search proved: not that any particular
    // letter is the problem, just that this many groups cannot hold every
    // together-unit whole. The remedy is the opposite of KEEP_APART's: more
    // groups makes a together clash WORSE, never better, so this never
    // suggests it.
    TOGETHER_NO_ARRANGEMENT:
      'There is no way to fit your class into {groupsTried} {groupsTried, plural, one {group} other {groups}} while keeping everyone together who needs to be. Make the groups bigger, or give each letter to fewer students.' as Message<{
        groupsTried: number;
      }>,
    // Claims nothing at all, because nothing was established.
    TOGETHER_SEARCH_GAVE_UP:
      'There are too many together-letters here to work through. Try using fewer letters, or make the groups bigger.',
    KEEP_APART_IMPOSSIBLE:
      '{names} all need to be kept apart from each other, so you would need at least {groupsNeeded} groups. Either make more groups or remove one of the rules.' as Message<{
        names: string[];
        groupsNeeded: number;
      }>,
    // Says only what an exhaustive search proved: not that any particular
    // students conflict, just that this many groups cannot hold them all.
    KEEP_APART_NO_ARRANGEMENT:
      'There is no way to fit your class into {groupsTried} {groupsTried, plural, one {group} other {groups}} while keeping everyone apart who needs to be. Either make more groups or remove one of the rules.' as Message<{
        groupsTried: number;
      }>,
    // Claims nothing at all, because nothing was established.
    KEEP_APART_SEARCH_GAVE_UP:
      'There are too many keep-apart rules here to work through. Try removing some of them.',
    // Together and keep-apart clashes have OPPOSITE remedies (bigger groups
    // helps one and hurts the other; more groups is the reverse), and when
    // both kinds of rule are live the search genuinely cannot say which one
    // is the actual sticking point -- only that no arrangement was found.
    // Guessing would send the teacher the wrong way as often as the right
    // one, so this names both rules and offers both remedies without
    // choosing between them.
    BOTH_RULES_NO_ARRANGEMENT:
      'There is no way to fit your class into {groupsTried} {groupsTried, plural, one {group} other {groups}} while satisfying every together-letter and every apart-letter at once. The search cannot tell which kind of rule is the problem, so try either remedy: make the groups bigger or give a together-letter to fewer students, or make more groups or remove one of the apart-rules.' as Message<{
        groupsTried: number;
      }>,
    // Claims nothing at all, because nothing was established -- and, same
    // reasoning as above, does not guess which kind of rule to blame.
    BOTH_RULES_SEARCH_GAVE_UP:
      'There are too many together- and apart-letters here to work through at once. Try using fewer letters of either kind, or make the groups bigger.',
    // Task 7. Carries `students: number[]`, never names -- same resolver
    // pattern as TOGETHER_APART_CLASH and KEEP_APART_IMPOSSIBLE above:
    // renderError maps each number through `resolveStudent` before this
    // function ever sees it. This code should be unreachable from the page
    // (stage 2 disables the mix switch until every student being grouped
    // has a sex set), but the engine does not trust its caller, so the
    // copy is written for a teacher, not for a developer. `names.length`
    // can genuinely be 1 (the guard reports every unset student, and a
    // roster can have exactly one), unlike the two codes above whose lists
    // are always 2 or more by construction -- so, like TOO_MANY_GROUPS and
    // the together/keep-apart "no arrangement" messages, this branches for
    // singular/plural rather than assuming a list.
    SEX_NEEDS_ALL_SET:
      '{names} {names, plural, one {has} other {have}} no sex set, so this mode cannot run until every student does. Set a sex for {names, plural, one {them} other {each of them}}, or turn it off.' as Message<{
        names: string[];
      }>,
    // Task 8b. Carries `students: number[]`, never names -- same resolver
    // pattern as TOGETHER_APART_CLASH above. `names.length` is always >= 2
    // by construction (a together-unit spanning both sexes needs at least
    // one of each), so, like TOGETHER_APART_CLASH and KEEP_APART_IMPOSSIBLE,
    // this never branches for singular/plural. Stays abstract at "sex"
    // rather than naming "boys"/"girls" -- same choice as SEX_NEEDS_ALL_SET
    // above, its closer sibling (both are guard-style refusals about the
    // `sex` field itself, not about a group a teacher is looking at, unlike
    // SEX_SPILLOVER).
    SEX_SEPARATE_SPLITS_UNIT:
      '{names} are marked to stay together, but are not all the same sex, so they cannot form a single-sex group. Remove the together letter from one of them, or turn this mode off.' as Message<{
        names: string[];
      }>,
    // Fix round 1, F-2. Carries `groupsRequested: number` -- the number the
    // TEACHER typed, never a side's own smaller allocation (see the doc
    // comment on ERROR_CODES.sexSeparateImpossible for the defect that
    // substitution was). Reached only once every way of splitting that
    // number between boys and girls has been tried and EXHAUSTED -- see
    // SEX_SEPARATE_SEARCH_GAVE_UP directly below for the sibling that fires
    // when at least one of those tries never got that far -- so, like
    // BOTH_RULES_NO_ARRANGEMENT, this does not guess which rule is to
    // blame -- it names neither a rule nor a side, only the two remedies.
    // Branches for singular/plural even though this code cannot currently
    // fire with `groupsRequested === 1` (the search only runs at
    // `groupsRequested >= 2` -- see `allocationCandidates`) -- same
    // defensive choice this file already makes for TOGETHER_NO_ARRANGEMENT/
    // KEEP_APART_NO_ARRANGEMENT/BOTH_RULES_NO_ARRANGEMENT's own
    // `groupsTried`, which are equally unreachable at 1 in practice and
    // still branch, rather than SEX_SEPARATE_SPLITS_UNIT's
    // `names.length >= 2`, which is provable by TYPE/construction rather
    // than by a runtime argument about when the engine happens to call
    // this.
    //
    // Whole-branch review, I-1: used to say "ask for MORE groups" -- a
    // specific direction, which TOGETHER_NO_ARRANGEMENT's own comment above
    // warns against for exactly this reason (more groups makes a together
    // clash worse, never better). Unlike TOGETHER_NO_ARRANGEMENT and
    // KEEP_APART_NO_ARRANGEMENT, each of which knows its OWN rule's fix
    // direction is always the same, this code is reached after every
    // candidate split has already failed for a mix of reasons this search
    // never isolates -- one candidate can fail on a together-unit too large
    // for its side (fixed by FEWER groups), another on a keep-apart clique
    // (fixed by MORE) -- so "more" is not even usually right, let alone
    // always: measured, 10 boys (6 bound by one together-letter) plus 2
    // girls needed FEWER groups, not more (counts 2-3 succeeded, 4-6 all
    // refused while telling the teacher to ask for more). "A different
    // number" makes no claim about which direction, because the search has
    // not earned one -- honest in the same spirit as this code's own
    // groupsRequested (see ERROR_CODES.sexSeparateImpossible's doc comment
    // in grouping.ts), just about a direction instead of a number.
    SEX_SEPARATE_IMPOSSIBLE:
      'Boys and girls cannot be kept in separate groups across {groupsRequested} {groupsRequested, plural, one {group} other {groups}} while also satisfying your other rules. The search cannot tell which rule is the problem, so try either remedy: ask for a different number of groups, or turn this mode off.' as Message<{
        groupsRequested: number;
      }>,
    // Fix round 2. Claims nothing at all, same reasoning as
    // TOGETHER_SEARCH_GAVE_UP/KEEP_APART_SEARCH_GAVE_UP/
    // BOTH_RULES_SEARCH_GAVE_UP above -- carries no data because nothing
    // was established, not even which of the tried splits was "the" one
    // that ran out of room. Unlike those three, the remedy here names
    // TURNING THE MODE OFF alongside using fewer letters: together- and
    // apart-letters have no on/off switch of their own to offer, but
    // `sexMode` genuinely does, and it is a real way out of a search this
    // large -- see ERROR_CODES.sexSeparateSearchGaveUp's doc comment for
    // why this is reported instead of SEX_SEPARATE_IMPOSSIBLE whenever even
    // one of the tried splits gave up rather than being exhausted.
    SEX_SEPARATE_SEARCH_GAVE_UP:
      'There are too many together- and apart-letters here to work through while also keeping boys and girls in separate groups. Try using fewer letters, or turn this mode off.',
    // Task 9. Carries `students: number[]`, never names -- same resolver
    // pattern as TOGETHER_APART_CLASH above. Always >= 2 by construction: at
    // least one student locked inside the pinned group and one outside it,
    // sharing the together letter that straddles the boundary.
    PINNED_SPLITS_UNIT:
      '{names} are marked to stay together, but only some of them are in a pinned group. Unpin the group, or remove the together letter from whoever is outside it.' as Message<{
        names: string[];
      }>,
    // Task 9. Carries `students: number[]`, never names -- same resolver
    // pattern. Always >= 2 by construction: an apart-letter needs at least
    // two holders, and this only fires when both are in the SAME pinned
    // group.
    PINNED_APART_CLASH:
      '{names} are marked to be kept apart from each other, but a pinned group puts them in the same one. Unpin the group, or remove the apart letter from one of them.' as Message<{
        names: string[];
      }>,
    // Task 9. Carries a single resolved name, not a list -- `number: number`
    // on the error (like DUPLICATE_NUMBER) always names exactly one student,
    // never a pair, so there is no second party for this sentence to name
    // and no plural form to branch for.
    PINNED_IN_TWO_GROUPS:
      '{name} is pinned into two different groups at once. A student can only be pinned into one group. Remove them from one of the two.' as Message<{
        name: string;
      }>,
    // Fix round 1, F-1/F-2. Replaces TOO_MANY_GROUPS on the pinned path --
    // see ERROR_CODES.pinnedTooManyGroups's doc comment in grouping.ts. The
    // old sentence here (still TOO_MANY_GROUPS at the time) named a `max`
    // that, under `groupCount` mode, was ALWAYS the exact number the
    // teacher had just typed -- a tautology, not a fix (F-2) -- and did not
    // exist at all for the opposite direction, where MORE pool groups were
    // asked for than pool students remain to fill them (F-1).
    //
    // Fix round 2. A third direction the two-way branch below did not
    // cover: the pins can claim MORE groups than were requested
    // (`pinnedGroupCount > requestedGroups`) while pool students still
    // remain -- pin three groups, then lower the count field to two. That
    // used to fall into the `poolGroupsNeeded <= 0` branch below and reuse
    // its "fill X of the Y groups" opening, which only reads coherently
    // when X <= Y -- producing "Your pins already fill 3 of the 2 groups
    // you asked for". Split off as its own branch, checked first, with its
    // own opening ("already use N groups -- more than the M you asked
    // for"). Its remedy is still "Unpin a group, or ask for more groups",
    // shared verbatim with the `poolGroupsNeeded === 0` case just below it
    // -- both directions move `poolGroupsNeeded` the same way (up, toward
    // 1), so the same two actions (unpin, or ask for more) are still true
    // here; only "X of the Y" needed to change, not the remedy.
    PINNED_TOO_MANY_GROUPS: ('{situation, select, ' +
      'over {Your pins already use {pinnedGroupCount} {pinnedGroupCount, plural, one {group} other {groups}} — more than the {requestedGroups} {requestedGroups, plural, one {group} other {groups}} you asked for — which leaves {remainingStudents} {remainingStudents, plural, one {student} other {students}} with no group left for them. Unpin a group, or ask for more groups.} ' +
      'full {Your pins already fill {pinnedGroupCount} of the {requestedGroups} {requestedGroups, plural, one {group} other {groups}} you asked for, which only leaves {remainingStudents} {remainingStudents, plural, one {student} other {students}} with no group left for them. Unpin a group, or ask for more groups.} ' +
      'other {Your pins already fill {pinnedGroupCount} of the {requestedGroups} {requestedGroups, plural, one {group} other {groups}} you asked for, which only leaves {remainingStudents} {remainingStudents, plural, one {student} other {students}} — not enough for the {poolGroupsNeeded} {poolGroupsNeeded, plural, one {group} other {groups}} still needed. Unpin a group, or ask for fewer groups.}}') as Message<{
      requestedGroups: number;
      pinnedGroupCount: number;
      remainingStudents: number;
      poolGroupsNeeded: number;
      situation: 'over' | 'full' | 'short';
    }>,
  },

  warnings: {
    // Task 8a. Carries `students: number[]` (never names -- same resolver
    // pattern as the errors above) and `sex: 'M' | 'F'`, the sex of the
    // NAMED students, not of the group they joined -- that one fact is
    // enough to phrase both halves of the sentence: which group they ended
    // up in, and which sex ran short. Task 8a built this channel first and
    // Task 8b's separate-mode placement is what emits it -- see
    // WARNING_CODES.sexSpillover's doc comment in grouping.ts. Six boys and
    // two girls not dividing evenly is arithmetic, not a mistake, so unlike
    // every error above this carries no remedy: there is nothing to fix.
    SEX_SPILLOVER: ('{sex, select, ' +
      'M {{names} {names, plural, one {has} other {have}} joined a group of girls because there were not enough boys to make a group of their own. That is simply how the numbers divided, not a mistake to fix.} ' +
      'other {{names} {names, plural, one {has} other {have}} joined a group of boys because there were not enough girls to make a group of their own. That is simply how the numbers divided, not a mistake to fix.}}') as Message<{
      names: string[];
      sex: 'M' | 'F';
    }>,
    // Task 9. Carries `students: number[]`, never names -- same resolver
    // pattern as SEX_SPILLOVER above. Always >= 2 by construction (a pinned
    // group needs at least one of each sex to be mixed), so, like
    // SEX_SEPARATE_SPLITS_UNIT, this never branches for singular/plural. No
    // `sex` field, unlike SEX_SPILLOVER: there is no single "spilled" side
    // here, the whole group is mixed because the teacher pinned it that
    // way, and the copy does not need to say which sex is which to make
    // that point -- see WARNING_CODES.pinnedMixedSex's doc comment in
    // grouping.ts for the decision this is the honest wording of.
    PINNED_MIXED_SEX:
      '{names} are pinned together as one group, but are not all the same sex, so this group was not split by sex like the others. That is what the pin asked for, not a mistake to fix.' as Message<{
        names: string[];
      }>,
    // Whole-branch review, I-2. Carries `students: number[]` -- everyone in
    // the one merged group, both sexes -- and no `sex` field, unlike
    // SEX_SPILLOVER above: there is no host side and no spilled side here,
    // so no one sex is the "right" one to name (see
    // WARNING_CODES.sexBothTooSmall's doc comment in grouping.ts). Always
    // >= 2 by construction, like SEX_SEPARATE_SPLITS_UNIT and
    // TOGETHER_APART_CLASH above, so no singular/plural branch.
    SEX_BOTH_TOO_SMALL:
      '{names} were placed in one combined group because there were not enough of either sex to make a group of their own. That is simply how the numbers divided, not a mistake to fix.' as Message<{
        names: string[];
      }>,
  },
};

/**
 * A translation: English's keys, with every message a plain template
 * string. What id.ts, zh.ts, vi.ts and th.ts are typed as, so a translator
 * writes prose and never a type.
 */
export type Catalogue = Translatable<typeof en>;

/** What a page calls: every message compiled to a function of its named slots. */
export type Strings = Compiled<typeof en>;
