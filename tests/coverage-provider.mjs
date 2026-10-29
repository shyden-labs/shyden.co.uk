/**
 * The coverage provider every Vitest suite names (#912): `@vitest/coverage-v8`
 * itself, with Vitest's hard-coded excludes (each setup file, the test include
 * patterns, the config) replaced by the measured set's own, so test and setup
 * files are measured like the code they test. Tests are code (Shyden
 * 2026-10-22, every project). `tests/coverage-excludes.mjs` holds how.
 */
import v8 from '@vitest/coverage-v8';
import { delegatingTo } from './coverage-excludes.mjs';
import { NOT_MEASURED } from './coverage-options.ts';

export default delegatingTo(v8, NOT_MEASURED);
