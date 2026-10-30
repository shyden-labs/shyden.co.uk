import type { PlaywrightTestConfig } from '@playwright/test';

/**
 * The deployed-site suites, run against a pull request's own build (#335).
 *
 * `tests/dev` and `tests/prod` were written for a deployed site, so a stale
 * fact in either used to surface only after a merge, when the deploy's
 * verification failed. Both configs take their base URL from the
 * environment, and against a production build of this tree every test holds
 * except the few that need something `dist/` does not contain. This file is
 * the one home of the switch that points them at that build.
 *
 * Those few are marked where they are written, as details in the literal form
 * `tests/playwright-declarations.ts` can read, with the reason beside the tag:
 *
 *     test('...', {
 *       tag: '@deployed-only',
 *       annotation: { type: 'deployed-only', description: '<why>' },
 *     }, async () => { ... });
 *
 * `tests/integration/sanity-on-build.test.ts` refuses the tag without a reason.
 *
 * `SANITY_ON_BUILD=1` is set by `npm run test:sanity`, which is what CI's
 * `sanity-on-build` job runs. Off, which is every deploy's run, nothing here
 * changes either config.
 */

/** What a sanity config takes from `onBuild` when the switch is on. */
export interface OnBuild {
  webServer: NonNullable<PlaywrightTestConfig['webServer']>;
  grepInvert: RegExp;
  baseURL: string;
}

/**
 * With the switch on, the fragment that makes a sanity config build this
 * tree and preview it on `port`; `undefined` with it off.
 *
 * It is not spread whole into a config: `baseURL` belongs inside the config's
 * own `use`, and a top-level `use` would replace that one, taking
 * `colorScheme` and the dev config's credentials with it.
 *
 * `buildEnv` is ADDED to the environment the build inherits, never swapped
 * for it: Playwright spreads `webServer.env` over `process.env`. A config
 * that must not build with a variable has to refuse it, not unset it.
 *
 * `npm run preview` keeps the server in the foreground, where Playwright owns
 * it and stops it. The lock it leaves in `.astro/preview.json` names a dead
 * process by then, and Astro discards such a lock itself, so the second
 * config's preview starts (measured: the run passes with a lock left behind).
 * A lock naming a LIVE preview stops the run, which is the right answer: two
 * previews of one project is what the lock exists to prevent.
 */
export function onBuild(
  port: number,
  buildEnv: Record<string, string>,
): OnBuild | undefined {
  if (process.env.SANITY_ON_BUILD !== '1') return undefined;
  const baseURL = `http://localhost:${port}`;
  return {
    webServer: {
      command: `npm run build && npm run preview -- --port ${port}`,
      url: baseURL,
      env: buildEnv,
      reuseExistingServer: false,
    },
    grepInvert: /@deployed-only/,
    baseURL,
  };
}
