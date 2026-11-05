# #913 layer 2: process coverage placed through Vitest's own transform

Refs #913, #899. Written 2026-10-27 on `913-playwright-coverage-c` at `8b4af12f`.

## Intent

Coverage counts taken outside Vitest (the processes suite of #899 and Playwright's runner and workers of #913) must land on exactly the statements, functions and branch arms Vitest's unit report lists for the same file, or `scripts/coverage-merge.mjs` cannot add them up and refuses the file. Today the tool converts each file's **own text** with `ast-v8-to-istanbul` and lines the result up with Vitest's report **by order**, with hand-written allowances for where Vitest's transform moves a parenthesis (`sameNode`, PR #926). Nine files are still refused at `8b4af12f`: eight whose statements Vitest ends on an unmapped position (`48:22-48:null` against our `48:22-51:14`) and `tests/ios-ceilings.ts`, where Vitest's transform emits a statement for a TypeScript parameter property (362 against 361).

The fix is to stop reproducing Vitest's inventory and use it: convert every process-measured file on the code Vitest itself measures, with Vitest's own converter call.

## Measured (laptop, 2026-10-27, spike `.superpowers/sdd/913/tools/vite-inventory.mjs`, main checkout, git-ignored)

- `createVitest('test', { watch: false, root, coverage: { enabled: true, provider: 'v8' } })`, then `vitest.initCoverageProvider()`, then for each file `provider.getSources(url, (f) => provider.transformFile(f, project, 'ssr'))` and `provider.remapCoverage(url, 0, sources, [])`: the statements, functions and branch arms equal Vitest's unit report (`coverage/unit/coverage-final.json`) on **204 of 204** files, the nine refused files among them, compared after a JSON round trip (the report writes `Infinity` as `null`). The comparator was seen RED on that `Infinity` difference first, so it is live.
- The same call transforms and converts **615 of 615** tracked `.ts/.mjs/.js` files under `src/`, `scripts/`, `tests/`, `functions/` and the root configs, in 7 s wall, 49,944 statements. Six convert to no statement (`export default defineConfig(…)` configs and `tests/typescript-preload-setup.ts`), which is Vitest's own ignore rule for SSR exports.
- Every count `ast-v8-to-istanbul` writes is `getCount` at one offset of the code it is given (a node's start, a block's start + 1, an implicit arm as the branch's count less the arm before), over the V8 ranges flattened innermost-first (`dist/index.mjs` `getCount`, `onBranch`, `onFunction`, `normalize`).

## Decided

- **Shyden, 2026-10-27, "Translate in tool"**: counts are carried in the tool, never by excluding files from Babel. Done in `03a8f3b6` (`scripts/carry-counts.mjs`, Babel's copy → own text).
- **Shyden, 2026-10-27, "Both suites"**: the processes suite and the Playwright report convert through the same route; the merge joins every report by exact place; the order join and its parenthesis rules are deleted.

## Design

1. **Counts on the own text** (unchanged): an entry Node ran as its own text (plain JS, or TypeScript with types stripped to spaces) keeps its V8 functions; an entry Playwright compiled is carried onto the own text by `carryCounts` (`03a8f3b6`).
2. **Counts onto Vitest's code** (new, pure, in `scripts/carry-counts.mjs`): `placeOnTransform(functions, transformed, text)` takes the own-text V8 functions, Vitest's transformed `{ code, map }` for the file and the own text, and returns V8 functions on the transformed code: one block-coverage function whose ranges cover the transformed code contiguously, one range per map segment, each taking the own-text count at that segment's original position (`countAt` over `flattenRanges`). An unmapped segment (code Vite inserted, such as `__vite_ssr_import_0__`) takes the count of the mapped segment before it; the code before the first mapped segment takes the first mapped count. Refusals, by name, in the module's existing voice: a map naming other than one source, a segment placed past the own text's lines, a map that does not decode.
3. **Conversion** (`convertScripts` in `scripts/coverage-processes.mjs`): `tool.vitest` supplies `transform(file) → { code, map }` (Vitest's `getSources` over `transformFile(file, project, 'ssr')`) and `remap(url, sources, functions) → FileCoverage` (`remapCoverage(url, 0, …)`). Each entry is placed with step 2 and converted with `remap`. Gone: the own-text `parse`, `importReads`, `bindingCounts` and the hand-written `ignoreNode`, which reproduced Vitest's SSR ignore rules; Vitest's `remapCoverage` applies its own. A transform that fails, or a remap that returns no file, is refused naming the file, never skipped.
4. **CLI** (`main` in `coverage-processes.mjs`): creates one Vitest instance from the unit config (`vitest.config.ts`, the config whose report the others join), calls `initCoverageProvider()`, hands the two functions to `convertScripts`, and closes the instance in a `finally`. It starts no test.
5. **Merge** (`scripts/coverage-merge.mjs`): a file's reports must list the same places, as sets of keys, for statements and for branch arms; the first key on one side only is named in the refusal. `sameNode`, the by-order branch of `join`, and `mergeMaps`' `read` parameter go. `placedTwice` stays. The exact rule also binds Vitest's own suites against each other (unit, simulation, integration); the laptop cannot run those, so the first CI run of the merge is read for any Vitest-against-Vitest refusal, and one found stops the work and goes to Shyden in chat, since it would mean the suites' configs transform differently.
6. **Docs**: the headers of all three scripts, `CLAUDE.md`'s coverage paragraph if it names the order join, and the #913 and #899 tickets.

## Tests

- **Unit** (mocks only; each test ≤ 0.07 s own CPU): `placeOnTransform` against hand-built maps: a one-to-one copy keeps every count; a moved token takes its original's count; an inserted unmapped run takes the count before it; a prefix before the first segment; each refusal; the output's ranges are contiguous and cover the code. `convertScripts` with fake `transform`/`remap`: what `remap` receives (url, the placed functions), a thrown transform and an empty remap refused by name, the Babel carry still applied first. `mergeMaps`: equal key sets join and add; a key on one side only is refused naming it, in both directions (a report with one place more, and one less); the deleted paren cases now refuse. Mutation-verify each new control both ways.
- **Integration** (CI): the existing real-child-process test of the CLI, now through a real Vitest instance (the suite keeps its one measured limit on the script; the 7 s spike says the instance fits, CI's duration is read and reported); plus one test that converts a fixture with a parameter property and a multi-line template literal and asserts its places equal what Vitest's provider lists for it.
- **Counts, ground truth** (laptop measurement, recorded in the PR, no suite): for the gt workload's raw V8 (`gt/` tools, `MODE=own` and `MODE=babel`), every place both the old own-text route and the new route list carries the same count in both; the places only one lists are named. A difference is investigated before anything is pushed.
- **CI proof** (AC3, AC4): the planted helper line reads run, then unrun, in CI's merged report; no Playwright config, e2e spec or e2e-only helper is unmeasured.

## Constraints

- Laptop: unit, format, lint, typecheck only; the spike and ground-truth runs are measurements with no test runner. Integration, e2e and the merged report are CI's.
- No new dependency: `vitest/node` and `@vitest/coverage-v8` are already in the tree.
- Floors move (new unit tests, deleted ones): recorded by `record-floors.yml` and folded, never hand-typed.

## Non-goals

- #959 (the type-stripped run's own misreading of 10 counts): a separate P0, unchanged by where the counts are placed.
- #914 (`astro build`'s Vite loads stay unmeasured).
- Making coverage a gate (#902).

## Left to the builder

The exact refusal sentences; how the CLI finds `vitest.config.ts` (an explicit `config` path, chosen so a later root config cannot change it); test names.
