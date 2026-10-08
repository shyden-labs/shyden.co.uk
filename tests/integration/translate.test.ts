import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { searched } from '../source-files';
import { floorBreach } from '../floors';
import { collectCatalogue } from '../translate-shared';

/**
 * #164. The harness itself, run the way a person runs it.
 *
 * Everything above is pure because the script is a top-level-await module
 * that calls the network on import -- but it can still be RUN. It reads its
 * cache and `.env.local` from the working directory and its imports from its
 * own location, so a scratch directory hands it a fixture cache and no key
 * while it loads the real catalogues. `fetch` is the one thing replaced:
 * `tests/fetch-trap.mjs` records a request and refuses it, which is how
 * `--prune` is proved to make none.
 */
describe('the harness prunes the cache it writes', () => {
  const script = resolve('scripts', 'i18n-translate.mjs');
  const trap = pathToFileURL(resolve('tests', 'fetch-trap.mjs')).href;
  /** Invented, so no catalogue will ever send them. */
  const retired = [
    'A sentence no catalogue sends.',
    'Copy retired before #164.',
  ];
  let dir = '';
  let cachePath = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'i18n-translate-'));
    // The script's own relative path, resolved against the scratch directory.
    cachePath = join(dir, 'src', 'lib', 'i18n', '.translations.json');
    mkdirSync(dirname(cachePath), { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /**
   * zh with a draft for every sentence the catalogues send and the two retired
   * ones among them; vi with one of each, to show a run touches only its own
   * locale. Every draft is its own English, which keeps its slots, so nothing
   * is pending and `--send` reaches its write-back without a request.
   */
  function writeFixture(): string {
    const live = collectCatalogue();
    const half = Math.floor(live.length / 2);
    const cache = {
      zh: Object.fromEntries([
        [retired[0], '一句没有目录发送的话。'],
        ...live.slice(0, half).map((s) => [s, s]),
        [retired[1], '#164 之前退役的文案。'],
        ...live.slice(half).map((s) => [s, s]),
      ]),
      vi: {
        [retired[0]]: 'Một câu không danh mục nào gửi.',
        [live[0]]: live[0],
      },
    };
    const bytes = `${JSON.stringify(cache, null, 2)}\n`;
    writeFileSync(cachePath, bytes);
    return bytes;
  }

  /** One run of the real script, from the scratch directory, behind the trap. */
  function harness(args: string[], apiKey?: string) {
    const record = join(dir, 'fetch-trap.log');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      FETCH_TRAP_RECORD: record,
    };
    delete env.DEEPL_API_KEY;
    if (apiKey !== undefined) env.DEEPL_API_KEY = apiKey;
    const run = spawnSync(
      process.execPath,
      ['--no-warnings', '--import', trap, script, ...args],
      { cwd: dir, env, encoding: 'utf8' },
    );
    // Everything the trap wrote: `loaded` first, then a line per request. A
    // run whose trap never loaded has an empty log, and `searched` refuses to
    // call the requests drawn from an empty log "none".
    const log = existsSync(record)
      ? readFileSync(record, 'utf8')
          .split('\n')
          .filter((line) => line !== '')
      : [];
    return {
      status: run.status,
      output: `${run.stdout}${run.stderr}`,
      log,
      requests: log
        .filter((line) => line.startsWith('request '))
        .map((line) => line.slice('request '.length)),
    };
  }

  const cached = () => JSON.parse(readFileSync(cachePath, 'utf8'));

  it('reports the stale drafts on a dry run and writes nothing', () => {
    const before = writeFixture();
    const run = harness(['zh']);
    expect(run.status, run.output).toBe(0);
    expect(readFileSync(cachePath, 'utf8'), 'a dry run wrote the cache').toBe(
      before,
    );
    expect(run.output).toMatch(/^stale +2 drafts no catalogue sends$/m);
    expect(
      searched(run.requests, { of: run.log, what: 'fetch trap log lines' }),
      'a dry run made a request',
    ).toEqual([]);
    expect(
      floorBreach('translate/dry-run-trap-log', run.log.length),
    ).toBeUndefined();
  });

  it('drops the stale drafts with --prune, with no key and no request', () => {
    const before = writeFixture();
    const run = harness(['zh', '--prune']);
    expect(run.status, run.output).toBe(0);
    expect(Object.keys(cached().zh), 'the drafts --prune kept').toEqual(
      collectCatalogue(),
    );
    expect(cached().vi, 'a locale nobody named was pruned').toEqual(
      JSON.parse(before).vi,
    );
    expect(
      searched(run.requests, { of: run.log, what: 'fetch trap log lines' }),
      '--prune made a request',
    ).toEqual([]);
    expect(
      floorBreach('translate/prune-trap-log', run.log.length),
    ).toBeUndefined();
    expect(run.output).toMatch(
      /^✓ dropped 2 stale drafts — nothing sent, no key read\.$/m,
    );
  });

  it('drops the stale drafts as --send writes, even with nothing to send', () => {
    writeFixture();
    const run = harness(['zh', '--send'], 'test-key:fx');
    expect(run.status, run.output).toBe(0);
    expect(Object.keys(cached().zh), 'the drafts --send kept').toEqual(
      collectCatalogue(),
    );
    expect(
      searched(run.requests, { of: run.log, what: 'fetch trap log lines' }),
      'nothing was pending, yet it sent',
    ).toEqual([]);
    expect(
      floorBreach('translate/send-trap-log', run.log.length),
    ).toBeUndefined();
  });

  it('writes nothing when --prune has nothing to drop', () => {
    const run = harness(['zh', '--prune']);
    expect(run.status, run.output).toBe(0);
    expect(existsSync(cachePath), '--prune wrote a cache with no drafts').toBe(
      false,
    );
    expect(run.output).toMatch(/^stale +0 drafts no catalogue sends$/m);
  });

  it('refuses --send and --prune together', () => {
    const before = writeFixture();
    const run = harness(['zh', '--send', '--prune'], 'test-key:fx');
    expect(run.status, run.output).toBe(1);
    expect(readFileSync(cachePath, 'utf8'), 'a refused run wrote').toBe(before);
    expect(run.output).toMatch(/^✗ --send and --prune cannot be combined: /m);
  });

  it('refuses a second locale, rather than drafting only the first', () => {
    const before = writeFixture();
    const run = harness(['zh', 'th', '--send'], 'test-key:fx');
    expect(run.status, run.output).toBe(1);
    expect(readFileSync(cachePath, 'utf8'), 'a refused run wrote').toBe(before);
    expect(run.output).toMatch(
      /^✗ name one locale, not 2 \(zh, th\) — usage: npm run i18n:translate -- /m,
    );
  });

  it('refuses an option it does not know, rather than dry-running past a typo', () => {
    const run = harness(['zh', '--prnue']);
    expect(run.status, run.output).toBe(1);
    expect(run.output).toMatch(/^✗ unknown option --prnue — /m);
  });

  it('is watched by a trap that catches a real request', () => {
    // The control for every "made a request" above: the same trap, a key and
    // sentences to send. Without it, a trap that stopped recording would pass
    // every one of them.
    writeFileSync(cachePath, `${JSON.stringify({ zh: {} }, null, 2)}\n`);
    const before = readFileSync(cachePath, 'utf8');
    const run = harness(['zh', '--send'], 'test-key:fx');
    expect(run.status, 'a refused request did not fail the run').not.toBe(0);
    expect(run.requests).toHaveLength(1);
    expect(run.requests[0]).toMatch(/^https:\/\/api-free\.deepl\.com\//);
    expect(run.output, 'the key reached the output').not.toContain('test-key');
    expect(readFileSync(cachePath, 'utf8'), 'a failed run wrote').toBe(before);
  });
});
