/**
 * The sign-off an evidence page stores, and where its verdict stands (#197).
 *
 * #188's page was approved with 12 journeys ticked, then republished with a
 * 13th, and went on reading "approved" beside a journey nobody had reviewed:
 * the stored verdict said nothing about what it had been given against. A
 * verdict is now stored with the ids of the journeys on the page at the moment
 * it was given (`verdictCovers`), and it stands only while the page shows
 * exactly those journeys.
 *
 * Both functions reach the page by their own source text: the builder embeds
 * `Function.prototype.toString()` of each into the page script, the unit tests
 * import them, and `signoff-status.mjs` runs them before a merge. One
 * implementation, three callers. That is why each is written self-contained
 * and in the ES5 the page script is written in: nothing from this module's
 * scope survives the embedding, and syntax a test loader rewrites with a
 * helper would leave the page calling a helper it does not have.
 */

/** @typedef {'approved' | 'more'} Verdict */

/**
 * @typedef {object} SignOff
 * @property {Record<string, boolean>} journeys the ticks, by journey id
 * @property {Verdict | null} verdict
 * @property {string[] | null} verdictCovers the journeys the verdict was given
 *   against, or null when none was recorded
 * @property {string} note
 */

/**
 * @typedef {object} Standing
 * @property {Verdict | null} verdict the verdict given, current or not
 * @property {boolean} stale the page no longer shows exactly what it covers
 * @property {boolean} unrecorded it was saved without the journeys it covers
 * @property {string[]} added journeys on the page the verdict never covered
 * @property {string[]} removed journeys it covered that the page no longer has
 */

/**
 * The sign-off in the shape the page writes, from a document the shared store
 * delivered. Every viewer writes that store, so the document is untrusted
 * input; and the runtime delivers it frozen (#172), so the result shares no
 * object with it.
 *
 * @param {unknown} body
 * @returns {SignOff}
 */
export function signOffOf(body) {
  var source = /** @type {Record<string, unknown>} */ (
    body && typeof body === 'object' ? body : {}
  );
  var ticks = /** @type {Record<string, unknown>} */ (
    source.journeys && typeof source.journeys === 'object'
      ? source.journeys
      : {}
  );
  /** @type {Record<string, boolean>} */
  var journeys = {};
  Object.keys(ticks).forEach(function (id) {
    var tick = ticks[id];
    if (typeof tick === 'boolean') journeys[id] = tick;
  });
  var covers = source.verdictCovers;
  var verdict = source.verdict;
  return {
    journeys: journeys,
    verdict: verdict === 'approved' || verdict === 'more' ? verdict : null,
    // A list with anything but ids in it is refused whole, never filtered:
    // what survives a filter could match the page and read as approved.
    verdictCovers:
      Array.isArray(covers) &&
      covers.every(function (id) {
        return typeof id === 'string';
      })
        ? covers.slice()
        : null,
    note: typeof source.note === 'string' ? source.note : '',
  };
}

/**
 * Where a sign-off's verdict stands against the journeys a page shows.
 *
 * @param {SignOff} signOff as `signOffOf` returns it
 * @param {readonly string[]} journeys the ids the page renders, in page order
 * @returns {Standing}
 */
export function standingOf(signOff, journeys) {
  /**
   * The ids in `these` that `those` lacks, each once, in the order of `these`.
   *
   * @param {readonly string[]} these
   * @param {readonly string[]} those
   */
  function lacking(these, those) {
    return these.filter(function (id, at) {
      return those.indexOf(id) < 0 && these.indexOf(id) === at;
    });
  }
  var verdict = signOff.verdict;
  var covers = signOff.verdictCovers;
  if (verdict === null) {
    return {
      verdict: null,
      stale: false,
      unrecorded: false,
      added: [],
      removed: [],
    };
  }
  // Saved before a verdict recorded what it covered: there is nothing to
  // compare, so it can never be shown as current.
  if (covers === null) {
    return {
      verdict: verdict,
      stale: true,
      unrecorded: true,
      added: [],
      removed: [],
    };
  }
  var added = lacking(journeys, covers);
  var removed = lacking(covers, journeys);
  return {
    verdict: verdict,
    stale: added.length > 0 || removed.length > 0,
    unrecorded: false,
    added: added,
    removed: removed,
  };
}
