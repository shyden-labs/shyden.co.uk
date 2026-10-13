import { describe, expect, it } from 'vitest';
import { reachesPackage } from '../parser-files';

/**
 * Which unit test files load the TypeScript parser (#688): the unit suite
 * runs them in a project of their own that loads it once per worker. Read
 * from each file's static imports, followed through relative helpers, so a
 * file that starts parsing through a helper next year is found the day it does.
 */
const files: Readonly<Record<string, string>> = {
  'tests/unit/direct.test.ts': "import ts from 'typescript';\n",
  'tests/unit/via.test.ts': "import { parse } from './helper';\n",
  'tests/unit/helper.ts': "export { parse } from '../deep/parse.ts';\n",
  'tests/deep/parse.ts':
    "import ts from 'typescript';\nexport const parse = ts;\n",
  'tests/unit/comment.test.ts':
    "// import ts from 'typescript';\nimport { it } from 'vitest';\n",
  'tests/unit/other.test.ts':
    "import { readFileSync } from 'node:fs';\nimport yaml from 'yaml';\n",
  'tests/unit/cycle-a.test.ts': "import './cycle-b';\n",
  'tests/unit/cycle-b.ts': "import './cycle-a.test';\n",
  'tests/unit/missing.test.ts': "import { x } from './nowhere';\n",
};
const read = (path: string): string | undefined => files[path];

describe('reachesPackage: a test file that loads a package, however it gets there', () => {
  it.each([
    ['an import of the package itself', 'tests/unit/direct.test.ts', true],
    [
      'through a helper and a re-export, two levels down',
      'tests/unit/via.test.ts',
      true,
    ],
    [
      'not through a comment that names it',
      'tests/unit/comment.test.ts',
      false,
    ],
    ['not through other packages', 'tests/unit/other.test.ts', false],
    ['not through a cycle, which ends', 'tests/unit/cycle-a.test.ts', false],
    [
      'not through a helper that is not there',
      'tests/unit/missing.test.ts',
      false,
    ],
  ] as const)('%s', (_case, file, expected) => {
    expect(reachesPackage(file, 'typescript', read)).toBe(expected);
  });
});
