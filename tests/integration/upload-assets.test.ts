import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('what a refusal looks like from the command line', () => {
  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'upload-cli-'));
    writeFileSync(join(dir, 'a.webm'), 'a recording nobody uploaded');
    writeFileSync(
      join(dir, 'plan.json'),
      JSON.stringify({ 'a-journey': join(dir, 'a.webm') }),
    );
    writeFileSync(
      join(dir, 'listing.txt'),
      'Assets of https://x: 0 files, 0 of 1073741824 bytes used (limit 5000 files).\n',
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('refuses with one line and exit 1, not an unhandled stack trace', () => {
    const run = spawnSync(
      process.execPath,
      [
        'scripts/upload-evidence-assets.mjs',
        '--plan',
        join(dir, 'plan.json'),
        '--listing',
        join(dir, 'listing.txt'),
        '--out',
        join(dir, 'assets.json'),
      ],
      { encoding: 'utf8' },
    );
    expect(run.stderr).toContain('a-journey');
    // A stack trace is what an unhandled throw looks like. Every other script
    // here refuses through `die`, and an operator reading `at main (...)` has
    // been shown an internal error rather than a decision.
    expect(run.stderr).not.toContain('at main');
    expect(run.stderr.startsWith('✗')).toBe(true);
    expect(run.status).toBe(1);
  });
});

describe('upload-evidence-assets.mjs as a command (#390)', () => {
  let dir = '';
  const at = (name: string) => join(dir, name);
  /** An asset line as the listing prints it, for a file on disk. */
  const assetLine = (id: string, body: string) =>
    `- /_blob/${id}  video/webm  ${Buffer.byteLength(body)} bytes  ` +
    `2026-09-30T00:00:00Z  sha256 ${createHash('sha256').update(body).digest('hex')}`;
  const listing = (lines: string[]) =>
    [
      `Assets of https://x: ${lines.length} files, 0 of 1073741824 bytes used (limit 5000 files).`,
      ...lines,
    ].join('\n');
  const run = (...args: string[]) => {
    const result = spawnSync(
      process.execPath,
      ['scripts/upload-evidence-assets.mjs', ...args],
      { encoding: 'utf8' },
    );
    return { code: result.status, out: result.stdout, err: result.stderr };
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'upload-command-'));
    writeFileSync(at('a.webm'), 'first recording');
    writeFileSync(at('b.webm'), 'second recording');
    writeFileSync(
      at('plan.json'),
      JSON.stringify({ 'a-journey': at('a.webm'), 'b-journey': at('b.webm') }),
    );
    writeFileSync(at('empty.txt'), listing([]));
    writeFileSync(
      at('held.txt'),
      listing([
        assetLine('a'.repeat(32), 'first recording'),
        assetLine('b'.repeat(32), 'second recording'),
      ]),
    );
    writeFileSync(at('empty-plan.json'), '{}');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('prints what is still to upload, one call per line', () => {
    const { code, out, err } = run(
      '--plan',
      at('plan.json'),
      '--listing',
      at('empty.txt'),
    );
    expect(err).toBe('');
    expect(out).toBe(
      'upload-evidence-assets: 2 recording(s) still to upload, in 1 call(s) of at most 25:\n' +
        `${JSON.stringify([at('a.webm'), at('b.webm')])}\n`,
    );
    expect(code).toBe(0);
  });

  it('says when the store already holds everything', () => {
    const { code, out } = run(
      '--plan',
      at('plan.json'),
      '--listing',
      at('held.txt'),
    );
    expect(out).toBe(
      'upload-evidence-assets: the store already holds every recording in ' +
        'that plan. Re-run the listing, then pass --out to write the map.\n',
    );
    expect(code).toBe(0);
  });

  it('writes the map with --out, and says how many it paired', () => {
    const { code, out, err } = run(
      '--plan',
      at('plan.json'),
      '--listing',
      at('held.txt'),
      '--out',
      at('assets.json'),
    );
    expect(err).toBe('');
    expect(out).toBe(
      `upload-evidence-assets: wrote 2 pairing(s) to ${at('assets.json')}\n`,
    );
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(at('assets.json'), 'utf8'))).toEqual({
      'a-journey': `/_blob/${'a'.repeat(32)}`,
      'b-journey': `/_blob/${'b'.repeat(32)}`,
    });
  });

  it('refuses a plan that names nothing', () => {
    const { code, err } = run(
      '--plan',
      at('empty-plan.json'),
      '--listing',
      at('held.txt'),
      '--out',
      at('never.json'),
    );
    expect(err).toContain('the plan names no recording');
    expect(code).toBe(1);
  });

  it.each([
    [
      'a mistyped option, which would skip the map in silence',
      ['--outt', 'x'],
      "upload-evidence-assets: Unknown option '--outt'",
    ],
    [
      'an option whose value is the next option',
      ['--plan', '--listing', 'x'],
      "upload-evidence-assets: Option '--plan' argument is ambiguous.",
    ],
  ])('names %s, and refuses', (_, args, says) => {
    const { code, err } = run(...args);
    expect(err).toContain(says);
    expect(err).toContain('usage: upload-evidence-assets.mjs');
    expect(code).toBe(2);
  });
});
