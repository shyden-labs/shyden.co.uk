import { describe, expect, it } from 'vitest';
import { DISSOLVED_COMPANY, dissolvedIn } from '../dissolved-company';
import { renderedText } from '../html-text';
import { searched } from '../source-files';
import { floorBreach } from '../floors';

/**
 * What the site printed about the company before #370, copied from
 * `494836b^` (src/lib/i18n/site.ts and src/components/Footer.astro). These
 * are the strings that must never reach a page again, so each must be caught,
 * and by exactly the forms written beside it: an entry no string needs was
 * removable with every test green (#390 F116, mutation DC1).
 * The two lists this replaces caught the English and Indonesian lines and
 * none of the Chinese, Vietnamese or Thai registration sentences (#390 F116).
 */
const PRINTED_BEFORE_370: ReadonlyArray<[string, string[]]> = [
  [
    'Shyden Ltd — a new technology company',
    ['Ltd', 'a new technology company'],
  ],
  ['A new company', ['A new company']],
  ['Registered in England & Wales.', ['England & Wales']],
  ['Company No.', ['Company No.']],
  ['Registered office:', ['Registered office']],
  [
    '71-75 Shelton Street, Covent Garden, London, United Kingdom, WC2H 9JQ',
    ['Shelton Street', 'WC2H 9JQ'],
  ],
  ['17110487', ['17110487']],
  [
    'Shyden Ltd — perusahaan teknologi baru',
    ['Ltd', 'perusahaan teknologi baru'],
  ],
  ['Perusahaan baru', ['Perusahaan baru']],
  ['Terdaftar di Inggris & Wales.', ['Terdaftar di Inggris']],
  ['No. Perusahaan', ['No. Perusahaan']],
  ['Kantor terdaftar:', ['Kantor terdaftar']],
  ['Shyden Ltd — 一家新的科技公司', ['Ltd', '一家新的科技公司']],
  ['一家新公司', ['一家新公司']],
  ['注册于England & Wales。', ['England & Wales', '注册于']],
  ['公司编号：', ['公司编号']],
  ['注册办事处：', ['注册办事处']],
  [
    'Shyden Ltd — một công ty công nghệ mới',
    ['Ltd', 'một công ty công nghệ mới'],
  ],
  ['Một công ty mới', ['Một công ty mới']],
  [
    'Được đăng ký tại England & Wales.',
    ['England & Wales', 'Được đăng ký tại'],
  ],
  ['Số đăng ký doanh nghiệp', ['Số đăng ký doanh nghiệp']],
  ['Trụ sở chính:', ['Trụ sở chính']],
  ['Shyden Ltd — บริษัทเทคโนโลยีน้องใหม่', ['Ltd', 'บริษัทเทคโนโลยีน้องใหม่']],
  ['บริษัทน้องใหม่', ['บริษัทน้องใหม่']],
  ['จดทะเบียนใน England & Wales', ['England & Wales', 'จดทะเบียนใน']],
  ['เลขทะเบียนบริษัท', ['เลขทะเบียนบริษัท']],
  ['สำนักงานจดทะเบียน:', ['สำนักงานจดทะเบียน']],
];

describe('dissolvedIn: every form the dissolved company was printed in', () => {
  it.each(PRINTED_BEFORE_370)('catches %s', (printed, forms) => {
    expect(dissolvedIn(printed)).toEqual(forms);
  });

  it('catches the registration line as served, ampersand escaped', () => {
    const served = '<p>注册于England &amp; Wales。</p>';
    expect(dissolvedIn(renderedText(served))).not.toEqual([]);
  });

  it.each([
    ['a title', '<head><title>Shyden Ltd</title></head>'],
    ['a meta tag', '<meta name="description" content="Company No. 17110487">'],
    [
      'visible text',
      '<footer><p>Registered office: Shelton Street</p></footer>',
    ],
    ['text served escaped', '<p>England &amp; Wales</p>'],
  ])('catches a form in %s of a built page', (_where, html) => {
    // The all-pages scan reads the whole served HTML, so a name in the head is
    // read like one in the body (#446).
    expect(dissolvedIn(renderedText(html))).not.toEqual([]);
  });

  it('reads Ltd as a word, not as letters inside one', () => {
    expect(
      searched(dissolvedIn('Altdorf and Ltda.'), {
        of: DISSOLVED_COMPANY,
        what: 'dissolved-company forms',
      }),
    ).toEqual([]);
    expect(dissolvedIn('Shyden Ltd.')).toEqual(['Ltd']);
    expect(
      floorBreach(
        'dissolved-company/forms-read-as-words',
        DISSOLVED_COMPANY.length,
      ),
    ).toBeUndefined();
  });

  it('passes the copy the site prints today', () => {
    expect(
      searched(
        dissolvedIn(
          'Built for teachers, by Shyden. Questions or problems? support@shyden.co.uk',
        ),
        { of: DISSOLVED_COMPANY, what: 'dissolved-company forms' },
      ),
    ).toEqual([]);
    expect(
      floorBreach(
        'dissolved-company/forms-read-against-current-copy',
        DISSOLVED_COMPANY.length,
      ),
    ).toBeUndefined();
  });
});
