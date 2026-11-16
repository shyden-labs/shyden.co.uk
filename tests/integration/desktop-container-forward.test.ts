import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:net';
import { connect } from 'node:net';
import { forwardPort } from '../../scripts/desktop-container.mjs';

/**
 * Inside the desktop group's container, the suite's `baseURL` stays
 * `http://localhost:4321`, the origin every test was written against (a
 * secure context, like CI's), and `forwardPort` carries that port to the
 * Mac's one preview server (#1027). These sockets stay on this machine.
 */

const open: Server[] = [];
afterEach(async () => {
  await Promise.all(
    open.splice(0).map((s) => new Promise((done) => s.close(done))),
  );
});

/** A server on a free port that answers each connection with `reply`. */
async function answering(reply: string): Promise<number> {
  const server = createServer((socket) => {
    socket.once('data', (data) => socket.end(`${reply}:${data}`));
  });
  open.push(server);
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  return (server.address() as { port: number }).port;
}

function ask(port: number, words: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => socket.write(words));
    let heard = '';
    socket.on('data', (data) => (heard += data));
    socket.on('end', () => resolve(heard));
    socket.on('error', reject);
  });
}

describe('forwardPort', () => {
  it("carries each connection both ways to the target, until the target's end", async () => {
    const target = await answering('mac');
    const forward = await forwardPort({
      listenPort: 0,
      targetHost: '127.0.0.1',
      targetPort: target,
    });
    open.push(forward);
    const port = (forward.address() as { port: number }).port;
    expect(await ask(port, 'GET /')).toBe('mac:GET /');
    expect(await ask(port, 'again')).toBe('mac:again');
  });

  it('ends the connection when the target refuses it, never leaving it open', async () => {
    const closed = createServer();
    open.push(closed);
    await new Promise<void>((ready) => closed.listen(0, '127.0.0.1', ready));
    const dead = (closed.address() as { port: number }).port;
    await new Promise((done) => closed.close(done));
    open.pop();
    const forward = await forwardPort({
      listenPort: 0,
      targetHost: '127.0.0.1',
      targetPort: dead,
    });
    open.push(forward);
    const port = (forward.address() as { port: number }).port;
    expect(await ask(port, 'GET /')).toBe('');
  });
});
