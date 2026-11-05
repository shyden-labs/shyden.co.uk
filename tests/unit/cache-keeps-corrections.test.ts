import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zh } from '../../src/lib/i18n/zh';
import { vi } from '../../src/lib/i18n/vi';
import { th } from '../../src/lib/i18n/th';
import { siteEn } from '../../src/lib/i18n/site';
import { getSiteStrings } from '../../src/lib/i18n';
import { en, type Catalogue } from '../../src/lib/i18n/en';

/**
 * The DeepL cache holds what the operator approved, not what DeepL drafted
 * (#603, after #161's #325 did the same by hand).
 *
 * `.translations.json` is what `i18n:scaffold` renders a catalogue from, so a
 * rejected draft left in it comes back the next time anyone re-seeds a locale.
 * DeepL drafted "Student numbers" as a headcount in zh, vi and th ("number of
 * students"), and the operator rejected all three. Every entry below is a
 * value he approved: the cache and the live catalogue must both hold it, so
 * a draft put back in either goes red naming the locale and the English.
 *
 * The table is written out, not derived: which entries the operator
 * corrected is his decision, and nothing in the files says so.
 */
const CACHE: Record<string, Record<string, string>> = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../src/lib/i18n/.translations.json'),
    'utf8',
  ),
);

type Pages = Record<'zh' | 'vi' | 'th', Catalogue>;
const PAGES: Pages = { zh, vi, th };

interface Correction {
  locale: 'zh' | 'vi' | 'th';
  /** The English the cache is keyed by. */
  english: string;
  /** `site.` keys read the page-chrome catalogue; the rest, the tool's. */
  key: string;
  approved: string;
  /**
   * The English is a message template (#136): the cache holds the sentence
   * the translator was sent, so it is not the catalogue's own string.
   */
  message?: true;
}

const HELP = 'The student numbers of anyone absent, separated by commas.';

const CORRECTIONS: readonly Correction[] = [
  { locale: 'zh', english: 'Sound on', key: 'soundOn', approved: '声音：开' },
  { locale: 'zh', english: 'Sound off', key: 'soundOff', approved: '声音：关' },
  {
    locale: 'th',
    english: '+ Add several…',
    key: 'rosterAddSeveral',
    approved: '+ เพิ่มหลายคน…',
  },
  {
    locale: 'vi',
    english: '{total} students · {here} here · {absent} absent',
    key: 'rosterCountLine',
    message: true,
    approved: '{total} học sinh · {here} có mặt · {absent} vắng mặt',
  },
  {
    locale: 'zh',
    english: 'Export groups',
    key: 'ioExportGroups',
    approved: '导出分组',
  },
  {
    locale: 'vi',
    english: 'What to print',
    key: 'printWhat',
    approved: 'Nội dung cần in',
  },
  {
    locale: 'vi',
    english: 'Group results',
    key: 'printWhatGroups',
    approved: 'Kết quả chia nhóm',
  },
  {
    locale: 'vi',
    english: 'Toggle navigation menu',
    key: 'site.menuLabel',
    approved: 'Mở hoặc đóng menu điều hướng',
  },
  {
    locale: 'th',
    english: 'Toggle navigation menu',
    key: 'site.menuLabel',
    approved: 'เปิดหรือปิดเมนูนำทาง',
  },
  {
    locale: 'zh',
    english: 'Pause motion',
    key: 'site.home.pauseMotion',
    approved: '暂停动画',
  },
  {
    locale: 'th',
    english: 'Pause motion',
    key: 'site.home.pauseMotion',
    approved: 'หยุดภาพเคลื่อนไหว',
  },
  {
    locale: 'zh',
    english: 'Anything else? (optional)',
    key: 'site.report.noteLabel',
    approved: '还有其他要补充的吗？（可选）',
  },
  {
    locale: 'zh',
    english: 'Student numbers',
    key: 'absentNumbersLabel',
    approved: '学生编号',
  },
  {
    locale: 'vi',
    english: 'Student numbers',
    key: 'absentNumbersLabel',
    approved: 'Mã học sinh',
  },
  {
    locale: 'th',
    english: 'Student numbers',
    key: 'absentNumbersLabel',
    approved: 'เลขประจำตัวนักเรียน',
  },
  {
    locale: 'zh',
    english: HELP,
    key: 'absentNumbersHelp',
    approved: '缺席学生的学生编号，用逗号分隔。',
  },
  {
    locale: 'vi',
    english: HELP,
    key: 'absentNumbersHelp',
    approved:
      'Mã học sinh của những học sinh vắng mặt, phân tách bằng dấu phẩy.',
  },
  {
    locale: 'th',
    english: HELP,
    key: 'absentNumbersHelp',
    approved: 'เลขประจำตัวนักเรียนของผู้ที่ขาดเรียน คั่นด้วยเครื่องหมายจุลภาค',
  },
];

const at = (root: unknown, path: string): unknown => {
  let here = root;
  for (const step of path.split('.')) {
    if (typeof here !== 'object' || here === null) return undefined;
    here = (here as Record<string, unknown>)[step];
  }
  return here;
};

describe('the DeepL cache holds the values the operator approved (#603)', () => {
  for (const correction of CORRECTIONS) {
    const { locale, english, key, approved, message } = correction;
    it(`${locale}: "${english}" is cached as approved, and ${key} renders it`, () => {
      // The cache is keyed by the live English, so a key that stopped naming
      // its English would leave the assertions below reading an entry nothing
      // renders.
      const liveEnglish = key.startsWith('site.')
        ? at(siteEn, key.slice('site.'.length))
        : at(en, key);
      if (message !== true) expect(liveEnglish).toBe(english);
      expect(CACHE[locale]?.[english]).toBe(approved);
      expect(
        at(
          key.startsWith('site.') ? getSiteStrings(locale) : PAGES[locale],
          key.startsWith('site.') ? key.slice('site.'.length) : key,
        ),
      ).toBe(approved);
    });
  }
});
