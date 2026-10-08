import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scriptCheckout, type ScriptCheckout } from '../unit/script-checkout';
import { type Probe, PROBES } from '../script-entry-shared';

/**
 * A directory holding a stand-in `npx` that kills the process which called it.
 *
 * A probe shows that a script's entry point ran through a refusal the script
 * makes before it does any work. `test-e2e.mjs`'s probe once got its refusal
 * from Playwright instead, starting the Playwright CLI twice per probe, and
 * timed out at 32-34 s under load (#572). Put first on every probe's PATH,
 * this stand-in makes a probe that spawns `npx` fail outright rather than run
 * slowly: the probed process dies with no exit status and none of its words.
 * Leaving `npx` off PATH would not do that, because a failed spawn is quick
 * and quiet, and `test-e2e.mjs` reads a failed listing as "no total" and
 * carries on.
 */
const npxThatKillsItsCaller = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'probe-bin-')));
  const npx = join(dir, 'npx');
  writeFileSync(npx, '#!/bin/sh\nkill -KILL "$PPID"\n');
  chmodSync(npx, 0o755);
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
};

const runAsScript = (script: string, probe: Probe, bin: string) => {
  // A probe that sets PATH itself replaces this one whole, stand-in included.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
  };
  for (const [name, value] of Object.entries(probe.env ?? {}))
    if (value === undefined) delete env[name];
    else env[name] = value;
  return spawnSync(process.execPath, [script, ...probe.args], {
    encoding: 'utf8',
    env,
  });
};

describe('every script that decides still acts when run as one (#221)', () => {
  let checkout: ScriptCheckout;
  let bin: ReturnType<typeof npxThatKillsItsCaller>;
  beforeAll(() => {
    checkout = scriptCheckout();
    bin = npxThatKillsItsCaller();
  });
  afterAll(() => {
    checkout.remove();
    bin.remove();
  });

  const places: Readonly<Record<string, () => string>> = {
    'this checkout': () => 'scripts',
    'a checkout whose path holds a space': () => checkout.spaced,
    'a checkout reached through a symlink': () => checkout.linked,
  };

  for (const [script, probe] of Object.entries(PROBES))
    for (const [place, dir] of Object.entries(places))
      it(`${script} refuses from ${place}`, () => {
        const run = runAsScript(join(dir(), script), probe, bin.dir);
        expect(`${run.stdout}${run.stderr}`).toContain(probe.says);
        expect(run.status).toBe(probe.status);
      });
});

/**
 * A guarded entry means the module can be IMPORTED without running the
 * program -- which is the whole point of guarding it (#227). Before this,
 * `dashboard.mjs` kept its own copies of `waitUntil`, `pidsListeningOnPort`
 * and `killByPort` for exactly this reason, and the copies had already
 * drifted: its `killByPort` gave a shutting-down process 5 s to release the
 * port where the original gave 10 s.
 *
 * Observed in a child process rather than this one: a module imported into
 * the test runner cannot be unloaded, and anything it started would outlive
 * the assertion.
 */
describe('a guarded script can be imported without running (#227)', () => {
  const importsSilently = (script: string, exported?: string) =>
    spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        // Where the module exports something, checking it is the liveness
        // control, and it doubles as proof that the helper has one home.
        // `dashboard.mjs` exports nothing, so it has none -- which is sound
        // here only because an unresolvable path THROWS: a wrong filename
        // arrives as a non-zero exit with a stack on stderr, never as the
        // silence this asserts.
        `const m = await import(${JSON.stringify(pathToFileURL(join('scripts', script)).href)});
         ${
           exported
             ? `if (typeof m.${exported} !== 'function')
                  throw new Error('${script} exports no ${exported}');`
             : ''
         }`,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );

  it('test-devices.mjs imports without starting the gauntlet', () => {
    const run = importsSilently('test-devices.mjs', 'killByPort');
    expect(`${run.stdout}${run.stderr}`).toBe('');
    expect(run.status).toBe(0);
  });

  it('dashboard.mjs imports without binding its port', () => {
    const run = importsSilently('dashboard.mjs');
    expect(`${run.stdout}${run.stderr}`).toBe('');
    expect(run.status).toBe(0);
  });

  // The three from #276. `i18n-translate.mjs` is the one that mattered: until
  // it was guarded, importing it read DEEPL_API_KEY, sent the whole catalogue
  // to DeepL and rewrote the cache. Each exports `main`, and checking that the
  // export is a function is the liveness control -- a module that failed to
  // resolve is exactly as quiet as one that loaded and did nothing.
  it.each([
    ['i18n-scaffold.mjs'],
    ['i18n-translate.mjs'],
    ['install-hooks.mjs'],
  ])('%s imports without running', (script) => {
    const run = importsSilently(script, 'main');
    expect(`${run.stdout}${run.stderr}`).toBe('');
    expect(run.status).toBe(0);
  });
});
