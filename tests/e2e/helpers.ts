import {
  expect,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { contrast, over, paintedGround, parseColour } from '../wcag';
import {
  deviceDownloadText,
  emptyDeviceDownloads,
  onRealDevice,
} from '../device/device-downloads';
import {
  getStrings,
  localeFromPath,
  type Locale,
  type Strings,
} from '../../src/lib/i18n/index';
import { LOCALE_METADATA } from '../../src/lib/i18n/metadata';
import { chooseSpeed } from '../make-groups';

/**
 * The catalogue of the language the page is showing, read off its URL.
 *
 * The roster helpers named their controls by an English-or-Indonesian
 * pattern (`/Sex|Jenis kelamin/`), written when those were the only two
 * locales, so none of them could drive zh, vi or th, and a layout test on
 * those pages could not even open the roster (#390 F113). Exact catalogue
 * labels are stricter too: a substring pattern for "Add" also matches
 * "+ Add student".
 */
const stringsOf = (page: Page): Strings =>
  getStrings(localeFromPath(new URL(page.url()).pathname));

/**
 * Fixtures for driving the roster into a starting state -- Stage 3, 4 and 5
 * all need one. **Every helper lives here and is imported**, never
 * redefined in a suite: two versions of `openRoster` that differ by one
 * click would produce two different starting states, and the suite that
 * gets the wrong one fails for a reason that has nothing to do with what it
 * tests.
 *
 * `#cg-groups` correction: Stage 3, Task 2's own brief used it for
 * `withGroups`'s own assertion -- that id belongs to the "number of
 * groups" NUMBER INPUT (`ClassroomGroupsPage.astro`'s `.split-by` field,
 * `mode="groupCount"`), not the results container. The real results
 * container is `#cg-results` -- `#cg-tables` inside it is what
 * classroom-groups.ts's own `render()` actually appends `.group` cards to
 * -- already the corrected, established selector throughout
 * classroom-groups.spec.ts (see that file's own comment recording the
 * identical mistake in Stage 2, Task 1's own brief). Corrected here for the
 * same reason, rather than reproduced verbatim into a helper every later
 * stage would then inherit.
 */
export const openRoster = async (page: Page, path = '/classroom-groups') => {
  await page.goto(path);
  await page.locator('#cg-students-toggle').click();
  await page
    .getByRole('button', {
      name: stringsOf(page).rosterAddStudent,
      exact: true,
    })
    .click();
};

/**
 * The board put up before any shuffle (#743): `count` students by `size`,
 * waiting with their empty cards. A helper, as `openRoster` is, so a spec
 * that only captures the result (`visual.spec.ts`) acts through it.
 */
export const openWaitingBoard = async (
  page: Page,
  count: string,
  size: string,
  speed?: 'normal' | 'fast' | 'skip',
) => {
  await page.goto('/classroom-groups');
  await page.fill('#cg-count', count);
  await page.fill('#cg-size', size);
  // #744: a board Shuffle travels unless the speed is Skip, so a test that
  // presses it says which it means; left out, the page's default stands.
  if (speed) await chooseSpeed(page, speed);
  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect(page.locator('#cg-board')).not.toHaveAttribute('hidden', /.*/);
  await expect(page.locator('#cg-board .waiting-student')).toHaveCount(
    Number(count),
  );
};

/**
 * `expected` with its list of names joined the way THIS browser joins them.
 *
 * Messages are rendered here in Node, and the page joins a list with its own
 * engine's `Intl.ListFormat`, in the locale's `numberLocale`. Engines
 * disagree: measured 2026-09-14, WebKit 26.6 spaces Thai "และ" where Chromium
 * 153, Firefox 155 and Node's CLDR 48 do not. So the join comes from the
 * page's engine and every word around it from the catalogue. Node's join must
 * occur exactly once, or the swap would compare nothing it meant to; the
 * replacement is a function so a `$` in a name is never read as a pattern.
 */
export const listedByThisBrowser = async (
  page: Page,
  locale: Locale,
  names: readonly string[],
  expected: string,
): Promise<string> => {
  const { numberLocale } = LOCALE_METADATA[locale];
  const inNode = new Intl.ListFormat(numberLocale, {
    type: 'conjunction',
  }).format(names);
  const inBrowser = await page.evaluate(
    ([tag, items]) =>
      new Intl.ListFormat(tag, { type: 'conjunction' }).format(items),
    [numberLocale, [...names]] as [string, string[]],
  );
  expect(expected.split(inNode), `the list "${inNode}", once`).toHaveLength(2);
  return expected.replace(inNode, () => inBrowser);
};

/** Visible copy is both: `toHaveText` alone passes on a hidden element. */
export const expectVisibleText = async (target: Locator, text: string) => {
  await expect(target).toBeVisible();
  await expect(target).toHaveText(text);
};

/**
 * Give every roster row a sex.
 *
 * "Make Groups" does not enable until every student has one (operator,
 * 2026-08-13; `rosterProblems`' `no-sex` problem). `openRoster` and
 * `addSeveral` deliberately create rows WITHOUT a sex — the tests for the
 * sex-based grouping options depend on being able to — so any test that
 * builds a roster that way and then wants to reach the results calls this.
 *
 * 'M' for everyone means "this test does not care about sex". A test that
 * does states its own mix through `buildRoster`.
 */
export const giveEveryoneASex = async (page: Page, sex: 'M' | 'F' = 'M') => {
  const rows = page.locator('#cg-roster tbody tr');
  for (let i = 0; i < (await rows.count()); i++) {
    const select = rows
      .nth(i)
      .getByLabel(stringsOf(page).rosterColSex, { exact: true });
    if ((await select.inputValue()) === '') await select.selectOption(sex);
  }
};

export const addSeveral = async (page: Page, howMany: number) => {
  const t = stringsOf(page);
  await page
    .getByRole('button', { name: t.rosterAddSeveral, exact: true })
    .click();
  await page.getByLabel(t.rosterHowMany, { exact: true }).fill(String(howMany));
  await page
    .getByRole('button', { name: t.rosterAddConfirm, exact: true })
    .click();
};

/**
 * Assert the Students box reports `expected`, in a way the markup alone
 * cannot satisfy.
 *
 * `#cg-count` ships a build-time `value=`, so the box already holds a number
 * before a line of script runs. Three assertions expected the very number it
 * ships and passed with `updateStudentsBox`'s write removed (#193) -- guarded
 * the whole time by a comment that named this exact hazard and then went
 * stale when the shipped default moved onto the number they expected.
 *
 * So the control is not a second literal, which would rot the same way.
 * Assigning `.value` sets the IDL property and never rewrites the content
 * attribute, so the live page still carries its own shipped default and
 * `getAttribute('value')` reads it back from the element under test. The
 * control runs FIRST: an expectation that cannot distinguish a written value
 * from an untouched one should say so, rather than be masked by whichever
 * assertion happens to fail after it (#156).
 */
export const expectStudentsBoxReports = async (
  box: Locator,
  expected: number,
) => {
  const shipped = await box.getAttribute('value');
  expect(
    String(expected),
    `the box ships value="${shipped}", so expecting ${expected} cannot tell a ` +
      'value written from the roster from the untouched markup',
  ).not.toBe(shipped);
  await expect(box).toHaveValue(String(expected));
};

/**
 * Marks the FIRST roster row absent -- `openRoster` already adds one
 * student (its own "Add student" click), so this only needs to tick that
 * row's own Absent box. Stage 3, Task 4's own state-setup helper, placed
 * HERE rather than as a local `const` inside the spec file (task-4-brief.md's
 * own Step 1 snippet defines it locally): this file's own header comment
 * says plainly "Stage 3, 4 and 5 all need one [fixture]" and "every helper
 * lives here and is imported, never redefined in a suite" -- and stage 5
 * (the print panel, which prints an `Absent` column) is a real second
 * consumer-to-be, not a hypothetical one, so the same rule that already
 * governs `openRoster`/`addSeveral` applies to this one too.
 */
export const markAbsent = async (page: Page, path = '/classroom-groups') => {
  await openRoster(page, path);
  await page
    .locator('.cg-student')
    .first()
    .getByLabel(stringsOf(page).rosterColAbsent)
    .check();
};

export const setSex = async (page: Page, row: number, sex: 'M' | 'F') =>
  page
    .locator('.cg-student')
    .nth(row)
    .getByLabel(stringsOf(page).rosterColSex, { exact: true })
    .selectOption(sex);

/** [sex, name] per student, in order. The one builder every later suite uses. */
export const buildRoster = async (
  page: Page,
  students: Array<['M' | 'F' | null, string?]>,
  path = '/classroom-groups',
) => {
  await openRoster(page, path);
  if (students.length > 1) await addSeveral(page, students.length - 1);
  for (const [i, [sex, name]] of students.entries()) {
    const row = page.locator('.cg-student').nth(i);
    if (name)
      await row
        .getByLabel(stringsOf(page).rosterColName, { exact: true })
        .fill(name);
    if (sex)
      await row
        .getByLabel(stringsOf(page).rosterColSex, { exact: true })
        .selectOption(sex);
  }
  await expect(page.locator('.cg-student')).toHaveCount(students.length);
};

/**
 * A roster of `n` students that is READY TO GROUP — every student carries a
 * sex, because sex is required before "Make Groups" enables (operator,
 * 2026-08-13; `rosterProblems`' own `no-sex` problem, src/lib/roster.ts).
 *
 * 'M' for all of them is deliberate and means "this test does not care about
 * sex". A test that DOES care states its own mix through `buildRoster`, which
 * still honours `null` — that is how the tests for the sex-based grouping
 * options build a roster that is intentionally incomplete.
 */
export const rosterOf = async (
  page: Page,
  n: number,
  path = '/classroom-groups',
) =>
  buildRoster(
    page,
    Array.from({ length: n }, () => ['M'] as ['M']),
    path,
  );

export const withGroups = async (
  page: Page,
  n = 12,
  path = '/classroom-groups',
) => {
  await rosterOf(page, n, path);
  // The page's own `makeGroups`, exactly, in whichever language it shows.
  await page
    .getByRole('button', { name: stringsOf(page).makeGroups, exact: true })
    .click();
  await expect(page.locator('#cg-results .group').first()).toBeVisible();
};

/**
 * The PRODUCT's formatter, re-exported -- never a second implementation.
 *
 * This used to be its own `toISOString().slice(0, 10)`, which agreed with
 * the product only while the product was also (wrongly) UTC. The moment
 * `todayISO` was fixed to the local calendar day, a re-implementation here
 * would have disagreed with it for the seven hours a day this machine's
 * own timezone is ahead of UTC -- making every filename and printed-date
 * test fail in the morning and pass in the afternoon.
 *
 * That makes these e2e assertions agree with the product by construction,
 * which is the point: WHAT the date should be is pinned at unit level
 * against explicit local dates (tests/unit/csv.test.ts), and what these
 * tests check is that the page uses it.
 */
export { todayISO } from '../../src/lib/csv';

/**
 * Stage 4's fixtures. ADDED to this file, never started as a second one --
 * see this file's own header for why two versions of a helper is a bug
 * waiting to be blamed on the wrong test.
 */
export const upload = async (page: Page, name: string, body: string) => {
  await page.locator('#cg-import').setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(body, 'utf8'),
  });
};

/**
 * The bytes a download actually contains, not the button that produced it.
 *
 * On the real phone the file is saved ON THE PHONE, where the Mac-side stream behind
 * `createReadStream()` cannot reach it, so it is read back over adb instead (#308). The phone's
 * download folder is emptied first, so the file read back is this download's and cannot be an
 * earlier one under the same name.
 */
export const downloadText = async (page: Page, button: string | RegExp) => {
  if (onRealDevice()) emptyDeviceDownloads();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: button }).click(),
  ]);
  if (onRealDevice()) return deviceDownloadText(download);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
};

export const downloadName = async (page: Page, button: string | RegExp) => {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: button }).click(),
  ]);
  return download.suggestedFilename();
};

/** Build a roster on a named locale's page — the handover needs both. */
export const buildRosterAtPath = async (
  page: Page,
  path: string,
  students: Array<['M' | 'F' | null, string?]>,
) => buildRoster(page, students, path);

/**
 * Stage 5's fixtures. Six students, number 4 absent, letters on #1/#2
 * (together) and #3 (apart).
 *
 * The SHAPE is what makes `['1','2','3','5','6']` the right expectation when
 * absent students are dropped -- change this fixture and those assertions
 * become meaningless rather than failing, which is exactly why it lives in
 * one place.
 */
export const rosterWithAnAbsence = async (page: Page) => {
  await buildRoster(page, [
    ['F', 'Ana'],
    ['M', 'Budi'],
    ['F', 'Citra'],
    ['F', 'Dewi'],
    ['M', 'Eko'],
    [null],
  ]);
  await page
    .locator('.cg-student')
    .nth(0)
    .getByLabel(/Together/)
    .selectOption('A');
  await page
    .locator('.cg-student')
    .nth(1)
    .getByLabel(/Together/)
    .selectOption('A');
  await page
    .locator('.cg-student')
    .nth(2)
    .getByLabel(/Apart/)
    .selectOption('A');
  await page
    .locator('.cg-student')
    .nth(3)
    .getByLabel(/Absent/)
    .check();
};

/** Six boys and two girls — separate mode then cannot give the girls a group. */
export const rosterForSpillover = async (page: Page) => {
  await buildRoster(page, [
    ['M', 'Ana'],
    ['M', 'Budi'],
    ['M', 'Citra'],
    ['M', 'Dedi'],
    ['M', 'Eko'],
    ['M', 'Fajar'],
    ['F', 'Gita'],
    ['F', 'Hani'],
  ]);
  await page.locator('#cg-grouping-toggle').click();
  await page.getByLabel(/Keep boys and girls separate/).check();
  await page.getByLabel(/Students in each group/).fill('4');
};

export const namesIn = (text: string): string[] =>
  text.split(/\s+/).filter((w) => /^[A-Z][a-z]+$/.test(w));

/** Open the print panel from the results section. */
export const openPrintPanel = async (page: Page) => {
  await page
    .getByRole('button', { name: stringsOf(page).printOpen, exact: true })
    .first()
    .click();
  await expect(page.locator('#cg-print-panel')).toBeVisible();
};

/**
 * Press a handover destination by the language's OWN name.
 *
 * #21 Stage 3 replaced the single "the other language" button with a
 * disclosure of one button per language, so reaching a destination is two
 * clicks: the summary opens the list, and the language's own button is the
 * gesture that opens the tab.
 *
 * Returned as ONE promise deliberately. `window.open` has to run inside that
 * second click, so every caller arms `waitForEvent('download')` /
 * `context.waitForEvent('page')` AROUND the whole sequence — passing this
 * straight into `Promise.all` keeps the waiters registered before the click,
 * which a two-statement version would not.
 */
export const handoverTo = async (page: Page, language: string | RegExp) => {
  await page.locator('#cg-io-both-toggle').click();
  await page.getByRole('button', { name: language }).click();
};

/**
 * Refuse every fullscreen request, so the board opens as an overlay.
 *
 * The overlay is the board iOS Safari always gets, since it never grants
 * fullscreen on an arbitrary element, and it is the same layer either way.
 * A spec whose subject is not fullscreen itself takes this path, because a
 * GRANTED fullscreen can be taken back by the browser, and the board rightly
 * closes when that happens (`projector.ts`, `fullscreenchange`). Measured on
 * macOS WebKit at two workers (#344): a board in a `handoverTo` popup lost
 * its granted fullscreen in 12 of 81 runs, with no exit asked for by the
 * page, and closed under the test.
 *
 * Takes a context as well as a page, because an init script added to a page
 * never reaches the popup that page opens.
 */
export const refuseFullscreen = (target: Page | BrowserContext) =>
  target.addInitScript(() => {
    Element.prototype.requestFullscreen = () =>
      Promise.reject(new Error('refused'));
  });

/**
 * Answer the first fullscreen request only once the second one is granted.
 *
 * The order a real Android phone gives (#231): the board is opened, left with
 * Escape before its grant lands, and opened again, and only then do both
 * grants arrive, the first one first. Measured on CPH2653 in 7 of 40 runs of
 * the Escape test, where the document stayed out of fullscreen through the
 * whole first showing.
 *
 * So the first request never reaches the browser: its promise is parked, and
 * the second request's real grant settles it, first, and then the second's
 * own. The page sees exactly the phone's order, on any engine that grants
 * fullscreen. Asking the browser for both was tried first, and on the phone
 * the first grant sometimes landed while the board was closed, with its
 * answer still parked, so the page could not undo it and the document sat in
 * fullscreen over a hidden board, swallowing every click: a state this helper
 * made, not one the page can reach.
 *
 * `window.__fullscreenRace` counts what a test waits on instead of a clock:
 * `answered` rises only after the page's own handler for that answer has
 * run (registered a microtask after the page registers its own), and
 * `exitsAsked` counts every `exitFullscreen` the page calls.
 */
export const holdFirstGrantUntilTheNext = (page: Page) =>
  page.addInitScript(() => {
    const race = { answered: 0, exitsAsked: 0 };
    (window as unknown as { __fullscreenRace: typeof race }).__fullscreenRace =
      race;
    const realExit = Document.prototype.exitFullscreen;
    Document.prototype.exitFullscreen = function () {
      race.exitsAsked += 1;
      return realExit.call(this);
    };
    const real = Element.prototype.requestFullscreen;
    const counted = (answer: Promise<void>) => {
      queueMicrotask(() => {
        const done = () => {
          race.answered += 1;
        };
        answer.then(done, done);
      });
      return answer;
    };
    let first: { grant: () => void; refuse: (error: unknown) => void } = {
      grant: () => {},
      refuse: () => {},
    };
    let calls = 0;
    Element.prototype.requestFullscreen = function (options) {
      calls += 1;
      if (calls === 1) {
        return counted(
          new Promise<void>((grant, refuse) => {
            first = { grant, refuse };
          }),
        );
      }
      const granted = real.call(this, options);
      if (calls === 2) {
        // Settled from the grant's own reaction, registered before the
        // second answer's, so the first showing's handler runs first.
        granted.then(first.grant, first.refuse);
        return counted(granted.then(() => undefined));
      }
      return granted;
    };
  });

/**
 * The contrast ratio the browser actually PAINTS for an element's text.
 *
 * Not the token values: it resolves `opacity` and walks up for the first
 * ancestor that actually sets a background, which is the composite the browser
 * performs. A dimmed element whose colour token passes AA on paper can still
 * fail once its own opacity is mixed against what is behind it -- that is the
 * bug this was first written for, in classroom-groups.
 *
 * Here rather than copied into a second spec: two contrast computations that
 * differ by one term would disagree about the same pixels, and the suite that
 * got the lenient one would pass while the page failed a real audit.
 */
export const contrastRatio = async (target: Locator): Promise<number> => {
  // The browser READS; the arithmetic happens in node, against the one copy
  // of the WCAG formula this repo has (#277). A `page.evaluate` callback is
  // serialised and cannot import, so a callback that did the maths itself
  // was a copy by construction -- and three of them had accumulated, all
  // linearising at a different constant from the two node-side copies.
  const painted = await target.evaluate((el) => {
    const style = getComputedStyle(el);
    // Every background from the element itself -- it may paint its own --
    // outward, nearest first. Not just the first: a translucent layer is
    // composited over what is behind it, which `paintedGround` does (#390
    // F127).
    const grounds: string[] = [];
    for (let at: Element | null = el; at; at = at.parentElement) {
      const c = getComputedStyle(at).backgroundColor;
      if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') grounds.push(c);
    }
    return { colour: style.color, grounds, opacity: Number(style.opacity) };
  });

  const ink = parseColour(painted.colour);
  const layers = painted.grounds.map(parseColour);
  if (ink === null || layers.some((layer) => layer === null))
    throw new Error(
      `unreadable computed colour: ${painted.colour} on ${painted.grounds.join(' over ')}`,
    );
  const ground = paintedGround(
    layers.filter((layer): layer is NonNullable<typeof layer> => !!layer),
  );
  // The element's own opacity dims its text against what is behind it. A
  // colour token that passes AA on paper can still fail once the browser has
  // mixed it -- the bug this was first written for, in classroom-groups.
  const mixed = over(
    { rgb: ink.rgb, alpha: ink.alpha * painted.opacity },
    ground,
  );
  return contrast(mixed, ground);
};

/**
 * A CSS colour, or `var(--token)`, as the browser resolves it: a probe's
 * computed `color`. An assertion then compares two colours the browser
 * resolved, never the browser's rgb against a hex written by hand.
 *
 * An undefined token resolves to the ink the probe inherits, not to nothing,
 * so a caller comparing a token against what a rule paints needs the rule's
 * own colour on the other side.
 */
export const resolvedColour = (page: Page, value: string): Promise<string> =>
  page.evaluate((value) => {
    const probe = document.createElement('span');
    probe.style.color = value;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, value);

/**
 * Every place a browser could have kept a pupil's name, in one read (#277).
 *
 * Four probes had grown for the same claim, and they did not agree about
 * where to look. `classroom-groups-privacy.spec.ts` had two -- an object of
 * four fields, and a joined string of the same four -- `classroom-groups-
 * io.spec.ts` had the joined string inline, and `classroom-groups-
 * roster.spec.ts` read `localStorage` and `sessionStorage` ONLY. That last
 * one asserts "a typed name never reaches storage" while looking at two of
 * the four places a name could go: the address bar and the cookie jar were
 * never checked, so the test most specifically about a typed name was the
 * weakest of the four. Collapsing them is a coverage fix as much as a
 * refactor.
 *
 * The cookie field's own reason, kept from the copy that had it: the plan's
 * snippet checked the first three, and a cookie is the fourth place a name
 * could be written to.
 */
export const everywhereItCouldHide = (page: Page) =>
  page.evaluate(() => ({
    local: JSON.stringify({ ...localStorage }),
    session: JSON.stringify({ ...sessionStorage }),
    url: location.href,
    cookies: document.cookie,
  }));

/**
 * Assert none of `names` appears anywhere the page could have persisted it.
 *
 * This is an absence assertion over a population read at runtime, so it
 * carries its own liveness controls (#118): with no names there is nothing
 * to look for, and a probe that quietly stopped reading one of the four
 * places would pass every call here while covering less than its name says.
 * Both are asserted rather than assumed -- an emptied probe and a clean page
 * look identical from the outside.
 */
export const expectNothingStored = async (
  page: Page,
  when: string,
  ...names: readonly string[]
): Promise<void> => {
  expect(names.length, `${when}: no name to look for`).toBeGreaterThan(0);
  const stored = await everywhereItCouldHide(page);
  expect(
    Object.keys(stored),
    `${when}: the probe stopped reading somewhere a name could hide`,
  ).toEqual(['local', 'session', 'url', 'cookies']);
  for (const [where, value] of Object.entries(stored))
    for (const name of names)
      expect(value, `${where} — ${when}`).not.toContain(name);
};

/**
 * Every text a report form shows that falls under AA: its summary, every
 * label and paragraph it renders, and its send button, read from the DOM.
 * Naming the quote label and two hints passed a note label painted in
 * --border, on the 404 and in the footer alike (#390 F138, F146). The
 * honeypot's label sits in its own div, so `form > label` leaves it out.
 * Returns what was read too, so the caller's absence assertion can count it.
 */
export const formTextsUnderAA = async (
  details: Locator,
  send: Locator,
): Promise<{ failing: string[]; read: string[] }> => {
  const words = details.locator('form > label, form > p');
  await expect(words.first()).toBeVisible();
  const failing: string[] = [];
  const read: string[] = [];
  // runtime population: the labels and paragraphs this form rendered.
  for (const text of [
    details.locator('summary'),
    ...(await words.all()),
    send,
  ]) {
    const said = await text.innerText();
    read.push(said);
    const ratio = await contrastRatio(text);
    if (ratio < 4.5) failing.push(`'${said}' ${ratio.toFixed(2)}:1`);
  }
  return { failing, read };
};
