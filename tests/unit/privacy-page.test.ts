import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PRIVACY_EN,
  PRIVACY_ID,
  legalTexts,
  type Block,
  type Inline,
  type LegalDocument,
} from '../../src/lib/legal/privacy';
import { everythingUnder, filesUnder, searched } from '../source-files';

/**
 * The privacy page (#1080) in English, in the words Shyden approved on
 * 2026-11-22, and its Indonesian copy (#1082), which governs for residents of
 * Indonesia. Neither text is in a catalogue or a DeepL draft; the Indonesian
 * is read back by Google Cloud Translation line by line, and that reading is
 * kept beside it. zh, vi and th serve no copy: their footers say, in their
 * own language, that the page is in English only.
 */

/** Every line a reader sees, headings and dates included. */
const allLines = (doc: LegalDocument): string[] => [
  doc.title,
  doc.description,
  doc.heading,
  doc.updated,
  ...doc.sections.map(({ heading }) => heading),
  ...legalTexts(doc),
];

const hrefsOf = (doc: LegalDocument): string[] =>
  [...doc.lead, ...doc.sections.flatMap((s) => s.blocks)].flatMap(
    (block: Block) =>
      (block.kind === 'p' ? [block.parts] : block.items).flatMap(
        (run: readonly Inline[]) =>
          run.flatMap((part) => (typeof part === 'string' ? [] : [part.href])),
      ),
  );

/** The document's shape: each block's kind and, for a list, its length. */
const shapeOf = (doc: LegalDocument) => ({
  lead: doc.lead.map((b) => (b.kind === 'p' ? 'p' : `ul${b.items.length}`)),
  sections: doc.sections.map((s) =>
    s.blocks.map((b) => (b.kind === 'p' ? 'p' : `ul${b.items.length}`)),
  ),
});

describe('the privacy pages (#1080, #1082)', () => {
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

  it('the English opening ends by saying which text governs (Shyden, 2026-11-22)', () => {
    expect(legalTexts({ ...PRIVACY_EN, sections: [] }).at(-1)).toBe(
      'This page is also available in Indonesian. For residents of Indonesia, the Indonesian text governs; for everyone else, this English text governs.',
    );
    expect(PRIVACY_EN.lead.at(-1)).toMatchObject({
      kind: 'p',
      parts: expect.arrayContaining([
        { text: 'Indonesian', href: '/id/privacy/' },
      ]),
    });
  });

  it('the Indonesian copy has the English shape, and its links lead to the Indonesian pages', () => {
    expect(shapeOf(PRIVACY_ID)).toEqual(shapeOf(PRIVACY_EN));
    expect(hrefsOf(PRIVACY_ID)).toEqual(
      hrefsOf(PRIVACY_EN).map((href) =>
        href === '/support'
          ? '/id/support'
          : href === '/id/privacy/'
            ? '/privacy/'
            : href,
      ),
    );
  });

  it('every Indonesian line has its Google read-back, and the reading names no other line', () => {
    const readings = JSON.parse(
      readFileSync('src/lib/legal/privacy.id.read-back.json', 'utf8'),
    ) as { id: string; back: string }[];
    expect(readings.map(({ id }) => id).sort()).toEqual(
      [...new Set(allLines(PRIVACY_ID))].sort(),
    );
    expect(
      searched(
        readings.filter(({ back }) => back.trim() === '').map(({ id }) => id),
        { of: readings, what: 'Indonesian privacy read-backs' },
      ),
    ).toEqual([]);
  });

  it('no line of either is in a catalogue or a translation store', () => {
    // everythingUnder lists dot-files, where the drafts and readings live.
    const files = everythingUnder('src/lib/i18n').filter(
      (path) => !path.endsWith('/'),
    );
    expect(files).toContain('src/lib/i18n/.translations.json');
    expect(files).toContain('src/lib/i18n/.read-back.json');
    const texts = [...legalTexts(PRIVACY_EN), ...legalTexts(PRIVACY_ID)];
    const held = files.flatMap((file) => {
      const body = readFileSync(file, 'utf8');
      return texts.filter((t) => body.includes(t)).map((t) => `${file}: ${t}`);
    });
    expect(searched(held, { of: texts, what: 'privacy page lines' })).toEqual(
      [],
    );
  });

  // AC5 (#1082): legal pages exist in English and Indonesian alone (global
  // rule, 2026-11-08). A route for any other locale fails here.
  it('only the English and Indonesian routes serve it', () => {
    expect(filesUnder('src/pages', (path) => /privacy/i.test(path))).toEqual([
      'src/pages/id/privacy/index.astro',
      'src/pages/privacy/index.astro',
    ]);
  });
});
