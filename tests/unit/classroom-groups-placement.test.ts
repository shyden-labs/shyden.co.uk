import { describe, it, expect } from 'vitest';
import { en } from '../../src/lib/i18n/en';
import { id } from '../../src/lib/i18n/id';
import { zh } from '../../src/lib/i18n/zh';
import { vi } from '../../src/lib/i18n/vi';
import { th } from '../../src/lib/i18n/th';

// /classroom-groups opens with WHO it is for and WHY it exists, and How to
// use starts with WHAT it does (operator, 2026-09-30, #384). The two had
// been the other way round since the v2 design spec's section 3. Pinned per
// locale, because a swap made in English alone would pass every other copy
// guard: both sentences stay translated, non-blank and rendered.
describe('classroom groups: the lead says who and why, How to use says what (#384)', () => {
  it.each([
    [
      'en',
      en,
      'Built for teachers, by Shyden. Splitting a class fairly takes time you do not have, and doing it by hand invites an argument about favourites. This does it in one press — free, with no sign-up, and with nothing about your class ever leaving your browser.',
      'Tell it how big your class is and how many students you want per group. It shuffles and deals everyone out, and no group ever ends up smaller than you asked for.',
    ],
    [
      'id',
      id,
      'Dibuat untuk para guru, oleh Shyden. Membagi kelas dengan adil memakan waktu yang tidak Anda miliki, dan melakukannya secara manual mengundang perdebatan soal pilih kasih. Ini melakukannya dalam satu tekan — gratis, tanpa perlu mendaftar, dan tidak ada data kelas Anda yang pernah meninggalkan peramban Anda.',
      'Masukkan jumlah siswa di kelas Anda dan berapa siswa yang Anda inginkan per kelompok. Alat ini akan mengacak dan membagikan semuanya, dan tidak ada kelompok yang jumlahnya kurang dari yang Anda tentukan.',
    ],
    [
      'zh',
      zh,
      '由Shyden专为教师打造。公平地给全班分组需要花费您本就不多的时间，而手动操作又容易引发关于“偏袒”的争议。只需一次点击，即可完成分组——完全免费，无需注册，且有关您班级的信息绝不会离开您的浏览器。',
      '只需输入班级人数以及每组希望安排多少名学生，系统就会自动将学生随机分组，确保每个小组的人数都不会少于您设定的最低人数。',
    ],
    [
      'vi',
      vi,
      'Được phát triển dành cho giáo viên, bởi Shyden. Việc chia lớp một cách công bằng tốn thời gian mà bạn không có, và nếu làm thủ công thì dễ dẫn đến tranh cãi về việc thiên vị. Công cụ này giúp bạn hoàn thành việc đó chỉ với một cú nhấp chuột — miễn phí, không cần đăng ký, và mọi thông tin về lớp học của bạn sẽ không bao giờ rời khỏi trình duyệt.',
      'Hãy cho chương trình biết lớp của bạn có bao nhiêu học sinh và bạn muốn mỗi nhóm có bao nhiêu học sinh. Chương trình sẽ xáo trộn danh sách và phân chia học sinh vào các nhóm, đồng thời đảm bảo không có nhóm nào có số lượng học sinh ít hơn số lượng bạn yêu cầu.',
    ],
    [
      'th',
      th,
      'ออกแบบมาสำหรับครู โดยShyden การแบ่งชั้นเรียนให้ยุติธรรมนั้นใช้เวลามาก ซึ่งคุณอาจไม่มีเวลาพอ และการทำด้วยมืออาจก่อให้เกิดข้อโต้แย้งว่าครูมีนักเรียนคนโปรด การแบ่งชั้นเรียนนี้ทำได้เพียงคลิกเดียว — ฟรี ไม่ต้องสมัคร และข้อมูลเกี่ยวกับชั้นเรียนของคุณจะไม่ถูกส่งออกจากเบราว์เซอร์เลย',
      'บอกระบบว่าชั้นเรียนของคุณมีนักเรียนกี่คน และต้องการให้นักเรียนในกลุ่มละกี่คน ระบบจะสับเปลี่ยนและจัดนักเรียนให้แต่ละกลุ่ม โดยไม่มีกลุ่มใดที่มีจำนวนนักเรียนน้อยกว่าที่คุณกำหนด',
    ],
  ] as const)('%s', (_locale, catalogue, lead, howToWhat) => {
    expect(catalogue.lead).toBe(lead);
    expect(catalogue.howToWhat).toBe(howToWhat);
  });
});
