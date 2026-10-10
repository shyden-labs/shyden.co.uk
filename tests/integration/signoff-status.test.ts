import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { IDS, PAGE, EMPTY_PAGE, stored } from '../signoff-status-shared';

/**
 * The check run before a ticket with an evidence page merges (#197): the
 * page's own comparison, over the page as published and its stored sign-off.
 * #188's approval was given on 12 journeys and still read "approved" once the
 * page showed 13, which reading the stored verdict by eye could not see.
 */

const SCRIPT = fileURLToPath(
  new URL('../../scripts/signoff-status.mjs', import.meta.url),
);

describe('run before a merge, it answers in its exit status', () => {
  const dir = mkdtempSync(join(tmpdir(), 'signoff-status-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const fileOf = (name: string, text: string): string => {
    const path = join(dir, name);
    writeFileSync(path, text);
    return path;
  };
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

  it('exits 0, saying so, for an approval of exactly the published journeys', () => {
    const result = run(
      fileOf('current.html', PAGE),
      fileOf('current.json', JSON.stringify(stored('approved', IDS))),
    );
    expect(result.stdout).toBe(
      'SIGNED OFF: the approval covers all 3 journeys on the published page\n',
    );
    expect(result.status).toBe(0);
  });

  it('exits 1, naming what changed, for an approval the page has outgrown', () => {
    const result = run(
      fileOf('stale.html', PAGE),
      fileOf('stale.json', JSON.stringify(stored('approved', IDS.slice(0, 2)))),
    );
    expect(result.stdout).toBe(
      'OUT OF DATE: approved before the page changed; added since: the-third-journey\n',
    );
    expect(result.status).toBe(1);
  });

  it('gives no verdict, and exits 2, when it cannot read what it was given', () => {
    const page = fileOf('page.html', PAGE);
    const doc = fileOf('doc.json', JSON.stringify(stored('approved', IDS)));
    const unreadable: string[][] = [
      [],
      [page],
      [page, join(dir, 'missing.json')],
      [join(dir, 'missing.html'), doc],
      [page, fileOf('broken.json', '{')],
      // Readable inputs and one argument too many: ignoring it would answer
      // a question the caller did not ask (#227).
      [page, doc, '--strict'],
      [fileOf('not-a-page.html', '<title>not an evidence page</title>'), doc],
      // An approval of nothing, on a page of nothing, is not a sign-off.
      [
        fileOf('no-journeys.html', EMPTY_PAGE),
        fileOf('covers-nothing.json', JSON.stringify(stored('approved', []))),
      ],
    ];
    for (const args of unreadable) {
      const result = run(...args);
      const called = `signoff-status ${args.join(' ')}`;
      expect(result.stdout, called).toBe('');
      expect(result.stderr, called).toMatch(/^signoff-status: /);
      expect(result.status, called).toBe(2);
    }
  });
});
