import { adb } from '../../scripts/adb.mjs';
import type { Download } from '@playwright/test';

/**
 * Downloads on the real Android phone (#308): where they go, how their bytes come back, and the
 * one deletion the suite performs on the phone.
 *
 * Playwright attaches to the phone with `chromium.connectOverCDP`, so it does not know it is
 * driving Android Chrome. On attach it sends `Browser.setDownloadBehavior` pointing downloads at
 * a temp folder on the MAC, and skips that only for a browser it recognises as `clank`, the name
 * its own `_android` driver gives Android Chrome. The phone was being told to save into a folder
 * that does not exist on it: measured on 2026-09-22, every export in the phone run ended
 * `canceled` with 0 bytes while its tests passed, because they only checked the filename.
 *
 * The same probe measured the way out: Android Chrome honours a downloadPath ON THE PHONE and
 * creates the folder, and its own default behaviour saves the whole file too, so the product was
 * never at fault.
 */

/** True in a run of `playwright.device.config.ts`, which sets the variable as it loads. */
export const onRealDevice = (): boolean => process.env.PW_REAL_DEVICE === '1';

/**
 * The one folder the suite writes to on the phone, a folder of its own under Downloads, so a
 * run never touches anything else a person keeps there.
 */
export const DEVICE_DOWNLOADS = '/sdcard/Download/shyden-gauntlet';

/**
 * What the real-device fixture tells Chrome after attaching, replacing Playwright's host path.
 * `allow` keeps each file's suggested name; `eventsEnabled` keeps `page.waitForEvent('download')`
 * and `download.failure()` working, because Playwright learns about downloads from those events.
 */
export const DEVICE_DOWNLOAD_BEHAVIOUR = {
  behavior: 'allow',
  downloadPath: DEVICE_DOWNLOADS,
  eventsEnabled: true,
} as const;

/** The only deletion the suite performs on the phone: the folder above, and nothing else. */
export const emptyDeviceDownloadsArgs = (): string[] => [
  'shell',
  'rm',
  '-rf',
  DEVICE_DOWNLOADS,
];

export function emptyDeviceDownloads(): void {
  adb(emptyDeviceDownloadsArgs());
}

/**
 * Quotes one argument for the phone's shell: `adb shell` and `adb exec-out` join their arguments
 * with spaces and hand the result to `sh`, so a filename with a space would otherwise split.
 */
export const forDeviceShell = (value: string): string =>
  `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * The bytes a download wrote on the phone, read back over adb. Waits for the download to finish,
 * and throws naming why when it did not complete, which is what every export in the phone run
 * silently did until #308.
 */
export async function deviceDownloadText(download: Download): Promise<string> {
  const failure = await download.failure();
  if (failure !== null) {
    throw new Error(
      `the download "${download.suggestedFilename()}" did not complete on the phone: ${failure}`,
    );
  }
  const path = `${DEVICE_DOWNLOADS}/${download.suggestedFilename()}`;
  return adb(['exec-out', `cat ${forDeviceShell(path)}`]);
}
