/**
 * The tag a test carries when it calls `page.clock` or `context.clock` (#854).
 *
 * The phone has one browser context for the whole run (`browser.newContext()` is unsupported
 * over its CDP connection; see `tests/e2e/fixtures.ts`), and Playwright cannot take a clock back
 * out of a context: `clock.install()` registers its script on the context server-side, Playwright
 * 1.63 removes it only inside `resetForReuse`, and the protocol has no uninstall. A clock one
 * test installed therefore ran every later page's animation frames as timers for the rest of the
 * run, and one of them fired the theme test's first-frame recorder before the page had an
 * `<html>` element. A tagged test runs in the phone's `android-chrome-clock` project
 * (playwright.device.config.ts), whose `installsAClock` option gives it a worker, and so a CDP
 * connection, that no untagged test shares; the clock ends with that connection.
 */
export const CLOCK_TAG = '@installs-a-clock';

/** Marks a clock whose methods already refuse an undeclared call. */
const GUARDED = Symbol('shyden-clock-declaration-guard');

type Guardable = Record<string | symbol, unknown>;

/**
 * Makes every method of `clock` refuse, before it reaches Playwright, while `declared()` is
 * false, and returns the names it guards. The names are read off the clock's class rather than
 * listed here, so a method a later Playwright adds is guarded the day it appears; a class with
 * none fails closed. A clock is guarded once: a later call returns the same names and keeps the
 * first `declared`, which the fixture points at the running test.
 */
export function refuseUndeclaredClock(
  clock: object,
  declared: () => boolean,
): string[] {
  const target = clock as Guardable;
  const already = target[GUARDED];
  if (Array.isArray(already)) return [...(already as string[])];
  const prototype = Object.getPrototypeOf(clock) as Guardable | null;
  // A plain object's prototype is Object's own, whose methods (toString and the rest) are not a
  // clock's: only a class of its own can hold them.
  const methods =
    prototype === null || prototype === Object.prototype
      ? []
      : Object.getOwnPropertyNames(prototype).filter(
          (name) =>
            name !== 'constructor' && typeof prototype[name] === 'function',
        );
  if (methods.length === 0)
    throw new Error(
      'found no clock methods to guard on the phone, so an undeclared clock would go ' +
        "unrefused and outlive its test, #854: Playwright's Clock class changed shape",
    );
  for (const name of methods) {
    const original = (
      (prototype as Guardable)[name] as (...args: unknown[]) => unknown
    ).bind(clock);
    target[name] = async (...args: unknown[]) => {
      if (!declared())
        throw new Error(
          `clock.${name}() was called by a test not tagged ${CLOCK_TAG}. On the phone a ` +
            "clock cannot be removed from the run's one shared context, so it would outlive " +
            `this test, #854. Tag the test { tag: '${CLOCK_TAG}' }: it then runs in the ` +
            "phone's android-chrome-clock project, a worker no untagged test shares.",
        );
      return original(...args);
    };
  }
  target[GUARDED] = methods;
  return [...methods];
}
