/**
 * Geometry for the ShyTalk showcase device frame on the homepage.
 *
 * One home for the numbers, because the Astro component's frame and the guard
 * that refuses a capture of the wrong size must agree, and neither can see
 * the other. The captures themselves are made outside this repo, from the
 * device named below, and have to arrive at `ROOM_CAPTURE_PIXELS`; the guard
 * is what holds them to it. Restating a measured value in a second place is
 * how the `:lang(th)` line-height was silently undone (#17).
 *
 * The aspect is not chosen, it is DERIVED from the capture device so nothing
 * is letterboxed or cropped: the OnePlus CPH2653 renders 1440x3168, which is
 * 1:2.2. `CSS_HEIGHT` is `CSS_WIDTH / (1440 / 3168)` rounded to an integer.
 *
 * `SCALE` 2 is the ticket's "sized for the frame at 2x and no larger"
 * (#138). Larger is not free: the site shipped ZERO content rasters before
 * this, so every byte here is a new cost on a page that had none. Only ONE
 * capture is ever served to a given visitor -- the one matching their
 * locale -- so the per-visit cost is one image, not five.
 */
export const ROOM_CAPTURE = {
  /** Inner width of the bezel in CSS pixels at the desktop breakpoint. */
  CSS_WIDTH: 280,
  /** Inner height, derived from the capture device's 1440x3168 aspect. */
  CSS_HEIGHT: 616,
  /** Device-pixel-ratio the source captures are authored at. */
  SCALE: 2,
} as const;

/** Intrinsic pixel size every source capture must have, exactly. */
export const ROOM_CAPTURE_PIXELS = {
  width: ROOM_CAPTURE.CSS_WIDTH * ROOM_CAPTURE.SCALE,
  height: ROOM_CAPTURE.CSS_HEIGHT * ROOM_CAPTURE.SCALE,
} as const;

/** Directory holding the per-locale room captures, repo-relative. */
export const ROOM_CAPTURE_DIR = 'src/assets/shytalk';

/** Repo-relative path of one locale's capture. */
export const roomCapturePath = (locale: string): string =>
  `${ROOM_CAPTURE_DIR}/room-${locale}.png`;
