import './tests/main-coverage.ts';
import { defineConfig } from 'vitest/config';
import unit from './vitest.config.ts';
import { coverageFor } from './tests/coverage-options.ts';
import { UNIT_JUDGES } from './tests/setup-files.ts';

/**
 * The coverage run (#896): the unit suite under V8 coverage, minus exactly its
 * two judges (`UNIT_JUDGES`), since instrumentation spends CPU and load time
 * that is not the test's own. The 1 s step (`npm run test:unit`) runs without
 * coverage and keeps both. Everything else is the unit config's own: the same
 * files, the refusals, the 1 s runner limit. Pinned by
 * tests/unit/coverage-config.test.ts.
 */
const withoutJudges = (files: unknown): string[] =>
  (Array.isArray(files) ? files : [files]).filter(
    (file): file is string =>
      typeof file === 'string' && !UNIT_JUDGES.includes(file),
  );

const projects = (unit.test?.projects ?? []).map((project) => {
  if (typeof project !== 'object' || project === null || !('test' in project))
    throw new Error('vitest.config.ts has a project this config cannot read');
  const test = project.test ?? {};
  return { test: { ...test, setupFiles: withoutJudges(test.setupFiles) } };
});

export default defineConfig({
  test: {
    ...unit.test,
    setupFiles: withoutJudges(unit.test?.setupFiles),
    reporters: ['default'],
    projects,
    coverage: coverageFor('unit'),
  },
});
