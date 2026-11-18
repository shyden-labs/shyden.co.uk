import { describe, expect, it } from 'vitest';
import worker, { redirectFor } from '../../workers/old-yawelo-hosts/index.js';

/**
 * Yawelo Idle moved from yawelo-idle.shyden.co.uk to yaweloidle.com
 * (yawelo-idle#1013). The old hosts answer 301 to the same path and query on
 * the new host, for good (Shyden approved, 2026-11-18, #1191 AC3). Any other
 * host reaching this Worker is not one of ours to move, and is refused.
 */

describe('redirectFor', () => {
  it('sends the old production host to yaweloidle.com', () => {
    expect(redirectFor('https://yawelo-idle.shyden.co.uk/')).toBe(
      'https://yaweloidle.com/',
    );
  });

  it('sends the old dev host to dev.yaweloidle.com', () => {
    expect(redirectFor('https://dev.yawelo-idle.shyden.co.uk/')).toBe(
      'https://dev.yaweloidle.com/',
    );
  });

  it('keeps a deep path and its query', () => {
    expect(
      redirectFor(
        'https://yawelo-idle.shyden.co.uk/id/play/level?seed=7&x=a%20b',
      ),
    ).toBe('https://yaweloidle.com/id/play/level?seed=7&x=a%20b');
  });

  it('answers https even when the old host was asked over http', () => {
    expect(redirectFor('http://dev.yawelo-idle.shyden.co.uk/a?b=1')).toBe(
      'https://dev.yaweloidle.com/a?b=1',
    );
  });

  it('keeps a trailing slash as it was', () => {
    expect(redirectFor('https://yawelo-idle.shyden.co.uk/path/')).toBe(
      'https://yaweloidle.com/path/',
    );
  });

  it('matches the host whatever its case', () => {
    expect(redirectFor('https://YAWELO-IDLE.Shyden.co.uk/x')).toBe(
      'https://yaweloidle.com/x',
    );
  });

  it.each([
    'https://shyden.co.uk/',
    'https://dev.shyden.co.uk/',
    'https://yaweloidle.com/',
    'https://dev-api.yawelo-idle.shyden.co.uk/',
    'https://evil.example/yawelo-idle.shyden.co.uk',
  ])('does not move %s', (url) => {
    expect(redirectFor(url)).toBeNull();
  });
});

describe('the Worker', () => {
  it('answers 301 with the new address in Location', async () => {
    const response = await worker.fetch(
      new Request('https://yawelo-idle.shyden.co.uk/deep/path?q=1', {
        method: 'GET',
      }),
    );
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe(
      'https://yaweloidle.com/deep/path?q=1',
    );
  });

  it('answers 404 to a host it does not move', async () => {
    const response = await worker.fetch(new Request('https://shyden.co.uk/'));
    expect(response.status).toBe(404);
    expect(response.headers.get('location')).toBeNull();
  });
});
