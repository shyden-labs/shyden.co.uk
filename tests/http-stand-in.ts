import { afterEach } from 'vitest';
import type { Server } from 'node:http';

/**
 * A list a test file pushes each HTTP server it starts onto; every server on it
 * is closed after each test. Registers its own `afterEach`, so call it once at
 * the top of a test file, never inside a test.
 *
 * One home since #390, when `device-runner.test.ts` and the WebDriver client's
 * tests each carried a copy and `duplication.test.ts` refused the pair; the
 * WebDriver client went in #859.
 */
export function serversClosedAfterEach(): Server[] {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(
      servers
        .splice(0)
        .map(
          (server) =>
            new Promise<void>((resolve) => server.close(() => resolve())),
        ),
    );
  });
  return servers;
}
