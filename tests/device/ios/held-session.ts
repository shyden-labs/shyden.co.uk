/**
 * One real-iPhone WebDriver session for a whole journey file (#800): started
 * before the file's first test and always torn down after its last. Each
 * mirror file holds its own, and vitest.ios.config.ts runs the files one
 * after the other under its one hook limit, so the phone only ever carries
 * one session.
 */
import { afterAll, beforeAll } from 'vitest';
import { startIosSession, type DeviceSession } from './session';

/** Registers the file's session hooks; the returned reader is live once `beforeAll` has run. */
export function holdIosSession(): () => DeviceSession {
  let session: DeviceSession | undefined;
  beforeAll(async () => {
    session = await startIosSession();
  });
  afterAll(async () => {
    // Unset when `startIosSession` itself threw: nothing to tear down.
    await session?.teardown();
  });
  return () => {
    if (session === undefined)
      throw new Error('the iPhone session is read before beforeAll started it');
    return session;
  };
}
