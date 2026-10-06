import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { floorBreach } from '../floors';
import { maxStaleBranch, remoteImageAllowances } from '../remote-images';
import { searched } from '../source-files';

/**
 * #457, GHSA-ch52-4w7c-c8xp (Dependabot alert 13). `http-cache-semantics`
 * serves a shared-cache entry it deliberately zeroed, another user's
 * Set-Cookie, to a request with a large `max-stale`. No fix is coming:
 * upstream closed the report as not planned (kornelski/http-cache-semantics#56),
 * and 4.3.0 leaves that branch byte-identical. The operator's decision
 * (2026-10-06): guard it, pin it, keep the alert open.
 */

const CONFIG = 'astro.config.mjs';
const CACHE = 'node_modules/http-cache-semantics/index.js';

/** The branch as 4.2.0 ships it (index.js, the stale path). */
const UNGATED = `
class CachePolicy {
  satisfiesWithoutRevalidation(req) {
    if (this.stale()) {
      const allowsStaleWithoutRevalidation = 'max-stale' in requestCC &&
        (true === requestCC['max-stale'] || requestCC['max-stale'] > this.age() - this.maxAge());
      if (allowsStaleWithoutRevalidation) return hit;
    }
  }
}`;

/** The gate the upstream report proposes for that branch. */
const GATED = UNGATED.replace(
  "'max-stale' in requestCC &&",
  "'max-stale' in requestCC &&\n        !(this._isShared && this._resHeaders['set-cookie'] && !this._rescc.public) &&",
);

describe('maxStaleBranch reads the advisory construct from the parse tree', () => {
  it('reads the branch 4.2.0 ships as ungated', () => {
    expect(maxStaleBranch(UNGATED)).toBe('ungated');
  });

  it('reads the gate the upstream report proposes as gated', () => {
    expect(GATED).not.toBe(UNGATED);
    expect(maxStaleBranch(GATED)).toBe('gated');
  });

  it.each([
    ['whether the cache is shared', '!this._isShared &&'],
    [
      'whether the entry carries a Set-Cookie',
      "!this._resHeaders['set-cookie'] &&",
    ],
  ])('reads a gate on %s alone as gated', (_signal, gate) => {
    const gated = UNGATED.replace(
      "'max-stale' in requestCC &&",
      `'max-stale' in requestCC &&\n        ${gate}`,
    );
    expect(gated).not.toBe(UNGATED);
    expect(maxStaleBranch(gated)).toBe('gated');
  });

  it('is not satisfied by a comment naming the gate', () => {
    const commented = UNGATED.replace(
      'if (allowsStaleWithoutRevalidation)',
      "// gated: this._isShared && this._resHeaders['set-cookie']\n      if (allowsStaleWithoutRevalidation)",
    );
    expect(commented).not.toBe(UNGATED);
    expect(maxStaleBranch(commented)).toBe('ungated');
  });

  it('refuses a source whose stale branch it cannot find', () => {
    expect(() => maxStaleBranch('export const x = 1;')).toThrow(
      'allowsStaleWithoutRevalidation',
    );
  });
});

describe('remoteImageAllowances reads what lets the build fetch a remote image', () => {
  const config = (body: string) =>
    `import { defineConfig } from 'astro/config';\nexport default defineConfig({\n  site: 'https://x.test',\n${body}\n});\n`;

  it.each([
    ['image.domains', "  image: { domains: ['cdn.x.test'] },", 'image.domains'],
    [
      'image.remotePatterns',
      "  image: { remotePatterns: [{ protocol: 'https' }] },",
      'image.remotePatterns',
    ],
    ['an image option it cannot read', '  image: imageOptions,', 'image'],
    ['a spread into the config', '  ...shared,', '...'],
  ])('finds %s', (_form, body, named) => {
    const { findings } = remoteImageAllowances(config(body));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain(named);
  });

  it('finds nothing in a config that authorises no remote image', () => {
    const { findings, properties } = remoteImageAllowances(
      config(
        "  image: { layout: 'constrained' },\n  build: { format: 'directory' },",
      ),
    );
    expect(properties).toEqual([
      'site',
      'image',
      'image.layout',
      'build',
      'build.format',
    ]);
    expect(findings).toEqual([]);
  });

  it('is not satisfied, nor refused, by a comment naming a domain', () => {
    const { findings, properties } = remoteImageAllowances(
      config("  // image: { domains: ['cdn.x.test'] },"),
    );
    expect(properties).toEqual(['site']);
    expect(findings).toEqual([]);
  });

  it('refuses a config with no defineConfig object to read', () => {
    expect(() => remoteImageAllowances('export default {};')).toThrow(
      'defineConfig',
    );
  });
});

describe('the build fetches no remote image while the cache is unfixed (#457)', () => {
  it('astro.config.mjs authorises no remote image while max-stale is ungated', () => {
    const cache = maxStaleBranch(readFileSync(CACHE, 'utf8'));
    const { findings, properties } = remoteImageAllowances(
      readFileSync(CONFIG, 'utf8'),
    );
    expect(
      searched(cache === 'ungated' ? findings : [], {
        of: properties,
        what: `properties in ${CONFIG}`,
      }),
      `${CACHE} still serves max-stale ungated (GHSA-ch52-4w7c-c8xp, #457): ` +
        'a remote image would put it in the build',
    ).toEqual([]);
    expect(
      floorBreach('remote-images/config-properties', properties.length),
    ).toBeUndefined();
  });

  it('keeps http-cache-semantics pinned to 4.2.0, so a refresh cannot read as a fix', () => {
    // 4.3.0 sits outside the advisory's <= 4.2.0 range with the same
    // max-stale code, so pulling it would mark alert 13 fixed over an
    // unchanged bug. A real fix, if one ships, lifts this pin in its own ticket.
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      overrides?: Record<string, string>;
    };
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
      packages: Record<string, { version?: string }>;
    };
    expect(manifest.overrides?.['http-cache-semantics'], '#457').toBe('4.2.0');
    expect(
      lock.packages['node_modules/http-cache-semantics']?.version,
      '#457',
    ).toBe('4.2.0');
    expect(maxStaleBranch(readFileSync(CACHE, 'utf8'))).toBe('ungated');
  });
});
