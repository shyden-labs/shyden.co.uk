/**
 * Every `workers.dev` host named in a text, lower-cased, once each, in the
 * order first met (#1032 AC4). A host is one or more labels ending in
 * `.workers.dev` at a word boundary, so `workers.develop.example` is not one.
 */
export function workersDevHosts(text: string): string[] {
  const found = text.match(/\b(?:[a-z0-9-]+\.)+workers\.dev\b(?![.-]\w)/gi);
  return [...new Set((found ?? []).map((host) => host.toLowerCase()))];
}
