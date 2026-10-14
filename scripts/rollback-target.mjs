/**
 * Which deployment a rollback promotes (#406).
 *
 * rollback.yml once took index `[1]` of the production deployments, on the
 * premise that `[0]` is live. Live is whatever Cloudflare calls the
 * project's `canonical_deployment`, and a rollback re-points it, so after
 * one rollback `[1]` can BE the live deployment: a second default rollback
 * would "promote" what is already live, report success, and change nothing.
 * A failed production deploy listed in between could be promoted too.
 *
 * So the target is derived from what is live: the newest SUCCESSFUL
 * production deployment created before the canonical one. That is right
 * whether or not a rollback adds a deployment entry (the operator ruled the
 * live measurement unnecessary on that ground, 2026-10-13).
 */

import { readFileSync } from 'node:fs';
import { argv, env } from 'node:process';
import { die, messageOf } from './errors.mjs';
import { liveDeploymentOf } from '../src/lib/pages.ts';

/**
 * @typedef {{ id: string, environment: string, created_on: string, latest_stage?: { status?: string } }} Deployment
 */

/**
 * @param {{ deployments: Deployment[], canonicalId: string, requested?: string }} input
 *   `deployments` as Cloudflare lists them; `requested` the operator's
 *   `deployment_id`, if given
 * @returns {string} the id to roll back to
 */
export function rollbackTarget({ deployments, canonicalId, requested }) {
  if (requested) {
    if (requested === canonicalId) {
      throw new Error(
        `deployment_id ${requested} is the live deployment (canonical ${canonicalId}): rolling back to it would change nothing.`,
      );
    }
    return requested;
  }
  const live = deployments.find((d) => d.id === canonicalId);
  if (!live) {
    throw new Error(
      `The live deployment (${canonicalId}) is not among the ${deployments.length} listed: list further back, or give deployment_id.`,
    );
  }
  const liveAt = Date.parse(live.created_on);
  const earlier = deployments
    .filter(
      (d) =>
        d.environment === 'production' &&
        d.latest_stage?.status === 'success' &&
        Date.parse(d.created_on) < liveAt,
    )
    .sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on));
  if (earlier.length === 0) {
    throw new Error(
      `No successful production deployment before the live one (${canonicalId}): nothing to roll back to.`,
    );
  }
  return earlier[0].id;
}

/**
 * rollback.yml's find step: `node scripts/rollback-target.mjs <project.json>
 * <deployments.json>`, the Pages API's project and deployment-list answers,
 * with the operator's `deployment_id`, if any, in `REQUESTED`. Prints the
 * target, or fails with the reason as a workflow error.
 *
 * @returns {Promise<void>}
 */
const main = async () => {
  const [projectFile, deploymentsFile, ...rest] = argv.slice(2);
  if (!projectFile || !deploymentsFile || rest.length > 0)
    die(
      'usage: node scripts/rollback-target.mjs <project.json> <deployments.json>\n' +
        '  the Pages API answers for the project and its deployments;\n' +
        '  REQUESTED holds deployment_id when one was given.',
    );
  try {
    const project = JSON.parse(readFileSync(projectFile, 'utf8'));
    const list = JSON.parse(readFileSync(deploymentsFile, 'utf8'));
    const target = rollbackTarget({
      deployments: list.result ?? [],
      canonicalId: liveDeploymentOf(project),
      requested: env.REQUESTED || undefined,
    });
    process.stdout.write(`${target}\n`);
  } catch (error) {
    die(messageOf(error));
  }
};

// Only when run, never when imported: the unit suite imports the selection
// (#221, `tests/guards/script-entry.test.ts`).
if (import.meta.main) await main();
