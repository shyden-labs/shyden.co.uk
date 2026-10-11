/**
 * The parser project's setup (#688): load the TypeScript parser before the
 * load measurement (`unit-load-setup.ts`) starts its clock. The project runs
 * with isolation off, so a worker loads it once and every parser file after
 * the first finds it cached; ~135 ms of CPU per file before this (measured
 * 2026-10-11). Cost of loading a parser file is then the file's own.
 */
import 'typescript';
