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

/**
 * The HTML with every third-party licence notice taken out (#1266). Shyden,
 * 2026-11-23: a notice is shown exactly as its authors published it, so an
 * author's address inside one is not the site showing an address. Only a
 * `<pre data-third-party-notice>` is taken out, each up to its own closing
 * tag; its text is escaped, so it holds no `</pre>` of its own.
 */
export function outsideThirdPartyNotices(html: string): string {
  return html.replace(
    /<pre\b[^>]*\bdata-third-party-notice\b[^>]*>[\s\S]*?<\/pre>/gi,
    '',
  );
}
