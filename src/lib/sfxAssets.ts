/**
 * The recordings the deal plays (#1339), as pure data: sample name to the
 * file committed at `src/assets/sfx/`. The names are the ones
 * `src/scripts/deal-audio.ts` asks for; `src/scripts/classroom-groups.ts`
 * imports each file through Vite (content-hashed at build time), so a
 * missing file fails the build. `tests/unit/sfxAssets.test.ts` matches this
 * manifest against the real directory listing in both directions.
 *
 * Provenance and licence: src/assets/sfx/CREDITS.md.
 */

export const SFX_MANIFEST: Readonly<Record<string, string>> = {
  'marimba-43': 'marimba-43.m4a',
  'marimba-47': 'marimba-47.m4a',
  'marimba-53': 'marimba-53.m4a',
  'marimba-60': 'marimba-60.m4a',
  'marimba-67': 'marimba-67.m4a',
  'harp-55': 'harp-55.m4a',
  'harp-62': 'harp-62.m4a',
  'harp-69': 'harp-69.m4a',
  'harp-76': 'harp-76.m4a',
  'glock-67': 'glock-67.m4a',
  'glock-72': 'glock-72.m4a',
  'glock-79': 'glock-79.m4a',
  'glock-84': 'glock-84.m4a',
  'glock-91': 'glock-91.m4a',
  'glock-96': 'glock-96.m4a',
  'timpani-hit': 'timpani-hit.m4a',
  'timpani-roll': 'timpani-roll.m4a',
  whoosh: 'whoosh.m4a',
  impact: 'impact.m4a',
  drop: 'drop.m4a',
  bell: 'bell.m4a',
  sparkle: 'sparkle.m4a',
};

/**
 * Each file's longest allowed length, in seconds: the longest the player
 * ever plays it, plus 0.1 s for the AAC encoder's padding. A replacement
 * that is far longer than the player uses only adds bytes to the page.
 */
export const SFX_MAX_DURATION_S: Readonly<Record<string, number>> = {
  'marimba-43': 1.6,
  'marimba-47': 1.6,
  'marimba-53': 1.6,
  'marimba-60': 1.6,
  'marimba-67': 1.6,
  'harp-55': 1.6,
  'harp-62': 1.6,
  'harp-69': 1.6,
  'harp-76': 1.6,
  'glock-67': 1.6,
  'glock-72': 1.6,
  'glock-79': 1.6,
  'glock-84': 1.6,
  'glock-91': 1.6,
  'glock-96': 1.6,
  'timpani-hit': 2.6,
  'timpani-roll': 1.8,
  whoosh: 0.7,
  impact: 6.6,
  drop: 4.1,
  bell: 5.1,
  sparkle: 7.5,
};
