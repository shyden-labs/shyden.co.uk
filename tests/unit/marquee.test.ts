import { afterEach, describe, it, expect, vi } from 'vitest';
import { LOCALES } from '../../src/lib/i18n';
import { localeNativeNames } from '../../src/lib/i18n/metadata';

/**
 * The marquee names the languages the site SERVES, derived (#17).
 *
 * The approved artifact writes the list by hand. Deriving it from `LOCALES`
 * means a locale cannot be added without the marquee following, and — the
 * half that matters — the marquee cannot name a language the site does not
 * actually serve. The site-wide rule is that copy never states what anything
 * is available in; a list that can only ever be true is the one form of that
 * claim which cannot go stale into a lie.
 */
describe('the homepage marquee', () => {
  /**
   * A literal pin, deliberately separate from the derivation.
   *
   * `expect(names).toEqual(LOCALES.map(nativeName))` would be green whatever
   * either side said — it asserts the relationship and never the level
   * (#117). These are the actual endonyms, and a change to any of them is a
   * change a person should see in a diff.
   */
  it('names each language as that language names itself', () => {
    expect(localeNativeNames()).toEqual([
      'English',
      'Bahasa Indonesia',
      '中文',
      'Tiếng Việt',
      'ไทย',
    ]);
  });

  describe('when the site serves fewer languages than it has metadata for', () => {
    // `MVP_LOCALES` is deliberately wider than `LOCALES`: metadata for a
    // language ships before the language is served. Today the two lists are
    // equal, so only a narrower `LOCALES` can show which one the marquee
    // reads. The mock is the smallest way to stage that without editing the
    // shipped list.
    afterEach(() => {
      vi.doUnmock('../../src/lib/i18n/locales');
      vi.resetModules();
    });

    it('names only the languages served, never one merely staged', async () => {
      vi.resetModules();
      vi.doMock('../../src/lib/i18n/locales', () => ({
        LOCALES: ['en', 'id'],
        DEFAULT_LOCALE: 'en',
      }));
      const metadata = await import('../../src/lib/i18n/metadata');
      expect(metadata.localeNativeNames()).toEqual([
        'English',
        'Bahasa Indonesia',
      ]);
    });
  });

  it('covers every locale the site serves, and no others', () => {
    expect(localeNativeNames()).toHaveLength(LOCALES.length);
    expect(localeNativeNames().filter((n) => n.trim() !== '')).toHaveLength(
      LOCALES.length,
    );
  });
});
