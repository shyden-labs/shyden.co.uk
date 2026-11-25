import { afterEach, describe, expect, it, vi } from 'vitest';
import { githubJson } from '../../scripts/json-answer.mjs';

/**
 * `githubJson`'s plain-text request, which `deploy-failure.mjs` reads a job
 * log through (a log is text, not JSON), instead of its own copy of the
 * client (#390 F39). `fetch` is stood in: a unit test reaches no network.
 */
const answering = (status: number, body: string) => {
  const fetch = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
};

afterEach(() => vi.unstubAllGlobals());

const client = () => githubJson('t0ken', 'shyden-test', () => 1000);

describe('githubJson text', () => {
  it('GETs with the shared headers and answers with the text', async () => {
    const fetch = answering(200, 'log line\n');
    expect(await client().text('https://api.test/x')).toBe('log line\n');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/x');
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({
      authorization: 'Bearer t0ken',
      'user-agent': 'shyden-test',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('POSTs a body as JSON', async () => {
    const fetch = answering(201, '{"number":7}');
    expect(await client().text('https://api.test/i', { title: 'a' })).toBe(
      '{"number":7}',
    );
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"title":"a"}');
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' });
  });

  it('throws naming the status on a refusal, whatever the body', async () => {
    answering(404, '<html>not found</html>');
    await expect(client().text('https://api.test/x')).rejects.toThrow(
      /^GitHub answered HTTP 404$/,
    );
  });
});
