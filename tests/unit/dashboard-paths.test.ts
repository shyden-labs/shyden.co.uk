import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_FILES,
  IOS_MODE_FILE,
  REPORT_DIR,
} from '../../scripts/test-devices.mjs';
import { searched } from '../source-files';
import { floorBreach } from '../floors';
import { withoutTsComments } from './source-text';

/**
 * `scripts/dashboard.mjs` reads the files `scripts/test-devices.mjs` writes.
 * They are two processes, and the dashboard once kept its own copy of every
 * path with a "kept in sync" comment, because the harness had no exports and
 * importing it would have run the whole gauntlet. It has exports now, behind
 * `import.meta.main`, so the paths have one home: a rename on the writing
 * side reaches the reading side, instead of leaving a dashboard that shows an
 * empty run and says nothing.
 */

const ROOT = path.resolve(import.meta.dirname, '../..');
const source = (file: string): string =>
  withoutTsComments(readFileSync(path.join(ROOT, file), 'utf8'));

/**
 * A string literal naming one of the shared files or directories. The
 * closing quote is part of each pattern: `.jsonl` alone also matches the
 * property access `DASHBOARD_FILES.jsonl`, which is the import doing its job.
 */
const NEEDLES = [
  /['"`]dashboard-state['"`]/,
  /['"`]groups\.json['"`]/,
  /['"`]final\.json['"`]/,
  /\.jsonl['"`]/,
  /['"`]ios-mode\.json['"`]/,
  /['"`]playwright-report['"`]/,
];

const spelledIn = (text: string): string[] =>
  NEEDLES.filter((needle) => needle.test(text)).map(String);

describe('the dashboard reads the paths the device harness writes', () => {
  it('spells each shared path in the harness, and only there', () => {
    const harness = source('scripts/test-devices.mjs');
    const dashboard = source('scripts/dashboard.mjs');
    // Liveness: a needle the harness does not spell either proves nothing
    // by being absent from the dashboard.
    const needles = NEEDLES.map(String);
    expect(spelledIn(harness)).toEqual(needles);
    expect(
      searched(spelledIn(dashboard), {
        of: needles,
        what: 'shared path literals',
      }),
    ).toEqual([]);
    expect(
      floorBreach('dashboard-paths/shared-paths', needles.length),
    ).toBeUndefined();
  });

  it('exports every file the dashboard reads, under the repository root', () => {
    expect(DASHBOARD_FILES).toEqual({
      groups: path.join(ROOT, 'dashboard-state', 'groups.json'),
      final: path.join(ROOT, 'dashboard-state', 'final.json'),
      jsonl: {
        desktop: path.join(ROOT, 'dashboard-state', 'desktop.jsonl'),
        android: path.join(ROOT, 'dashboard-state', 'android.jsonl'),
        ios: path.join(ROOT, 'dashboard-state', 'ios.jsonl'),
      },
    });
    expect(IOS_MODE_FILE).toBe(
      path.join(ROOT, 'test-results', 'ios-mode.json'),
    );
    expect(REPORT_DIR).toEqual({
      desktop: path.join(ROOT, 'playwright-report', 'desktop'),
      android: path.join(ROOT, 'playwright-report', 'android'),
    });
  });
});
