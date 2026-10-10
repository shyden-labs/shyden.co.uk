import { describe, expect, it } from 'vitest';
import unit from '../../vitest.config';
import integration from '../../vitest.integration.config';
import { isDocsOnlyPath } from '../../scripts/docs-only.mjs';
import { floorBreach } from '../floors';
import { NEW_BASELINE, STRAY_SNAPSHOT } from '../git-questions';
import { scratchDir, writeUnder } from '../scratch-dir';
import { searched } from '../source-files';
import { TREE_READING, treeReading } from '../tree-reading';

/**
 * The run's one reading of the tree (#631). A unit test starts no process, so
 * these assert what the snapshot must hold; that it is git's own answer is
 * the integration suite's `tests/integration/tree-reading.test.ts`.
 */
describe('the tree reading every guard shares (#631)', () => {
  it('reaches this worker as a path to a file', () => {
    expect(process.env[TREE_READING]).toMatch(/tree-reading\.json$/);
  });

  it('lists the files that must be tracked', () => {
    const { tracked } = treeReading();
    expect(tracked).toContain('package.json');
    expect(tracked).toContain('vitest.config.ts');
    expect(tracked).toContain('tests/source-files.ts');
  });

  it('holds no blank and no repeated path', () => {
    const { tracked } = treeReading();
    const blank = tracked.filter((path) => path === '');
    expect(searched(blank, { of: tracked, what: 'tracked files' })).toEqual([]);
    expect(
      floorBreach('tree-reading/blank-paths', tracked.length),
    ).toBeUndefined();
    expect(new Set(tracked).size).toBe(tracked.length);
  });

  it('lists every tracked path again among the committable ones', () => {
    const { tracked, committable } = treeReading();
    const all = new Set(committable);
    const missing = tracked.filter((path) => !all.has(path));
    expect(searched(missing, { of: tracked, what: 'tracked files' })).toEqual(
      [],
    );
    expect(floorBreach('tree-reading/tracked', tracked.length)).toBeUndefined();
  });

  it('answers the two ignore questions git settles from its rules', () => {
    const { ignored } = treeReading();
    expect(ignored[STRAY_SNAPSHOT]).toBe(true);
    expect(ignored[NEW_BASELINE]).toBe(false);
  });

  it('holds git`s own selections for the docs-only cross-checks', () => {
    const { docsPathspecSelected, docsNaming } = treeReading();
    const stray = docsPathspecSelected.filter((path) => !isDocsOnlyPath(path));
    expect(
      searched(stray, { of: docsPathspecSelected, what: 'docs-only files' }),
    ).toEqual([]);
    expect(
      floorBreach('tree-reading/docs-selected', docsPathspecSelected.length),
    ).toBeUndefined();
    expect(docsNaming).toContain('scripts/docs-only.mjs');
  });

  it('refuses, naming the global setup, when the run was not given one', () => {
    expect(() => treeReading({})).toThrow(/tests\/tree-reading-setup\.ts/);
  });

  it('refuses, naming the setup, when the file is not there', () => {
    const missing = `${scratchDir('tree-reading-')}/none.json`;
    expect(() => treeReading({ [TREE_READING]: missing })).toThrow(
      /cannot be read[^]*tests\/tree-reading-setup\.ts/,
    );
  });

  it('refuses a file that is not a tree reading', () => {
    const dir = scratchDir('tree-reading-');
    writeUnder(dir)('bad.json', '{"tracked": []}');
    expect(() => treeReading({ [TREE_READING]: `${dir}/bad.json` })).toThrow(
      /not in the shape/,
    );
  });

  it('is listed after the temporary directory it is written into', () => {
    const setups = unit.test?.globalSetup;
    expect(setups).toEqual([
      'tests/temporary-files.ts',
      'tests/tree-reading-setup.ts',
    ]);
  });

  it('is read by the config the integration suite shares', () => {
    expect(integration.test?.globalSetup).toBe(unit.test?.globalSetup);
  });
});
