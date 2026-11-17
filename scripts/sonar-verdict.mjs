/**
 * Reads SonarCloud's quality-gate verdict for the analysis THIS run's scan
 * made, and passes only on OK (#851; ported from shyden-labs/repo-template#27's
 * `scripts/sonar-verdict.ts`. Shyden's ruling of 2026-10-18: a scan that does
 * not run fails, and the results are checked, failing the workflow when the
 * gate fails):
 *
 *   node scripts/sonar-verdict.mjs .scannerwork/report-task.txt
 *
 * The scan writes its Compute Engine task id to report-task.txt. This reads
 * that task (`api/ce/task`) and waits while it is pending, up to a stated
 * ceiling (SONAR_CEILING_SECONDS, 300 by default, 5 s at a time: one wait, no
 * retry). It then reads the gate of the analysis that task made
 * (`api/qualitygates/project_status?analysisId=`), never the project's latest.
 * ERROR fails, naming each failed condition with its value and threshold. A
 * missing token, an API error, a failed task, no analysis, a task for another
 * pull request, or any status but OK fails closed, naming what was missing.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * @typedef {{ status: string; metricKey: string; comparator?: string; errorThreshold?: string; actualValue?: string }} Condition
 * @typedef {{ status?: string; conditions?: Condition[] }} ProjectStatus
 * @typedef {{ status: string; analysisId?: string; pullRequest?: string; errorMessage?: string }} Task
 */

const STEP_MS = 5000;
const SONARCLOUD = 'https://sonarcloud.io';

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  throw new Error(`sonar-verdict: ${message}`);
}

/**
 * The scan's task id, server and dashboard, from report-task.txt (`key=value` lines).
 *
 * @param {string} text
 */
export function parseReportTask(text) {
  const values = new Map(
    text
      .split('\n')
      .map((line) => [
        line.slice(0, line.indexOf('=')),
        line.slice(line.indexOf('=') + 1),
      ]),
  );
  /** @param {string} key */
  const get = (key) =>
    values.get(key) ??
    fail(`the scan's report-task.txt has no ${key}; the scan did not finish`);
  const serverUrl = get('serverUrl');
  // The token goes only to SonarCloud. report-task.txt is a file in the
  // workspace, so its server is checked rather than trusted (#851).
  if (serverUrl !== SONARCLOUD) {
    fail(
      `the scan's report-task.txt names the server ${serverUrl}, not ${SONARCLOUD}; the token is sent nowhere else`,
    );
  }
  return {
    serverUrl,
    ceTaskId: get('ceTaskId'),
    dashboardUrl: get('dashboardUrl'),
  };
}

/**
 * Green only on OK; ERROR names each failed condition with its value and threshold.
 *
 * @param {ProjectStatus} status
 * @returns {{ ok: boolean; lines: string[] }}
 */
export function verdict(status) {
  if (status.status === 'OK') return { ok: true, lines: ['quality gate: OK'] };
  if (status.status !== 'ERROR') {
    return {
      ok: false,
      lines: [`quality gate: ${String(status.status)}, not OK`],
    };
  }
  const failed = (status.conditions ?? []).filter((c) => c.status === 'ERROR');
  return {
    ok: false,
    lines: [
      'quality gate: ERROR',
      ...failed.map(
        (c) =>
          `${c.metricKey} is ${String(c.actualValue)}, which fails ${String(c.comparator)} ${c.errorThreshold ?? '(no threshold given)'}`,
      ),
    ],
  };
}

/**
 * @param {string} url
 * @param {string} token
 * @returns {Promise<unknown>}
 */
async function get(url, token) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    fail(`GET ${url} answered ${response.status}; no verdict to read`);
  }
  return response.json();
}

/**
 * Adds a section to the job's summary, when the job has one.
 *
 * @param {string} body
 */
function summary(body) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, `### SonarCloud\n\n${body}\n`);
}

/**
 * This scan's verdict, or a throw naming why there is none.
 *
 * @param {string} path
 * @returns {Promise<{ ok: boolean; lines: string[]; dashboardUrl: string }>}
 */
async function judge(path) {
  const token = process.env.SONAR_TOKEN;
  if (!token) {
    return fail(
      'SONAR_TOKEN is empty; set it as an Actions secret, and as a Dependabot secret for Dependabot pull requests (shyden-labs/repo-template docs/sonarcloud.md)',
    );
  }
  if (!existsSync(path)) {
    fail(`no report-task.txt at ${path}: the scan did not run`);
  }
  const report = parseReportTask(readFileSync(path, 'utf8'));
  const ceiling = Number(process.env.SONAR_CEILING_SECONDS || 300);
  /** @type {Task} */
  let task;
  for (let waited = 0; ; waited += STEP_MS / 1000) {
    task = /** @type {{ task: Task }} */ (
      await get(`${report.serverUrl}/api/ce/task?id=${report.ceTaskId}`, token)
    ).task;
    if (task.status !== 'PENDING' && task.status !== 'IN_PROGRESS') break;
    if (waited >= ceiling) {
      fail(
        `task ${report.ceTaskId} is still ${task.status} after ${ceiling} s; no verdict to read`,
      );
    }
    await sleep(STEP_MS);
  }
  if (task.status !== 'SUCCESS') {
    fail(
      `task ${report.ceTaskId} ended ${task.status}${task.errorMessage ? ` (${task.errorMessage})` : ''}; no verdict to read`,
    );
  }
  if (task.analysisId === undefined) {
    fail(`task ${report.ceTaskId} made no analysis; no verdict to read`);
  }
  const pullRequest = process.env.SONAR_PULL_REQUEST || '';
  if (pullRequest !== '' && task.pullRequest !== pullRequest) {
    fail(
      `task ${report.ceTaskId} analysed pull request ${String(task.pullRequest)}, not ${pullRequest}: a verdict for another commit`,
    );
  }
  const status = /** @type {{ projectStatus: ProjectStatus }} */ (
    await get(
      `${report.serverUrl}/api/qualitygates/project_status?analysisId=${task.analysisId}`,
      token,
    )
  ).projectStatus;
  return { ...verdict(status), dashboardUrl: report.dashboardUrl };
}

/**
 * @param {string[]} args
 * @returns {Promise<number>}
 */
export async function main(args) {
  const [path, ...rest] = args;
  if (path === undefined || rest.length > 0) {
    throw new Error(
      'usage: node scripts/sonar-verdict.mjs <.scannerwork/report-task.txt>',
    );
  }
  try {
    const { ok, lines, dashboardUrl } = await judge(path);
    summary(`The scan ran. ${lines.join('; ')}\n\n${dashboardUrl}`);
    for (const line of lines) {
      (ok ? process.stdout : process.stderr).write(`sonar-verdict: ${line}\n`);
    }
    process.stdout.write(`sonar-verdict: ${dashboardUrl}\n`);
    return ok ? 0 : 1;
  } catch (error) {
    summary(
      `No verdict: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
