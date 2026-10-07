/**
 * Site-wide copy — header, footer, homepage, 404 and the Glory Points page.
 *
 * Kept beside its translation on purpose: the pair drifts far less when both
 * languages are in one file and a reviewer can see them together. Tool-specific
 * strings live in en.ts / id.ts.
 *
 * `SiteStrings` is derived from the English object, so the Indonesian one is
 * checked at build time — a missing key is a compile error, never a silently
 * English sentence on an Indonesian page.
 */
export const siteEn = {
  nav: {
    shytalk: 'ShyTalk',
    yaweloIdle: 'Yawelo Idle',
    tools: 'Tools',
    contact: 'Contact',
  },
  menuLabel: 'Toggle navigation menu',
  themeDarkMode: 'Dark mode',
  skipToContent: 'Skip to content',

  home: {
    title: 'Shyden — small software, made with care',
    description:
      'Small software, made with care. Coming soon: ShyTalk, live rooms for learning a language by speaking it, and Yawelo Idle, an idle game for learning one.',
    heroHeading: 'Shyden makes small software, with care.',
    heroLead:
      "Coming soon: two new ways to learn a language. Talk it out in ShyTalk's live rooms, or play your way through Yawelo Idle, an idle game where every word you learn carries you further.",
    exploreShytalk: 'Explore ShyTalk',
    exploreYaweloIdle: 'Explore Yawelo Idle',
    opensAt: 'opens',
    comingSoon: 'Coming soon',
    shytalkKicker: 'Learn by talking',
    shytalkBody:
      'Take a seat in a live room and talk — with people learning your language, or in a free lesson with a real teacher when you want the structure.',
    shytalkFeature1: 'Live audio rooms with up to eight seats',
    shytalkFeature2: "Ask for a seat, or just listen until you're ready",
    shytalkFeature3: 'Free lessons with real teachers',
    shytalkFeature4: 'Moderated, age-segregated, and built to stay friendly',
    shytalkShotAlt:
      'The ShyTalk app on a phone, showing a live audio room with people on its seats and the room chat below them.',
    visitShytalk: 'Visit the ShyTalk site',
    yaweloIdleKicker: 'Learn by playing',
    yaweloIdleBody:
      'An idle game for learning a real language. Journey across the Indonesian archipelago, or across the English-speaking world, and the words you pick up power the game.',
    yaweloIdleFeature1:
      'Learn Indonesian from English, or English from Indonesian',
    yaweloIdleFeature2: 'Review a word and it grows stronger',
    yaweloIdleFeature3: 'No ads, no energy timers, no paid progress',
    yaweloIdleFeature4:
      'Miss a day and lose nothing. Nobody is forced to study.',
    visitYaweloIdle: 'Visit the Yawelo Idle site',
    toolsHeading: "While you're waiting, try these.",
    toolsLead:
      "Two tools we've already built. Free, no sign-up, and working right now.",
    toolBadge: 'Live now',
    workGloryTitle: 'Glory Points Calculator',
    workGloryBody:
      'Turn YeeTalk glory points into the coins, beans and gift value you need to reach your target.',
    openGlory: 'Open the calculator',
    workClassroomTitle: 'Classroom Group Creator',
    workClassroomBody:
      'Paste a class list and get fair, random groups in seconds. Built for teachers, free forever.',
    openClassroom: 'Open the group creator',
    emailUs: 'Email us',
    pauseMotion: 'Pause motion',
  },

  notFound: {
    title: 'Page not found — Shyden',
    description: "The page you were looking for doesn't exist.",
    heading: 'Page not found',
    body: "That page doesn't exist.",
    backHome: 'Back to the homepage',
  },

  glory: {
    title: 'Glory Points Calculator — Shyden',
    description:
      'Convert YeeTalk glory points into coins, beans and total gift value — instantly, in your browser.',
    forYeetalk: 'For YeeTalk ↗',
    heading: 'Glory Points Calculator',
    lead: "Glory points are part of YeeTalk's in-app gifting. Enter the number of glory points you're aiming for and this companion tool, built by Shyden, works out the exact coins, beans and total gift value you need to reach it.",
    howToHeading: 'How to use it',
    howToSteps: [
      'Enter the number of glory points you want to reach in the box below.',
      'Select Calculate — or press Enter.',
      'Read off the exact coins, beans and total gift value you need to hit that target.',
    ],
    inputLabel: 'Glory points',
    calculate: 'Calculate',
    resultLine: (coins: string, beans: string, gift: string) =>
      `${coins} coins → ${beans} beans → ${gift} total gift value`,
    needsJs: 'This calculator needs JavaScript enabled.',
    assumptions:
      'Assumes 1 coin per point, 0.9 coins per bean, and gifts converting to beans at 40%.',
    // Keyed to gloryPoints.ts's ERRORS so the calculator's own English copy —
    // asserted as a contract by its unit tests — stays untouched while the
    // Indonesian page still speaks Indonesian.
    errors: {
      empty: 'Please enter a number.',
      notWhole: 'Please enter a whole number.',
      zero: 'Enter a number greater than zero.',
      tooLarge: 'That number is too large.',
    },
  },

  // `switchTo` (one string meaning "the other language") was removed in #21
  // Stage 2: it could only ever label one alternative. The switcher now reads
  // each language's own name from LOCALE_METADATA. `label` names the control
  // itself and stays.
  language: {
    label: 'Language',
    // `betaLabel` is the accessible name for the BETA badge; the badge's own
    // text is BETA_BADGE and is deliberately NOT translated (it labels a
    // language the reader may not speak). This label and the notice ARE.
    betaLabel: 'beta translation',
    betaNotice: 'Translations may not be accurate. If you notice it, tell us.',
  },

  // The footer's "report a translation problem" form (#97). The English is
  // the operator-approved table in the spec's section 3.5, pinned literally by
  // report-copy.test.ts. It renders only on beta locales, never on English.
  report: {
    open: 'Report a translation problem',
    intro:
      'Reports go to Shyden and are deleted once they have been dealt with.',
    quoteLabel: 'Which words are wrong?',
    quoteHint:
      'Start typing and choose the words from the list, or copy them from the page.',
    suggestionLabel: 'What should it say? (optional)',
    noteLabel: 'Anything else? (optional)',
    noteHint: "Please don't include names or contact details.",
    honeypotLabel: 'Leave this field empty',
    send: 'Send report',
    sent: 'Thank you. Your report has been sent.',
    notFound:
      "We couldn't find those words on this page. Choose them from the list, or copy a shorter piece without any names or numbers.",
    rejected:
      "That report couldn't be sent. Please check the form and try again.",
    failed:
      "Something went wrong and your report wasn't sent. Please try again later.",
  },
};

export type SiteStrings = typeof siteEn;

export const siteId: SiteStrings = {
  nav: {
    shytalk: 'ShyTalk',
    yaweloIdle: 'Yawelo Idle',
    tools: 'Alat',
    contact: 'Kontak',
  },
  menuLabel: 'Buka atau tutup menu navigasi',
  themeDarkMode: 'Mode gelap',
  skipToContent: 'Lewati ke konten',

  home: {
    title: 'Shyden — perangkat lunak kecil, dibuat dengan cermat',
    description:
      'Perangkat lunak kecil, dibuat dengan cermat. Segera hadir: ShyTalk, ruang langsung untuk belajar bahasa dengan berbicara, dan Yawelo Idle, gim idle untuk belajar bahasa.',
    heroHeading: 'Shyden membuat perangkat lunak kecil, dengan cermat.',
    heroLead:
      'Segera hadir: dua cara baru untuk belajar bahasa. Berbicaralah langsung di ruang ShyTalk, atau bermainlah bersama Yawelo Idle, gim idle yang membawa Anda makin jauh dengan setiap kata yang Anda pelajari.',
    exploreShytalk: 'Jelajahi ShyTalk',
    exploreYaweloIdle: 'Jelajahi Yawelo Idle',
    opensAt: 'membuka',
    comingSoon: 'Segera hadir',
    shytalkKicker: 'Belajar dengan berbicara',
    shytalkBody:
      'Ambil kursi di ruang langsung dan mulailah berbicara — dengan orang yang sedang belajar bahasa Anda, atau dalam pelajaran gratis bersama guru sungguhan bila Anda menginginkan yang lebih terstruktur.',
    shytalkFeature1: 'Ruang audio langsung dengan hingga delapan kursi',
    shytalkFeature2: 'Minta kursi, atau cukup mendengarkan sampai Anda siap',
    shytalkFeature3: 'Pelajaran gratis bersama guru sungguhan',
    shytalkFeature4:
      'Dimoderasi, dipisahkan menurut usia, dan dibuat agar tetap ramah',
    shytalkShotAlt:
      'Aplikasi ShyTalk di ponsel, menampilkan ruang audio langsung dengan orang-orang di kursinya dan obrolan ruangan di bawahnya.',
    visitShytalk: 'Kunjungi situs ShyTalk',
    yaweloIdleKicker: 'Belajar dengan bermain',
    yaweloIdleBody:
      'Gim idle untuk mempelajari bahasa sungguhan. Jelajahi kepulauan Indonesia, atau dunia berbahasa Inggris, dan kata-kata yang Anda pelajari menggerakkan permainan.',
    yaweloIdleFeature1:
      'Belajar bahasa Indonesia dari bahasa Inggris, atau bahasa Inggris dari bahasa Indonesia',
    yaweloIdleFeature2: 'Ulangi sebuah kata dan kata itu makin kuat',
    yaweloIdleFeature3:
      'Tanpa iklan, tanpa batas energi, tanpa kemajuan berbayar',
    yaweloIdleFeature4:
      'Lewatkan sehari dan Anda tidak kehilangan apa pun. Tidak ada yang dipaksa belajar.',
    visitYaweloIdle: 'Kunjungi situs Yawelo Idle',
    toolsHeading: 'Sambil menunggu, coba ini.',
    toolsLead:
      'Dua alat yang sudah kami buat. Gratis, tanpa pendaftaran, dan berfungsi sekarang juga.',
    toolBadge: 'Aktif sekarang',
    workGloryTitle: 'Kalkulator Glory Points',
    workGloryBody:
      'Ubah glory points YeeTalk menjadi koin, bean, dan nilai hadiah yang Anda butuhkan untuk mencapai target.',
    openGlory: 'Buka kalkulator',
    workClassroomTitle: 'Pembuat Kelompok Kelas',
    workClassroomBody:
      'Tempelkan daftar kelas dan dapatkan kelompok acak yang adil dalam hitungan detik. Dibuat untuk guru, gratis selamanya.',
    openClassroom: 'Buka pembuat kelompok',
    emailUs: 'Kirim email',
    pauseMotion: 'Jeda gerakan',
  },

  notFound: {
    title: 'Halaman tidak ditemukan — Shyden',
    description: 'Halaman yang Anda cari tidak ada.',
    heading: 'Halaman tidak ditemukan',
    body: 'Halaman itu tidak ada.',
    backHome: 'Kembali ke beranda',
  },

  glory: {
    title: 'Kalkulator Glory Points — Shyden',
    description:
      'Ubah glory points YeeTalk menjadi koin, bean, dan total nilai hadiah — seketika, di peramban Anda.',
    forYeetalk: 'Untuk YeeTalk ↗',
    heading: 'Kalkulator Glory Points',
    lead: 'Glory points adalah bagian dari fitur hadiah di dalam aplikasi YeeTalk. Masukkan jumlah glory points yang Anda tuju, dan alat pendamping buatan Shyden ini menghitung persis berapa koin, bean, dan total nilai hadiah yang Anda perlukan.',
    howToHeading: 'Cara menggunakannya',
    howToSteps: [
      'Masukkan jumlah glory points yang ingin Anda capai pada kotak di bawah.',
      'Pilih Hitung — atau tekan Enter.',
      'Baca jumlah persis koin, bean, dan total nilai hadiah yang diperlukan untuk mencapai target itu.',
    ],
    inputLabel: 'Glory points',
    calculate: 'Hitung',
    resultLine: (coins: string, beans: string, gift: string) =>
      `${coins} koin → ${beans} bean → ${gift} total nilai hadiah`,
    needsJs: 'Kalkulator ini memerlukan JavaScript yang aktif.',
    assumptions:
      'Mengasumsikan 1 koin per poin, 0,9 koin per bean, dan hadiah dikonversi ke bean sebesar 40%.',
    errors: {
      empty: 'Silakan masukkan angka.',
      notWhole: 'Silakan masukkan bilangan bulat.',
      zero: 'Masukkan angka lebih besar dari nol.',
      tooLarge: 'Angka itu terlalu besar.',
    },
  },

  language: {
    label: 'Bahasa',
    betaLabel: 'terjemahan beta',
    betaNotice:
      'Terjemahan mungkin tidak akurat. Jika Anda melihatnya, beri tahu kami.',
  },

  report: {
    open: 'Laporkan masalah terjemahan',
    intro: 'Laporan dikirim ke Shyden dan dihapus setelah ditangani.',
    quoteLabel: 'Kata mana yang salah?',
    quoteHint:
      'Mulai mengetik lalu pilih kata-katanya dari daftar, atau salin dari halaman.',
    suggestionLabel: 'Seharusnya tertulis apa? (opsional)',
    noteLabel: 'Ada hal lain? (opsional)',
    noteHint: 'Jangan sertakan nama atau detail kontak.',
    honeypotLabel: 'Biarkan kolom ini kosong',
    send: 'Kirim laporan',
    sent: 'Terima kasih. Laporan Anda telah dikirim.',
    notFound:
      'Kami tidak dapat menemukan kata-kata itu di halaman ini. Pilih dari daftar, atau salin bagian yang lebih pendek tanpa nama atau angka.',
    rejected:
      'Laporan itu tidak dapat dikirim. Silakan periksa formulir dan coba lagi.',
    failed:
      'Terjadi kesalahan dan laporan Anda tidak terkirim. Silakan coba lagi nanti.',
  },
};

/**
 * zh — generated from siteEn and the DeepL cache (#22). Machine output is a
 * FIRST DRAFT: checked for structure, not for fluency. See the review list on
 * the issue.
 */
export const siteZh: SiteStrings = {
  nav: {
    shytalk: 'ShyTalk',
    yaweloIdle: 'Yawelo Idle',
    tools: '工具',
    contact: '联系我们',
  },
  menuLabel: '切换导航菜单',
  themeDarkMode: '深色模式',
  skipToContent: '跳转至正文',
  home: {
    title: 'Shyden — 精心制作的小巧软件',
    description:
      '精心打造的小巧软件。即将推出：ShyTalk——通过口语练习学习语言的实时房间，以及 Yawelo Idle——一款用于学习语言的放置类游戏。',
    heroHeading: 'Shyden 精心开发小型软件。',
    heroLead:
      '即将推出：两种全新的语言学习方式。你可以在 ShyTalk 的实时房间里畅所欲言，或者通过 Yawelo Idle 这款放置类游戏边玩边学——在这款游戏中，你学会的每一个单词都能让你走得更远。',
    exploreShytalk: '了解 ShyTalk',
    exploreYaweloIdle: '了解 Yawelo Idle',
    opensAt: '打开',
    comingSoon: '即将推出',
    shytalkKicker: '通过交谈学习',
    shytalkBody:
      '在实时房间里坐下来开口说——和正在学你语言的人交流，或者在想要更有条理时，参加由真人老师带的免费课程。',
    shytalkFeature1: '实时语音房间，最多八个座位',
    shytalkFeature2: '申请一个座位，或者先听着，等你准备好',
    shytalkFeature3: '由真人老师带的免费课程',
    shytalkFeature4: '有人管理、按年龄分区，为友善而设计',
    shytalkShotAlt:
      'ShyTalk 应用在手机上显示一个实时语音房间，座位上有人，下面是房间聊天。',
    visitShytalk: '访问 ShyTalk 网站',
    yaweloIdleKicker: '通过游戏学习',
    yaweloIdleBody:
      '一款学习真实语言的放置类游戏。穿越印度尼西亚群岛，或踏遍英语世界，你学到的单词会为游戏提供动力。',
    yaweloIdleFeature1: '从英语学习印尼语，或从印尼语学习英语',
    yaweloIdleFeature2: '复习一个单词，它就会变得更牢固',
    yaweloIdleFeature3: '无广告、无能量计时器、无付费解锁',
    yaweloIdleFeature4: '哪怕错过一天，也不会有什么损失。没人会被强迫学习。',
    visitYaweloIdle: '访问 Yawelo Idle 网站',
    toolsHeading: '等待期间，先试试这些。',
    toolsLead: '我们已经做好的两款工具。免费，无需注册，现在就能用。',
    toolBadge: '已上线',
    workGloryTitle: 'Glory Points 计算器',
    workGloryBody:
      '把 YeeTalk 的 glory points 换算成达成目标所需的金币、bean 和礼物价值。',
    openGlory: '打开计算器',
    workClassroomTitle: '课堂小组创建器',
    workClassroomBody:
      '粘贴一份班级名单，几秒钟就能得到公平的随机分组。为教师而做，永久免费。',
    openClassroom: '打开小组创建器',
    emailUs: '给我们发邮件',
    pauseMotion: '暂停动作',
  },
  notFound: {
    title: '页面未找到 — Shyden',
    description: '您要查找的页面不存在。',
    heading: '页面未找到',
    body: '该页面不存在。',
    backHome: '返回首页',
  },
  glory: {
    title: 'Glory Points 计算器 — Shyden',
    description:
      '将 YeeTalk 的 glory points 换算成金币、bean 和礼物总价值——在浏览器中即可即时完成。',
    forYeetalk: '适用于 YeeTalk ↗',
    heading: 'Glory Points 计算器',
    lead: 'Glory points 是 YeeTalk 应用内送礼功能的一部分。输入您想达到的 glory points，这款由 Shyden 开发的辅助工具会算出达到该目标所需的确切金币、bean 和礼物总价值。',
    howToHeading: '如何使用',
    howToSteps: [
      '请在下方框中输入您想达到的 glory points。',
      '选择“计算”——或按 Enter 键。',
      '即可看到达到该目标所需的确切金币、bean 和礼物总价值。',
    ],
    inputLabel: 'Glory points',
    calculate: '计算',
    resultLine: (coins: string, beans: string, gift: string) =>
      `${coins} 金币 → ${beans} bean → ${gift} 礼物总价值`,
    needsJs: '此计算器需要启用 JavaScript。',
    assumptions:
      '假设每 1 点需 1 枚金币，每个 bean 可兑换 0.9 枚金币，且礼物按 40% 的比例兑换成 bean。',
    errors: {
      empty: '请输入一个数字。',
      notWhole: '请输入一个整数。',
      zero: '请输入一个大于零的数字。',
      tooLarge: '这个数字太大了。',
    },
  },
  language: {
    label: '语言',
    betaLabel: '测试版翻译',
    betaNotice: '翻译可能不准确。如果您发现问题，请告诉我们。',
  },

  report: {
    open: '报告翻译问题',
    intro: '报告将发送至Shyden，处理完毕后即会删除。',
    quoteLabel: '哪些文字有误？',
    quoteHint: '开始输入并从列表中选择这些文字，或从页面上复制。',
    suggestionLabel: '应该怎么写？（可选）',
    noteLabel: '还有其他问题吗？（可选）',
    noteHint: '请勿填写姓名或联系方式。',
    honeypotLabel: '请将此栏留空',
    send: '发送报告',
    sent: '谢谢。您的报告已发送。',
    notFound:
      '我们在此页面上找不到这些文字。请从列表中选择，或复制一段较短且不含任何姓名或数字的文字。',
    rejected: '该报告无法发送。请检查表单后重试。',
    failed: '出现问题，您的报告未能发送。请稍后再试。',
  },
};

/**
 * vi — generated from siteEn and the DeepL cache (#22). Machine output is a
 * FIRST DRAFT: checked for structure, not for fluency. See the review list on
 * the issue.
 */
export const siteVi: SiteStrings = {
  nav: {
    shytalk: 'ShyTalk',
    yaweloIdle: 'Yawelo Idle',
    tools: 'Công cụ',
    contact: 'Liên hệ',
  },
  menuLabel: 'Chuyển đổi menu điều hướng',
  themeDarkMode: 'Chế độ tối',
  skipToContent: 'Chuyển thẳng đến nội dung',
  home: {
    title: 'Shyden — phần mềm nhỏ, được phát triển với sự tận tâm',
    description:
      'Phần mềm nhỏ, được phát triển với sự tận tâm. Sắp ra mắt: ShyTalk – các phòng trực tuyến giúp bạn học ngôn ngữ thông qua việc thực hành nói, và Yawelo Idle – một trò chơi nhàn rỗi giúp bạn học ngôn ngữ.',
    heroHeading: 'Shyden phát triển các phần mềm nhỏ với sự tận tâm.',
    heroLead:
      'Sắp ra mắt: hai phương pháp học ngoại ngữ hoàn toàn mới. Hãy tham gia trò chuyện trong các phòng trò chuyện trực tiếp của ShyTalk, hoặc vừa chơi vừa học với Yawelo Idle – một trò chơi nhàn rỗi, nơi mỗi từ vựng bạn học được sẽ giúp bạn tiến xa hơn.',
    exploreShytalk: 'Khám phá ShyTalk',
    exploreYaweloIdle: 'Khám phá Yawelo Idle',
    opensAt: 'mở',
    comingSoon: 'Sắp ra mắt',
    shytalkKicker: 'Học qua giao tiếp',
    shytalkBody:
      'Nhận một chỗ ngồi trong phòng trực tuyến và bắt đầu nói — với những người đang học ngôn ngữ của bạn, hoặc trong một buổi học miễn phí cùng giáo viên thật khi bạn muốn có cấu trúc hơn.',
    shytalkFeature1: 'Phòng âm thanh trực tuyến với tối đa tám chỗ ngồi',
    shytalkFeature2: 'Xin một chỗ ngồi, hoặc cứ nghe cho đến khi bạn sẵn sàng',
    shytalkFeature3: 'Buổi học miễn phí cùng giáo viên thật',
    shytalkFeature4:
      'Có kiểm duyệt, phân tách theo độ tuổi, và được xây dựng để luôn thân thiện',
    shytalkShotAlt:
      'Ứng dụng ShyTalk trên điện thoại, hiển thị một phòng âm thanh trực tuyến với những người trên các chỗ ngồi và khung trò chuyện của phòng ở bên dưới.',
    visitShytalk: 'Truy cập trang ShyTalk',
    yaweloIdleKicker: 'Học qua trò chơi',
    yaweloIdleBody:
      'Một trò chơi nhàn rỗi giúp học ngôn ngữ thực tế. Hãy bắt đầu hành trình khám phá quần đảo Indonesia hoặc thế giới nói tiếng Anh, và chính những từ vựng bạn thu thập được sẽ là động lực cho trò chơi.',
    yaweloIdleFeature1:
      'Học tiếng Indonesia từ tiếng Anh, hoặc học tiếng Anh từ tiếng Indonesia',
    yaweloIdleFeature2: 'Hãy ôn lại một từ và nó sẽ trở nên vững chắc hơn',
    yaweloIdleFeature3:
      'Không có quảng cáo, không có bộ hẹn giờ năng lượng, không có tiến trình phải trả phí',
    yaweloIdleFeature4:
      'Bỏ lỡ một ngày cũng chẳng mất mát gì. Không ai bị ép buộc phải học cả.',
    visitYaweloIdle: 'Truy cập trang Yawelo Idle',
    toolsHeading: 'Trong lúc chờ, hãy thử những công cụ này.',
    toolsLead:
      'Hai công cụ chúng tôi đã xây dựng. Miễn phí, không cần đăng ký, và dùng được ngay bây giờ.',
    toolBadge: 'Đang hoạt động',
    workGloryTitle: 'Máy tính Glory Points',
    workGloryBody:
      'Chuyển glory points của YeeTalk thành số xu, bean và giá trị quà tặng bạn cần để đạt mục tiêu.',
    openGlory: 'Mở máy tính',
    workClassroomTitle: 'Trình tạo nhóm trong lớp học',
    workClassroomBody:
      'Dán danh sách lớp và nhận các nhóm ngẫu nhiên, công bằng chỉ trong vài giây. Dành cho giáo viên, miễn phí mãi mãi.',
    openClassroom: 'Mở trình tạo nhóm',
    emailUs: 'Gửi email cho chúng tôi',
    pauseMotion: 'Tạm dừng chuyển động',
  },
  notFound: {
    title: 'Không tìm thấy trang — Shyden',
    description: 'Trang bạn đang tìm kiếm không tồn tại.',
    heading: 'Không tìm thấy trang',
    body: 'Trang đó không tồn tại.',
    backHome: 'Quay lại trang chủ',
  },
  glory: {
    title: 'Máy tính Glory Points — Shyden',
    description:
      'Chuyển đổi glory points của YeeTalk thành xu, bean và tổng giá trị quà tặng — ngay lập tức, ngay trên trình duyệt của bạn.',
    forYeetalk: 'Dành cho YeeTalk ↗',
    heading: 'Máy tính Glory Points',
    lead: 'Glory points là một phần của tính năng tặng quà trong ứng dụng YeeTalk. Chỉ cần nhập số glory points mà bạn muốn đạt được, công cụ hỗ trợ này – do Shyden phát triển – sẽ tính toán chính xác số xu, bean và tổng giá trị quà tặng mà bạn cần để đạt được mục tiêu đó.',
    howToHeading: 'Cách sử dụng',
    howToSteps: [
      'Hãy nhập số glory points mà bạn muốn đạt được vào ô bên dưới.',
      'Chọn “Tính toán” — hoặc nhấn phím Enter.',
      'Xem chính xác số xu, bean và tổng giá trị quà tặng mà bạn cần để đạt được mục tiêu đó.',
    ],
    inputLabel: 'Glory points',
    calculate: 'Tính toán',
    resultLine: (coins: string, beans: string, gift: string) =>
      `${coins} xu → ${beans} bean → ${gift} tổng giá trị quà tặng`,
    needsJs: 'Trình tính này cần bật JavaScript.',
    assumptions:
      'Giả định mỗi điểm tương ứng với 1 xu, mỗi bean tương ứng với 0,9 xu, và quà tặng được quy đổi thành bean theo tỷ lệ 40%.',
    errors: {
      empty: 'Vui lòng nhập một số.',
      notWhole: 'Vui lòng nhập một số nguyên.',
      zero: 'Hãy nhập một số lớn hơn 0.',
      tooLarge: 'Con số đó quá lớn.',
    },
  },
  language: {
    label: 'Ngôn ngữ',
    betaLabel: 'bản dịch beta',
    betaNotice:
      'Bản dịch có thể không chính xác. Nếu bạn phát hiện lỗi, hãy cho chúng tôi biết.',
  },

  report: {
    open: 'Báo lỗi bản dịch',
    intro: 'Báo cáo được gửi đến Shyden và sẽ bị xóa sau khi được xử lý.',
    quoteLabel: 'Những từ nào bị sai?',
    quoteHint:
      'Hãy bắt đầu nhập và chọn các từ trong danh sách, hoặc sao chép chúng từ trang.',
    suggestionLabel: 'Nên viết như thế nào? (không bắt buộc)',
    noteLabel: 'Còn điều gì khác không? (không bắt buộc)',
    noteHint: 'Vui lòng không ghi tên hoặc thông tin liên hệ.',
    honeypotLabel: 'Hãy để trống trường này',
    send: 'Gửi báo cáo',
    sent: 'Cảm ơn bạn. Báo cáo của bạn đã được gửi.',
    notFound:
      'Chúng tôi không tìm thấy những từ đó trên trang này. Hãy chọn chúng từ danh sách, hoặc sao chép một đoạn ngắn hơn không có tên hay con số nào.',
    rejected:
      'Không thể gửi báo cáo đó. Vui lòng kiểm tra biểu mẫu và thử lại.',
    failed:
      'Đã xảy ra lỗi và báo cáo của bạn chưa được gửi. Vui lòng thử lại sau.',
  },
};

/**
 * th — generated from siteEn and the DeepL cache (#22). Machine output is a
 * FIRST DRAFT: checked for structure, not for fluency. See the review list on
 * the issue.
 */
export const siteTh: SiteStrings = {
  nav: {
    shytalk: 'ShyTalk',
    yaweloIdle: 'Yawelo Idle',
    tools: 'เครื่องมือ',
    contact: 'ติดต่อ',
  },
  menuLabel: 'สลับเมนูนำทาง',
  themeDarkMode: 'โหมดมืด',
  skipToContent: 'ไปตรงสู่เนื้อหา',
  home: {
    title: 'Shyden — ซอฟต์แวร์ขนาดเล็ก ที่พัฒนาด้วยความใส่ใจ',
    description:
      'ซอฟต์แวร์ขนาดเล็ก ที่พัฒนาด้วยความใส่ใจ เร็วๆ นี้: ShyTalk — ห้องสนทนาสดเพื่อเรียนรู้ภาษาผ่านการพูด — และ Yawelo Idle — เกมแบบ idle สำหรับการเรียนรู้ภาษา',
    heroHeading: 'Shyden พัฒนาซอฟต์แวร์ขนาดเล็ก ด้วยความใส่ใจ',
    heroLead:
      'เร็วๆ นี้: สองวิธีใหม่ในการเรียนภาษา พูดคุยกันในห้องสนทนาสดของ ShyTalk หรือเล่นเกม Yawelo Idle ซึ่งเป็นเกมแบบ idle ที่ทุกคำที่คุณเรียนรู้จะพาคุณก้าวไปข้างหน้า',
    exploreShytalk: 'สำรวจ ShyTalk',
    exploreYaweloIdle: 'สำรวจ Yawelo Idle',
    opensAt: 'เปิด',
    comingSoon: 'เร็วๆ นี้',
    shytalkKicker: 'เรียนรู้ผ่านการพูดคุย',
    shytalkBody:
      'นั่งลงในห้องสนทนาสดแล้วเริ่มพูดคุย — กับคนที่กำลังเรียนภาษาของคุณ หรือในบทเรียนฟรีกับครูตัวจริงเมื่อคุณอยากได้ความเป็นระบบมากขึ้น',
    shytalkFeature1: 'ห้องเสียงสดรองรับได้สูงสุดแปดที่นั่ง',
    shytalkFeature2: 'ขอที่นั่ง หรือจะฟังไปก่อนจนกว่าคุณจะพร้อม',
    shytalkFeature3: 'บทเรียนฟรีกับครูตัวจริง',
    shytalkFeature4: 'มีการดูแล แบ่งตามช่วงอายุ และสร้างมาให้เป็นมิตรเสมอ',
    shytalkShotAlt:
      'แอป ShyTalk บนโทรศัพท์ แสดงห้องเสียงสดที่มีผู้คนอยู่บนที่นั่งและแชตของห้องอยู่ด้านล่าง',
    visitShytalk: 'เยี่ยมชมเว็บไซต์ ShyTalk',
    yaweloIdleKicker: 'เรียนรู้ผ่านการเล่น',
    yaweloIdleBody:
      'เกมแบบ idle สำหรับการเรียนรู้ภาษาจริง เดินทางผ่านหมู่เกาะอินโดนีเซีย หรือทั่วโลกที่ใช้ภาษาอังกฤษ และคำศัพท์ที่คุณเก็บรวบรวมได้จะช่วยให้เกมดำเนินไป',
    yaweloIdleFeature1:
      'เรียนภาษาอินโดนีเซียจากภาษาอังกฤษ หรือเรียนภาษาอังกฤษจากภาษาอินโดนีเซีย',
    yaweloIdleFeature2: 'ทบทวนคำหนึ่ง และคำนั้นจะยิ่งแข็งแกร่งขึ้น',
    yaweloIdleFeature3:
      'ไม่มีโฆษณา ไม่มีตัวจับเวลาพลังงาน ไม่มีความคืบหน้าที่ต้องจ่ายเงิน',
    yaweloIdleFeature4:
      'พลาดไปหนึ่งวัน ก็ไม่เสียอะไรเลย ไม่มีใครถูกบังคับให้เรียน',
    visitYaweloIdle: 'เยี่ยมชมเว็บไซต์ Yawelo Idle',
    toolsHeading: 'ระหว่างที่รอ ลองสิ่งเหล่านี้ดู',
    toolsLead:
      'เครื่องมือสองอย่างที่เราทำไว้แล้ว ฟรี ไม่ต้องสมัคร และใช้ได้ทันที',
    toolBadge: 'พร้อมใช้งาน',
    workGloryTitle: 'เครื่องคำนวณ Glory Points',
    workGloryBody:
      'แปลง glory points ของ YeeTalk เป็นจำนวนเหรียญ bean และมูลค่าของขวัญที่คุณต้องใช้เพื่อไปให้ถึงเป้าหมาย',
    openGlory: 'เปิดเครื่องคำนวณ',
    workClassroomTitle: 'เครื่องมือสร้างกลุ่มในห้องเรียน',
    workClassroomBody:
      'วางรายชื่อนักเรียนแล้วได้กลุ่มแบบสุ่มที่ยุติธรรมภายในไม่กี่วินาที สร้างมาเพื่อครู ฟรีตลอดไป',
    openClassroom: 'เปิดเครื่องมือสร้างกลุ่ม',
    emailUs: 'ส่งอีเมลให้เรา',
    pauseMotion: 'หยุดการเคลื่อนไหว',
  },
  notFound: {
    title: 'ไม่พบหน้า — Shyden',
    description: 'หน้าที่คุณกำลังค้นหาไม่มีอยู่',
    heading: 'ไม่พบหน้า',
    body: 'หน้านั้นไม่มีอยู่',
    backHome: 'กลับสู่หน้าหลัก',
  },
  glory: {
    title: 'เครื่องคำนวณ Glory Points — Shyden',
    description:
      'แปลง glory points ของ YeeTalk เป็นเหรียญ bean และมูลค่ารวมของของขวัญ — ทันที ในเบราว์เซอร์ของคุณ',
    forYeetalk: 'สำหรับ YeeTalk ↗',
    heading: 'เครื่องคำนวณ Glory Points',
    lead: 'Glory points เป็นส่วนหนึ่งของระบบการส่งของขวัญภายในแอป YeeTalk เพียงป้อนจำนวน glory points ที่คุณต้องการ เครื่องมือช่วยนี้ ซึ่งพัฒนาโดย Shyden จะคำนวณจำนวนเหรียญและ bean รวมถึงมูลค่ารวมของของขวัญที่คุณต้องใช้เพื่อให้ถึงเป้าหมายนั้น',
    howToHeading: 'วิธีใช้',
    howToSteps: [
      'กรอกจำนวน glory points ที่คุณต้องการให้ถึงลงในช่องด้านล่าง',
      'เลือก "คำนวณ" — หรือกด Enter',
      'ดูจำนวนเหรียญและ bean ที่แน่นอน รวมถึงมูลค่ารวมของของขวัญที่คุณต้องใช้เพื่อให้ถึงเป้าหมายนั้น',
    ],
    inputLabel: 'Glory points',
    calculate: 'คำนวณ',
    resultLine: (coins: string, beans: string, gift: string) =>
      `${coins} เหรียญ → ${beans} bean → ${gift} มูลค่ารวมของของขวัญ`,
    needsJs: 'เครื่องคำนวณนี้ต้องเปิด JavaScript ไว้',
    assumptions:
      'สมมติว่า 1 คะแนนเท่ากับ 1 เหรียญ, 0.9 เหรียญต่อ bean และของขวัญจะถูกแปลงเป็น bean ในอัตรา 40%',
    errors: {
      empty: 'กรุณาป้อนตัวเลข',
      notWhole: 'กรุณาป้อนตัวเลขเต็ม',
      zero: 'กรอกตัวเลขที่มากกว่าศูนย์',
      tooLarge: 'ตัวเลขนั้นใหญ่เกินไป',
    },
  },
  language: {
    label: 'ภาษา',
    betaLabel: 'คำแปลเวอร์ชันเบต้า',
    betaNotice: 'คำแปลอาจไม่ถูกต้อง หากคุณพบข้อผิดพลาด โปรดแจ้งให้เราทราบ',
  },

  report: {
    open: 'แจ้งปัญหาคำแปล',
    intro: 'รายงานจะถูกส่งถึง Shyden และจะถูกลบเมื่อดำเนินการเรียบร้อยแล้ว',
    quoteLabel: 'คำใดที่ไม่ถูกต้อง',
    quoteHint: 'เริ่มพิมพ์แล้วเลือกคำจากรายการ หรือคัดลอกจากหน้านี้',
    suggestionLabel: 'ควรเขียนว่าอย่างไร (ไม่บังคับ)',
    noteLabel: 'มีอะไรเพิ่มเติมไหม (ไม่บังคับ)',
    noteHint: 'โปรดอย่าใส่ชื่อหรือข้อมูลติดต่อ',
    honeypotLabel: 'เว้นช่องนี้ว่างไว้',
    send: 'ส่งรายงาน',
    sent: 'ขอบคุณ รายงานของคุณถูกส่งแล้ว',
    notFound:
      'เราไม่พบคำเหล่านั้นในหน้านี้ เลือกคำจากรายการ หรือคัดลอกข้อความที่สั้นลงโดยไม่มีชื่อหรือตัวเลข',
    rejected: 'ไม่สามารถส่งรายงานนั้นได้ โปรดตรวจสอบแบบฟอร์มแล้วลองอีกครั้ง',
    failed: 'เกิดข้อผิดพลาด รายงานของคุณยังไม่ได้ส่ง โปรดลองอีกครั้งในภายหลัง',
  },
};

/**
 * The tables and the lookup live in `./index`, beside `getStrings`.
 *
 * This file used to end with `SITE_TABLE` and `getSiteStrings`, which meant
 * importing `isLocale`/`DEFAULT_LOCALE` as VALUES from `./index` -- and that
 * one import is why `scripts/i18n-translate.mjs` could not read this
 * catalogue: the harness runs under plain Node, which resolves neither an
 * extensionless `./index` nor the tree behind it, so every site string
 * (header, footer, homepage, 404) was invisible to the translator while
 * en.ts, which imports nothing, was not. #22 moved the lookup rather than
 * duplicating `isLocale` here, so there is still exactly one place that
 * decides what a locale is. This file is now pure data, like en.ts and id.ts.
 */
