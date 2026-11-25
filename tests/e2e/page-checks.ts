import type { Page, Response } from '@playwright/test';
import type { Theme } from '../palette';
import type { ViewportSize } from '../viewport-at';

/**
 * One check a page is put through on its walk (#1086, Shyden's ruling of
 * 2026-11-13: "one test per page, per language and per theme opens the page
 * once and makes every read-only check from every file, as soft assertions").
 *
 * Each check used to be its own test, and each opened the same page again:
 * on the phone, `/id/` was loaded once per file that read it. A check now
 * names the pages it reads (`routes`, the same population its old test loop
 * walked) and the theme it reads them in, and `page-walk.spec.ts` opens each
 * page once per theme and runs every check that applies to it.
 *
 * A check only reads. One that clicks or types is a different journey and
 * stays its own test.
 *
 * A check read at set widths (`widths`) used to be one test per width. On a
 * real phone, which cannot take an emulated width (#1046), each of those was
 * the identical journey at the phone's own width (Shyden's ruling of
 * 2026-11-13, "One test, widths inside"). The walk now reloads the page at
 * each width on an emulated target, and on a real phone reads it once, on the
 * walk's own load. One that changes the page in a
 * way a later check would read (`mutates`) runs after every check that does
 * not, in the order listed.
 */
export interface PageCheck {
  /** Kept from the test it replaces, so a failure still names what broke. */
  readonly name: string;
  /** The pages its old test loop walked: `page-walk.spec.ts` holds each one to the walk. */
  readonly routes: () => readonly string[];
  /**
   * The theme it reads in. `'dark'` is every project's own colour scheme, so a
   * check that never chose a theme runs in the dark walk, as it ran before.
   */
  readonly themes: readonly Theme[];
  /** The widths it reads at, each 900px tall. Without it, the target's own size. */
  readonly widths?: readonly number[];
  /** It opens a disclosure, plants an error or replaces the body: run last. */
  readonly mutates?: boolean;
  readonly run: (visit: Visit) => Promise<void>;
}

/** The one visit every check on a page reads. */
export interface Visit {
  readonly page: Page;
  readonly route: string;
  readonly theme: Theme;
  /** What the walk's own `goto` answered: the status its old test read. */
  readonly response: Response | null;
  /** The size the page was read at: the width asked for, or a real phone's own. */
  readonly took: ViewportSize;
}

/** The height every width check reads at, as each per-width test did. */
export const WIDTH_CHECK_HEIGHT = 900;

/** The scheme every project emulates when a test chooses none. */
export const DEFAULT_THEME: Theme = 'dark';
