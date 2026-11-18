import { randomUUID } from 'node:crypto';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { evidencePageOf } from '../evidence-fixture';
import {
  installDbStandIn,
  type Completion,
  type DbStandInOptions,
  type StandInWindow,
  type StoredBody,
  type WriteOrder,
} from './db-stand-in';
import { test as base, expect } from './fixtures';
import { contrastRatio } from './helpers';
import { recordErrors } from './recorders';
import { recorded, shoot } from './evidence';

/**
 * The evidence page's sign-off ticks, driven through the page's OWN rendered
 * script in a real browser (#172).
 *
 * The page kept the runtime's frozen snapshot as its own state, so after the
 * first save every tick was silently dropped and repainted unticked, while
 * the status line said "Saved." #136's sign-off kept 2 of its 5 ticks that
 * way, and #17's page had reported the same symptom three days earlier.
 * Nothing had ever run the script: the unit suite reads the page as text, and
 * text cannot freeze an object.
 *
 * Every behaviour runs against both orders a write can complete in (see
 * `db-stand-in.ts`), and a store slower than the page's save window is
 * played out step by step, the test releasing each completion itself
 * (#260). Ticks are found through their journey's HEADING, never
 * through the checkbox's own name, so these tests fail on the tick they name
 * and not on the naming defect #172 also fixes.
 */

const TITLES = [
  'the first journey',
  'the second journey',
  'the third journey',
  'the fourth journey',
  'the fifth journey',
] as const;

const SIGNOFF_KEY = 'ticket-172-fixture';
/** Where a published page keeps its sign-off, as `signoff/ticket-136` does. */
const DOC = `signoff/${SIGNOFF_KEY}`;
const ORIGIN = 'https://evidence.test';

/** The page exactly as the builder renders it for a ticket with these journeys. */
const pageOf = (titles: readonly string[]): string =>
  evidencePageOf(titles, SIGNOFF_KEY);

/** The page exactly as the builder renders it for a five-journey ticket. */
const HTML: string = pageOf(TITLES);

/** Journey ids as a page rendered them, each paired with its heading. */
const journeysOf = (html: string) =>
  Array.from(
    html.matchAll(/data-journey="([^"]+)"[\s\S]*?<h3>([^<]*)<\/h3>/g),
    ([, id = '', title = '']) => ({ id, title }),
  );

const JOURNEYS = journeysOf(HTML);

const idOf = (title: string): string => {
  const journey = JOURNEYS.find((candidate) => candidate.title === title);
  if (!journey)
    throw new Error(
      `the rendered page has no journey headed "${title}"; it rendered ${JSON.stringify(JOURNEYS)}`,
    );
  return journey.id;
};

const idsOf = (titles: readonly string[]): string[] => titles.map(idOf).sort();

/** A stored sign-off with these journeys ticked, as an earlier visit left it. */
const signedOff = (titles: readonly string[]): Record<string, StoredBody> => ({
  [DOC]: {
    journeys: Object.fromEntries(titles.map((title) => [idOf(title), true])),
    verdict: null,
    note: '',
    updatedAt: '2026-09-14T15:09:00.000Z',
  },
});

/**
 * Every test also fails if the page script throws. In strict mode a write
 * into a frozen snapshot is a TypeError, so this names that mistake outright.
 */
const test = base.extend<{ pageErrors: void }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors = recordErrors(page);
      await use();
      await errors.expectNoUncaught(
        'the evidence page script threw while it was driven',
      );
    },
    { auto: true },
  ],
});

test.use(recorded);

/**
 * Serves the page as the builder rendered it, and nothing from any other host.
 * Called again, it republishes to the same address, as a rebuilt evidence
 * page is: the store, kept per test, carries over.
 */
async function serveEvidencePage(page: Page, html = HTML): Promise<void> {
  await page.unroute(/^https:\/\/evidence\.test\//);
  await page.route(/^https:\/\/evidence\.test\//, (route) =>
    route.request().url() === `${ORIGIN}/`
      ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
      : route.fulfill({ status: 204 }),
  );
  // The builder links Google Fonts. Nothing in this suite reaches a third party.
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) =>
    route.fulfill({ contentType: 'text/css', body: '' }),
  );
}

/** This run, as the stand-in's store keys name it: new in every run. */
const THIS_RUN = randomUUID();

/**
 * Where a test keeps its stand-in store during the run named by `run`, and
 * the prefix its earlier runs used. A real phone keeps one Chrome profile
 * from run to run, so a key that is unique only per test hands each test the
 * store its previous run left (#229). The prefix stops at the repeat: a retry
 * replaces its failed attempt's store, and another repeat's is left alone.
 */
const storeKeyOf = (testInfo: TestInfo, run: string = THIS_RUN) => {
  const supersedes = `evidence-db:${testInfo.testId}:${testInfo.repeatEachIndex}:`;
  return { storeKey: `${supersedes}${testInfo.retry}:${run}`, supersedes };
};

async function openEvidencePage(
  page: Page,
  testInfo: TestInfo,
  options: Pick<DbStandInOptions, 'order'> &
    Partial<DbStandInOptions> & { html?: string },
): Promise<void> {
  const { html = HTML, ...standIn } = options;
  await serveEvidencePage(page, html);
  await page.addInitScript(installDbStandIn, {
    ...storeKeyOf(testInfo),
    seed: {},
    holdUse: false,
    subscriptionDies: false,
    getFails: false,
    ...standIn,
  });
  await page.goto(`${ORIGIN}/`);
  // Nothing is delivered while use() is held, or when every read fails and no
  // subscription lives to deliver the stored state instead.
  if (!standIn.holdUse && !(standIn.getFails && standIn.subscriptionDies))
    await expect
      .poll(
        async () => (await counters(page)).deliveries,
        'the page received its stored state',
      )
      .toBeGreaterThan(0);
}

/**
 * Rebuilds the page from `html`, republishes it to the same address, and
 * reopens it as its reader would. The stand-in reinstalls on the reload, so
 * its counters start again from nothing, and the store it keeps carries over.
 */
async function republish(page: Page, html: string): Promise<void> {
  await serveEvidencePage(page, html);
  await page.reload();
  await expect
    .poll(
      async () => (await counters(page)).deliveries,
      'the republished page received its stored state',
    )
    .toBeGreaterThan(0);
}

const counters = (page: Page) =>
  page.evaluate(() => {
    const standIn = (window as StandInWindow).__dbStandIn;
    return {
      writes: standIn.writes(),
      inflight: standIn.inflight(),
      deliveries: standIn.deliveries(),
    };
  });

/** The journeys the store holds as ticked, as sorted ids. */
const storedTicks = (page: Page) =>
  page.evaluate((doc) => {
    const body = (window as StandInWindow).__dbStandIn.read(doc);
    const journeys = (body?.journeys ?? {}) as Record<string, unknown>;
    return Object.keys(journeys)
      .filter((id) => journeys[id] === true)
      .sort();
  }, DOC);

const journeySection = (page: Page, title: string) =>
  page.locator('section.journey').filter({
    has: page.getByRole('heading', { level: 3, name: title, exact: true }),
  });

const tickBox = (page: Page, title: string) =>
  journeySection(page, title).getByRole('checkbox');

/** What a person clicks: the label around the tick, not the transparent input inside it. */
const toggle = (page: Page, title: string) =>
  journeySection(page, title)
    .locator('label')
    .filter({ has: page.getByRole('checkbox') })
    .click();

/** Does what a person does, then waits for the page to write it and the store to confirm it. */
async function writtenAfter(
  page: Page,
  act: () => Promise<void>,
  what: string,
): Promise<void> {
  const before = (await counters(page)).writes;
  await act();
  await expect
    .poll(async () => {
      const now = await counters(page);
      return now.writes > before && now.inflight === 0;
    }, `the page wrote ${what} and the store confirmed it`)
    .toBe(true);
}

/** One tick, then wait for the page to write it and the store to confirm it, as a person would. */
const toggleAndWait = (page: Page, title: string): Promise<void> =>
  writtenAfter(page, () => toggle(page, title), `the change to "${title}"`);

/** Several ticks in ONE task, so they are certain to fall inside one save window. */
const toggleTogether = (page: Page, titles: readonly string[]) =>
  page.evaluate((wanted) => {
    for (const title of wanted) {
      const section = Array.from(
        document.querySelectorAll('section.journey'),
      ).find(
        (candidate) => candidate.querySelector('h3')?.textContent === title,
      );
      const label = section?.querySelector('label');
      if (!label) throw new Error(`no tick found for "${title}"`);
      label.click();
    }
  }, titles);

const ORDERS: ReadonlyArray<{ order: WriteOrder; when: string }> = [
  {
    order: 'resolve-then-confirm',
    when: 'a write resolves before its confirmed snapshot arrives',
  },
  {
    order: 'confirm-then-resolve',
    when: 'a confirmed snapshot arrives before its write resolves',
  },
];

for (const { order, when } of ORDERS) {
  test.describe(`evidence page sign-off ticks, when ${when}`, () => {
    test('the stand-in freezes every delivery and shows a write pending before confirming it', async ({
      page,
    }, testInfo) => {
      await openEvidencePage(page, testInfo, { order });
      const trace = await page.evaluate(async () => {
        const db = await (window as StandInWindow).claude.use('db');
        if (!db) return ['use resolved null'];
        const ref = db.doc('stand-in/self-test');
        const seen: string[] = [];
        let last: unknown;
        ref.onSnapshot((snap) => {
          const body = snap.data();
          const frozen = [snap, snap.metadata, body, body?.journeys].every(
            (part) => part === undefined || Object.isFrozen(part),
          );
          seen.push(
            `${snap.exists ? 'exists' : 'absent'}, pending ${snap.metadata.hasPendingWrites}, ` +
              `frozen ${frozen}, same body ${body !== undefined && body === last}`,
          );
          last = body;
        });
        const pause = (ms: number) =>
          new Promise((resolve) => setTimeout(resolve, ms));
        await pause(50);
        await ref.set({ journeys: { a: true } }).then(() => {
          seen.push('set resolved');
        });
        await pause(200);
        return seen;
      });
      const absent = 'absent, pending false, frozen true, same body false';
      const pending = 'exists, pending true, frozen true, same body false';
      const confirmed = 'exists, pending false, frozen true, same body true';
      expect(trace).toEqual(
        order === 'resolve-then-confirm'
          ? [absent, pending, 'set resolved', confirmed]
          : [absent, pending, confirmed, 'set resolved'],
      );
    });

    test('five ticks made one at a time all persist, and all five are still ticked after a reload', async ({
      page,
    }, testInfo) => {
      await openEvidencePage(page, testInfo, { order });
      for (const title of TITLES) await toggleAndWait(page, title);
      await expect
        .poll(() => storedTicks(page), 'the store keeps every journey ticked')
        .toEqual(idsOf(TITLES));
      await page.reload();
      for (const title of TITLES)
        await expect(
          tickBox(page, title),
          `"${title}" is still ticked after the reload`,
        ).toBeChecked();
    });

    test('a tick made when the stored sign-off already exists persists beside what was stored', async ({
      page,
    }, testInfo) => {
      await openEvidencePage(page, testInfo, {
        order,
        seed: signedOff(TITLES.slice(0, 2)),
      });
      await expect(
        tickBox(page, TITLES[1]),
        'the stored ticks are shown first',
      ).toBeChecked();
      for (const title of TITLES.slice(2)) await toggleAndWait(page, title);
      await expect
        .poll(
          () => storedTicks(page),
          'the store keeps the stored ticks and the new ones',
        )
        .toEqual(idsOf(TITLES));
      await page.reload();
      for (const title of TITLES)
        await expect(
          tickBox(page, title),
          `"${title}" is still ticked after the reload`,
        ).toBeChecked();
    });

    test('several ticks inside one save window all persist', async ({
      page,
    }, testInfo) => {
      await openEvidencePage(page, testInfo, { order });
      await toggleAndWait(page, TITLES[0]);
      await toggleTogether(page, TITLES.slice(1, 4));
      await expect
        .poll(
          () => storedTicks(page),
          'the store keeps every tick made inside the window',
        )
        .toEqual(idsOf(TITLES.slice(0, 4)));
    });

    test('a tick made before storage answers persists, and nothing already stored is lost', async ({
      page,
    }, testInfo) => {
      await openEvidencePage(page, testInfo, {
        order,
        seed: signedOff(TITLES.slice(0, 2)),
        holdUse: true,
      });
      await toggle(page, TITLES[2]);
      await expect(tickBox(page, TITLES[2])).toBeChecked();
      // Answer storage and read the status the moment the stored sign-off
      // lands, long before the 400 ms save: a status calling the page ready
      // over a tick that is not yet stored is caught in the act.
      const statusOnLoad = await page.evaluate(async () => {
        const standIn = (window as StandInWindow).__dbStandIn;
        standIn.answer();
        await new Promise<void>((resolve) => {
          const waiting = setInterval(() => {
            if (standIn.deliveries() === 0) return;
            clearInterval(waiting);
            resolve();
          }, 5);
        });
        return document.getElementById('state')?.textContent ?? '';
      });
      expect(statusOnLoad, 'the early tick is reported as saving').toMatch(
        /^Saving\b/,
      );
      await expect
        .poll(
          () => storedTicks(page),
          'the store keeps the stored ticks and the early one',
        )
        .toEqual(idsOf(TITLES.slice(0, 3)));
      for (const title of TITLES.slice(0, 3))
        await expect(
          tickBox(page, title),
          `"${title}" is shown ticked`,
        ).toBeChecked();
    });

    test('unticking persists too, so a review can be corrected', async ({
      page,
    }, testInfo) => {
      await openEvidencePage(page, testInfo, {
        order,
        seed: signedOff(TITLES.slice(0, 3)),
      });
      await expect(
        tickBox(page, TITLES[1]),
        'the stored ticks are shown first',
      ).toBeChecked();
      await toggleAndWait(page, TITLES[1]);
      await expect
        .poll(() => storedTicks(page), 'the store no longer holds the untick')
        .toEqual(idsOf([TITLES[0], TITLES[2]]));
      await page.reload();
      // The stored state has loaded before the untick is read, or an
      // unticked box would prove nothing.
      await expect(tickBox(page, TITLES[0])).toBeChecked();
      await expect(
        tickBox(page, TITLES[1]),
        'the untick survived the reload',
      ).not.toBeChecked();
      await expect(tickBox(page, TITLES[2])).toBeChecked();
    });

    test("another viewer's tick appears once this view has nothing unsaved", async ({
      page,
    }, testInfo) => {
      await openEvidencePage(page, testInfo, { order });
      await toggleAndWait(page, TITLES[0]);
      await page.evaluate(
        ({ doc, body }) =>
          (window as StandInWindow).__dbStandIn.remoteWrite(doc, body),
        { doc: DOC, body: signedOff(TITLES.slice(0, 2))[DOC] ?? {} },
      );
      await expect(
        tickBox(page, TITLES[1]),
        "the other viewer's tick is shown",
      ).toBeChecked();
      await expect(tickBox(page, TITLES[0])).toBeChecked();
    });

    test('the status never says Saved while the store lacks the tick just made', async ({
      page,
    }, testInfo) => {
      await openEvidencePage(page, testInfo, { order });
      await toggleAndWait(page, TITLES[0]);
      await expect(
        page.locator('#state'),
        'the first tick is reported saved',
      ).toHaveText(/^Saved\b/);
      await toggle(page, TITLES[1]);
      const claim = await page.evaluate(
        ({ doc, id }) => {
          const body = (window as StandInWindow).__dbStandIn.read(doc);
          const journeys = (body?.journeys ?? {}) as Record<string, unknown>;
          return {
            status: document.getElementById('state')?.textContent ?? '',
            stored: journeys[id] === true,
          };
        },
        { doc: DOC, id: idOf(TITLES[1]) },
      );
      expect(
        claim.stored || !/^Saved\b/.test(claim.status),
        `the status read "${claim.status}" while the store did not hold the tick on "${TITLES[1]}"`,
      ).toBe(true);
    });

    test('ticks stay shown and stored after live updates stop', async ({
      page,
    }, testInfo) => {
      // Once a subscription has ended, nothing echoes the page's own writes.
      // A page that forgets a tick the moment its write is confirmed repaints
      // that tick off, and its next save writes the store without it. The
      // stored tick means every confirmed write folds into a delivered body.
      const stored = TITLES[4];
      const ticked = [TITLES[0], TITLES[1], stored];
      await openEvidencePage(page, testInfo, {
        order,
        seed: signedOff([stored]),
        subscriptionDies: true,
      });
      await expect(
        tickBox(page, stored),
        'the stored tick is shown first',
      ).toBeChecked();
      await toggleAndWait(page, TITLES[0]);
      await expect(
        tickBox(page, TITLES[0]),
        'the confirmed tick is still shown with no live updates',
      ).toBeChecked();
      await toggleAndWait(page, TITLES[1]);
      await expect
        .poll(
          () => storedTicks(page),
          'the store keeps every tick with no live updates',
        )
        .toEqual(idsOf(ticked));
      for (const title of ticked)
        await expect(
          tickBox(page, title),
          `"${title}" is shown ticked`,
        ).toBeChecked();
    });
  });
}

/**
 * What a slow-store scenario does next: click a numbered journey's tick,
 * wait for the page's next write (`saved`), or release the oldest held
 * write's confirmation or resolution.
 */
type Step = 'tick 1' | 'tick 2' | 'untick 1' | 'saved' | Completion;

/** The journeys a scenario's steps name by number. */
const NUMBERED: Readonly<Record<string, string>> = {
  '1': TITLES[0],
  '2': TITLES[1],
};

/**
 * Stored before every scenario, so the page and the store each have a tick
 * no step touches, and a scenario that takes a tick back still ends with
 * something that must be shown.
 */
const ALREADY_STORED = TITLES[4];

/** Each order a write's two completions can reach the page in. */
const COMPLETION_ORDERS = [
  {
    first: 'confirm',
    second: 'resolve',
    eachWrite: 'is confirmed, then resolves',
    bothLines: 'are both confirmed before either resolves',
  },
  {
    first: 'resolve',
    second: 'confirm',
    eachWrite: 'resolves, then is confirmed',
    bothLines: 'both resolve before either is confirmed',
  },
] as const;

/** What a person does after the first tick: another tick, or taking it back. */
const SECOND_EDITS = [
  {
    step: 'tick 2',
    what: 'a tick on a second journey',
    left: [TITLES[0], TITLES[1]],
  },
  { step: 'untick 1', what: 'the first tick taken back', left: [] },
] as const;

const NOUN = { confirm: 'confirmation', resolve: 'resolution' } as const;

/**
 * Every place a second edit can land against a first write the store has
 * not finished: inside that write's window before either completion,
 * between its two completions, or saved while it is still in flight, the
 * completions then arriving write by write or line by line. Derived from
 * the completion orders and the edits, so an order or an edit added above
 * is played out in every position.
 */
const SLOW_STORE_SCENARIOS = COMPLETION_ORDERS.flatMap((order) =>
  SECOND_EDITS.flatMap((edit) => {
    const { first, second } = order;
    const scenario = (when: string, steps: readonly Step[]) => ({
      name: `${edit.what}, ${when}`,
      steps,
      left: edit.left,
    });
    return [
      scenario(
        `made while the first write is in flight, which ${order.eachWrite} before the next save`,
        ['tick 1', 'saved', edit.step, first, second, 'saved', first, second],
      ),
      scenario(
        `made between the first write's ${NOUN[first]} and its ${NOUN[second]}`,
        ['tick 1', 'saved', first, edit.step, second, 'saved', first, second],
      ),
      scenario(
        `saved while the first write is in flight; each write ${order.eachWrite}`,
        ['tick 1', 'saved', edit.step, 'saved', first, second, first, second],
      ),
      scenario(
        `saved while the first write is in flight; the writes ${order.bothLines}`,
        ['tick 1', 'saved', edit.step, 'saved', first, first, second, second],
      ),
    ];
  }),
);

/** What the page showed, and the store held, straight after one step. */
interface Observed {
  step: Step;
  /** Journey ids the page shows ticked. */
  shown: string[];
  /** Journey ids the store holds as ticked. */
  stored: string[];
  status: string;
}

/**
 * Plays a scenario out inside ONE page task and reads the page back after
 * every step. A timer turn follows each step, and timers fall due in
 * deadline order: a turn queued straight after a tick is due before that
 * tick's 400 ms save, so no release can slip past the save it is meant to
 * precede, however loaded the machine. `saved` is the one step that waits:
 * for the page's own save, then one turn for the write's echo.
 */
const playOut = (page: Page, steps: readonly Step[]) =>
  page.evaluate(
    async ({ all, numbered, doc }) => {
      const standIn = (window as StandInWindow).__dbStandIn;
      const turn = (ms = 0) =>
        new Promise<void>((resolve) => setTimeout(resolve, ms));
      const observed: Observed[] = [];
      let saves = 0;
      for (const step of all) {
        if (step === 'saved') {
          saves += 1;
          const deadline = Date.now() + 5000;
          while (standIn.writes() < saves) {
            if (Date.now() > deadline)
              throw new Error(
                `the page made ${standIn.writes()} writes; "saved" waited for write ${saves}`,
              );
            await turn(10);
          }
        } else if (step === 'confirm' || step === 'resolve') {
          standIn.release(step);
        } else {
          const [kind, number = ''] = step.split(' ');
          const title = numbered[number] ?? '';
          const section = Array.from(
            document.querySelectorAll('section.journey'),
          ).find(
            (candidate) => candidate.querySelector('h3')?.textContent === title,
          );
          const box = section?.querySelector('input[type="checkbox"]');
          const label = section?.querySelector('label');
          if (!(box instanceof HTMLInputElement) || !label)
            throw new Error(`no tick found for "${title}"`);
          if (box.checked === (kind === 'tick'))
            throw new Error(
              `"${step}" found "${title}" ${box.checked ? 'ticked' : 'unticked'} already`,
            );
          label.click();
        }
        await turn();
        const journeys = (standIn.read(doc)?.journeys ?? {}) as Record<
          string,
          unknown
        >;
        observed.push({
          step,
          shown: Array.from(
            document.querySelectorAll<HTMLInputElement>('input[data-journey]'),
          )
            .filter((box) => box.checked)
            .map((box) => box.dataset['journey'] ?? '')
            .sort(),
          stored: Object.keys(journeys)
            .filter((id) => journeys[id] === true)
            .sort(),
          status: document.getElementById('state')?.textContent ?? '',
        });
      }
      return observed;
    },
    { all: steps, numbered: NUMBERED, doc: DOC },
  );

test.describe('evidence page sign-off ticks, when the store is slower than the save window', () => {
  // The two orders above complete a write 60 ms after it is made, so a test
  // that waits for each write before its next tick never has two writes in
  // flight and never ticks between a write's two completions. A phone on a
  // slow connection does both (#260). Under `as-released` nothing completes
  // until the test releases it, so every ordering here is forced, not hoped
  // for.
  test('the stand-in completes no held write by itself, and releases each completion oldest first', async ({
    page,
  }, testInfo) => {
    await openEvidencePage(page, testInfo, { order: 'as-released' });
    const trace = await page.evaluate(async () => {
      const { claude, __dbStandIn: standIn } = window as StandInWindow;
      const db = await claude.use('db');
      if (!db) return ['use resolved null'];
      const path = 'stand-in/held';
      const ref = db.doc(path);
      const seen: string[] = [];
      const turn = (ms = 0) =>
        new Promise<void>((resolve) => setTimeout(resolve, ms));
      const stored = () =>
        seen.push(
          `stored ${JSON.stringify(standIn.read(path)?.['n'] ?? null)}`,
        );
      ref.onSnapshot((snap) => {
        seen.push(
          `snapshot ${JSON.stringify(snap.data()?.['n'] ?? null)}, pending ${snap.metadata.hasPendingWrites}`,
        );
      });
      await turn();
      for (const n of [1, 2]) {
        void ref.set({ n }).then(() => seen.push(`write ${n} resolved`));
        await turn();
      }
      // Five times what an automatic order takes to complete a write.
      await turn(300);
      stored();
      for (const completion of [
        'confirm',
        'resolve',
        'resolve',
        'confirm',
      ] as const) {
        seen.push(
          `release ${completion}: write ${standIn.release(completion)}`,
        );
        await turn();
        stored();
      }
      try {
        standIn.release('confirm');
        seen.push('a release with nothing held was allowed');
      } catch (refusal) {
        seen.push(String(refusal));
      }
      return seen;
    });
    expect(trace).toEqual([
      'snapshot null, pending false',
      'snapshot 1, pending true',
      'snapshot 2, pending true',
      'stored null',
      // Write 1 is stored; the view still carries write 2 over it, pending.
      'snapshot 2, pending true',
      'release confirm: write 1',
      'stored 1',
      'release resolve: write 1',
      'write 1 resolved',
      'stored 1',
      // The store takes write 2 at its first completion, here its resolution.
      'release resolve: write 2',
      'write 2 resolved',
      'stored 2',
      'snapshot 2, pending false',
      'release confirm: write 2',
      'stored 2',
      'Error: no write is waiting to confirm',
    ]);
  });

  for (const { name, steps, left } of SLOW_STORE_SCENARIOS) {
    test(name, async ({ page }, testInfo) => {
      await openEvidencePage(page, testInfo, {
        order: 'as-released',
        seed: signedOff([ALREADY_STORED]),
      });
      const observed = await playOut(page, steps);
      const intended = new Set<string>([ALREADY_STORED]);
      for (const seen of observed) {
        const [kind, number = ''] = seen.step.split(' ');
        const title = NUMBERED[number];
        if (title && kind === 'tick') intended.add(title);
        if (title && kind === 'untick') intended.delete(title);
        expect(
          seen.shown,
          `after "${seen.step}", the page shows exactly what the person ticked`,
        ).toEqual(idsOf([...intended]));
        if (/^Saved\b/.test(seen.status))
          expect(
            seen.stored,
            `after "${seen.step}", the status reads "${seen.status}", so the store holds what the page shows`,
          ).toEqual(seen.shown);
      }
      const last = observed.at(-1);
      expect(
        last?.status,
        'the page says Saved once every write has completed',
      ).toMatch(/^Saved\b/);
      expect(
        last?.stored,
        'the store keeps exactly what the person left ticked',
      ).toEqual(idsOf([ALREADY_STORED, ...left]));
      expect(
        await counters(page),
        'the page made one write per save, and every one was released',
      ).toMatchObject({
        writes: steps.filter((step) => step === 'saved').length,
        inflight: 0,
      });
    });
  }
});

test.describe('evidence page sign-off, whatever the write order', () => {
  test('each tick is named for the journey it marks', async ({
    page,
  }, testInfo) => {
    await openEvidencePage(page, testInfo, { order: 'resolve-then-confirm' });
    for (const title of TITLES)
      await expect(tickBox(page, title)).toHaveAccessibleName(
        `Reviewed: ${title}`,
      );
  });

  test('the progress line counts each journey once, and each carries its capture', async ({
    page,
  }, testInfo) => {
    await openEvidencePage(page, testInfo, { order: 'resolve-then-confirm' });
    await expect(page.locator('#progress')).toHaveText(
      `0 of ${TITLES.length} journeys reviewed`,
    );
    for (const title of TITLES)
      await expect(
        journeySection(page, title).locator('img'),
        `"${title}" shows the capture its manifest row names`,
      ).toHaveCount(1);
    await shoot(page, 'five journeys, each counted once', signOff(page));
  });

  test('the save status is exposed to assistive technology as a status message', async ({
    page,
  }, testInfo) => {
    await openEvidencePage(page, testInfo, { order: 'resolve-then-confirm' });
    // Asked of the save status itself, not of "the page's one status region":
    // the out-of-date notice (#197) is a second, and a proxy would break on it
    // while this property held.
    const status = page.locator('#state');
    await expect(status).toHaveRole('status');
    await expect(status).toHaveText(/^Ready\b/);
    await shoot(page, 'the save status is a status message', status);
  });

  test('the status says so when live updates stop', async ({
    page,
  }, testInfo) => {
    await openEvidencePage(page, testInfo, {
      order: 'resolve-then-confirm',
      subscriptionDies: true,
    });
    await expect(
      page.locator('#state'),
      'the status names the subscription that ended',
    ).toHaveText(/^Live updates stopped\b.*\bunavailable\b/);
  });

  test('a view without storage says its ticks are local and never reports one saved', async ({
    page,
  }) => {
    // Opened outside claude.ai, the page finds no `window.claude` at all.
    await serveEvidencePage(page);
    await page.goto(`${ORIGIN}/`);
    await expect(page.locator('#state')).toHaveText(
      /^Ticks are local to this view\b/,
    );
    await toggle(page, TITLES[0]);
    await expect(
      tickBox(page, TITLES[0]),
      'the tick is shown although it cannot be stored',
    ).toBeChecked();
    await expect(
      page.locator('#state'),
      'the tick is reported unsaved',
    ).toHaveText(/^Not saved\b.*\bcannot reach storage\b/);
  });

  test('a tick made while the stored sign-off cannot load is never written over it', async ({
    page,
  }, testInfo) => {
    // set() replaces the whole document, so a write made before the stored
    // sign-off has loaded would erase every tick already in it. The page's
    // clock lets the save window pass without a real wait.
    await page.clock.install();
    const seed = signedOff(TITLES.slice(0, 2));
    await openEvidencePage(page, testInfo, {
      order: 'resolve-then-confirm',
      seed,
      getFails: true,
      subscriptionDies: true,
    });
    // Both failures land before the status is read.
    await page.clock.runFor(1_000);
    await expect(
      page.locator('#state'),
      'the failed load is reported',
    ).toHaveText(/^Could not load the saved sign-off\b.*\bunavailable\b/);
    await toggle(page, TITLES[2]);
    await expect(
      tickBox(page, TITLES[2]),
      'the tick is shown although nothing has loaded',
    ).toBeChecked();
    await expect(
      page.locator('#state'),
      'the tick is reported not yet saved',
    ).toHaveText(/^Not saved yet\b/);
    await page.clock.runFor(2_000);
    const after = await page.evaluate((doc) => {
      const standIn = (window as StandInWindow).__dbStandIn;
      return { writes: standIn.writes(), stored: standIn.read(doc) };
    }, DOC);
    expect(after, 'nothing was written over the stored sign-off').toEqual({
      writes: 0,
      stored: seed[DOC],
    });
  });

  test('a malformed stored sign-off is shown, and written back, only in the shape the page writes', async ({
    page,
  }, testInfo) => {
    // The store is shared by every viewer, so whatever it delivers is untrusted.
    const [first, second, third, fourth] = TITLES;
    await openEvidencePage(page, testInfo, {
      order: 'resolve-then-confirm',
      seed: {
        [DOC]: {
          journeys: {
            [idOf(first)]: 'yes',
            [idOf(second)]: true,
            [idOf(third)]: 1,
          },
          verdict: 'hacked',
          verdictCovers: [idOf(first), 7],
          note: 42,
          updatedAt: '2026-09-14T15:09:00.000Z',
        },
      },
    });
    await expect(
      tickBox(page, second),
      'a stored true is shown ticked',
    ).toBeChecked();
    for (const title of [first, third])
      await expect(
        tickBox(page, title),
        `"${title}" holds no boolean and is shown unticked`,
      ).not.toBeChecked();
    await expect(
      page.locator('#note'),
      'a note that is not text is not shown',
    ).toHaveValue('');
    await toggleAndWait(page, fourth);
    const stored = await page.evaluate(
      (doc) => (window as StandInWindow).__dbStandIn.read(doc),
      DOC,
    );
    expect(
      {
        journeys: stored?.journeys,
        verdict: stored?.verdict,
        verdictCovers: stored?.verdictCovers,
        note: stored?.note,
      },
      'only the shape the page writes is stored',
    ).toEqual({
      journeys: { [idOf(second)]: true, [idOf(fourth)]: true },
      verdict: null,
      verdictCovers: null,
      note: '',
    });
    await shoot(page, 'written back only in its own shape', signOff(page));
  });

  test('a read that fails after live updates have loaded the sign-off changes nothing', async ({
    page,
  }, testInfo) => {
    // A transient `unavailable` rejects a read while the subscription carries
    // on (db.d.ts), so the sign-off can load first and the read fail after.
    await page.clock.install();
    await openEvidencePage(page, testInfo, {
      order: 'resolve-then-confirm',
      seed: signedOff(TITLES.slice(0, 1)),
      getFails: true,
    });
    // The late failure lands before anything is read.
    await page.clock.runFor(1_000);
    await expect(
      tickBox(page, TITLES[0]),
      'the stored tick arrived through live updates',
    ).toBeChecked();
    await expect(
      page.locator('#state'),
      'the late failure does not undo a load that succeeded',
    ).toHaveText(/^Ready\b/);
  });
});

/** The fixture page rebuilt with one journey more, as #188's gained its 13th. */
const ADDED = 'the sixth journey';
const HTML_WITH_ADDED: string = pageOf([...TITLES, ADDED]);
const ADDED_ID =
  journeysOf(HTML_WITH_ADDED).find(({ title }) => title === ADDED)?.id ?? '';

/** A journey the page no longer shows, as a stored verdict would name it. */
const DROPPED = 'a-journey-since-dropped';

/** Every journey id on a rendered page, sorted: the set a verdict covers. */
const coveredBy = (html: string): string[] =>
  journeysOf(html)
    .map(({ id }) => id)
    .sort();

/** The sign-off section: progress, the notice, the verdict buttons and the note. */
const signOff = (page: Page) => page.locator('#signoff');

const approveButton = (page: Page) =>
  page.getByRole('button', { name: /^Signed off\b/ });
const moreButton = (page: Page) =>
  page.getByRole('button', { name: 'More tests needed', exact: true });

/** The out-of-date notice, found as assistive technology meets it: a status message. */
const outOfDate = (page: Page) =>
  page.getByRole('status').filter({ hasText: /\bis out of date\./ });

/** The verdict the store holds, and the journeys it records the verdict as covering. */
const storedVerdict = (page: Page) =>
  page.evaluate((doc) => {
    const body = (window as StandInWindow).__dbStandIn.read(doc);
    const covers = body?.verdictCovers;
    return {
      verdict: body?.verdict ?? null,
      covers: Array.isArray(covers) ? [...covers].sort() : (covers ?? null),
    };
  }, DOC);

/** A verdict given on these journeys, as an earlier visit left it. */
const verdictOn = (
  verdict: 'approved' | 'more',
  covers: readonly string[],
): Record<string, StoredBody> => ({
  [DOC]: {
    journeys: {},
    verdict,
    verdictCovers: [...covers],
    note: '',
    updatedAt: '2026-09-23T00:00:00.000Z',
  },
});

/** The verdict shows as given, and the notice region is there and says nothing. */
async function expectCurrent(page: Page, button: Locator): Promise<void> {
  await expect(button, 'the verdict is shown as given').toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const region = page.locator('#standing');
  await expect(region, 'the notice region is on the page').toHaveCount(1);
  await expect(region).toHaveRole('status');
  await expect(region, 'and it says nothing').toHaveText('');
}

test.describe('a verdict covers the journeys it was given on (#197)', () => {
  test('approved, then rebuilt with a journey added: the approval is out of date and names it, and one press approves again', async ({
    page,
  }, testInfo) => {
    await openEvidencePage(page, testInfo, { order: 'resolve-then-confirm' });
    await writtenAfter(page, () => approveButton(page).click(), 'the approval');
    await expect(approveButton(page)).toHaveAttribute('aria-pressed', 'true');
    expect(
      await storedVerdict(page),
      'the approval records the journeys it was given on',
    ).toEqual({ verdict: 'approved', covers: coveredBy(HTML) });
    await shoot(page, 'approved on five journeys', signOff(page));

    await republish(page, HTML_WITH_ADDED);
    const notice = outOfDate(page);
    await expect(
      notice,
      'the stale approval is a status message, so it is announced',
    ).toBeVisible();
    await expect(notice).toHaveId('standing');
    await expect(notice).toContainText(
      'Your sign-off is out of date. You signed off before this page changed.',
    );
    await expect(
      notice.getByRole('link', { name: ADDED, exact: true }),
      'the journey added since is named',
    ).toBeVisible();
    await expect(
      approveButton(page),
      'an out-of-date approval is not shown as given',
    ).toHaveAttribute('aria-pressed', 'false');
    expect(
      await storedVerdict(page),
      'opening the page changed nothing stored',
    ).toEqual({ verdict: 'approved', covers: coveredBy(HTML) });
    await shoot(
      page,
      'republished with a sixth journey: out of date, naming it',
      signOff(page),
    );

    await writtenAfter(
      page,
      () => approveButton(page).click(),
      'the approval given again',
    );
    await expectCurrent(page, approveButton(page));
    expect(
      await storedVerdict(page),
      'the approval now records every journey on the page',
    ).toEqual({ verdict: 'approved', covers: coveredBy(HTML_WITH_ADDED) });
    await shoot(page, 'one press: approved on all six', signOff(page));
  });

  test('an unchanged rebuild keeps the approval', async ({
    page,
  }, testInfo) => {
    await openEvidencePage(page, testInfo, { order: 'resolve-then-confirm' });
    await writtenAfter(page, () => approveButton(page).click(), 'the approval');
    await republish(page, pageOf(TITLES));
    await expectCurrent(page, approveButton(page));
    expect(await storedVerdict(page)).toEqual({
      verdict: 'approved',
      covers: coveredBy(HTML),
    });
    await shoot(page, 'rebuilt unchanged: still approved', signOff(page));
  });

  test('a journey removed since puts the approval out of date, and is named', async ({
    page,
  }, testInfo) => {
    await openEvidencePage(page, testInfo, {
      order: 'resolve-then-confirm',
      seed: verdictOn('approved', [...coveredBy(HTML), DROPPED]),
    });
    const notice = outOfDate(page);
    await expect(notice).toContainText(`No longer on the page: ${DROPPED}.`);
    await expect(notice, 'nothing was added').not.toContainText('Added since');
    await expect(approveButton(page)).toHaveAttribute('aria-pressed', 'false');
    await shoot(page, 'a removed journey is named', signOff(page));
  });

  test('a removed id the store holds is shown as text, never read as markup', async ({
    page,
  }, testInfo) => {
    // Every viewer writes the store, so a removed id is untrusted input on a
    // page the operator signs off from.
    const markup = '<img src="x" alt="injected">';
    await openEvidencePage(page, testInfo, {
      order: 'resolve-then-confirm',
      seed: verdictOn('approved', [...coveredBy(HTML), markup]),
    });
    const notice = outOfDate(page);
    await expect(notice.locator('code')).toHaveText(markup);
    await expect(
      notice.locator('img'),
      'nothing in the notice was parsed from the store',
    ).toHaveCount(0);
    await shoot(page, 'stored markup shown as text', notice);
  });

  test('a sign-off saved before verdicts recorded their journeys is out of date, never approved', async ({
    page,
  }, testInfo) => {
    await openEvidencePage(page, testInfo, {
      order: 'resolve-then-confirm',
      seed: {
        [DOC]: {
          journeys: Object.fromEntries(JOURNEYS.map(({ id }) => [id, true])),
          verdict: 'approved',
          note: '',
          updatedAt: '2026-09-17T23:58:26.000Z',
        },
      },
    });
    const notice = outOfDate(page);
    await expect(notice).toContainText(
      'Your sign-off is out of date. It was saved before sign-offs recorded ' +
        `the journeys they cover, so it cannot be matched to the ${TITLES.length} ` +
        'journeys on this page.',
    );
    await expect(approveButton(page)).toHaveAttribute('aria-pressed', 'false');
    await shoot(
      page,
      'a sign-off from before #197: out of date',
      signOff(page),
    );
  });

  test('a request for more tests goes out of date the same way', async ({
    page,
  }, testInfo) => {
    await openEvidencePage(page, testInfo, {
      order: 'resolve-then-confirm',
      html: HTML_WITH_ADDED,
      seed: verdictOn('more', coveredBy(HTML)),
    });
    const notice = outOfDate(page);
    await expect(notice).toContainText(
      'Your decision is out of date. You asked for more tests before this page changed.',
    );
    await expect(
      notice.getByRole('link', { name: ADDED, exact: true }),
    ).toBeVisible();
    await expect(moreButton(page)).toHaveAttribute('aria-pressed', 'false');
    await shoot(
      page,
      'more tests, asked before the change: out of date',
      signOff(page),
    );
  });

  test('a tick or a note on an out-of-date page leaves the approval out of date', async ({
    page,
  }, testInfo) => {
    await openEvidencePage(page, testInfo, {
      order: 'resolve-then-confirm',
      html: HTML_WITH_ADDED,
      seed: verdictOn('approved', coveredBy(HTML)),
    });
    await expect(outOfDate(page)).toBeVisible();
    await toggleAndWait(page, ADDED);
    await writtenAfter(
      page,
      () => page.locator('#note').fill('the sixth journey looks right'),
      'the note',
    );
    expect(await storedTicks(page), 'the tick was stored').toEqual([ADDED_ID]);
    expect(
      await storedVerdict(page),
      'neither the tick nor the note renewed the approval',
    ).toEqual({ verdict: 'approved', covers: coveredBy(HTML) });
    await expect(outOfDate(page)).toBeVisible();
    await expect(approveButton(page)).toHaveAttribute('aria-pressed', 'false');
    await shoot(page, 'ticked and noted: still out of date', signOff(page));
  });

  test('pressing a given verdict again withdraws it, and it then covers nothing', async ({
    page,
  }, testInfo) => {
    await openEvidencePage(page, testInfo, { order: 'resolve-then-confirm' });
    await writtenAfter(page, () => approveButton(page).click(), 'the approval');
    expect(await storedVerdict(page), 'given, it covers the page').toEqual({
      verdict: 'approved',
      covers: coveredBy(HTML),
    });
    await writtenAfter(
      page,
      () => approveButton(page).click(),
      'the approval withdrawn',
    );
    await expect(approveButton(page)).toHaveAttribute('aria-pressed', 'false');
    expect(await storedVerdict(page)).toEqual({ verdict: null, covers: null });
    await shoot(page, 'withdrawn: no verdict, nothing covered', signOff(page));
  });

  test("the notice's link takes focus, and Enter goes to the journey it names", async ({
    page,
  }, testInfo) => {
    await openEvidencePage(page, testInfo, {
      order: 'resolve-then-confirm',
      html: HTML_WITH_ADDED,
      seed: verdictOn('approved', coveredBy(HTML)),
    });
    const link = outOfDate(page).getByRole('link', {
      name: ADDED,
      exact: true,
    });
    await link.focus();
    await expect(link).toBeFocused();
    await shoot(page, 'the link to the added journey has focus', signOff(page));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${ORIGIN}/#j-${ADDED_ID}`);
    await shoot(
      page,
      'Enter went to the added journey',
      page.locator(`#j-${ADDED_ID}`),
    );
  });

  test("Shift+Tab from the verdict buttons reaches the notice's link (WCAG 2.1.1)", async ({
    page,
    browserName,
  }, testInfo) => {
    test.skip(
      browserName === 'webkit',
      'Safari omits plain links from the Tab sequence unless the visitor opts in, ' +
        'so a Tab walk here would assert a browser preference, not our markup. ' +
        'The link takes focus on every engine in the test above.',
    );
    await openEvidencePage(page, testInfo, {
      order: 'resolve-then-confirm',
      html: HTML_WITH_ADDED,
      seed: verdictOn('approved', coveredBy(HTML)),
    });
    const link = outOfDate(page).getByRole('link', {
      name: ADDED,
      exact: true,
    });
    await expect(link).toBeVisible();
    await approveButton(page).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(
      link,
      'the notice sits just before the verdict buttons in the Tab order',
    ).toBeFocused();
    await shoot(
      page,
      'Shift+Tab from the buttons reached the link',
      signOff(page),
    );
  });

  for (const scheme of ['light', 'dark'] as const)
    test(`the notice meets AA contrast in the ${scheme} theme`, async ({
      page,
    }, testInfo) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openEvidencePage(page, testInfo, {
        order: 'resolve-then-confirm',
        html: HTML_WITH_ADDED,
        seed: verdictOn('approved', [...coveredBy(HTML), DROPPED]),
      });
      const notice = outOfDate(page);
      await expect(notice).toBeVisible();
      expect(
        await page.evaluate(
          () => getComputedStyle(document.body).backgroundColor,
        ),
        `the page is in its ${scheme} theme`,
      ).toBe(scheme === 'dark' ? 'rgb(19, 21, 25)' : 'rgb(247, 246, 242)');
      const parts = {
        'lead sentence': notice.locator('strong'),
        'first paragraph': notice.locator('p').first(),
        'added journey link': notice.getByRole('link'),
        'removed journey id': notice.locator('code'),
      };
      for (const [part, locator] of Object.entries(parts)) {
        await expect(locator, `the notice has one ${part}`).toHaveCount(1);
        expect(
          await contrastRatio(locator),
          `the ${part} in the ${scheme} theme`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      await shoot(page, `the notice in the ${scheme} theme`, notice);
    });

  test('without storage, a verdict given in this view covers this view', async ({
    page,
  }) => {
    // Opened outside claude.ai, the page finds no `window.claude` at all.
    await serveEvidencePage(page, HTML_WITH_ADDED);
    await page.goto(`${ORIGIN}/`);
    await expect(page.locator('#state')).toHaveText(
      /^Ticks are local to this view\b/,
    );
    await toggle(page, ADDED);
    await expect(tickBox(page, ADDED)).toBeChecked();
    await approveButton(page).click();
    await expectCurrent(page, approveButton(page));
    await expect(
      page.locator('#state'),
      'the verdict is reported unsaved',
    ).toHaveText(/^Not saved\b/);
    await shoot(
      page,
      'no storage: given here, and said unsaved',
      signOff(page),
    );
  });

  test('an out-of-date verdict still reads out of date after live updates stop', async ({
    page,
  }, testInfo) => {
    await openEvidencePage(page, testInfo, {
      order: 'resolve-then-confirm',
      html: HTML_WITH_ADDED,
      seed: verdictOn('approved', coveredBy(HTML)),
      subscriptionDies: true,
    });
    await expect(page.locator('#state')).toHaveText(/^Live updates stopped\b/);
    await expect(outOfDate(page)).toBeVisible();
    await expect(approveButton(page)).toHaveAttribute('aria-pressed', 'false');
    await shoot(page, 'live updates stopped: still out of date', signOff(page));
  });
});

// A real phone keeps one Chrome profile from run to run, so its localStorage
// outlives every run (#229). One browser context stands in for that profile,
// and each page opened in it for one run of the same test.
test.describe('the stand-in store, on a phone that keeps one profile from run to run', () => {
  const openAsRun = async (page: Page, testInfo: TestInfo, run: string) => {
    const errors = recordErrors(page);
    await openEvidencePage(page, testInfo, {
      order: 'resolve-then-confirm',
      ...storeKeyOf(testInfo, run),
    });
    return errors;
  };

  test('a later run of a test starts from its seed, not from the store an earlier run left', async ({
    context,
  }, testInfo) => {
    const earlier = await context.newPage();
    const earlierErrors = await openAsRun(earlier, testInfo, 'an-earlier-run');
    await earlier.evaluate(async () => {
      const db = await (window as StandInWindow).claude.use('db');
      if (!db) throw new Error('use resolved null');
      const ref = db.doc('stand-in/self-test');
      await ref.set({ journeys: { a: true } });
      // Stored once the confirmed snapshot arrives, not when the write resolves.
      await new Promise<void>((resolve) =>
        ref.onSnapshot((snap) => {
          if (snap.exists && !snap.metadata.hasPendingWrites) resolve();
        }),
      );
    });

    const later = await context.newPage();
    const laterErrors = await openAsRun(later, testInfo, THIS_RUN);
    const found = await later.evaluate(async () => {
      const db = await (window as StandInWindow).claude.use('db');
      if (!db) throw new Error('use resolved null');
      return new Promise<string>((resolve) =>
        db
          .doc('stand-in/self-test')
          .onSnapshot((snap) => resolve(snap.exists ? 'exists' : 'absent')),
      );
    });

    expect(found, 'the later run started from the earlier run’s store').toBe(
      'absent',
    );
    await earlierErrors.expectNoUncaught('the earlier run threw');
    await laterErrors.expectNoUncaught('the later run threw');
  });

  test('opening a store removes what earlier runs of the same test left, and nothing else', async ({
    context,
  }, testInfo) => {
    // A key per run alone would leave one more store per test on the phone
    // after every run, never read again, until localStorage refuses writes.
    const page = await context.newPage();
    const errors = await openAsRun(page, testInfo, THIS_RUN);
    const { testId, repeatEachIndex, retry } = testInfo;
    const planted = {
      earlierRun: storeKeyOf(testInfo, 'an-earlier-run').storeKey,
      beforeRunsWereNamed: `evidence-db:${testId}:${repeatEachIndex}:${retry}`,
      anotherRepeat: `evidence-db:${testId}:${repeatEachIndex + 1}:0:another-run`,
      anotherTest: 'evidence-db:another-test:0:0:another-run',
    };
    const plant = (keys: string[]) =>
      page.evaluate((all) => {
        for (const key of all) localStorage.setItem(key, '{}');
      }, keys);
    const unplant = (keys: string[]) =>
      page.evaluate((all) => {
        for (const key of all) localStorage.removeItem(key);
      }, keys);

    await plant(Object.values(planted));
    try {
      await page.reload();
      const kept = await page.evaluate(
        (prefix) =>
          Object.keys(localStorage)
            .filter((key) => key.startsWith(prefix))
            .sort(),
        `evidence-db:${testId}:`,
      );
      expect(
        kept,
        'this test keeps its own store and another repeat’s',
      ).toEqual([storeKeyOf(testInfo).storeKey, planted.anotherRepeat].sort());
      expect(
        await page.evaluate(
          (key) => localStorage.getItem(key),
          planted.anotherTest,
        ),
        'another test’s store is untouched',
      ).toBe('{}');
    } finally {
      // The phone keeps whatever a run leaves: take back what was planted.
      await unplant(Object.values(planted));
    }
    await errors.expectNoUncaught('the page threw');
  });
});

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
