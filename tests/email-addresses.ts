/**
 * Every email address and `mailto:` link in a text, once each, in the order
 * first met (#1266; Shyden, 2026-11-23: no page shows an email address). A
 * `mailto:` is reported as the bare scheme, since a link can name no address
 * and still hand the visitor one. An `@` written as an HTML entity is read as
 * an `@`, so an address cannot hide behind `&#64;`. An address needs a local
 * part before the `@` and a dotted domain after it, so a package scope
 * (`@fontsource/inter`), a CSS at-rule or a handle is not one.
 */
export function emailAddresses(text: string): string[] {
  const decoded = text.replace(/&#0*64;|&#x0*40;|&commat;/gi, '@');
  const found = decoded.match(
    /mailto:|\b[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi,
  );
  return [...new Set((found ?? []).map((hit) => hit.toLowerCase()))];
}
