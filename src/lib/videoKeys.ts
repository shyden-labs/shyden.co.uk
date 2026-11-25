/**
 * Space and Enter on the focused preview video start and stop it, on every
 * browser (Shyden, 2026-11-18, #1054). Measured in CI: Chromium's and
 * Firefox's own players play on Space, Linux WebKit's does not. The page
 * therefore owns these two keys and stops the browser's own handling, so a
 * press never toggles twice. A key with a modifier held, and every other key,
 * stays the browser's.
 *
 * A key the page takes is also stopped on its way down: Chromium's player,
 * inside the video, handles the key before any listener on the video runs, so
 * stopping its default there is too late (measured, CI run 44393520871: one
 * Space played and paused). The page listens on the window, in the capture
 * phase, and the player never sees a key the page took.
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
  stopPropagation(): void;
}

/** The parts of an `HTMLMediaElement` this drives. */
export interface PlayableVideo {
  readonly paused: boolean;
  play(): Promise<void>;
  pause(): void;
}

const TOGGLE_KEYS: ReadonlySet<string> = new Set([' ', 'Enter']);

/** Space or Enter with no modifier held: the keys the page takes. */
const takes = (event: VideoKey): boolean =>
  TOGGLE_KEYS.has(event.key) &&
  !(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey);

/** Handles one keydown on the video; true when the page took the key. */
export function onVideoKey(event: VideoKey, video: PlayableVideo): boolean {
  if (!takes(event)) return false;
  event.preventDefault();
  event.stopPropagation();
  if (event.repeat) return true;
  if (video.paused) {
    // A refused play leaves the video paused, which the visitor sees.
    video.play().catch(() => {});
  } else {
    video.pause();
  }
  return true;
}

/**
 * Handles one keyup on the video; true when the page took the key. Chromium's
 * player toggles on the keyup of Space (measured, CI run 44392126826: the
 * video played and paused again on one press), so the keyup of a key the page
 * took is kept from the browser too. It toggles nothing itself.
 */
export function onVideoKeyUp(event: VideoKey): boolean {
  if (!takes(event)) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}
