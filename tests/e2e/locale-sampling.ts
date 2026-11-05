import { LOCALES, localisePath } from '../../src/lib/i18n';

/**
 * The locales a WIDGET-BEHAVIOUR test runs against, and why it is a sample.
 *
 * These specs assert what a control does — a button toggles, a field
 * validates, a dialog traps focus. That markup is one component rendered
 * through the `[locale]` route, and the assertions are not layout- or
 * text-sensitive, so running them across all five locales would add roughly
 * 250 tests to catch nothing.
 *
 * Anything layout- or text-sensitive must NOT use this: it belongs on the
 * full `LOCALES` set, because character widths differ. `language-switcher`'s
 * 320px overflow test and `thai-typography` are the examples.
 *
 * This exists because the literal it replaces (`['/x', '/id/x']`) was not a
 * decision — it was written when `LOCALES` was `en`+`id` and simply never
 * revisited when #22 shipped five (#75). Sampling is a legitimate choice;
 * inheriting one by accident is not. Widen here if that changes.
 */
export const SAMPLED_LOCALES = ['en', 'id'] as const;

/**
 * `path` in each sampled locale, e.g. `/classroom-groups` and `/id/…`.
 *
 * Throws if a sampled locale has stopped shipping. A sample that silently
 * narrows to nothing is the failure this whole ticket is about: the tests
 * would still pass, over fewer and fewer routes.
 */
export const sampledPaths = (path: string): string[] => {
  const missing = SAMPLED_LOCALES.filter(
    (locale) => !(LOCALES as readonly string[]).includes(locale),
  );
  if (missing.length)
    throw new Error(
      `locale-sampling: sampled locale(s) ${missing.join(', ')} are no longer in LOCALES`,
    );
  return SAMPLED_LOCALES.map((locale) => localisePath(path, locale));
};

/**
 * `path` in EVERY locale: what a layout- or text-sensitive test runs against,
 * because character widths differ. Beside `sampledPaths` so that each call
 * site says which it chose. Five fit tests on `/classroom-groups` and the
 * roster's truncation test measured English, or English and Indonesian,
 * while this file's own header said they must not (#390 F113).
 */
export const localePaths = (path: string): string[] =>
  LOCALES.map((locale) => localisePath(path, locale));
