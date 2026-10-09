import { describe, it, expect } from 'vitest';
import { searched } from '../source-files';
import { floorBreach } from '../floors';
import { catalogueLeaves } from '../../src/lib/catalogue-leaves';
import {
  calculateGlory,
  formatNumber,
  ERRORS,
} from '../../src/lib/gloryPoints';
import {
  siteEn,
  siteId,
  siteZh,
  siteVi,
  siteTh,
} from '../../src/lib/i18n/site';

describe('calculateGlory — formula (verified against the ported Flask source)', () => {
  it.each([
    [1, 1, 2, 5],
    // 9/0.9 = 10 exactly: no rounding — catches always-round-up bugs. Also
    // pins the rate's DIRECTION: one bean converts to 0.9 coins, so 9 coins
    // cost 10 beans; a "0.9 beans per coin" formula would give 9 (#382).
    [9, 9, 10, 25],
    [10, 10, 12, 30],
    [100, 100, 112, 280],
    [1000, 1000, 1112, 2780],
  ])('points=%i -> coins=%i beans=%i gift=%i', (p, coins, beans, gift) => {
    const out = calculateGlory(String(p));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result).toEqual({
        gloryPoints: p,
        coinsNeeded: coins,
        beansNeeded: beans,
        totalGiftValue: gift,
      });
    }
  });
});

describe('calculateGlory — validation', () => {
  it.each(['', '   '])('empty/whitespace %j -> empty error', (v) => {
    expect(calculateGlory(v)).toEqual({ ok: false, error: ERRORS.empty });
  });
  it.each(['abc', '3.5', '1e3', '1,000', '+5', '-5', '5 5', '0x10'])(
    'non-digits %j -> notWhole error',
    (v) => {
      expect(calculateGlory(v)).toEqual({ ok: false, error: ERRORS.notWhole });
    },
  );
  it.each(['0', '00', '000'])('zero %j -> zero error', (v) => {
    expect(calculateGlory(v)).toEqual({ ok: false, error: ERRORS.zero });
  });
  it('trims surrounding whitespace around a valid value', () => {
    const out = calculateGlory('  10  ');
    expect(out.ok).toBe(true);
  });
});

describe('calculateGlory — upper bound (cap 1,000,000,000)', () => {
  it('accepts the cap and computes it exactly', () => {
    expect(calculateGlory('1000000000')).toEqual({
      ok: true,
      result: {
        gloryPoints: 1000000000,
        coinsNeeded: 1000000000,
        beansNeeded: 1111111112,
        totalGiftValue: 2777777780,
      },
    });
  });
  it('rejects one above the cap', () => {
    expect(calculateGlory('1000000001')).toEqual({
      ok: false,
      error: ERRORS.tooLarge,
    });
  });
});

describe('formatNumber', () => {
  it.each([
    [5, '5'],
    [280, '280'],
    [2780, '2,780'],
    [1000000, '1,000,000'],
  ])('English: %i -> %s', (n, s) => expect(formatNumber(n, 'en')).toBe(s));

  it.each([
    [5, '5'],
    [280, '280'],
    [2780, '2.780'],
    [1000000, '1.000.000'],
  ])('Indonesian: %i -> %s', (n, s) => expect(formatNumber(n, 'id')).toBe(s));

  it('does not print an Indonesian number in the English convention', () => {
    // In Indonesian "." groups thousands and "," is the decimal mark, so the
    // English rendering of 1112 reads to an Indonesian teacher as "one point
    // one one two". The static copy on the same page already writes "0,9
    // koin per bean" correctly, so the page was contradicting itself.
    expect(formatNumber(1112, 'id')).toBe('1.112');
    expect(formatNumber(1112, 'id')).not.toBe(formatNumber(1112, 'en'));
  });
});

describe('the assumptions line states the rate the formula uses (#382)', () => {
  // One bean converts to 0.9 coins. Every locale shipped the inverse, "0.9
  // beans per coin", while the formula divided by 0.9 correctly, so the page
  // described a calculation it does not do. Nothing pinned this sentence, and
  // no generic copy guard can: it was translated, non-blank and slot-perfect.
  it.each([
    [
      'en',
      siteEn,
      'Assumes 1 coin per point, 0.9 coins per bean, and gifts converting to beans at 40%.',
    ],
    [
      'id',
      siteId,
      'Mengasumsikan 1 koin per poin, 0,9 koin per bean, dan hadiah dikonversi ke bean sebesar 40%.',
    ],
    // #390, by operator decision (2026-09-30, "Keep app names in English"):
    // YeeTalk's own names, glory points and bean, stay in English as id's
    // always did; only the coin is a word of the page's language.
    [
      'zh',
      siteZh,
      '假设每 1 点需 1 枚金币，每个 bean 可兑换 0.9 枚金币，且礼物按 40% 的比例兑换成 bean。',
    ],
    [
      'vi',
      siteVi,
      'Giả định mỗi điểm tương ứng với 1 xu, mỗi bean tương ứng với 0,9 xu, và quà tặng được quy đổi thành bean theo tỷ lệ 40%.',
    ],
    [
      'th',
      siteTh,
      'สมมติว่า 1 คะแนนเท่ากับ 1 เหรียญ, 0.9 เหรียญต่อ bean และของขวัญจะถูกแปลงเป็น bean ในอัตรา 40%',
    ],
  ])('%s', (_locale, site, sentence) => {
    expect(site.calculators.glory.assumptions).toBe(sentence);
  });
});

describe('the result line reads in the page’s own language (#390)', () => {
  // zh, vi and th assigned `siteEn.calculators.glory.resultLine` itself, so every result
  // on those pages read "… coins → … beans → … total gift value". A function
  // is code, not a string, so no translation guard ever read it.
  it.each([
    ['en', siteEn, '1 coins → 2 beans → 3 total gift value'],
    ['id', siteId, '1 koin → 2 bean → 3 total nilai hadiah'],
    ['zh', siteZh, '1 金币 → 2 bean → 3 礼物总价值'],
    ['vi', siteVi, '1 xu → 2 bean → 3 tổng giá trị quà tặng'],
    ['th', siteTh, '1 เหรียญ → 2 bean → 3 มูลค่ารวมของของขวัญ'],
  ])('%s', (_locale, site, line) => {
    expect(site.calculators.glory.resultLine('1', '2', '3')).toBe(line);
  });

  it('no translated site catalogue reuses one of English’s functions', () => {
    // Derived, so a second function added to site.ts is covered the day it
    // appears: a translated locale that assigns English's own function
    // renders English, whatever its strings say.
    const functions = (table: unknown) =>
      catalogueLeaves(table).filter(([, value]) => typeof value === 'function');
    const english = new Map(functions(siteEn));
    // The population is every translated function judged, not English's
    // own: a reader blind to one locale's functions still sees every
    // English one.
    const judged = (
      [
        ['id', siteId],
        ['zh', siteZh],
        ['vi', siteVi],
        ['th', siteTh],
      ] as const
    ).flatMap(([locale, site]) =>
      functions(site).map(([path, fn]) => ({
        where: `${locale}: ${path}`,
        path,
        fn,
      })),
    );
    const reused = judged
      .filter(({ path, fn }) => english.get(path) === fn)
      .map(({ where }) => where);
    const translated = judged.map(({ where }) => where);
    expect(
      searched(reused, { of: translated, what: 'translated functions' }),
    ).toEqual([]);
    expect(
      floorBreach('glory-points/translated-functions', translated.length),
    ).toBeUndefined();
  });
});
