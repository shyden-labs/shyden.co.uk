import { runInNewContext } from 'node:vm';
import { describe, it, expect } from 'vitest';
import { signOffOf, standingOf } from '../../scripts/evidence-signoff.mjs';
import { evidencePageOf } from '../evidence-fixture';

/**
 * Where an evidence page's stored verdict stands against the journeys the
 * page shows (#197), asserted through the functions the page itself runs.
 *
 * #188's page was approved with 12 journeys, republished with a 13th, and
 * still read "approved": nothing stored said what the approval had covered.
 */

/** A stored sign-off as the page writes it: this verdict, given on these ids. */
const given = (verdict: 'approved' | 'more', covers: string[]) =>
  signOffOf({ journeys: {}, verdict, verdictCovers: covers, note: '' });

/** What the page shows for a verdict that still covers exactly the page. */
const current = (verdict: 'approved' | 'more') => ({
  verdict,
  stale: false,
  unrecorded: false,
  added: [],
  removed: [],
});

/**
 * A copy frozen all the way down, as the runtime delivers stored documents
 * (#172). JSON.parse hands its reviver each value after that value's
 * children, so freezing there freezes the whole body with no walker of our
 * own, as `db-stand-in.ts` does (one-home.test.ts).
 */
const frozen = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value), (_key, part: unknown) =>
    part && typeof part === 'object' ? Object.freeze(part) : part,
  ) as T;

describe('a verdict stands only against the journeys it was given on (#197)', () => {
  it('an approval given on A, on a page showing A, is current', () => {
    expect(standingOf(given('approved', ['a']), ['a'])).toEqual(
      current('approved'),
    );
  });

  it('the same approval on a page showing A and B is stale, and names B', () => {
    expect(standingOf(given('approved', ['a']), ['a', 'b'])).toEqual({
      verdict: 'approved',
      stale: true,
      unrecorded: false,
      added: ['b'],
      removed: [],
    });
  });

  it('an approval given on A and C, on a page without C, is stale and names C', () => {
    expect(standingOf(given('approved', ['a', 'c']), ['a'])).toEqual({
      verdict: 'approved',
      stale: true,
      unrecorded: false,
      added: [],
      removed: ['c'],
    });
  });

  it('names what was added in page order, and what was removed once each', () => {
    const standing = standingOf(given('approved', ['a', 'x', 'x', 'y']), [
      'c',
      'a',
      'b',
    ]);
    expect(standing.added).toEqual(['c', 'b']);
    expect(standing.removed).toEqual(['x', 'y']);
  });

  it('reads the journeys as a set: the same ids in another order are no change', () => {
    expect(standingOf(given('approved', ['b', 'a']), ['a', 'b'])).toEqual(
      current('approved'),
    );
  });

  it('a request for more tests goes out of date the same way', () => {
    expect(standingOf(given('more', ['a']), ['a'])).toEqual(current('more'));
    expect(standingOf(given('more', ['a']), ['a', 'b'])).toEqual({
      verdict: 'more',
      stale: true,
      unrecorded: false,
      added: ['b'],
      removed: [],
    });
  });

  it('with no verdict given, nothing is stale and nothing is named', () => {
    const none = signOffOf({ journeys: { a: true }, note: '' });
    expect(standingOf(none, ['a', 'b'])).toEqual({
      verdict: null,
      stale: false,
      unrecorded: false,
      added: [],
      removed: [],
    });
  });

  it('a later write does not make an old verdict current: updatedAt plays no part', () => {
    const touched = signOffOf({
      journeys: { a: true, b: true },
      verdict: 'approved',
      verdictCovers: ['a'],
      note: '',
      updatedAt: '2099-01-01T00:00:00.000Z',
    });
    expect(standingOf(touched, ['a', 'b']).stale).toBe(true);
  });
});

describe('a sign-off saved without the journeys it covers is never current (#197 AC4)', () => {
  it('a document from before #197 is stale on every page, and never approved', () => {
    const legacy = signOffOf({
      journeys: { a: true },
      verdict: 'approved',
      note: '',
      updatedAt: '2026-09-17T23:58:26.000Z',
    });
    for (const page of [['a'], ['a', 'b'], []]) {
      expect(standingOf(legacy, page), `on a page showing ${page}`).toEqual({
        verdict: 'approved',
        stale: true,
        unrecorded: true,
        added: [],
        removed: [],
      });
    }
  });

  it('a list that is not a list of ids counts as none recorded', () => {
    const malformed: unknown[] = ['a', { 0: 'a' }, ['a', 1], [null], null, 7];
    for (const covers of malformed) {
      const signOff = signOffOf({
        journeys: {},
        verdict: 'approved',
        verdictCovers: covers,
        note: '',
      });
      expect(signOff.verdictCovers, JSON.stringify(covers)).toBeNull();
      expect(standingOf(signOff, ['a']), JSON.stringify(covers)).toEqual({
        verdict: 'approved',
        stale: true,
        unrecorded: true,
        added: [],
        removed: [],
      });
    }
  });
});

describe('the stored sign-off is read in the shape the page writes', () => {
  it('keeps the ticks, the verdict, what it covers and the note, and nothing else', () => {
    expect(
      signOffOf({
        journeys: { a: true, b: false, c: 'yes' },
        verdict: 'approved',
        verdictCovers: ['a', 'b'],
        note: 'checked on a phone',
        updatedAt: '2026-09-23T00:00:00.000Z',
        extra: 1,
      }),
    ).toEqual({
      journeys: { a: true, b: false },
      verdict: 'approved',
      verdictCovers: ['a', 'b'],
      note: 'checked on a phone',
    });
  });

  it('reads anything that is not a document as an empty sign-off', () => {
    for (const body of [undefined, null, 'approved', 3]) {
      expect(signOffOf(body), String(body)).toEqual({
        journeys: {},
        verdict: null,
        verdictCovers: null,
        note: '',
      });
    }
  });

  it('drops a verdict the page never writes', () => {
    for (const verdict of ['yes', 'Approved', true, ['approved']]) {
      expect(
        signOffOf({ verdict, verdictCovers: ['a'] }).verdict,
        String(verdict),
      ).toBeNull();
    }
  });

  it('shares no object with a frozen delivery, so the page can edit what it keeps', () => {
    const delivered = frozen({
      journeys: { a: true },
      verdict: 'approved',
      verdictCovers: ['a'],
      note: '',
    });
    const kept = signOffOf(delivered);
    kept.journeys.b = true;
    kept.verdictCovers?.push('b');
    expect(delivered.journeys).toEqual({ a: true });
    expect(delivered.verdictCovers).toEqual(['a']);
  });
});

describe('the page runs these functions, not a copy of them', () => {
  it('embeds each function by its own source text', () => {
    const html = evidencePageOf(
      ['the first journey', 'the second journey'],
      'ticket-197-fixture',
    );
    for (const fn of [signOffOf, standingOf]) {
      expect(html, fn.name).toContain(fn.toString());
    }
  });

  it('each embedded function runs on its own, with nothing from its module in scope', () => {
    // A context holding only the language's own globals, as a page script
    // has: a reference to anything else in the module, or to a Node global,
    // fails here rather than in a browser.
    const standalone = runInNewContext(
      `(function () {\n${signOffOf.toString()}\n${standingOf.toString()}\n` +
        'return { signOffOf: signOffOf, standingOf: standingOf };\n})()',
      {},
    ) as { signOffOf: typeof signOffOf; standingOf: typeof standingOf };
    const signOff = standalone.signOffOf(
      frozen({ journeys: {}, verdict: 'approved', verdictCovers: ['a'] }),
    );
    expect(standalone.standingOf(signOff, ['a', 'b'])).toEqual({
      verdict: 'approved',
      stale: true,
      unrecorded: false,
      added: ['b'],
      removed: [],
    });
  });
});
