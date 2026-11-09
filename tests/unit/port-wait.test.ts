import { describe, expect, it } from 'vitest';
import { portWait } from '../../scripts/test-devices.mjs';

/**
 * The device run used to SIGTERM, then SIGKILL, whatever listened on its
 * preview port: another session's or worktree's preview included (#390 F44).
 * A busy port is now waited for, naming its holder, up to a stated ceiling
 * (global rule: a busy resource is waited for, never taken).
 */
const holder = { pid: 4242, command: 'node astro preview' };

describe('portWait', () => {
  it('goes on at once when nothing holds the port', () => {
    expect(portWait(4321, [], 0, 600_000)).toEqual({ free: true });
  });

  it('waits, naming each holder, while under the ceiling', () => {
    expect(portWait(4321, [holder], 59_000, 600_000)).toEqual({
      free: false,
      say: 'port 4321 is held by pid 4242 (node astro preview); waiting for it to close, up to 600 s',
    });
  });

  it('fails at the ceiling naming the holder, and never kills it', () => {
    expect(() => portWait(4321, [holder], 600_000, 600_000)).toThrow(
      'port 4321 is still held by pid 4242 (node astro preview) after 600 s; stop that server, or wait for its run to end, then start again',
    );
  });
});
