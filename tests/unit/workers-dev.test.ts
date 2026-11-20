import { describe, expect, it } from 'vitest';
import { workersDevHosts } from '../workers-dev';

/**
 * No page, script or response of the production build names a `workers.dev`
 * address (#1032 AC4): a visitor's browser must never call one. The walk
 * reads every built page and every script it loads through this reader, so
 * the reader itself is held here.
 */
describe('a workers.dev address in served text (#1032)', () => {
  it('finds a host in a script src', () => {
    expect(
      workersDevHosts(
        '<script src="https://shydesk.shydesk-non-prod.workers.dev/embed.js" defer></script>',
      ),
    ).toEqual(['shydesk.shydesk-non-prod.workers.dev']);
  });

  it('finds every host, once each, whatever the case', () => {
    expect(
      workersDevHosts(
        'fetch("https://a.b.workers.dev/x");fetch("//A.B.WORKERS.DEV/y");c.workers.dev',
      ),
    ).toEqual(['a.b.workers.dev', 'c.workers.dev']);
  });

  it('finds nothing in the live host or a lookalike', () => {
    expect(
      workersDevHosts(
        '<script src="https://shydesk.dpdns.org/embed.js"></script> workers.develop.example workers-dev.example',
      ),
    ).toEqual([]);
  });
});
