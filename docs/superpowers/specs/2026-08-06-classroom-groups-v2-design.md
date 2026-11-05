# Classroom Group Creator v2 — design

**Date:** 2026-08-06
**Status:** design agreed in brainstorming; no questions open
**Supersedes nothing** — extends the tool shipped in PR #8 (`7b9336b`), live at
`shyden.co.uk/classroom-groups` and `/id/classroom-groups`.

Every decision below was made explicitly by the operator during brainstorming. Where a decision
removes something that is live today, or where one instruction constrains another, that is called
out rather than smoothed over.

---

## 1. Why

The tool works but scrolls. The operator wants it compact enough to fit one screen by default, and
at the same time wants considerably more in it: per-student customisation, a class name, and
import/export. More content in less space, resolved by collapsing everything that isn't needed to
make a group.

---

## 2. The rule that shapes the layout

**The default, collapsed state must fit without scrolling on every device, phone included. Once the
teacher expands something, scrolling is expected and fine.**

That single clarification makes the goal achievable and dictates the design: everything is collapsed
by default and opening is a deliberate act.

### Amended 2026-08-08, after measurement — the rule is about the tool, not the page furniture

Built and measured, the rule as first written cannot be met, and the reason is not the tool:

| Device | Page total | Screen | Over by | of which header + footer |
|---|---|---|---|---|
| iPhone SE 320×568 | 2131px | 568 | 1563 | **336** |
| iPhone 8 375×667 | 2026px | 667 | 1359 | **313** |
| iPad 768×1024 | 1420px | 1024 | 396 | **267** |
| Laptop 1280×800 | 1420px | 800 | 620 | **267** |

The site-wide header and footer take **336px of a 568px phone screen** — 59% of the budget before
the page renders a single control, and most of that footer is company text this site is obliged to
carry on every page. It is not this page's to shrink, and shrinking it here alone would make this
page inconsistent with the rest of the site.

The four collapsed sections, meanwhile, are doing exactly what they were designed to do: **46px
each, 185px for all four.** The compaction strategy works. What defeats it is everything that is
not the tool.

**Two operator rulings, 2026-08-08:**

1. **The rule is measured by whether the *Make groups* button is on screen, not by a height
   number.** "Fits one screen" means the button's own bottom edge sits at or above the bottom of the
   viewport at scroll 0 — `#cg-go`'s `getBoundingClientRect().bottom <= window.innerHeight`. A height
   comparison (a span's own height against the viewport's) can be satisfied by a tool pushed
   off-screen, which is not "fits"; a position comparison cannot — corrected after a code review
   measured exactly that case at 1280×800, where the old height comparison passed with the button
   itself rendering 81px below the fold. The site-wide header and footer are excluded from the budget
   this page is judged on, because a page cannot be held to a budget it does not control — the page's
   own hero (`h1` + lead + privacy, immediately above `How to use`) is not excluded, because this page
   does control it.
2. **`How to use` is collapsed by default**, reversing the "expanded by default" in §3. This spec
   already called collapsing it "the single biggest saving on the page"; measurement put that at
   **~310px on a phone**, which is the difference between meeting the rule and missing it. The
   header `▸ How to use` remains, the state is still remembered in `localStorage`, and a teacher
   who opens it once never sees it closed again.

   The cost is real and accepted: a first-time visitor sees the header rather than the description,
   so the *who* and the *why* are one tap away rather than immediate. The alternative was a page
   that scrolls on every phone, which is the defect this rework exists to remove.

**Still owed, and tracked:** the naming/theme picker is marked removed in §12 but still renders, and
stage 3 owns removing it. It is the last always-visible bordered box below the top row.

---

## 3. Layout

- **Arrangement B.** On wide screens the three collapsed sections sit side by side, so the button
  rises and results start above the fold. On a phone they stack. Identical content either way.
- **Top row:** Class (optional) · Students · Split by (per group / number of groups).
- **Sections, inside the tool:** Student details · Grouping options · Import / export ·
  Sound & animation.

  **`Grouping options` replaces what was going to be `Together & apart`.** The together and apart
  letters are set per student, in the Student details table, so a section named after them had
  nothing left to hold once the free-text keep-apart box was removed (§12). Meanwhile two controls
  had no home at all: the sex switches (§6), and the shipped *If students are left over* choice
  (below). They fit the empty section exactly. Still four sections, still two-by-two, so §2 holds.

### How to use — at the very top, outside the tool

**How to use is not one of the tool's sections.** It sits at the very top of the page, above the
form, because it is the page's summary and description rather than part of the feature. It is
**one section holding two parts**, and both collapse together under a single header:

> **Placement changed (operator, 2026-09-30, #384):** the who-and-why paragraph described in part 1
> below is now the page's **lead**, under the heading, so it is read before anything is opened. Part 1
> of How to use now carries the what-it-does sentence that used to be the lead ("Tell it how big your
> class is..."). Every locale swaps its own pair.

1. **What this is** — what the tool does, **why it was built, and who it is for**. The operator was
   explicit about the last two: a visitor should be able to tell, without asking, why this exists
   and whose problem it solves. So part 1 covers, in this order:
   - **who it is for** — teachers, and specifically teachers without a budget or an IT department;
   - **why it was built** — splitting a class fairly by hand is slow and invites the accusation of
     favouritism, and the tools that do it either cost money or want the children's names on a
     server;
   - **what it does** — fair random groups, no favourites, no arguments;
   - **what it does not do** — nothing about the class leaves the browser, nothing is stored,
     no sign-up.

   **Draft copy, for the operator's approval before it is built:**

   > **EN** — Built for teachers, by Shyden. Splitting a class fairly takes time you do not have,
   > and doing it by hand invites an argument about favourites. This does it in one press — free,
   > with no sign-up, and with nothing about your class ever leaving your browser.
   >
   > **ID** — Dibuat untuk para guru, oleh Shyden. Membagi kelas dengan adil memakan waktu yang
   > tidak Anda miliki, dan melakukannya secara manual mengundang perdebatan soal pilih kasih.
   > Ini melakukannya dalam satu tekan — gratis, tanpa perlu mendaftar, dan tidak ada data kelas
   > Anda yang pernah meninggalkan peramban Anda.

2. **How to use it** — the three steps.

- **Collapsed by default** — *amended 2026-08-08; this said "expanded by default" and the reasoning
  for the reversal is in §2.* If the teacher opens it, remember that in `localStorage` and honour it
  next visit. This is a UI preference, not class data — the roster is never stored.
- **Collapsed, the header `▸ How to use` remains**, so it can always be opened again. Collapsing it
  is the single biggest saving on the page: today's long intro paragraph and three how-to steps are
  most of the scrolling.

### Section headers report their own state

**Every collapsed header reports its own state**, so collapsing never means forgetting:

- `▸ Student details · none added` → `· 24 named` → `· 24 named · 2 absent · 2 together · 1 apart`
- `▸ Grouping options · none` → `· mixed by sex` → `· mixed by sex · leftovers in one group`
- `▸ Import / export · nothing to save yet` → `· unsaved changes — export to keep them`

The together and apart counts sit on the **Student details** header, where the letters are actually
set, so the rename above loses nothing.

That last one is where the operator's "advise them to export so they don't lose their changes"
lives: permanently on the header, not a toast that vanishes before it is read.

**Student details expands in place** inside the form — not an overlay, drawer or separate page.
Chosen because expanding is allowed to scroll, so the simplest option is also sufficient, and there
is no focus trap and no second page to test.

### The roster is a table on a laptop and cards on a phone

**Six controls per student cannot fit a 320px screen with 44px touch targets.** 320px less the page
padding leaves about 304px; six targets at 44px need 264px before any gaps, which leaves the name
box at roughly 44px — wide enough to satisfy the arithmetic and far too narrow to read or type a name
in. Shrinking the controls to make room fails the touch-target rule instead. There is no arrangement
of six controls across 304px that satisfies both of this repo's rules, so the row must reflow.

- **Below the breakpoint, one card per student.** Number and name on the first line, with the name
  taking the full remaining width; sex, absent and the two letters on the second.
- **At and above it, the approved table.** Identical content and identical behaviour — one component
  with two layouts, not two components.
- **The absent treatment survives the change**: the card is tinted `#fff6e3`, striped `#d9a441` down
  its left edge, and carries the `absent` pill, exactly as the row does.
- **The breakpoint is ~600px, and is one of two figures that must be settled on real hardware** —
  see §13. It is a starting point, not a decision.

*Rejected:* letting the table scroll sideways inside its own box. It satisfies the letter of the rule,
since the page never scrolls, but setting a student's sex and then their letter means scrolling right
until the name has gone off the left — editing a row you can no longer identify.

### Naming

The section is **Student details**, not "Customise students". It holds facts about students — name,
sex, whether they are here — which is a register, not a customisation. Proposed Indonesian:
**`Detail siswa`**, and **`Cara menggunakan`** for How to use. Both go through the normal locale
review; they are recorded here so the rename is not quietly dropped in one language.

---

## 4. The data model

A student stops being a name and becomes a record:

```ts
interface Student {
  number: number;              // the ID — required, always present
  name: string | null;         // optional
  sex: 'M' | 'F' | null;       // null = neutral, the default
  absent: boolean;             // default false
  together: string | null;     // letter; same letter = same group
  apart: string | null;        // letter; same letter = mutually separated
}
```

**Identity moves from the name to the number.** This fixes a real defect that exists today: keep-apart
matches by name, so a class containing two children called Ana separates *both* from Budi because
the engine cannot tell them apart. With numbers as IDs every constraint is unambiguous.

### Numbers

- The tool assigns `1…N`. **The teacher may override them.**
- Whole numbers, **unique**, **gaps allowed** — a real register number survives a round trip.
- A gap raises a **non-blocking warning**: the class list appears to be incomplete, check it by
  opening Student details.
- **A new student gets one past the highest number in use**, never the first free gap. With 1, 2, 3
  and 5 on the list the next student is 6, not 4 — a gap is usually a register number belonging to a
  child who has left, and filling it would quietly hand their number to somebody else.
- **A duplicate is refused as it is typed**, in the table, exactly like the together-and-apart clash:
  *"Number 5 is already used by Eko. Every student needs their own."* Not held back until the button
  is pressed — one rule for both clashes means one behaviour to learn.

### Sex

- Blank (neutral) / `M` / `F`. **Blank is the default**, so a teacher who never opens the table gets
  neutral avatars for everyone and is never asked.

### Absence

The column is **`Absent`**, and ticking it marks a student out. The word, the tick and the field all
point the same way — page, CSV and data model all say *absent*, so nothing anywhere has to be read
backwards.

- **The row is not greyed out and nothing in it is disabled.** Every detail stays editable: a teacher
  can correct a name, set a sex or change a letter for a child who is off today, ready for tomorrow.
  Absence marks a student out of *this shuffle*, not out of the register.
- **The row is tinted instead**, so a scan down the table shows at a glance who is out:

  | | |
  |---|---|
  | row background | `#fff6e3` |
  | left edge stripe | `#d9a441`, 3px |
  | label | a small pill reading **`absent`**, beside the tick — white on `#8a6a10` |

  **Three signals, none of them colour on its own:** the ticked box, the word *absent*, and the tint.
  A teacher who cannot separate the amber from the cream still has two ways to read the row, and the
  text inside it keeps full contrast because it is still being edited.

  The amber is the same family the page uses for warnings. That was the argument against it — being
  off school is not a fault — and the operator chose it anyway, for visibility. Recorded so it is not
  "corrected" later by someone reading the palette rather than this line.

- **Printed sheets carry neither the tint nor the pill.** The `Absent` column already says it in
  ink-free form, and the print rule is that nothing may depend on colour.
- **A permanent line under the table states the consequence**, whether or not anyone is marked:
  *"Students marked absent are not included when groups are made."* The count line then reports it:
  `24 students · 22 here · 2 absent`.
- **The number being grouped drops; the class size does not.** Groups are built from those present,
  while the Students box stays at 24 — see *The Students box* below.
- Absent students **do not appear in the results at all**.
- **Their letters lapse with them.** A together or apart letter belonging to an absent student
  constrains nobody, and a together-unit whose other members are all absent places its remaining
  member normally.

**Wording is uniform.** *Absent*, not *away*, everywhere it appears — the column, the header state
(`· 24 named · 2 absent`), the count line, the print panel and the printed sheet.

### Together / apart

- Both are a **letter per student**, chosen from a dropdown that **grows as needed** (A, then B once
  A is used, and so on).
- **Together:** students sharing a letter are placed as one unit.
- **Apart:** students sharing a letter are **mutually separated** — everyone marked X goes in a
  different group from everyone else marked X.
  - *Accepted consequence:* this is a set, not a pair. "Ana away from Budi, and Ana away from Citra,
    but Budi and Citra together" can no longer be expressed. The operator chose this knowingly.
- **A pair marked both together and apart is refused in the table, as it is typed**, naming the
  clash: *"Ana and Budi are kept together, so they cannot also be kept apart."*
- **A together-unit larger than the group size is refused**, naming both numbers and both ways out:
  *"6 students are kept together with A, but your groups hold 4. Use larger groups, or move 2 of them
  off A."* Checked whenever either the letters or the group size changes, so raising the letter count
  and lowering the group size are caught the same way.

### The Students box — an input, then a read-out

Two things could claim to know how big the class is: the box and the list. Every mismatch problem
comes from letting them disagree, so **they are never both in charge**.

- **With no list, the box is the input.** Type a number, get that many anonymous students, up to
  `MAX_STUDENTS`. This path is unchanged and a teacher can use the whole tool without ever opening
  Student details.
- **The moment a list exists, the box becomes a read-out.** It reports the list and cannot be typed
  into. Underneath it, in every state, **the reason is shown**:

  > **Students** · 24
  > *Set by your list. Add or remove students in Student details to change it.*

  Never a bare greyed-out box. A disabled control that does not say why is a defect.
- **Changing the class size is then a list operation**, in Student details:
  - `+ Add student` — one row.
  - `+ Add several…` — a small number field and a confirm button that appear **inline in the table
    footer**, for the teacher who has 24 named and six more to come. No dialog and no `prompt()`:
    everything else here expands in place, and it keeps the keyboard where the teacher already is.
  - Removing a row removes the student.
- **Emptying the list** returns the box to being an input, **keeping the number it was last
  reporting**. Clearing a list of 24 leaves 24 in the box, so nothing jumps and nothing is lost.

**What this buys.** The count and the list cannot disagree, so there is no mismatch to warn about,
none to block, and no rule about which students get dropped when a number shrinks — because a number
can no longer shrink out from under the list. The earlier draft warned about the mismatch and a later
revision blocked it; removing the contradiction is better than either.

**Absence does not touch the box.** Ticking a student absent leaves it at 24 — it is the size of the
class, not of tonight's group work. The line beneath does the arithmetic (`24 students · 22 here ·
2 absent`) and groups are built from those present.

### Two size limits, not one

The engine refuses above 500 today. That limit was set when a student was a number; a student is now
a row of six controls — number, name, sex, absent, together, apart — so 500 named students would put
3,000 form elements on the page, slow on a phone and slow to read out. The two costs are different,
so they get different limits:

| Limit | Value | Applies to |
|---|---|---|
| `MAX_STUDENTS` | **500** | The Students box — a plain count of anonymous students |
| `MAX_ROSTER` | **100** | Student details — students with a row of their own |

100 is roughly twice the largest real class, so no teacher meets it by accident.

Every way of exceeding `MAX_ROSTER` has a stated outcome. None of them may fail silently:

- **Opening Student details with the count above 100** — the section refuses to open and says why:
  *"Student details holds up to 100 students. Lower the number to list this class individually."* The
  count itself is left alone; the teacher can still shuffle all 500 anonymously.
- **Adding a row at 100** — both `+ Add student` and `+ Add several…` are disabled and state the
  limit; `+ Add several…` also refuses a number that would cross it, saying how many rows are free.
- **Importing a file with more than 100 rows** — rejected whole, like any other invalid file, with the
  row count and the limit in the message.

There is no fifth case: with a list present the box is a read-out, so it cannot be typed past the
limit at all.

### The engine's contract changes shape

`src/lib/grouping.ts` is the tests-first surface, so its signature has to be settled before a line of
it is written. Today it is built for names; it becomes built for records.

```ts
// today                                  // after
interface Student {                       interface Student {
  id: number;                               number: number;      // was `id`
  name: string | null;                      name: string | null;
}                                           sex: 'M' | 'F' | null;
                                            absent: boolean;
                                            together: string | null;
                                            apart: string | null;
                                          }

students: number | string[];              students: number | Student[];
keepApart: Array<[string, string]>;       // gone — the letters carry it
                                          sexMode: 'off' | 'mix' | 'separate';
                                          pinned: Student[][];
```

**Two error codes become impossible and are deleted:**

- `keepApartNeedsNames` — letters need no names.
- `keepApartUnknownName` — a letter cannot be misspelt.

Both exist only because keep-apart was typed as free text. The three that *prove* something —
`keepApartImpossible`, `keepApartNoArrangement`, `keepApartSearchGaveUp` — all survive, restated over
letters rather than pairs.

**New codes are needed** for the refusals this design adds: duplicate number, together-unit larger
than the group size, together-and-apart clash, and a sex contradiction. Each follows the existing
discriminated-union pattern, carrying exactly the data its message needs and no bag of optionals.

**`parseKeepApart()` is deleted with its unit tests.** It parses the free-text box removed in §12;
leaving an exported function with no caller is how dead code survives a rewrite.

---

## 5. Avatars

Direction **C — friendly faces**, at the **Bold** strength.

| | background | body |
|---|---|---|
| Boy | `hsl(214 92% 88%)` | `hsl(218 85% 46%)` |
| Girl | `hsl(334 95% 92%)` | `hsl(332 85% 60%)` |
| Neutral | `hsl(150 40% 86%)` | `hsl(150 42% 42%)` |

Shared: hair `hsl(24 40% 24%)`, face `hsl(32 55% 78%)`, eyes/mouth `hsl(215 30% 20%)`.
Simple dot eyes and a smile; 40×40 viewBox; rendered at 34px in group cards.

**Two signals, not one.** Colour *and* hair length (short / medium / long) both differ. The palette
puts pink beside green, which is the classic confusion for the roughly 1 in 12 males with red-green
colour blindness — and no colour at all survives a greyscale printout. Hair length is what carries
the distinction for both. This is deliberate and must not be "simplified" away.

**Removed:** the group-name themes (Animals / Colours / Planets), their `themeNames`/`themes` tables
in both locales, `THEME_KEYS`, the themed branch of `groupName()`, and the theme `<select>`. Groups
are always numbered. This deletes a shipped feature; the operator chose it knowingly.

---

## 6. Grouping by sex

Two optional switches, both **off by default**:

- **Mix boys and girls evenly** — spread M and F as evenly as the numbers allow.
- **Keep boys and girls separate** — single-sex groups.

Rules:

- **Both are DISABLED unless every student *being grouped* has `M` or `F`.** This removes the
  question of where a neutral student goes in a single-sex group.
  - **Absent students are not counted.** A child who is off today and has no sex set does not hold
    the options shut, because they are not being placed in anything. Measuring the whole list instead
    would have produced the worst kind of block: every group on screen has a sex, nothing looks
    wrong, and the child preventing it is the one who is not there.
  - **When disabled, say why**, and name the number: *"3 of the 22 students being grouped have no sex
    set. Open Student details and set M or F for them to use these."*
  - **With no list at all**, nobody has a sex, so both are disabled with their own wording:
    *"Add your students in Student details and set M or F for each to use these."*
  - **They can switch off again when a student returns.** Unticking an absence can put an unsexed
    student back into the grouping and close the options. That must be **explained, not silent**:
    *"Dewi is back and has no sex set. These options need one for every student being grouped."*
    A control that disables itself without a reason is the same defect as a greyed-out box that does
    not say why.
- **Separate mode warns when the counts don't divide**, and **names the students who end up in a
  group of the other sex**.
- **A contradiction with together/apart is blocked, with the reason stated** — e.g. Ana (F) and Budi
  (M) bound together while single-sex groups are requested. Blocked, not silently resolved.

Both switches live in the **Grouping options** section (§3).

### Leftovers — kept, and now placed

`If students are left over` is **live today** in both languages (`leftoversLabel`, `leftoversSpread`,
`leftoversBunch`, `leftoversHelp`, and `Leftovers = 'spread' | 'bunch'` in the engine). The first
draft of this design neither kept it, removed it nor placed it — it simply did not know about it.
**It is kept**, unchanged in behaviour, and it lives in **Grouping options** beside the sex switches:

- *Share them out evenly* (default) — 25 students in groups of 4 gives six groups, one of five.
- *Put them all in one group* — six groups of four and a seventh holding the one child left over.

It answers a real classroom question and teachers have opinions about it, so it is not ours to
delete. Its interaction with the new constraints is engine work in stage 1 like any other: a spare
student who carries a together letter goes wherever their unit goes, and *bunch* may not create a
leftover group that violates an apart letter.

---

## 7. Partial reshuffle

**In scope.** Each group card carries a pin. **Shuffle again** leaves pinned groups untouched and
redeals everyone else. Pinned students are a fourth constraint alongside together, apart and the sex
options, and every interaction between them must be specified and tested — the engine work here is
real and is the largest single piece of stage 1.

---

## 8. Class name and results

- Class name is **optional**. Blank is fine and nothing is blocked.
- It **heads the results**: `7B — your groups`. Groups themselves are numbered.
- It is **not** repeated on every group card.

### When the class changes after a shuffle

Groups are on screen; the teacher then opens Student details and marks someone absent. Left unsaid,
the results quietly become a lie — and the sheet that gets printed or projected contains a child who
is not in the room. So the rule is explicit, and it distinguishes **editing a fact** from **changing
the class**:

- **A rename is not a change of class.** Correcting "Ana" to "Anna" updates the name wherever it
  appears in the results. Nobody moved, so nothing is stale.
- **Anything that could change who goes where marks the groups out of date**: marking a student
  absent or present, adding or removing a student, changing a together or apart letter, changing a
  sex while a sex option is on, or changing the group size or the leftovers choice.
- **Out of date means dimmed and badged**, with the reason and the way out:
  *"These groups are out of date — Dewi is now marked absent."* plus **Shuffle again**. The old groups
  stay visible, because they are still useful to look at and the teacher may simply not care.
- **Export groups, Print and Full screen refuse while the groups are out of date**, and say why.
  Printing or projecting a stale sheet is the one outcome that leaves a classroom with the wrong
  answer on paper.
- **Shuffling clears the badge**, as does undoing the change that caused it.

### Full screen — the projector view

A **Full screen** button on the results, appearing only once groups exist. The groups go on the board
and the class reads them off it, which is what this tool is actually for.

- **Fullscreen API where available, full-viewport overlay where not.** iOS Safari does not grant
  `requestFullscreen` on arbitrary elements, so the fallback is not optional and is not a degraded
  experience — it is a real full-viewport layer with the same content. Both paths are tested; a
  refused promise must land in the fallback, never in nothing happening.
- **Only the groups.** Class name at the top, numbered groups, avatars and names. No form, no site
  header, no footer.
- **Type scales to fit, down to a floor.** Everything on one board wherever it fits. Student names
  never render below **24px** and group headings never below **32px**; past that the board scrolls
  instead of shrinking further. Those figures are a starting point to be **checked on a real
  projector**, in keeping with this repo's device-verification rule — not settled by looking at a
  laptop.
- **Controls fade, but never trap.** A bar carrying *Shuffle again*, *Print* and *Close* fades after
  about three seconds and returns on pointer-move, tap or any key.
  - **It must never fade while any control inside it has focus**, or a keyboard user loses the
    controls they are using. This is a defect the fade would otherwise introduce and must be tested.
  - **Escape always exits**, faded or not.
- **Pins still work**, so the teacher can keep the group that worked and re-roll the rest in front of
  the class.
- **The reveal animation plays**, honouring the existing Sound & animation switch and
  `prefers-reduced-motion`. It is wasted on a laptop the teacher is looking at alone; on the board it
  is the moment the children are waiting for.
- **Exiting shows whatever is on the board when you leave** — including a shuffle done there — at
  the same scroll position. The page behind is never a stale copy of the results you started with.
- **Warnings appear on the board too**, not only on the page behind it. A separate-sex shuffle that
  names who landed in the other sex's group must say so where the teacher is looking.

---

## 9. CSV import and export

### Shape

```
# Class: 7B
number,name,sex,absent,together,apart
1,Ana,F,,A,
2,Budi,M,,A,
3,Citra,F,,,X
4,Dewi,F,yes,,
5,Eko,M,,,X
6,,,,,
```

- **CSV only.** No `.xlsx` — it would need a spreadsheet library of a few hundred KB on a site that
  currently ships almost no JavaScript and no third-party runtime dependencies. CSV opens natively
  in Excel, Numbers and Sheets.
- **Only `number` is required.** A file containing nothing but a `number` column is valid and
  imports that many anonymous students. Everything else may be blank per row.
- **`absent` is blank for everyone who is in**, so the column stays quiet until somebody is out. A
  teacher who writes `no` (or `tidak`) is being reasonable and it is accepted as present; anything
  else in that column is refused by name, like any other bad value.
- **Class name travels as a `# Class:` comment line** above the headers, so it round-trips. Excel
  shows it as a first row; the importer reads it.

### Language

The file must match the language of the page — **headers and values both**.

| | English page | Indonesian page |
|---|---|---|
| headers | `number,name,sex,absent,together,apart` | `nomor,nama,jenis kelamin,tidak hadir,bersama,terpisah` |
| class comment | `# Class:` | `# Kelas:` |
| sex | `M` / `F` / blank | `L` / `P` / blank |
| absent | `yes` · present is blank or `no` | `ya` · present is blank or `tidak` |

A file in the wrong language is **recognised as such**, refused, and offers a link to the correct
page — *"This looks like a Bahasa Indonesia class list. Open the Indonesian version of this page to
import it."* The refusal is written in the language of the page the teacher is on, not the file.

### Validation

- **A bad file is rejected whole.** Nothing is imported.
- **Every problem is listed**, not just the first: row number, what was wrong, what is accepted.
  *"Row 7 — sex 'Male' not understood. Use M, F, or leave blank." / "Row 12 — number 5 is already
  used by row 5." / "Row 19 — number is blank. Every student needs one."*

### Import over an existing roster

**Always warn first**, naming what will be lost — including how much of it was filled in by hand. Never
silent, even when the counts match, because the same count can be a completely different class.

### Exports

Two buttons, and the groups one appears only once groups exist.

- **Export class list** — the roster, for reuse next lesson.
- **Export groups** — the arrangement just made, **one row per student** with a `group` column:

```
# Class: 7B
# Groups made 2026-08-06
group,number,name
1,1,Ana
1,2,Budi
2,5,Eko
```

Chosen over one-row-per-group because it sorts, filters and pivots, and handles uneven group sizes
without ragged blank columns. *A is data; B was a picture — and for a picture you print.*

### Templates

**Context-sensitive.** With no class list on screen, the template carries the headers plus example
rows. With a class list already present, the template is **your roster**.

**The example rows are comment lines**, and the importer ignores every line beginning with `#`:

```
# Class:
number,name,sex,absent,together,apart
# 1,Ana,F,,A,
# 2,Budi,M,,,X
# delete these two lines and type your own
```

**A `#` line is never a student.** `# Class:` (and `# Kelas:`) are recognised as metadata first;
every other `#` line is discarded — the example rows, and any note a teacher types themselves.

**No name matching.** Recognising examples by their contents would silently drop a real child called
Example One, which is exactly the class of bug this avoids. A teacher who forgets to delete the
example rows imports nothing by accident.

### Exporting in both languages — bidirectional

Available from **either** page; the page you are on always exports first, in its own language.

1. Teacher chooses "also export in the other language", and is told what will happen.
2. The current page's file saves.
3. A **new tab** opens on the other locale's page and **asks the first tab for the roster over an
   in-memory, same-origin channel**. Nothing is written to storage; nothing goes in a URL.
4. The teacher verifies the translated roster there and exports it.
5. The source tab forgets the roster **only once the new tab acknowledges receipt**.

If the tab is blocked, or never asks within a timeout, say so plainly and keep the roster where it
is. The handover must never lose data by failing silently.

*Rejected alternatives, and why:* `sessionStorage` (the operator's first instinct) writes children's
names into browser-managed storage for the length of a page load, which can survive a crash on a
shared classroom machine. Putting the roster in a URL is the exact defect closed as C1 in PR #8.

### Filenames

`7B-class-list-2026-08-06.csv` · `7B-daftar-kelas-2026-08-06.csv`
`7B-groups-2026-08-06.csv` · `7B-kelompok-2026-08-06.csv`
With no class name: `class-list-2026-08-06.csv`. The date prevents successive saves overwriting
each other.

**The class name is made safe for a filename, and only there.** `Year 7 / Set B` contains a slash,
which breaks a filename on every platform; anything a filesystem will not take is replaced and the
runs collapsed, giving `Year-7-Set-B-class-list-2026-08-06.csv`. **The class name itself is never
altered** — not on the page, not in the `# Class:` line, not in the results heading.

---

## 10. Printing

A **print panel**, not a bare print button. The teacher decides what goes on the paper — the operator
was explicit that this is theirs to choose, not ours to fix.

```
Print                              ×

What to print
  ( ) Class list
  ( ) Group results
  (•) Both

On the class list
  [x] Show students who are absent
  [x] Show sex and the together/apart letters

[x] Include avatars

              [ Cancel ]   [ Print ]
```

**What to print** — class list, group results, or both. Both is the default.

**The two class-list tick boxes are independent**, which is why they are tick boxes rather than three
named sheets: all four combinations are reachable, including *only who is here, with the letters* —
a combination the named sheets could not express.

- *Show students who are absent* — off drops absent students from the sheet entirely. The remaining
  numbers then jump (1, 2, 3, 5) because a number belongs to a student, not to a position. The sheet
  says how many are absent so the gap is never a mystery.
  - **On, the sheet gets an `Absent` column**, ticked for the students who are out. This column
    belongs to *this* tick box, not to the one below it: choosing to show absent students and then
    being unable to tell which they are would print a lie. Off, the column goes too — there is then
    nobody on the sheet it applies to.
- *Show sex and the together/apart letters* — off drops the sex and the letters. It does **not**
  touch the `Absent` column, because it says sex and letters and that is what it governs.

**Include avatars** — off prints names only: identical on every printer, and the least ink. On, faces
print as line drawings, and hair length still separates boy from girl with no colour at all.

**All three tick boxes start ticked**, *What to print* starts on *Both*, and **the panel remembers
all four choices** for next time — UI preferences, no personal data, consistent with section 11.

The sheet itself is a genuine **print-friendly view**: no form, no collapsed sections, no site
chrome; class name and date at the top. **It must work in greyscale as well as colour** — this is why
the avatars carry hair length as well as colour, and why nothing may depend on colour alone.

Group results print as they appear, minus absent students, who by section 4 are never in the results
at all — the *absent* tick box governs the class list only.

---

## 11. Persistence and privacy

- **The roster is never persisted.** Saving is what export is for. When a teacher has changed
  anything, the Import/export header says `unsaved changes — export to keep them`.
- **UI preferences may be persisted** — the how-to collapsed state, and the four print-panel choices.
  No personal data: a tick box is not a child.
- Privacy copy changes, because the roster can now reach a second tab:

  > **EN** — Everything happens in your browser. Your class list is never sent anywhere, and is
  > forgotten when you close the page.
  >
  > **ID** — Semuanya berjalan di peramban Anda. Daftar kelas Anda tidak pernah dikirim ke mana pun,
  > dan dilupakan saat Anda menutup halaman.

  The old wording — "No class list ever leaves this page" — is no longer strictly true and must go.

---

## 12. Removed, deliberately

| Removed | Why |
|---|---|
| Group themes (Animals / Colours / Planets) + both locale tables | Avatars chosen instead; groups always numbered |
| The **naming radio** — `namingLabel`, `namingNumbered`, `namingThemed` — and its four locale keys | With themes gone it is a choice with one option |
| "Paste names, one per line" box | The table and import replace it |
| Free-text keep-apart box, and `parseKeepApart()` | Replaced by the Apart letter in the table |

All four are live today. Each is a decision, not an oversight.

**Kept, though the first draft forgot it:** the *If students are left over* control. See §6.

---

## 13. Testing — tests first, observed RED

The operator was explicit: **write the Playwright tests first, watch them fail, then make them pass
with real code.** Every clarification in this document is a test. Non-exhaustively:

**Layout** — collapsed default fits without scrolling at 320/375/768/1280; expanding is allowed to
scroll; **no horizontal page scroll at any of those widths, in any state, including with the roster
open**; every interactive target is at least 44px; the roster renders as cards below the breakpoint
and as the table at and above it, with **the same content and the same behaviour proved in both** —
including the absent tint, stripe and pill; How to use sits above the form and outside the tool's sections; both its parts collapse
together under one header; it starts collapsed on a first visit with JavaScript, stays reachable
without JavaScript, and its collapsed state is remembered across a reload once a teacher opens it;
the `▸ How to use` header is still present and operable when collapsed; each section header reports
its state in every state; the section is named Student details in both locales.

**Roster** — number assigned 1…N; override accepted; **a duplicate is refused as it is typed, not
at shuffle time**, naming who already holds it; gaps allowed but warned; **a new student takes one
past the highest number, not the first free gap** — 1,2,3,5 is followed by 6;
the Absent column marks a student out and **nothing in that row is disabled** — name, sex and
letters all still editable; the row is tinted and the ticked box carries the same fact without
colour; the consequence line is on screen whether or not anyone is marked; an absent student is
excluded from groups and from results, and their letters constrain nobody; unnamed row renders "Student N";
fixed-width cells so an empty name does not resize the row.

**Constraints** — together placed as a unit; apart mutually separated; together+apart contradiction
refused as typed; a together-unit larger than the group size refused, naming both numbers — and
refused **both** ways into it, by growing the unit and by shrinking the groups.

**Sex options** — disabled with a reason unless every student **being grouped** has M or F; **an
absent student with no sex does not disable them**, and unticking that absence disables them again
**with its own message naming the student**; a third message covers having no list at all; mix
spreads evenly; separate warns and names who lands in the other sex's group; contradiction with
together blocked with a reason.

**The Students box** — typeable with no list; becomes a read-out the moment a list exists, and
**the reason is rendered, not merely implied** — a disabled box with no explanation is a failing
test; emptying the list makes it typeable again **and keeps the number it was reporting**;
`+ Add student` and `+ Add several…` change it;
removing a row lowers it; ticking a student absent does **not** change it while the here/absent line and
the groups both follow; no code path can produce a box that disagrees with the list.

**Reshuffle** — pinned groups survive; unpinned redealt; constraints still honoured.

**Stale groups** — a rename updates the results and marks nothing stale; marking absent or present,
adding, removing, changing a letter, changing a sex under a sex option, and changing the group size
or leftovers each mark them out of date, **stating which change did it**; the old groups stay on
screen, dimmed; **Export groups, Print and Full screen all refuse while stale and say why** — asserted
separately for each of the three, because one of them silently succeeding is how a wrong sheet
reaches a classroom; shuffling clears it, and so does undoing the change.

**Full screen** — button appears only once groups exist; the API path and the overlay fallback are
both exercised, and a refused `requestFullscreen` lands in the fallback rather than doing nothing;
no form or site chrome on the board; type shrinks to fit and stops at the floor, below which the
board scrolls; the control bar fades and returns on pointer, tap and key; **it does not fade while a
control inside it holds focus**; Escape exits whether the bar is visible or not; pins still work;
the reveal plays and is suppressed by both the Sound & animation switch and `prefers-reduced-motion`;
**a shuffle done on the board is what the page shows on exit**, not the arrangement it started with;
warnings raised by a shuffle appear on the board, not only on the page behind it.

**CSV** — minimum file (number column only); partial rows; class-name round trip; every value in
both languages; `absent` accepts blank, `no` and `tidak` as present and refuses anything else by
name; wrong-language file recognised and refused with a link; bad file rejected whole with *every*
problem listed; import over an existing roster always warns; template with and without an existing
roster; **every `#` line is ignored on import** — the class comment, the example rows, and a note a
teacher typed themselves — and a downloaded template imported unedited adds **no students at all**,
including one whose example row is named "Example One".

**Both-language export** — works from English and from Indonesian; nothing written to storage;
nothing in the URL; source forgets only after acknowledgement; blocked tab reported and roster kept.

**Print** — class list, groups, both; each of the four tick boxes changes the sheet in the way it
says, and the two class-list boxes are proved independent by testing all four combinations;
**showing absent students always prints the `Absent` column, including when sex and letters are
off** — the combination that would otherwise print an absent child indistinguishable from a present
one; unticking sex and letters leaves that column alone; absent students dropped *and* the absent
count still stated; numbers still jump when they are dropped;
avatars present and absent; choices survive a reload; greyscale legible; no form or chrome on the
sheet.

**Leftovers** — spread and bunch each produce the arrangement they describe; a spare student
carrying a together letter goes where their unit goes; bunch never builds a leftover group that
violates an apart letter.

**Size limits** — the box refuses above 500; Student details refuses to open above 100 and says
why while leaving the count alone; both add controls disable at 100 stating the limit, and
`+ Add several…` refuses a number that would cross it, saying how many rows are free; an import of
101 rows is rejected whole naming the count and the limit. There is no case for typing the box past
`MAX_ROSTER` with a list present, because with a list present the box cannot be typed at all.

**Filenames** — a class name containing `/`, `\`, `:` or a control character produces a usable
filename, and **the class name itself is unchanged** on the page, in the `# Class:` line and in the
results heading.

**i18n** — every new string in both locales; whole rendered sentences asserted, not fragments; the
existing rendered-text seam scan must stay green; the removed keys are gone from **both** locale
files and `dead-copy.test.ts` proves nothing renders them.

**The existing suites are extended, not duplicated.** `classroom-groups.spec.ts`,
`-controls.spec.ts`, `-privacy.spec.ts` and `-announcements.spec.ts` already exist, along with
`tests/unit/grouping.test.ts`. New coverage goes into them. **Tests covering a removed feature are
deleted in the same stage that removes it**, so the suite never asserts a feature that is gone and
never sits green over a page that no longer has the control.

**The no-JS message is unchanged.** `needsJs` still covers the whole tool; the new sections do not
each need their own, and nothing in this design works without script.

### Two figures that a laptop cannot settle

`CLAUDE.md` already records a real mobile-device browser run as owed before launch. Two numbers in
this design are **starting points chosen at a desk** and must be checked on real hardware before they
are treated as decided:

| Figure | Proposed | Checked how |
|---|---|---|
| Roster card-vs-table breakpoint | ~600px | A real phone and a real tablet, in both orientations |
| Projector type floor | names 24px, headings 32px | Read from the back of a room, off a real projector |

Neither is a guess to be quietly kept. Both are written here so the gauntlet has something specific
to confirm or overturn.

---

## 14. Delivery

Staged, **merged behind the scenes and deployed once at the end**, so the live page never sits in a
half-migrated state:

1. **Data model + engine** — the new `Student` record and `GroupingInput`, `id` renamed to `number`,
   together/apart letters, absence, sex-based grouping, pinned groups, leftovers restated against all
   of them, the two dead error codes deleted and the four new ones added, `parseKeepApart()` removed.
   The largest stage, and the only one that is pure logic.
2. **Compact layout** — arrangement B, the four collapsed sections with state headers including
   **Grouping options**, class name, and How to use above the tool.
3. **Student details + avatars** — the table, the new avatars, and the four removals: themes, the
   naming radio, the paste-names box and the free-text keep-apart box, each with its locale keys and
   its tests.
4. **CSV import/export + templates + validation + both-language handover.**
5. **Print panel and print views, and the full-screen projector view.**

The two size limits (section 4) belong to stage 1 for `MAX_STUDENTS` and stage 3 for `MAX_ROSTER`,
since the roster limit has nothing to constrain until the table exists.

---

## 15. Open questions

**None.** The three that were open when this document was first written are now decided and written
into the sections above:

| Question | Decision | Where |
|---|---|---|
| What the printed class list shows | The teacher decides, via two independent tick boxes | §10 |
| Whether avatars print | The teacher decides, at print time, remembered | §10 |
| The class-size cap | Two limits: 500 to shuffle, 100 to list individually | §4 |

The first two share an answer worth stating plainly: **where we could not name a single right sheet,
we handed the choice to the teacher rather than guessing on their behalf.**
