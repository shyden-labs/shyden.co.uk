# Plan — `npm run reports:review` (#348)

Refs #348, follow-up to #97. The ACs are the issue's; this plan maps each to
the code that meets it, the test that holds it, and the mutation that proves
the test can fail.

## Facts measured before writing (2026-09-26)

- `wrangler d1 execute shyden-reports-dev --remote --json --command "SELECT …"`
  (wrangler 4.141.0, the pinned devDependency) prints
  `[{ "results": [row, …], "success": true, "meta": {…} }]`, every column a
  string and `keys` a JSON-encoded array. Measured read-only against the dev
  database: two `automated dev check` rows.
- `src/lib/i18n/index.ts` and `src/lib/report.ts` import without extensions,
  so plain Node cannot load them. `src/lib/i18n/back-translate.ts` is the
  catalogue table Node scripts already read (`CATALOGUES`: each locale's tool
  and site catalogue), and `src/lib/catalogue-leaves.ts` is the one home for
  walking a catalogue (`one-home.test.ts`). Keys are those `report.ts`
  stores: `site.<section>.<path>` for site copy, the bare path for tool copy,
  both exactly as `catalogueLeaves` spells them.
- The engine client is `call()` in `scripts/i18n-back-translate.mjs` plus
  `engineConfig`, `engineLanguages`, `engineSource`, `libreTranslateBody` and
  `translatedTexts` in `back-translate.ts`; the batching loop sits inside that
  script's `main()`.
- Meta-guards a new script meets: `script-entry.test.ts` (a deciding script
  needs a `PROBES` row; no work at load time), `cli-only.test.ts` (a
  CLI-only module is listed and imported by nothing the site ships),
  `one-home.test.ts` (catalogue walks), checkJs over `scripts/`.

## Design

1. **`src/lib/report-review.ts`** (pure, CLI-only, `.ts` import specifiers so
   Node loads it):
   - `REVIEW_DATABASES`, `databaseFrom(args)` — exactly one argument, one of
     the two names, else an `Error` whose message is the usage line naming
     both (AC1).
   - `REVIEW_SELECT` and `wranglerArgs(db)` — the only command the script
     builds (AC5).
   - `reportRows(output)` — validates wrangler's JSON (one statement,
     `success: true`, every column a string, `keys` a JSON array of strings,
     `locale` one of `LOCALES`) and returns rows sorted by `received_at`,
     then `id` (AC2). Anything else throws, naming the row: a refusal, never
     a silent skip.
   - `catalogueText(catalogues, locale, key)` — the string leaf at `key`, or
     `undefined` (AC3). Catalogues are a parameter, so the tests use fixture
     tables and the real ones alike.
   - `needsBackTranslation(row)` — a non-blank suggestion in a locale other
     than English (AC4).
   - `escaped(text)` — backslash, and every `Cc`/`Cf`/`Zl`/`Zp` character,
     written as an escape (AC6).
   - `reviewBlock(row, catalogues, backTranslation)` — the printed block
     (AC2, AC3, AC4, AC6).
2. **`scripts/back-translate-client.mjs`** — `call()` moved out of
   `i18n-back-translate.mjs` unchanged, plus `readBack(url, apiKey, source,
   texts)`, the batching loop moved out of its `main()`. Both scripts import
   it; `i18n-back-translate.mjs` keeps no copy (AC4).
3. **`scripts/reports-review.mjs`** — wiring: `databaseFrom` (exit 2 with the
   usage), `execFileSync` of `node_modules/.bin/wrangler` with
   `wranglerArgs(db)` and no shell, `reportRows`, one back-translation per
   report that needs one, `reviewBlock` for each. With `BACK_TRANSLATE_URL`
   unset every block says no back-translation was made; an engine failure is
   printed in that report's block and the run exits 1.
4. `back-translate.ts` exports its `CATALOGUES`; `package.json` gains
   `reports:review`; the runbook's first review step is the script.

## AC → test → mutation

| AC | Test (file) | Mutation that must turn it red |
|----|-------------|--------------------------------|
| 1 | `databaseFrom` accepts both names; refuses none, another, two; message names both (`report-review.test.ts`) | M1: add `'shyden-reports-prod'` to the accepted set |
| 1 | `PROBES['reports-review.mjs']`: no argument exits 2 with the usage (`script-entry.test.ts`) | M2: `main()` not called under `import.meta.main` |
| 2 | block carries id, received, locale, page, quote, suggestion, note; rows re-sorted by `received_at` then `id` | M3: drop the sort in `reportRows`; M4: drop the `page` line |
| 3 | real catalogues: a site key and a tool key print their English and their `vi` text; a removed key prints `missing from the catalogue` | M5: `catalogueText` reads the English table for every locale; M6: missing key prints nothing |
| 4 | empty/blank suggestion and an English report are not sent; unset URL says so per report; failure carries its reason; `readBack` batches 30 texts as 25 + 5 against a real local HTTP server and surfaces the engine's words | M7: `needsBackTranslation` ignores blank; M8: `readBack` batch of 30 in one request |
| 4 | `i18n-back-translate.mjs` defines no `fetch` of its own and imports `call`/`readBack` (`report-review.test.ts`, stripped source) | M9: re-add a local `async function call` |
| 5 | `wranglerArgs` equals the exact array; `REVIEW_SELECT` equals `SELECT <REPORT_COLUMNS> FROM reports ORDER BY received_at, id`; the script's stripped source has one `execFileSync(` and it passes `wranglerArgs(` | M10: `REVIEW_SELECT` becomes a `DELETE`; M11: the script adds a second `execFileSync` running a `DELETE` |
| 6 | note with `\n` and U+0007 prints `\n` and `\u{7}`, never raw; U+202E escaped; Thai untouched; a quote matching two keys prints both | M12: `escaped` returns its input |
| 7 | runbook: the `npm run reports:review` line precedes the first `DELETE` line, both present (`report-endpoint.test.ts`) | M13: move the script line below the deletes |
| 8 | every row above run; local gates; CI read by name | — |

## Review log

Each pass ran, not read: typecheck (`astro check`), the whole unit suite,
prettier, and the mutation table through a harness that asserts each anchor
matched once, prints the diff size, runs the whole test file and reads the
totals line.

- **Pass 1 — four findings.** (1) `pipeline-wiring.test.ts` went red: the
  back-translation workflow's `paths:` filter did not list the new client, so
  a change to it would not start the review; added. (2) A missing-key test
  asserted `not.toContain('English')`, which the `in English` line always
  satisfies; now it matches the English and locale lines by their shape. (3)
  The script's own engine decisions (unset URL, bad URL, nothing needing a
  read) had no test, so a mutation there would stay green; `backTranslations`
  is exported and tested against the same local HTTP stand-in (M17, M18,
  M20). (4) M13 as first written deleted the script line instead of moving
  it; M13b moves it below the deletes and is red on the ordering assertion.
- **Pass 2 — one finding.** `absence-liveness.test.ts` flagged the two "no
  request was made" assertions: an empty collector passes them whether or
  not the stand-in records. Now a sentinel request follows each step, and
  `searched()` sits inside the assertion (M20 red on the absence, M21 red on
  the sentinel). Process slip in this pass: M21 mutated the test file while
  that edit was uncommitted, and `git checkout --` restored HEAD. The edit
  was re-applied and committed, and the harness now refuses any target with
  uncommitted work (positive control: it refused a dirtied script).
- **Pass 3 — no findings.** Unit 2658/2658, typecheck 0 errors / 0 warnings
  / 0 hints, prettier clean. M1–M21 plus M13b: 22 of 22 red as predicted,
  denominators steady (43, 104, 35). A real run against
  `shyden-reports-dev` printed its 5 waiting rows, exit 0; a third database
  name exited 2 with the usage. **Approved.**
