import { describe, expect, it, vi } from 'vitest';

// The config reads the password when it is imported, so it is set first.
vi.hoisted(() => {
  process.env.DEV_BASIC_AUTH_PASSWORD = 'the-dev-password';
});

import devConfig from '../../playwright.dev.config';

/**
 * The dev password goes to the dev site alone (security review, 2026-11-27).
 * Playwright offers httpCredentials to any origin that challenges unless an
 * origin is named, and the dev suite loads other origins (ShyDesk's embed).
 */
describe('the dev suite sends its password to the dev site only', () => {
  it('names the base URL origin on its httpCredentials', () => {
    const use = devConfig.use ?? {};
    expect(use.httpCredentials).toMatchObject({
      username: 'dev',
      password: 'the-dev-password',
      origin: new URL(String(use.baseURL)).origin,
    });
  });
});
