# Release Evidence Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One published evidence page for everything on `develop` since production's `a3a5adb`. It shows what changes for a visitor, the journeys that show it on five engines, and tickable release checks inside the existing sign-off (#362).

**Architecture:** Three small scripts feed the existing builder:

- `release-inventory.mjs` derives the release: every first-parent commit, each diffed against its first parent, plus the capturing tests.
- `release-map.mjs` checks the committed release file against that inventory and against the run's journeys, and renders the change map.
- `build-release-content.mjs` writes the content file `build-evidence-page.mjs` already accepts.

The builder gains `checks`, sections given as `html`, and a content-worded sign-off.

**Tech Stack:** Node 24 ESM scripts with JSDoc types (checked by `astro check`), `typescript` for AST reads, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-27-release-evidence-page-design.md` (commit `558d410`).

## Global Constraints

- Visitor-facing prefixes: exactly `src/`, `functions/`, `migrations/`, `public/`.
- Every commit's files are `git diff --name-only <sha>^1 <sha>`. A merge's parents are never diffed against each other.
- Sign-off key: `release-<head7>`.
- Check ids match `^[a-z0-9-]+$`, and a page id is `check-<id>`.
- No release prose in any script. Prose lives in `docs/releases/<base7>.json`.
- The evidence filenames come from `scripts/evidence-files.mjs`, never spelled.
- Every CLI prints `usage:` and exits 2 on bad arguments, and runs `main` only under `if (import.meta.main)`.
- The capture runs at `--workers=2`, with nothing else running on the machine.
- Production is the operator's: nothing opens or merges `develop` → `main`.
- No new npm dependency. `typescript` is already a devDependency.
- Every commit is preceded by `npx prettier --write` on the files it adds: `.githooks/pre-push` and CI both run `prettier --check .`, and pass 1 found eight of this plan's files unformatted as first written.

## Review Focus

1. **A merge whose branch sat behind `develop`:** the inventory must not credit it with `develop`'s own changes. Pinned in Task 2 by a fixture where `develop` moves between branch point and merge.
2. **A commit subject carrying HTML**, such as `<img onerror>` in a PR title: the change map must escape it. Pinned in Task 3.
3. **A test that captures only through a helper, or a helper's helper:** it must still be selected. Pinned in Task 2, with the helper's helper defined after its caller so a single pass misses it.
4. **A journey skipped on one engine by design:** it must not flag its row. Pinned in Task 3.
5. **A ticket page built after this change:** it must render exactly as before, with "may merge to develop" and "journeys reviewed". Pinned in Task 1.

---

## File Structure

| File                                         | Responsibility                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `scripts/build-evidence-page.mjs` (modify)   | exports `esc`, `slugOf`, `flattenReport`; adds `checksOf`, `html` sections, `content.signoff`, and the `REVIEWED` wording |
| `tests/evidence-fixture.ts` (modify)         | `evidencePageOf` takes optional extra content                                                                             |
| `tests/unit/evidence-checks.test.ts` (new)   | the builder additions                                                                                                     |
| `tests/e2e/evidence-page.spec.ts` (modify)   | a check ticks, persists and counts in a real page                                                                         |
| `scripts/release-inventory.mjs` (new)        | `readCommits`, `inventoryOf`, `inventoryFor`, `releaseTests`, CLI                                                         |
| `tests/unit/release-inventory.test.ts` (new) | temporary repositories and fixture sources                                                                                |
| `scripts/release-map.mjs` (new)              | `changeMapOf`, `renderChangeMap`                                                                                          |
| `tests/unit/release-map.test.ts` (new)       | every refusal, flag, total and escape                                                                                     |
| `scripts/build-release-content.mjs` (new)    | `releaseContentOf`, `listedTitles`, CLI with `--check`                                                                    |
| `tests/unit/build-release-content.test.ts`   | content, `dev-verified`, `--check`, gaps as checks                                                                        |
| `tests/unit/release-prose.test.ts` (new)     | no release prose in the three scripts                                                                                     |
| `tests/unit/script-entry.test.ts` (modify)   | a probe for each new CLI                                                                                                  |
| `tests/e2e/report-form.spec.ts` (modify)     | `shoot()` in two journeys                                                                                                 |
| `tests/e2e/not-found-report.spec.ts`         | `shoot()` in three tests (six journeys)                                                                                   |
| `docs/releases/a3a5adb.json` (new, data)     | the release's classifications, checks and wording                                                                         |

---

### Task 1: The builder carries checks, html sections and a content-worded sign-off

**Files:**

- Modify: `scripts/build-evidence-page.mjs`
- Modify: `tests/evidence-fixture.ts`
- Create: `tests/unit/evidence-checks.test.ts`
- Modify: `tests/e2e/evidence-page.spec.ts` (append one describe)

**Interfaces:**

- Produces:
  - `export const esc: (s: unknown) => string`
  - `export const slugOf: (s: unknown) => string`
  - `export const flattenReport: (report: any) => { title, block, project, status, duration, file, video }[]`
  - `export const checksOf: (checks: unknown, journeyIds: ReadonlySet<string>) => { ids: string[], html: string }`
  - `content.sections[i].html`, `content.checks`, `content.signoff: { lede?: string, approve?: string }`
  - `evidencePageOf(titles, signoffKey, extra = {})`

- [ ] **Step 1: Let the fixture take extra content.** In `tests/evidence-fixture.ts`, change the signature and the `content` literal:

```ts
export const evidencePageOf = (
  titles: readonly string[],
  signoffKey: string,
  extra: Readonly<Record<string, unknown>> = {},
): string => {
```

```ts
    content: {
      title: 'Evidence page fixture',
      eyebrow: 'fixture',
      headline: `A page with ${titles.length} journeys to sign off`,
      lede: 'Rendered by the real builder.',
      signoffKey,
      ...extra,
    },
```

- [ ] **Step 2: Write the failing unit tests.** Create `tests/unit/evidence-checks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  checksOf,
  journeysOfPage,
} from '../../scripts/build-evidence-page.mjs';
import { evidencePageOf } from '../evidence-fixture';

const CHECKS = [
  { id: 'dev-home', group: 'On dev', label: 'Open the homepage' },
  { id: 'prod-waf', group: 'Before production', label: 'Add the <WAF> rule' },
  { id: 'dev-report', group: 'On dev', label: 'Send a report' },
];

const TITLES = ['the first journey', 'the second journey'];

describe('release checks on an evidence page (#362)', () => {
  const page = evidencePageOf(TITLES, 'release-fixture', { checks: CHECKS });

  it('marks each check up the way the page script finds a journey', () => {
    for (const { id } of CHECKS) {
      expect(page).toContain(`id="j-check-${id}"`);
      expect(page).toContain(
        `<input type="checkbox" id="chk-check-${id}" data-journey="check-${id}">`,
      );
    }
    expect(page).toContain('<h3>Add the &lt;WAF&gt; rule</h3>');
  });

  it('groups the checks under their own headings, in first-seen order', () => {
    const dev = page.indexOf('<h2>On dev</h2>');
    const prod = page.indexOf('<h2>Before production</h2>');
    const report = page.indexOf('id="j-check-dev-report"');
    expect(dev).toBeGreaterThan(-1);
    expect(prod).toBeGreaterThan(dev);
    expect(report).toBeGreaterThan(dev);
    expect(report).toBeLessThan(prod);
  });

  it('puts every check in the sign-off, after the journeys', () => {
    expect(journeysOfPage(page)).toEqual([
      'the-first-journey',
      'the-second-journey',
      'check-dev-home',
      'check-prod-waf',
      'check-dev-report',
    ]);
  });

  it('counts checks in the progress line, and leaves a ticket page as it was', () => {
    expect(page).toContain('0 of 5 journeys and checks reviewed');
    expect(page).toContain('var REVIEWED = " journeys and checks reviewed";');
    const ticket = evidencePageOf(['the first journey'], 'ticket-fixture');
    expect(ticket).toContain('0 of 1 journeys reviewed');
    expect(ticket).toContain('var REVIEWED = " journeys reviewed";');
    expect(ticket).not.toContain('class="check"');
  });

  it.each([
    ['a repeated id', [...CHECKS, CHECKS[0]], /appears twice/],
    [
      'an id with a capital',
      [{ id: 'Dev', group: 'g', label: 'l' }],
      /lowercase letters/,
    ],
    [
      'a check with no label',
      [{ id: 'dev', group: 'g', label: '' }],
      /lowercase letters/,
    ],
    [
      'a check with no group',
      [{ id: 'dev', group: '', label: 'l' }],
      /lowercase letters/,
    ],
    ['a value that is not a list', { id: 'dev' }, /must be a list/],
  ])('refuses %s', (_, checks, message) => {
    expect(() => checksOf(checks, new Set())).toThrow(message);
  });

  it('refuses a check whose id is a journey on the page', () => {
    expect(() =>
      checksOf([{ id: 'a', group: 'g', label: 'l' }], new Set(['check-a'])),
    ).toThrow(/has the id of a journey/);
  });

  it('carries the release decision in its own words when content gives them', () => {
    const release = evidencePageOf(['the first journey'], 'release-fixture', {
      signoff: {
        lede: 'Production changes only on your decision.',
        approve: 'Signed off & ready',
      },
    });
    expect(release).toContain('Production changes only on your decision.');
    expect(release).toContain('Signed off &amp; ready');
    expect(release).not.toContain('may merge to develop');
    expect(release).not.toContain('This ticket progresses');
    const ticket = evidencePageOf(['the first journey'], 'ticket-fixture');
    expect(ticket).toContain('may merge to develop');
    expect(ticket).toContain('This ticket progresses');
  });

  it('renders an html section as given, never inside a paragraph', () => {
    const table = '<div class="mtx"><table><tr><td>x</td></tr></table></div>';
    const withTable = evidencePageOf(['the first journey'], 'release-fixture', {
      sections: [{ heading: 'Map', html: table }],
    });
    expect(withTable).toContain(`<h2>Map</h2>\n${table}`);
    expect(withTable).not.toContain(`<p class="sub">${table}`);
  });
});
```

- [ ] **Step 3: Stub the export so the file collects.** Add a throwing `checksOf` export to `scripts/build-evidence-page.mjs`, directly above `renderEvidencePage`'s docblock (`/**` over ` * The page, as a string.`). Directly above the `export const` line puts the stub between that docblock and its declaration: the docblock then types `checksOf`, and `renderEvidencePage`'s four destructured parameters become implicit `any` (ts(7031), found by running pass 1):

```js
/**
 * @param {unknown} checks
 * @param {ReadonlySet<string>} journeyIds
 * @returns {{ ids: string[], html: string }}
 */
export const checksOf = (checks, journeyIds) => {
  throw new Error(`checksOf: not implemented (${String(checks)}, ${journeyIds.size})`);
};
```

- [ ] **Step 4: Run it red.**

Run: `npx vitest run tests/unit/evidence-checks.test.ts`

Expected: every test FAILS, **12 of 12**. The `html` section test also fails, because the builder wraps `body` and ignores `html`. The two ticket-page tests fail too, because `REVIEWED` does not exist yet. Any test that PASSES here is a finding: read it before going on.

- [ ] **Step 5: Implement.** In `scripts/build-evidence-page.mjs`:

  1. Export `esc`, `flattenReport` and `slugOf`: `const esc =` becomes `export const esc =`, `const flattenReport =` becomes `export const flattenReport =`, and `const slugOf =` becomes `export const slugOf =`. Their docblocks stay above them.
  2. Replace the `checksOf` stub:

```js
/**
 * The release checks a page carries beside its journeys (#362). Each is a tick
 * in the same sign-off, so it is marked up exactly as the page script finds a
 * journey: a `j-` row holding an `h3` (read by `linkTo`, toggled `done`) and a
 * `chk-` box carrying `data-journey` (bound, and looked up before counting).
 * Its id joins `JOURNEYS`, so a verdict covers it and `journeysOfPage` reads
 * it back. A ticket's page carries none, and renders exactly as before.
 *
 * @param {unknown} checks `content.checks`
 * @param {ReadonlySet<string>} journeyIds the journeys on this page
 * @returns {{ ids: string[], html: string }}
 */
export const checksOf = (checks, journeyIds) => {
  if (checks === undefined) return { ids: [], html: '' };
  if (!Array.isArray(checks))
    throw new Error('build-evidence-page: content.checks must be a list');
  /** @type {string[]} */
  const ids = [];
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const check of checks) {
    const { id, group, label } = check ?? {};
    if (
      typeof id !== 'string' ||
      !/^[a-z0-9-]+$/.test(id) ||
      typeof group !== 'string' ||
      group === '' ||
      typeof label !== 'string' ||
      label === ''
    )
      throw new Error(
        'build-evidence-page: a check needs an id of lowercase letters, ' +
          `digits and hyphens, a group and a label; got ${JSON.stringify(check)}`,
      );
    const key = `check-${id}`;
    if (ids.includes(key))
      throw new Error(`build-evidence-page: the check "${id}" appears twice`);
    if (journeyIds.has(key))
      throw new Error(
        `build-evidence-page: the check "${id}" has the id of a journey on this page, "${key}"`,
      );
    ids.push(key);
    const row =
      `<li class="check" id="j-${esc(key)}"><label class="tick">` +
      `<input type="checkbox" id="chk-${esc(key)}" data-journey="${esc(key)}">` +
      '<span class="tickbox" aria-hidden="true"></span>' +
      `<span class="sr">Checked: ${esc(label)}</span></label>` +
      `<h3>${esc(label)}</h3></li>`;
    groups.set(group, [...(groups.get(group) ?? []), row]);
  }
  return {
    ids,
    html: [...groups]
      .map(
        ([group, rows]) =>
          `<h2>${esc(group)}</h2>\n<ul class="checks">${rows.join('')}</ul>`,
      )
      .join('\n'),
  };
};
```

  3. In `renderEvidencePage`, directly after `const journeys = order.map(…);` closes, add:

```js
  const checks = checksOf(content.checks, new Set(journeys.map((j) => j.id)));
```

  4. Replace the `sectionsHtml` map with one that renders `html` as given:

```js
  const sectionsHtml = (content.sections || [])
    .map(
      (/** @type {{ heading: string, body?: string, html?: string }} */ s) =>
        s.html !== undefined
          ? `<h2>${esc(s.heading)}</h2>\n${s.html}`
          : `<h2>${esc(s.heading)}</h2>\n<p class="sub">${s.body}</p>`,
    )
    .join('\n');
```

  5. Add `const signoff = content.signoff ?? {};` beside `const checks`.
  6. In the template, insert `${checks.html}` on its own line directly before `<section class="signoff" id="signoff">`, and replace the three sign-off lines:

```html
  <p class="count" id="progress">0 of ${journeys.length + checks.ids.length} ${checks.ids.length ? 'journeys and checks' : 'journeys'} reviewed</p>
  <p class="sub">Nothing merges on green CI alone. ${signoff.lede !== undefined ? esc(signoff.lede) : 'This ticket progresses only on your explicit decision below.'}</p>
```

```html
    <button type="button" id="btn-approve" aria-pressed="false">${signoff.approve !== undefined ? esc(signoff.approve) : 'Signed off &mdash; may merge to develop'}</button>
```

  7. In the page script, replace `var JOURNEYS = ${JSON.stringify(journeys.map((j) => j.id))};` with:

```js
  var JOURNEYS = ${JSON.stringify([...journeys.map((j) => j.id), ...checks.ids])};
  var REVIEWED = ${JSON.stringify(checks.ids.length ? ' journeys and checks reviewed' : ' journeys reviewed')};
```

     Then replace `progressEl.textContent = done + ' of ' + JOURNEYS.length + ' journeys reviewed';` with `progressEl.textContent = done + ' of ' + JOURNEYS.length + REVIEWED;`.
  8. In the stylesheet, directly after `.journey.done{border-color:var(--accent)}`, add:

```css
.checks{list-style:none;margin:0 0 28px;padding:0;border:1px solid var(--rule);border-radius:10px;background:var(--surface)}
.check{display:flex;gap:14px;align-items:flex-start;padding:14px 18px;border-top:1px solid var(--rule)}
.check:first-child{border-top:0}
.check h3{font-family:var(--body);font-size:1rem;font-weight:500;line-height:1.45}
.check.done h3{color:var(--ink-soft)}
```

- [ ] **Step 6: Run it green, and run the builder's own suite.**

Run: `npx vitest run tests/unit/evidence-checks.test.ts tests/unit/evidence-page.test.ts tests/unit/signoff-status.test.ts`

Expected: all PASS. The existing suites prove a ticket page is unchanged.

- [ ] **Step 7: Add the e2e proof.** Append to `tests/e2e/evidence-page.spec.ts`:

```ts
test.describe('release checks (#362)', () => {
  const CHECKS = [
    { id: 'dev-home', group: 'On dev', label: 'Open the homepage' },
    { id: 'prod-waf', group: 'Before production', label: 'Add the rule' },
  ];
  const html = evidencePageOf(TITLES, SIGNOFF_KEY, { checks: CHECKS });

  test('a check ticks, persists through a reload, and counts toward the progress line', async ({
    page,
  }, testInfo) => {
    await openEvidencePage(page, testInfo, {
      order: 'resolve-then-confirm',
      html,
    });
    const box = page.locator('#chk-check-dev-home');
    await expect(page.locator('#progress')).toHaveText(
      '0 of 7 journeys and checks reviewed',
    );
    await box.check();
    await expect
      .poll(() => storedTicks(page), 'the store keeps the check ticked')
      .toEqual(['check-dev-home']);
    await expect(page.locator('#progress')).toHaveText(
      '1 of 7 journeys and checks reviewed',
    );
    await page.reload();
    await expect(box).toBeChecked();
    await expect(page.locator('#j-check-dev-home')).toHaveClass(/\bdone\b/);
  });
});
```

Run: `npx playwright test tests/e2e/evidence-page.spec.ts --grep "release checks"`

Expected: PASS on all five engines (5 passed).

- [ ] **Step 8: Commit.**

```bash
npx prettier --write scripts/build-evidence-page.mjs tests/evidence-fixture.ts tests/unit/evidence-checks.test.ts tests/e2e/evidence-page.spec.ts
git add scripts/build-evidence-page.mjs tests/evidence-fixture.ts tests/unit/evidence-checks.test.ts tests/e2e/evidence-page.spec.ts
git commit -m "An evidence page carries release checks in its sign-off, html sections, and a sign-off in content's words (Refs #362)"
```

---

### Task 2: The release inventory and the capture selection

**Files:**

- Create: `scripts/release-inventory.mjs`
- Create: `tests/unit/release-inventory.test.ts`
- Modify: `tests/unit/script-entry.test.ts` (one `PROBES` entry)

**Interfaces:**

- Produces:
  - `VISITOR_PREFIXES: readonly string[]`
  - `readCommits({ base, head, git }): Commit[]`
  - `inventoryOf(commits): Entry[]`
  - `inventoryFor({ base, head, git }): { base: string, head: string, entries: Entry[] }`, with full SHAs
  - `releaseTests(files, read): string[]`, as `file:line`
  - `Entry = { sha, subject, pr: number|null, ticket: number|null, files: string[], visitorFacing: boolean, areas: string[] }`
  - `Git = (args: string[]) => string`

- [ ] **Step 1: Write the failing tests.** Create `tests/unit/release-inventory.test.ts`:

```ts
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  VISITOR_PREFIXES,
  inventoryFor,
  inventoryOf,
  readCommits,
  releaseTests,
} from '../../scripts/release-inventory.mjs';

/** A throwaway repository, driven by the real git. */
const repository = () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-inventory-'));
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git(['init', '-q', '-b', 'develop']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  git(['config', 'commit.gpgsign', 'false']);
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  const commit = (subject: string) => {
    git(['add', '-A']);
    git(['commit', '-q', '-m', subject]);
    return git(['rev-parse', 'HEAD']).trim();
  };
  return {
    dir,
    git,
    write,
    commit,
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
};

describe('the release inventory (#362)', () => {
  let repo: ReturnType<typeof repository>;
  const sha: Record<string, string> = {};

  beforeAll(() => {
    repo = repository();
    const { git, write, commit } = repo;
    write('README.md', 'production\n');
    sha.base = commit('the production tree');
    // The squash era: one commit is one pull request, "(#ticket) (#pr)".
    write('src/pages/zh.astro', 'zh\n');
    write('tests/e2e/zh.spec.ts', 'zh\n');
    sha.squash = commit('feat(i18n): serve zh (#22) (#46)');
    // A pull request merged with a merge commit...
    git(['switch', '-q', '-c', '97-report']);
    write('functions/api/report.js', 'report\n');
    commit('the report function');
    git(['switch', '-q', 'develop']);
    // ...while develop moves on beside it, so its branch falls behind.
    write('src/components/Footer.astro', 'footer\n');
    sha.single = commit('fix(footer): one ref (#50)');
    git([
      'merge',
      '-q',
      '--no-ff',
      '-m',
      'Merge pull request #347 from Shyden-Ltd/97-report',
      '97-report',
    ]);
    sha.merge = git(['rev-parse', 'HEAD']).trim();
    // A pull request whose work is tests and a root file only.
    git(['switch', '-q', '-c', 'dependabot/npm/x']);
    write('tests/unit/x.test.ts', 'x\n');
    write('package.json', '{}\n');
    commit('bump');
    git(['switch', '-q', 'develop']);
    git([
      'merge',
      '-q',
      '--no-ff',
      '-m',
      'Merge pull request #298 from Shyden-Ltd/dependabot/npm/x',
      'dependabot/npm/x',
    ]);
    sha.head = git(['rev-parse', 'HEAD']).trim();
  });
  afterAll(() => repo.remove());

  const commits = () =>
    readCommits({ base: sha.base, head: sha.head, git: repo.git });

  it('walks every first-parent commit, oldest first, squashes and merges alike', () => {
    expect(commits().map((c) => c.sha)).toEqual([
      sha.squash,
      sha.single,
      sha.merge,
      sha.head,
    ]);
  });

  it("credits a merge with its own pull request's files, never develop's", () => {
    const merge = commits().find((c) => c.sha === sha.merge);
    expect(merge?.files).toEqual(['functions/api/report.js']);
  });

  it('credits a squash with its own diff', () => {
    expect(commits()[0]?.files).toEqual([
      'src/pages/zh.astro',
      'tests/e2e/zh.spec.ts',
    ]);
  });

  it('reads the pull request and ticket out of each shape of subject', () => {
    const entries = inventoryOf(commits());
    expect(entries.map(({ pr, ticket }) => ({ pr, ticket }))).toEqual([
      { pr: 46, ticket: 22 },
      { pr: 50, ticket: null },
      { pr: 347, ticket: 97 },
      { pr: 298, ticket: null },
    ]);
  });

  it('marks what a visitor receives, and names every other area', () => {
    const entries = inventoryOf(commits());
    expect(entries.map((e) => e.visitorFacing)).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(entries[3]?.areas).toEqual(['(root)', 'tests']);
    expect(entries[0]?.areas).toEqual(['src', 'tests']);
  });

  it('covers exactly the four directories a visitor receives', () => {
    expect([...VISITOR_PREFIXES]).toEqual([
      'src/',
      'functions/',
      'migrations/',
      'public/',
    ]);
    for (const prefix of VISITOR_PREFIXES) {
      const [entry] = inventoryOf([
        { sha: 'x', parents: ['p'], subject: 's', files: [`${prefix}a`] },
      ]);
      expect(entry?.visitorFacing, prefix).toBe(true);
    }
  });

  it('resolves the ends to full shas', () => {
    const inventory = inventoryFor({
      base: 'HEAD~4',
      head: 'HEAD',
      git: repo.git,
    });
    expect(inventory.base).toBe(sha.base);
    expect(inventory.head).toBe(sha.head);
    expect(inventory.entries).toHaveLength(4);
  });

  it('refuses a base that is not an ancestor of the head', () => {
    expect(() =>
      readCommits({ base: sha.head, head: sha.squash, git: repo.git }),
    ).toThrow(/is not an ancestor of/);
  });
});

describe('a commit the inventory has no rule for (#362)', () => {
  it('refuses an octopus merge rather than guess which parent is the line', () => {
    const repo = repository();
    try {
      const { git, write, commit } = repo;
      write('a', 'a\n');
      const base = commit('base');
      for (const branch of ['one', 'two']) {
        git(['switch', '-q', '-c', branch, base]);
        write(`src/${branch}`, `${branch}\n`);
        commit(branch);
      }
      git(['switch', '-q', 'develop']);
      git(['merge', '-q', '--no-ff', '-m', 'octopus', 'one', 'two']);
      expect(() => readCommits({ base, head: 'HEAD', git })).toThrow(
        /has 3 parents/,
      );
    } finally {
      repo.remove();
    }
  });
});

describe('the capture selection (#362)', () => {
  const sources: Record<string, string> = {
    'tests/e2e/direct.spec.ts': `
import { shoot } from './evidence';
test('shoots directly', async ({ page }) => {
  await expect(page).toHaveTitle('x');
  await shoot(page, 'shown');
});
test('never shoots', async ({ page }) => {
  // shoot(page, 'a comment naming it decides nothing');
  await expect(page).toHaveTitle('x');
});
for (const locale of ['en', 'id'])
  test(\`\${locale}: shoots in a loop\`, async ({ page }) => {
    await shoot(page, locale);
  });
`,
    'tests/e2e/helper.spec.ts': `
const outer = async (page) => { await inner(page); };
const inner = async (page) => { await shoot(page, 'deep'); };
async function once(page) { await shoot(page, 'once'); }
test('through a helper', async ({ page }) => { await once(page); });
test("through a helper's helper", async ({ page }) => { await outer(page); });
test('calls a helper that never shoots', async ({ page }) => { await quiet(page); });
const quiet = async (page) => { await page.goto('/'); };
`,
    'tests/e2e/tooling.spec.ts': `
import { evidencePageOf } from '../evidence-fixture';
test('the evidence page itself', async ({ page }) => { await shoot(page, 'x'); });
`,
  };
  const read = (file: string) => {
    const source = sources[file];
    if (source === undefined) throw new Error(`no fixture ${file}`);
    return source;
  };

  it('selects each capturing test by file:line, through helpers to a fixed point', () => {
    expect(releaseTests(Object.keys(sources), read)).toEqual([
      'tests/e2e/direct.spec.ts:3',
      'tests/e2e/direct.spec.ts:12',
      'tests/e2e/helper.spec.ts:5',
      'tests/e2e/helper.spec.ts:6',
    ]);
  });
});

describe('release-inventory.mjs as a command (#362)', () => {
  const script = resolve('scripts/release-inventory.mjs');

  it('prints the capture selection of this repository, and it is not empty', () => {
    const run = spawnSync(process.execPath, [script, '--tests'], {
      encoding: 'utf8',
    });
    expect(run.status, run.stderr).toBe(0);
    const lines = run.stdout.trim().split('\n');
    expect(lines.length).toBeGreaterThan(50);
    expect(
      lines.every((l) => /^tests\/e2e\/[\w.-]+\.spec\.ts:\d+$/.test(l)),
    ).toBe(true);
    expect(
      lines.some((l) =>
        l.startsWith('tests/e2e/classroom-groups-projector.spec.ts:'),
      ),
    ).toBe(true);
    expect(
      lines.some((l) => l.startsWith('tests/e2e/evidence-page.spec.ts:')),
    ).toBe(false);
  });

  it('refuses a selection that is empty, rather than let a capture run everything', () => {
    const empty = mkdtempSync(join(tmpdir(), 'release-tests-'));
    try {
      mkdirSync(join(empty, 'tests', 'e2e'), { recursive: true });
      execFileSync('git', ['init', '-q'], { cwd: empty });
      const run = spawnSync(process.execPath, [script, '--tests'], {
        cwd: empty,
        encoding: 'utf8',
      });
      expect(run.stderr).toContain('no test captures the site');
      expect(run.status).toBe(1);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
```

Line numbers in the fixtures count from the template's opening newline, so line 1 is empty. In `direct.spec.ts`, `test('shoots directly'` is on line 3 and the looped `test(` is on line 12. In `helper.spec.ts`, `test('through a helper'` is on line 5 and `test("through a helper's helper"` is on line 6. `outer` is defined before `inner`, so a single pass over the functions in source order misses `outer`.

- [ ] **Step 2: Stub, then run it red.** Create `scripts/release-inventory.mjs` holding the five exports, each throwing `not implemented`, with `VISITOR_PREFIXES = Object.freeze([])`.

Run: `npx vitest run tests/unit/release-inventory.test.ts`

Expected: all 12 FAIL (eight in the first describe, then one each for the octopus and the selection, and two for the command). The command tests fail on status, because the stub has no `main`. A PASS is a finding.

- [ ] **Step 3: Implement.** Replace `scripts/release-inventory.mjs` whole:

```js
/**
 * What a release carries (#362): every commit on the first-parent line from
 * production to the head being released, with the files each one brought to
 * that line, and the tests whose captures show it.
 *
 * TWO SHAPES OF "ONE PULL REQUEST", ONE RULE
 *
 * `develop` took squash merges until #157 and merge commits after it, so a
 * walk over merges alone skips the squash era, and with it the whole zh/vi/th
 * rollout (#22). Every first-parent commit is read, and each is diffed against
 * ITS FIRST PARENT: what it brought to the line, whichever shape it has. A
 * merge's two parents are never diffed against each other. For a branch that
 * sat behind `develop`, that reports everything `develop` gained meanwhile as
 * the pull request's own work: #108's merge counted three `src/` files it
 * never touched.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import ts from 'typescript';

/** The directories whose files a visitor receives. */
export const VISITOR_PREFIXES = Object.freeze([
  'src/',
  'functions/',
  'migrations/',
  'public/',
]);

/** @typedef {(args: string[]) => string} Git */

/**
 * @typedef {object} Commit
 * @property {string} sha
 * @property {string[]} parents
 * @property {string} subject
 * @property {string[]} files
 */

/**
 * @typedef {object} Entry
 * @property {string} sha
 * @property {string} subject
 * @property {number | null} pr
 * @property {number | null} ticket
 * @property {string[]} files
 * @property {boolean} visitorFacing
 * @property {string[]} areas
 */

/** @param {string} text */
const linesOf = (text) => text.split('\n').filter((line) => line !== '');

/**
 * @param {{ base: string, head: string, git: Git }} input
 * @returns {Commit[]}
 */
export const readCommits = ({ base, head, git }) => {
  try {
    git(['merge-base', '--is-ancestor', base, head]);
  } catch {
    throw new Error(
      `release-inventory: ${base} is not an ancestor of ${head}, so no line of commits runs from one to the other`,
    );
  }
  return linesOf(
    git(['rev-list', '--first-parent', '--reverse', `${base}..${head}`]),
  ).map((sha) => {
    const [, ...parents] = git(['rev-list', '--parents', '-n', '1', sha])
      .trim()
      .split(' ');
    const [first] = parents;
    if (first === undefined || parents.length > 2)
      throw new Error(
        `release-inventory: ${sha} has ${parents.length} parents; a release reads merges (2) and squashes (1), and anything else needs its own rule`,
      );
    return {
      sha,
      parents,
      subject: git(['log', '-1', '--format=%s', sha]).trim(),
      files: linesOf(git(['diff', '--name-only', first, sha])),
    };
  });
};

const MERGE = /^Merge pull request #(\d+) from [^/\s]+\/(\S+)/;
const REF = /\(#(\d+)\)/g;

/**
 * @param {readonly Commit[]} commits
 * @returns {Entry[]}
 */
export const inventoryOf = (commits) =>
  commits.map(({ sha, subject, files }) => {
    const merge = MERGE.exec(subject);
    const refs = [...subject.matchAll(REF)].map((m) => Number(m[1]));
    /** @type {number | null} */
    let pr = null;
    /** @type {number | null} */
    let ticket = null;
    if (merge) {
      pr = Number(merge[1]);
      const lead = /^(\d+)-/.exec(merge[2] ?? '');
      ticket = lead ? Number(lead[1]) : null;
    } else if (refs.length > 0) {
      pr = refs[refs.length - 1] ?? null;
      ticket = refs.length > 1 ? (refs[0] ?? null) : null;
    }
    return {
      sha,
      subject,
      pr,
      ticket,
      files,
      visitorFacing: files.some((file) =>
        VISITOR_PREFIXES.some((prefix) => file.startsWith(prefix)),
      ),
      areas: [
        ...new Set(
          files.map((file) =>
            file.includes('/') ? file.slice(0, file.indexOf('/')) : '(root)',
          ),
        ),
      ].sort(),
    };
  });

/**
 * @param {{ base: string, head: string, git: Git }} input
 * @returns {{ base: string, head: string, entries: Entry[] }}
 */
export const inventoryFor = ({ base, head, git }) => {
  /** @param {string} ref */
  const full = (ref) =>
    git(['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  const from = full(base);
  const to = full(head);
  return {
    base: from,
    head: to,
    entries: inventoryOf(readCommits({ base: from, head: to, git })),
  };
};

/**
 * The line of every `test(` call in a spec that captures evidence of the
 * site: its callback calls `shoot(`, or a function of the same file that
 * does, followed to a fixed point, because `classroom-groups-projector` captures
 * only through `expectNothingOutOfReach`. Parsed, not grepped, so a comment
 * naming `shoot(` decides nothing. The evidence tooling's own spec, which
 * imports `../evidence-fixture`, captures a fixture page, not the site.
 *
 * @param {string} file
 * @param {string} source
 * @returns {number[]}
 */
const capturingLines = (file, source) => {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  /** @param {ts.Node} root */
  const callsIn = (root) => {
    /** @type {Set<string>} */
    const names = new Set();
    /** @param {ts.Node} node */
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression))
        names.add(node.expression.text);
      ts.forEachChild(node, visit);
    };
    visit(root);
    return names;
  };
  /** @type {Map<string, Set<string>>} */
  const functions = new Map();
  /** @type {{ line: number, calls: Set<string> }[]} */
  const tests = [];
  let tooling = false;
  /** @param {ts.Node} node */
  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === '../evidence-fixture'
    )
      tooling = true;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    )
      functions.set(node.name.text, callsIn(node.initializer));
    if (ts.isFunctionDeclaration(node) && node.name)
      functions.set(node.name.text, callsIn(node));
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'test'
    ) {
      const callback = node.arguments[node.arguments.length - 1];
      if (node.arguments.length >= 2 && callback)
        tests.push({
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          calls: callsIn(callback),
        });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (tooling) return [];
  const shooting = new Set(['shoot']);
  for (let grew = true; grew;) {
    grew = false;
    for (const [name, calls] of functions)
      if (!shooting.has(name) && [...calls].some((c) => shooting.has(c))) {
        shooting.add(name);
        grew = true;
      }
  }
  return [
    ...new Set(
      tests
        .filter((t) => [...t.calls].some((c) => shooting.has(c)))
        .map((t) => t.line),
    ),
  ].sort((a, b) => a - b);
};

/**
 * @param {readonly string[]} files
 * @param {(file: string) => string} read
 * @returns {string[]} `file:line` of every capturing test
 */
export const releaseTests = (files, read) =>
  files.flatMap((file) =>
    capturingLines(file, read(file)).map((line) => `${file}:${line}`),
  );

const USAGE =
  'usage: release-inventory.mjs --base <sha> --head <sha> | --tests';

const main = () => {
  /** @type {{ base?: string, head?: string, tests?: boolean }} */
  let values = {};
  try {
    ({ values } = parseArgs({
      options: {
        base: { type: 'string' },
        head: { type: 'string' },
        tests: { type: 'boolean' },
      },
    }));
  } catch {
    values = {};
  }
  /** @type {Git} */
  const git = (args) =>
    execFileSync('git', args, {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
  if (values.tests) {
    // The specs git tracks: the capture runs what is committed, and git's list
    // cannot disagree with that, where a directory read can.
    const files = git(['ls-files', '-z', '--', 'tests/e2e/*.spec.ts'])
      .split('\0')
      .filter((file) => /^tests\/e2e\/[^/]+\.spec\.ts$/.test(file))
      .sort();
    const selection = releaseTests(files, (file) => readFileSync(file, 'utf8'));
    if (selection.length === 0) {
      console.error(
        'release-inventory: no test captures the site; an empty selection would run every test',
      );
      process.exit(1);
    }
    console.log(selection.join('\n'));
    return;
  }
  if (!values.base || !values.head) {
    console.error(USAGE);
    process.exit(2);
  }
  console.log(
    JSON.stringify(
      inventoryFor({ base: values.base, head: values.head, git }),
      null,
      2,
    ),
  );
};

if (import.meta.main) main();
```

- [ ] **Step 4: Probe the entry point.** In `tests/unit/script-entry.test.ts`, add to `PROBES` after `'install-hooks.mjs'`:

```ts
  // With no range and no --tests it has nothing to read, so it refuses (#362).
  'release-inventory.mjs': {
    args: [],
    status: 2,
    says: 'usage: release-inventory.mjs',
  },
```

- [ ] **Step 5: Run it green.**

Run: `npx vitest run tests/unit/release-inventory.test.ts tests/unit/script-entry.test.ts`

Expected: all PASS.

- [ ] **Step 6: Commit.**

```bash
npx prettier --write scripts/release-inventory.mjs tests/unit/release-inventory.test.ts tests/unit/script-entry.test.ts
git add scripts/release-inventory.mjs tests/unit/release-inventory.test.ts tests/unit/script-entry.test.ts
git commit -m "The release inventory: every first-parent commit against its first parent, and the tests that capture (Refs #362)"
```

---

### Task 3: The change map

**Files:**

- Create: `scripts/release-map.mjs`
- Create: `tests/unit/release-map.test.ts`

**Interfaces:**

- Consumes: `Entry` (Task 2); `esc` and `slugOf` (Task 1).
- Produces:
  - `changeMapOf({ inventory: { base, entries }, release, journeys: ReadonlySet<string>, statuses: ReadonlyMap<string, readonly string[]> | null }): ChangeMap`
  - `ChangeMap = { rows: Row[], totals: { entries, visible, gap, none, flagged }, otherCommits: number, otherAreas: [string, number][] }`
  - `Row = { entry: Entry, classification: Classification, flagged: boolean | null }`
  - `renderChangeMap(map): { changeMap: string, others: string }`

- [ ] **Step 1: Write the failing tests.** Create `tests/unit/release-map.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { slugOf } from '../../scripts/build-evidence-page.mjs';
import { changeMapOf, renderChangeMap } from '../../scripts/release-map.mjs';

const BASE = 'b'.repeat(40);
const entry = (
  sha: string,
  visitorFacing: boolean,
  areas = ['src'],
  subject = `commit ${sha}`,
) => ({
  sha: sha.repeat(40).slice(0, 40),
  subject,
  pr: 1,
  ticket: 2,
  files: [],
  visitorFacing,
  areas,
});
const A = entry('a', true);
const C = entry('c', true, ['src'], 'feat: <img src=x onerror=alert(1)>');
const D = entry('d', true);
const T = entry('e', false, ['tests', '.github']);
const U = entry('f', false, ['tests']);
const inventory = { base: BASE, entries: [A, C, D, T, U] };

const JOURNEY = 'a describe > a journey';
const SKIPPY = 'a describe > mobile only';
const release = (entries: Record<string, unknown>) => ({
  base: BASE,
  headline: 'h',
  lede: 'l',
  signoff: {},
  gapGroup: 'g',
  checks: [],
  entries,
});
const ALL = {
  [A.sha]: { kind: 'visible', journeys: [JOURNEY] },
  [C.sha]: { kind: 'gap', check: 'try it by hand' },
  [D.sha]: { kind: 'none', reason: 'a refactor' },
};
const journeys = new Set([JOURNEY, SKIPPY]);
const passing = new Map([
  [JOURNEY, ['passed', 'passed', 'passed', 'passed', 'passed']],
  [SKIPPY, ['passed', 'skipped', 'skipped', 'passed', 'passed']],
]);
const map = (
  entries: Record<string, unknown>,
  statuses: ReadonlyMap<string, readonly string[]> | null = passing,
) => changeMapOf({ inventory, release: release(entries), journeys, statuses });

describe('the change map (#362)', () => {
  it('has one row per visitor-facing commit, in release order', () => {
    expect(map(ALL).rows.map((r) => r.entry.sha)).toEqual([
      A.sha,
      C.sha,
      D.sha,
    ]);
  });

  it.each([
    [
      'a release for another base',
      { ...ALL },
      (r: ReturnType<typeof release>) => ({ ...r, base: 'x'.repeat(40) }),
      /is for x+, the inventory starts at b+/,
    ],
    [
      'an unclassified commit',
      { [A.sha]: ALL[A.sha], [C.sha]: ALL[C.sha] },
      null,
      /d{40} .* is unclassified/,
    ],
    [
      'a stale classification',
      { ...ALL, [T.sha]: { kind: 'none', reason: 'x' } },
      null,
      /e{40} is classified but is not a visitor-facing commit/,
    ],
    [
      'a visible change citing nothing',
      { ...ALL, [A.sha]: { kind: 'visible', journeys: [] } },
      null,
      /a{40} is visible but cites no journey/,
    ],
    [
      'an unknown journey',
      {
        ...ALL,
        [A.sha]: { kind: 'visible', journeys: ['a describe > a jorney'] },
      },
      null,
      /"a describe > a jorney", cited by a{40}, is not a journey/,
    ],
    [
      'a reasonless none',
      { ...ALL, [D.sha]: { kind: 'none', reason: ' ' } },
      null,
      /d{40} .* gives no reason/,
    ],
    [
      'an empty gap',
      { ...ALL, [C.sha]: { kind: 'gap', check: '' } },
      null,
      /c{40} .* says nothing to check/,
    ],
    [
      'an unknown kind',
      { ...ALL, [D.sha]: { kind: 'visble', journeys: [JOURNEY] } },
      null,
      /d{40} .* kind "visble"/,
    ],
  ])('refuses %s', (_, entries, reshape, message) => {
    const r = release(entries);
    expect(() =>
      changeMapOf({
        inventory,
        release: reshape ? reshape(r) : r,
        journeys,
        statuses: passing,
      }),
    ).toThrow(message);
  });

  it('flags a journey that failed on any engine, and one that passed on none', () => {
    const failed = new Map(passing).set(JOURNEY, [
      'passed',
      'failed',
      'passed',
      'passed',
      'passed',
    ]);
    expect(map(ALL, failed).rows[0]?.flagged).toBe(true);
    const skippedEverywhere = new Map(passing).set(JOURNEY, [
      'skipped',
      'skipped',
      'skipped',
      'skipped',
      'skipped',
    ]);
    expect(map(ALL, skippedEverywhere).rows[0]?.flagged).toBe(true);
  });

  it('does not flag a journey skipped on an engine by design', () => {
    const cites = { ...ALL, [A.sha]: { kind: 'visible', journeys: [SKIPPY] } };
    expect(map(cites).rows[0]?.flagged).toBe(false);
  });

  it('computes no flag from a listing', () => {
    expect(map(ALL, null).rows[0]?.flagged).toBeNull();
  });

  it('totals each kind, and counts only real flags', () => {
    const failed = new Map(passing).set(JOURNEY, [
      'failed',
      'passed',
      'passed',
      'passed',
      'passed',
    ]);
    expect(map(ALL, failed).totals).toEqual({
      entries: 3,
      visible: 1,
      gap: 1,
      none: 1,
      flagged: 1,
    });
    expect(map(ALL).totals.flagged).toBe(0);
  });

  it('counts every commit a visitor never receives, by area', () => {
    const { otherCommits, otherAreas } = map(ALL);
    expect(otherCommits).toBe(2);
    expect(otherAreas).toEqual([
      ['.github', 1],
      ['tests', 2],
    ]);
  });

  it('renders every value escaped, and links each journey to its section', () => {
    const { changeMap, others } = renderChangeMap(map(ALL));
    expect(changeMap).not.toContain('<img src=x');
    expect(changeMap).toContain('feat: &lt;img src=x onerror=alert(1)&gt;');
    expect(changeMap).toContain(`<a href="#j-${slugOf(JOURNEY)}">`);
    expect(changeMap).toContain('try it by hand');
    expect(changeMap).toContain('a refactor');
    expect(others).toContain('tests');
  });
});
```

- [ ] **Step 2: Stub, then run it red.** Create `scripts/release-map.mjs` with both exports throwing `not implemented`.

Run: `npx vitest run tests/unit/release-map.test.ts`

Expected: all 15 FAIL (8 refusals plus 7 others). A PASS is a finding: a bare `toThrow` would pass on a stub, which is why every refusal names its message.

- [ ] **Step 3: Implement.** Replace `scripts/release-map.mjs` whole:

```js
/**
 * The release's judgement, checked against the release itself (#362).
 *
 * The inventory says WHICH commits change what a visitor receives; only a
 * person can say WHAT each one changes. That judgement lives in
 * `docs/releases/<base7>.json`. This module refuses it unless it covers every
 * visitor-facing commit, names no commit outside them, and cites only
 * journeys this run actually shows, so the page cannot describe a tree it was
 * not built for.
 */

import { esc, slugOf } from './build-evidence-page.mjs';

/**
 * @typedef {import('./release-inventory.mjs').Entry} Entry
 * @typedef {{ kind: 'visible', journeys: string[] } | { kind: 'gap', check: string } | { kind: 'none', reason: string }} Classification
 * @typedef {{ id: string, group: string, label: string }} Check
 * @typedef {object} Release
 * @property {string} base
 * @property {string} headline
 * @property {string} lede
 * @property {{ lede?: string, approve?: string }} signoff
 * @property {string} gapGroup
 * @property {Check[]} checks
 * @property {Record<string, unknown>} entries each commit's classification as
 *   the file gives it, untrusted until `changeMapOf` has checked it
 * @typedef {{ entry: Entry, classification: Classification, flagged: boolean | null }} Row
 * @typedef {object} ChangeMap
 * @property {Row[]} rows
 * @property {{ entries: number, visible: number, gap: number, none: number, flagged: number }} totals
 * @property {number} otherCommits
 * @property {[string, number][]} otherAreas
 */

/** @param {Entry} entry */
const named = (entry) => `${entry.sha} (${entry.subject})`;

/**
 * @param {object} input
 * @param {{ base: string, entries: Entry[] }} input.inventory
 * @param {Release} input.release
 * @param {ReadonlySet<string>} input.journeys the titles a row may cite
 * @param {ReadonlyMap<string, readonly string[]> | null} input.statuses every
 *   result's status per journey title, or null when checking a listing
 * @returns {ChangeMap}
 */
export const changeMapOf = ({ inventory, release, journeys, statuses }) => {
  if (release.base !== inventory.base)
    throw new Error(
      `release-map: the release file is for ${release.base}, the inventory starts at ${inventory.base}`,
    );
  const visitor = inventory.entries.filter((e) => e.visitorFacing);
  const known = new Set(visitor.map((e) => e.sha));
  for (const sha of Object.keys(release.entries))
    if (!known.has(sha))
      throw new Error(
        `release-map: ${sha} is classified but is not a visitor-facing commit of this release (stale)`,
      );

  /** @type {Row[]} */
  const rows = visitor.map((entry) => {
    /** @type {any} */
    const classification = release.entries[entry.sha];
    if (!classification)
      throw new Error(`release-map: ${named(entry)} is unclassified`);
    if (classification.kind === 'none') {
      if (!String(classification.reason ?? '').trim())
        throw new Error(`release-map: ${named(entry)} gives no reason`);
      return { entry, classification, flagged: null };
    }
    if (classification.kind === 'gap') {
      if (!String(classification.check ?? '').trim())
        throw new Error(`release-map: ${named(entry)} says nothing to check`);
      return { entry, classification, flagged: null };
    }
    if (classification.kind !== 'visible')
      throw new Error(
        `release-map: ${named(entry)} has kind ${JSON.stringify(classification.kind)}, which is none of visible, gap and none`,
      );
    if (
      !Array.isArray(classification.journeys) ||
      classification.journeys.length === 0
    )
      throw new Error(
        `release-map: ${entry.sha} is visible but cites no journey`,
      );
    for (const title of classification.journeys)
      if (!journeys.has(title))
        throw new Error(
          `release-map: ${JSON.stringify(title)}, cited by ${entry.sha}, is not a journey of this run`,
        );
    const flagged =
      statuses === null
        ? null
        : classification.journeys.some((/** @type {string} */ title) => {
            const seen = statuses.get(title) ?? [];
            return (
              seen.some((s) => s !== 'passed' && s !== 'skipped') ||
              !seen.includes('passed')
            );
          });
    return { entry, classification, flagged };
  });

  /** @type {Map<string, number>} */
  const areas = new Map();
  for (const e of inventory.entries)
    if (!e.visitorFacing)
      for (const area of e.areas) areas.set(area, (areas.get(area) ?? 0) + 1);

  /** @param {Classification['kind']} kind */
  const count = (kind) =>
    rows.filter((r) => r.classification.kind === kind).length;
  return {
    rows,
    totals: {
      entries: rows.length,
      visible: count('visible'),
      gap: count('gap'),
      none: count('none'),
      flagged: rows.filter((r) => r.flagged === true).length,
    },
    otherCommits: inventory.entries.length - visitor.length,
    otherAreas: [...areas].sort(([a], [b]) => a.localeCompare(b)),
  };
};

/**
 * @param {ChangeMap} map
 * @returns {{ changeMap: string, others: string }}
 */
export const renderChangeMap = ({ rows, totals, otherCommits, otherAreas }) => {
  const body = rows
    .map(({ entry, classification, flagged }) => {
      const refs = [
        entry.pr === null ? '' : `PR #${entry.pr}`,
        entry.ticket === null ? '' : `#${entry.ticket}`,
      ]
        .filter(Boolean)
        .join(' · ');
      const what =
        classification.kind === 'visible'
          ? classification.journeys
              .map((t) => `<a href="#j-${esc(slugOf(t))}">${esc(t)}</a>`)
              .join('<br>')
          : classification.kind === 'gap'
            ? `<strong style="color:var(--alert)">Shown by no journey.</strong> ${esc(classification.check)}`
            : `No intended visible change: ${esc(classification.reason)}`;
      return (
        `<tr><td class="mono">${esc(entry.sha.slice(0, 7))}</td><td>${esc(refs)}</td>` +
        `<td>${esc(entry.subject)}</td><td>${flagged ? '<strong style="color:var(--alert)">Flagged: a journey below did not pass.</strong><br>' : ''}${what}</td></tr>`
      );
    })
    .join('');
  return {
    changeMap:
      `<p class="sub"><span class="mono">${totals.entries}</span> commits change what a visitor receives: ` +
      `<span class="mono">${totals.visible}</span> shown by journeys, <span class="mono">${totals.gap}</span> shown by none, ` +
      `<span class="mono">${totals.none}</span> with no intended visible change, <span class="mono">${totals.flagged}</span> flagged.</p>\n` +
      `<div class="mtx"><table><thead><tr><th>Commit</th><th>Refs</th><th>Subject</th><th>What shows it</th></tr></thead><tbody>${body}</tbody></table></div>`,
    others:
      `<p class="sub"><span class="mono">${otherCommits}</span> more commits change nothing a visitor receives. By area: ` +
      `${otherAreas.map(([area, n]) => `${esc(area)} <span class="mono">${n}</span>`).join(' · ')}</p>`,
  };
};
```

- [ ] **Step 4: Run it green.**

Run: `npx vitest run tests/unit/release-map.test.ts`

Expected: all PASS.

- [ ] **Step 5: Commit.**

```bash
npx prettier --write scripts/release-map.mjs tests/unit/release-map.test.ts
git add scripts/release-map.mjs tests/unit/release-map.test.ts
git commit -m "The change map: a release file must cover every visitor-facing commit and cite only real journeys (Refs #362)"
```

---

### Task 4: The content file, and `--check` before the merge

**Files:**

- Create: `scripts/build-release-content.mjs`
- Create: `tests/unit/build-release-content.test.ts`
- Modify: `tests/unit/script-entry.test.ts` (one `PROBES` entry)

**Interfaces:**

- Consumes: `inventoryFor` (Task 2); `changeMapOf` and `renderChangeMap` (Task 3); `flattenReport` and `capturesOfThisRun` (builder).
- Produces:
  - `listedTitles(listing): Set<string>`
  - `releaseContentOf({ release, inventory, report, manifest, devVerified }): object | null`, which returns `null` when `manifest === null` (checking)

- [ ] **Step 1: Write the failing tests.** Create `tests/unit/build-release-content.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  listedTitles,
  releaseContentOf,
} from '../../scripts/build-release-content.mjs';

const BASE = 'b'.repeat(40);
const HEAD = 'h'.repeat(40);
const V = {
  sha: 'a'.repeat(40),
  subject: 'visible',
  pr: 1,
  ticket: 2,
  files: ['src/x'],
  visitorFacing: true,
  areas: ['src'],
};
const G = {
  sha: 'c'.repeat(40),
  subject: 'gap',
  pr: 3,
  ticket: null,
  files: ['src/y'],
  visitorFacing: true,
  areas: ['src'],
};
const inventory = { base: BASE, head: HEAD, entries: [V, G] };
const TITLE = 'a describe > a journey';
const release = {
  base: BASE,
  headline: 'The headline',
  lede: 'The lede',
  signoff: { lede: 'Yours.', approve: 'Release' },
  gapGroup: 'Shown by no journey',
  checks: [{ id: 'dev-home', group: 'On dev', label: 'Open it' }],
  entries: {
    [V.sha]: { kind: 'visible', journeys: [TITLE] },
    [G.sha]: { kind: 'gap', check: 'Try it by hand' },
  },
};
const START = '2026-09-27T08:00:00.000Z';
const report = {
  stats: { startTime: START },
  suites: [
    {
      file: 'x.spec.ts',
      suites: [
        {
          title: 'a describe',
          specs: [
            {
              title: 'a journey',
              tests: [
                {
                  projectName: 'chromium',
                  results: [{ status: 'passed', duration: 1, attachments: [] }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
const manifest = [
  {
    project: 'chromium',
    title: TITLE,
    order: 1,
    label: 'l',
    file: 'chromium/a.jpg',
    at: '2026-09-27T08:00:01.000Z',
  },
];

describe('the release content (#362)', () => {
  // Built inside each test, so a stub fails each on its own assertion rather
  // than the whole file at collection.
  const content = () =>
    releaseContentOf({
      release,
      inventory,
      report,
      manifest,
      devVerified: 'success',
    });

  it('keys the sign-off to the release head', () => {
    expect(content()?.signoffKey).toBe('release-hhhhhhh');
  });

  it('names production, the head and its dev-verified state', () => {
    expect(content()?.ids).toEqual([
      { label: 'Production', value: BASE },
      { label: 'Release head', value: HEAD },
      { label: 'dev-verified', value: 'success' },
    ]);
  });

  it('carries the release file wording and its checks, and turns every gap into a check', () => {
    expect(content()?.headline).toBe('The headline');
    expect(content()?.signoff).toEqual({ lede: 'Yours.', approve: 'Release' });
    expect(content()?.checks).toEqual([
      { id: 'dev-home', group: 'On dev', label: 'Open it' },
      {
        id: 'gap-ccccccc',
        group: 'Shown by no journey',
        label: 'gap: Try it by hand',
      },
    ]);
  });

  it('renders the change map and the rest as html sections', () => {
    expect(
      content()?.sections?.map((s: { html?: string }) => typeof s.html),
    ).toEqual(['string', 'string']);
    expect(content()?.sections?.[0]?.html).toContain('#j-a-describe-a-journey');
  });

  it.each([['failure'], [null]])(
    'refuses a head whose dev-verified reads %s',
    (state) => {
      expect(() =>
        releaseContentOf({
          release,
          inventory,
          report,
          manifest,
          devVerified: state,
        }),
      ).toThrow(/dev-verified/);
    },
  );

  it('refuses a cited title that ran but captured nothing', () => {
    expect(() =>
      releaseContentOf({
        release,
        inventory,
        report,
        manifest: [{ ...manifest[0], title: 'another' }],
        devVerified: 'success',
      }),
    ).toThrow(/is not a journey of this run/);
  });
});

describe('--check against a listing (#362)', () => {
  const listing = {
    suites: [
      {
        file: 'x.spec.ts',
        suites: [
          {
            title: 'a describe',
            specs: [
              {
                title: 'a journey',
                tests: [{ projectName: 'chromium', results: [] }],
              },
            ],
          },
        ],
      },
    ],
  };

  it('reads every listed title, results or none', () => {
    expect([...listedTitles(listing)]).toEqual([TITLE]);
  });

  it('passes a branch head with no dev-verified, and writes nothing', () => {
    expect(
      releaseContentOf({
        release,
        inventory,
        report: listing,
        manifest: null,
        devVerified: null,
      }),
    ).toBeNull();
  });

  it('still refuses a title the listing does not hold', () => {
    const typo = {
      ...release,
      entries: {
        ...release.entries,
        [V.sha]: { kind: 'visible', journeys: ['a describe > a jorney'] },
      },
    };
    expect(() =>
      releaseContentOf({
        release: typo,
        inventory,
        report: listing,
        manifest: null,
        devVerified: null,
      }),
    ).toThrow(/is not a journey of this run/);
  });
});
```

- [ ] **Step 2: Stub, then run it red.** Create `scripts/build-release-content.mjs` with both exports throwing `not implemented`.

Run: `npx vitest run tests/unit/build-release-content.test.ts`

Expected: all 10 FAIL.

- [ ] **Step 3: Implement.** Replace `scripts/build-release-content.mjs` whole:

```js
/**
 * The content file for a release's evidence page (#362), written for the
 * builder that renders every ticket's page. It holds no release prose: every
 * word specific to a release comes from `docs/releases/<base7>.json`.
 *
 * Two modes. Building reads a capture's report and manifest, and refuses a
 * head whose `dev-verified` is not success, because the page describes the
 * tree on dev. `--check` reads a Playwright listing before the merge, when
 * the release head is still a branch with no `dev-verified` and no capture
 * exists. It validates the release file and writes nothing, so a mistyped
 * title surfaces before the merge instead of after an hour-long capture.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { capturesOfThisRun, flattenReport } from './build-evidence-page.mjs';
import { EVIDENCE_MANIFEST, EVIDENCE_REPORT } from './evidence-files.mjs';
import { inventoryFor } from './release-inventory.mjs';
import { changeMapOf, renderChangeMap } from './release-map.mjs';

/**
 * Every test title a listing holds, as the builder writes a journey's title
 * (describes and test, the file dropped). A listing carries no results, so
 * `flattenReport`, which yields one row per result, cannot read it.
 *
 * @param {any} listing
 * @returns {Set<string>}
 */
export const listedTitles = (listing) => {
  /** @type {Set<string>} */
  const titles = new Set();
  /**
   * @param {any} suite
   * @param {string[]} path
   */
  const walk = (suite, path) => {
    for (const child of suite.suites ?? [])
      walk(child, child.title ? [...path, child.title] : path);
    for (const spec of suite.specs ?? [])
      titles.add([...path, spec.title].join(' > '));
  };
  for (const file of listing.suites ?? []) walk(file, []);
  return titles;
};

/**
 * @param {object} input
 * @param {import('./release-map.mjs').Release} input.release
 * @param {{ base: string, head: string, entries: import('./release-inventory.mjs').Entry[] }} input.inventory
 * @param {any} input.report the capture's report, or a listing when checking
 * @param {any[] | null} input.manifest the capture's manifest rows, or null when checking
 * @param {string | null} input.devVerified the head's dev-verified state
 */
export const releaseContentOf = ({
  release,
  inventory,
  report,
  manifest,
  devVerified,
}) => {
  const checking = manifest === null;
  if (!checking && devVerified !== 'success')
    throw new Error(
      `build-release-content: ${inventory.head} reads dev-verified=${devVerified ?? 'absent'}; a release page describes a tree dev has verified`,
    );
  /** @type {Map<string, string[]>} */
  const statuses = new Map();
  if (!checking)
    for (const row of flattenReport(report))
      statuses.set(row.title, [...(statuses.get(row.title) ?? []), row.status]);
  const map = changeMapOf({
    inventory,
    release,
    journeys: checking
      ? listedTitles(report)
      : new Set(
          capturesOfThisRun(manifest, report).current.map(
            (/** @type {{ title: string }} */ r) => r.title,
          ),
        ),
    statuses: checking ? null : statuses,
  });
  if (checking) return null;
  const { changeMap, others } = renderChangeMap(map);
  const head7 = inventory.head.slice(0, 7);
  return {
    title: release.headline,
    eyebrow: `Release ${inventory.base.slice(0, 7)} → ${head7}`,
    headline: release.headline,
    lede: release.lede,
    ids: [
      { label: 'Production', value: inventory.base },
      { label: 'Release head', value: inventory.head },
      { label: 'dev-verified', value: devVerified },
    ],
    sections: [
      { heading: 'What changes for a visitor', html: changeMap },
      { heading: 'Everything else in the release', html: others },
    ],
    checks: [
      ...release.checks,
      ...map.rows.flatMap(({ entry, classification }) =>
        classification.kind === 'gap'
          ? [
              {
                id: `gap-${entry.sha.slice(0, 7)}`,
                group: release.gapGroup,
                label: `${entry.subject}: ${classification.check}`,
              },
            ]
          : [],
      ),
    ],
    signoff: release.signoff,
    signoffKey: `release-${head7}`,
  };
};

const USAGE =
  'usage: build-release-content.mjs --release <file.json> --head <sha> (--evidence <dir> --out <content.json> | --check --listing <listing.json>)';

/** @param {string} sha */
const devVerifiedOf = (sha) => {
  const state = execFileSync(
    'gh',
    [
      'api',
      `repos/{owner}/{repo}/commits/${sha}/statuses`,
      '--jq',
      '[.[] | select(.context == "dev-verified")][0].state // ""',
    ],
    { encoding: 'utf8' },
  ).trim();
  return state === '' ? null : state;
};

const main = () => {
  /** @type {{ release?: string, head?: string, evidence?: string, out?: string, check?: boolean, listing?: string }} */
  let values = {};
  try {
    ({ values } = parseArgs({
      options: {
        release: { type: 'string' },
        head: { type: 'string' },
        evidence: { type: 'string' },
        out: { type: 'string' },
        check: { type: 'boolean' },
        listing: { type: 'string' },
      },
    }));
  } catch {
    values = {};
  }
  const checking = values.check === true;
  if (
    !values.release ||
    !values.head ||
    (checking ? !values.listing : !values.evidence || !values.out)
  ) {
    console.error(USAGE);
    process.exit(2);
  }
  try {
    const release = JSON.parse(readFileSync(values.release, 'utf8'));
    const inventory = inventoryFor({
      base: release.base,
      head: values.head,
      git: (args) =>
        execFileSync('git', args, {
          encoding: 'utf8',
          maxBuffer: 256 * 1024 * 1024,
        }),
    });
    if (checking) {
      releaseContentOf({
        release,
        inventory,
        report: JSON.parse(readFileSync(values.listing ?? '', 'utf8')),
        manifest: null,
        devVerified: null,
      });
      console.log(
        `build-release-content: ${values.release} holds for ${inventory.head}`,
      );
      return;
    }
    const dir = values.evidence ?? '';
    const content = releaseContentOf({
      release,
      inventory,
      report: JSON.parse(readFileSync(join(dir, EVIDENCE_REPORT), 'utf8')),
      manifest: readFileSync(join(dir, EVIDENCE_MANIFEST), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
      devVerified: devVerifiedOf(inventory.head),
    });
    writeFileSync(values.out ?? '', `${JSON.stringify(content, null, 2)}\n`);
    console.log(`build-release-content: wrote ${values.out}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
};

if (import.meta.main) main();
```

- [ ] **Step 4: Probe the entry point.** In `tests/unit/script-entry.test.ts`, add after the `release-inventory.mjs` probe:

```ts
  // Without a release file and a head it can build nothing, so it refuses (#362).
  'build-release-content.mjs': {
    args: [],
    status: 2,
    says: 'usage: build-release-content.mjs',
  },
```

- [ ] **Step 5: Run it green.**

Run: `npx vitest run tests/unit/build-release-content.test.ts tests/unit/script-entry.test.ts`

Expected: all PASS.

- [ ] **Step 6: Commit.**

```bash
npx prettier --write scripts/build-release-content.mjs tests/unit/build-release-content.test.ts tests/unit/script-entry.test.ts
git add scripts/build-release-content.mjs tests/unit/build-release-content.test.ts tests/unit/script-entry.test.ts
git commit -m "The release content: gaps become checks, dev-verified is required, and --check validates before the merge (Refs #362)"
```

---

### Task 5: The report form and the 404 report capture evidence

**Files:**

- Modify: `tests/e2e/report-form.spec.ts`
- Modify: `tests/e2e/not-found-report.spec.ts`

- [ ] **Step 1: Import `shoot` in both specs.** `import { recorded } from './evidence';` becomes `import { recorded, shoot } from './evidence';`.

- [ ] **Step 2: Capture after each verdict.**
  - `report-form.spec.ts`:
    - In `the disclosure opens from the keyboard and walks its fields in order`, after the last `toHaveValue('')` line, add `await shoot(page, 'the open form, walked field by field', page.locator('[data-report]'));`.
    - In `/vi/classroom-groups submits in place: …`, after the final `toHaveValue(t.open)` assertion, add `await shoot(page, 'the failed status, with the roster and the quote kept', page.locator('[data-report]'));`.
  - `not-found-report.spec.ts`:
    - In `every beta block carries one form posting its own locale, and English none`, after its loop, add `await shoot(page, 'a report form under every beta language', page.locator('details[data-report]').first());`.
    - In `a block walks its own fields from the keyboard, …`, after its last assertion, add `await shoot(page, 'the open block, walked to its send button', details);`.
    - In `` `${locale}: its sent status shows in its language, …` ``, after `toHaveCount(1)`, add ``await shoot(page, `${locale}: the sent status in its own language`, shown);``.

- [ ] **Step 3: Run the two specs, and the meta-guards.**

Run: `npx playwright test tests/e2e/report-form.spec.ts tests/e2e/not-found-report.spec.ts && npx vitest run tests/unit/capture-after-assertion.test.ts tests/unit/evidence-recording.test.ts tests/unit/viewport-tagging.test.ts`

Expected: all PASS. Without `EVIDENCE_DIR`, `shoot` returns at once.

- [ ] **Step 4: Confirm the selection now holds them.**

Run: `node scripts/release-inventory.mjs --tests | command grep -cE 'report-form|not-found-report'`

Expected: `5`, which after `prettier --write` are lines 15 and 136 of `report-form`, and 32, 80 and 113 of `not-found-report`. The count is the assertion: a line moves whenever the shoot calls above it wrap.

- [ ] **Step 5: Commit.**

```bash
npx prettier --write tests/e2e/report-form.spec.ts tests/e2e/not-found-report.spec.ts
git add tests/e2e/report-form.spec.ts tests/e2e/not-found-report.spec.ts
git commit -m "The report form and the 404 report capture evidence after their verdicts (Refs #362)"
```

---

### Task 6: The release file holds, and no script carries its prose

**Files:**

- Add: `docs/releases/a3a5adb.json` (already written from the validated classification; 47 entries, 11 checks)
- Create: `tests/unit/release-prose.test.ts`

- [ ] **Step 1: Write the guard.** Create `tests/unit/release-prose.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stringLeaves } from '../catalogue-leaves';
import { filesUnder, searched } from '../source-files';
import { withoutTsComments } from './source-text';

const RELEASES = filesUnder('docs/releases', (p) => p.endsWith('.json'));
const SCRIPTS = [
  'scripts/release-inventory.mjs',
  'scripts/release-map.mjs',
  'scripts/build-release-content.mjs',
  'scripts/build-evidence-page.mjs',
];

describe('no script carries a release’s prose (#362)', () => {
  it('finds none of any release file’s sentences in the scripts that render it', () => {
    const phrases = RELEASES.flatMap((file) =>
      stringLeaves(JSON.parse(readFileSync(file, 'utf8'))).map(
        ([, phrase]) => phrase,
      ),
    ).filter((p) => p.length >= 24 && !/^[0-9a-f]{40}$/.test(p));
    const code = SCRIPTS.map((file) =>
      withoutTsComments(readFileSync(file, 'utf8')),
    ).join('\n');
    expect(
      searched(
        phrases.filter((p) => code.includes(p)),
        { of: phrases, what: 'release phrases' },
      ),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Mutation-verify it both ways.** Commit first. Then append `// ${a phrase}` to `scripts/release-map.mjs` and predict GREEN, because comments are stripped. Next append the same phrase as a string literal, `export const X = '<phrase>';`, and predict RED. Restore with `git checkout -- scripts/release-map.mjs`, which is safe because the file is committed.

- [ ] **Step 3: Validate the release file against the branch.**

```bash
node scripts/release-inventory.mjs --tests > /tmp/release-tests.txt
npx playwright test --list --reporter=json --project=chromium $(cat /tmp/release-tests.txt) > /tmp/release-listing.json
node scripts/build-release-content.mjs --release docs/releases/a3a5adb.json --head HEAD --check --listing /tmp/release-listing.json --listing-only
```

Expected: `build-release-content: docs/releases/a3a5adb.json holds for <HEAD sha>, as a listing: …`, exit 0. This is an early typo check only, and the command says so: a listing proves a cited title RUNS, not that it CAPTURES. A looped test's case that returns before its `shoot` is selected, listed and passes, which let 64 such citations through in v4 (#765). Without `--listing-only` the command refuses. The real check is Task 8's `--check --manifest`, against the release's one capture, before the content merges.

- [ ] **Step 4: Commit.**

```bash
npx prettier --write docs/releases/a3a5adb.json tests/unit/release-prose.test.ts
git add docs/releases/a3a5adb.json tests/unit/release-prose.test.ts
git commit -m "The release file for a3a5adb, checked before the merge, with no script carrying its prose (Refs #362)"
```

---

### Task 7: Gates, mutations, PR, merge, dev

- [ ] **Step 1: Gates.**
  - `npm run typecheck`: expect exactly three summary lines, each 0: `(error|warning|hint)s?`.
  - `npm run test:unit`: whole suite green, with the total read.
  - `npx prettier --check .`: clean.
  - `npx playwright test tests/e2e/evidence-page.spec.ts tests/e2e/report-form.spec.ts tests/e2e/not-found-report.spec.ts`: five engines, green.
- [ ] **Step 2: Mutations.** In a scratch worktree with its own `npm ci`, run each mutation below from a committed tree, with its prediction written first. Each must go RED on its named test.
  1. `git diff --name-only first sha` becomes `git diff --name-only parents[0] parents[1] ?? sha`. Red on "credits a merge…".
  2. `--first-parent` becomes `--merges --first-parent`. Red on "walks every first-parent commit…".
  3. `'migrations/'` dropped from `VISITOR_PREFIXES`. Red on "covers exactly the four…".
  4. The ancestor `try` removed. Red on "refuses a base…".
  5. The parent-count refusal removed. Red on "refuses an octopus…".
  6. `refs[refs.length - 1]` becomes `refs[0]`. Red on "reads the pull request…".
  7. `refs.length > 1 ? refs[0]` becomes `refs[0]`. Red on "reads the pull request…".
  8. `'(root)'` becomes `file`. Red on "marks what a visitor receives…".
  9. The `tooling` return removed. Red on "selects each capturing test…".
  10. `shooting` seeded with nothing. Red on "selects…".
  11. The `for (let grew…)` loop becomes one pass. Red on "selects…" (the helper's helper).
  12. The functions map never filled. Red on "selects…" (the projector, and the fixture's helper).
  13. The empty-selection refusal removed. Red on "refuses a selection that is empty…".
  14. Each of `changeMapOf`'s eight refusals removed, one at a time: 8 mutations, each red on its own `refuses …` row.
  15. `s !== 'skipped'` removed. Red on "does not flag a journey skipped…".
  16. `seen.some(…)` removed. Red on "flags a journey that failed…".
  17. `flagged === true` becomes `flagged !== false`. Red on "totals…".
  18. The areas loop skipped. Red on "counts every commit…".
  19. `esc(entry.subject)` becomes `entry.subject`. Red on "renders every value escaped…".
  20. `#j-` becomes `#`. Red on "renders…".
  21. The `devVerified !== 'success'` check removed. Red on "refuses a head whose dev-verified…".
  22. `!checking &&` removed. Red on "passes a branch head…".
  23. Gap checks not appended. Red on "carries the release file wording…".
  24. `release-${head7}` becomes `'ticket'`. Red on "keys the sign-off…".
  25. `checks.ids` left out of `JOURNEYS`. Red on "puts every check in the sign-off…".
  26. A check's box written with `id="chk-${id}"`. Red on "marks each check up…", and in the e2e test.
  27. Each of `checksOf`'s four refusals removed (not a list, the shape, twice, a journey's id): 4 mutations, each red on its row.
  28. `REVIEWED` fixed at `' journeys reviewed'`. Red on "counts checks…".
  29. `groups` collapsed to one list. Red on "groups the checks…".
  30. `signoff.approve` ignored. Red on "carries the release decision…".
  31. The `html` branch removed. Red on "renders an html section…".
  32. Release prose added to `release-map.mjs` as a string literal: red in `release-prose.test.ts`. The same prose as a comment must stay GREEN, and it does only once #364 has landed: `withoutTsComments` does not track `${}`, and a nested template in `renderChangeMap` ends its comment stripping for the rest of the file.
  33. Each new `shoot()` moved above its test's first assertion: 5 mutations, red in `capture-after-assertion.test.ts`.
- [ ] **Step 3: Grep for dependent facts.** Run `command grep -rn "journeys reviewed\|may merge to develop" tests/dev tests/prod tests/device`. Expected: no match, with a known positive checked alongside.
- [ ] **Step 4: Open the PR** into `develop` with the body checked by `node scripts/closing-keywords.mjs <body> "this pull request body"`, and wait for `build-and-test` by name at the head read from `headRefOid`.
- [ ] **Step 5: Merge with a merge commit.** Read `dev-verified` off the merge commit, and every job of `deploy-dev.yml` by name.

### Task 8: Capture, build, publish, verify (after the merge)

- [ ] **Step 1:** `git switch develop && git pull --ff-only`. Write `git rev-parse HEAD > <scratch>/head`, then `node scripts/release-inventory.mjs --tests > <scratch>/tests.txt`.
- [ ] **Step 2:** With nothing else running, `EVIDENCE_DIR=<scratch>/evidence npm run test:e2e -- --workers=2 $(cat <scratch>/tests.txt)`. Read the whole verdict, and the duration of any failure before diagnosing it.
- [ ] **Step 2a: Check the content against the capture, before it merges** (operator 2026-10-14, #765: the code merges, the laptop captures once, the content is checked against that capture, then the content merges and the page is built from the same capture). From the content branch: `node scripts/build-release-content.mjs --release docs/releases/a3a5adb.json --head "$(cat <scratch>/head)" --check --manifest <scratch>/evidence/manifest.jsonl`. It names every cited title no row of this run carries, all in one refusal, each with its entry's sha.
  - A named case is **fixed so it captures, never dropped or cited around** (operator 2026-10-14: every case on the review page has a picture, every moving journey a video). Ticket and PR the test fix, merge it, and run Step 2 again: a second laptop capture for this release is allowed for exactly this. #774 catches such a case on every pull request, so this should not happen once it lands.
  - Merge the content PR once the check holds.
- [ ] **Step 3:** `node scripts/build-release-content.mjs --release docs/releases/a3a5adb.json --head "$(cat <scratch>/head)" --evidence <scratch>/evidence --out <scratch>/content.json`.
- [ ] **Step 4:** Plan, upload and build with the recipe `build-evidence-page.mjs` prints: `--plan`, then `upload-evidence-assets.mjs`, then `--assets`. Publish with `{"db": {}, "assets": {}}`.
- [ ] **Step 5:** Verify:
  - the asset listing count equals the manifest's media count;
  - `grep -o -E "var DOC = [^;]*"` on the saved page prints `release-<head7>`;
  - a sampled image and recording load.
- [ ] **Step 6:** Post the page link on #362, move the card to review, write `HANDOVER.md`, and notify the operator.

## Review log

(Passes are appended here.)

### Pass 1 — 2026-09-27, by running (scratch worktree `review-362-pass1`, own `npm ci`)

Every task's code was applied as written. The red steps were run against throwing stubs, then the green steps, then `npm run typecheck`, the whole unit suite, `prettier --check .`, the three e2e specs on five engines, `--check` of the release file against this branch's listing, and 48 mutations, each predicted before it ran. The code blocks above are now the code that ran, as prettier formats it.

Findings, each fixed above:

1. Task 2's red count was 13; the file holds 12 tests.
2. Task 3's red count was 16 (8 + 8); it is 15 (8 + 7).
3. Task 3's "an unknown journey" regex, `/"…" .* is not a journey/`, needs a space after the quote, and the message has a comma there. It could never match. It now spells the whole message.
4. Task 4 built `content` in the describe body, so against the stub the whole file failed at collection ("no tests"). It is now built inside each test.
5. Task 1's stub, placed "directly above `export const renderEvidencePage`", took that function's docblock. `astro check` then found four ts(7031) errors. The stub now goes above the docblock.
6. `Release.entries` was typed `Record<string, Classification>`, which is an already-validated file. `astro check` refused seven test fixtures (ts(2322)). The file is untrusted until `changeMapOf` checks it, so it is now `Record<string, unknown>`.
7. Eight of the plan's files were not prettier-formatted. Every commit now runs `prettier --write` first, and the blocks are prettier's output.
8. `one-home.test.ts`: `release-prose.test.ts` carried a private catalogue walker. It uses `stringLeaves` now.
9. `one-home.test.ts`: `release-inventory.mjs --tests` read `tests/e2e` with a bare `readdirSync`. It now lists the specs git tracks (`git ls-files`), which is also the right population for a capture of committed code. Its empty-selection test runs `git init` first.
10. Task 5's line numbers were pre-format. After prettier they are 15 and 136, and 32, 80 and 113. The count of 5 held.
11. Task 7 item 27 said `checksOf` had three refusals. It has four.
12. Mutation 32's comment half came back RED where GREEN was predicted. The cause is a scanner defect, not a plan defect: #364.

Held as written: the other 47 mutations were RED as predicted (M1-M31 with M14a-h and M27a-d, M32b, M33a-e), with totals steady per file (12, 15, 10, 12, 1, 2). The capture selection is 68 tests, and the listing is 147 journeys on chromium. `--check` holds for the branch head. There are 2780 unit tests, and typecheck is 0/0/0. `evidence-page.spec.ts`: 297 passed, 2 skipped, 1 failed. The failure was a Firefox poll timing out at 5.8 s under full load, 6 of 6 alone at 4.0-4.4 s, and it is filed as #363 with its error text. `report-form` + `not-found-report`: 135 passed.

Pass 1 found 12 things, so the loop continues. Pass 2 waits on #364, because Task 6's comment mutation cannot be judged until the scanner strips past a nested template.

### Pass 2 — 2026-09-27, by running (scratch worktree `review-362-pass2`: this branch at `dc33cd6` with #364's fix merged, own `npm ci`)

The plan was applied from its own text, by fence index and the anchors its steps name, not from pass 1's tree.

- Red steps against the stubs: 12, 12, 15 and 10 FAIL, exactly as written. Every green step passes.
- The 14 files the plan writes or modifies came out byte-identical to pass 1's verified tree, after the plan's `prettier --write` steps. Task 5's selection lines are 15, 136, 32, 80 and 113, as written.
- `npm run typecheck`: 0 errors, 0 warnings, 0 hints. `npm run test:unit`: 2788 of 2788 (pass 1's 2780 plus #364's 8). `prettier --check .`: clean.
- All 48 mutations came out as predicted: 47 RED and M32a GREEN. The comment half now holds because #364 is in the tree, and M32b turns the same guard RED, so the guard is live. Totals were steady per file: 13 mutations at 12 (inventory), 10 at 12 (builder), 14 at 15, 4 at 10, 2 at 1 and 5 at 2.
- Commands and paths named in Tasks 7-8 exist: `--plan`, `--assets` and `--content` on the builder, the argument passthrough in `scripts/test-e2e.mjs`, `EVIDENCE_REPORT` and `EVIDENCE_MANIFEST`, `capturesOfThisRun`, `upload-evidence-assets.mjs` and `closing-keywords.mjs`.
- The e2e specs were not rerun: their files are byte-identical to pass 1's, where `report-form` and `not-found-report` passed 135 of 135 and `evidence-page` hit only #363.

**No findings. The plan is approved** (self-approved under the 2026-09-24 mandate). One ordering condition: #364 (PR #365) merges into `develop` first, and this branch merges `develop` before Task 6, so Task 7's mutation 32 can hold its comment half.
