/**
 * The CSV format's language tables, one per site locale, and nothing else.
 *
 * Separate from `csv.ts` deliberately (design spec section 9, "Language"):
 * when a third locale arrives, the language question has ONE file to read
 * and one shape to fill in, rather than a set of literals scattered through
 * a parser. `csv.ts` never contains a header word or a value token.
 *
 * Everything here is copied verbatim from design spec section 9's own
 * table. Two invariants that table implies are asserted in
 * tests/unit/csv.test.ts rather than left to inspection, because no type can
 * state either one and both are load-bearing.
 * Both are asserted over every unordered PAIR of locales, derived from
 * `LOCALES` -- written against `en` and `id` by name, they covered one pair
 * of the ten once #22 shipped five languages:
 *
 *  - No two locales share a header word. `detectLocale` (Task 4) tells a
 *    file's language from its headers alone, so a word appearing in two
 *    tables would make a real file genuinely ambiguous. It is a design
 *    rule, not a coincidence of translation.
 *  - No token means two different things. Detection reads headers, but the
 *    parser reads values -- a `P` reading as female in one table and as
 *    male in another would mis-import a file that passed detection.
 *
 *    Note what this does NOT forbid: two locales may share a token that
 *    means the SAME thing, and four of them do. `M`/`F` is the correct sex
 *    token in English, Chinese, Vietnamese and Thai; only Indonesian
 *    differs (`L`/`P`). The original wording -- "they share no value" --
 *    was true of `en` and `id` by accident of translation, and enforcing it
 *    across five would reject correct data.
 *
 * The `# Class:` / `# Kelas:` comment carries the class name so it
 * round-trips (spec section 9), and is the ONE `#` line that is not
 * discarded -- see the parser's own doc comment for that rule.
 */

/**
 * The site's languages — RE-EXPORTED from `i18n`, never declared again here.
 *
 * A second union would be a second place to remember when a language is
 * added. Declared once, a NEW site locale makes `CSV_LOCALES` fail both the
 * type check (`npm run typecheck`, in CI since #115) and its own completeness
 * test below, rather than shipping a page whose export button has no table
 * to read.
 */
export type { Locale } from './i18n';
import type { Locale } from './i18n';

/**
 * The six roster columns, in the order they are written and read.
 *
 * A union of literal keys rather than a bare `string`, so `columns` below
 * cannot silently omit one or gain a seventh in one locale only -- the
 * closest this repo gets to a compile-time guarantee, backed by the
 * same-keys test.
 */
export type CsvColumn =
  'number' | 'name' | 'sex' | 'absent' | 'together' | 'apart';

export interface CsvLocale {
  /** The metadata line carrying the class name — the one `#` line kept. */
  classComment: string;
  /** Header word per column, in write order. */
  columns: Record<CsvColumn, string>;
  /**
   * Header words this locale USED to write, still accepted on import.
   *
   * A header word here is a PARSING TOKEN, not display copy: `parseRoster`
   * finds a column by it, and `at()` returns '' for a column it cannot find
   * -- silently, with no problem reported. So correcting a word without
   * keeping the old one readable would make every file a teacher had
   * already downloaded import with that column blank and no error shown.
   *
   * Declared beside the current word rather than special-cased in the
   * parser, so the parser stays a loop over a list and the history of a
   * column lives with the column.
   */
  supersededColumns?: Partial<Record<CsvColumn, readonly string[]>>;
  /** The two sex tokens. Blank always means unset, in both languages. */
  sex: { M: string; F: string };
  /** Absent is `absentYes`; present is blank OR `absentNo`. */
  absentYes: string;
  absentNo: string;
  /** The extra first column on an exported GROUPS file. */
  groupColumn: string;
  /**
   * The second metadata line on an exported GROUPS file, before the date:
   * `# Groups made 2026-08-06`.
   *
   * Design spec section 9 shows this line ONLY in English, so the
   * Indonesian wording is this stage's own translation -- a REVIEW
   * SURFACE, flagged rather than quietly shipped. It is in the table
   * rather than in `csv.ts` because leaving it English on an Indonesian
   * export would break this stage's own governing constraint ("the file
   * must match the language of the page -- headers AND values"), and a
   * literal in the serialiser is exactly how that happens unnoticed.
   */
  groupsMadeComment: string;
  /**
   * The last line of the template downloaded with no class list on screen,
   * written as a `#` comment like the two example rows above it — so it
   * imports as nothing whether or not a teacher deletes it.
   *
   * Here rather than in `i18n.ts` for the same reason as
   * `groupsMadeComment`: it is text inside a FILE, and the rule governing
   * this stage is that the file matches the language of the page. Keeping
   * every word the file contains in one table is what makes that checkable.
   */
  templateHint: string;
  /**
   * The word in a downloaded file's NAME, per design spec section 9's own
   * examples: `7B-class-list-2026-08-06.csv`.
   *
   * Folded in here by #22, from a second `Record<Locale, string>` table that
   * lived in `csv.ts`. Two tables keyed by locale are two places to remember
   * when a language is added, and this file already exists to hold every word
   * a CSV carries. `safeFilePart` keeps Unicode letters deliberately, so a
   * native-script slug is a filename, not a mangling.
   */
  fileName: Record<'class-list' | 'groups', string>;
}

export const CSV_LOCALES: Record<Locale, CsvLocale> = {
  en: {
    classComment: '# Class:',
    columns: {
      number: 'number',
      name: 'name',
      sex: 'sex',
      absent: 'absent',
      together: 'together',
      apart: 'apart',
    },
    sex: { M: 'M', F: 'F' },
    absentYes: 'yes',
    absentNo: 'no',
    groupColumn: 'group',
    groupsMadeComment: '# Groups made',
    templateHint: 'delete these two lines and type your own',
    fileName: { 'class-list': 'class-list', groups: 'groups' },
  },
  id: {
    classComment: '# Kelas:',
    columns: {
      number: 'nomor',
      name: 'nama',
      // Two words, with the space. The header is what a teacher sees in
      // Excel, so it is the natural Indonesian phrase and not a compacted
      // identifier -- the parser quotes and trims rather than the table
      // bending to make parsing easier.
      sex: 'jenis kelamin',
      absent: 'tidak hadir',
      together: 'bersama',
      apart: 'terpisah',
    },
    // L/P (laki-laki / perempuan), matching the roster table's own
    // `rosterSexMale`/`rosterSexFemale` on the Indonesian page -- a teacher
    // sees the same two letters in the tool and in the file.
    sex: { M: 'L', F: 'P' },
    absentYes: 'ya',
    absentNo: 'tidak',
    groupColumn: 'kelompok',
    groupsMadeComment: '# Kelompok dibuat',
    templateHint: 'hapus dua baris ini lalu ketik milik Anda sendiri',
    fileName: { 'class-list': 'daftar-kelas', groups: 'kelompok' },
  },
  zh: {
    // 班级, the page's own word for the class (#390): 类 read "Category:".
    classComment: '# 班级：',
    // M/F, matching this locale's own rosterSexMale/rosterSexFemale, which
    // tests/unit/csv.test.ts holds them to: both places change together.
    sex: { M: 'M', F: 'F' },
    columns: {
      number: '编号',
      name: '姓名',
      sex: '性别',
      absent: '缺席',
      together: '一起',
      apart: '分开',
    },
    // Written as these headers until #252 (name, sex) and #319 (number,
    // which read as "numeral") corrected them.
    supersededColumns: { number: ['数字'], name: ['名称'], sex: ['性'] },
    // 是/否, a form's yes/no (operator decision on #390; 不 until then).
    absentYes: '是',
    absentNo: '否',
    groupColumn: '组',
    groupsMadeComment: '# 已创建的组',
    templateHint: '删除这两行，然后输入你自己的内容',
    fileName: {
      'class-list': '班级名单',
      groups: '组',
    },
  },
  vi: {
    classComment: '# Lớp:',
    // M/F, matching this locale's own rosterSexMale/rosterSexFemale, which
    // tests/unit/csv.test.ts holds them to: both places change together.
    sex: { M: 'M', F: 'F' },
    columns: {
      number: 'số',
      name: 'tên',
      sex: 'giới tính',
      absent: 'vắng mặt',
      together: 'cùng nhau',
      apart: 'tách biệt',
    },
    // Written as the sex header until #252 corrected it, and as the apart
    // header until #161's sheet did.
    supersededColumns: { sex: ['tình dục'], apart: ['riêng biệt'] },
    // có/không, a form's yes/no (operator decision on #390; "đúng vậy",
    // "that's right", until then).
    absentYes: 'có',
    absentNo: 'không',
    groupColumn: 'nhóm',
    groupsMadeComment: '# Các nhóm đã được tạo',
    templateHint: 'Hãy xóa hai dòng này và nhập nội dung của riêng bạn',
    fileName: {
      'class-list': 'danh sách lớp',
      groups: 'nhóm',
    },
  },
  th: {
    classComment: '# ชั้นเรียน:',
    // M/F, matching this locale's own rosterSexMale/rosterSexFemale, which
    // tests/unit/csv.test.ts holds them to: both places change together.
    sex: { M: 'M', F: 'F' },
    columns: {
      number: 'หมายเลข',
      name: 'ชื่อ',
      sex: 'เพศ',
      absent: 'ไม่มา',
      together: 'ด้วยกัน',
      apart: 'แยกกัน',
    },
    // Written as the number header until #319 corrected it: ตัวเลข is a
    // numeral, หมายเลข a student's number.
    supersededColumns: { number: ['ตัวเลข'] },
    // ใช่/ไม่ใช่, a form's yes/no (operator decision on #390; ไม่ until then).
    absentYes: 'ใช่',
    absentNo: 'ไม่ใช่',
    groupColumn: 'กลุ่ม',
    groupsMadeComment: '# กลุ่มที่สร้างแล้ว',
    templateHint: 'ลบสองบรรทัดนี้แล้วพิมพ์ข้อความของคุณเอง',
    fileName: {
      'class-list': 'รายชื่อชั้น',
      groups: 'กลุ่ม',
    },
  },
};
