import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * `scripts/` where a contributor's checkout might put it (#221).
 *
 * A script that decides "was I run directly?" by comparing paths answers
 * wrongly for some checkouts, and says nothing when it does: `main()` never
 * runs and the process exits 0. `import.meta.url` is percent-encoded while
 * `process.argv[1]` is not, so a space in the path defeats one spelling; Node
 * resolves symlinks in the URL but not in `argv[1]`, which defeats another.
 *
 * `spaced` is a REAL directory whose path holds a space. `linked` reaches the
 * same files through a symlink whose own name holds none, so a failure there
 * belongs to the symlink alone. The temp base is resolved first because
 * macOS's `tmpdir()` is itself behind a symlink (`/var` is `/private/var`):
 * unresolved, every run on a Mac would go through one, and the two cases would
 * blur into each other on one platform and not on the other.
 *
 * `node_modules` is linked in beside the copy, so a script that resolves a
 * package from its own location (`visual.mjs` does, at load) finds the
 * checkout's packages, as it would in a real checkout. `remove` unlinks that
 * link without following it; Node's `rmSync` never follows symlinks.
 */
export interface ScriptCheckout {
  /** The copied `scripts/`, at a path holding a space. */
  readonly spaced: string;
  /** The same directory, reached through a symlink. */
  readonly linked: string;
  /** Deletes everything this created. */
  readonly remove: () => void;
}

export function scriptCheckout(): ScriptCheckout {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'script-checkout-')));
  const root = join(base, 'check out');
  mkdirSync(root);
  cpSync('scripts', join(root, 'scripts'), { recursive: true });
  // `src` too, and whole: three scripts import the catalogues from
  // `../src/lib/i18n/`, so a checkout holding only `scripts/` cannot run them
  // at all -- the import throws before `main()` is reached, and the refusal
  // the probe is watching for never happens (#276). Copied entire rather than
  // the one directory they read today, because a fixture that holds less than
  // a checkout does drifts from it silently; it is 2 MB, once per run.
  cpSync('src', join(root, 'src'), { recursive: true });
  // `tests` too, whole, for the same reason: `coverage-processes.mjs` imports
  // `../tests/coverage-options.ts`, the one home of what coverage measures,
  // and without it its probe met ERR_MODULE_NOT_FOUND before its usage line
  // (#899, record run 39703940249). 16 MB, measured at 122 ms to copy.
  cpSync('tests', join(root, 'tests'), { recursive: true });
  symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir');
  const link = join(base, 'linked');
  symlinkSync(root, link, 'dir');
  return {
    spaced: join(root, 'scripts'),
    linked: join(link, 'scripts'),
    remove: () => rmSync(base, { recursive: true, force: true }),
  };
}
