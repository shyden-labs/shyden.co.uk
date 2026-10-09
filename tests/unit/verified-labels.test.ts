import { describe, it, expect } from 'vitest';
import { nonEmpty, searched } from '../source-files';
import { floorBreach } from '../floors';
import { en, type Catalogue } from '../../src/lib/i18n/en';
import { id } from '../../src/lib/i18n/id';
import { zh } from '../../src/lib/i18n/zh';
import { vi } from '../../src/lib/i18n/vi';
import { th } from '../../src/lib/i18n/th';
import {
  DEFAULT_LOCALE,
  LOCALES,
  type Locale,
} from '../../src/lib/i18n/locales';
import { getSiteStrings } from '../../src/lib/i18n';
import { CSV_LOCALES } from '../../src/lib/csv-locale';
import { backTranslationUnits } from '../../src/lib/i18n/back-translate';
import { checkLabels } from '../../src/lib/i18n/label-check';

/**
 * The values of the roster's column labels, pinned to what the operator read
 * and approved.
 *
 * This file exists because four i18n guards ran over `vi.rosterColSex` for a
 * month and none of them could see what was wrong with it. It held
 * `Tinh duc` -- Vietnamese for sexual intercourse -- as the column heading
 * beside every pupil's name on a classroom roster. `locale-fallbacks` asks
 * "is this still English?" and it is not. `i18n` asks "is this blank?" and it
 * is not. `dead-copy` asks "does a page render it?" and one does.
 * `message-parity` asks "are the slots the same?" and there are none. A
 * string that is fully translated and WRONG answers every one of those
 * correctly, so the only question left is "is this the value we approved?",
 * and that question needs a literal pin.
 *
 * Machine translation fails this way on BARE LABELS specifically: a one-word
 * source carries no context to disambiguate its sense. The same catalogue's
 * prose was right all along -- `vi.ts` uses `gioi tinh` for this exact concept
 * in four sentences (lines 77, 79, 134 and 135) -- which is why reading the
 * surrounding copy never surfaced it.
 *
 * No native speaker is available and none is coming (operator, 2026-09-20),
 * so the operator's own read IS the verification of record. That makes this
 * table the record of it: changing a value here is changing what was signed
 * off, and it may not be done without a fresh operator read.
 *
 * Scope began as the roster column family, because #249 propagates these six
 * keys out of one table header and into the empty option of three dropdowns
 * on every row. #161 widened it. Every short label that disagreed with its
 * own locale's copy went to the operator on one sheet, and everything he
 * read there is pinned here: the 29 corrections he approved, the sentences
 * that came with them, and the values he chose to keep. Those keys are
 * spelled the way `backTranslationUnits` spells a path (`howToSteps[2]`,
 * `site.calculators.heading`, `csv.columns.apart`), so a flag and its pin name the
 * same copy. A CSV header word is a parsing token as well as copy (#252), so
 * correcting one keeps the old word readable: `supersededColumns`.
 *
 * #319 added every message its own sheet corrected, because the feature-word
 * check it built cannot hold them all: th `PINNED_TOO_MANY_GROUPS` said
 * `พินของคุณ` (your PINs) and passed, since `ปักหมุด` appears once in it.
 * Those entries carry their own comment, as the operator has not read them yet.
 */
const VERIFIED: Record<Locale, Record<string, string>> = {
  en: {
    rosterColNumber: '#',
    rosterColName: 'Name',
    rosterColSex: 'Sex',
    rosterColAbsent: 'Absent',
    rosterColTogether: 'Together',
    rosterColApart: 'Apart',
  },
  id: {
    rosterColNumber: '#',
    rosterColName: 'Nama',
    rosterColSex: 'Jenis kelamin',
    rosterColAbsent: 'Tidak hadir',
    rosterColTogether: 'Bersama',
    rosterColApart: 'Terpisah',
    // #161's sheet, read by the operator on 2026-09-23.
    'csv.columns.apart': 'terpisah',
    'csv.columns.together': 'bersama',
    keepApartLabel: 'Jangan bersama',
    modeLabel: 'Bagi berdasarkan',
    'site.home.opensAt': 'membuka',
    stateApart: '{n} dipisahkan',
    stateTogether: '{n} disatukan',
    // #319's sheet, applied unanswered under the operator's 2026-09-24
    // instruction to complete the board and review it once, at the end. His
    // read of these is due then and has not been given yet. A message is
    // pinned whole, so every branch of a select is held, not just the one
    // the sheet corrected.
    'errors.NO_STUDENTS':
      'Tambahkan siswa, atau pastikan tidak semuanya ditandai tidak hadir.',
    // #603's sheet, read by the operator on 2026-10-07 (every short label no
    // check could judge, https://claude.ai/artifact/AgCDjpCJ2AQkKmdSC4cznm).
    // Values are as they stand AFTER the twelve changes he agreed there.
    absentNumbersHelp:
      'Nomor siswa untuk setiap siswa yang tidak hadir, dipisahkan dengan koma.',
    absentNumbersLabel: 'Nomor siswa',
    boardExit: 'Keluar dari layar penuh',
    classLabel: 'Kelas (opsional)',
    'csv.absentYes': 'ya',
    'csv.groupsMadeComment': '# Kelompok dibuat',
    'csvLanguageName.id': 'bahasa Indonesia',
    'csvLanguageName.th': 'bahasa Thai',
    'csvLanguageName.vi': 'bahasa Vietnam',
    'csvLanguageName.zh': 'bahasa Mandarin',
    'csvLanguageVersion.th': 'bahasa Thai',
    'csvLanguageVersion.vi': 'bahasa Vietnam',
    'csvLanguageVersion.zh': 'bahasa Mandarin',
    groupCountLabel: 'Berapa banyak kelompok',
    heading: 'Pembuat Kelompok Kelas',
    'howToSteps[2]': 'Tekan Buat Kelompok.',
    ioDownloadTemplate: 'Unduh templat',
    ioExportClassList: 'Ekspor daftar kelas',
    ioExportGroups: 'Ekspor kelompok',
    ioImported: '{total} siswa diimpor.',
    ioReplaceConfirm: 'Ganti',
    keepTogetherLabel: 'Selalu bersama',
    modePerGroup: 'Siswa per kelompok',
    printCancel: 'Batal',
    printIncludeAvatars: 'Sertakan avatar',
    printWhat: 'Apa yang dicetak',
    printWhatBoth: 'Keduanya',
    printWhatGroups: 'Hasil kelompok',
    printedOn: 'Dicetak {on}',
    resultsHeading: 'Kelompok Anda',
    resultsHeadingNamed: '{className} — kelompok Anda',
    resultsSummary: '{groups} kelompok dari {students} siswa.',
    rosterAddSeveral: '+ Tambah beberapa…',
    rosterAddStudent: '+ Tambah siswa',
    rosterClearAll: 'Hapus semua',
    rosterCountLine: '{total} siswa · {here} hadir · {absent} tidak hadir',
    sectionGroupingHeading: 'Opsi pengelompokan',
    sectionImportExportHeading: 'Impor / ekspor',
    sectionSoundHeading: 'Suara dan animasi',
    'site.calculators.forYeetalk': 'Untuk YeeTalk ↗',
    'site.home.emailUs': 'Kirim email',
    'site.home.exploreShytalk': 'Jelajahi ShyTalk',
    'site.home.exploreYaweloIdle': 'Jelajahi Yawelo Idle',
    'site.home.pauseMotion': 'Jeda gerakan',
    'site.home.shytalkKicker': 'Belajar dengan berbicara',
    'site.home.toolBadge': 'Aktif sekarang',
    'site.home.workClassroomTitle': 'Pembuat Kelompok Kelas',
    'site.home.yaweloIdleKicker': 'Belajar dengan bermain',
    'site.language.betaLabel': 'terjemahan beta',
    'site.menuLabel': 'Buka atau tutup menu navigasi',
    'site.report.noteLabel': 'Ada hal lain? (opsional)',
    'site.report.send': 'Kirim laporan',
    'site.skipToContent': 'Lewati ke konten',
    'site.themeDarkMode': 'Mode gelap',
    soundOff: 'Suara mati',
    soundOn: 'Suara aktif',
    speedFast: 'Cepat',
    speedLabel: 'Kecepatan',
    speedSkip: 'Lewati animasi',
    stateMixed: 'dicampur berdasarkan jenis kelamin',
    stateNoneAdded: 'tidak ada yang ditambahkan',
    stateSeparated: 'dipisah berdasarkan jenis kelamin',
    title: 'Pembuat Kelompok Kelas',
  },
  zh: {
    rosterColNumber: '#',
    rosterColName: '姓名',
    rosterColSex: '性别',
    rosterColAbsent: '缺席',
    rosterColTogether: '在一起',
    rosterColApart: '分开',
    // #161's sheet, read by the operator on 2026-09-23.
    again: '重新洗牌',
    boardShuffle: '重新洗牌',
    'csv.columns.apart': '分开',
    'csv.columns.name': '姓名',
    'errors.KEEP_APART_SEARCH_GAVE_UP':
      '这里的“分开”规则太多，难以逐一处理。试着删除其中一些吧。',
    howToHeading: '使用方法',
    'howToSteps[2]': '点击“开始分组”。',
    ioReplaceWarning:
      '这将取代您当前的班级名单——{total}名学生，其中{named}名已命名。',
    keepApartLabel: '分开',
    makeGroups: '开始分组',
    modeGroupCount: '组数',
    resultsHeading: '您的分组',
    resultsHeadingNamed: '{className} — 您的分组',
    stateAdded: '{n} 已添加',
    stateApart: '{n} 分开',
    stateNamed: '{n} 已命名',
    stateNone: '无',
    // #319's sheet, applied unanswered under the operator's 2026-09-24
    // instruction to complete the board and review it once, at the end. His
    // read of these is due then and has not been given yet. A message is
    // pinned whole, so every branch of a select is held, not just the one
    // the sheet corrected.
    'csv.columns.number': '编号',
    csvProblemAbsent:
      "行 {row} — 缺席 '{value}' 无法识别。请使用 {accepted}，或留空。",
    csvProblemNoNumberColumn: '该文件中没有编号列。每个学生都需要一个编号。',
    csvProblemNumberNotWhole: "行 {row} — 编号 '{value}' 不是整数。",
    csvWrongLanguage:
      '这看起来像是一份 {language} 班级名单。请打开该页面的 {version} 版本以导入它。',
    'errors.BOTH_RULES_NO_ARRANGEMENT':
      '无法将你的班级分成 {groupsTried} 个小组，同时满足所有“在一起”字母和所有“分开”字母。系统无法判断是哪一类规则造成了问题，因此请尝试以下任一方法：扩大小组，或者把某个“在一起”字母分配给更少的学生；或者增加小组数量，或者取消其中一条“分开”规则。',
    'errors.BOTH_RULES_SEARCH_GAVE_UP':
      '这里的“在一起”和“分开”字母太多，无法一次全部处理。请尝试减少任一类字母的数量，或者扩大小组。',
    'errors.KEEP_APART_NO_ARRANGEMENT':
      '无法将你的班级分成 {groupsTried} 个小组，同时把所有需要分开的学生都分到不同组。要么增加小组数量，要么取消其中一条规则。',
    'errors.NO_STUDENTS':
      '添加一些学生，或者确保其中至少有一人未被标记为缺席。',
    'errors.PINNED_APART_CLASH':
      '{names} 已被标记为“分开”，但一个固定的组把他们放进了同一组。请取消固定该组，或从其中一人身上移除“分开”字母。',
    'errors.PINNED_TOO_MANY_GROUPS':
      '{situation, select, over {您固定的组已占用 {pinnedGroupCount} 个组——超过了您要求的 {requestedGroups} 个组——导致 {remainingStudents} 名学生无组可去。请取消固定一个组，或者增加组数。} full {您固定的组已占满您要求的 {requestedGroups} 个组中的 {pinnedGroupCount} 个，剩下的 {remainingStudents} 名学生已无组可去。请取消固定一个组，或者增加组数。} other {您已将所请求的 {requestedGroups} 个小组中的 {pinnedGroupCount} 个小组固定，这意味着只剩下 {remainingStudents} 名学生——这不足以组成仍需的 {poolGroupsNeeded} 个小组。请取消固定一个小组，或者减少请求的小组数量。}}',
    'errors.SEX_SEPARATE_SEARCH_GAVE_UP':
      '这里的“在一起”和“分开”字母太多，无法在把男孩和女孩分到不同组的同时完成分组。请尝试减少字母数量，或者关闭此模式。',
    'errors.SEX_SEPARATE_SPLITS_UNIT':
      '{names} 已被标记为“在一起”，但并非全是同一性别，因此无法组成单一性别的小组。请从其中一人身上移除“在一起”字母，或关闭此模式。',
    'errors.TOGETHER_SEARCH_GAVE_UP':
      '这里的“在一起”字母太多，难以逐一处理。请尝试减少字母数量，或者扩大小组。',
    'errors.TOGETHER_UNIT_TOO_LARGE':
      '有 {unit} 名学生带有字母“{letter}”，但这里最大的小组只能容纳 {groupSize} 人。请扩大小组规模，或者把字母“{letter}”分配给更少的学生。',
    'howToSteps[1]': '选择如何给他们分组。',
    leftoversBunch: '把他们全都放进同一个组',
    leftoversSpread: '把他们平均分到各组',
    printWhatGroups: '分组结果',
    rosterClashMessage: '{names} 被放在一起，因此无法再把他们分开。',
    'warnings.PINNED_MIXED_SEX':
      '{names} 被一起固定在同一组里，但他们并非全是同一性别，因此这个组没有像其他组那样按性别划分。这正是固定分组所要求的，并不是需要更正的错误。',
    // #390: the CSV yes/no tokens, chosen by the operator on 2026-09-30
    // ("Change all three"): 否, a form's no, where 不 was.
    'csv.absentNo': '否',
    // #603's sheet, read by the operator on 2026-10-07 (every short label no
    // check could judge, https://claude.ai/artifact/AgCDjpCJ2AQkKmdSC4cznm).
    // Values are as they stand AFTER the twelve changes he agreed there.
    absentNumbersHelp: '缺席学生的学生编号，用逗号分隔。',
    absentNumbersLabel: '学生编号',
    boardExit: '退出全屏模式',
    classLabel: '班级（可选）',
    'csv.absentYes': '是',
    'csv.groupsMadeComment': '# 已创建的组',
    'csvLanguageName.id': '印尼语',
    'csvLanguageName.th': '泰语',
    'csvLanguageName.vi': '越南语',
    'csvLanguageName.zh': '中文',
    'csvLanguageVersion.th': '泰语',
    'csvLanguageVersion.vi': '越南语',
    'csvLanguageVersion.zh': '中文',
    groupCountLabel: '有多少个小组',
    heading: '课堂小组创建器',
    ioDownloadTemplate: '下载模板',
    ioExportClassList: '导出班级名单',
    ioExportGroups: '导出分组',
    ioImported: '已导入 {total} 名学生。',
    ioReplaceConfirm: '替换它',
    keepTogetherLabel: '同组',
    modePerGroup: '每组学生人数',
    printCancel: '取消',
    printIncludeAvatars: '包含头像',
    printWhat: '打印内容',
    printWhatBoth: '两者',
    printedOn: '打印于 {on}',
    resultsSummary: '{groups} 个小组，由 {students} 名学生组成。',
    rosterAddSeveral: '+ 添加几个……',
    rosterAddStudent: '+ 添加学生',
    rosterClearAll: '清除全部',
    rosterCountLine: '{total} 名学生 · {here} 在场 · {absent} 缺席',
    sectionGroupingHeading: '分组选项',
    sectionImportExportHeading: '导入 / 导出',
    sectionSoundHeading: '声音和动画',
    'site.calculators.forYeetalk': '适用于 YeeTalk ↗',
    'site.home.emailUs': '给我们发邮件',
    'site.home.exploreShytalk': '了解 ShyTalk',
    'site.home.exploreYaweloIdle': '了解 Yawelo Idle',
    'site.home.pauseMotion': '暂停动画',
    'site.home.shytalkKicker': '通过交谈学习',
    'site.home.toolBadge': '已上线',
    'site.home.workClassroomTitle': '课堂小组创建器',
    'site.home.yaweloIdleKicker': '通过游戏学习',
    'site.language.betaLabel': '测试版翻译',
    'site.menuLabel': '切换导航菜单',
    'site.report.noteLabel': '还有其他要补充的吗？（可选）',
    'site.report.send': '发送报告',
    'site.skipToContent': '跳转至正文',
    'site.themeDarkMode': '深色模式',
    soundOff: '声音：关',
    soundOn: '声音：开',
    speedFast: '快',
    speedLabel: '速度',
    speedNormal: '正常',
    speedSkip: '跳过动画',
    stateMixed: '男女平均分配',
    stateNoneAdded: '未添加',
    stateSeparated: '按性别划分',
    title: '课堂小组创建器',
  },
  vi: {
    rosterColNumber: '#',
    rosterColName: 'Tên',
    rosterColSex: 'Giới tính',
    rosterColAbsent: 'Vắng mặt',
    rosterColTogether: 'Cùng nhau',
    rosterColApart: 'Tách biệt',
    // #161's sheet, read by the operator on 2026-09-23.
    'csv.columns.apart': 'tách biệt',
    'errors.KEEP_APART_SEARCH_GAVE_UP':
      'Ở đây có quá nhiều quy tắc xếp khác nhóm, khó mà xử lý hết được. Hãy thử loại bỏ một số quy tắc trong số đó.',
    ioReplaceWarning:
      'Danh sách này sẽ thay thế danh sách lớp hiện tại của bạn — {total} học sinh, {named} em đã có tên.',
    keepApartLabel: 'Xếp khác nhóm',
    modeLabel: 'Phân chia theo',
    sectionStudentsHeading: 'Thông tin học sinh',
    'site.calculators.glory.heading': 'Máy tính Glory Points',
    stateAdded: '{n} đã được thêm vào',
    stateApart: '{n} tách biệt',
    stateNamed: '{n} đã có tên',
    stateNone: 'không có',
    // #319's sheet, applied unanswered under the operator's 2026-09-24
    // instruction to complete the board and review it once, at the end. His
    // read of these is due then and has not been given yet. A message is
    // pinned whole, so every branch of a select is held, not just the one
    // the sheet corrected.
    csvProblemAbsent:
      "Dòng {row} — vắng mặt '{value}' không được nhận diện. Hãy sử dụng {accepted} hoặc để trống.",
    csvProblemNoNumberColumn:
      'Tệp này không có cột số. Mỗi học sinh cần có số thứ tự.',
    'errors.BOTH_RULES_NO_ARRANGEMENT':
      'Không có cách nào để chia lớp của bạn thành {groupsTried} nhóm mà vẫn đáp ứng đồng thời mọi chữ cái “cùng nhau” và mọi chữ cái “tách biệt”. Quá trình tìm kiếm không thể xác định được loại quy tắc nào gây ra vấn đề, vì vậy hãy thử một trong hai cách: tăng quy mô các nhóm hoặc gán một chữ cái “cùng nhau” cho ít học sinh hơn; hoặc tạo thêm nhóm hoặc bỏ một trong các quy tắc “tách biệt”.',
    'errors.BOTH_RULES_SEARCH_GAVE_UP':
      'Ở đây có quá nhiều chữ cái “cùng nhau” và “tách biệt” để có thể xử lý hết cùng một lúc. Hãy thử dùng ít chữ cái hơn ở cả hai loại, hoặc tăng quy mô các nhóm.',
    'errors.KEEP_APART_NO_ARRANGEMENT':
      'Không có cách nào để chia lớp của bạn thành {groupsTried} nhóm mà vẫn tách biệt tất cả những học sinh cần được tách biệt. Hãy tạo thêm nhóm hoặc loại bỏ một trong các quy tắc.',
    'errors.PINNED_APART_CLASH':
      '{names} đã được đánh dấu “tách biệt” với nhau, nhưng một nhóm được ghim lại xếp các em vào cùng một nhóm. Hãy bỏ ghim nhóm đó, hoặc gỡ chữ cái “tách biệt” khỏi một trong số các em.',
    'errors.PINNED_TOO_MANY_GROUPS':
      '{situation, select, over {Các nhóm bạn đã ghim hiện đã dùng {pinnedGroupCount} nhóm — nhiều hơn số {requestedGroups} nhóm mà bạn đã yêu cầu — khiến {remainingStudents} học sinh không còn nhóm nào dành cho mình. Hãy bỏ ghim một nhóm hoặc yêu cầu thêm nhóm.} full {Các nhóm bạn đã ghim hiện đã chiếm {pinnedGroupCount} trong tổng số {requestedGroups} nhóm mà bạn đã yêu cầu, nên {remainingStudents} học sinh còn lại không còn nhóm nào dành cho mình. Hãy bỏ ghim một nhóm hoặc yêu cầu thêm nhóm.} other {Các nhóm bạn đã ghim đã chiếm {pinnedGroupCount} trong số {requestedGroups} nhóm mà bạn yêu cầu, do đó chỉ còn lại {remainingStudents} học sinh — con số này không đủ để tạo {poolGroupsNeeded} nhóm còn thiếu. Hãy bỏ ghim một nhóm hoặc yêu cầu ít nhóm hơn.}}',
    'errors.SEX_SEPARATE_SEARCH_GAVE_UP':
      'Ở đây có quá nhiều chữ cái “cùng nhau” và “tách biệt” để xử lý hết trong khi vẫn phải xếp nam và nữ vào các nhóm riêng. Hãy thử dùng ít chữ cái hơn hoặc tắt chế độ này đi.',
    'errors.TOGETHER_APART_CLASH':
      '{names} được đánh dấu để vừa ở cùng nhau, vừa phải tách biệt khỏi nhau. Hãy loại bỏ chữ cái biểu thị “ở cùng nhau” hoặc chữ cái biểu thị “tách biệt” khỏi một trong số các em.',
    'errors.TOGETHER_SEARCH_GAVE_UP':
      'Ở đây có quá nhiều chữ cái “cùng nhau” nên không thể xử lý hết. Hãy thử dùng ít chữ cái hơn, hoặc tăng quy mô các nhóm.',
    'howToSteps[1]': 'Hãy chọn cách chia nhóm cho các em.',
    leftoversSpread: 'Chia đều các em vào các nhóm',
    printShowLetters:
      'Hiển thị giới tính và các chữ cái "cùng nhau"/"tách biệt"',
    rosterClashMessage:
      '{names} được xếp cùng nhau, nên không thể đồng thời tách biệt các em.',
    'warnings.PINNED_MIXED_SEX':
      '{names} được ghim cùng nhau thành một nhóm, nhưng không phải tất cả đều cùng giới tính, nên nhóm này không được chia theo giới tính như các nhóm khác. Đó chính là điều bạn yêu cầu khi ghim nhóm, chứ không phải là một sai sót cần sửa.',
    // #603's sheet, read by the operator on 2026-10-07 (every short label no
    // check could judge, https://claude.ai/artifact/AgCDjpCJ2AQkKmdSC4cznm).
    // Values are as they stand AFTER the twelve changes he agreed there.
    absentNumbersHelp:
      'Mã học sinh của những học sinh vắng mặt, phân tách bằng dấu phẩy.',
    absentNumbersLabel: 'Mã học sinh',
    boardExit: 'Thoát chế độ toàn màn hình',
    classLabel: 'Lớp (tùy chọn)',
    'csv.absentYes': 'có',
    'csv.groupsMadeComment': '# Các nhóm đã được tạo',
    'csvLanguageName.id': 'Tiếng Indonesia',
    'csvLanguageName.th': 'Tiếng Thái',
    'csvLanguageName.vi': 'Tiếng Việt',
    'csvLanguageName.zh': 'Tiếng Trung',
    'csvLanguageVersion.th': 'Tiếng Thái',
    'csvLanguageVersion.vi': 'Tiếng Việt',
    'csvLanguageVersion.zh': 'Tiếng Trung',
    groupCountLabel: 'Có bao nhiêu nhóm',
    heading: 'Trình tạo nhóm trong lớp học',
    'howToSteps[2]': 'Nhấn vào “Tạo nhóm”.',
    ioDownloadTemplate: 'Tải xuống mẫu',
    ioExportClassList: 'Xuất danh sách lớp',
    ioExportGroups: 'Xuất nhóm',
    ioImported: 'Đã nhập {total} học sinh.',
    ioReplaceConfirm: 'Thay thế nó',
    keepTogetherLabel: 'Xếp cùng nhóm',
    modePerGroup: 'Số học sinh trong mỗi nhóm',
    printCancel: 'Hủy',
    printIncludeAvatars: 'Thêm ảnh đại diện',
    printWhat: 'Nội dung cần in',
    printWhatBoth: 'Cả hai',
    printWhatGroups: 'Kết quả chia nhóm',
    printedOn: 'In ngày {on}',
    resultsHeading: 'Các nhóm của bạn',
    resultsHeadingNamed: '{className} — các nhóm của bạn',
    resultsSummary: '{groups} nhóm từ {students} học sinh.',
    rosterAddSeveral: '+ Thêm một vài…',
    rosterAddStudent: '+ Thêm học sinh',
    rosterClearAll: 'Xóa tất cả',
    rosterCountLine: '{total} học sinh · {here} có mặt · {absent} vắng mặt',
    sectionGroupingHeading: 'Các tùy chọn phân nhóm',
    sectionImportExportHeading: 'Nhập / xuất',
    sectionSoundHeading: 'Âm thanh và hoạt ảnh',
    'site.calculators.forYeetalk': 'Dành cho YeeTalk ↗',
    'site.home.emailUs': 'Gửi email cho chúng tôi',
    'site.home.exploreShytalk': 'Khám phá ShyTalk',
    'site.home.exploreYaweloIdle': 'Khám phá Yawelo Idle',
    'site.home.pauseMotion': 'Tạm dừng chuyển động',
    'site.home.shytalkKicker': 'Học qua giao tiếp',
    'site.home.toolBadge': 'Đang hoạt động',
    'site.home.workClassroomTitle': 'Trình tạo nhóm trong lớp học',
    'site.home.yaweloIdleKicker': 'Học qua trò chơi',
    'site.language.betaLabel': 'bản dịch beta',
    'site.menuLabel': 'Mở hoặc đóng menu điều hướng',
    'site.report.noteLabel': 'Còn điều gì khác không? (không bắt buộc)',
    'site.report.send': 'Gửi báo cáo',
    'site.skipToContent': 'Chuyển thẳng đến nội dung',
    'site.themeDarkMode': 'Chế độ tối',
    soundOff: 'Tắt âm thanh',
    soundOn: 'Bật âm thanh',
    speedFast: 'Nhanh',
    speedLabel: 'Tốc độ',
    speedNormal: 'Bình thường',
    speedSkip: 'Bỏ qua hoạt ảnh',
    stateMixed: 'nam và nữ cân bằng',
    stateNoneAdded: 'chưa có mục nào được thêm vào',
    stateSeparated: 'phân chia theo giới tính',
    title: 'Trình tạo nhóm trong lớp học',
  },
  th: {
    rosterColNumber: '#',
    rosterColName: 'ชื่อ',
    rosterColSex: 'เพศ',
    rosterColAbsent: 'ไม่มา',
    rosterColTogether: 'ด้วยกัน',
    rosterColApart: 'แยก',
    // #161's sheet, read by the operator on 2026-09-23.
    again: 'สับใหม่',
    boardOpen: 'เต็มหน้าจอ',
    boardShuffle: 'สับใหม่',
    'csv.columns.absent': 'ไม่มา',
    'csv.columns.apart': 'แยกกัน',
    'csv.columns.together': 'ด้วยกัน',
    'csv.fileName.class-list': 'รายชื่อชั้น',
    'errors.KEEP_APART_SEARCH_GAVE_UP':
      'มีกฎ “ให้อยู่คนละกลุ่ม” มากเกินไปจนยากที่จะปฏิบัติตาม ลองลบออกบางส่วนดู',
    keepApartLabel: 'ให้อยู่คนละกลุ่ม',
    printClassListHeading: 'รายชื่อนักเรียน',
    printWhatClassList: 'รายชื่อนักเรียน',
    rosterAbsentPill: 'ไม่มา',
    'site.calculators.glory.heading': 'เครื่องคำนวณ Glory Points',
    stateAbsent: '{n} ไม่มา',
    stateAdded: '{n} ได้เพิ่มแล้ว',
    stateApart: '{n} แยกกัน',
    stateTogether: '{n} ด้วยกัน',
    // #319's sheet, applied unanswered under the operator's 2026-09-24
    // instruction to complete the board and review it once, at the end. His
    // read of these is due then and has not been given yet. A message is
    // pinned whole, so every branch of a select is held, not just the one
    // the sheet corrected.
    'csv.columns.number': 'หมายเลข',
    csvProblemAbsent:
      "แถว {row} — ไม่เข้าใจค่า '{value}' สำหรับการขาดเรียน ใช้ {accepted} หรือทิ้งว่างไว้",
    csvProblemDuplicateNumber:
      'แถว {row} — หมายเลข {value} ถูกใช้แล้วโดยแถว {firstRow}',
    csvProblemNoNumberColumn:
      'ไฟล์นี้ไม่มีคอลัมน์หมายเลข นักเรียนทุกคนต้องมีหมายเลข',
    csvProblemNumberBlank:
      'แถว {row} — ไม่ได้ใส่หมายเลข นักเรียนทุกคนต้องมีหมายเลข',
    csvProblemNumberNotWhole: "แถว {row} — หมายเลข '{value}' ไม่ใช่จำนวนเต็ม",
    'errors.BOTH_RULES_NO_ARRANGEMENT':
      'ไม่มีวิธีใดที่จะจัดนักเรียนในชั้นของคุณให้เข้าอยู่ใน {groupsTried} กลุ่มได้ โดยยังคงทำตามตัวอักษร "ด้วยกัน" และตัวอักษร "แยก" ทั้งหมดในเวลาเดียวกัน การค้นหาไม่สามารถระบุได้ว่ากฎประเภทใดเป็นปัญหา ดังนั้นลองใช้วิธีแก้ไขอย่างใดอย่างหนึ่งต่อไปนี้: ขยายขนาดกลุ่มให้ใหญ่ขึ้น หรือให้ตัวอักษร "ด้วยกัน" กับนักเรียนจำนวนน้อยลง หรือสร้างกลุ่มเพิ่มเติม หรือยกเลิกกฎ "แยก" หนึ่งข้อ',
    'errors.BOTH_RULES_SEARCH_GAVE_UP':
      'ที่นี่มีตัวอักษร "ด้วยกัน" และ "แยก" มากเกินไปจนไม่สามารถจัดการได้ทั้งหมดในครั้งเดียว ลองใช้ตัวอักษรประเภทใดประเภทหนึ่งให้น้อยลง หรือเพิ่มขนาดกลุ่มให้ใหญ่ขึ้น',
    'errors.KEEP_APART_NO_ARRANGEMENT':
      'ไม่มีทางที่จะจัดชั้นเรียนของคุณให้เข้าอยู่ใน {groupsTried} กลุ่มได้ โดยยังคงแยกทุกคนที่ต้องแยกกันให้อยู่คนละกลุ่ม ดังนั้น คุณต้องเพิ่มจำนวนกลุ่มให้มากขึ้น หรือยกเลิกกฎข้อใดข้อหนึ่ง',
    'errors.PINNED_APART_CLASH':
      '{names} ถูกทำเครื่องหมายให้แยกกัน แต่กลุ่มที่ปักหมุดไว้ทำให้พวกเขาอยู่ในกลุ่มเดียวกัน ให้เลิกปักหมุดกลุ่มนั้น หรือลบตัวอักษร "แยก" ออกจากนักเรียนคนใดคนหนึ่ง',
    'errors.PINNED_IN_TWO_GROUPS':
      '{name} ถูกปักหมุดไว้ในสองกลุ่มที่แตกต่างกันพร้อมกัน นักเรียนหนึ่งคนปักหมุดไว้ได้เพียงกลุ่มเดียวเท่านั้น โปรดนำชื่อเขา/เธอออกจากกลุ่มใดกลุ่มหนึ่ง',
    'errors.PINNED_SPLITS_UNIT':
      '{names} ถูกทำเครื่องหมายให้อยู่ด้วยกัน แต่มีเพียงบางคนเท่านั้นที่อยู่ในกลุ่มที่ปักหมุดไว้ ให้เลิกปักหมุดกลุ่มนั้น หรือลบตัวอักษร "ด้วยกัน" ออกจากนักเรียนที่อยู่นอกกลุ่ม',
    'errors.PINNED_TOO_MANY_GROUPS':
      '{situation, select, over {กลุ่มที่คุณปักหมุดไว้ใช้ไปแล้ว {pinnedGroupCount} กลุ่ม — มากกว่า {requestedGroups} กลุ่มที่คุณขอ — ซึ่งทำให้นักเรียน {remainingStudents} คนไม่มีกลุ่มเหลือให้เข้าร่วม โปรดเลิกปักหมุดกลุ่มหนึ่ง หรือขอเพิ่มกลุ่มอีก} full {กลุ่มที่คุณปักหมุดไว้เต็มแล้ว {pinnedGroupCount} จาก {requestedGroups} กลุ่มที่คุณขอ ทำให้นักเรียนที่เหลือ {remainingStudents} คนไม่มีกลุ่มให้เข้าร่วม โปรดเลิกปักหมุดกลุ่มหนึ่ง หรือขอเพิ่มกลุ่มอีก} other {กลุ่มที่คุณปักหมุดไว้เต็มแล้ว {pinnedGroupCount} จาก {requestedGroups} กลุ่มที่คุณขอ เหลือนักเรียนเพียง {remainingStudents} คน — ไม่พอสำหรับ {poolGroupsNeeded} กลุ่มที่ยังต้องจัด โปรดเลิกปักหมุดกลุ่มหนึ่ง หรือขอลดจำนวนกลุ่มลง}}',
    'errors.SEX_SEPARATE_SEARCH_GAVE_UP':
      'ที่นี่มีตัวอักษร "ด้วยกัน" และ "แยก" มากเกินไปจนไม่สามารถจัดการได้ พร้อมกับต้องแบ่งเด็กชายและเด็กหญิงเป็นกลุ่มต่างกัน ลองใช้ตัวอักษรน้อยลง หรือปิดโหมดนี้ไป',
    'errors.SEX_SEPARATE_SPLITS_UNIT':
      '{names} ถูกทำเครื่องหมายให้อยู่ด้วยกัน แต่ไม่ใช่ทั้งหมดเป็นเพศเดียวกัน จึงไม่สามารถจัดเป็นกลุ่มที่มีเพศเดียวได้ โปรดลบตัวอักษร "ด้วยกัน" ออกจากนักเรียนคนใดคนหนึ่ง หรือปิดโหมดนี้',
    'errors.TOGETHER_NO_ARRANGEMENT':
      'ไม่มีวิธีใดที่จะจัดชั้นเรียนของคุณให้เข้าอยู่ใน {groupsTried} กลุ่มได้ โดยยังคงให้ทุกคนที่จำเป็นต้องอยู่ด้วยกันอยู่ด้วยกันได้ ให้ขยายขนาดกลุ่มให้ใหญ่ขึ้น หรือให้ตัวอักษรแต่ละตัวกับนักเรียนจำนวนน้อยลง',
    'errors.TOGETHER_SEARCH_GAVE_UP':
      'ที่นี่มีตัวอักษร "ด้วยกัน" มากเกินไปจนไม่สามารถจัดการได้ทั้งหมด ลองใช้ตัวอักษรให้น้อยลง หรือเพิ่มขนาดกลุ่มให้ใหญ่ขึ้น',
    'howToSteps[1]': 'เลือกวิธีแบ่งกลุ่มนักเรียน',
    ioReplaceWarning:
      'ข้อมูลนี้จะแทนที่รายชื่อนักเรียนปัจจุบันของคุณ — นักเรียน {total} คน มีชื่อแล้ว {named} คน',
    printShowLetters: 'แสดงเพศ และตัวอักษร "ด้วยกัน"/"แยก"',
    rosterClashMessage: '{names} ถูกจัดให้อยู่ด้วยกัน จึงไม่สามารถแยกกันได้',
    'warnings.PINNED_MIXED_SEX':
      '{names} ถูกปักหมุดไว้ด้วยกันเป็นกลุ่มเดียว แต่ไม่ใช่ทุกคนในกลุ่มนี้เป็นเพศเดียวกัน ดังนั้นกลุ่มนี้จึงไม่ถูกแบ่งตามเพศเหมือนกลุ่มอื่น ๆ นั่นคือสิ่งที่การปักหมุดกำหนดไว้ ไม่ใช่ข้อผิดพลาดที่ต้องแก้ไข',
    // #390: the CSV yes/no tokens, chosen by the operator on 2026-09-30
    // ("Change all three"): ไม่ใช่, a form's no, where ไม่ was.
    'csv.absentNo': 'ไม่ใช่',
    // #603's sheet, read by the operator on 2026-10-07 (every short label no
    // check could judge, https://claude.ai/artifact/AgCDjpCJ2AQkKmdSC4cznm).
    // Values are as they stand AFTER the twelve changes he agreed there.
    absentNumbersHelp:
      'เลขประจำตัวนักเรียนของผู้ที่ขาดเรียน คั่นด้วยเครื่องหมายจุลภาค',
    absentNumbersLabel: 'เลขประจำตัวนักเรียน',
    boardExit: 'ปิดโหมดเต็มหน้าจอ',
    classLabel: 'ชั้นเรียน (ไม่บังคับ)',
    'csv.absentYes': 'ใช่',
    'csv.groupsMadeComment': '# กลุ่มที่สร้างแล้ว',
    'csvLanguageName.id': 'ภาษาอินโดนีเซีย',
    'csvLanguageName.th': 'ไทย',
    'csvLanguageName.vi': 'ภาษาเวียดนาม',
    'csvLanguageName.zh': 'ภาษาจีน',
    'csvLanguageVersion.th': 'ไทย',
    'csvLanguageVersion.vi': 'ภาษาเวียดนาม',
    'csvLanguageVersion.zh': 'ภาษาจีน',
    groupCountLabel: 'มีกี่กลุ่ม',
    heading: 'เครื่องมือสร้างกลุ่มในห้องเรียน',
    'howToSteps[2]': 'กด "สร้างกลุ่ม"',
    ioDownloadTemplate: 'ดาวน์โหลดแม่แบบ',
    ioExportClassList: 'ส่งออกรายชื่อชั้นเรียน',
    ioExportGroups: 'ส่งออกกลุ่ม',
    ioImported: 'นำเข้านักเรียน {total} คนแล้ว',
    ioReplaceConfirm: 'แทนที่',
    keepTogetherLabel: 'ให้อยู่กลุ่มเดียวกัน',
    modePerGroup: 'จำนวนนักเรียนต่อกลุ่ม',
    printCancel: 'ยกเลิก',
    printIncludeAvatars: 'เพิ่มรูปโปรไฟล์',
    printWhat: 'พิมพ์อะไร',
    printWhatBoth: 'ทั้งสอง',
    printWhatGroups: 'ผลการจัดกลุ่ม',
    printedOn: 'พิมพ์เมื่อ {on}',
    resultsHeading: 'กลุ่มของคุณ',
    resultsHeadingNamed: '{className} — กลุ่มของคุณ',
    resultsSummary: '{groups} กลุ่ม จาก {students} นักเรียน',
    rosterAddSeveral: '+ เพิ่มหลายคน…',
    rosterAddStudent: '+ เพิ่มนักเรียน',
    rosterClearAll: 'ลบทั้งหมด',
    rosterCountLine: '{total} นักเรียน · {here} ที่นี่ · {absent} ขาด',
    sectionGroupingHeading: 'ตัวเลือกการจัดกลุ่ม',
    sectionImportExportHeading: 'นำเข้า / ส่งออก',
    sectionSoundHeading: 'เสียงและภาพเคลื่อนไหว',
    'site.calculators.forYeetalk': 'สำหรับ YeeTalk ↗',
    'site.home.emailUs': 'ส่งอีเมลให้เรา',
    'site.home.exploreShytalk': 'สำรวจ ShyTalk',
    'site.home.exploreYaweloIdle': 'สำรวจ Yawelo Idle',
    'site.home.pauseMotion': 'หยุดภาพเคลื่อนไหว',
    'site.home.shytalkKicker': 'เรียนรู้ผ่านการพูดคุย',
    'site.home.toolBadge': 'พร้อมใช้งาน',
    'site.home.workClassroomTitle': 'เครื่องมือสร้างกลุ่มในห้องเรียน',
    'site.home.yaweloIdleKicker': 'เรียนรู้ผ่านการเล่น',
    'site.language.betaLabel': 'คำแปลเวอร์ชันเบต้า',
    'site.menuLabel': 'เปิดหรือปิดเมนูนำทาง',
    'site.report.noteLabel': 'มีอะไรเพิ่มเติมไหม (ไม่บังคับ)',
    'site.report.send': 'ส่งรายงาน',
    'site.skipToContent': 'ไปตรงสู่เนื้อหา',
    'site.themeDarkMode': 'โหมดมืด',
    soundOff: 'ปิดเสียง',
    soundOn: 'เปิดเสียง',
    speedFast: 'เร็ว',
    speedLabel: 'ความเร็ว',
    speedNormal: 'ปกติ',
    speedSkip: 'ข้ามส่วนแอนิเมชัน',
    stateMixed: 'คละชายหญิงเท่ากัน',
    stateNoneAdded: 'ยังไม่มีข้อมูล',
    stateSeparated: 'แบ่งตามเพศ',
    title: 'เครื่องมือสร้างกลุ่มในห้องเรียน',
  },
};

const CATALOGUES: Record<Locale, Catalogue> = { en, id, zh, vi, th };

/**
 * Only the top-level strings: the nested tables (`errors`, `warnings`) and
 * the lists (`howToSteps`) are not columns. A message is a string too (#136),
 * so a `rosterCol*` key that became one would stay in the derived set below.
 */
const stringsOf = (catalogue: Catalogue): Record<string, string> =>
  Object.fromEntries(
    Object.entries(catalogue).filter(([, value]) => typeof value === 'string'),
  ) as Record<string, string>;

/**
 * The copy at a pinned key, read from the catalogue the key names: `site.`
 * for the page chrome, `csv.` for the words a downloaded file carries, and
 * the page catalogue otherwise. A key that names nothing reads as
 * `undefined`, which no pinned value equals, so a pin that outlives its copy
 * goes red rather than silently asserting nothing.
 */
const copyAt = (locale: Locale, key: string): unknown => {
  const [root, path]: [unknown, string] = key.startsWith('site.')
    ? [getSiteStrings(locale), key.slice('site.'.length)]
    : key.startsWith('csv.')
      ? [CSV_LOCALES[locale], key.slice('csv.'.length)]
      : [CATALOGUES[locale], key];
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .reduce<unknown>(
      (table, step) =>
        table !== null && typeof table === 'object'
          ? (table as Record<string, unknown>)[step]
          : undefined,
      root,
    );
};

/**
 * Derived from the catalogue, never listed here. A seventh roster column
 * added next year is covered the day it appears -- it arrives unpinned, the
 * coverage test goes red, and someone has to get its five values read.
 */
const rosterColumnKeys = Object.keys(stringsOf(en))
  .filter((key) => key.startsWith('rosterCol'))
  .sort();

describe('the copy the operator read and approved', () => {
  it('every locale renders the value the operator approved', () => {
    const live = Object.fromEntries(
      LOCALES.map((locale) => [
        locale,
        Object.fromEntries(
          Object.keys(VERIFIED[locale]).map((key) => [
            key,
            copyAt(locale, key),
          ]),
        ),
      ]),
    );

    expect(live).toEqual(VERIFIED);
  });

  it('the pin covers every locale and every roster column, with nothing blank', () => {
    expect(Object.keys(CATALOGUES).sort()).toEqual([...LOCALES].sort());
    expect(Object.keys(VERIFIED).sort()).toEqual([...LOCALES].sort());

    // A literal count, against the six columns the design spec names. Counting
    // the array is not counting its content, so the values are checked below.
    expect(
      nonEmpty(rosterColumnKeys, 'rosterCol* keys in the English catalogue'),
    ).toHaveLength(6);

    const unpinned = LOCALES.flatMap((locale) =>
      rosterColumnKeys
        .filter((key) => !Object.hasOwn(VERIFIED[locale], key))
        .map((key) => `${locale} ${key}`),
    );
    expect(
      searched(unpinned, { of: rosterColumnKeys, what: 'roster columns' }),
    ).toEqual([]);
    expect(
      floorBreach('verified-labels/roster-columns', rosterColumnKeys.length),
    ).toBeUndefined();

    const values = LOCALES.flatMap((locale) => Object.values(VERIFIED[locale]));
    expect(
      searched(
        values.filter((value) => value.trim() === ''),
        { of: values, what: 'pinned values' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('verified-labels/pinned-values', values.length),
    ).toBeUndefined();
  });
});

/**
 * Short labels that disagree with their own locale, awaiting the operator's
 * read (#161).
 *
 * `checkLabels` flags a label whose rendering appears in none of the copy that
 * uses its English and says more, and a label whose namesake renders the same
 * English in other words. Every flag is either pinned in `VERIFIED` above --
 * the operator has read that value -- or listed here until he has. A label
 * that starts to disagree, in a re-seeded locale or on the day it is added, is
 * in neither, and this goes red.
 *
 * Exact in both directions: a listed label that stops disagreeing goes red
 * too, so the list cannot outlive what it describes. It emptied when #161's
 * sheet was answered (2026-09-23), each entry moving to a pin or to a
 * corrected catalogue, and it stays as the place a new flag waits while the
 * operator reads it.
 */
const AWAITING_READ: Record<Locale, readonly string[]> = {
  en: [],
  id: [],
  // #97's report form gave `Contact` its first zh witness: the note hint's
  // "contact details" is 联系方式, where the nav link says 联系我们 ("contact
  // us"), the usual wording for that link. Flagged, not pinned, until read.
  zh: ['site.nav.contact'],
  vi: [],
  th: [],
};

// One id per locale: the search below runs once per locale over its own labels.
const WITNESSED_FLOOR: Readonly<Record<string, string>> = {
  id: 'verified-labels/witnessed-labels-id',
  zh: 'verified-labels/witnessed-labels-zh',
  vi: 'verified-labels/witnessed-labels-vi',
  th: 'verified-labels/witnessed-labels-th',
};

describe('short labels that disagree with their own locale', () => {
  it("every one is pinned or awaiting the operator's read", () => {
    const unread = Object.fromEntries(
      LOCALES.map((locale) => {
        const labels = checkLabels(backTranslationUnits(locale), locale);
        const flagged = labels
          .filter(
            ({ status, variants }) =>
              status === 'disagrees' || variants.length > 0,
          )
          .map(({ key }) => key)
          .filter((key) => !Object.hasOwn(VERIFIED[locale], key));
        // A check that stopped finding witnesses would flag nothing, and an
        // emptied list would then agree with it. Only English has no labels.
        const witnessed = labels
          .filter(({ status }) => status !== 'unchecked')
          .map(({ key }) => key);
        if (locale === DEFAULT_LOCALE) return [locale, flagged];
        const awaiting = [
          ...searched(flagged, {
            of: witnessed,
            what: `${locale} labels with a witness`,
          }),
        ].sort();
        expect(
          floorBreach(WITNESSED_FLOOR[locale], witnessed.length),
        ).toBeUndefined();
        return [locale, awaiting];
      }),
    );

    expect(unread).toEqual(
      Object.fromEntries(
        LOCALES.map((locale) => [locale, [...AWAITING_READ[locale]].sort()]),
      ),
    );
  });
});

/**
 * Labels no check can judge (#602). `checkLabels` marks a label `unchecked`
 * when no longer copy in its locale uses its words, so it has no witness to
 * disagree with, and the test above never looks at it. That is the class that
 * shipped `Tinh duc`: a bare label with nothing to compare it to. Each
 * unchecked label must be pinned in `VERIFIED` (the operator has read it) or
 * listed here until he does. A NEW unchecked label is in neither and goes red
 * by locale and key. Exact in both directions, so the list only shrinks: a
 * label pinned while still listed goes red too.
 *
 * Derived from `checkLabels`, never typed. #603 read every label that stood on
 * this list with the operator (2026-10-07) and pinned them all, so it is empty
 * and stays as the place a new unchecked label waits while he reads it. English
 * has no labels to judge here.
 */
const UNWITNESSED: Record<'id' | 'zh' | 'vi' | 'th', readonly string[]> = {
  // #636: the Gift Value Calculator heading is new, drafted by DeepL and read
  // back by LibreTranslate, and awaits the operator's read in every locale.
  id: [
    'site.calculators.gift.heading',
    'site.calculators.glory.heading',
    'site.calculators.title',
    'site.home.openCalculators',
  ],
  zh: [
    'site.calculators.gift.heading',
    'site.calculators.glory.heading',
    'site.calculators.title',
    'site.home.openCalculators',
  ],
  // #635: YeeTalk Calculators and "Open the calculators" are new English the
  // operator has not read in these two locales. Awaiting his read, then pinned.
  vi: [
    'site.calculators.gift.heading',
    'site.calculators.title',
    'site.home.openCalculators',
  ],
  th: [
    'site.calculators.gift.heading',
    'site.calculators.title',
    'site.home.openCalculators',
  ],
};

// One id per locale: the search below runs once per locale over its own labels.
const UNWITNESSED_FLOOR: Readonly<Record<keyof typeof UNWITNESSED, string>> = {
  id: 'verified-labels/unwitnessed-labels-id',
  zh: 'verified-labels/unwitnessed-labels-zh',
  vi: 'verified-labels/unwitnessed-labels-vi',
  th: 'verified-labels/unwitnessed-labels-th',
};

describe('short labels no check can judge', () => {
  for (const locale of Object.keys(
    UNWITNESSED,
  ) as (keyof typeof UNWITNESSED)[]) {
    it(`${locale}: every unchecked label is pinned or on the burn-down list`, () => {
      const unwitnessed = checkLabels(backTranslationUnits(locale), locale)
        .filter(({ status }) => status === 'unchecked')
        .map(({ key }) => key);
      const unread = [
        ...searched(
          unwitnessed.filter((key) => !Object.hasOwn(VERIFIED[locale], key)),
          { of: unwitnessed, what: `${locale} unchecked labels` },
        ),
      ].sort();
      expect(unread).toEqual([...UNWITNESSED[locale]].sort());
      expect(
        floorBreach(UNWITNESSED_FLOOR[locale], unwitnessed.length),
      ).toBeUndefined();
    });
  }
});
