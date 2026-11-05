import { filesUnder } from './source-files';
import {
  DOCS_ONLY_FILES,
  DOCS_READ_BY_CODE,
  DOCS_TREE,
} from '../scripts/docs-only.mjs';

/**
 * The questions the suite puts to git, in one home (#631).
 *
 * A unit test starts no process, so git is asked once per run, in the global
 * setup (`tests/tree-reading-setup.ts`), and every test reads the answer
 * (`tests/tree-reading.ts`). The setup and the tests both import the
 * questions from here, so a question is never spelled twice and an answer is
 * never to a question the test did not mean.
 */

/** Every `git ls-files` selection the docs-only allowlist is checked against: git's own pathspec engine, beside the module's matcher. */
export const docsPathspec = (): string[] => [
  ...DOCS_ONLY_FILES.map((file) => `:(literal)${file}`),
  `:(glob)${DOCS_TREE}**`,
  ...DOCS_READ_BY_CODE.map((tree) => `:(exclude,glob)${tree}**`),
];

/** `git grep` arguments naming the files outside `docs/` and prose whose raw bytes mention `docs/`. */
export const docsNamingArgs = (): string[] => [
  'grep',
  '-l',
  '-I',
  '-z',
  '-F',
  DOCS_TREE,
  '--',
  '.',
  `:(exclude)${DOCS_TREE}`,
  ':(exclude,glob)**/*.md',
  ':(exclude)*.md',
];

/** The files that hold code here; an `.astro` file is read by its regions. */
export const SOURCE_FILE = /\.(ts|tsx|mjs|js|astro)$/;

/**
 * A snapshot a stray run writes beside a spec, and the place a REAL new
 * baseline would land. Neither is tracked, so git answers from its rules.
 */
export const STRAY_SNAPSHOT =
  'tests/e2e/visual.spec.ts-snapshots/home-id-mobile-android-chrome-darwin.png';
export const NEW_BASELINE =
  'tests/e2e/__screenshots__/a-new-page-desktop-linux.png';

/** Every source file on disk, from the one walk: what stranded-docblocks asks git about. */
export const walkedSource = (): string[] =>
  filesUnder('.', (path) => SOURCE_FILE.test(path));

/** Every path `ignoredByGit` is asked about in a run. */
export const ignoreQuestions = (): string[] => [
  ...new Set([STRAY_SNAPSHOT, NEW_BASELINE, ...walkedSource()]),
];
