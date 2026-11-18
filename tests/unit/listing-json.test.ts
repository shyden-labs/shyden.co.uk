import { describe, expect, it } from 'vitest';
import { testsOfListing } from '../listing-json';

/**
 * Playwright's JSON listing gives each spec file relative to its config's
 * `rootDir`, and the desktop config's root (`tests/e2e`) is not the phone
 * config's (`tests`). A test's id is therefore read relative to the
 * repository, so the same test has one id in both listings (#1200: without
 * this, every test looked missing from every target, 3228 findings on run
 * 44223168105).
 */
const listing = (rootDir: string, file: string, project: string) => ({
  config: { rootDir },
  suites: [
    {
      title: file,
      specs: [],
      suites: [
        {
          title: 'a group',
          specs: [
            {
              title: 'a test',
              file,
              tags: ['@phone'],
              tests: [
                {
                  projectName: project,
                  annotations: [{ type: 'group-only', description: 'touch' }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

describe('testsOfListing', () => {
  it('gives a test the same repository-relative id whichever config root listed it', () => {
    const desktop = testsOfListing(
      listing('/repo/tests/e2e', 'homepage.spec.ts', 'chromium'),
      '/repo',
    );
    const phone = testsOfListing(
      listing('/repo/tests', 'e2e/homepage.spec.ts', 'android-chrome'),
      '/repo',
    );
    expect(desktop.map((t) => t.id)).toEqual([
      'tests/e2e/homepage.spec.ts › a group › a test',
    ]);
    expect(phone.map((t) => t.id)).toEqual(desktop.map((t) => t.id));
  });

  it('keeps each test’s project, tags and annotations', () => {
    expect(
      testsOfListing(
        listing('/repo/tests', 'e2e/a.spec.ts', 'android-chrome'),
        '/repo',
      ),
    ).toEqual([
      {
        id: 'tests/e2e/a.spec.ts › a group › a test',
        project: 'android-chrome',
        tags: ['@phone'],
        annotations: [{ type: 'group-only', description: 'touch' }],
      },
    ]);
  });
});
