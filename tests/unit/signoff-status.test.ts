import { describe, expect, it } from 'vitest';
import { journeysOfPage } from '../../scripts/build-evidence-page.mjs';
import { signOffStatus } from '../../scripts/signoff-status.mjs';
import { IDS, PAGE, EMPTY_PAGE, stored } from '../signoff-status-shared';

describe('the published page is read for the journeys it declares', () => {
  it('reads back exactly the journeys a rendered page shows, in page order', () => {
    expect(journeysOfPage(PAGE)).toEqual(IDS);
  });

  it('refuses a page that declares no journey list, rather than reading it as empty', () => {
    expect(() => journeysOfPage('<title>not an evidence page</title>')).toThrow(
      /declares 0 journey lists/,
    );
  });

  it('refuses a page whose journey list is empty, so an approval of nothing cannot cover it', () => {
    expect(EMPTY_PAGE, 'the fixture list was emptied').toContain(
      'var JOURNEYS = [];',
    );
    expect(() => journeysOfPage(EMPTY_PAGE)).toThrow(/declares no journeys/);
  });

  it('refuses a page that declares two, rather than choosing one', () => {
    expect(() => journeysOfPage(PAGE + PAGE)).toThrow(
      /declares 2 journey lists/,
    );
  });
});

describe('only an approval of exactly the published journeys may merge', () => {
  it('an approval covering every journey on the page may merge', () => {
    expect(signOffStatus(PAGE, stored('approved', IDS))).toEqual({
      merge: true,
      says: 'SIGNED OFF: the approval covers all 3 journeys on the published page',
    });
  });

  it('an approval given before a journey was added may not, and names the journey', () => {
    expect(signOffStatus(PAGE, stored('approved', IDS.slice(0, 2)))).toEqual({
      merge: false,
      says: 'OUT OF DATE: approved before the page changed; added since: the-third-journey',
    });
  });

  it('an approval of a journey the page no longer shows may not, and names it', () => {
    expect(
      signOffStatus(PAGE, stored('approved', [...IDS, 'a-dropped-journey'])),
    ).toEqual({
      merge: false,
      says: 'OUT OF DATE: approved before the page changed; no longer on the page: a-dropped-journey',
    });
  });

  it('names both, when journeys were added and removed', () => {
    expect(
      signOffStatus(PAGE, stored('approved', ['the-first-journey', 'gone'])),
    ).toEqual({
      merge: false,
      says:
        'OUT OF DATE: approved before the page changed; added since: ' +
        'the-second-journey, the-third-journey; no longer on the page: gone',
    });
  });

  it('quotes an id that is not a journey slug, so the store cannot write to the terminal', () => {
    // Every viewer writes the store. ESC is built here, never typed: a typed
    // escape arrives as the character itself.
    const escape = String.fromCharCode(27);
    const hostile = `${escape}[2J`;
    const { says } = signOffStatus(PAGE, stored('approved', [...IDS, hostile]));
    expect(says).not.toContain(escape);
    expect(says).toBe(
      'OUT OF DATE: approved before the page changed; no longer on the page: ' +
        JSON.stringify(hostile),
    );
  });

  it('an approval saved without the journeys it covers may not merge', () => {
    // As #161's was: approved, and stored before a verdict recorded its journeys.
    expect(signOffStatus(PAGE, stored('approved'))).toEqual({
      merge: false,
      says:
        'OUT OF DATE: approved without recording the journeys it covers, so ' +
        'it cannot be matched to the 3 journeys on the published page',
    });
  });

  it('a request for more tests may not merge, and carries its note', () => {
    expect(
      signOffStatus(PAGE, stored('more', IDS, 'cover the phone too')),
    ).toEqual({
      merge: false,
      says: 'MORE TESTS NEEDED: "cover the phone too"',
    });
    expect(signOffStatus(PAGE, stored('more', IDS))).toEqual({
      merge: false,
      says: 'MORE TESTS NEEDED, with no note',
    });
  });

  it('a request for more tests made before the page changed is out of date', () => {
    expect(signOffStatus(PAGE, stored('more', IDS.slice(0, 2)))).toEqual({
      merge: false,
      says: 'OUT OF DATE: more tests were asked for before the page changed; added since: the-third-journey',
    });
  });

  it('no verdict, or no document at all, may not merge', () => {
    for (const body of [stored(null, IDS), null, undefined]) {
      expect(signOffStatus(PAGE, body), String(body)).toEqual({
        merge: false,
        says: 'NO VERDICT: nothing has been decided on the page',
      });
    }
  });

  it('gives the same answer whatever updatedAt says', () => {
    for (const covers of [IDS, IDS.slice(0, 2)]) {
      const answers = [
        undefined,
        '1970-01-01T00:00:00.000Z',
        '2099-01-01T00:00:00.000Z',
      ].map((updatedAt) =>
        JSON.stringify(
          signOffStatus(PAGE, { ...stored('approved', covers), updatedAt }),
        ),
      );
      expect(new Set(answers).size, answers.join('\n')).toBe(1);
    }
  });
});
