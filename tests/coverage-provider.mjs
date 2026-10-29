/**
 * The coverage provider every Vitest suite names (#912): `@vitest/coverage-v8`
 * itself, with Vitest's hard-coded excludes (each setup file, the test include
 * patterns, the config) replaced by the measured set's own, so test and setup
 * files are measured like the code they test. Tests are code (Shyden
 * 2026-10-22, every project). `tests/coverage-excludes.mjs` holds how. Its
 * report also counts the declarators coverage-v8 drops (#928,
 * `tests/coverage-declarators.mjs`).
 */
import v8 from '@vitest/coverage-v8';
import { convert } from 'ast-v8-to-istanbul';
import { programOf, withImportedDeclarators } from './coverage-declarators.mjs';
import { delegatingTo } from './coverage-excludes.mjs';
import { NOT_MEASURED } from './coverage-options.ts';

const measured = delegatingTo(v8, NOT_MEASURED);

export default {
  ...measured,
  // Counting the declarators coverage-v8 drops as Vite's own bindings (#928).
  getProvider: async () =>
    withImportedDeclarators(await measured.getProvider(), {
      parse: programOf,
      convert,
    }),
};
