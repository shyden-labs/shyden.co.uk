# A release that fails its live check is rolled back: implementation plan (#748)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a deploy fails its live check, dev and production each put themselves back to the deployment they served before it, and one notice tells the operator about every failed production run.

**Architecture:** A pure module (`src/lib/pages.ts`) reads Cloudflare Pages answers; one script (`scripts/pages.mjs live|rollback`) makes the calls. Each deploy job records the live deployment before it changes anything (`before`); a rollback step with one shared name promotes it back when the check fails: the last step of `verify-dev` on dev, its own `rollback-prod` job on prod. `deploy-failure.ts/.mjs` take a pipeline (`dev`/`prod`) and read the rollback's outcome from the run's jobs.

**Tech Stack:** Node 26 scripts (`.mjs` importing erasable `.ts`), GitHub Actions YAML, Vitest (unit, integration, guards), Cloudflare Pages v4 API.

**Spec:** `docs/superpowers/specs/2026-10-14-automatic-rollback-design.md`

## Global Constraints

- Operator rulings on #748 (comments 6156956394, 6157078223, 6157682286): dev gets the same rollback; production's waits for the operator's approval; the live proof is a planted `@deployed-only` test merged to develop and removed; one notice reports every failed prod run.
- `prod-rollback` (exists): `ShydenMcM` its required reviewer, `main` only, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for the prod account (read through the API 2026-10-14, quoted on #748). `rollback-prod` runs in it, so it waits for his approval. Nothing here creates or changes it, and the global production-approval rule is unchanged.
- No new npm package. Scripts import nothing from `node_modules`.
- One Cloudflare request per action, a time limit, no retry (operator rule): `live` = one GET; `rollback` = one POST, then one GET.
- A deployment id is `^[A-Za-z0-9-]+$` before it reaches a URL or `$GITHUB_OUTPUT`.
- The rollback step is named exactly `Roll back to the deployment before this deploy` (`ROLLBACK_STEP`).
- Dev's notice text is byte-identical to today's when no rollback happened.
- Unit tests: one test per case, no process, no socket, under 1 s wall and 0.07 s own CPU. Integration and guards suites are CI's (proved through `record-floors.yml`, which runs unit, guards and integration whole but only the e2e specs that record a floor, AND through `ci.yml` on the same head for the rest of e2e: a probe through `ci.yml` alone stops at a red unit step and never runs the guards (#744 pass 4), and a record alone never ran `text-over-ribbon` for #619).
- The laptop runs unit, `npx prettier --check`, `npm run lint:tests` and `npx astro check` only.
- Commits say `Refs #748`, never a closing keyword. ONE story commit, staged task by task.

## Review Focus

1. **A release refused at its approval, or failing its build**: `deploy-prod` failed, nothing changed live; no rollback may run. Pinned by Task 4's exact `if:` on `rollback-prod`, and Task 3's `rollbackOf` answering `none` for a skipped rollback job.
2. **The rollback environment missing its secrets** (one removed or renamed in `prod-rollback`): the rollback step never runs, yet the notice must say the rollback FAILED, not "none". Pinned by Task 3's case *a failed job whose rollback step never ran*.
3. **A `before` that is empty or malformed** reaching the promote: `pages.mjs rollback` refuses it before any request. Pinned by Task 2's *an id of another shape is refused before any request*.
4. **`$(...)` swallowing a failed read**: `echo "before=$(node …)"` succeeds even when node fails, so a deploy would proceed with nothing to fall back to. The step assigns first (`before="$(…)"`, which `bash -e` stops on), pinned by Task 4's exact `run:` text.
5. **Cloudflare accepting the rollback but the live deployment not moving**: reported as a failure naming both ids. Pinned by Task 1's `confirmLive` and Task 2's *a canonical that did not move*.
6. **The notice waiting on the approval it asks for**: prod's `report-failure` must not need `rollback-prod`, or a failed release sits unannounced behind an approval nobody knows to give. Pinned by Task 4's *runs after every other job of the file, whatever they did, but those that wait for approval* and Task 3's `waiting` cases.
7. **The outcome lost after the approval**: `report-rollback` must not stop at "nothing failed" when the rollback succeeded. Pinned by Task 3's integration *adds a rolled-back outcome to the open notice*.

---

### Task 1: Read Pages answers, pure

**Files:**
- Create: `src/lib/pages.ts`
- Create: `tests/unit/pages.test.ts`
- Modify: `scripts/rollback-target.mjs` (its canonical read)

**Interfaces:**
- Produces: `DEPLOYMENT_ID: RegExp`; `liveDeploymentOf(answer: unknown): string`; `rollbackAccepted(answer: unknown): void`; `confirmLive(answer: unknown, target: string): void`. Each throws an `Error` whose message is quoted below.

- [ ] **Step 1: Write the failing tests** (`tests/unit/pages.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import {
  DEPLOYMENT_ID,
  confirmLive,
  liveDeploymentOf,
  rollbackAccepted,
} from '../../src/lib/pages';

/**
 * Cloudflare Pages answers for the automatic rollback (#748) and the manual
 * one (#406): what is live, whether a rollback was accepted, and whether it
 * took.
 */

/** A Pages project answer naming `id` as its live deployment. */
const project = (id: unknown) => ({
  success: true,
  result: { name: 'shyden-site', canonical_deployment: { id } },
});

describe('DEPLOYMENT_ID', () => {
  it('is letters, digits and dashes, the whole value', () => {
    expect(DEPLOYMENT_ID.source).toBe('^[A-Za-z0-9-]+$');
  });
});

describe('liveDeploymentOf', () => {
  it("answers the project's canonical deployment id", () => {
    expect(liveDeploymentOf(project('3f2a91c0-77d4-4e0b'))).toBe(
      '3f2a91c0-77d4-4e0b',
    );
  });
  it('a project answer naming no canonical deployment throws', () => {
    expect(() =>
      liveDeploymentOf({ success: true, result: { name: 'shyden-site' } }),
    ).toThrow('the project answer names no canonical deployment');
  });
  it('an empty id throws, rather than name nothing as live', () => {
    expect(() => liveDeploymentOf(project(''))).toThrow(
      'the project answer names no canonical deployment',
    );
  });
  it('an id that could reshape a URL throws', () => {
    expect(() => liveDeploymentOf(project('a/../b'))).toThrow(
      'the canonical deployment id is not a Pages deployment id',
    );
  });
  it('an id carrying a line break, which would add an output line, throws', () => {
    expect(() => liveDeploymentOf(project('a\nevil=1'))).toThrow(
      'the canonical deployment id is not a Pages deployment id',
    );
  });
  it('an answer that is not an object throws', () => {
    expect(() => liveDeploymentOf('nope')).toThrow(
      'the project answer names no canonical deployment',
    );
  });
});

describe('rollbackAccepted', () => {
  it('a success answer passes', () => {
    expect(
      rollbackAccepted({ success: true, result: { id: 'd-prev' } }),
    ).toBeUndefined();
  });
  it("a refusal throws with Cloudflare's own errors", () => {
    expect(() =>
      rollbackAccepted({
        success: false,
        errors: [{ code: 8000007, message: 'Deployment not found' }],
      }),
    ).toThrow('Cloudflare refused the rollback: 8000007 Deployment not found');
  });
  it('an answer without success: true throws, saying no reason was given', () => {
    expect(() => rollbackAccepted({})).toThrow(
      'Cloudflare refused the rollback: no reason given',
    );
  });
});

describe('confirmLive', () => {
  it('passes when the target is the live deployment', () => {
    expect(confirmLive(project('d-prev'), 'd-prev')).toBeUndefined();
  });
  it('throws naming what is live instead', () => {
    expect(() => confirmLive(project('d-new'), 'd-prev')).toThrow(
      'the rollback was accepted, but the live deployment is d-new, not d-prev',
    );
  });
});
```

- [ ] **Step 2: Run it RED against throwing stubs.** Create `src/lib/pages.ts` with each export throwing `new Error('not implemented')` and `DEPLOYMENT_ID = /x/`. Run `PATH=/opt/homebrew/opt/node/bin:$PATH npx vitest run --project unit tests/unit/pages.test.ts`. Expected: all 12 FAIL; any pass is a finding (a test that cannot fail).

- [ ] **Step 3: Implement** (`src/lib/pages.ts`):

```ts
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
```

- [ ] **Step 4: `rollback-target.mjs` reads the live id through it** (one home for the field). Add the import after `import { die, messageOf } from './errors.mjs';`:

```js
import { liveDeploymentOf } from '../src/lib/pages.ts';
```

and replace `canonicalId: project.result?.canonical_deployment?.id ?? '',` with `canonicalId: liveDeploymentOf(project),`. A missing canonical id now stops the find step naming it, where before it reached `rollbackTarget` as `''`.

- [ ] **Step 5: Run green.** Same command: 12 pass. Then `npx vitest run --project unit tests/unit/rollback-target.test.ts`: unchanged, all pass.

- [ ] **Step 6: Stage.** `git add src/lib/pages.ts tests/unit/pages.test.ts scripts/rollback-target.mjs`

---

### Task 2: One script for both calls, against a stand-in Cloudflare

**Files:**
- Create: `scripts/pages.mjs`
- Modify: `scripts/settings.mjs` (one home for the request time limit)
- Modify: `scripts/waiting-reports.mjs`, `scripts/deploy-failure.mjs` (onto it)
- Create: `tests/integration/stand-in-api.ts`
- Create: `tests/integration/pages-script.test.ts`
- Modify: `tests/integration/deploy-failure-script.test.ts` (onto the shared stand-in)
- Modify: `tests/script-entry-shared.ts` (a probe for `pages.mjs`)

**Interfaces:**
- Consumes: Task 1's four exports.
- Produces: `node scripts/pages.mjs live <project>` prints the live id and a newline, exit 0; `node scripts/pages.mjs rollback <project> <id>` prints `Rolled <project> back: the live deployment is <id>.`, exit 0. Usage errors exit 2 printing `usage: node scripts/pages.mjs live <project> | rollback <project> <deployment-id>`; every other failure exits 1 through `die` (`✗ <message>`). `standInApi()` returns `{ received, routes, url, start(), stop() }`.

- [ ] **Step 1: Extract the stand-in** (`tests/integration/stand-in-api.ts`), moved from `deploy-failure-script.test.ts` so the two suites share one (the duplication guard compares function bodies across `tests/`):

```ts
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A local stand-in for an HTTP API (GitHub's, Cloudflare's), for integration
 * tests that run a script as a real process. It records every request, so
 * what a script asked and sent is read off the stand-in's own record, and it
 * answers from `routes`, keyed `METHOD url`. A route set to `null` never
 * answers, so a script's time limit can be proved. Spawn scripts with async
 * `spawn`, never `spawnSync`: the stand-in answers from this process's event
 * loop, which `spawnSync` would block.
 */
export type Received = {
  method: string;
  url: string;
  body: string;
  auth: string;
};
export type Reply = { status: number; body: unknown; location?: string } | null;

export interface StandIn {
  /** Every request, in arrival order; empty it in `beforeEach`. */
  readonly received: Received[];
  /** The answers, read at each request, so a test may replace one. */
  routes: Record<string, Reply>;
  /** `http://127.0.0.1:<port>`, set by `start()`. */
  url: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export const standInApi = (): StandIn => {
  let server: Server | undefined;
  const stand: StandIn = {
    received: [],
    routes: {},
    url: '',
    async start() {
      server = createServer((request, response) => {
        let body = '';
        request.on('data', (chunk) => (body += chunk));
        request.on('end', () => {
          const got = {
            method: request.method ?? '',
            url: request.url ?? '',
            body,
            auth: request.headers.authorization ?? '',
          };
          stand.received.push(got);
          const key = `${got.method} ${got.url}`;
          const reply =
            key in stand.routes
              ? stand.routes[key]
              : { status: 404, body: { message: 'Not Found' } };
          if (reply === null) return; // never answer: the script must time out
          response.writeHead(reply.status, {
            'content-type': 'application/json',
            ...(reply.location === undefined
              ? {}
              : { location: reply.location }),
          });
          response.end(
            typeof reply.body === 'string'
              ? reply.body
              : JSON.stringify(reply.body),
          );
        });
      });
      const listening = server;
      await new Promise<void>((resolve) =>
        listening.listen(0, '127.0.0.1', resolve),
      );
      stand.url = `http://127.0.0.1:${(listening.address() as AddressInfo).port}`;
    },
    stop: () =>
      new Promise<void>((resolve) => {
        if (server === undefined) return resolve();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  return stand;
};
```

- [ ] **Step 2: Move `deploy-failure-script.test.ts` onto it**, by a script that asserts every count (`.superpowers/sdd/748/onto-stand-in.py`, git-ignored):

```python
import re
p='tests/integration/deploy-failure-script.test.ts'; t=open(p).read()
# 1. imports: the stand-in replaces node:http / node:net
for a in ["import { createServer, type Server } from 'node:http';\n","import type { AddressInfo } from 'node:net';\n"]:
    assert t.count(a)==1; t=t.replace(a,'')
a="import { join } from 'node:path';\n"
assert t.count(a)==1
t=t.replace(a,a+"import { standInApi, type Reply } from './stand-in-api';\n")
# 2. the module-level server state and its two type aliases go
s=t.index("type Received = {"); e=t.index("let api = '';\n")+len("let api = '';\n")
assert t[s:e].count('let server: Server;')==1
t=t[:s]+"const stand = standInApi();\n"+t[e:]
# 3. beforeAll/afterAll: the server code goes, start/stop stay
s=t.index("beforeAll(async () => {"); e=t.index("beforeEach(() => {")
t=t[:s]+"beforeAll(() => stand.start());\nafterAll(() => stand.stop());\n"+t[e:]
# 4. every use of the old names
for old,new,n in [("  received.length = 0;\n  routes = failedDeploy();\n","  stand.received.length = 0;\n  stand.routes = failedDeploy();\n",1),
                  ("GITHUB_API_URL: api,","GITHUB_API_URL: stand.url,",1),
                  ("received.map(","stand.received.map(",1),("received.filter(","stand.received.filter(",1),
                  ("expect(received[0].auth)","expect(stand.received[0].auth)",1)]:
    assert t.count(old)==n,(old,t.count(old)); t=t.replace(old,new)
k=len(re.findall(r'(?<![.\w])routes\[',t)); assert k==8,k
t=re.sub(r'(?<![.\w])routes\[','stand.routes[',t)
# 5. the workflow now hands the pipeline (Task 3)
a="        GITHUB_REF_NAME: 'develop',\n"
assert t.count(a)==1; t=t.replace(a,a+"        PIPELINE: 'dev',\n        REPORT: 'failure',\n")
for gone in ['createServer','let server','let routes','AddressInfo']: assert gone not in t, gone
open(p,'w').write(t); print('deploy-failure-script.test.ts on the stand-in')
```

Then `npx prettier --write tests/integration/deploy-failure-script.test.ts`: the renames lengthen lines prettier then wraps. Change the `vitest` import only if `astro check` reports an unused name (none expected).

- [ ] **Step 3: Write the failing integration tests** (`tests/integration/pages-script.test.ts`):

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { standInApi } from './stand-in-api';

/**
 * `scripts/pages.mjs` as a real process (#748), as the deploy and rollback
 * steps run it, against a stand-in answering in Cloudflare's shapes. What it
 * asked is read off the stand-in's record: `live` makes one GET; `rollback`
 * one POST and one GET, never a list read.
 */

const SCRIPT = join(process.cwd(), 'scripts/pages.mjs');
const ACCOUNT = 'acc0123';
const TOKEN = 'cf-token-never-printed';
const PROJECT = `/accounts/${ACCOUNT}/pages/projects/shyden-site`;
const ROLLBACK = `${PROJECT}/deployments/d-prev/rollback`;

const live = (id: string) => ({
  status: 200,
  body: {
    success: true,
    result: { name: 'shyden-site', canonical_deployment: { id } },
  },
});

const stand = standInApi();
beforeAll(() => stand.start());
afterAll(() => stand.stop());
beforeEach(() => {
  stand.received.length = 0;
  stand.routes = {};
});

const run = (
  args: string[],
  overrides: Record<string, string | undefined> = {},
): Promise<{ code: number | null; out: string }> =>
  new Promise((resolve) => {
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries({
      PATH: process.env.PATH,
      CLOUDFLARE_API_URL: stand.url,
      CLOUDFLARE_API_TOKEN: TOKEN,
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
      ...overrides,
    }))
      if (value !== undefined) env[name] = value;
    const child = spawn(process.execPath, [SCRIPT, ...args], { env });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (out += chunk));
    child.on('close', (code) => resolve({ code, out }));
  });

const asked = () => stand.received.map(({ method, url }) => `${method} ${url}`);

describe('live', () => {
  it('prints the live deployment from one GET, sending the token as a bearer', async () => {
    stand.routes[`GET ${PROJECT}`] = live('d-prev');
    const { code, out } = await run(['live', 'shyden-site']);
    expect(code, out).toBe(0);
    expect(out).toBe('d-prev\n');
    expect(asked()).toEqual([`GET ${PROJECT}`]);
    expect(stand.received[0].auth).toBe(`Bearer ${TOKEN}`);
  });
  it('an answer naming no live deployment exits 1, saying so', async () => {
    stand.routes[`GET ${PROJECT}`] = {
      status: 200,
      body: { success: true, result: { name: 'shyden-site' } },
    };
    const { code, out } = await run(['live', 'shyden-site']);
    expect(code).toBe(1);
    expect(out).toBe('✗ the project answer names no canonical deployment\n');
  });
  it('a refused read exits 1 naming the status, and never prints the token', async () => {
    stand.routes[`GET ${PROJECT}`] = {
      status: 403,
      body: { success: false, errors: [{ code: 10000, message: TOKEN }] },
    };
    const { code, out } = await run(['live', 'shyden-site']);
    expect(code).toBe(1);
    expect(out).toBe('✗ Cloudflare answered HTTP 403\n');
  });
  it('a Cloudflare that never answers times out, rather than outliving the job', async () => {
    stand.routes[`GET ${PROJECT}`] = null;
    const { code, out } = await run(['live', 'shyden-site'], {
      PAGES_TIMEOUT_MS: '300',
    });
    expect(code).toBe(1);
    expect(out).toMatch(/aborted|timeout/i);
  });
});

describe('rollback', () => {
  it('promotes with one POST, then confirms with one GET, and reads no list', async () => {
    stand.routes[`POST ${ROLLBACK}`] = {
      status: 200,
      body: { success: true, result: { id: 'd-prev' } },
    };
    stand.routes[`GET ${PROJECT}`] = live('d-prev');
    const { code, out } = await run(['rollback', 'shyden-site', 'd-prev']);
    expect(code, out).toBe(0);
    expect(asked()).toEqual([`POST ${ROLLBACK}`, `GET ${PROJECT}`]);
    expect(out).toBe(
      'Rolled shyden-site back: the live deployment is d-prev.\n',
    );
  });
  it('a refused rollback exits 1 with its errors, and reads nothing after', async () => {
    stand.routes[`POST ${ROLLBACK}`] = {
      status: 200,
      body: {
        success: false,
        errors: [{ code: 8000007, message: 'Deployment not found' }],
      },
    };
    const { code, out } = await run(['rollback', 'shyden-site', 'd-prev']);
    expect(code).toBe(1);
    expect(out).toBe(
      '✗ Cloudflare refused the rollback: 8000007 Deployment not found\n',
    );
    expect(asked()).toEqual([`POST ${ROLLBACK}`]);
  });
  it('a canonical that did not move exits 1 naming both ids', async () => {
    stand.routes[`POST ${ROLLBACK}`] = {
      status: 200,
      body: { success: true, result: { id: 'd-prev' } },
    };
    stand.routes[`GET ${PROJECT}`] = live('d-new');
    const { code, out } = await run(['rollback', 'shyden-site', 'd-prev']);
    expect(code).toBe(1);
    expect(out).toBe(
      '✗ the rollback was accepted, but the live deployment is d-new, not d-prev\n',
    );
  });
  it('an id of another shape is refused before any request', async () => {
    const { code, out } = await run(['rollback', 'shyden-site', '../d-prev']);
    expect(code).toBe(1);
    expect(out).toBe('✗ ../d-prev is not a Pages deployment id\n');
  });
  it('an empty id, as an unset BEFORE hands it, is refused before any request', async () => {
    const { code, out } = await run(['rollback', 'shyden-site', '']);
    expect(code).toBe(1);
    expect(out).toBe('✗  is not a Pages deployment id\n');
  });
});

describe('what the script is given', () => {
  it('a missing token stops before any request, naming it', async () => {
    const { code, out } = await run(['live', 'shyden-site'], {
      CLOUDFLARE_API_TOKEN: undefined,
    });
    expect(code).toBe(1);
    expect(out).toBe(
      '✗ CLOUDFLARE_API_TOKEN is not set, or not in its expected shape\n',
    );
  });
  it('a missing account stops before any request, naming it', async () => {
    const { code, out } = await run(['live', 'shyden-site'], {
      CLOUDFLARE_ACCOUNT_ID: undefined,
    });
    expect(code).toBe(1);
    expect(out).toBe(
      '✗ CLOUDFLARE_ACCOUNT_ID is not set, or not in its expected shape\n',
    );
  });
  it('no command is refused with the usage line and exit 2', async () => {
    const { code, out } = await run([]);
    expect(code).toBe(2);
    expect(out).toBe(
      'usage: node scripts/pages.mjs live <project> | rollback <project> <deployment-id>\n',
    );
  });
  it('a project name that could reshape the path is refused with exit 2', async () => {
    const { code, out } = await run(['live', 'shyden-site/../other']);
    expect(code).toBe(2);
    expect(out).toBe(
      'usage: node scripts/pages.mjs live <project> | rollback <project> <deployment-id>\n',
    );
  });
});
```

These run in CI (integration is CI's): the laptop runs `npx astro check` over them, and the record run in Task 6 runs them.

- [ ] **Step 4: Implement.**

(a) One home for the request time limit (plan review pass 2, F6: `pages.mjs`'s copy scored 0.852 against `waiting-reports.mjs`'s, over the duplication guard's 0.85, and `deploy-failure.mjs` holds the same body under a longer name). Append to `scripts/settings.mjs`:

```js
/**
 * A request time limit in milliseconds: `name` when it is set, as a whole
 * number above zero, else `fallback`.
 *
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
export const timeoutMs = (name, fallback) =>
  process.env[name] === undefined
    ? fallback
    : Number(setting(name, /^[1-9]\d*$/));
```

and its header's `(\`waiting-reports.mjs\`, \`deploy-failure.mjs\`), so the two cannot drift.` becomes `(\`waiting-reports.mjs\`, \`deploy-failure.mjs\`, \`pages.mjs\`), so they cannot` and a last line ` * drift.`. In `scripts/waiting-reports.mjs` and `scripts/deploy-failure.mjs`, each: the import `{ endpoint, setting }` from `./settings.mjs` gains `timeoutMs`; the local `const timeoutMs = () => …;` and the blank line after it go; `AbortSignal.timeout(timeoutMs())` becomes `AbortSignal.timeout(timeoutMs('<NAME>_TIMEOUT_MS', REQUEST_TIMEOUT_MS))` with that file's own name (`WAITING_REPORTS`, `DEPLOY_FAILURE`); each count is asserted at 1; then `npx prettier --write` both.

(b) `scripts/pages.mjs`:

```js
#!/usr/bin/env node
/**
 * Cloudflare Pages, for the automatic rollback (#748) and `rollback.yml`'s
 * promote.
 *
 *   node scripts/pages.mjs live <project>
 *     prints the project's live (canonical) deployment id: one GET.
 *   node scripts/pages.mjs rollback <project> <deployment-id>
 *     promotes that deployment with one POST and no list read, then reads
 *     the project once to confirm it is live.
 *
 * Reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and
 * `CLOUDFLARE_API_URL` (Cloudflare's v4 API by default), so the tests can
 * point it at a local stand-in; `PAGES_TIMEOUT_MS` shortens the request time
 * limit for them. One request per action, with a time limit and no retry
 * (operator rule, 2026-10-02): a promote that fails is reported, not tried
 * again. It prints no token and no answer body. Imports nothing from
 * `node_modules`. Exits 2 on a usage error, 1 on any failure.
 */
import { die, messageOf } from './errors.mjs';
import { endpoint, setting, timeoutMs } from './settings.mjs';
import {
  DEPLOYMENT_ID,
  confirmLive,
  liveDeploymentOf,
  rollbackAccepted,
} from '../src/lib/pages.ts';

/** Each Cloudflare request gives up after this long. */
const REQUEST_TIMEOUT_MS = 30_000;

/** A Pages project name: lower-case letters, digits and dashes. */
const PROJECT = /^[a-z0-9][a-z0-9-]*$/;

const USAGE =
  'usage: node scripts/pages.mjs live <project> | rollback <project> <deployment-id>';

/**
 * A client for one Pages project. Settings are read here, before any
 * request, so a missing one stops the script naming it.
 *
 * @param {string} project
 */
const pages = (project) => {
  const api = endpoint(
    'CLOUDFLARE_API_URL',
    'https://api.cloudflare.com/client/v4',
  );
  const token = setting('CLOUDFLARE_API_TOKEN', /^\S+$/);
  const account = setting('CLOUDFLARE_ACCOUNT_ID', /^\w+$/);
  const base = `${api}/accounts/${account}/pages/projects/${project}`;
  /**
   * The parsed answer, once Cloudflare answered 2xx.
   *
   * @param {'GET' | 'POST'} method
   * @param {string} path
   * @returns {Promise<unknown>}
   */
  return async (method, path) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(
        timeoutMs('PAGES_TIMEOUT_MS', REQUEST_TIMEOUT_MS),
      ),
    });
    const text = await response.text();
    // The status alone: an error body could echo what was sent.
    if (!response.ok)
      throw new Error(`Cloudflare answered HTTP ${response.status}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Cloudflare answered with what is not JSON');
    }
  };
};

/** @param {string[]} args */
const main = async (args) => {
  const [command, project, id, ...rest] = args;
  const shaped = project !== undefined && PROJECT.test(project);
  const usage =
    rest.length > 0 ||
    !shaped ||
    !(
      (command === 'live' && id === undefined) ||
      (command === 'rollback' && id !== undefined)
    );
  if (usage) {
    console.error(USAGE);
    process.exit(2);
  }
  if (command === 'rollback' && !DEPLOYMENT_ID.test(id))
    die(`${id} is not a Pages deployment id`);
  const call = pages(project);
  if (command === 'live') {
    console.log(liveDeploymentOf(await call('GET', '')));
    return;
  }
  rollbackAccepted(await call('POST', `/deployments/${id}/rollback`));
  confirmLive(await call('GET', ''), id);
  console.log(`Rolled ${project} back: the live deployment is ${id}.`);
};

if (import.meta.main)
  await main(process.argv.slice(2)).catch((error) => die(messageOf(error)));
```

- [ ] **Step 5: A probe for its entry point.** In `tests/script-entry-shared.ts`, after the `'rollback-target.mjs'` entry:

```ts
  // With no command it has nothing to read or promote, so it refuses with
  // the usage before any setting or request (#748).
  'pages.mjs': {
    args: [],
    status: 2,
    says: 'usage: node scripts/pages.mjs live <project>',
  },
```

- [ ] **Step 6: Local checks.** `npx prettier --check scripts/pages.mjs tests/integration/stand-in-api.ts tests/integration/pages-script.test.ts tests/integration/deploy-failure-script.test.ts tests/script-entry-shared.ts`; `npx astro check` (0/0/0); `npm run lint:tests` (0 findings).

- [ ] **Step 7: Stage** the eight files.

---

### Task 3: The notice knows its pipeline and the rollback's outcome

**Files:**
- Modify: `src/lib/deploy-failure.ts`
- Modify: `scripts/deploy-failure.mjs`
- Modify: `tests/unit/deploy-failure.test.ts`
- Modify: `tests/integration/deploy-failure-script.test.ts` (a prod describe)

**Interfaces:**
- Consumes: `DEPLOYMENT_ID` (Task 1).
- Produces: `type Pipeline = 'dev' | 'prod'`; `PIPELINES: Record<Pipeline, PipelineText>`; `pipelineOf(value: unknown): Pipeline`; `ROLLBACK_STEP = 'Roll back to the deployment before this deploy'`; `type Rollback = 'rolled-back' | 'failed' | 'waiting' | 'not-run' | 'none'`; `rollbackOf(answer: unknown): Rollback`; `type Report = 'failure' | 'rollback'`; `reportOf(value: unknown): Report`; `ROLLBACK_JOB = 'rollback-prod'`; `rollbackWaits(needs: unknown, pipeline: Pipeline): boolean`; `rollbackQueued(needs: unknown): boolean`; `rollbackAfter(answer: unknown): Rollback`; `beforeOf(needs: unknown, pipeline: Pipeline): string | undefined`; `noticeBody({ pipeline, runUrl, sha, failure, errorLine, unread, rollback, before })`; `openNoticeOf(issues: unknown, title: string)`. `NOTICE_TITLE` is removed (its value is `PIPELINES.dev.title`).

- [ ] **Step 1: Write the failing unit tests.** In `tests/unit/deploy-failure.test.ts`:

(a) The import list becomes `ERROR_LINE_LIMIT, NOTICE_ASSIGNEE, NOTICE_AUTHOR, PIPELINES, ROLLBACK_JOB, ROLLBACK_STEP, beforeOf, failureOf, failedNeeds, lastErrorLine, noticeBody, openNoticeOf, pipelineOf, reportOf, rollbackAfter, rollbackOf, rollbackQueued, rollbackWaits`.

(b) Replace the test `'the notice is titled for what it means, and found again by that title'` with:

```ts
  it('each pipeline names its notice for what it means', () => {
    expect([PIPELINES.dev.title, PIPELINES.prod.title]).toEqual([
      'The dev deploy failed: dev is behind develop',
      'A production release failed',
    ]);
  });
  it('each pipeline reports for its own branch', () => {
    expect([PIPELINES.dev.ref, PIPELINES.prod.ref]).toEqual([
      'develop',
      'main',
    ]);
  });
  it('both workflows roll back in one step name the notice finds', () => {
    expect(ROLLBACK_STEP).toBe(
      'Roll back to the deployment before this deploy',
    );
  });
```

(c) Every existing `noticeBody({ … })` call gains `pipeline: 'dev', rollback: 'none', before: undefined,`; their expected bodies do not change (dev's text with no rollback is today's, byte for byte).

(d) Every `openNoticeOf([...])` call gains a second argument `TITLE` (the describe's own constant, unchanged). After (c) and (d), `npx prettier --write tests/unit/deploy-failure.test.ts`: the added fields and arguments re-wrap some calls.

(e) New describes, appended:

```ts
describe('pipelineOf', () => {
  it('reads dev', () => {
    expect(pipelineOf('dev')).toBe('dev');
  });
  it('reads prod', () => {
    expect(pipelineOf('prod')).toBe('prod');
  });
  it('refuses anything else, naming it', () => {
    expect(() => pipelineOf('production')).toThrow(
      'PIPELINE is "production", not dev or prod',
    );
  });
  it('refuses an unset pipeline', () => {
    expect(() => pipelineOf(undefined)).toThrow(
      'PIPELINE is undefined, not dev or prod',
    );
  });
});

describe('reportOf', () => {
  it('reads failure', () => {
    expect(reportOf('failure')).toBe('failure');
  });
  it('reads rollback', () => {
    expect(reportOf('rollback')).toBe('rollback');
  });
  it('refuses anything else, naming it', () => {
    expect(() => reportOf('outcome')).toThrow(
      'REPORT is "outcome", not failure or rollback',
    );
  });
  it('refuses an unset report', () => {
    expect(() => reportOf(undefined)).toThrow(
      'REPORT is undefined, not failure or rollback',
    );
  });
});

describe('rollbackWaits', () => {
  const needs = (deploy: string, check: string) => ({
    'deploy-prod': { result: deploy, outputs: {} },
    'smoke-and-verify': { result: check, outputs: {} },
  });
  it('names the results rollback-prod runs under', () => {
    expect(PIPELINES.prod.rollbackWhen).toEqual({
      'deploy-prod': 'success',
      'smoke-and-verify': 'failure',
    });
  });
  it('waits after a deploy that succeeded and a check that failed', () => {
    expect(rollbackWaits(needs('success', 'failure'), 'prod')).toBe(true);
  });
  it('does not wait after a check that passed', () => {
    expect(rollbackWaits(needs('success', 'success'), 'prod')).toBe(false);
  });
  it('does not wait after a deploy that failed, which changed nothing live', () => {
    expect(rollbackWaits(needs('failure', 'skipped'), 'prod')).toBe(false);
  });
  it('never waits on dev, whose rollback is a step that has already run', () => {
    expect(
      rollbackWaits(
        {
          'deploy-dev': { result: 'success', outputs: {} },
          'verify-dev': { result: 'failure', outputs: {} },
        },
        'dev',
      ),
    ).toBe(false);
  });
  it('does not wait on needs that are not an object', () => {
    expect(rollbackWaits('not json', 'prod')).toBe(false);
  });
});

describe('rollbackQueued', () => {
  it('reads the job it names', () => {
    expect(ROLLBACK_JOB).toBe('rollback-prod');
  });
  it('a skipped rollback job was never queued', () => {
    expect(
      rollbackQueued({ 'rollback-prod': { result: 'skipped', outputs: {} } }),
    ).toBe(false);
  });
  it('a rollback job that failed was queued', () => {
    expect(
      rollbackQueued({ 'rollback-prod': { result: 'failure', outputs: {} } }),
    ).toBe(true);
  });
  it('a rollback job that succeeded was queued', () => {
    expect(
      rollbackQueued({ 'rollback-prod': { result: 'success', outputs: {} } }),
    ).toBe(true);
  });
  it('needs that do not name it count as queued: a notice too many beats none', () => {
    expect(rollbackQueued({})).toBe(true);
  });
});

describe('rollbackOf', () => {
  const rolling = (conclusion: string | null, jobConclusion: string) => ({
    jobs: [
      job(1, 'Post-prod smoke + prod-verified', 'failure', [
        { name: 'Smoke and verify the live prod site', conclusion: 'failure' },
      ]),
      job(
        2,
        'Roll prod back to the deployment before this release',
        jobConclusion,
        [
          {
            name: 'Check the secrets are set',
            conclusion: conclusion === null ? 'failure' : 'success',
          },
          {
            name: 'Roll back to the deployment before this deploy',
            conclusion,
          },
        ],
      ),
    ],
  });
  it('a rollback step that succeeded rolled back', () => {
    expect(rollbackOf(rolling('success', 'success'))).toBe('rolled-back');
  });
  it('a rollback step that failed failed', () => {
    expect(rollbackOf(rolling('failure', 'failure'))).toBe('failed');
  });
  it('a failed job whose rollback step never ran failed (its secrets were missing)', () => {
    expect(rollbackOf(rolling(null, 'failure'))).toBe('failed');
  });
  it('a rollback job skipped whole, listing no steps, is none', () => {
    expect(
      rollbackOf({
        jobs: [
          job(
            2,
            'Roll prod back to the deployment before this release',
            'skipped',
            [],
          ),
        ],
      }),
    ).toBe('none');
  });
  it('a run with no rollback step at all is none', () => {
    expect(
      rollbackOf({
        jobs: [
          job(2, 'Deploy to Dev', 'failure', [
            { name: 'Build (dev)', conclusion: 'failure' },
          ]),
        ],
      }),
    ).toBe('none');
  });
  it('a skipped rollback step in a job that passed is none', () => {
    expect(rollbackOf(rolling('skipped', 'success'))).toBe('none');
  });
  it('an answer holding no jobs list throws', () => {
    expect(() => rollbackOf({})).toThrow(
      "the run's jobs answer holds no list of jobs",
    );
  });
});

describe('rollbackAfter', () => {
  const after = (
    conclusion: string,
    steps: { name: string; conclusion: string | null }[],
  ) =>
    rollbackAfter({
      jobs: [
        job(
          13,
          'Roll prod back to the deployment before this release',
          conclusion,
          steps,
        ),
      ],
    });
  it('a job that never started, listing no steps, did not run (its approval was refused or expired)', () => {
    expect(after('failure', [])).toBe('not-run');
  });
  it('a rollback step that succeeded rolled back', () => {
    expect(
      after('success', [{ name: ROLLBACK_STEP, conclusion: 'success' }]),
    ).toBe('rolled-back');
  });
  it('a rollback step that failed failed', () => {
    expect(
      after('failure', [{ name: ROLLBACK_STEP, conclusion: 'failure' }]),
    ).toBe('failed');
  });
});

describe('beforeOf', () => {
  it("reads the deploy job's before output", () => {
    expect(
      beforeOf(
        { 'deploy-prod': { result: 'success', outputs: { before: 'd-prev' } } },
        'prod',
      ),
    ).toBe('d-prev');
  });
  it("reads dev's from deploy-dev", () => {
    expect(
      beforeOf(
        { 'deploy-dev': { result: 'success', outputs: { before: 'd-dev' } } },
        'dev',
      ),
    ).toBe('d-dev');
  });
  it('a deploy job that recorded nothing gives undefined', () => {
    expect(
      beforeOf({ 'deploy-prod': { result: 'failure', outputs: {} } }, 'prod'),
    ).toBeUndefined();
  });
  it('an output of another shape gives undefined, never reaching the notice', () => {
    expect(
      beforeOf(
        { 'deploy-prod': { result: 'success', outputs: { before: 'a`b' } } },
        'prod',
      ),
    ).toBeUndefined();
  });
  it('needs that are not an object give undefined', () => {
    expect(beforeOf('not json', 'prod')).toBeUndefined();
  });
});

describe('noticeBody, for a release and its rollback (#748)', () => {
  const RUN =
    'https://github.com/shyden-labs/shyden.co.uk/actions/runs/38500000001';
  const SHA = 'cedea2695eebcb93da9ec1c7277ff71b4363cb8f';
  const SMOKE = {
    jobId: 12,
    job: 'Post-prod smoke + prod-verified',
    step: 'Smoke and verify the live prod site',
  };
  const body = (
    pipeline: 'dev' | 'prod',
    rollback: 'rolled-back' | 'failed' | 'waiting' | 'not-run' | 'none',
    before: string | undefined,
  ) =>
    noticeBody({
      pipeline,
      runUrl: RUN,
      sha: SHA,
      failure: SMOKE,
      errorLine: '1 failed',
      unread: [],
      rollback,
      before,
    });

  it('a rolled-back release says what is live, that main differs, and what to do', () => {
    expect(body('prod', 'rolled-back', 'd-prev')).toBe(
      [
        'A production release of `main` failed.',
        '',
        `- Run: ${RUN}`,
        `- Commit: \`${SHA}\``,
        '- Failed: Post-prod smoke + prod-verified › Smoke and verify the live prod site',
        '- Last error line: `1 failed`',
        `- Rollback: production now serves deployment \`d-prev\`, the one before this release. \`main\` (commit \`${SHA}\`) and the live site now differ. Next: fix forward and redeploy \`main\`, or revert the release on \`main\`.`,
        '',
        'This issue is retired by hand once production serves a release that passed its live check (`prod-verified` on its commit).',
      ].join('\n'),
    );
  });
  it('a failed rollback says production still serves the failing release', () => {
    expect(body('prod', 'failed', 'd-prev').split('\n')[6]).toBe(
      '- Rollback: the rollback FAILED, so production still serves the release that failed its check. Roll back by hand with `rollback.yml` (deployment `d-prev`).',
    );
  });
  it('no rollback, with the live deployment read, names it', () => {
    expect(body('prod', 'none', 'd-prev').split('\n')[6]).toBe(
      '- Rollback: none. Nothing was deployed, or the deploy itself failed, so production should still serve deployment `d-prev`: check https://shyden.co.uk.',
    );
  });
  it('no rollback, with nothing read, says the live deployment was not read', () => {
    expect(body('prod', 'none', undefined).split('\n')[6]).toBe(
      '- Rollback: none, and the live deployment was not read before the deploy: check https://shyden.co.uk.',
    );
  });
  it('a dev rollback says dev now serves the deployment before, and develop differs', () => {
    expect(body('dev', 'rolled-back', 'd-dev').split('\n')[6]).toBe(
      `- Rollback: dev now serves deployment \`d-dev\`, the one before this deploy, so \`develop\` (commit \`${SHA}\`) and dev differ.`,
    );
  });
  it('a failed dev rollback says dev still serves the deploy that failed', () => {
    expect(body('dev', 'failed', 'd-dev').split('\n')[6]).toBe(
      '- Rollback: the automatic rollback failed, so dev still serves the deploy that failed its check (the one before it is `d-dev`).',
    );
  });
  it('dev with no rollback adds no line: its notice is as before', () => {
    expect(body('dev', 'none', 'd-dev').split('\n')).toHaveLength(8);
  });
  it('a waiting rollback names the run to approve it in, and what holding the lock means', () => {
    expect(body('prod', 'waiting', 'd-prev').split('\n')[6]).toBe(
      `- Rollback: waiting for your approval. Approve it in ${RUN} to put production back to deployment \`d-prev\`, the one before this release, or reject it to keep this release live. Until you do, this run holds the production lock: a fix pushed to \`main\` waits behind it, and a manual \`rollback.yml\` cancels it.`,
    );
  });
  it('a rollback that never started says production still serves the failing release', () => {
    expect(body('prod', 'not-run', 'd-prev').split('\n')[6]).toBe(
      '- Rollback: did not run (its approval was refused or expired), so production still serves the release that failed its check. Roll back by hand with `rollback.yml` (deployment `d-prev`).',
    );
  });
  it('dev has no waiting rollback, and refuses one rather than sending a notice without it', () => {
    expect(() => body('dev', 'waiting', 'd-dev')).toThrow(
      'the dev notice has no "waiting" rollback line',
    );
  });
  it('an unread rollback adds no line: the unread jobs are already named', () => {
    expect(
      noticeBody({
        pipeline: 'prod',
        runUrl: RUN,
        sha: SHA,
        failure: undefined,
        errorLine: undefined,
        unread: ["the run's jobs (GitHub answered HTTP 500)"],
        rollback: undefined,
        before: 'd-prev',
      }).split('\n'),
    ).toEqual([
      'A production release of `main` failed.',
      '',
      `- Run: ${RUN}`,
      `- Commit: \`${SHA}\``,
      '- Failed: not named by the run',
      '- Last error line: none read',
      "- Could not be read: the run's jobs (GitHub answered HTTP 500)",
      '',
      'This issue is retired by hand once production serves a release that passed its live check (`prod-verified` on its commit).',
    ]);
  });
});
```

(f) In `describe('openNoticeOf', …)`, add:

```ts
  it('finds the prod notice by its own title, not the dev one', () => {
    expect(
      openNoticeOf(
        [
          issue(726, 'github-actions[bot]', TITLE),
          issue(801, 'github-actions[bot]', 'A production release failed'),
        ],
        'A production release failed',
      ),
    ).toBe(801);
  });
```

- [ ] **Step 2: Run RED.** Add the new exports to `src/lib/deploy-failure.ts` as throwing stubs (`PIPELINES` as `{ dev: {}, prod: {} } as never`, `ROLLBACK_STEP = ''`, `ROLLBACK_JOB = ''`). `npx vitest run --project unit tests/unit/deploy-failure.test.ts`: every new test and every changed `noticeBody`/`openNoticeOf` call FAILS (the old `noticeBody` ignores the new fields only if it still type-checks; the RED is read from the new tests). Any new test passing is a finding.

- [ ] **Step 3: Implement** in `src/lib/deploy-failure.ts`.

(a) Header: replace the first paragraph's first sentence with `A deploy that fails (develop to dev, #725; main to production, #748) opens, or comments on, one issue assigned to the operator, so no failure sits unseen.` and the import line with:

```ts
import { isRecord } from './is-record.ts';
import { DEPLOYMENT_ID } from './pages.ts';
```

and its last sentence with `…, and imports only \`is-record.ts\` and \`pages.ts\`, by their full names.`

(b) Replace `export const NOTICE_TITLE = 'The dev deploy failed: dev is behind develop';` and its comment with:

```ts
/** The pipelines a notice reports for, as each workflow names it in `PIPELINE`. */
export type Pipeline = 'dev' | 'prod';

/** What a notice says, per pipeline. */
export type PipelineText = {
  /** The only branch whose failures are reported. */
  ref: string;
  /** The job that records the live deployment as its `before` output. */
  deployJob: string;
  /** The title, by which a later failure finds the open notice again. */
  title: string;
  opening: string;
  closing: string;
  rolledBack: (before: string | undefined, sha: string) => string;
  rollbackFailed: (before: string | undefined) => string;
  /** `undefined` adds no line: dev's notice with no rollback is as before. */
  noRollback: (before: string | undefined) => string | undefined;
  /** Prod only: the rollback waits for the operator's approval in the run. */
  rollbackWaiting?: (before: string | undefined, runUrl: string) => string;
  /** Prod only: the rollback job never started (its approval was refused or expired). */
  rollbackNotRun?: (before: string | undefined) => string;
  /**
   * Prod only: the needs' results under which `rollback-prod` runs, as its
   * `if:` names them (a guard builds that `if:` from this).
   */
  rollbackWhen?: Readonly<Record<string, string>>;
};

const named = (before: string | undefined) =>
  before === undefined ? 'unknown' : `\`${before}\``;

const byHand = (before: string | undefined) =>
  before === undefined ? '' : ` (deployment \`${before}\`)`;

export const PIPELINES: Record<Pipeline, PipelineText> = {
  dev: {
    ref: 'develop',
    deployJob: 'deploy-dev',
    title: 'The dev deploy failed: dev is behind develop',
    opening:
      'A deploy of `develop` to dev failed, so dev.shyden.co.uk is behind `develop`.',
    closing:
      "If the cause is outside our code, dispatch `deploy-dev.yml` on develop's head (CLAUDE.md, Releasing). This issue is retired by hand once `dev-verified` is on develop's head.",
    rolledBack: (before, sha) =>
      `- Rollback: dev now serves deployment ${named(before)}, the one before this deploy, so \`develop\` (commit \`${sha}\`) and dev differ.`,
    rollbackFailed: (before) =>
      `- Rollback: the automatic rollback failed, so dev still serves the deploy that failed its check (the one before it is ${named(before)}).`,
    noRollback: () => undefined,
  },
  prod: {
    ref: 'main',
    deployJob: 'deploy-prod',
    title: 'A production release failed',
    opening: 'A production release of `main` failed.',
    closing:
      'This issue is retired by hand once production serves a release that passed its live check (`prod-verified` on its commit).',
    rolledBack: (before, sha) =>
      `- Rollback: production now serves deployment ${named(before)}, the one before this release. \`main\` (commit \`${sha}\`) and the live site now differ. Next: fix forward and redeploy \`main\`, or revert the release on \`main\`.`,
    rollbackFailed: (before) =>
      `- Rollback: the rollback FAILED, so production still serves the release that failed its check. Roll back by hand with \`rollback.yml\`${byHand(before)}.`,
    noRollback: (before) =>
      before === undefined
        ? '- Rollback: none, and the live deployment was not read before the deploy: check https://shyden.co.uk.'
        : `- Rollback: none. Nothing was deployed, or the deploy itself failed, so production should still serve deployment \`${before}\`: check https://shyden.co.uk.`,
    rollbackWaiting: (before, runUrl) =>
      `- Rollback: waiting for your approval. Approve it in ${runUrl} to put production back to deployment ${named(before)}, the one before this release, or reject it to keep this release live. Until you do, this run holds the production lock: a fix pushed to \`main\` waits behind it, and a manual \`rollback.yml\` cancels it.`,
    rollbackNotRun: (before) =>
      `- Rollback: did not run (its approval was refused or expired), so production still serves the release that failed its check. Roll back by hand with \`rollback.yml\`${byHand(before)}.`,
    rollbackWhen: { 'deploy-prod': 'success', 'smoke-and-verify': 'failure' },
  },
};

/** The workflow's `PIPELINE`, refused unless it names one. */
export const pipelineOf = (value: unknown): Pipeline => {
  if (value === 'dev' || value === 'prod') return value;
  throw new Error(`PIPELINE is ${JSON.stringify(value)}, not dev or prod`);
};

/** What a run of the script reports: a failed run, or the rollback's outcome after its approval. */
export type Report = 'failure' | 'rollback';

/** The workflow's `REPORT`, refused unless it names one. */
export const reportOf = (value: unknown): Report => {
  if (value === 'failure' || value === 'rollback') return value;
  throw new Error(
    `REPORT is ${JSON.stringify(value)}, not failure or rollback`,
  );
};

/**
 * The step both workflows roll back in (#748): the last step of dev's
 * `verify-dev`, and the step of prod's `rollback-prod`. The notice finds the
 * rollback by this name in the run's jobs.
 */
export const ROLLBACK_STEP = 'Roll back to the deployment before this deploy';

/** What became of the rollback, or that it waits for the operator's approval. */
export type Rollback =
  'rolled-back' | 'failed' | 'waiting' | 'not-run' | 'none';

/** The production job that rolls back, behind the operator's approval. */
export const ROLLBACK_JOB = 'rollback-prod';

/**
 * Whether the pipeline's rollback now waits for approval: every result its
 * `rollbackWhen` names, read from `${{ toJSON(needs) }}`. Never on dev,
 * whose rollback is a step that has already run.
 */
export const rollbackWaits = (needs: unknown, pipeline: Pipeline): boolean => {
  const when = PIPELINES[pipeline].rollbackWhen;
  return (
    when !== undefined &&
    isRecord(needs) &&
    Object.entries(when).every(([job, result]) => {
      const need = needs[job];
      return isRecord(need) && need.result === result;
    })
  );
};

/**
 * Whether the rollback job was queued at all: anything but skipped. Needs
 * that do not say count as queued, since a notice too many beats none.
 */
export const rollbackQueued = (needs: unknown): boolean => {
  const job = isRecord(needs) ? needs[ROLLBACK_JOB] : undefined;
  return !(isRecord(job) && job.result === 'skipped');
};

/**
 * The rollback's outcome, from the run's jobs answer: its step succeeded or
 * failed; or it never ran in a job that failed (a step before it, such as
 * the secrets check, stopped it), which is a failed rollback too; otherwise
 * none was attempted.
 */
export const rollbackOf = (answer: unknown): Rollback => {
  const jobs = isRecord(answer) ? answer.jobs : undefined;
  if (!Array.isArray(jobs))
    throw new Error("the run's jobs answer holds no list of jobs");
  for (const job of jobs) {
    if (!isRecord(job) || !Array.isArray(job.steps)) continue;
    const step = job.steps.find(
      (each) => isRecord(each) && each.name === ROLLBACK_STEP,
    );
    if (!isRecord(step)) continue;
    if (step.conclusion === 'success') return 'rolled-back';
    if (step.conclusion === 'failure' || job.conclusion === 'failure')
      return 'failed';
    return 'none';
  }
  return 'none';
};

/**
 * The outcome once the queued rollback job is done: as `rollbackOf` reads
 * it, except that no rollback step at all means the job never started (its
 * approval was refused or expired).
 */
export const rollbackAfter = (answer: unknown): Rollback => {
  const outcome = rollbackOf(answer);
  return outcome === 'none' ? 'not-run' : outcome;
};

/**
 * The live deployment the deploy job recorded before it changed anything,
 * from `${{ toJSON(needs) }}`; `undefined` when none was recorded, or it is
 * not in a deployment id's shape (it goes into the notice's text).
 */
export const beforeOf = (
  needs: unknown,
  pipeline: Pipeline,
): string | undefined => {
  const job = isRecord(needs)
    ? needs[PIPELINES[pipeline].deployJob]
    : undefined;
  const outputs = isRecord(job) ? job.outputs : undefined;
  const before = isRecord(outputs) ? outputs.before : undefined;
  return typeof before === 'string' && DEPLOYMENT_ID.test(before)
    ? before
    : undefined;
};
```

(c) `noticeBody` becomes:

```ts
export const noticeBody = ({
  pipeline,
  runUrl,
  sha,
  failure,
  errorLine,
  unread,
  rollback,
  before,
}: {
  pipeline: Pipeline;
  runUrl: string;
  sha: string;
  failure: Failure | undefined;
  errorLine: string | undefined;
  unread: string[];
  /** `undefined` when the run's jobs could not be read. */
  rollback: Rollback | undefined;
  before: string | undefined;
}): string => {
  const text = PIPELINES[pipeline];
  const failed =
    failure === undefined
      ? 'not named by the run'
      : [failure.job, failure.step].filter(Boolean).join(' › ');
  const error =
    errorLine === undefined
      ? 'none read'
      : `\`${errorLine.replaceAll('`', "'")}\``;
  const prodOnly = <T>(line: T | undefined): T => {
    if (line === undefined)
      throw new Error(
        `the ${pipeline} notice has no "${rollback}" rollback line`,
      );
    return line;
  };
  const rolled =
    rollback === 'rolled-back'
      ? text.rolledBack(before, sha)
      : rollback === 'failed'
        ? text.rollbackFailed(before)
        : rollback === 'waiting'
          ? prodOnly(text.rollbackWaiting)(before, runUrl)
          : rollback === 'not-run'
            ? prodOnly(text.rollbackNotRun)(before)
            : rollback === 'none'
              ? text.noRollback(before)
              : undefined;
  return [
    text.opening,
    '',
    `- Run: ${runUrl}`,
    `- Commit: \`${sha}\``,
    `- Failed: ${failed}`,
    `- Last error line: ${error}`,
    ...unread.map((what) => `- Could not be read: ${what}`),
    ...(rolled === undefined ? [] : [rolled]),
    '',
    text.closing,
  ].join('\n');
};
```

(d) `openNoticeOf(issues: unknown, title: string)`: its docblock says "whose title is exactly `title`", and `issue.title === NOTICE_TITLE` becomes `issue.title === title`.

- [ ] **Step 4: The script** (`scripts/deploy-failure.mjs`).

(a) Header: the whole docblock (from `/**` through its ` */`, found once) becomes, since three jobs now run the script:

```js
/**
 * Tell the operator a deploy failed: develop to dev (#725), or main to
 * production (#748). Run by the `report-failure` job of
 * `.github/workflows/deploy-dev.yml` and of `deploy-prod.yml`, after every
 * other job it needs, whatever those did, handed their results in `NEEDS`
 * (`${{ toJSON(needs) }}`); and by `deploy-prod.yml`'s `report-rollback`
 * once the rollback that waits for the operator's approval has run or been
 * refused. It sends nothing unless a job failed on the pipeline's own branch
 * (a dispatched branch's failure is its dispatcher's to read), or, for the
 * rollback's outcome, unless a rollback was queued.
 *
 *   node scripts/deploy-failure.mjs
 *
 * Opens one issue assigned to `NOTICE_ASSIGNEE`, naming the run, the commit,
 * the failed job and step, the failed job's last error line and what became
 * of the rollback; or, while such a notice is still open, comments the same
 * on it.
 *
 * The notice is the one thing that must not fail. A jobs list or a log this
 * cannot read is named in the notice instead of stopping it, and an issue
 * list it cannot read means a new issue: a second notice beats none. Only a
 * notice GitHub refuses, or one opened without its assignee, exits 1.
 *
 * Reads `PIPELINE` (`dev` or `prod`) and `REPORT` (`failure`, or `rollback`
 * for the rollback's outcome), both set by the workflow; `NEEDS`;
 * `GITHUB_REF_NAME`, `GITHUB_API_URL`, `GITHUB_SERVER_URL`,
 * `GITHUB_REPOSITORY`, `GITHUB_RUN_ID` and `GITHUB_SHA` (all set by
 * Actions); and `GITHUB_TOKEN`, which needs `actions: read` and
 * `issues: write`. `DEPLOY_FAILURE_TIMEOUT_MS` shortens the request timeout,
 * so the tests can point it at a local stand-in that never answers. Imports
 * nothing from `node_modules`. Exits 2 on an argument, 1 on any failure.
 */
```

(b) Imports: `NOTICE_TITLE` goes; add `PIPELINES, beforeOf, pipelineOf, reportOf, rollbackAfter, rollbackOf, rollbackQueued, rollbackWaits`.

(c) In `report()`, replace from `const ref = setting('GITHUB_REF_NAME', /^\S+$/);` through the `if (ref !== 'develop') { … }` block with:

```js
  const pipeline = pipelineOf(process.env.PIPELINE);
  const notice = PIPELINES[pipeline];
  const stage = reportOf(process.env.REPORT);
  const ref = setting('GITHUB_REF_NAME', /^\S+$/);
  /** @type {unknown} */
  let needs;
  try {
    needs = JSON.parse(process.env.NEEDS ?? '');
    if (stage === 'rollback') {
      // After the approval nothing need have failed: a rollback that
      // succeeded is still news, so the question is only whether one ran.
      if (!rollbackQueued(needs)) {
        console.log('No rollback was queued: nothing to add.');
        return;
      }
    } else {
      const failed = failedNeeds(needs);
      if (failed.length === 0) {
        console.log('Nothing failed: no notice.');
        return;
      }
      console.log(`Failed: ${failed.join(', ')}.`);
    }
  } catch (error) {
    // Unreadable is never "nothing failed": the notice goes, saying so.
    unread.push(`the run's needs (${messageOf(error)})`);
  }
  if (ref !== notice.ref) {
    console.log(`A failure on ${ref}, not ${notice.ref}: no notice.`);
    return;
  }
```

(d) Replace the jobs read with:

```js
  /** @type {import('../src/lib/deploy-failure.ts').Failure | undefined} */
  let failure;
  // A rollback behind approval waits from the moment its condition holds,
  // whatever the jobs answer says: read from the needs, before any request.
  /** @type {import('../src/lib/deploy-failure.ts').Rollback | undefined} */
  let rollback =
    stage === 'failure' && rollbackWaits(needs, pipeline)
      ? 'waiting'
      : undefined;
  try {
    const jobs = await json(
      `/actions/runs/${run}/jobs?filter=latest&per_page=100`,
    );
    failure = failureOf(jobs);
    rollback ??= stage === 'rollback' ? rollbackAfter(jobs) : rollbackOf(jobs);
  } catch (error) {
    unread.push(`the run's jobs (${messageOf(error)})`);
  }
```

(e) `noticeBody({ … })` gains `pipeline, rollback, before: beforeOf(needs, pipeline),`; `openNoticeOf(await json(…))` gains `, notice.title`; `title: NOTICE_TITLE,` becomes `title: notice.title,` (`notice`, not `text`: `report()` already destructures `text` from `github()`).

(f) `main`: the `report().catch(...)` already turns `pipelineOf`'s and `reportOf`'s throws into `die`, before any request.

- [ ] **Step 5: Integration, prod.** Append to `tests/integration/deploy-failure-script.test.ts`:

```ts
describe('a failed production release (#748)', () => {
  const RUN_URL = `https://github.com/shyden-labs/shyden.co.uk/actions/runs/${RUN}`;
  const COMMENT = `${REPO}/issues/801/comments`;
  const DEPLOYED = {
    id: 11,
    name: 'Deploy to Prod (needs approval)',
    conclusion: 'success',
    steps: [{ name: 'Read the live deployment', conclusion: 'success' }],
  };
  const CHECK_FAILED = {
    id: 12,
    name: 'Post-prod smoke + prod-verified',
    conclusion: 'failure',
    steps: [
      { name: 'Smoke and verify the live prod site', conclusion: 'failure' },
    ],
  };
  const rollbackJob = (conclusion: string | null, steps: object[]) => ({
    id: 13,
    name: 'Roll prod back to the deployment before this release',
    conclusion,
    steps,
  });
  const jobsWith = (rollback: object) => ({
    total_count: 3,
    jobs: [DEPLOYED, CHECK_FAILED, rollback],
  });
  // A job behind approval lists no steps while it waits, nor ever once refused.
  const WAITING = rollbackJob(null, []);
  const ROLLED_BACK = rollbackJob('success', [
    { name: 'Check the secrets are set', conclusion: 'success' },
    {
      name: 'Roll back to the deployment before this deploy',
      conclusion: 'success',
    },
  ]);
  const OPEN_NOTICE = [
    {
      number: 801,
      state: 'open',
      user: { login: 'github-actions[bot]' },
      title: 'A production release failed',
    },
  ];
  const failureStage = {
    PIPELINE: 'prod',
    REPORT: 'failure',
    GITHUB_REF_NAME: 'main',
    NEEDS: JSON.stringify({
      'deploy-prod': { result: 'success', outputs: { before: 'd-prev' } },
      'smoke-and-verify': { result: 'failure', outputs: {} },
    }),
  };
  const rollbackStage = (result: string) => ({
    PIPELINE: 'prod',
    REPORT: 'rollback',
    GITHUB_REF_NAME: 'main',
    NEEDS: JSON.stringify({
      'deploy-prod': { result: 'success', outputs: { before: 'd-prev' } },
      'rollback-prod': { result, outputs: {} },
    }),
  });

  beforeEach(() => {
    stand.routes[`GET ${JOBS}`] = { status: 200, body: jobsWith(WAITING) };
    stand.routes[`GET ${REPO}/actions/jobs/12/logs`] = {
      status: 200,
      body: '2026-10-14T00:00:00.0000000Z ##[error]1 failed\n',
    };
    stand.routes[`POST ${COMMENT}`] = { status: 201, body: {} };
  });

  it('opens "A production release failed" for ShydenMcM at once, naming the rollback that waits for approval', async () => {
    const { code, out } = await run(failureStage);
    expect(code, out).toBe(0);
    const issue = posted('POST', NEW_ISSUE);
    expect(issue.title).toBe('A production release failed');
    expect(issue.assignees).toEqual(['ShydenMcM']);
    expect(String(issue.body).split('\n')).toEqual([
      'A production release of `main` failed.',
      '',
      `- Run: ${RUN_URL}`,
      `- Commit: \`${SHA}\``,
      '- Failed: Post-prod smoke + prod-verified › Smoke and verify the live prod site',
      '- Last error line: `1 failed`',
      `- Rollback: waiting for your approval. Approve it in ${RUN_URL} to put production back to deployment \`d-prev\`, the one before this release, or reject it to keep this release live. Until you do, this run holds the production lock: a fix pushed to \`main\` waits behind it, and a manual \`rollback.yml\` cancels it.`,
      '',
      'This issue is retired by hand once production serves a release that passed its live check (`prod-verified` on its commit).',
    ]);
  });

  it('adds a rolled-back outcome to the open notice, saying main and the live site differ', async () => {
    stand.routes[`GET ${ISSUES}`] = { status: 200, body: OPEN_NOTICE };
    stand.routes[`GET ${JOBS}`] = { status: 200, body: jobsWith(ROLLED_BACK) };
    const { code, out } = await run(rollbackStage('success'));
    expect(code, out).toBe(0);
    expect(String(posted('POST', COMMENT).body).split('\n')[6]).toBe(
      `- Rollback: production now serves deployment \`d-prev\`, the one before this release. \`main\` (commit \`${SHA}\`) and the live site now differ. Next: fix forward and redeploy \`main\`, or revert the release on \`main\`.`,
    );
    expect(out).toContain('Commented on the open notice, #801.');
  });

  it('adds "did not run" to the open notice when the approval was refused and the job never started', async () => {
    stand.routes[`GET ${ISSUES}`] = { status: 200, body: OPEN_NOTICE };
    stand.routes[`GET ${JOBS}`] = {
      status: 200,
      body: jobsWith(rollbackJob('failure', [])),
    };
    const { code, out } = await run(rollbackStage('failure'));
    expect(code, out).toBe(0);
    expect(String(posted('POST', COMMENT).body).split('\n')[6]).toBe(
      '- Rollback: did not run (its approval was refused or expired), so production still serves the release that failed its check. Roll back by hand with `rollback.yml` (deployment `d-prev`).',
    );
  });

  it('with no rollback queued, the outcome report stops before any request', async () => {
    const { code, out } = await run(rollbackStage('skipped'));
    expect(code).toBe(0);
    expect(out).toBe('No rollback was queued: nothing to add.\n');
  });

  it('a production failure on another branch sends nothing', async () => {
    const { code, out } = await run({
      ...failureStage,
      GITHUB_REF_NAME: 'develop',
    });
    expect(code, out).toBe(0);
    expect(out).toBe(
      'Failed: smoke-and-verify.\nA failure on develop, not main: no notice.\n',
    );
  });

  it('no pipeline stops before any request, naming it', async () => {
    const { code, out } = await run({ PIPELINE: '' });
    expect(code).toBe(1);
    expect(out).toBe('✗ PIPELINE is "", not dev or prod\n');
  });

  it('no report stops before any request, naming it', async () => {
    const { code, out } = await run({ REPORT: '' });
    expect(code).toBe(1);
    expect(out).toBe('✗ REPORT is "", not failure or rollback\n');
  });
});
```

(`run`'s overrides spread over its defaults, so `PIPELINE: ''` replaces `'dev'` and `REPORT: ''` replaces `'failure'`.) Then `npx prettier --write tests/integration/deploy-failure-script.test.ts`.

- [ ] **Step 6: Run green.** `npx vitest run --project unit tests/unit/deploy-failure.test.ts tests/unit/pages.test.ts`: all pass. `npx astro check`: 0/0/0. `npm run lint:tests`: 0 findings.

- [ ] **Step 7: Stage** the four files.

---

### Task 4: The workflows, and the guards that hold them

**Files:**
- Modify: `.github/workflows/deploy-prod.yml`
- Modify: `.github/workflows/deploy-dev.yml`
- Modify: `.github/workflows/rollback.yml`
- Modify: `tests/guards/pipeline-wiring.test.ts`

**Interfaces:**
- Consumes: `ROLLBACK_STEP` (Task 3); `pages.mjs` (Task 2).
- Produces: `deploy-prod` and `deploy-dev` job output `before`; job `rollback-prod` (in `prod-rollback`, behind approval); jobs `report-failure` and `report-rollback` in `deploy-prod.yml`; dev's rollback as the last step of `verify-dev`.

- [ ] **Step 1: Write the failing guards** in `tests/guards/pipeline-wiring.test.ts`.

(a) Import beside the other imports: `import { PIPELINES, ROLLBACK_JOB, ROLLBACK_STEP } from '../../src/lib/deploy-failure';`.

(b) The matchers at the top (`deploysProd`, `rollsProdBack`) become, `deploysProd` unchanged:

```ts
// Rolling a project back is the one command that does it (#748), as a whole
// command line: a shell comment naming it is not a rollback, and neither is
// the inline URL rollback.yml once spelled out.
const rollsBack = (project: string) => (scripts: string) =>
  new RegExp(
    String.raw`^[ \t]*node scripts/pages\.mjs rollback ${project}(?![\w.-])`,
    'm',
  ).test(scripts);
const rollsProdBack = rollsBack('shyden-site');
const rollsDevBack = rollsBack('shyden-site-dev');
```

(c) `CLOUDFLARE_ENVIRONMENTS` gains one row, dev's rollback; prod's automatic rollback runs in `prod-rollback`, so the manual row already covers it (ruling 2026-10-14):

```ts
  const CLOUDFLARE_ENVIRONMENTS = [
    {
      does: 'deploys shyden-site-dev',
      environment: 'dev',
      in: (scripts: string) =>
        /--project-name[= ]+shyden-site-dev(?![\w.-])/.test(scripts),
    },
    // Dev rolls back in verify-dev, which is already in `dev` (#748).
    {
      does: 'rolls shyden-site-dev back',
      environment: 'dev',
      in: rollsDevBack,
    },
    { does: 'deploys shyden-site', environment: 'prod', in: deploysProd },
    // By hand (rollback.yml, #241) or once its own release failed its live
    // check (rollback-prod, #748): either way behind the operator's approval.
    {
      does: 'rolls shyden-site back',
      environment: 'prod-rollback',
      in: rollsProdBack,
    },
    {
      does: 'reads the production reports count',
      environment: 'reports-count',
      in: countsWaitingReports,
    },
  ];
```

(d) `'no job that deploys or verifies prod reads a secret meant for dev (#241)'`: unchanged. Its filter already names `prod-rollback`, where `rollback-prod` now runs.

(e) `'the jobs excused from asking for success are the two that judge in a step (#582, #725)'` is renamed `'… are the four that judge in a step (#582, #725, #748)'`, its comment names prod's `report-failure` and `report-rollback`, and its list becomes:

```ts
    expect(aggregates).toEqual([
      'ci.yml build-and-test',
      'deploy-dev.yml report-failure',
      'deploy-prod.yml report-failure',
      'deploy-prod.yml report-rollback',
    ]);
```

(f) The `describe('a failed develop deploy reaches the operator (#725)', …)` block becomes a `describe.each` over both workflows (one generated describe per workflow, the one-test-per-case rule):

```ts
describe.each([
  {
    FILE: 'deploy-dev.yml',
    PIPELINE: 'dev',
    OTHERS: ['gate', 'test', 'deploy-dev', 'verify-dev'],
    AFTER: [] as string[],
  },
  {
    FILE: 'deploy-prod.yml',
    PIPELINE: 'prod',
    OTHERS: ['deploy-prod', 'smoke-and-verify'],
    // Behind the operator's approval, so the notice never waits on them.
    AFTER: ['rollback-prod', 'report-rollback'],
  },
])(
  'a failed deploy in $FILE reaches the operator (#725, #748)',
  ({ FILE, PIPELINE, OTHERS, AFTER }) => {
```

with its `const FILE = 'deploy-dev.yml';` line removed; its test _runs after every other job of the file, whatever they did_ (from its `it(` through its closing `});`, found once) becoming:

```ts
    it('runs after every other job of the file, whatever they did, but those that wait for approval', () => {
      const jobs = workflowJobs(workflow(FILE), FILE)
        .map(({ id }) => id)
        .filter((id) => id !== 'report-failure');
      const others = jobs.filter((id) => !AFTER.includes(id));
      expect([others, jobs.filter((id) => AFTER.includes(id))]).toEqual([
        OTHERS,
        AFTER,
      ]);
      const report = jobNamed(FILE, 'report-failure');
      expect(report.needs).toEqual(others);
      expect(report.condition).toBe('always()');
    });
```

and the env expectation becoming:

```ts
      expect(reporting.env).toEqual({
        NEEDS: '${{ toJSON(needs) }}',
        GITHUB_TOKEN: '${{ github.token }}',
        PIPELINE,
        REPORT: 'failure',
      });
```

(g) A new describe, after it:

```ts
// ---- a release that fails its live check is rolled back (#748) ----------
//
// Read PARSED (tests/workflow-jobs.ts), so a YAML comment can neither trip
// nor satisfy it. The rollback promotes what the deploy job read as live
// before it changed anything; dev does it in verify-dev's last step, prod
// in its own job, and the step is the same command in both.
describe('a release that fails its live check is rolled back (#748)', () => {
  type Step = {
    id?: string;
    name?: string;
    uses?: string;
    run?: string;
    if?: string;
    env?: Record<string, string>;
  };
  type Job = { outputs?: Record<string, string>; steps?: Step[] };
  const jobOf = (file: string, id: string): Job =>
    (parseCleanYaml(workflow(file), file) as { jobs?: Record<string, Job> })
      .jobs?.[id] ?? {};
  const stepsOf = (file: string, id: string) => jobOf(file, id).steps ?? [];

  const CLOUDFLARE_PAIR = {
    CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}',
    CLOUDFLARE_ACCOUNT_ID: '${{ secrets.CLOUDFLARE_ACCOUNT_ID }}',
  };

  describe.each([
    { FILE: 'deploy-prod.yml', JOB: 'deploy-prod', PROJECT: 'shyden-site' },
    { FILE: 'deploy-dev.yml', JOB: 'deploy-dev', PROJECT: 'shyden-site-dev' },
  ])('$FILE $JOB', ({ FILE, JOB, PROJECT }) => {
    it('reads the live deployment before npm ci, assigning it so a failed read stops the job', () => {
      const steps = stepsOf(FILE, JOB);
      const read = steps.findIndex(({ id }) => id === 'live');
      const install = steps.findIndex(({ run }) => run === 'npm ci');
      expect([read > -1, install > -1, read < install]).toEqual([
        true,
        true,
        true,
      ]);
      expect(steps[read]).toEqual({
        name: 'Read the live deployment',
        id: 'live',
        env: CLOUDFLARE_PAIR,
        run: [
          `before="$(node scripts/pages.mjs live ${PROJECT})"`,
          'echo "before=${before}" >> "$GITHUB_OUTPUT"',
          'echo "Live before this deploy: ${before}"',
          '',
        ].join('\n'),
      });
    });
    it('hands the live deployment on as its before output', () => {
      expect(jobOf(FILE, JOB).outputs).toEqual({
        before: '${{ steps.live.outputs.before }}',
      });
    });
  });

  it('dev rolls back as the last step of verify-dev, only when it failed', () => {
    const steps = stepsOf('deploy-dev.yml', 'verify-dev');
    expect(steps.at(-1)).toEqual({
      name: ROLLBACK_STEP,
      if: 'failure()',
      env: {
        ...CLOUDFLARE_PAIR,
        BEFORE: '${{ needs.deploy-dev.outputs.before }}',
      },
      run: 'node scripts/pages.mjs rollback shyden-site-dev "${BEFORE}"',
    });
  });

  it('prod rolls back in its own job, on main, only when the deploy succeeded and the check failed', () => {
    const job = jobNamed('deploy-prod.yml', 'rollback-prod');
    expect([job.needs, job.condition, job.environment]).toEqual([
      ['deploy-prod', 'smoke-and-verify'],
      "!cancelled() && github.ref == 'refs/heads/main' && needs.deploy-prod.result == 'success' && needs.smoke-and-verify.result == 'failure'",
      'prod-rollback',
    ]);
  });

  it("the notice reads a rollback as waiting under exactly rollback-prod's condition", () => {
    const when = Object.entries(PIPELINES.prod.rollbackWhen ?? {});
    const job = jobNamed('deploy-prod.yml', ROLLBACK_JOB);
    expect([job.needs, job.condition]).toEqual([
      when.map(([need]) => need),
      [
        '!cancelled()',
        "github.ref == 'refs/heads/main'",
        ...when.map(([need, result]) => `needs.${need}.result == '${result}'`),
      ].join(' && '),
    ]);
  });

  it("prod reports the rollback's outcome in its own aggregate, once the approval is given or refused", () => {
    const job = jobNamed('deploy-prod.yml', 'report-rollback');
    expect([job.needs, job.condition, job.environment, job.runs]).toEqual([
      ['deploy-prod', ROLLBACK_JOB],
      'always()',
      undefined,
      ['node scripts/deploy-failure.mjs'],
    ]);
    expect(stepsOf('deploy-prod.yml', 'report-rollback').at(-1)?.env).toEqual({
      NEEDS: '${{ toJSON(needs) }}',
      GITHUB_TOKEN: '${{ github.token }}',
      PIPELINE: 'prod',
      REPORT: 'rollback',
    });
  });

  it('runs no npm package code beside the production token: the check, checkout, setup-node, the rollback', () => {
    const steps = stepsOf('deploy-prod.yml', 'rollback-prod');
    expect(
      steps.map(({ name, uses }) => name ?? uses?.replace(/@.*/, '')),
    ).toEqual([
      'Check the secrets are set',
      'actions/checkout',
      'actions/setup-node',
      ROLLBACK_STEP,
    ]);
    expect(steps.at(-1)).toEqual({
      name: ROLLBACK_STEP,
      env: {
        ...CLOUDFLARE_PAIR,
        BEFORE: '${{ needs.deploy-prod.outputs.before }}',
      },
      run: 'node scripts/pages.mjs rollback shyden-site "${BEFORE}"',
    });
  });

  it('the manual rollback promotes through the same script', () => {
    const promote = stepsOf('rollback.yml', 'rollback').find(
      ({ name }) => name === 'Promote it',
    );
    expect(promote?.run).toBe(
      [
        'set -euo pipefail',
        'if [ -z "${TARGET}" ]; then',
        '  echo "::error::No deployment to roll back to: the find step handed on none."',
        '  exit 1',
        'fi',
        'node scripts/pages.mjs rollback shyden-site "${TARGET}"',
        '',
      ].join('\n'),
    );
  });
});
```

(h) In _the rollback checks its secrets first and skips only the promote on a dry run (#241)_, the second assertion matched the endpoint `/deployments/<id>/rollback` in a step's `run:`, which Step 5 moves into `scripts/pages.mjs` (plan review pass 2, F7: the probe found `[]` where it wanted `['Promote it']`). From its comment `// The call that changes what prod serves lives in the skipped step alone:` through its `).toEqual(['Promote it']);` (one occurrence of each, asserted) becomes:

```ts
    // The call that changes what prod serves lives in the skipped step alone:
    // `scripts/pages.mjs rollback`, the command a failed release's automatic
    // rollback runs too (#748), not `live`, which only reads, and not
    // `scripts/rollback-target.mjs`, whose name merely holds the word (#406).
    expect(
      steps
        .filter((step) =>
          /\bscripts\/pages\.mjs rollback(?![\w-])/.test(
            String(step.run ?? ''),
          ),
        )
        .map((step) => step.name),
    ).toEqual(['Promote it']);
```

(i) `npx prettier --write tests/guards/pipeline-wiring.test.ts`: (f)'s `describe.each` header re-wraps.

`jobNamed` is the file-scope helper the #725 block already uses (`tests/guards/pipeline-wiring.test.ts`, `const jobNamed = (file: string, id: string): WorkflowJob`).

- [ ] **Step 2: Watch them fail.** Guards are CI's; the RED is read in Task 6's probe record run. Locally: `npx astro check` (0/0/0) and `npm run lint:tests`.

- [ ] **Step 3: `deploy-prod.yml`.**

(a) In `deploy-prod`, after `runs-on`/`timeout-minutes`/`environment`, add:

```yaml
    # What production served before this release, for rollback-prod (#748).
    outputs:
      before: ${{ steps.live.outputs.before }}
```

and after the `actions/setup-node` step, before `- run: npm ci`:

```yaml
      # What production serves now, read before anything changes it (#748):
      # the deployment rollback-prod returns to if this release fails its
      # live check. Assigned, never inlined into the echo: `bash -e` stops on
      # a failed assignment, but not on a failed `$(...)` inside an argument.
      # A failed read stops the release, with nothing to fall back to.
      - name: Read the live deployment
        id: live
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: |
          before="$(node scripts/pages.mjs live shyden-site)"
          echo "before=${before}" >> "$GITHUB_OUTPUT"
          echo "Live before this deploy: ${before}"
```

(b) After `smoke-and-verify`, append:

```yaml
  # ---- A release that fails its live check is rolled back (#748) ------
  # Only when THIS run deployed (deploy-prod succeeded) and its check failed:
  # a bare failure() is also true after a refused approval or a failed
  # build, which changed nothing live. !cancelled(): a manual rollback.yml
  # cancels this run, and this job then stays out of its way. It runs in
  # `prod-rollback`, behind the operator's approval (#748 ruling 2026-10-14),
  # holds the prod Pages token, and runs no npm package code: never a step
  # of smoke-and-verify, which runs npm ci and Playwright.
  rollback-prod:
    name: Roll prod back to the deployment before this release
    needs: [deploy-prod, smoke-and-verify]
    if: >-
      !cancelled() && github.ref == 'refs/heads/main' &&
      needs.deploy-prod.result == 'success' &&
      needs.smoke-and-verify.result == 'failure'
    runs-on: ubuntu-26.04
    timeout-minutes: 5
    environment:
      name: prod-rollback
      url: https://shyden.co.uk
    steps:
      # Present or absent, never the value, as rollback.yml checks them: a
      # secret removed from prod-rollback is named here, not met by curl.
      - name: Check the secrets are set
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: |
          missing=0
          for name in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID; do
            if [ -n "${!name:-}" ]; then
              echo "${name}: present"
            else
              echo "::error::${name}: absent. It belongs in the prod-rollback environment."
              missing=1
            fi
          done
          [ "$missing" -eq 0 ]
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version-file: .nvmrc
      - name: Roll back to the deployment before this deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          BEFORE: ${{ needs.deploy-prod.outputs.before }}
        run: node scripts/pages.mjs rollback shyden-site "${BEFORE}"

  # ---- Every failed release reaches the operator (#748) -----------------
  # As deploy-dev.yml's report-failure (#725): an aggregate, `if: always()`,
  # handed its needs' results; the script sends nothing unless one failed on
  # main. It does not need rollback-prod: that job waits for the operator's
  # approval, and the notice is how he learns there is one to give. No
  # environment: it reads its own token alone. No npm package code.
  report-failure:
    name: Report a failed release
    needs: [deploy-prod, smoke-and-verify]
    if: always()
    runs-on: ubuntu-26.04
    timeout-minutes: 5
    permissions:
      contents: read
      actions: read
      issues: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version-file: .nvmrc
      - name: Open or comment on the failed-release issue, if a job failed
        if: always()
        env:
          NEEDS: ${{ toJSON(needs) }}
          GITHUB_TOKEN: ${{ github.token }}
          PIPELINE: prod
          REPORT: failure
        run: node scripts/deploy-failure.mjs

  # ---- The rollback's outcome reaches the same issue (#748) -------------
  # Once rollback-prod has run or been refused. An aggregate too: the script
  # sends nothing unless a rollback was queued, and otherwise comments the
  # outcome on the open notice.
  report-rollback:
    name: Report the rollback's outcome
    needs: [deploy-prod, rollback-prod]
    if: always()
    runs-on: ubuntu-26.04
    timeout-minutes: 5
    permissions:
      contents: read
      actions: read
      issues: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version-file: .nvmrc
      - name: Add the rollback's outcome to the failed-release issue
        if: always()
        env:
          NEEDS: ${{ toJSON(needs) }}
          GITHUB_TOKEN: ${{ github.token }}
          PIPELINE: prod
          REPORT: rollback
        run: node scripts/deploy-failure.mjs
```

- [ ] **Step 4: `deploy-dev.yml`.** In `deploy-dev`: the same `outputs:` block and the same `Read the live deployment` step (project `shyden-site-dev`, comment naming verify-dev's rollback step instead of rollback-prod), after setup-node and before `npm ci`. At the end of `verify-dev`'s steps:

```yaml
      # The deploy failed its live check (#748): dev goes back to what it
      # served before, by the same command as production's rollback. Here
      # because verify-dev is already in `dev`, which holds the dev pair; a
      # job of its own would sit below two conditional jobs, where the
      # skipped-upstream rule (tests/workflow-jobs.ts) requires success.
      - name: Roll back to the deployment before this deploy
        if: failure()
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          BEFORE: ${{ needs.deploy-dev.outputs.before }}
        run: node scripts/pages.mjs rollback shyden-site-dev "${BEFORE}"
```

and in `report-failure`'s last step env, add `PIPELINE: dev` and `REPORT: failure`.

- [ ] **Step 5: `rollback.yml`.** Replace the "Promote it" step's `run:` with:

```yaml
        run: |
          set -euo pipefail
          if [ -z "${TARGET}" ]; then
            echo "::error::No deployment to roll back to: the find step handed on none."
            exit 1
          fi
          node scripts/pages.mjs rollback shyden-site "${TARGET}"
```

(its `env:` unchanged), and the header's `instantly re-promote` paragraph gains: `The promote is \`scripts/pages.mjs\`, the same command a failed release's automatic rollback runs (#748).`

- [ ] **Step 6: Local checks.** `npx prettier --check .github/workflows/*.yml tests/guards/pipeline-wiring.test.ts`; `npx astro check`; `npm run lint:tests`; `npm run test:unit` (expected: green except recorded-floor growth, named by the record in Task 6).

- [ ] **Step 7: Stage** the four files.

---

### Task 5: Rules and docs

**Files:**
- Modify: `CLAUDE.md` (Releasing)

The global production-approval rule is unchanged (ruling 2026-10-14): the production rollback stays behind approval.

- [ ] **Step 1: Repo `CLAUDE.md`.** After the paragraph beginning `**Production was verified by \`curl\` until it wasn't enough.**`, add:

```markdown
  **A release that fails its live check is rolled back on one approval (#748).** Each deploy job reads what is live before it changes anything (`node scripts/pages.mjs live`, the job output `before`). When the live check then fails, the deployment goes back to `before` by one command, `node scripts/pages.mjs rollback`, in a step named `Roll back to the deployment before this deploy`. On dev that is the last step of `verify-dev` (`if: failure()`), and it runs at once. On production it is its own job, `rollback-prod`, which runs only on `main`, only when `deploy-prod` succeeded and `smoke-and-verify` failed, in the `prod-rollback` environment, so it waits for the operator's approval (his ruling 2026-10-14). The notice does not wait with it: `report-failure` opens or comments on one issue at once, naming what failed, what is live, and the run whose approval puts production back, and `report-rollback` adds the outcome to the same issue once the approval is given or refused. While the rollback waits, the run holds the production lock: a fix pushed to `main` waits behind it, and a manual `rollback.yml` cancels it. `rollback.yml` stays the manual path, behind the same approval, and promotes through the same script.
```

- [ ] **Step 2: Stage** `CLAUDE.md`.

---

### Task 6: Prove it, record it, ship it

- [ ] **Step 1: One story commit.** `git commit` with a message naming every part (Tasks 1-5), `Refs #748`, the attribution lines. `node scripts/closing-keywords.mjs <msg-file> "this commit message"` first.

- [ ] **Step 2: Push and record.** `git push`, then `gh workflow run record-floors.yml --ref develop -f branch=748-auto-rollback`, waited on with `~/.claude/scripts/wait-run.sh`. The record runs unit, guards and integration whole, and only the e2e specs that record a floor: a refusal names every non-floor failure in those. Dispatch `ci.yml` on the same head as well (`gh workflow run ci.yml --ref 748-auto-rollback`) and read every e2e shard by name; the story is green only when both are. Read the record job's log by name, every suite's totals. Green: `git fetch origin 748-auto-rollback && git reset --keep origin/748-auto-rollback`, read the bot head's message: expected floor moves `pipeline-wiring/secret-readers`, `cloudflare-secret-readers`, `prod-jobs`, tree-wide file counts, `script-entry` probes.

- [ ] **Step 3: Mutations, predicted before any run.** Each on a probe branch from the recorded head, dispatched through `record-floors.yml` (unit, guards, integration) and, for an e2e mutation, `ci.yml`, its RED read from a message no other mutation in the run produces. Log in `.superpowers/sdd/748/mutations.md` with run ids.

| # | Mutation | Predicted RED |
|---|---|---|
| R1 | `rollback-prod`'s `if:` loses `needs.deploy-prod.result == 'success' &&` | guards: *prod rolls back in its own job …* |
| R2 | `rollback-prod`'s `if:` becomes `failure()` | guards: the same test, and `skippedUpstreamFindings` is untouched (prod has no conditional upstream) |
| R3 | `deploy-prod`'s read becomes `echo "before=$(node scripts/pages.mjs live shyden-site)" >> "$GITHUB_OUTPUT"` | guards: *reads the live deployment before npm ci …* (deploy-prod) |
| R4 | dev's rollback step moves before `Post dev-verified status` | guards: *dev rolls back as the last step of verify-dev* |
| R5 | `rollback-prod` gains `- run: npm ci` before the rollback | guards: *runs no npm package code …* |
| R6 | `rollback-prod`'s environment becomes `prod` (a reviewer still, but the deploy's own credential) | guards: *a Cloudflare secret is read only in the environment …* and *prod rolls back in its own job …* |
| R7 | `pages.mjs` drops `confirmLive(...)` | integration: *a canonical that did not move exits 1 naming both ids* |
| R8 | `pages.mjs` reads the deployment list before promoting (`await call('GET', '/deployments')`) | integration: *promotes with one POST, then confirms with one GET, and reads no list* |
| R9 | `rollbackOf` drops `|| job.conclusion === 'failure'` | unit: *a failed job whose rollback step never ran failed* |
| R10 | `report-failure` in `deploy-prod.yml` gains `rollback-prod` in `needs` (the notice would wait on the approval it asks for) | guards: *runs after every other job of the file, whatever they did, but those that wait for approval* (deploy-prod.yml) |
| R11 | `beforeOf` drops the `DEPLOYMENT_ID` test | unit: *an output of another shape gives undefined* |
| R12 | `rollback.yml` Promote keeps its curl, not the script | guards: *the manual rollback promotes through the same script*; and the Cloudflare-environment test (rollback.yml's job then matches no row) |
| R13 | `PIPELINES.prod.rollbackWhen` drops `'smoke-and-verify': 'failure'` | unit: *does not wait after a check that passed*; guards: *the notice reads a rollback as waiting under exactly rollback-prod's condition* |
| R14 | the script's rollback stage loses its branch (the `failedNeeds` early return runs for both stages) | integration: *adds a rolled-back outcome to the open notice* (`Nothing failed: no notice.`) |
| R15 | `report-rollback`'s `REPORT` becomes `failure` | guards: *prod reports the rollback's outcome in its own aggregate …* |
| R16 | `rollbackAfter` returns `rollbackOf` unchanged | unit: *a job that never started … did not run*; integration: *adds "did not run" …* |

- [ ] **Step 4: Re-read `prod-rollback`** before the PR: `gh api repos/shyden-labs/shyden.co.uk/environments/prod-rollback` (`required_reviewers` naming `ShydenMcM`), `…/deployment-branch-policies` (exactly `main`), `…/secrets` (exactly the two names). First read and quoted 2026-10-14 (#748 comment 6157682286); quote again only what changed.

- [ ] **Step 5: PR** into `develop`: body says the rulings, the design moves from the spec (dev as a step, one script), the measured record, the mutation table with run ids, and that nothing waits on the operator before the merge (the ruling of comment 6157682286). `node scripts/closing-keywords.mjs` on the body first. CI read by name on the head SHA, held runs re-run as the App, merge commit, dev deploy read by name (`dev-verified` on the merge).

- [ ] **Step 6: The live proof (AC5).** A PR adding to `tests/dev/dev-sanity.spec.ts`:

```ts
test(
  'planted failure: dev rolls itself back (#748 live proof, removed by the next PR)',
  {
    tag: '@deployed-only',
    annotation: {
      type: 'deployed-only',
      description:
        "#748's live proof: it must fail after a real deploy, so a pull request's build preview never runs it",
    },
  },
  () => {
    expect('the planted failure').toBe('removed');
  },
);
```

Merge it (its PR checks pass: the test is deployed-only). On develop's deploy, read by name: `deploy-dev` succeeded with `Live before this deploy: <id>`; `verify-dev` failed on the planted test; its rollback step printed `Rolled shyden-site-dev back: the live deployment is <id>.`; `report-failure` opened or commented on the dev notice with the `- Rollback: dev now serves deployment` line. Quote the step timestamps: verify step end -> rollback confirm (the "within a minute" figure). A second PR removes the test; its deploy is green and `dev-verified` is on its merge. Retire the notice by hand.

- [ ] **Step 7: Close.** Every AC on #748 quoted with its evidence; `gh issue close 748` by hand; board Done.

---

## Self-review

- Spec coverage: §1 Task 1-2 and Task 4 Step 3a/4; §2 Tasks 1-2, Task 4 Step 5; §3 Task 4 Steps 3b/4; §4 Task 3, Task 4 Step 3b; §5 Task 6 Step 6; §6 Tasks 1-4, Task 6 Steps 2-3; §7 Task 5, Task 6 Step 4.
- Placeholders: none (`<id>` in Task 6 is a value read from a run).
- Names across tasks: `ROLLBACK_STEP`, `DEPLOYMENT_ID`, `liveDeploymentOf`, `rollbackAccepted`, `confirmLive`, `pipelineOf`, `PIPELINES`, `rollbackOf`, `beforeOf`, `standInApi` used identically in every task.
- Review Focus 1-5 each name their pinning test above.
