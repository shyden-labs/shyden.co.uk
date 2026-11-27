/**
 * Every path a device run writes on the Android phone, in one place, so the
 * end-of-run cleanup removes exactly what the harness wrote (#1326). The
 * shared phones filled to 98% on 2026-11-28 with what runs left behind.
 */
export const ANDROID_RUN_FILES = Object.freeze({
  /** `uiautomator dump`'s target on every Chrome settings walk. */
  uiDump: '/sdcard/ui.xml',
  /** The screen a failed settings walk captures, pulled to the Mac. */
  walkScreenshot: '/sdcard/chrome-settings-walk.png',
  /** The one folder the suite's downloads land in (#308). */
  downloads: '/sdcard/Download/shyden-gauntlet',
});
