/**
 * A robots.txt body's directives, one per line, without its comment lines or
 * blank lines (#390).
 *
 * The checks this serves read `toContain('Disallow: /')`, a substring that a
 * body disallowing only `/private` satisfies. Compared whole, the directives
 * say what a crawler is actually told.
 */
export const robotsDirectives = (body: string): string[] =>
  body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
