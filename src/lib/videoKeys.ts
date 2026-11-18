/**
 * Space and Enter on the focused preview video start and stop it, on every
 * browser (Shyden, 2026-11-18, #1054). Measured in CI: Chromium's and
 * Firefox's own players play on Space, Linux WebKit's does not. The page
 * therefore owns these two keys and stops the browser's own handling, so a
 * press never toggles twice. A key with a modifier held, and every other key,
 * stays the browser's.
 */

/** The parts of a `KeyboardEvent` this reads. */
export interface VideoKey {
  readonly key: string;
  readonly repeat: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  preventDefault(): void;
}

/** The parts of an `HTMLMediaElement` this drives. */
export interface PlayableVideo {
  readonly paused: boolean;
  play(): Promise<void>;
  pause(): void;
}

const TOGGLE_KEYS: ReadonlySet<string> = new Set([' ', 'Enter']);

/** Handles one keydown on the video; true when the page took the key. */
export function onVideoKey(event: VideoKey, video: PlayableVideo): boolean {
  if (!TOGGLE_KEYS.has(event.key)) return false;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
    return false;
  event.preventDefault();
  if (event.repeat) return true;
  if (video.paused) {
    // A refused play leaves the video paused, which the visitor sees.
    video.play().catch(() => {});
  } else {
    video.pause();
  }
  return true;
}
