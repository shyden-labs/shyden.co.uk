import { evidencePageOf } from './evidence-fixture';

export const TITLES = [
  'the first journey',
  'the second journey',
  'the third journey',
];

export const IDS = [
  'the-first-journey',
  'the-second-journey',
  'the-third-journey',
];

export const PAGE = evidencePageOf(TITLES, 'ticket-197-check');

/**
 * The same page with its journey list emptied. The builder refuses a run that
 * captured nothing, so no evidence page it writes looks like this.
 */
export const EMPTY_PAGE = PAGE.replace(
  /\bvar JOURNEYS = \[[^\]\n]*\];/,
  'var JOURNEYS = [];',
);

/** A sign-off document as `ArtifactData get` saves it: its fields, nothing around them. */
export const stored = (
  verdict: 'approved' | 'more' | null,
  covers?: readonly string[],
  note = '',
) => ({
  journeys: {},
  note,
  updatedAt: '2026-09-23T12:34:52.437Z',
  verdict,
  ...(covers ? { verdictCovers: [...covers] } : {}),
});
