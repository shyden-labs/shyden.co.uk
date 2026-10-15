import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { withoutCommentLines } from './source-text';
import { MVP_LOCALES } from '../../src/lib/i18n/metadata';

/**
 * The back-translation engine carries its models in the image (#666).
 *
 * The pinned LibreTranslate image ships with no models, and fetched them at
 * boot. On 2026-10-10 a boot whose DNS was failing came up "ready" with 5 of
 * the 8 directions and served anyway: id, vi and th could not be read back
 * at all, and nothing said so until a request came back 400. So the image
 * installs every model when it is BUILT, the build fails unless every
 * direction is there, and a boot downloads nothing.
 *
 * One list says which languages: `LT_LOAD_ONLY`. The install step and the
 * check both read it, and it must be exactly the site's locales.
 */

const DOCKERFILE = 'docker/libretranslate/Dockerfile';
const dockerfile = (): string =>
  withoutCommentLines(readFileSync(DOCKERFILE, 'utf8'));
const runLines = (): string[] =>
  dockerfile()
    .split('\n')
    .filter((line) => /^\s*RUN\s/.test(line))
    .map((line) => line.trim());

describe('the back-translation engine carries its models (#666)', () => {
  it('loads exactly the languages the site ships', () => {
    const match = /^\s*ENV\s+LT_LOAD_ONLY=(\S+)\s*$/m.exec(dockerfile());
    expect(match, `${DOCKERFILE} sets no LT_LOAD_ONLY`).not.toBeNull();
    expect((match?.[1] ?? '').split(',').sort()).toEqual(
      [...MVP_LOCALES].sort(),
    );
  });

  it('installs the models from that list when the image is built', () => {
    expect(
      runLines().filter((line) =>
        /install_models\.py\s+--load_only_lang_codes\s+"\$LT_LOAD_ONLY"/.test(
          line,
        ),
      ),
    ).toHaveLength(1);
  });

  it('fails the build unless every direction to and from English is installed', () => {
    const checks = runLines().filter((line) => line.includes('missing models'));
    expect(checks).toHaveLength(1);
    const check = checks[0] ?? '';
    expect(check).toContain("os.environ['LT_LOAD_ONLY']");
    expect(check).toMatch(/\(['"]en['"],\s*l\),\s*\(l,\s*['"]en['"]\)/);
    expect(check).toMatch(/sys\.exit\(/);
  });

  // The models list is not all a translation fetches: argostranslate's
  // sentence splitter (MiniSBD) downloads a model on the first Chinese
  // request, into a cache the install never fills. Booted with no network,
  // the first build here answered id, vi and th and failed zh with a 500. So
  // the build translates once in every direction, and every lazy download
  // happens then or fails the build.
  it('translates once in every direction while it builds', () => {
    const warm = runLines().filter((line) => line.includes('missing models'));
    expect(warm[0] ?? '').toMatch(
      /argostranslate\.translate\.translate\(\s*['"][^'"]+['"],\s*a,\s*b\s*\)/,
    );
    expect(warm[0] ?? '').toMatch(/for a, b in sorted\(want\)/);
  });

  it('installs before it checks', () => {
    const runs = runLines();
    const install = runs.findIndex((line) =>
      line.includes('install_models.py'),
    );
    const check = runs.findIndex((line) => line.includes('missing models'));
    expect(install).toBeGreaterThanOrEqual(0);
    expect(check).toBeGreaterThan(install);
  });
});
