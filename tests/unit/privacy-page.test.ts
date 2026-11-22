import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRIVACY_EN, legalTexts } from '../../src/lib/legal/privacy';
import { everythingUnder, filesUnder, searched } from '../source-files';

/**
 * The privacy page (#1080) is in English alone, in the words Shyden approved
 * on 2026-11-22. One line goes to the other languages, the footer's "This
 * page is available in English only."; the page's own text stays out of every
 * catalogue, DeepL draft and Google read-back, and no other locale serves it.
 */
describe('the English privacy page (#1080)', () => {
  it('reads each paragraph and list item as its words, a link as its text', () => {
    expect(
      legalTexts({
        ...PRIVACY_EN,
        lead: [
          {
            kind: 'p',
            parts: ['Ask on the ', { text: 'form', href: '/f' }, '.'],
          },
        ],
        sections: [
          { heading: 'H', blocks: [{ kind: 'ul', items: [['a'], ['b']] }] },
          { heading: 'I', blocks: [{ kind: 'p', parts: ['c'] }] },
        ],
      }),
    ).toEqual(['Ask on the form.', 'a', 'b', 'c']);
  });

  it('no line of it is in a catalogue or a translation store', () => {
    // everythingUnder lists dot-files, where the drafts and readings live.
    const files = everythingUnder('src/lib/i18n').filter(
      (path) => !path.endsWith('/'),
    );
    expect(files).toContain('src/lib/i18n/.translations.json');
    expect(files).toContain('src/lib/i18n/.read-back.json');
    const texts = legalTexts(PRIVACY_EN);
    const held = files.flatMap((file) => {
      const body = readFileSync(file, 'utf8');
      return texts.filter((t) => body.includes(t)).map((t) => `${file}: ${t}`);
    });
    expect(searched(held, { of: texts, what: 'privacy page lines' })).toEqual(
      [],
    );
  });

  it('only the English route serves it', () => {
    expect(filesUnder('src/pages', (path) => /privacy/i.test(path))).toEqual([
      'src/pages/privacy/index.astro',
    ]);
  });
});
