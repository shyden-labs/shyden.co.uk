import { describe, it, expect } from 'vitest';
import {
  siteEn,
  siteId,
  siteZh,
  siteVi,
  siteTh,
} from '../../src/lib/i18n/site';

// The Gift Value calculator's rate note states the rates and the rounding the
// arithmetic uses (#636). A translated sentence can be non-blank and
// slot-perfect and still name the wrong rate, so each is pinned in full, as
// the Glory note is (#382). The site's own words stay as they are: glory
// points and bean in English, the coin in the page's language.
describe('the gift rate note states the rates and the rounding (#636)', () => {
  it.each([
    [
      'en',
      siteEn,
      'Assumes gifts convert to beans at 40% and each bean redeems for 0.9 coins, rounded down to whole beans and coins.',
    ],
    [
      'id',
      siteId,
      'Asumsinya, hadiah dikonversi menjadi bean dengan rasio 40%, dan setiap bean dapat ditukarkan dengan 0,9 koin, dengan jumlah bean dan koin dibulatkan ke bawah ke angka bulat.',
    ],
    [
      'zh',
      siteZh,
      '假设礼物按 40% 的比率转换为 bean，每个 bean 可兑换 0.9 枚金币，bean 和金币的数量均向下取整至整数。',
    ],
    [
      'vi',
      siteVi,
      'Giả định rằng quà tặng được quy đổi thành bean với tỷ lệ 40% và mỗi bean có thể đổi lấy 0,9 xu, số lượng bean và xu được làm tròn xuống thành số nguyên.',
    ],
    [
      'th',
      siteTh,
      'สมมติว่าของขวัญจะแปลงเป็น bean ในอัตรา 40% และแต่ละ bean แลกได้ 0.9 เหรียญ โดยจะปัดลงเป็นจำนวนเต็มของ bean และเหรียญ',
    ],
  ])('%s', (_locale, site, sentence) => {
    expect(site.calculators.gift.assumptions).toBe(sentence);
  });
});

// The slots arrive in the order gift, beans, coins in every language: a
// translated line that swapped two of them would print the beans where the
// coins belong.
describe('the gift result line reads gift, beans, coins in the page’s own language (#636)', () => {
  it.each([
    ['en', siteEn, '1 gift value → 2 beans → 3 coins'],
    ['id', siteId, '1 nilai hadiah → 2 bean → 3 koin'],
    ['zh', siteZh, '1 礼物价值 → 2 bean → 3 金币'],
    ['vi', siteVi, '1 giá trị quà tặng → 2 bean → 3 xu'],
    ['th', siteTh, '1 มูลค่าของขวัญ → 2 bean → 3 เหรียญ'],
  ])('%s', (_locale, site, line) => {
    expect(site.calculators.gift.resultLine('1', '2', '3')).toBe(line);
  });
});

describe('the gift section is named in the page’s own language (#636)', () => {
  it.each([
    ['en', siteEn, 'Gift Value Calculator', 'Gift value'],
    ['id', siteId, 'Kalkulator Nilai Hadiah', 'Nilai hadiah'],
    ['zh', siteZh, '礼物价值计算器', '礼物价值'],
    ['vi', siteVi, 'Máy tính giá trị quà tặng', 'Giá trị quà tặng'],
    ['th', siteTh, 'เครื่องคำนวณมูลค่าของขวัญ', 'มูลค่าของขวัญ'],
  ])('%s', (_locale, site, heading, label) => {
    expect(site.calculators.gift.heading).toBe(heading);
    expect(site.calculators.gift.inputLabel).toBe(label);
  });
});
