import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import unit from '../../vitest.config';
import { parserTestFiles } from '../parser-files';
import { nonEmpty, searched } from '../source-files';
import { unitProject } from '../vitest-suite-dirs';

/**
 * The unit suite in two projects (#688; operator 2026-10-11, "500 ms, share
 * the parser first"): the files that load the TypeScript parser run with
 * isolation off, so a worker loads it once, and every other file keeps its
 * own fresh modules. Each unit file runs in exactly one of them.
 */
describe('the unit suite shares the parser between the files that load it', () => {
  it('runs every file that loads the parser in the parser project, and only those', () => {
    expect(unitProject('unit-parser').include).toEqual(parserTestFiles());
  });

  // An independent reader: the raw text of each unit file, no import walk.
  // Every file that names the parser in an import line must be in the
  // parser project, whatever the walk found.
  it('runs every file that imports the parser directly in the parser project', () => {
    const files = nonEmpty(readdirSync('tests/unit'), 'unit files')
      .filter((name) => name.endsWith('.test.ts'))
      .map((name) => `tests/unit/${name}`);
    const direct = files.filter((file) =>
      /^import [^;]*from 'typescript';$/m.test(readFileSync(file, 'utf8')),
    );
    const missing = direct.filter(
      (file) => !(unitProject('unit-parser').include ?? []).includes(file),
    );
    expect(
      searched(missing, {
        of: direct,
        what: 'files importing typescript directly',
      }),
    ).toEqual([]);
    expect(
      floorBreach('parser-project/direct-importers', direct.length),
    ).toBeUndefined();
  });

  it('keeps the parser files out of the other project', () => {
    expect(unitProject('unit').exclude).toEqual(parserTestFiles());
  });

  it('turns isolation off for the parser project alone', () => {
    expect({
      root: unit.test?.isolate,
      unit: unitProject('unit').isolate,
      parser: unitProject('unit-parser').isolate,
    }).toEqual({ root: undefined, unit: undefined, parser: false });
  });

  it('finds the files that load the parser, and as many as there are', () => {
    expect(
      floorBreach('parser-project/files', parserTestFiles().length),
    ).toBeUndefined();
  });
});
