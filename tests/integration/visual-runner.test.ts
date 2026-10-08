import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dockerArgs } from '../../scripts/visual.mjs';
import { IMAGE } from '../visual-runner-shared';

const SHADOWS = String.raw`rm() { :; }
npm() { :; }
npx() { printf '%s\0' "$@"; }`;

/** What Playwright receives when the container runs `docker ...argv`. */
function playwrightReceives(argv: string[]): string[] {
  const at = argv.indexOf(IMAGE);
  expect(argv.slice(at + 1, at + 3), 'the container runs `sh -c`').toEqual([
    'sh',
    '-c',
  ]);
  const [step, ...operands] = argv.slice(at + 3);
  const run = spawnSync('/bin/sh', ['-c', `${SHADOWS}\n${step}`, ...operands], {
    encoding: 'utf8',
    env: { PATH: '/nonexistent' },
  });
  expect(run.status, run.stderr).toBe(0);
  const received = run.stdout.split('\0');
  expect(received.pop(), 'every argument ends in a NUL').toBe('');
  return received;
}

const comparing = (forwarded: string[]) =>
  playwrightReceives(
    dockerArgs({ image: IMAGE, cwd: '/repo', update: false, forwarded }),
  );

const OWN_FLAGS = ['playwright', 'test', '--project=visual', '--workers=2'];

describe('forwarding arguments into the visual container (#202)', () => {
  it('keeps an argument holding a space whole: the failure #200 measured', () => {
    expect(comparing(['--grep', 'student added'])).toEqual([
      ...OWN_FLAGS,
      '--grep',
      'student added',
    ]);
  });

  it('passes shell metacharacters through without interpreting them', () => {
    const forwarded = [
      '$(echo injected)',
      'a;b',
      '*',
      `doesn't "wrap"`,
      'x|y&z',
    ];

    expect(comparing(forwarded)).toEqual([...OWN_FLAGS, ...forwarded]);
  });

  it('keeps every byte: edge spaces, a newline, Thai text, an empty argument', () => {
    const forwarded = ['  padded  ', 'line\nbreak', 'นักเรียน', ''];

    expect(comparing(forwarded)).toEqual([...OWN_FLAGS, ...forwarded]);
  });

  it('forwards the same way when capturing, where a stray word rewrites baselines', () => {
    expect(
      playwrightReceives(
        dockerArgs({
          image: IMAGE,
          cwd: '/repo',
          update: true,
          forwarded: ['--grep', 'student added'],
        }),
      ),
    ).toEqual([
      'playwright',
      'test',
      '--project=visual',
      '--update-snapshots=all',
      '--workers=2',
      '--grep',
      'student added',
    ]);
  });

  it('adds no empty argument when nothing is forwarded', () => {
    // `"$@"` with no operands expands to nothing at all. A form that yields
    // one empty word instead (`"$*"` does) hands Playwright an argument
    // nobody passed.
    expect(comparing([])).toEqual(OWN_FLAGS);
  });

  // That the file still acts when run as a script, from any checkout, is held
  // with every other script that decides so in `script-entry.test.ts` (#221).
});

describe("Playwright's own update flag, forwarded (#390)", () => {
  it('refuses it from the command line, before it looks for Docker', () => {
    const run = spawnSync(
      process.execPath,
      ['scripts/visual.mjs', '--update-snapshots'],
      { encoding: 'utf8', env: { PATH: '/nonexistent' } },
    );
    expect(run.stderr).toContain(
      "visual: --update-snapshots is Playwright's own update flag",
    );
    expect(run.stderr).toContain('npm run test:visual:update');
    expect(run.stderr).not.toContain('docker is not available');
    expect(run.status).toBe(2);
  });
});
