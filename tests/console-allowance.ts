/**
 * The console errors the "loads without errors" checks let through: Safari's
 * unknown viewport key (operator decision 2026-10-18, issue 807) and macOS
 * WebKit's own media-control icons (#1008), each exact and on WebKit alone.
 *
 * Every page's viewport tag carries `interactive-widget=resizes-content`, so
 * Android Chrome's keyboard shrinks the page instead of hiding the Make Groups
 * bar while a teacher types. Safari does not know the key and logs this, as an
 * error, on every page (measured in CI: 20 "loads without errors" tests failed,
 * 10 on each WebKit engine). Visitors never see the console and the page works the
 * same. The allowance is exactly this text and only on WebKit, so any other
 * message, or this one anywhere else, still fails the check.
 */
export const SAFARI_UNKNOWN_VIEWPORT_KEY =
  'Viewport argument key "interactive-widget" not recognized and ignored.';

/**
 * macOS WebKit's built-in video controls, on the iPhone-emulated project, log
 * one line per placard icon they fail to load for the homepage video; `src` is
 * a blob URL WebKit makes itself, so it is matched by its UUID.
 * Not our code, and WebKit-GTK in CI never logs it (measured 2026-11-02,
 * Playwright 1.64.1's WebKit on the laptop: these three icons, #1008).
 */
export const WEBKIT_MEDIA_PLACARD =
  /^Button failed to load, iconName = (?:invalid|pip|airplay)-placard, layoutTraits = \[MacOSLayoutTraits Inline\], src = blob:\S+\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Whether `text`, logged as a console error by a page in `engine` (Playwright's
 * `browserType().name()`), is one of the messages the checks allow.
 */
export function isAllowedConsoleError(text: string, engine: string): boolean {
  return (
    engine === 'webkit' &&
    (text === SAFARI_UNKNOWN_VIEWPORT_KEY || WEBKIT_MEDIA_PLACARD.test(text))
  );
}
