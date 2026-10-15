import { describe, expect, it } from 'vitest';
import {
  pageNames,
  sitePaths,
  deployedRoutes,
  headingFor,
  HEADING_FOR,
  TITLE_FOR,
} from '../site-pages';
import { LOCALES } from '../../src/lib/i18n';
import { scratchDir } from '../scratch-dir';
import { floorBreach } from '../floors';

describe('the site page list is derived from src/pages', () => {
  it('reads real pages off disk', () => {
    // Anti-vacuity: an empty derivation would satisfy every assertion below.
    expect(floorBreach('site-pages/pages', pageNames().length)).toBeUndefined();
    expect(pageNames()).toContain('index');
  });

  it('excludes 404, which has no per-locale twin', () => {
    expect(pageNames()).not.toContain('404');
  });

  it('serves index at the site root, every other page at its own name', () => {
    expect(sitePaths()).toContain('/');
    expect(sitePaths()).toContain('/yeetalk-calculators');
    expect(sitePaths()).toHaveLength(pageNames().length);
  });
});

describe('the page list refuses to answer blind (#84)', () => {
  it('throws when the pages directory holds no page', () => {
    // A real empty directory, not a mock: `locale-routing.test.ts` loops this
    // list five times and `thai-typography.spec.ts` builds its routes from it,
    // and all six tests passed green while it was empty.
    const empty = scratchDir('shyden-pages-');
    expect(() => pageNames(empty)).toThrow(/broken/);
  });
});

describe('the deployed-route table is derived, not written out (#89)', () => {
  it('knows a heading for every page the site serves', () => {
    // The guard that makes a new page loud instead of silent. Both deploy
    // gates hand-wrote the same three pages -- byte-identical blocks in
    // dev-sanity.spec.ts and prod-sanity.spec.ts -- so a fourth page was
    // smoked by curl in deploy-prod.yml and never rendered in a browser by
    // either gate. Measured: `--list` reported 28 tests before and after.
    expect(Object.keys(HEADING_FOR).sort()).toEqual([...sitePaths()].sort());
  });

  it('knows a title for every page the site serves (#390 F130)', () => {
    // locale-parity.spec.ts checked <title> on a hand-written two of three.
    expect(Object.keys(TITLE_FOR).sort()).toEqual([...sitePaths()].sort());
  });

  it('covers every page in every locale', () => {
    expect(deployedRoutes()).toHaveLength(sitePaths().length * LOCALES.length);
  });

  it('gives every route a real heading and an English twin to differ from', () => {
    for (const route of deployedRoutes()) {
      expect(route.heading, `${route.path} has no heading`).toBeTruthy();
      expect(
        route.englishHeading,
        `${route.path} has no English heading to compare against`,
      ).toBeTruthy();
    }
  });

  it('refuses a page it has no heading for, rather than skipping it', () => {
    expect(() => headingFor('/not-a-page')).toThrow(/not-a-page/);
  });
});
