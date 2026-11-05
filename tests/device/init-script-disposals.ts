/**
 * Structural subset of Playwright's own `Disposable` (playwright-core/types/types.d.ts), returned
 * by `context.addInitScript`. Declared locally: `@playwright/test`'s re-export chain does not
 * surface the type under that name at the package's top level.
 */
export interface InitScriptDisposable {
  dispose(): Promise<void>;
}

/**
 * Removes every init script one test added to the phone's single, shared context, and rejects,
 * once every removal has been tried, if any of them refused.
 *
 * Every script is tried even after one refuses, so one failure does not strand the rest. A
 * refusal is never swallowed: a script left in place runs on every later test's page for the
 * rest of the run, the leak `tests/e2e/fixtures.ts` removes scripts to prevent, and the fixture
 * used to `.catch(() => {})` it into silence (#390 F125).
 */
export async function disposeAll(
  disposables: readonly InitScriptDisposable[],
): Promise<void> {
  const refused: unknown[] = [];
  for (const disposable of disposables) {
    try {
      await disposable.dispose();
    } catch (error) {
      refused.push(error);
    }
  }
  if (refused.length > 0)
    throw new AggregateError(
      refused,
      `${refused.length} init script(s) this test added could not be removed from the ` +
        "phone's shared context, so they would run on every later test's page",
    );
}
