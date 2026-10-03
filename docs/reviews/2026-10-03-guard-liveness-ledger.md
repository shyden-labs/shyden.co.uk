# Guard liveness ledger (#446)

Every guard in this repository proves it saw what it judges, counted at the
level it judges. This ledger lists every guard site, derived from the code,
and records for each one the unit it judges against the unit its liveness
counts. #446 is retired when every row reads as fixed or proven sound.

## How the population was derived

A TypeScript AST walk over every `.ts`, `.mts`, `.mjs` and `.js` file git
tracks under `tests/` (265 files on `develop` `9578a53`) records two kinds of
site:

- every `searched(findings, { of, what })` call (the absence control from
  #118), with the test that encloses it, its `of` expression, and whether
  the findings list is built from that same population (a one-hop dataflow
  check);
- every `toBeGreaterThan(<number>)` and `toBeGreaterThanOrEqual(<number>)`.

The walk checks itself against a raw-text count of the same constructs, and
every difference was read:

- `searched`: 256 calls by the AST, 259 lines by text. The three extra lines
  are doc comments (`source-files.ts:161`, `absence-liveness.test.ts:19`,
  `shytalk-links.ts:38`).
- floors: 163 by the AST, 150 lines by text. Keyed on the matcher's own
  line, the eight lines only the text finds are five comments and three
  string fixtures in `viewport-tagging.test.ts`; the 21 sites only the AST
  finds are decimal floors (`4.5`) or carry their number on the next line,
  which a one-line pattern cannot see.

## Group 1: liveness floors (AC3), PR for this ledger

A floor on a population the guard reads is only a control if losing part of
that population fails it. Thirty floors were found on such populations.
Each was measured by raising it to `1e12` and reading the value vitest
reported, one round per position within a test (a test stops at its first
failed expectation). Two needed more:

- `back-translate.test.ts` loops four locales inside one test, so it reports
  only the first. A temporary probe recorded each: id 262, zh/vi/th 261.
- `git-env.test.ts` counts the tests of `release-inventory.test.ts`, which
  its child run executes. Raising both floors in one round turned the child
  red, so it was measured from that file's own run: 18.

Every floor is now `measured - 1` (a `>=` floor is `measured`), with the
figure in a comment beside it. The mutation for each is the reader coming
back one short, `expect((X) - 1)`, run on its own test:

- before (`develop` `9578a53`): 25 GREEN where the floor had slack, 5 RED
  where it was already tight, exactly as predicted;
- after: see the table below.

| Site | Liveness counts | Was | Measured | Now | Before | After |
| --- | --- | --- | --- | --- | --- | --- |
| `unit/absence-liveness.test.ts:184` | `tsFiles.length` | > 30 | 262 | > 261 | GREEN | RED |
| `unit/absence-liveness.test.ts:194` | `result.absences` | > 393 | 399 | > 398 | GREEN | RED |
| `unit/anchored-presence.test.ts:299` | `result.scanned` | > 75 | 76 | > 75 | RED | RED |
| `unit/anchored-presence.test.ts:302` | `tsFiles.length` | > 30 | 262 | > 261 | GREEN | RED |
| `unit/back-translate.test.ts:305` | `expected.size` | > 100 | 261 | > 260 | GREEN | RED |
| `unit/duplication.test.ts:112` | `SCANNED.length` | > 100 | 338 | > 337 | GREEN | RED |
| `unit/duplication.test.ts:117` | `DECLARATIONS.length` | > 1000 | 5198 | > 5197 | GREEN | RED |
| `unit/event-collectors.test.ts:64` | `SCANNED.length` | > 20 | 65 | > 64 | GREEN | RED |
| `unit/event-collectors.test.ts:277` | `SCANNED.flatMap((path) => locatorLoops(readF…` | >= 4 | 7 | >= 7 | GREEN | RED |
| `unit/git-env.test.ts:187` | `report.numPassedTests` | > 10 | 18 | > 17 | GREEN | RED |
| `unit/one-home.test.ts:71` | `SCANNED.length` | > 20 | 294 | > 293 | GREEN | RED |
| `unit/one-test-per-case.test.ts:293` | `tests.length` | > 637 | 638 | > 637 | RED | RED |
| `unit/pipeline-wiring.test.ts:236` | `plainTestsIn('tests/dev/dev-sanity.spec.ts')…` | > 3 | 15 | > 14 | GREEN | RED |
| `unit/pipeline-wiring.test.ts:1110` | `plainTestsIn('tests/prod/prod-sanity.spec.ts…` | > 3 | 8 | > 7 | GREEN | RED |
| `unit/pipeline-wiring.test.ts:1650` | `list.length` | > 1 | 8 | > 7 | GREEN | RED |
| `unit/pipeline-wiring.test.ts:2118` | `launchedConfigs().length` | > 1 | 2 | > 1 | RED | RED |
| `unit/pipeline-wiring.test.ts:2382` | `inputs.length` | > 10 | 17 | > 16 | GREEN | RED |
| `unit/release-inventory.test.ts:311` | `lines.length` | > 50 | 79 | > 78 | GREEN | RED |
| `unit/site-pages.test.ts:16` | `pageNames().length` | > 2 | 3 | > 2 | RED | RED |
| `unit/spec-dirs.test.ts:9` | `specDirs().length` | > 2 | 5 | > 4 | GREEN | RED |
| `unit/source-files.test.ts:17` | `specs.length` | > 10 | 48 | > 47 | GREEN | RED |
| `unit/source-files.test.ts:91` | `filesUnder('tests', (path) => path.endsWith(…` | > 10 | 48 | > 47 | GREEN | RED |
| `unit/wcag.test.ts:138` | `scanned.length` | > 100 | 339 | > 338 | GREEN | RED |
| `unit/download-readers.test.ts:78` | `readers.length` | > 0 | 2 | > 1 | GREEN | RED |
| `unit/excluded-by-design.test.ts:102` | `built.length` | > 0 | 2 | > 1 | GREEN | RED |
| `unit/install-scripts.test.ts:99` | `packagesWithInstallScripts().length` | > 0 | 3 | > 2 | GREEN | RED |
| `unit/release-map.test.ts:276` | `files.length` | > 0 | 1 | > 0 | RED | RED |
| `unit/route-coverage.test.ts:129` | `gateSpecs().length` | > 1 | 3 | > 2 | GREEN | RED |
| `unit/sitemap-config.test.ts:73` | `Object.keys(sitemapLocales()).length` | > 0 | 5 | > 4 | GREEN | RED |
| `unit/supply-chain.test.ts:107` | `externalUses().length` | > 0 | 38 | > 37 | GREEN | RED |

`flags.test.ts:55` was first listed here and is not a floor: it asserts a
flag's drawing is non-empty, which is a presence check.

## Group 2: file-level populations (AC2), next

39 `searched` calls hand their control a file-level population (`files`,
`specs`, `modules`, `workflows`, `SCANNED` …). Read on 2026-10-03, each
through to its verdict and not only up to the `searched(` call:

- 18 are sound. They judge files or entries (tracked paths, "reads every
  file under scripts/", the content-only spec list), or the verdict names
  the home file (`toEqual(['tests/board-geometry.ts'])`), so a blind reader
  returns `[]` and fails, or a sibling assertion runs the same reader on a
  file that has the construct (`evidence-recording.test.ts:246`).
- 12 judge each file with a pattern and assert an empty result, with no
  cross-check found beside them yet.
- 9 hunt a construct inside the files (rendered text, declarations,
  imports, locator loops, workflow references, script statements, date
  reads) while proving only that files were opened.

Each of the 21 gets what the rule asks for: the judged unit inside its
verdict where it is not files, a tight floor, an independent cross-check,
fail-closed reading, and a planted construct in every form it takes.
`pipeline-wiring.test.ts:1044` also skips a file that is not YAML with a
silent `continue`. Appendix A gives each site's status.

## Group 2a: construct guards, done

The 9 sites above that judge a construct while counting files now count what
they judge (#446 Group 2a, plan
`docs/superpowers/plans/2026-10-03-guard-audit-group-2a.md`). Each verdict's
population is the judged unit, the walk that made the verdict supplies it, and a
floor at measured − 1, an independent cross-check and the construct's planted
forms sit beside it:

| Guard | Judged unit | Measured | Cross-check |
| --- | --- | --- | --- |
| `spec-scan.ts` (isolated-context, viewport, parked) | tests and groups read | 638, 771, 771 | `declaresTests`, text against the parse tree |
| `spec-scan.ts` (`download-readers`) | download byte reads | 8 | a text scan for the three readers |
| `spec-scan.ts` (`capture-after-assertion`) | evidence captures | 143 | `shoot` calls in the parse tree |
| `no-dated-render` | code and markup views | 46 | `HOLDS_CODE`, frontmatter or a `<script` tag |
| `deprecated-css` | declarations | 1170 | `HOLDS_CSS`, a rule or a `<style` tag |
| `duplicate-imports` | imports read | 1512 | `IMPORTS`, a line opening an import |
| `event-collectors` | locator loops | 8 | `.all()` in the text against the tree, per file |
| `pipeline-wiring` dangling refs | workflow file references | 19 | the parsed document's string values |
| `script-entry` argv / load-time | `process.argv` reads / statements | 10 / 313 | the text count / the statement filter |
| `copy-reaches-a-page` dissolved | built pages read | 16 | a page with a body that read as blank |

Two forms the code writes were invisible before: `formTextsUnderAA` loops a
spread `.all()` list, which `event-collectors` counted as no loop (7 loops, really 8),
and `script-entry` saw `process.argv[1]` only by index, never destructured,
sliced from 1, read with `.at(1)` or passed on whole. Each reader now names
what it cannot classify instead of skipping it, and `pipeline-wiring` names a
file in the workflows directory that is not YAML instead of `continue`.

The mutation matrix ran 52 rows, all as predicted: 16 on `develop`, where the
blinded guard stayed GREEN (so the gap was real, except the viewport guard,
whose orphan findings already caught a reader blind to every declaration), and
36 on the new tree, where each one turned a guard RED. Twelve of those prove each
cross-check alone, with its floor switched off. Appendices A and B below are the
census at `6d07d37`, before Group 2a. `download-readers.test.ts:78`'s
file-level floor in Appendix B is gone, replaced by the byte-read floor above.

## Group 2b: file-level absence guards, done

The 12 sites above that judge each file with a pattern and assert an empty
result now prove their walk, their pattern and a second reading (#446
Group 2b, plan `docs/superpowers/plans/2026-10-03-guard-audit-group-2b.md`).
One needed nothing: `browser-matrix`'s content-only guard already had an exact
cross-check on `rendered-text.spec.ts` and 24 planted forms in
`engine-dependence.test.ts`, which this census missed by stopping at the
verdict. `device-tool-homes` and `release-inventory` had part of it. Each of
the other sites now has a floor at measured − 1, a cross-check by different
means, and its construct planted in each form:

| Guard | Floor (measured) | Cross-check |
| --- | --- | --- |
| `typecheck-scope` ts-nocheck | 29 scripts | the compiler's own directive record |
| `route-coverage` locale routes | 3 gate specs (already there) | the parse tree's strings |
| `release-inventory` captures | 58 helper modules | the parse tree's `shoot` calls |
| `pipeline-wiring` image | 10 workflow files | the parsed document's values |
| `pipeline-wiring` budget, prebuilt | 1 job running the suite | raw text against the parsed jobs |
| `pipeline-wiring` wrangler | 10 workflow texts | a coarser line reading |
| `shytalk-brand` | 329 source files | the homes, through the verdict's reader |
| `evidence-recording`, both directions | 43 specs, 26 declaring, 26 acting, 17 still | the parse tree's `test.use` calls |
| `device-tool-homes` | 294 files | the home, through the same pattern (already there) |

Ten forms the code writes, or could write the next day, were invisible, and
each was planted in a real file and stayed GREEN on `develop`: `'/id'` (a
locale home with no slash after it) and a route after a template substitution;
a capture through a namespace import (`evidence.shoot(`); a Playwright image
pinned by digest or not pinned; `npm install wrangler@4 -g`, and `npm in -g
wrangler`, one of the eleven install aliases npm documents; a build inside the
suite's own block script, and `npx astro build`; `rgb(208 188 255 / 0.3)`, the
space-separated syntax `tokens.css` uses; and `test.use( recorded )` on an
idle spec.

The mutation matrix ran 66 rows, all as predicted: 18 on `develop`, where each
planted form and narrowed walk stayed GREEN, and 48 on the new tree, where
each turned a guard RED. Eight of those prove a cross-check alone, with its
floor switched off. The two workflow floors count #459's probe workflows, and
say so. Appendices A and B below remain the census at `6d07d37`.

## Group 3: plain counts, done

9 `searched` calls passed a number (`text.length`, `result.scanned`,
`readings.length` …), which `searched` takes on trust. Each was read for
whether the count is of the judged unit, and whether an array could be
passed instead so the control content-checks it (#446 Group 3, plan
`docs/superpowers/plans/2026-10-03-guard-audit-group-3.md`).

| Site | Reading | Now |
| --- | --- | --- |
| `absence-liveness` verdict | Its floor sat at 398 under a real 421: Groups 2a and 2b grew the suite the same day, and growth never fails a floor. No cross-check. `expect.soft(x).toEqual([])` was not read, and any root but `expect(` was skipped rather than refused. | The list of sites; floor 420; `expect.soft` read; any other root refused by name, except a polled value; a raw-text cross-check that each of 113 files writing an absence was read. |
| `pipeline-wiring` step summary | Judged per step, so a step that tees one line and appends the next with `>>` passed. No floor. | Judged per write (2 measured), floor 1, cross-checked against the `visual` job's raw YAML. |
| `classroom-groups-roster` touch targets | `controls.count()` counted hidden controls too, while the measurement judged rendered ones: a roster whose controls all stopped rendering passed. | The measured list. |
| `rendered-text`, both page scans | Characters include whitespace, so a page rendered blank counted as searched. | The page's words. |
| `palette-controls`, `theme` | The count of the very array. | The array: form only. |
| `anchored-presence` | Count of the judged unit; floor 75 under a measured 76, tight. | Unchanged. Its population is defined by dataflow, which no raw-text reading reproduces, so it still has no cross-check. |
| `evidence-page` deletions | `toHaveLength(1)` on the population itself, exact. | Unchanged: sound. |

Fail-closed reading found one site at once: `evidence-page.spec.ts:234`
spells `expect` and `.poll(` on two lines, which a one-line search for
`expect.poll(` cannot see. It polls an in-flight counter to 0, a value, so it
is exempt by the same rule that exempts `expect(k).toBe(0)`.

Review pass 1 found the cross-check blind to a count held to 0
(`expect(x.length).toBe(0)`), which the reader reads; it now reads that too,
its spellings are planted, and each new branch has a matrix row. The matrix
ran 22 rows, all as predicted: 6 on `develop`, where each stayed GREEN, and
16 on the new tree, where 15 turned a guard RED and one, a shell comment
naming the summary, stayed GREEN as the exclusion intends. Two prove a
cross-check alone, with its floor switched off. Removing a `tee` from
`ci.yml` was not a gap: on `develop` a sibling test ('prints the container
architecture into the job summary') already catches it, so the matrix blinds
the guard's reader instead.

## Group 4: loop-built findings, next

41 `searched` calls build their findings by pushing inside a loop, which
the one-hop check cannot follow. Each is read for whether the loop runs
over the population `of` names.

## Group 5: rendered-page floors, next

The e2e floors on what a page rendered (`classroom-groups-controls.spec.ts`
518, 575, 657, 1760; `feature-words.spec.ts:302`) are runtime populations.
They are measured per page in the container, since a layout count measured
on macOS is not the one CI reads.

## Side findings

- **#465**: `scripts/release-inventory.mjs` selects a test as capturing only
  through a bare `shoot(` call, so a spec capturing through a namespace
  import would be left off the release page. No spec does today.
- **#462**: 169 loops over a population known before the run sit inside a
  single test body, which one-test-per-case does not flag because they
  change no state. The operator decided on 2026-10-03 to widen the guard.

## Appendix A: every `searched(…)` call, derived

256 calls in 94 files: 154 findings drawn from it, 41 loop-built, 39 file-level, 13 self-test of searched, 9 count.

| Site | Test | `of` (liveness unit) | Findings (judged unit) | Bucket | Status |
| --- | --- | --- | --- | --- | --- |
| `device/ios/journeys.journey.ts:986` | Journey 14 -- iOS-only, ${shape.what}: ${shape.count} pupils in ${sha… | `seen.cards` | `seen.unreachable` | findings drawn from it | sound at one hop: findings are built from the population |
| `e2e/baseurl-guard.spec.ts:25` | every baseURL-aware API call on a relative URL is one the device fixt… | `calls` | `findings` | findings drawn from it | sound at one hop: findings are built from the population |
| `e2e/chrome.spec.ts:87` | ${locale}: the footer names no company, and still reaches a person | `DISSOLVED_COMPANY` | `printed` | loop-built | to read |
| `e2e/classroom-groups-controls.spec.ts:595` | no horizontal scroll at ${width}px with any single section open — ${p… | `ids` | `failures` | loop-built | to read |
| `e2e/classroom-groups-print.spec.ts:917` | every row still declares its own absence after ${what} | `flags` | `flags` | findings drawn from it | sound at one hop: findings are built from the population |
| `e2e/classroom-groups-print.spec.ts:988` | showing absent pupils prints every column, including Absent | `columns` | `columns` | findings drawn from it | sound at one hop: findings are built from the population |
| `e2e/classroom-groups-print.spec.ts:1017` | hiding absent pupils removes the Absent column and only that column | `columns` | `columns` | findings drawn from it | sound at one hop: findings are built from the population |
| `e2e/classroom-groups-print.spec.ts:1047` | hiding the letters removes Sex, Together and Apart, and only those | `columns` | `columns` | findings drawn from it | sound at one hop: findings are built from the population |
| `e2e/classroom-groups-privacy.spec.ts:130` | and nothing about them is written to storage | `stored` | `leaked` | findings drawn from it | sound at one hop: findings are built from the population |
| `e2e/classroom-groups-privacy.spec.ts:167` | ${path}: no control holding typed text is submittable | `named` | `leaky` | findings drawn from it | sound at one hop: findings are built from the population |
| `e2e/classroom-groups-privacy.spec.ts:288` | submitting cannot put a class list in the URL | `keys` | `keys.filter((key) => !NON_PERSONAL_NAME…` | findings drawn from it | sound at one hop: findings are built from the population |
| `e2e/classroom-groups-projector.spec.ts:708` | (module level) | `seen.cards` | `seen.unreachable` | findings drawn from it | sound at one hop: findings are built from the population |
| `e2e/classroom-groups-roster.spec.ts:1904` | no dropdown ever truncates its own column name -- ${path} at ${width}… | `boxes.map((box) => box.label)` | `findings` | findings drawn from it | sound at one hop: findings are built from the population |
| `e2e/classroom-groups-roster.spec.ts:1996` | every roster control meets the 44px touch target with a placeholder s… | `await controls.count()` | `small` | count | fixed (Group 3): the measured, rendered list |
| `e2e/copy-reaches-a-page.spec.ts:291` | ${locale}: no defined copy renders nowhere | `defined` | `missing` | loop-built | to read |
| `e2e/copy-reaches-a-page.spec.ts:295` | ${locale}: no defined copy renders nowhere | `defined` | `wronglyAllowed` | loop-built | to read |
| `e2e/copy-reaches-a-page.spec.ts:305` | ${locale}: no defined copy renders nowhere | `[...seen]` | `phantom` | findings drawn from it | sound at one hop: findings are built from the population |
| `e2e/copy-reaches-a-page.spec.ts:330` | every page in every locale | `pages` | `naming` | file-level | done in Group 2a: judged unit, floor, cross-check |
| `e2e/disabled-controls.spec.ts:280` | (module level) | `reachable.map((a) => a.label)` | `reachable` | findings drawn from it | sound at one hop: findings are built from the population |
| `e2e/disabled-controls.spec.ts:314` | (module level) | `painted.map((a) => a.label)` | `painted` | findings drawn from it | sound at one hop: findings are built from the population |
| `e2e/disabled-controls.spec.ts:393` | (module level) | `seen.map((r) => r.label)` | `seen` | findings drawn from it | sound at one hop: findings are built from the population |
| `e2e/disabled-controls.spec.ts:431` | default state — every disabled control shows the no-entry cursor | `reachable` | `reachable.filter((a) => !a.uaPainted).m…` | findings drawn from it | sound at one hop: findings are built from the population |
| `e2e/disabled-controls.spec.ts:472` | ${theme}: the disabled placeholder option is excluded deliberately, a… | `excluded` | `excluded` | findings drawn from it | sound at one hop: findings are built from the population |
| `e2e/disabled-controls.spec.ts:495` | only checkbox, radio and file inputs are left to the UA to paint | `carvedOut` | `carvedOut` | findings drawn from it | sound at one hop: findings are built from the population |
| `e2e/disabled-controls.spec.ts:518` | the no-entry cursor marks the disabled controls apart from the enable… | `enabled.map((control) => control.label)` | `leaked` | findings drawn from it | sound at one hop: findings are built from the population |
| `e2e/disabled-controls.spec.ts:559` | at 320px every disabled control keeps a 44px target, and the page doe… | `measured.map((a) => a.label)` | `small` | findings drawn from it | sound at one hop: findings are built from the population |
| `e2e/header-room.spec.ts:221` | (module level) | `rows` | `thin` | loop-built | to read |
| `e2e/header-room.spec.ts:225` | (module level) | `rows` | `findings` | loop-built | to read |
| `e2e/locale-beta.spec.ts:174` | ${locale}: the badge's spoken label keeps the page's language, even i… | `voices` | `misvoiced` | findings drawn from it | sound at one hop: findings are built from the population |
| `e2e/not-found-report.spec.ts:175` | ${locale}: every control is at least 44px and every text meets AA | `read` | `failing` | loop-built | to read |
| `e2e/palette-controls.spec.ts:154` | ${path}, ${theme}: every control it paints uses a palette colour | `readings.length` | `offPalette` | count | fixed (Group 3): the array, form only |
| `e2e/print-legibility.spec.ts:156` | ${path}, ${saved ? `${saved} saved over a ${device} device` : `a ${de… | `inks` | `illegible` | findings drawn from it | sound at one hop: findings are built from the population |
| `e2e/print-legibility.spec.ts:226` | ${theme}: a disabled control never depends on its fill reaching paper | `painted.rendered` | `painted.found` | findings drawn from it | sound at one hop: findings are built from the population |
| `e2e/recorders.ts:159` | (module level) | `seen` | `[...consoleErrors, ...uncaught]` | loop-built | to read |
| `e2e/recorders.ts:172` | (module level) | `seen` | `uncaught` | loop-built | to read |
| `e2e/rendered-text.spec.ts:378` | ${path}: no sentence loses a space | `text.length` | `findings` | count | fixed (Group 3): the page's words |
| `e2e/rendered-text.spec.ts:420` | ${path}: no two words are rendered touching | `width` | `findings` | loop-built | to read |
| `e2e/rendered-text.spec.ts:441` | ${path}: no unfilled [[placeholder]] reaches the page | `text.length` | `findings` | count | fixed (Group 3): the page's words |
| `e2e/report-completeness.spec.ts:112` | ${pagePath(pageId, locale)}: every catalogue string on the page is re… | `found` | `missing` | findings drawn from it | sound at one hop: findings are built from the population |
| `e2e/report-form.spec.ts:82` | ${locale}: every control is at least 44px, every text meets AA, every… | `read` | `failing` | loop-built | to read |
| `e2e/report-presence.spec.ts:44` | a built page with a footer carries the form exactly when its locale i… | `footed.map(({ file }) => file)` | `findings` | findings drawn from it | sound at one hop: findings are built from the population |
| `e2e/text-over-ribbon.spec.ts:231` | ${theme} at ${width}px: every text run over the ribbon clears AA -- $… | `scan.seen` | `failing` | findings drawn from it | sound at one hop: findings are built from the population |
| `e2e/thai-typography.spec.ts:135` | no Thai glyph draws beyond its line box -- ${route} at ${width}px, ${… | `examined` | `offenders` | findings drawn from it | sound at one hop: findings are built from the population |
| `e2e/theme-script.spec.ts:122` | ${path}: runs it before the first paint: inline, classic, in <head>, … | `sheets` | `theme.sheetsBefore` | file-level | sound: judges the unit it counts |
| `e2e/theme.spec.ts:565` | ${path} at ${width}px: no element moves between dark and light | `compared.length` | `moved` | count | fixed (Group 3): the array, form only |
| `e2e/visual.spec.ts:134` | (module level) | `held` | `stillSticky` | loop-built | to read |
| `e2e/zoom-on-focus.spec.ts:56` | ${path}: every typed field computes to at least ${IOS_ZOOM_FLOOR_PX}px | `controls` | `controls.filter((c) => !(c.fontSize >= …` | findings drawn from it | sound at one hop: findings are built from the population |
| `shytalk-links.ts:45` | (module level) | `hosts` | `wrongHost` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/absence-liveness.test.ts:234` | finds none whose population could be empty without saying so | `result.absences` | `result.findings` | count | fixed (Group 3): the site list, floor 420, cross-check, fail-closed |
| `unit/anchored-presence.test.ts:307` | finds none reading raw source with an unanchored matcher | `result.scanned` | `result.findings` | count | sound (Group 3): judged unit, floor tight; no cross-check |
| `unit/astro-css-strip.test.ts:121` | scans no comment that the per-style read removes | `comments` | `survivors` | loop-built | to read |
| `unit/back-translate.test.ts:934` | reads every locale back into English and writes the review | `engine.sent` | `engine.sent.filter((text) => /[{}]/.tes…` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/back-translate.test.ts:1076` | fails loudly without an engine, before writing or sending anything | `engine.log` | `translateRequests(engine)` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/back-translate.test.ts:1112` | refuses an engine that cannot read a locale, before sending anything | `engine.log` | `translateRequests(engine)` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/board-geometry.test.ts:44` | still names the things it measures once serialised | `needles` | `missing` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/board-geometry.test.ts:86` | is spelled in exactly one place under tests/ | `files` | `spelling` | file-level | sound: judges the unit it counts |
| `unit/browser-matrix.test.ts:101` | names specs that actually exist | `CONTENT_ONLY_SPECS` | `missing` | file-level | sound: judges the unit it counts |
| `unit/browser-matrix.test.ts:131` | holds only specs whose verdict cannot depend on the engine or viewport | `CONTENT_ONLY_SPECS` | `engineDependent` | file-level | no cross-check found beside it yet; read in Group 2 |
| `unit/browser-matrix.test.ts:248` | is excluded from every OTHER project | `others.map((p) => p.name)` | `claimants` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/browser-matrix.test.ts:380` | lets no device project claim the visual suite | `projects.map((p) => p.name)` | `claimants` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/browser-matrix.test.ts:396` | still runs every other e2e spec on the phone, content-only ones inclu… | `CONTENT_ONLY_SPECS` | `dropped` | file-level | sound: judges the unit it counts |
| `unit/browser-matrix.test.ts:433` | claims no spec that compares against a stored snapshot | `claimed` | `comparing` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/browser-matrix.test.ts:569` | runs every resolved project light or dark, never the default | `projects` | `undeclared` | loop-built | to read |
| `unit/browser-matrix.test.ts:588` | refuses test.only under CI, in every Playwright config | `configs` | `lax` | file-level | sound: judges the unit it counts |
| `unit/browser-matrix.test.ts:629` | resolves retries to 0 in every Playwright config and project, under CI | `configs` | `retrying` | file-level | sound: judges the unit it counts |
| `unit/browser-matrix.test.ts:656` | passes no --retries but 0 in any workflow step or package script | `commands` | `retrying` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/capture-after-assertion.test.ts:108` | is reading real captures, so a clean scan means something | `captures` | `captures` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/cli-only.test.ts:89` | is imported by nothing the site ships | `shipped()` | `offenders` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/closes-over-nothing.ts:33` | (module level) | `lines` | `imports` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/closing-keywords.test.ts:138` | leaves every safe phrasing alone | `ACCEPTED.map(({ text }) => text)` | `wrongly` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/closing-keywords.test.ts:417` | never expands the body into a shell command | `only?.runs ?? []` | `expanded` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/collection-needs-no-build.test.ts:375` | no file under tests/ reads dist/ while the suite is collected | `builtLiterals(bound)` | `collectionReads(bound)` | loop-built | to read |
| `unit/colour-literals.test.ts:199` | writes no colour literal outside tokens.css but the allowed ones | `found.map(describeLiteral)` | `refused` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/colour-literals.test.ts:222` | allows nothing the reader cannot find | `found.map(describeLiteral)` | `idle` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/colour-literals.test.ts:233` | reads CSS by rule and skips paper, and reads code whole | `control` | `literalsIn('x.css', '@media print { .a …` | loop-built | to read |
| `unit/contrast.test.ts:340` | ${theme}: every declared pair clears its required ratio, over the wor… | `PAIRS` | `failures` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/contrast.test.ts:386` | ${theme}: pins the disabled fill, and keeps it off every ground it is… | `grounds` | `collisions` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/contrast.test.ts:408` | ${theme}: every colour token is classified — paired or explicitly dec… | `all` | `unclassified` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/contrast.test.ts:526` | no control selector draws its boundary with --border | `usages` | `offenders` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/contrast.test.ts:538` | every --border usage is classified as control or decorative | `usages` | `unclassified` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/contrast.test.ts:572` | calls a border decorative only where the reader finds one | `usages` | `stale` | loop-built | to read |
| `unit/contrast.test.ts:584` | names a control only where the reader finds that selector | `selectors` | `stale` | loop-built | to read |
| `unit/contrast.test.ts:627` | no component paints a disabled control for itself | `painted.map((usage) => `${usage.file} :…` | `elsewhere` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/csv.test.ts:159` | shares no header word between any two locales | `localePairs()` | `collisions` | loop-built | to read |
| `unit/csv.test.ts:214` | gives no token two different meanings across locales | `[...meanings]` | `conflicts` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/csv.test.ts:1171` | every locale survives an export/import round trip with sex intact | `[...LOCALES]` | `lost` | loop-built | to read |
| `unit/csv.test.ts:1201` | the sex header agrees with the roster column the teacher sees | `[...LOCALES]` | `drift` | loop-built | to read |
| `unit/csv.test.ts:1223` | the sex tokens are the letters the roster offers the teacher | `[...LOCALES]` | `drift` | loop-built | to read |
| `unit/csv.test.ts:1247` | the class comment names the class the way the page's own field does | `[...LOCALES]` | `drift` | loop-built | to read |
| `unit/csv.test.ts:1318` | correcting the sex header moved nothing else, in any locale | `[...LOCALES]` | `moved` | loop-built | to read |
| `unit/csv.test.ts:1357` | writes an empty cell for sex, together and apart in every locale | `[...LOCALES]` | `leaked` | loop-built | to read |
| `unit/custom-properties.test.ts:127` | every var() in src names a property src defines | `[...properties.read.keys()]` | `undefinedReads(properties)` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/dashboard-paths.test.ts:51` | spells each shared path in the harness, and only there | `NEEDLES.map(String)` | `spelledIn(dashboard)` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/dead-copy.test.ts:72` | the tool locale defines nothing that no page renders | `defined` | `unused` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/dead-copy.test.ts:83` | every error code the copy defines is rendered by renderError | `defined` | `unused` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/dead-copy.test.ts:101` | every warning code the copy defines is rendered by renderWarning | `defined` | `unused` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/dead-copy.test.ts:121` | the site-wide copy defines nothing that no page renders | `groups` | `unused` | loop-built | to read |
| `unit/dependabot-labels.test.ts:58` | come from the parsed document, so a comment cannot add one | `declaredLabels(withComment)` | `declaredLabels(withComment).filter((nam…` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/dependabot-labels.test.ts:143` | runs inside ${REQUIRED_JOB} or a job it stands for, the context branc… | `runs` | `runs.filter((run) => run.includes('scri…` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/deprecated-css.test.ts:83` | finds none in any stylesheet under src/ | `sheets.map(({ css }) => css)` | `findings` | file-level | done in Group 2a: judged unit, floor, cross-check |
| `unit/device-tool-homes.test.ts:38` | reads every call site through the one home | `files` | `spawning` | file-level | no cross-check found beside it yet; read in Group 2 |
| `unit/device-tool-homes.test.ts:68` | only scripts/adb.mjs decides which listed device is ready | `files` | `reading` | file-level | sound: judges the unit it counts |
| `unit/duplicate-imports.test.ts:150` | src, scripts and tests each import a module once | `sources` | `repeated` | file-level | done in Group 2a: judged unit, floor, cross-check |
| `unit/duplication.test.ts:126` | finds no cross-file duplicate that has not been given a verdict | `DECLARATIONS` | `findings` | loop-built | to read |
| `unit/duplication.test.ts:139` | carries no verdict for a pair that no longer exists | `recorded` | `recorded.filter((key) => !live.has(key))` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/event-collectors.test.ts:499` | every .all() loop proves its locator is not empty first | `SCANNED` | `unproved` | file-level | done in Group 2a: judged unit, floor, cross-check |
| `unit/evidence-page.test.ts:1064` | never deletes a directory the operator was asked to keep | `deletions.length` | `deletions` | count | sound (Group 3): exact toHaveLength(1) |
| `unit/evidence-page.test.ts:1247` | has no consumer spelling an evidence filename for itself | `consumers` | `respellings` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/evidence-page.test.ts:1586` | emits only media references the artifact serves | `srcs` | `unservable` | file-level | sound: judges the unit it counts |
| `unit/evidence-page.test.ts:1663` | references every recording it was given | `keys` | `unreferenced` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/evidence-recording.test.ts:261` | keeps video in one home: no spec spells it itself | `SPECS` | `spelled` | file-level | sound: judges the unit it counts |
| `unit/evidence-recording.test.ts:275` | every spec that acts declares test.use(recorded) | `SPECS` | `missing` | file-level | no cross-check found beside it yet; read in Group 2 |
| `unit/evidence-recording.test.ts:287` | no spec declares test.use(recorded) without acting | `SPECS` | `idle` | file-level | no cross-check found beside it yet; read in Group 2 |
| `unit/evidence-recording.test.ts:305` | every construct in the vocabulary is detectable | `ACTIONS` | `undetected` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/evidence-recording.test.ts:309` | every construct in the vocabulary is detectable | `ACTIONS` | `actionsIn("await expect(page).toHaveTit…` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/evidence-recording.test.ts:316` | every construct in the vocabulary is detectable | `ACTIONS` | `actionsIn("test('x', async () => { awai…` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/evidence-recording.test.ts:351` | no journey in a recording spec records blank frames (#292) | `journeys.map((journey) => journey.where)` | `blank.map((journey) => journey.where)` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/excluded-by-design.test.ts:86` | never spells a --grep pattern out as a literal again | `strings` | `literals` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/feature-terms.test.ts:349` | %s: every piece of copy that names a feature carries an approved word… | `naming(units)` | `misses.map(({ key, missing }) => `${key…` | loop-built | to read |
| `unit/feature-terms.test.ts:386` | %s: every approved word is in use, so none is a typo or a stale appro… | `FEATURES.flatMap((feature) => glossaryO…` | `unused` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/git-env.test.ts:81` | are unset before any test file runs | `vars` | `vars.filter((name) => process.env[name]…` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/gloryPoints.test.ts:171` | no translated site catalogue reuses one of English’s functions | `[...english]` | `reused` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/grouping.test.ts:1969` | spreads the girls across different groups even when the numbers do no… | `seeds` | `bothTogether` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/i18n.test.ts:131` | Indonesian is actually translated, not copied English | `idStrings` | `identical.filter((k) => !ALLOWED_IDENTI…` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/i18n.test.ts:1577` | no site string is blank in either language | `strings` | `blank` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/i18n.test.ts:1603` | the visible prose is genuinely translated, not copied English | `idLeaves` | `identical` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/install-scripts.test.ts:121` | pins every approval to a version | `approved` | `unpinned` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/install-scripts.test.ts:137` | approves rather than denies — a false value blocks the install | `approvals` | `denied` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/label-check.test.ts:414` | %s: every sentence that names a label carries that label | `verdicts` | `verdicts .filter(({ carried }) => !carr…` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/literal-grounds.test.ts:197` | every literal ground under src/ paints a literal ink, or is exempt wi… | `grounds.map(describeGround)` | `offending(grounds).map(describeGround)` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/literal-grounds.test.ts:210` | no rule under src/ puts token ink on text inside a literal ground | `grounds.map(describeGround)` | `inside.map(describeInkInside)` | loop-built | to read |
| `unit/literal-grounds.test.ts:259` | leaves alone what carries its own ground, what is not inside, and pap… | `control` | `leftAlone.map(describeInkInside)` | loop-built | to read |
| `unit/literal-grounds.test.ts:272` | exempts only grounds the reader finds | `grounds.map(describeGround)` | `idle` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/literal-grounds.test.ts:288` | joins a selector split over several rules, keeping the last of each p… | `split` | `offending(split)` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/literal-grounds.test.ts:307` | joins a selector split over several rules, keeping the last of each p… | `literal` | `handedToAToken` | loop-built | to read |
| `unit/literal-grounds.test.ts:317` | reads a token with a literal fallback as a token, on the ground and o… | `literal` | `literalGrounds('x.css', '.a { backgroun…` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/locale-fallbacks.test.ts:112` | ${locale}: no message is still English | `messages` | `sameAsEnglish(table, isMessage)` | loop-built | to read |
| `unit/locale-fallbacks.test.ts:136` | ${locale}: has no empty or whitespace-only copy | `paths` | `blank` | file-level | sound: judges the unit it counts |
| `unit/locale-metadata.test.ts:47` | covers every locale that is actually routed | `LOCALES` | `undescribed` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/locale-metadata.test.ts:201` | covers every routed locale | `LOCALES` | `wrong` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/message-parity.test.ts:149` | %s takes nothing from English but its type | `fromEnglish.map((declaration) => declar…` | `fromEnglish .filter(bindsAValue) .map((…` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/message-parity.test.ts:173` | %s fills the slots English fills, in every string | `ENGLISH.map(([path]) => path)` | `differing` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/message-parity.test.ts:196` | %s offers every choice of sentence English offers | `choosing.map(([path]) => path)` | `differing` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/message-parity.test.ts:237` | every plural offers exactly the forms its language has | `plurals.map(({ where }) => where)` | `wrong` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/no-dated-render.test.ts:34` | no .astro source reads the date, in its code or its markup | `sources` | `dated` | file-level | done in Group 2a: judged unit, floor, cross-check |
| `unit/one-test-per-case.test.ts:282` | loops no known population inside a test | `tests` | `sites` | loop-built | to read |
| `unit/one-test-per-case.test.ts:295` | reads the tests every spec declares, and as many as there are | `specDirs().flatMap(tsFilesUnder)` | `unread` | loop-built | to read |
| `unit/organisation-name.test.ts:61` | only the one historic fixture outside the dated docs | `files` | `hits.filter((hit) => !KEPT.includes(hit…` | file-level | sound: judges the unit it counts |
| `unit/pipeline-wiring.test.ts:215` | (module level) | `blocks` | `owning` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/pipeline-wiring.test.ts:282` | no job in any workflow is silently skipped by a skip upstream of it (… | `downstream` | `findings` | loop-built | to read |
| `unit/pipeline-wiring.test.ts:362` | the dispatch path grants the workflow it calls every permission its j… | `asked` | `refused` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/pipeline-wiring.test.ts:535` | every job that reads a secret other than GITHUB_TOKEN names an enviro… | `readers.map(({ where }) => where)` | `unplaced` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/pipeline-wiring.test.ts:592` | a Cloudflare secret is read only in the environment of what its job d… | `readers.map(({ where }) => where)` | `misplaced` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/pipeline-wiring.test.ts:624` | only the waiting-reports count reads secrets in reports-count, or its… | `jobs.filter(({ job }) => job.environmen…` | `strays` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/pipeline-wiring.test.ts:649` | no job that deploys or verifies prod reads a secret meant for dev (#2… | `prodJobs.map(({ where }) => where)` | `leaks` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/pipeline-wiring.test.ts:935` | documents only a context something in this repository can report | `claims.map(({ context }) => context)` | `findings` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/pipeline-wiring.test.ts:967` | never calls a deploy a release | `deploys` | `findings` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/pipeline-wiring.test.ts:1044` | no workflow names a workflow file that does not exist | `workflows` | `dangling` | file-level | done in Group 2a: judged unit, floor, cross-check |
| `unit/pipeline-wiring.test.ts:1171` | is not bypassed by any workflow calling Playwright directly | `workflowFileNames()` | `bypasses.map(({ file, line }) => `${fil…` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/pipeline-wiring.test.ts:1224` | takes the image the baselines are captured in from one selector | `workflows` | `named` | file-level | no cross-check found beside it yet; read in Group 2 |
| `unit/pipeline-wiring.test.ts:1354` | no artifact capture in any workflow is set to ignore | `steps` | `silent` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/pipeline-wiring.test.ts:1365` | every artifact capture states what an empty capture means | `steps` | `undeclared` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/pipeline-wiring.test.ts:1408` | every astro server script opts out of the agent auto-background | `scripts.map(([, command]) => command)` | `unguarded` | file-level | sound: judges the unit it counts |
| `unit/pipeline-wiring.test.ts:1506` | no checkout in any workflow leaves the job token in .git/config (#395) | `checkouts.map(({ where }) => where)` | `findings` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/pipeline-wiring.test.ts:1519` | no job in any workflow runs on the runner default budget | `graphs.flatMap(({ jobs }) => jobs)` | `findings` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/pipeline-wiring.test.ts:1539` | every job running the e2e suite carries exactly the shard budget | `suites` | `offBudget` | file-level | no cross-check found beside it yet; read in Group 2 |
| `unit/pipeline-wiring.test.ts:1688` | no job running the e2e suite builds the site before it | `suites` | `prebuilt` | file-level | no cross-check found beside it yet; read in Group 2 |
| `unit/pipeline-wiring.test.ts:1746` | every upload in a matrix job names its leg | `uploads` | `shared` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/pipeline-wiring.test.ts:1783` | pins an image rather than a label that migrates under it | `all.map(({ label }) => label)` | `floating` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/pipeline-wiring.test.ts:1820` | prints the container architecture into the job summary | `visualRuns()` | `recording` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/pipeline-wiring.test.ts:1942` | lets a fallback test the status of the command producing its text | `lines.map(({ line }) => line)` | `findings` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/pipeline-wiring.test.ts:1961` | writes its numbers where they can be read back, not only to the summa… | `summaryWriters.length` | `unreadable` | count | fixed (Group 3): judged per write, floor, cross-check |
| `unit/pipeline-wiring.test.ts:2029` | uploads the gate diff and the measurement diff together (#311) | `paths` | `unreadable` | file-level | sound: judges the unit it counts |
| `unit/pipeline-wiring.test.ts:2149` | clears every per-group report before a run, now that nothing wipes th… | `reports` | `uncleared` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/pipeline-wiring.test.ts:2161` | nests none inside another, which a parent wipe would take with it | `dirs` | `nested` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/pipeline-wiring.test.ts:2190` | every workflow states a workflow-level permissions block | `declared.map(({ file }) => file)` | `inheritedPermissionsFindings(declared)` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/pipeline-wiring.test.ts:2241` | no workflow a pull request can start grants a write scope to a silent… | `onPullRequest.map(({ file }) => file)` | `writes` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/pipeline-wiring.test.ts:2319` | lets the script name the engine from its Dockerfile | `steps` | `typed` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/pipeline-wiring.test.ts:2332` | can go red: nothing in it continues on error | `steps` | `excused` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/pipeline-wiring.test.ts:2387` | starts for a pull request that changes anything it reads | `inputs` | `unwatched` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/pipeline-wiring.test.ts:2419` | no workflow installs it globally | `workflows.map(({ text }) => text)` | `globalInstalls` | file-level | no cross-check found beside it yet; read in Group 2 |
| `unit/pipeline-wiring.test.ts:2434` | every deploy runs the locked copy | `deploys` | `deploys.filter((line) => !line.includes…` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/pipeline-wiring.test.ts:2553` | runs every other Playwright job in the image the `image` job picks | `jobs.map(({ where }) => where)` | `astray` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/playwright-declarations.test.ts:312` | no tag or use option is written in a form the guards would misread | `declarations.map(({ title }) => title)` | `unreadable` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/playwright-declarations.test.ts:350` | the only shared options object is the recording opt-in, from its home | `sharedUses` | `wrong` | loop-built | to read |
| `unit/release-inventory.test.ts:385` | can see every capture: no module but a spec calls shoot | `modules` | `capturing` | file-level | no cross-check found beside it yet; read in Group 2 |
| `unit/release-prose.test.ts:26` | finds none of any release file’s sentences in the scripts that render… | `phrases` | `phrases.filter((p) => code.includes(p))` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/report-review.test.ts:575` | makes none, and says so per report, without BACK_TRANSLATE_URL | `recorded.all` | `recorded.before` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/report-review.test.ts:607` | never calls the engine when no report needs it | `recorded.all` | `recorded.before` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/route-coverage.test.ts:143` | hardcodes no locale-prefixed route in any deploy gate | `specs` | `found` | file-level | no cross-check found beside it yet; read in Group 2 |
| `unit/sanity-on-build.test.ts:174` | runs at least one test from every spec file in ${testDir} | `specFiles` | `silent` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/sanity-on-build.test.ts:195` | each says, where it is written, why only the deployed site can answer… | `tagged` | `unexplained` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/sanity-on-build.test.ts:208` | are left out of the on-build run, and nothing else is | `tagged` | `leaked` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/scoped-classes.test.ts:253` | holds for every .astro file under src/ | `all.flatMap(({ named }) => named)` | `dead` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/scoped-classes.test.ts:266` | can read every class those files write | `all.flatMap(({ read }) => read)` | `unreadable` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/scratch-git-home.test.ts:79` | no call anywhere else hands git a cwd | `calls` | `calls .filter((call) => call.cwd && cal…` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/script-entry.test.ts:649` | reads every file under scripts/ | `files` | `unread` | file-level | sound: judges the unit it counts |
| `unit/script-entry.test.ts:656` | never reads process.argv[1] | `modules` | `reads` | file-level | done in Group 2a: judged unit, floor, cross-check |
| `unit/script-entry.test.ts:663` | decides on import.meta.main alone | `decisions` | `wrong` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/script-entry.test.ts:784` | leaves every effect to an import.meta.main decision | `modules` | `work` | file-level | done in Group 2a: judged unit, floor, cross-check |
| `unit/shipped-defaults.test.ts:496` | refuses an expectation a roster-building test could not have written | `all` | `all .filter((collision) => collision.af…` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/shytalk-brand.test.ts:137` | is spelled out nowhere else in the repo | `files` | `offenders` | file-level | no cross-check found beside it yet; read in Group 2 |
| `unit/shytalk-showcase.test.ts:98` | has a capture for every locale the site serves | `LOCALES` | `missing` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/shytalk-showcase.test.ts:113` | gives every locale its OWN capture, not one file under five names | `captures` | `shared` | loop-built | to read |
| `unit/shytalk-showcase.test.ts:127` | authors every capture at exactly the 2x frame size, and no larger | `captures` | `wrongSize` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/shytalk-showcase.test.ts:136` | stores every capture as a PNG, so the size read above is meaningful | `captures` | `notPng` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/shytalk-showcase.test.ts:146` | keeps every capture inside the per-visit weight budget | `captures` | `tooHeavy` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/source-files.test.ts:37` | skips dotfiles and node_modules, which only four of the nine did | `all` | `all.filter((path) => path.split('/').so…` | self-test of searched | sound: tests the control itself |
| `unit/source-files.test.ts:43` | skips dotfiles and node_modules, which only four of the nine did | `all` | `all.filter((path) => path.includes('nod…` | self-test of searched | sound: tests the control itself |
| `unit/source-files.test.ts:113` | returns the findings untouched, so the caller still owns the verdict | `['x', 'y']` | `findings` | self-test of searched | sound: tests the control itself |
| `unit/source-files.test.ts:117` | refuses a population that is empty | `[]` | `[]` | self-test of searched | sound: tests the control itself |
| `unit/source-files.test.ts:122` | refuses a population of BLANK strings -- #112 exactly | `['', ' ', '']` | `[]` | self-test of searched | sound: tests the control itself |
| `unit/source-files.test.ts:128` | refuses a population of empty containers | `[[], {}]` | `[]` | self-test of searched | sound: tests the control itself |
| `unit/source-files.test.ts:135` | refuses a population of null and undefined | `[null, undefined]` | `[]` | self-test of searched | sound: tests the control itself |
| `unit/source-files.test.ts:142` | accepts a population where only SOME members carry content | `['', 'real']` | `[]` | self-test of searched | sound: tests the control itself |
| `unit/source-files.test.ts:146` | accepts a plain count, which cannot be content-checked | `3` | `[]` | self-test of searched | sound: tests the control itself |
| `unit/source-files.test.ts:147` | accepts a plain count, which cannot be content-checked | `0` | `[]` | self-test of searched | sound: tests the control itself |
| `unit/source-files.test.ts:151` | counts a zero and a false as content -- they are values, not blanks | `[0]` | `[]` | self-test of searched | sound: tests the control itself |
| `unit/source-files.test.ts:152` | counts a zero and a false as content -- they are values, not blanks | `[false]` | `[]` | self-test of searched | sound: tests the control itself |
| `unit/source-files.test.ts:156` | names the population in the message, so a failure says what died | `[]` | `[]` | self-test of searched | sound: tests the control itself |
| `unit/spec-scan.ts:45` | (module level) | `files` | `findings` | file-level | done in Group 2a: judged unit, floor, cross-check |
| `unit/stranded-docblocks.test.ts:126` | reads every source file git tracks | `tracked` | `tracked.filter((path) => !read.has(path…` | file-level | sound: judges the unit it counts |
| `unit/stranded-docblocks.test.ts:167` | finds a docblock in every kind of source that holds one | `held` | `held.filter((kind) => !read.includes(ki…` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/stranded-docblocks.test.ts:176` | finds none sitting directly on another | `SCANS.flatMap((scan) => scan.docblocks)` | `SCANS.flatMap((scan) => scan.stranded)` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/supply-chain.test.ts:116` | every third-party action is pinned to a full commit SHA | `externalUses()` | `unpinned` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/supply-chain.test.ts:127` | every pinned action names the version its SHA resolves to | `externalUses()` | `opaque` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/supply-chain.test.ts:159` | an action repo used at more than one sub-path is grouped into one PR | `externalUses()` | `ungrouped` | loop-built | to read |
| `unit/supply-chain.test.ts:193` | a sub-path group is declared before the catch-all that would swallow … | `ecosystemBlocks()` | `misordered` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/supply-chain.test.ts:263` | builds every Dockerfile FROM a digest, beside the version it names | `fromLines()` | `loose` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/supply-chain.test.ts:283` | has Dependabot watching every directory that holds a Dockerfile | `dockerfiles()` | `unwatched` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/supply-chain.test.ts:366` | is judged again once @astrojs/check accepts TypeScript 7 | `majors` | `majors.filter((major) => major >= 7)` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/temporary-files.test.ts:38` | passes over the run marker and the tools' own caches, each as measured | `kept` | `leakedEntries(dir)` | loop-built | to read |
| `unit/tokens.test.ts:35` | declares no token that nothing reads | `tokens` | `unread` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/tokens.test.ts:71` | declares color-scheme only beside a palette | `declaring` | `stray` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/tokens.test.ts:80` | keeps every dark block screen-only, and has both states it needs | `chains` | `onPaper` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/tokens.test.ts:100` | declares the same tokens, with the same values, in every dark block | `rest` | `drifted` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/tokens.test.ts:112` | defines no token only inside a dark block | `dark` | `orphans` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/tracked-paths.test.ts:35` | every tracked path is made of plain names | `paths` | `strays` | file-level | sound: judges the unit it counts |
| `unit/translate-messages.test.ts:144` | sends no syntax for any real English message | `units` | `withSyntax` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/translate-messages.test.ts:356` | loads every module a script imports from src/ | `modules` | `refused` | file-level | sound: judges the unit it counts |
| `unit/translate.test.ts:414` | round-trips every real catalogue string through the whole pipeline | `collectCatalogue()` | `broken` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/translate.test.ts:561` | holds no draft in the committed cache for English the harness does no… | `Object.values(cache).flatMap((drafts) =…` | `stale` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/translate.test.ts:676` | reports the stale drafts on a dry run and writes nothing | `run.log` | `run.requests` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/translate.test.ts:692` | drops the stale drafts with --prune, with no key and no request | `run.log` | `run.requests` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/translate.test.ts:708` | drops the stale drafts as --send writes, even with nothing to send | `run.log` | `run.requests` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/typecheck-scope.test.ts:85` | no script opts itself out with a ts-nocheck directive | `scripts` | `opted` | file-level | no cross-check found beside it yet; read in Group 2 |
| `unit/typed-fields.test.ts:69` | still names every kind of field once serialised | `needles` | `missing` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/typed-fields.test.ts:102` | is spelled in exactly one place under tests/ | `files` | `spelling` | file-level | sound: judges the unit it counts |
| `unit/verified-labels.test.ts:376` | the pin covers every locale and every roster column, with nothing bla… | `rosterColumnKeys` | `unpinned` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/verified-labels.test.ts:381` | the pin covers every locale and every roster column, with nothing bla… | `values` | `values.filter((value) => value.trim() =…` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/verified-labels.test.ts:439` | every one is pinned or awaiting the operator's read | `witnessed` | `flagged` | loop-built | to read |
| `unit/waiting-reports-script.test.ts:102` | (module level) | `all` | `all.slice(0, -1)` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/workflow-jobs.test.ts:111` | passes the condition deploy-dev.yml ships, judged over a live populat… | `downstream` | `skippedUpstreamFindings(jobs)` | loop-built | to read |
| `unit/workflow-jobs.test.ts:158` | leaves a graph with no conditional job alone | `jobs` | `jobsDownstreamOfAConditionalJob(jobs)` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/workflow-jobs.test.ts:333` | passes whole minutes from 1 to 359, judged over a live population | `jobs` | `unboundedJobFindings(jobs)` | findings drawn from it | sound at one hop: findings are built from the population |
| `unit/workflow-jobs.test.ts:362` | passes a job calling a workflow in this repository, whose own jobs ca… | `jobs` | `unboundedJobFindings(jobs)` | findings drawn from it | sound at one hop: findings are built from the population |

## Appendix B: every numeric floor, derived

163 `toBeGreaterThan(OrEqual)(<number>)` calls. A floor on a population the guard reads is a liveness floor (Group 1); the rest bound a product value (a 44px target, a contrast ratio, a statistic) and are not guard liveness.

| Site | Test | Subject | Floor | Kind |
| --- | --- | --- | --- | --- |
| `device/ios/journeys.journey.ts:604` | Journey 9 -- no horizontal scroll at the real device width | `expect( innerWidth, `a real, nonzero viewpor…` | > 0 | not a liveness floor |
| `device/ios/journeys.journey.ts:693` | Journey 11 -- iOS-only, no zoom on focus: every typed field has a rea… | `expect( fields.length, `at least one typed f…` | > 0 | not a liveness floor |
| `device/ios/journeys.journey.ts:738` | Journey 12 -- iOS-only geometry: viewport, device pixel ratio, and th… | `expect( geometry.innerWidth, `a real, nonzer…` | > 0 | not a liveness floor |
| `device/ios/journeys.journey.ts:742` | Journey 12 -- iOS-only geometry: viewport, device pixel ratio, and th… | `expect( geometry.innerHeight, `a real, nonze…` | > 0 | not a liveness floor |
| `device/ios/journeys.journey.ts:746` | Journey 12 -- iOS-only geometry: viewport, device pixel ratio, and th… | `expect( geometry.devicePixelRatio, `a real, …` | > 0 | not a liveness floor |
| `device/ios/journeys.journey.ts:782` | Journey 13 -- iOS-only, 44px touch targets: primary controls meet the… | `expect( Math.round(rect.width), `#${id} widt…` | >= 44 | not a liveness floor |
| `device/ios/journeys.journey.ts:786` | Journey 13 -- iOS-only, 44px touch targets: primary controls meet the… | `expect( Math.round(rect.height), `#${id} hei…` | >= 44 | not a liveness floor |
| `device/real-device.spec.ts:24` | the suite is running on the real phone, not an emulated profile | `expect(browserSide.touchPoints)` | > 0 | not a liveness floor |
| `e2e/chrome.spec.ts:271` | ${locale} mobile: wordmark, menu button, nav links and footer email a… | `expect( howMany, 'no header disclosures foun…` | > 0 | not a liveness floor |
| `e2e/classroom-groups-controls.spec.ts:258` | an avatar is a small face, not a full-width black circle | `expect(box!.width)` | > 20 | not a liveness floor |
| `e2e/classroom-groups-controls.spec.ts:518` | every control meets the 44px touch target -- ${path} | `expect(seen)` | >= 5 | not a liveness floor |
| `e2e/classroom-groups-controls.spec.ts:575` | no horizontal scroll at ${width}px with any single section open — ${p… | `expect( ids.length, `${path}: no disclosure …` | > 3 | not a liveness floor |
| `e2e/classroom-groups-controls.spec.ts:657` | ${path}: a disclosure label keeps a visible gap between marker, label… | `expect( gaps.length, `${path}: no disclosure…` | > 3 | not a liveness floor |
| `e2e/classroom-groups-controls.spec.ts:662` | ${path}: a disclosure label keeps a visible gap between marker, label… | `expect( g.markerGap, `${path} #${g.id}: mark…` | > 1 | not a liveness floor |
| `e2e/classroom-groups-controls.spec.ts:667` | ${path}: a disclosure label keeps a visible gap between marker, label… | `expect( g.stateGap, `${path} #${g.id}: state…` | > 1 | not a liveness floor |
| `e2e/classroom-groups-controls.spec.ts:1692` | a student number has room to be drawn, not just a value, at ${width}px | `expect( box, `@${width}px the # input has ${…` | > 16 | not a liveness floor |
| `e2e/classroom-groups-controls.spec.ts:1760` | number fields have no spinner, including rows built at runtime | `expect(appearances.length)` | > 2 | not a liveness floor |
| `e2e/classroom-groups-print.spec.ts:652` | legible with no colour at all | `expect(hairs.length)` | > 1 | not a liveness floor |
| `e2e/classroom-groups-projector.spec.ts:134` | no form or site chrome on the board | `expect(Number(boardZ))` | > 0 | not a liveness floor |
| `e2e/classroom-groups-roster.spec.ts:205` | per-row controls meet the 44px touch target -- ${path} | `expect(Math.round(number.height), '# height')` | >= 44 | not a liveness floor |
| `e2e/classroom-groups-roster.spec.ts:476` | ${theme}: the pill text meets the WCAG AA contrast floor | `expect(contrast)` | >= 4.5 | not a liveness floor |
| `e2e/classroom-groups-roster.spec.ts:857` | ${theme}: the gap warning meets the WCAG AA contrast floor | `expect(await contrastRatio(warning))` | >= 4.5 | not a liveness floor |
| `e2e/classroom-groups-roster.spec.ts:1964` | every roster control meets the 44px touch target with a placeholder s… | `expect(await controls.count())` | > 0 | not a liveness floor |
| `e2e/classroom-groups.spec.ts:514` | all six sound assets are reachable from the built site and appear in … | `expect((await response.body()).length)` | > 0 | not a liveness floor |
| `e2e/classroom-groups.spec.ts:1514` | ${theme}: the dim stays above the WCAG AA contrast floor for normal t… | `expect(contrast)` | >= 4.5 | not a liveness floor |
| `e2e/classroom-groups.spec.ts:1534` | ${theme}: the out-of-date sentence meets the WCAG AA contrast floor | `expect(await contrastRatio(sentence))` | >= 4.5 | not a liveness floor |
| `e2e/classroom-groups.spec.ts:2030` | the scroll padding clears the pinned action row at ${width}x${height} | `expect( bar, 'the action row must have a hei…` | > 0 | not a liveness floor |
| `e2e/classroom-groups.spec.ts:2073` | the pinned action row casts a soft shadow upward at ${width}x${height} | `expect( Number(blur), `${width}x${height}: s…` | > 0 | not a liveness floor |
| `e2e/classroom-groups.spec.ts:2186` | ${theme}: the accent colour still meets the WCAG AA contrast floor | `expect(contrast)` | >= 4.5 | not a liveness floor |
| `e2e/copy-reaches-a-page.spec.ts:257` | ${locale}: no defined copy renders nowhere | `expect( pages, 'no built pages — the scan be…` | > 0 | not a liveness floor |
| `e2e/copy-reaches-a-page.spec.ts:262` | ${locale}: no defined copy renders nowhere | `expect(forms, 'no built page carries a repor…` | > 0 | not a liveness floor |
| `e2e/evidence-page.spec.ts:167` | (module level) | `expect .poll( async () => (await counters(pa…` | > 0 | not a liveness floor |
| `e2e/evidence-page.spec.ts:183` | (module level) | `expect .poll( async () => (await counters(pa…` | > 0 | not a liveness floor |
| `e2e/evidence-page.spec.ts:1456` | the notice meets AA contrast in the ${scheme} theme | `expect( await contrastRatio(locator), `the $…` | >= 4.5 | not a liveness floor |
| `e2e/feature-words.spec.ts:302` | ${locale}: every reachable correction reads as approved | `expect(problems.length)` | > 3 | not a liveness floor |
| `e2e/head-and-sitemap.spec.ts:70` | declares the language relationships search engines need | `expect( blocks.length, 'no <url> blocks — th…` | > 0 | not a liveness floor |
| `e2e/helpers.ts:536` | (module level) | `expect(names.length, `${when}: no name to lo…` | > 0 | not a liveness floor |
| `e2e/homepage.spec.ts:95` | ${locale}: every header nav item lands on a section of this page | `expect( fragmented.length, `${home} rendered…` | > 0 | not a liveness floor |
| `e2e/homepage.spec.ts:197` | ${locale}: the showcase frame shows a real room capture | `expect(alt.trim().length, 'alt text')` | > 0 | not a liveness floor |
| `e2e/homepage.spec.ts:210` | ${locale}: the showcase frame shows a real room capture | `expect .poll( () => img.evaluate((el) => (el…` | > 0 | not a liveness floor |
| `e2e/homepage.spec.ts:289` | ${route.name}: the tool badges clear AA as painted | `expect( await contrastRatio(badge), `"${awai…` | >= 4.5 | not a liveness floor |
| `e2e/homepage.spec.ts:368` | call-to-action buttons meet the 44×44px touch target | `expect(Math.round(box!.width))` | >= 44 | not a liveness floor |
| `e2e/homepage.spec.ts:369` | call-to-action buttons meet the 44×44px touch target | `expect(Math.round(box!.height))` | >= 44 | not a liveness floor |
| `e2e/language-switcher.spec.ts:279` | ${locale}: the open dropdown stays inside the viewport at 320px | `expect(box.x, 'dropdown escapes the left edg…` | >= 0 | not a liveness floor |
| `e2e/locale-beta.spec.ts:196` | ${theme}: the badge clears the WCAG AA floor for normal text | `expect(summaryRatio, 'the summary badge')` | >= 4.5 | not a liveness floor |
| `e2e/locale-beta.spec.ts:198` | ${theme}: the badge clears the WCAG AA floor for normal text | `expect(entryRatio, 'the entry badge')` | >= 4.5 | not a liveness floor |
| `e2e/not-found-report.spec.ts:37` | every beta block carries one form posting its own locale, and English… | `expect(BETA.length)` | > 0 | not a liveness floor |
| `e2e/not-found-report.spec.ts:139` | ${locale}: its sent status shows in its language, takes focus, and hi… | `expect(await contrastRatio(shown))` | >= 4.5 | not a liveness floor |
| `e2e/palette-controls.spec.ts:134` | ${path}, ${theme}: every control it paints uses a palette colour | `expect( allowed.length, 'the homepage served…` | > 0 | not a liveness floor |
| `e2e/palette-controls.spec.ts:143` | ${path}, ${theme}: every control it paints uses a palette colour | `expect( readings.length, `${path} rendered n…` | > 0 | not a liveness floor |
| `e2e/print-legibility.spec.ts:142` | ${path}, ${saved ? `${saved} saved over a ${device} device` : `a ${de… | `expect( inks.length, `${path} from a ${scree…` | > 0 | not a liveness floor |
| `e2e/published-paths.ts:38` | (module level) | `expect(paths.length)` | > 0 | not a liveness floor |
| `e2e/recorders.ts:68` | (module level) | `expect( all.length, `${because}: the recorde…` | > 0 | not a liveness floor |
| `e2e/report-presence.spec.ts:52` | a built page with a footer carries the form exactly when its locale i… | `expect( footed.filter(({ html }) => footerOf…` | > 0 | not a liveness floor |
| `e2e/text-over-ribbon.spec.ts:215` | ${theme} at ${width}px: every text run over the ribbon clears AA -- $… | `expect(scan.seen, `${path}: the scan read no…` | > 0 | not a liveness floor |
| `e2e/thai-typography.spec.ts:132` | no Thai glyph draws beyond its line box -- ${route} at ${width}px, ${… | `expect( examined, `${route} at ${width}px, $…` | > 0 | not a liveness floor |
| `e2e/theme.spec.ts:191` | under forced colours, its icon draws in the system text colour (Revie… | `expect( drawn.paints.length, 'the visible ic…` | > 0 | not a liveness floor |
| `prod/prod-smoke.spec.ts:41` | ${path} answers 200 with a real page | `expect(page.body.length, `${path} body bytes…` | > 2000 | not a liveness floor |
| `unit/absence-liveness.test.ts:184` | finds the absence assertions it is meant to be judging | `expect(tsFiles.length)` | > 261 | liveness floor (Group 1) |
| `unit/absence-liveness.test.ts:194` | finds the absence assertions it is meant to be judging | `expect(result.absences)` | > 398 | liveness floor (Group 1) |
| `unit/absence-liveness.test.ts:195` | finds the absence assertions it is meant to be judging | `expect(result.proved)` | > 0 | not a liveness floor |
| `unit/anchored-presence.test.ts:299` | scans the presence assertions that actually read source text | `expect(result.scanned)` | > 75 | liveness floor (Group 1) |
| `unit/anchored-presence.test.ts:302` | scans the presence assertions that actually read source text | `expect(tsFiles.length)` | > 261 | liveness floor (Group 1) |
| `unit/back-translate.test.ts:305` | reads every entry a locale translated, and nothing else | `expect(expected.size, `${locale} translated …` | > 260 | liveness floor (Group 1) |
| `unit/back-translate.test.ts:980` | scores each back-translation against its English | `expect(rows.filter(({ score }) => score > 0)…` | > 0 | not a liveness floor |
| `unit/back-translate.test.ts:1001` | sends a text once per locale, however many keys share it | `expect(engine.sentFrom.length)` | > 0 | not a liveness floor |
| `unit/back-translate.test.ts:1136` | is watched by a stand-in that records a real request | `expect(translateRequests(engine).length)` | > 0 | not a liveness floor |
| `unit/browser-matrix.test.ts:113` | does not simply list every spec, which would assert nothing | `expect(all)` | > 1 | not a liveness floor |
| `unit/browser-matrix.test.ts:280` | states its flake policy rather than discovering it | `expect(shot?.threshold)` | > 0 | not a liveness floor |
| `unit/contrast.test.ts:292` | computes the ratios WCAG itself publishes | `expect(ratioOf('#767676', '#ffffff'))` | >= 4.5 | not a liveness floor |
| `unit/csv.test.ts:165` | shares no header word between any two locales | `expect(pairs)` | > 0 | not a liveness floor |
| `unit/csv.test.ts:237` | allows two locales to share a token that means the same thing | `expect(sharing.length)` | > 0 | not a liveness floor |
| `unit/deploy-gate.test.ts:233` | always says WHY, so a refusal is actionable rather than a bare exit c… | `expect(r.reason.trim().length)` | > 20 | not a liveness floor |
| `unit/device-runner.test.ts:329` | turns a group that threw into a failed row naming why, and keeps its … | `expect(ios.durationMs)` | >= 0 | not a liveness floor |
| `unit/download-readers.test.ts:78` | is actually looking at specs that read bytes | `expect(readers.length)` | > 1 | liveness floor (Group 1) |
| `unit/duplication.test.ts:112` | scans the whole tracked tree, not a list | `expect(SCANNED.length)` | > 337 | liveness floor (Group 1) |
| `unit/duplication.test.ts:117` | scans the whole tracked tree, not a list | `expect(DECLARATIONS.length)` | > 5197 | liveness floor (Group 1) |
| `unit/event-collectors.test.ts:64` | scans every spec directory | `expect(SCANNED.length)` | > 64 | liveness floor (Group 1) |
| `unit/event-collectors.test.ts:277` | sees the loops it is scanning for | `expect( SCANNED.flatMap((path) => locatorLoo…` | >= 7 | liveness floor (Group 1) |
| `unit/evidence-page.test.ts:1124` | is asked before the suite is listed or run | `expect(listed, 'main() no longer lists the s…` | > 0 | not a liveness floor |
| `unit/evidence-page.test.ts:1125` | is asked before the suite is listed or run | `expect(asked, 'main() never asks oneAttemptE…` | > 0 | not a liveness floor |
| `unit/excluded-by-design.test.ts:102` | never spells a --grep pattern out as a literal again | `expect(built.length)` | > 1 | liveness floor (Group 1) |
| `unit/fit.test.ts:51` | never returns a scale of zero or less, whatever it is given | `expect(scale, String(available))` | >= 0.6 | not a liveness floor |
| `unit/fit.test.ts:176` | never returns a font of zero or NaN, whatever it is given | `expect(answer)` | > 0 | not a liveness floor |
| `unit/flags.test.ts:55` | draws every flag the metadata table names | `expect( flagBody(flag).length, `${locale} de…` | > 0 | not a liveness floor |
| `unit/git-env.test.ts:187` | comes through the scratch-repository tests untouched | `expect(report.numPassedTests)` | > 17 | liveness floor (Group 1) |
| `unit/git-hooks.test.ts:131` | clears the repository git hands it before any check runs (#377) | `expect(firstCheck, 'the hook runs a check')` | >= 0 | not a liveness floor |
| `unit/git-hooks.test.ts:132` | clears the repository git hands it before any check runs (#377) | `expect(cleared, 'the hook clears the variabl…` | >= 0 | not a liveness floor |
| `unit/grouping.test.ts:881` | different seeds actually shuffle — the engine is not returning a fixe… | `expect(arrangements.size)` | > 1 | not a liveness floor |
| `unit/grouping.test.ts:1172` | varies which students land together across seeds, not just the group … | `expect(partitions.size)` | > 3 | not a liveness floor |
| `unit/grouping.test.ts:1476` | holds across a spread of class sizes, group-count and per-group modes… | `expect(attempts)` | > 100 | not a liveness floor |
| `unit/grouping.test.ts:1477` | holds across a spread of class sizes, group-count and per-group modes… | `expect(successes)` | > 80 | not a liveness floor |
| `unit/grouping.test.ts:1535` | holds even when together-letters merge students into multi-student bl… | `expect(successes)` | > 20 | not a liveness floor |
| `unit/grouping.test.ts:2016` | varies which boy pairs with which girl across seeds, not just the 1-a… | `expect(partitions.size)` | > 10 | not a liveness floor |
| `unit/grouping.test.ts:2051` | varies pairings on the uneven roster too, not just the evenly-divided… | `expect(partitions.size)` | > 5 | not a liveness floor |
| `unit/grouping.test.ts:2384` | varies which buddy-pairs share a group across seeds, under mix | `expect(partitions.size)` | > 30 | not a liveness floor |
| `unit/install-scripts.test.ts:99` | has something to protect | `expect( packagesWithInstallScripts().length,…` | > 2 | liveness floor (Group 1) |
| `unit/label-check.test.ts:394` | vi rosterColSex seeded back to Tình dục is flagged against the prose … | `expect( verdict?.witnesses.filter(({ transla…` | > 0 | not a liveness floor |
| `unit/node-contract.test.ts:134` | names a floor that ships import.meta.main, which every entry script r… | `expect( compareVersions(floor, [24, 2, 0]), …` | >= 0 | not a liveness floor |
| `unit/one-home.test.ts:71` | scans the whole test and script tree | `expect(SCANNED.length)` | > 293 | liveness floor (Group 1) |
| `unit/one-test-per-case.test.ts:293` | reads the tests every spec declares, and as many as there are | `expect(tests.length)` | > 637 | liveness floor (Group 1) |
| `unit/palette.test.ts:157` | finds the worst subset where every layer at once passes | `expect( typeof everyLayer === 'string' ? 0 :…` | > 4.5 | not a liveness floor |
| `unit/pipeline-wiring.test.ts:236` | the dev sanity suite exists and is more than a stub | `expect(plainTestsIn('tests/dev/dev-sanity.sp…` | > 14 | liveness floor (Group 1) |
| `unit/pipeline-wiring.test.ts:1110` | the prod sanity suite exists and is more than a stub | `expect( plainTestsIn('tests/prod/prod-sanity…` | > 7 | liveness floor (Group 1) |
| `unit/pipeline-wiring.test.ts:1650` | schedules shards 1 to N, and lets each one finish when another fails | `expect(list.length)` | > 7 | liveness floor (Group 1) |
| `unit/pipeline-wiring.test.ts:1834` | records it BEFORE the comparison, so a red run still reports it | `expect(arch, 'no step runs `uname -m`')` | >= 0 | not a liveness floor |
| `unit/pipeline-wiring.test.ts:1835` | records it BEFORE the comparison, so a red run still reports it | `expect(compare, 'no step runs the visual pro…` | >= 0 | not a liveness floor |
| `unit/pipeline-wiring.test.ts:1882` | measures after the gate has decided the build | `expect( gate, 'no step runs the gating visua…` | >= 0 | not a liveness floor |
| `unit/pipeline-wiring.test.ts:1886` | measures after the gate has decided the build | `expect( measure, 'no step runs the measuring…` | >= 0 | not a liveness floor |
| `unit/pipeline-wiring.test.ts:2118` | launches more than one config, or the rest of this asserts nothing | `expect(launchedConfigs().length)` | > 1 | liveness floor (Group 1) |
| `unit/pipeline-wiring.test.ts:2382` | starts for a pull request that changes anything it reads | `expect(inputs.length, 'the import walk found…` | > 16 | liveness floor (Group 1) |
| `unit/release-inventory.test.ts:311` | prints the capture selection of this repository, and it is not empty | `expect(lines.length)` | > 78 | liveness floor (Group 1) |
| `unit/release-map.test.ts:276` | passes a whole release file, and every committed one | `expect(files.length)` | > 0 | liveness floor (Group 1) |
| `unit/report-endpoint.test.ts:600` | starts a review with the script, before any DELETE (#348 AC7) | `expect(script, 'an npm run reports:review li…` | >= 0 | not a liveness floor |
| `unit/report-endpoint.test.ts:601` | starts a review with the script, before any DELETE (#348 AC7) | `expect(firstDelete, 'a DELETE line')` | >= 0 | not a liveness floor |
| `unit/report-review.test.ts:398` | never lets a note put a raw control character on the terminal | `expect(body.length)` | > 8 | not a liveness floor |
| `unit/report.test.ts:220` | gives a message one form per branch, each slot an ellipsis | `expect(entry!.forms.length)` | > 1 | not a liveness floor |
| `unit/report.test.ts:338` | rule 2 refuses one character and accepts two | `expect(matchingKeys(text.slice(0, 2), 'home'…` | > 0 | not a liveness floor |
| `unit/route-coverage.test.ts:129` | has gate specs to check | `expect(gateSpecs().length)` | > 2 | liveness floor (Group 1) |
| `unit/scratch-git-home.test.ts:73` | the home is where such a call is made, and the scan can see it | `expect( calls.filter((call) => call.file ===…` | > 0 | not a liveness floor |
| `unit/server-process.test.ts:252` | stops a server that never answers once the wait gives up on it | `expect( pid, 'the server wrote its pid befor…` | > 0 | not a liveness floor |
| `unit/sfx.test.ts:176` | FAST_STEP_S is strictly shorter than NORMAL_STEP_S, both positive and… | `expect(FAST_STEP_S)` | > 0 | not a liveness floor |
| `unit/sfx.test.ts:183` | AUDIBLE_BAND_HZ is a well-formed, positive range | `expect(AUDIBLE_BAND_HZ.min)` | > 0 | not a liveness floor |
| `unit/sfx.test.ts:226` | contains no semitone (one half-step) interval, including the wrap bac… | `expect(interval)` | >= 2 | not a liveness floor |
| `unit/sfx.test.ts:322` | is INHARMONIC -- no partial above the fundamental sits within 0.03 of… | `expect(Math.abs(ratio - nearestInteger))` | > 0.03 | not a liveness floor |
| `unit/sfx.test.ts:334` | each partial strictly quieter than the fundamental, and than the part… | `expect(INHARMONIC_PARTIAL_GAINS[i])` | > 0 | not a liveness floor |
| `unit/sfx.test.ts:395` | the transient+body -- the part carrying onset information -- fits ins… | `expect(marginS / FAST_STEP_S)` | >= 0.2 | not a liveness floor |
| `unit/sfx.test.ts:426` | has a positive, finite attack and decay, and a sustain level strictly… | `expect(VOICE_ATTACK_S)` | > 0 | not a liveness floor |
| `unit/sfx.test.ts:427` | has a positive, finite attack and decay, and a sustain level strictly… | `expect(VOICE_BODY_DECAY_S)` | > 0 | not a liveness floor |
| `unit/sfx.test.ts:428` | has a positive, finite attack and decay, and a sustain level strictly… | `expect(VOICE_BODY_SUSTAIN_LEVEL)` | > 0 | not a liveness floor |
| `unit/sfx.test.ts:525` | produces different values across successive calls on the same instance | `expect(distinct.size)` | > 1 | not a liveness floor |
| `unit/sfx.test.ts:538` | every draw stays within [0, 1) | `expect(v)` | >= 0 | not a liveness floor |
| `unit/sfx.test.ts:657` | every done voice's bodyPeakGain stays within DONE_PEAK_GAIN's bounds | `expect(lo.length)` | > 1 | not a liveness floor |
| `unit/sfx.test.ts:748` | every field is positive and finite | `expect(v)` | > 0 | not a liveness floor |
| `unit/sfx.test.ts:819` | scales every grain by an arch that touches SHUFFLE_GRAIN_PEAK_GAIN on… | `expect(gain)` | > 0 | not a liveness floor |
| `unit/sfx.test.ts:1002` | SATURATOR_DRIVE is positive and finite | `expect(SATURATOR_DRIVE)` | > 0 | not a liveness floor |
| `unit/sfx.test.ts:1026` | never reaches exactly zero (an exponential only approaches it) | `expect(reverbEnvelopeGain(REVERB_DURATION_S))` | > 0 | not a liveness floor |
| `unit/sfx.test.ts:1095` | MASTER_GAIN trims, it does not amplify | `expect(MASTER_GAIN)` | > 0 | not a liveness floor |
| `unit/sfx.test.ts:1100` | MASTER_HIGHPASS_HZ sits strictly below MASTER_LOWPASS_HZ, leaving a r… | `expect(MASTER_HIGHPASS_HZ)` | > 0 | not a liveness floor |
| `unit/sfx.test.ts:1115` | MASTER_COMPRESSOR has a real (>=1) ratio and positive, finite timing | `expect(MASTER_COMPRESSOR.ratio)` | >= 1 | not a liveness floor |
| `unit/sfx.test.ts:1116` | MASTER_COMPRESSOR has a real (>=1) ratio and positive, finite timing | `expect(MASTER_COMPRESSOR.attackS)` | > 0 | not a liveness floor |
| `unit/sfx.test.ts:1117` | MASTER_COMPRESSOR has a real (>=1) ratio and positive, finite timing | `expect(MASTER_COMPRESSOR.releaseS)` | > 0 | not a liveness floor |
| `unit/sfx.test.ts:1119` | MASTER_COMPRESSOR has a real (>=1) ratio and positive, finite timing | `expect(MASTER_COMPRESSOR.kneeDb)` | >= 0 | not a liveness floor |
| `unit/sfx.test.ts:1130` | the reverb return sits below unity, so overlapping tails cannot drown… | `expect(REVERB_RETURN_GAIN)` | > 0 | not a liveness floor |
| `unit/sfx.test.ts:1142` | the reverb tail is darkened well below the master bus's own lowpass | `expect(REVERB_LOWPASS_HZ)` | > 0 | not a liveness floor |
| `unit/sfx.test.ts:1147` | REVERB_NORMALIZE_PEAK leaves headroom under full scale | `expect(REVERB_NORMALIZE_PEAK)` | > 0 | not a liveness floor |
| `unit/sfxAssets.test.ts:66` | is derived from the manifest, and the three records agree on it | `expect(ROLES.length)` | > 0 | not a liveness floor |
| `unit/sfxAssets.test.ts:75` | every role names at least one file, and every filename ends .m4a | `expect(SFX_MANIFEST[role].length)` | > 0 | not a liveness floor |
| `unit/sfxAssets.test.ts:125` | every index it can ever return is a valid position in SFX_MANIFEST.la… | `expect(idx)` | >= 0 | not a liveness floor |
| `unit/sfxAssets.test.ts:143` | every role has a strictly positive gain at or under unity | `expect(SFX_ASSET_GAIN[role])` | > 0 | not a liveness floor |
| `unit/sfxAssets.test.ts:157` | every role has a positive, finite ceiling | `expect(SFX_MAX_DURATION_S[role])` | > 0 | not a liveness floor |
| `unit/sfxAssets.test.ts:243` | ${file} (role: ${role}) parses under its ${SFX_MAX_DURATION_S[role]}s… | `expect(durationS)` | > 0 | not a liveness floor |
| `unit/site-pages.test.ts:16` | reads real pages off disk | `expect(pageNames().length)` | > 2 | liveness floor (Group 1) |
| `unit/sitemap-config.test.ts:73` | finds a real map, not an empty one | `expect(Object.keys(sitemapLocales()).length)` | > 4 | liveness floor (Group 1) |
| `unit/source-files.test.ts:17` | recurses, and returns paths a caller can read | `expect(specs.length)` | > 47 | liveness floor (Group 1) |
| `unit/source-files.test.ts:91` | still descends through directories that hold no match themselves | `expect( filesUnder('tests', (path) => path.e…` | > 47 | liveness floor (Group 1) |
| `unit/spec-dirs.test.ts:9` | finds every directory under tests/ that holds specs | `expect(specDirs().length)` | > 4 | liveness floor (Group 1) |
| `unit/supply-chain.test.ts:107` | there is something to check | `expect(externalUses().length)` | > 37 | liveness floor (Group 1) |
| `unit/supply-chain.test.ts:221` | opens every PR against develop, never straight at main | `expect(ecosystems, 'no ecosystems declared')` | > 0 | not a liveness floor |
| `unit/tokens.test.ts:133` | puts the ShyTalk mark on its own tile in light, and on nothing in dar… | `expect(blocks.length)` | > 1 | not a liveness floor |
| `unit/wcag.test.ts:138` | lives in tests/wcag.ts alone, across the whole tracked tree | `expect(scanned.length)` | > 338 | liveness floor (Group 1) |
| `viewport.ts:142` | (module level) | `expect(Math.round(rect.width), `${what} widt…` | >= 44 | not a liveness floor |
| `viewport.ts:143` | (module level) | `expect(Math.round(rect.height), `${what} hei…` | >= 44 | not a liveness floor |
