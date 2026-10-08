import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { filesUnder, nonEmpty, searched } from '../source-files';
import { floorBreach } from '../floors';
import { blankCommentLines } from '../unit/source-text';

describe('the harness runs under plain Node', () => {
  it('loads every module a script imports from src/', () => {
    // The scripts run on Node's type stripping, which refuses TypeScript that
    // needs compiling -- a constructor parameter property is enough -- and
    // cannot resolve an import written without its extension. Vitest accepts
    // both, so only loading each module the way a script does proves it runs.
    const modules = nonEmpty(
      [
        ...new Set(
          filesUnder('scripts', (path) => path.endsWith('.mjs')).flatMap(
            (script) =>
              [
                ...blankCommentLines(readFileSync(script, 'utf8')).matchAll(
                  /from '(\.\.\/src\/[^']+)'/g,
                ),
              ].map(([, specifier]) => resolve(dirname(script), specifier)),
          ),
        ),
      ],
      'src modules the scripts import',
    );
    const refused = modules.flatMap((module) => {
      const run = spawnSync(
        process.execPath,
        [
          '--no-warnings',
          '--input-type=module',
          '-e',
          `await import(${JSON.stringify(pathToFileURL(module).href)});`,
        ],
        { encoding: 'utf8' },
      );
      if (run.status === 0) return [];
      const stderr = run.stderr.trim();
      return [
        `${relative('.', module)}: ${stderr.split('\n').find((line) => line.includes('Error')) ?? stderr}`,
      ];
    });
    expect(
      searched(refused, {
        of: modules,
        what: 'src modules the scripts import',
      }),
    ).toEqual([]);
    expect(
      floorBreach('translate-messages/imported-src-modules', modules.length),
    ).toBeUndefined();
  });
});
