/**
 * #1215: on the real Android phone, closing Chrome's last tab puts the
 * Launcher in front. Measured 2026-11-19 on `3b402284`: every page closed over
 * the DevTools socket, and every `mCurrentFocus` read after it named
 * `com.android.launcher`. The device fixtures open a scratch tab and close it
 * before every test, and close every page after one, so with no other tab the
 * next test's foreground check (#1073) failed on the Launcher: 384 of 807 in
 * the 2026-11-18 run.
 *
 * So the run keeps one blank tab open throughout, and every close leaves it.
 */

interface Tab {
  isClosed(): boolean;
  close(): Promise<void>;
}

interface Tabs<T extends Tab> {
  pages(): T[];
  newPage(): Promise<T>;
}

/** The tab kept open for the run: the one given while it is open, else a new blank one. */
export async function keepATab<T extends Tab>(
  context: Tabs<T>,
  keeper: T | undefined,
): Promise<T> {
  if (keeper && !keeper.isClosed()) return keeper;
  return context.newPage();
}

/** Closes every tab but the kept one; a tab that refuses to close is left. */
export async function closeAllBut<T extends Tab>(
  context: Tabs<T>,
  keeper: T,
): Promise<void> {
  for (const page of context.pages())
    if (page !== keeper) await page.close().catch(() => {});
}
