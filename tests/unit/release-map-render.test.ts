import { describe, expect, it } from 'vitest';
import { renderChangeMap } from '../../scripts/release-map.mjs';

/**
 * The change map's "What shows it" cell, one row per classification. The
 * guards read the map a release builds; this is the cell's wording alone.
 */
describe('renderChangeMap says what shows each commit', () => {
  const mapOf = (classification: unknown) =>
    renderChangeMap({
      rows: [
        {
          entry: {
            sha: '0123456789abcdef',
            pr: 12,
            ticket: 34,
            subject: 'A subject',
          },
          classification,
          flagged: false,
        },
      ],
      totals: { entries: 1, visible: 0, gap: 0, none: 1, flagged: 0 },
      otherCommits: 0,
      otherAreas: [],
    }).changeMap;

  it('names the reason a commit changes nothing a visitor sees, escaped', () => {
    expect(mapOf({ kind: 'none', reason: 'tests <only>' })).toContain(
      '<td>No intended visible change: tests &lt;only&gt;</td></tr>',
    );
  });

  it('marks a visible change no journey shows, with the check that would', () => {
    expect(mapOf({ kind: 'gap', check: 'the header' })).toContain(
      '<strong style="color:var(--alert)">Shown by no journey.</strong> the header</td>',
    );
  });

  it('names the commit by its short SHA and its refs', () => {
    expect(mapOf({ kind: 'none', reason: 'r' })).toContain(
      '<tr><td class="mono">0123456</td><td>PR #12 · #34</td><td>A subject</td>',
    );
  });
});
