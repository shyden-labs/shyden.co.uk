import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import config from '../../vitest.config';

/**
 * The per-test budget of the unit suite (#235, then #632).
 *
 * It was 30 s while nine unit files started real processes (git hooks, the
 * translator, the reconciler, scripts run as scripts): `test-e2e.mjs refuses
 * from this checkout` took 1.1s on a laptop, 5.4s on the CI runner (run
 * 35335647213) and up to 9.8s on the laptop under 24 busy loops (#235). Those
 * tests moved to the integration suite (#630), the whole-tree readers to the
 * guards suite (#638), and the unit setup now refuses any process and any
 * connection off this machine (#632).
 *
 * The limit is now 1 s, for a test and for a hook. Measured at 8eb3e10 with
 * coverage off (#632): 3 092 tests, the slowest under 1 s wall and none over
 * 0.3 s of its own CPU; `tests/unit-cpu-setup.ts` fails any test whose own CPU
 * passes 1 s, which load cannot move. The limit is declared once, in
 * `vitest.config.ts`, and `tests/guards/unit-limit.test.ts` refuses any raised
 * limit anywhere in the unit population. It is pinned here as a literal: a
 * value asserted against the config it came from would move with it and pin
 * nothing.
 */
describe('the unit suite budget', () => {
  it('gives every test 1 s', () => {
    expect(config.test?.testTimeout).toBe(1_000);
  });

  it('gives every hook 1 s', () => {
    expect(config.test?.hookTimeout).toBe(1_000);
  });

  // The CPU check reads the running thread's CPU, and the refusals patch the
  // worker's own `child_process` and `net`; both were measured in forked
  // workers, each test on the main thread of its own process. A thread pool
  // was never measured. Vitest's default was forks then, and a default can
  // move, so it is spelled.
  it('runs each worker as its own process, the ground the CPU check was measured on', () => {
    expect(config.test?.pool).toBe('forks');
  });

  it('is run by a command that carries no limit of its own', () => {
    const scripts = (
      JSON.parse(readFileSync('package.json', 'utf8')) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    expect(scripts['test:unit']).toBe('vitest run');
  });
});
