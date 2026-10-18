/**
 * The one console error the "loads without errors" checks let through
 * (operator decision 2026-10-18, issue 807).
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
 * Whether `text`, logged as a console error by a page in `engine` (Playwright's
 * `browserType().name()`), is the one message the checks allow.
 */
export function isAllowedConsoleError(text: string, engine: string): boolean {
  return engine === 'webkit' && text === SAFARI_UNKNOWN_VIEWPORT_KEY;
}
