/**
 * Readers for #457: whether the build may fetch a remote image, and whether
 * the installed `http-cache-semantics` still serves `max-stale` ungated.
 *
 * GHSA-ch52-4w7c-c8xp: `http-cache-semantics` <= 4.2.0 serves a shared-cache
 * entry it deliberately zeroed (another user's `Set-Cookie`) to any request
 * with a large `max-stale`. Upstream closed the report as not planned, and
 * 4.3.0 leaves that branch byte-identical. In this tree its only importer is
 * Astro's build-time cache for REMOTE images, which runs only for a URL the
 * config authorises (`image.domains`, `image.remotePatterns`), so the config
 * is the control these readers make mechanical.
 */
import ts from 'typescript';
import { parseSource } from './unit/ast';

/** What the config reader saw: every authorising construct, and how much it read. */
export interface Allowances {
  /** Each construct that lets the build fetch a remote image, or that cannot be classified. */
  readonly findings: readonly string[];
  /** Every property the reader examined, in the order it met them. */
  readonly properties: readonly string[];
}

/** Reads `astro.config.*` text for anything that authorises a remote image. */
export function remoteImageAllowances(config: string): Allowances {
  const sf = parseSource(config, 'astro.config.mjs');
  const options: ts.ObjectLiteralExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'defineConfig' &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    )
      options.push(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (options.length !== 1)
    throw new Error(
      `expected one defineConfig object to read in the config, found ${options.length}`,
    );
  const findings: string[] = [];
  const properties: string[] = [];
  const read = (object: ts.ObjectLiteralExpression, prefix: string): void => {
    for (const element of object.properties) {
      if (ts.isSpreadAssignment(element)) {
        // A spread brings in options this reader cannot see.
        properties.push(`${prefix}...`);
        findings.push(
          `${prefix}...${element.expression.getText(sf)} (cannot be read)`,
        );
        continue;
      }
      const name = element.name?.getText(sf).replace(/^['"]|['"]$/g, '') ?? '?';
      const path = `${prefix}${name}`;
      properties.push(path);
      const value = ts.isPropertyAssignment(element)
        ? element.initializer
        : undefined;
      if (path === 'image.domains' || path === 'image.remotePatterns')
        findings.push(path);
      if (value && ts.isObjectLiteralExpression(value)) read(value, `${path}.`);
      else if (path === 'image')
        findings.push('image (cannot be read: not an object literal)');
    }
  };
  read(options[0], '');
  return { findings, properties };
}

/** Reads `http-cache-semantics`' index.js: is its `max-stale` branch gated for shared Set-Cookie entries? */
export function maxStaleBranch(source: string): 'gated' | 'ungated' {
  const sf = parseSource(source, 'index.js');
  const found: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'allowsStaleWithoutRevalidation' &&
      node.initializer
    )
      found.push(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (found.length !== 1)
    throw new Error(
      `expected one allowsStaleWithoutRevalidation in the cache source, found ${found.length}: ` +
        're-read GHSA-ch52-4w7c-c8xp against it (#457)',
    );
  // Gated when the condition consults what the advisory says it ignores:
  // whether the cache is shared, or whether the entry carries a Set-Cookie.
  let gated = false;
  const look = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) && node.text === 'set-cookie') gated = true;
    if (ts.isPropertyAccessExpression(node) && node.name.text === '_isShared')
      gated = true;
    ts.forEachChild(node, look);
  };
  look(found[0]);
  return gated ? 'gated' : 'ungated';
}
