/**
 * One cycle of Chromium's media-controls loading spinner, `mask-1-spin` in
 * `mediaControls_loading.css` (#968). Leaving the loading state does not hide
 * the spinner: it finishes the cycle it is in, so a video that has been idle
 * for one whole cycle is drawn without it.
 */
export const SPIN_CYCLE_MS = 1_333;

/**
 * Whether every `<video>` on the page has read `NETWORK_IDLE`, without a
 * break, for at least `cycle` ms (#968). A page script cannot see the spinner
 * itself: it runs in the user agent's closed shadow tree, and
 * `getAnimations()` lists nothing while it spins (measured on Chromium 156,
 * #968), so its own state is read instead.
 *
 * Run in the page once per poll by `page.waitForFunction`, which serialises
 * it, so it is self-contained: each video keeps when it was first seen idle
 * on itself, and every video is read on every poll, so one still loading
 * does not stop the others' cycles from starting.
 */
export function videosIdleFor(cycle: number): boolean {
  const now = performance.now();
  const videos = [...document.querySelectorAll('video')] as (Pick<
    HTMLVideoElement,
    'networkState' | 'NETWORK_IDLE'
  > & { idleSince?: number })[];
  return videos
    .map((video) => {
      if (video.networkState !== video.NETWORK_IDLE) {
        delete video.idleSince;
        return false;
      }
      video.idleSince ??= now;
      return now - video.idleSince >= cycle;
    })
    .every(Boolean);
}
