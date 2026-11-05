/**
 * The dissolved company, in every form a page once printed it (#370; the
 * operator, 2026-09-27: the footer names no company, no number and no
 * registered office, in any language).
 *
 * ONE list. `chrome.spec.ts` (the footer, per locale) and
 * `copy-reaches-a-page.spec.ts` (every built page) each kept their own, they
 * had drifted ('Perusahaan' in one, 'Perusahaan baru' in the other), and
 * neither held a single Chinese, Vietnamese or Thai registration sentence:
 * both were written from the English and Indonesian copy (#390 F116). Each
 * entry is taken from what `494836b^` actually printed, and
 * `tests/unit/dissolved-company.test.ts` pins every one of those strings.
 *
 * Phrases, not bare words, because the all-pages scan reads five languages
 * of live copy, where `Registered` or `Perusahaan` alone can be ordinary
 * prose. `Ltd` is the one bare word, matched as a word.
 */
export const DISSOLVED_COMPANY: readonly string[] = [
  'Ltd',
  '17110487',
  'Shelton Street',
  'WC2H 9JQ',
  'England & Wales',
  'A new company',
  'a new technology company',
  'Registered office',
  'Company No.',
  'Perusahaan baru',
  'perusahaan teknologi baru',
  'Terdaftar di Inggris',
  'No. Perusahaan',
  'Kantor terdaftar',
  '一家新公司',
  '一家新的科技公司',
  '注册于',
  '公司编号',
  '注册办事处',
  'Một công ty mới',
  'một công ty công nghệ mới',
  'Được đăng ký tại',
  'Số đăng ký doanh nghiệp',
  'Trụ sở chính',
  'บริษัทน้องใหม่',
  'บริษัทเทคโนโลยีน้องใหม่',
  'จดทะเบียนใน',
  'เลขทะเบียนบริษัท',
  'สำนักงานจดทะเบียน',
];

const LATIN_WORD = /^[A-Za-z]+$/;

/**
 * Every dissolved-company form in `text`, as listed. Give it a reader's text,
 * so entities are decoded first: raw HTML serves `England &amp; Wales`.
 */
export const dissolvedIn = (text: string): string[] =>
  DISSOLVED_COMPANY.filter((form) =>
    LATIN_WORD.test(form)
      ? new RegExp(`\\b${form}\\b`).test(text)
      : text.includes(form),
  );
