import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { searched } from '../source-files';
import {
  backTranslationUnits,
  chrF,
  engineName,
  sendable,
  type Comparison,
  type EngineLanguage,
} from '../../src/lib/i18n/back-translate';
import { floorBreach } from '../floors';
import { TRANSLATED } from '../back-translate-shared';

/**
 * The script, run the way the workflow runs it, against a stand-in engine.
 *
 * The real engine is exercised by the workflow itself, on the runner; here a
 * local server speaks LibreTranslate's two endpoints so every failure path
 * can be reached on demand. Its log opens with `listening`, so a run that
 * made no request is told apart from a server that recorded nothing.
 */
describe('scripts/i18n-back-translate.mjs', () => {
  const script = resolve('scripts', 'i18n-back-translate.mjs');
  const LANGUAGES: Array<EngineLanguage & { name: string }> = [
    { code: 'en', name: 'English', targets: ['id', 'th', 'vi', 'zh-Hans'] },
    { code: 'id', name: 'Indonesian', targets: ['en'] },
    { code: 'th', name: 'Thai', targets: ['en'] },
    { code: 'vi', name: 'Vietnamese', targets: ['en'] },
    { code: 'zh-Hans', name: 'Chinese (Simplified)', targets: ['en'] },
    { code: 'zh-Hant', name: 'Chinese (Traditional)', targets: ['en'] },
  ];
  let dir = '';
  let server: Server | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'back-translate-'));
  });
  afterEach(async () => {
    // `close` alone waits out any keep-alive socket the script's fetch left.
    server?.closeAllConnections();
    await new Promise<void>((done) =>
      server ? server.close(() => done()) : done(),
    );
    server = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  interface StandIn {
    url: string;
    log: string[];
    /** Every text the engine was asked to read, in order. */
    sent: string[];
    /** The same, each as `<source> <text>`: which language it was sent as. */
    sentFrom: string[];
  }

  async function standIn(options: {
    languages?: EngineLanguage[];
    answer?: (text: string, source: string) => string;
    refuse?: { status: number; error: string };
  }): Promise<StandIn> {
    const log: string[] = [];
    const sent: string[] = [];
    const sentFrom: string[] = [];
    server = createServer((request, response) => {
      // Decoded as a stream, so a Thai character split across two chunks
      // arrives whole rather than as two replacement characters.
      request.setEncoding('utf8');
      let body = '';
      request.on('data', (chunk: string) => (body += chunk));
      request.on('end', () => {
        const reply = (status: number, value: unknown) => {
          response.writeHead(status, { 'content-type': 'application/json' });
          response.end(JSON.stringify(value));
        };
        if (request.method === 'GET' && request.url === '/languages') {
          log.push('GET /languages');
          reply(200, options.languages ?? LANGUAGES);
          return;
        }
        if (request.method === 'POST' && request.url === '/translate') {
          const { q, source } = JSON.parse(body) as {
            q: string[];
            source: string;
          };
          log.push(`POST /translate ${source} ${q.length}`);
          sent.push(...q);
          sentFrom.push(...q.map((text) => `${source} ${text}`));
          if (options.refuse) {
            reply(options.refuse.status, { error: options.refuse.error });
            return;
          }
          const answer = options.answer ?? ((text: string) => `back:${text}`);
          reply(200, { translatedText: q.map((text) => answer(text, source)) });
          return;
        }
        log.push(`unexpected ${request.method} ${request.url}`);
        reply(404, { error: 'Not Found' });
      });
    });
    const listening = server;
    await new Promise<void>((done) => listening.listen(0, '127.0.0.1', done));
    log.push('listening');
    const { port } = listening.address() as AddressInfo;
    return { url: `http://127.0.0.1:${port}`, log, sent, sentFrom };
  }

  /** One run of the real script, with only the environment a test gives it. */
  function run(
    env: Record<string, string>,
    args: readonly string[] = [],
  ): Promise<{ status: number | null; output: string }> {
    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    for (const name of Object.keys(childEnv))
      if (name.startsWith('BACK_TRANSLATE_')) delete childEnv[name];
    // Never the real job summary: a test run inside CI would write into it.
    childEnv.GITHUB_STEP_SUMMARY = join(dir, 'summary.md');
    Object.assign(childEnv, env);
    return new Promise((done, fail) => {
      const child = spawn(
        process.execPath,
        ['--no-warnings', script, ...args],
        {
          env: childEnv,
        },
      );
      let output = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => (output += chunk));
      child.stderr.on('data', (chunk: string) => (output += chunk));
      child.on('error', fail);
      child.on('close', (status) => done({ status, output }));
    });
  }

  const summary = () => readFileSync(join(dir, 'summary.md'), 'utf8');
  const report = () =>
    JSON.parse(readFileSync(join(dir, 'back-translation.json'), 'utf8')) as {
      comparisons: Comparison[];
    };
  const translateRequests = (engine: StandIn) =>
    engine.log.filter((line) => line.startsWith('POST /translate'));

  it('reads every locale back into English and writes the review', async () => {
    const engine = await standIn({});
    const result = await run({
      BACK_TRANSLATE_URL: engine.url,
      BACK_TRANSLATE_REPORT: join(dir, 'back-translation.json'),
    });
    expect(result.status, result.output).toBe(0);
    for (const locale of TRANSLATED) {
      const units = backTranslationUnits(locale);
      const mine = report().comparisons.filter((row) => row.locale === locale);
      expect(mine, locale).toHaveLength(units.length);
      // Written out here, not taken from the module: the slots the engine is
      // spared, then the stand-in's answer.
      for (const row of mine)
        expect(row.backTranslation, `${locale} ${row.key}`).toBe(
          `back:${row.translation
            .replace(/\{[^{}]*\}/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()}`,
        );
    }
    // Not one slot reached the engine, and the copy around them did: the
    // Vietnamese group label is `Nhóm {n}`.
    expect(
      searched(
        engine.sent.filter((text) => /[{}]/.test(text)),
        { of: engine.sent, what: 'texts sent to the engine' },
      ),
      'a slot sent is noise the engine mangles',
    ).toEqual([]);
    expect(
      floorBreach('back-translate/texts-sent', engine.sent.length),
    ).toBeUndefined();
    expect(engine.sent).toContain('Nhóm');
    // Every section, parsed off its line rather than found as a substring.
    expect(
      [
        ...summary().matchAll(/^<details><summary>(\w+) — (\d+) compared/gm),
      ].map(([, locale, count]) => `${locale} ${count}`),
    ).toEqual(
      TRANSLATED.map(
        (locale) => `${locale} ${backTranslationUnits(locale).length}`,
      ),
    );
    // zh is asked for in the script it is written in, not just by its code.
    expect(
      translateRequests(engine).some((line) =>
        line.startsWith('POST /translate zh-Hans '),
      ),
    ).toBe(true);
  });

  it('says how many it compared per locale, and as what', async () => {
    const engine = await standIn({});
    const result = await run({ BACK_TRANSLATE_URL: engine.url });
    expect(result.status, result.output).toBe(0);
    for (const locale of TRANSLATED)
      expect(result.output, locale).toMatch(
        new RegExp(
          `^${locale}: ${backTranslationUnits(locale).length} compared, \\d+ distinct, read as ${locale === 'zh' ? 'zh-Hans' : locale}$`,
          'm',
        ),
      );
  });

  it('scores each back-translation against its English', async () => {
    const engine = await standIn({});
    const result = await run({
      BACK_TRANSLATE_URL: engine.url,
      BACK_TRANSLATE_REPORT: join(dir, 'back-translation.json'),
    });
    expect(result.status, result.output).toBe(0);
    const rows = report().comparisons;
    expect(rows.filter(({ score }) => score > 0).length).toBeGreaterThan(0);
    for (const row of rows)
      expect(row.score, `${row.locale} ${row.key}`).toBe(
        chrF(row.english, row.backTranslation),
      );
  });

  it('sends a text once per locale, however many keys share it', async () => {
    // Liveness: the catalogues do repeat a translation under several keys,
    // so sending one per key would show here.
    expect(
      TRANSLATED.some((locale) => {
        const units = backTranslationUnits(locale);
        return (
          new Set(units.map(({ translation }) => sendable(translation))).size <
          units.length
        );
      }),
    ).toBe(true);
    const engine = await standIn({});
    await run({ BACK_TRANSLATE_URL: engine.url });
    expect(engine.sentFrom.length).toBeGreaterThan(0);
    expect(new Set(engine.sentFrom).size).toBe(engine.sentFrom.length);
  });

  it('names the engine it was given, in the review and the report', async () => {
    const engine = await standIn({});
    const result = await run({
      BACK_TRANSLATE_URL: engine.url,
      BACK_TRANSLATE_ENGINE: 'libretranslate/libretranslate:v1.6.2',
      BACK_TRANSLATE_REPORT: join(dir, 'back-translation.json'),
    });
    expect(result.status, result.output).toBe(0);
    expect(summary()).toMatch(
      /^Every translated locale, read back into English by \*\*libretranslate\/libretranslate:v1\.6\.2\*\*, /m,
    );
    expect(
      (
        JSON.parse(
          readFileSync(join(dir, 'back-translation.json'), 'utf8'),
        ) as {
          engine: string;
        }
      ).engine,
    ).toBe('libretranslate/libretranslate:v1.6.2');
  });

  // #390 F75. The workflow no longer types the version, so a run that names
  // no engine must take it from the Dockerfile Dependabot bumps.
  it('names the engine the Dockerfile builds when a run names none', async () => {
    const engine = await standIn({});
    const result = await run({ BACK_TRANSLATE_URL: engine.url });
    expect(result.status, result.output).toBe(0);
    const built = engineName(
      {},
      readFileSync('docker/libretranslate/Dockerfile', 'utf8'),
    );
    expect(built).toMatch(/^LibreTranslate v\d/);
    // The name the review's anchored opening line carries, compared EXACTLY
    // with the Dockerfile's: a missing line reads as undefined and fails.
    const opening =
      /^Every translated locale, read back into English by \*\*(LibreTranslate v[^*]+)\*\*, /m;
    expect(opening.exec(summary())?.[1]).toBe(built);
  });

  it('prints the review when there is no job summary to write it to', async () => {
    const engine = await standIn({});
    const result = await run({
      BACK_TRANSLATE_URL: engine.url,
      GITHUB_STEP_SUMMARY: '',
    });
    expect(result.status, result.output).toBe(0);
    expect(result.output).toMatch(
      /^Every translated locale, read back into English by \*\*LibreTranslate v\d+\.\d+\.\d+\*\*, /m,
    );
    expect(existsSync(dir)).toBe(true);
    expect(existsSync(join(dir, 'summary.md'))).toBe(false);
  });

  it('never fails on a score, however bad', async () => {
    const engine = await standIn({ answer: () => 'zzz' });
    const result = await run({ BACK_TRANSLATE_URL: engine.url });
    expect(result.status, result.output).toBe(0);
    expect(summary()).toMatch(/^\| 0 \| /m);
  });

  it('fails loudly without an engine, before writing or sending anything', async () => {
    const engine = await standIn({});
    const result = await run({});
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/BACK_TRANSLATE_URL/);
    expect(
      existsSync(join(dir, 'summary.md')),
      'a refused run wrote a summary',
    ).toBe(false);
    expect(
      searched(translateRequests(engine), {
        of: engine.log,
        what: 'stand-in engine log lines',
      }),
      'a run with no engine sent something',
    ).toEqual([]);
    // `listening` and nothing else: not even the languages read (#522).
    expect(
      floorBreach('back-translate/no-engine-log', engine.log.length),
    ).toBeUndefined();
  });

  it('fails a locale that came back empty, and says so in the summary', async () => {
    const engine = await standIn({
      answer: (text, source) => (source === 'th' ? '' : `back:${text}`),
    });
    const result = await run({ BACK_TRANSLATE_URL: engine.url });
    expect(result.status, result.output).toBe(1);
    expect(result.output).toMatch(/^th: /m);
    expect(summary()).toMatch(/^\*\*This run cannot be believed:\*\*$/m);
    expect(summary()).toMatch(/^th: /m);
  });

  it('passes on the engine’s refusal', async () => {
    const engine = await standIn({
      refuse: { status: 403, error: 'Invalid API key' },
    });
    const result = await run({ BACK_TRANSLATE_URL: engine.url });
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/^✗ .*Invalid API key/m);
  });

  it('refuses an engine that cannot read a locale, before sending anything', async () => {
    const engine = await standIn({
      languages: LANGUAGES.filter(({ code }) => code !== 'th'),
    });
    const result = await run({ BACK_TRANSLATE_URL: engine.url });
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/\bth\b/);
    expect(
      searched(translateRequests(engine), {
        of: engine.log,
        what: 'stand-in engine log lines',
      }),
      'it sent copy before finding a locale it could not read',
    ).toEqual([]);
    expect(
      floorBreach('back-translate/refused-locale-log', engine.log.length),
    ).toBeUndefined();
  });

  it('refuses an argument, since everything it reads is an environment variable', async () => {
    const engine = await standIn({});
    const result = await run({ BACK_TRANSLATE_URL: engine.url }, ['--report']);
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/takes no arguments/);
    expect(engine.log, 'it reached the engine before refusing').toEqual([
      'listening',
    ]);
  });

  it('is watched by a stand-in that records a real request', async () => {
    // The control for every "sent nothing" above: the same recorder, a run
    // that sends. Without it, a recorder that stopped recording would pass
    // every one of them.
    const engine = await standIn({});
    await run({ BACK_TRANSLATE_URL: engine.url });
    expect(translateRequests(engine).length).toBeGreaterThan(0);
  });
});
