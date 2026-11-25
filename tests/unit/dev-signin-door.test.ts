// The `dev-signin.shyden.co.uk` door (#1262 AC1, shyden-labs/repo-template#207's
// "Door secret" step): it forwards every request to the sign-in Worker with the
// door secret, and nothing else. The forward is a stub: no test reaches Cloudflare.
import { describe, expect, it, vi } from 'vitest';
import { DOOR_SECRET_HEADER } from '../../workers/dev-signin/config.ts';
import {
  forwardToSignin,
  type DoorEnv,
} from '../../workers/dev-signin-door/index.ts';

const env: DoorEnv = {
  SIGNIN_URL: 'https://shyden-dev-signin.example.workers.dev',
  DOOR_SECRET: 'door-secret',
};

function forwarded(forward: ReturnType<typeof vi.fn>): Request {
  return forward.mock.calls[0]?.[0] as Request;
}

describe('the dev-signin door', () => {
  it('forwards the path and query to the sign-in Worker with the door secret', async () => {
    const forward = vi.fn(async () => new Response('ok'));
    await forwardToSignin(
      new Request(
        'https://dev-signin.shyden.co.uk/pass?for=dev.shyden.co.uk&back=%2F',
      ),
      env,
      forward,
    );
    const sent = forwarded(forward);
    expect(sent.url).toBe(
      'https://shyden-dev-signin.example.workers.dev/pass?for=dev.shyden.co.uk&back=%2F',
    );
    expect(sent.headers.get(DOOR_SECRET_HEADER)).toBe('door-secret');
  });

  it('sends a path that looks like another host to the sign-in Worker, never to that host', async () => {
    const forward = vi.fn(async () => new Response('ok'));
    await forwardToSignin(
      new Request('https://dev-signin.shyden.co.uk//evil.example/steal?x=1'),
      env,
      forward,
    );
    expect(forwarded(forward).url).toBe(
      'https://shyden-dev-signin.example.workers.dev//evil.example/steal?x=1',
    );
  });

  it("replaces a visitor's own door-secret header", async () => {
    const forward = vi.fn(async () => new Response('ok'));
    const request = new Request('https://dev-signin.shyden.co.uk/pass', {
      headers: { [DOOR_SECRET_HEADER]: 'guess' },
    });
    await forwardToSignin(request, env, forward);
    expect(forwarded(forward).headers.get(DOOR_SECRET_HEADER)).toBe(
      'door-secret',
    );
  });

  it("keeps the method, the body and Access's token", async () => {
    const forward = vi.fn(async () => new Response('ok'));
    const request = new Request(
      'https://dev-signin.shyden.co.uk/app/exchange',
      {
        method: 'POST',
        body: 'code=c&verifier=v',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cf-Access-Jwt-Assertion': 'a.b.c',
        },
      },
    );
    await forwardToSignin(request, env, forward);
    const sent = forwarded(forward);
    expect(sent.method).toBe('POST');
    expect(await sent.text()).toBe('code=c&verifier=v');
    expect(sent.headers.get('Cf-Access-Jwt-Assertion')).toBe('a.b.c');
  });

  it("hands back the sign-in Worker's redirects instead of following them", async () => {
    const forward = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: 'https://dev.shyden.co.uk/' },
        }),
    );
    const answer = await forwardToSignin(
      new Request('https://dev-signin.shyden.co.uk/signout'),
      env,
      forward,
    );
    expect(forwarded(forward).redirect).toBe('manual');
    expect(answer.status).toBe(302);
    expect(answer.headers.get('Location')).toBe('https://dev.shyden.co.uk/');
  });
});
