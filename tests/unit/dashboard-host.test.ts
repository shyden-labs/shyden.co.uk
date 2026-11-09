import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { withoutTsComments } from './source-text';

/**
 * The device-run dashboard serves the live run, test titles and failures
 * included, with no login. On a shared network (school Wi-Fi) every address
 * but loopback lets anyone on it read the run (#390 F43). It is opened on the
 * laptop itself, at `http://localhost:4322`, so loopback is all it needs.
 */
const source = withoutTsComments(
  readFileSync(
    path.resolve(import.meta.dirname, '../../scripts/dashboard.mjs'),
    'utf8',
  ),
);

describe('the device-run dashboard', () => {
  it('listens on loopback only, never on every address', () => {
    // Every listen call, and the address each one names.
    const calls = source.match(/\.listen\(/g) ?? [];
    const hosts = [...source.matchAll(/\.listen\(\s*PORT\s*,\s*'([^']*)'/g)];
    expect(calls).toHaveLength(1);
    expect(hosts.map((m) => m[1])).toEqual(['127.0.0.1']);
  });
});
