import { isRecord } from './is-record.ts';

/**
 * The deployment a Cloudflare Pages project serves, and whether a fall-back
 * to an earlier one took (#748). Live is the project's `canonical_deployment`,
 * never the newest entry of its deployment list: a preview or a failed upload
 * can be newer than what visitors get.
 */

/** A Cloudflare Pages deployment id: letters, digits and hyphens. */
export const DEPLOYMENT_ID = /^[A-Za-z0-9-]+$/;

/** A Cloudflare Pages project name: lower-case letters, digits and hyphens. */
export const PROJECT_NAME = /^[a-z0-9-]+$/;

/**
 * The id of the deployment `answer` (the project's API answer) serves.
 * Throws when it names none, or one not shaped like an id; the value itself is
 * never echoed, because it would reach a workflow log and a command line.
 */
export const liveDeploymentOf = (answer: unknown): string => {
  const result = isRecord(answer) ? answer.result : undefined;
  const canonical = isRecord(result) ? result.canonical_deployment : undefined;
  const id = isRecord(canonical) ? canonical.id : undefined;
  if (typeof id !== 'string' || id === '')
    throw new Error('the project answer names no live (canonical) deployment');
  if (!DEPLOYMENT_ID.test(id))
    throw new Error(
      'the live deployment id is not a Cloudflare Pages deployment id',
    );
  return id;
};

/** Throws unless `answer` shows the project serving deployment `id`. */
export const confirmServes = (answer: unknown, id: string): void => {
  const live = liveDeploymentOf(answer);
  if (live !== id) throw new Error(`the project serves ${live}, not ${id}`);
};
