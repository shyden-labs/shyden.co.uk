import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { floorBreach } from '../floors';
import {
  dependentsOf,
  importersIn,
  maxStaleBranch,
  remoteImageAllowances,
} from '../remote-images';
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
    expect(
      searched(findings, { of: properties, what: 'config properties' }),
    ).toEqual([]);
    expect(
      floorBreach(
        'remote-images/no-remote-image-properties',
        properties.length,
      ),
    ).toBeUndefined();
  });

  it('is not satisfied, nor refused, by a comment naming a domain', () => {
    const { findings, properties } = remoteImageAllowances(
      config("  // image: { domains: ['cdn.x.test'] },"),
    );
    expect(properties).toEqual(['site']);
    expect(
      searched(findings, { of: properties, what: 'config properties' }),
    ).toEqual([]);
    expect(
      floorBreach('remote-images/comment-only-properties', properties.length),
    ).toBeUndefined();
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

/**
 * The config guard rests on how Astro reaches http-cache-semantics, read in
 * astro 7.3.5 (2026-10-06, #457): the build loads a remote image
 * (assets/build/generate.js -> loadRemoteImage in assets/build/remote.js, the
 * library's only importer) only when isRemoteAllowed passes, which is true
 * only for a URL matching image.domains or image.remotePatterns. Two facts are
 * checked on every version; the third, that the gate still stands, needs a
 * reader, so a new version fails here until someone has re-read it.
 */
const ASTRO_READ = '7.3.5';

describe('the path into http-cache-semantics is the one #457 read', () => {
  it('only astro depends on http-cache-semantics', () => {
    expect(
      dependentsOf(
        readFileSync('package-lock.json', 'utf8'),
        'http-cache-semantics',
      ),
    ).toEqual(['node_modules/astro']);
  });

  it("inside astro, only the build's remote-image cache imports it", () => {
    expect(
      importersIn('node_modules/astro/dist', 'http-cache-semantics'),
    ).toEqual(['assets/build/remote.js']);
  });

  it('fails on any Astro version whose remote-image path nobody has re-read', () => {
    const { version } = JSON.parse(
      readFileSync('node_modules/astro/package.json', 'utf8'),
    ) as { version: string };
    expect(
      version,
      `astro is ${version}, but its remote-image path was read on ${ASTRO_READ} (#457). ` +
        'Before moving ASTRO_READ, re-read that the build still loads a remote image ' +
        '(assets/build/generate.js, loadRemoteImage) only when isRemoteAllowed passes, ' +
        'and that this is still true only for image.domains and image.remotePatterns. ' +
        'If it is not, the config guard no longer covers the path: say so on #457.',
    ).toBe(ASTRO_READ);
  });
});
