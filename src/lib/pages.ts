/**
 * Cloudflare Pages answers, read for the automatic rollback (#748) and the
 * manual one (#406): which deployment is live, whether a rollback was
 * accepted, and whether it took.
 *
 * Pure: every function works from its arguments and returns or throws.
 * `scripts/pages.mjs` and `scripts/rollback-target.mjs` do the fetching.
 * Node runs this file by stripping its types, with no build step, so it uses
 * erasable TypeScript only and imports only `is-record.ts`, by its full name.
 */
import { isRecord } from './is-record.ts';

/**
 * A Pages deployment id: letters, digits and dashes. Anything else could
 * change the API path a token is sent to, or add a line to a step's outputs.
 */
export const DEPLOYMENT_ID = /^[A-Za-z0-9-]+$/;

/**
 * The project's live deployment, from `GET …/pages/projects/<project>`.
 * Live is the project's `canonical_deployment`, never the newest list entry
 * (#406).
 */
export const liveDeploymentOf = (answer: unknown): string => {
  const result = isRecord(answer) ? answer.result : undefined;
  const canonical = isRecord(result) ? result.canonical_deployment : undefined;
  const id = isRecord(canonical) ? canonical.id : undefined;
  if (typeof id !== 'string' || id === '')
    throw new Error('the project answer names no canonical deployment');
  if (!DEPLOYMENT_ID.test(id))
    throw new Error('the canonical deployment id is not a Pages deployment id');
  return id;
};

/** Passes when `POST …/deployments/<id>/rollback` answered success. */
export const rollbackAccepted = (answer: unknown): void => {
  if (isRecord(answer) && answer.success === true) return;
  const errors =
    isRecord(answer) && Array.isArray(answer.errors) ? answer.errors : [];
  const said = errors
    .filter(isRecord)
    .map(({ code, message }) => `${String(code)} ${String(message)}`)
    .join('; ');
  throw new Error(
    `Cloudflare refused the rollback: ${said || 'no reason given'}`,
  );
};

/** Passes when the project answer read after a rollback names `target` live. */
export const confirmLive = (answer: unknown, target: string): void => {
  const live = liveDeploymentOf(answer);
  if (live !== target)
    throw new Error(
      `the rollback was accepted, but the live deployment is ${live}, not ${target}`,
    );
};
