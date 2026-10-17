# Report API Swagger Implementation Plan (#781)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The report API has hand-written OpenAPI specs checked by in-process contract tests, a public Swagger UI page, and a private one only Cloudflare Access lets through on production, both meeting the full site bar.

**Architecture:** Two OpenAPI 3.1 files under `openapi/` are the one home of each contract: unit tests parse them with `yaml` and drive `handleReport` / `reportHealth` in-process, and each docs page inlines its file at build time (no separate spec URL, so the private spec exists only inside the gated page). Swagger UI comes from `swagger-ui-dist`, bundled by Vite into our own `/_astro/` assets and restyled from the site's tokens by one global stylesheet. On production the middleware refuses `/api/docs/private*` unless the request carries a valid Cloudflare Access JWT (RS256, checked against the team's published keys); dev keeps its Basic Auth gate for every path.

**Tech Stack:** Astro 7, Cloudflare Pages Functions (ESM, `functions/_lib` pure logic), Vitest, Playwright, `yaml` (existing dev dependency), `swagger-ui-dist` 5.33.1 (new, operator-approved 2026-10-15).

**Spec:** the ticket, `gh issue view 781` (ACs 1-7), and its comments of 2026-10-15: the private-gate decision (Cloudflare Access per person, "prod" list, service token for automation; dev keeps its password) and the bar decision (full site bar; English only; out of the sitemap and search engines; AC1's file split into a public and a private spec).

## Global Constraints

- Every page: no horizontal scroll at >= 320px, touch targets >= 44px, WCAG AA in light and dark, five browsers (project `CLAUDE.md`).
- Every page ships the inline theme script plus at most its own one script; `tests/e2e/theme-script.spec.ts` pins the inventory.
- No third-party request from any page (fonts and assets self-hosted). Swagger UI's default `validatorUrl` (`https://validator.swagger.io`) must be `null`.
- A unit test reaches no service and starts no process; each test <= 1 s wall and <= 0.1 s own-thread CPU; file load cost is measured and limited.
- One test per case (no populations looped inside a test); every absence search uses `searched(...)` and a `floorBreach` floor on the same population.
- Every guard is mutation-verified both ways and the mutations are logged in the commit body.
- `Refs #781` in commits and the PR; never a closing keyword.
- New dependency: `swagger-ui-dist` exactly `5.33.1` (Apache-2.0), dev or prod per where Vite needs it (it is bundled, so `dependencies`).
- Production try-it-out only for operations that change nothing: in this API, none on prod (`POST /api/report` writes; the health route is private and read-only but lives on the private page).

## Review Focus

1. A percent-encoded or doubled-slash private path (`/api/docs/%70rivate/`, `//api/docs/private/`, `/api/docs/private/index.html`) must still be refused on prod: gate matching runs on the decoded, slash-collapsed path.
2. An Access JWT that is expired, not yet valid, for another audience, from another issuer, signed by an unknown key, `alg: none` or `HS256`, or malformed base64 must be refused, and a missing `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` must refuse everything (fail closed).
3. The private spec's text must appear in no built file except the private page (no `/_astro/` chunk, no sitemap, no public page).
4. The spec's enums drift when `PAGE_IDS` or the beta locales change (#635 renames `glory-points`): the contract suite compares them to the code's lists.
5. Swagger UI's Try-it-out on prod must not be able to send `POST /api/report` (`supportedSubmitMethods: []` when `isProdHostname`), and must not call the online validator.

---

### Task 1: Public spec and its contract suite

**Files:**
- Create: `openapi/report.yaml`
- Create: `tests/openapi-contract.ts` (shared validator for Tasks 1-2)
- Create: `tests/unit/report-contract.test.ts`

**Interfaces:**
- Produces: `loadSpec(path: string): OpenApiDoc`; `documentedStatuses(doc, path, method): string[]`; `checkResponse(doc, path, method, response: Response): Promise<string[]>` (empty = agrees; each string names one disagreement); `validate(schema, value, at): string[]` (refuses any schema keyword outside `type, enum, const, required, properties, additionalProperties, items, maxLength, minLength, description, format, examples, example`).

- [ ] **Step 1: Write the failing contract test** (`tests/unit/report-contract.test.ts`), one test per documented case, with the request built as `report-endpoint.test.ts` builds it (`post`, `ORIGIN`, `NO_DB`, a `tableWith` fake only for health in Task 2):

```ts
import { describe, expect, it } from 'vitest';
import { handleReport, PAGE_IDS } from '../../src/lib/report';
import { LOCALES, isBetaLocale, getSiteStrings } from '../../src/lib/i18n';
import { loadSpec, checkResponse, documentedStatuses } from '../openapi-contract';

const SPEC = loadSpec('openapi/report.yaml');
const ORIGIN = 'https://dev.shyden.co.uk';
const FORM = 'application/x-www-form-urlencoded';
const quote = getSiteStrings('vi').report.open;
const valid = { locale: 'vi', page: 'home', quote, suggestion: '', note: '', website: '' };
const post = (body: string, headers: Record<string, string> = {}, method = 'POST') =>
  new Request(`${ORIGIN}/api/report`, {
    method,
    headers: { Origin: ORIGIN, 'Content-Type': FORM, ...headers },
    body: method === 'POST' ? body : undefined,
  });
const form = (extra: Record<string, string> = {}) =>
  new URLSearchParams({ ...valid, ...extra }).toString();

// One row per documented case; each row is its own test.
const CASES: readonly [string, () => Request, string][] = [
  ['405 for GET', () => post('', {}, 'GET'), '405'],
  ['403 for a foreign Origin', () => post(form(), { Origin: 'https://evil.example' }), '403'],
  ['415 for JSON', () => post('{}', { 'Content-Type': 'application/json' }), '415'],
  ['413 for a body over 65536 bytes', () => post(form({ note: 'a'.repeat(65536) })), '413'],
  ['400 with no body for an unknown page (form mode)', () => post(form({ page: 'nope' })), '400'],
  ['400 rejected (JSON)', () => post(form({ page: 'nope' }), { Accept: 'application/json' }), '400'],
  ['303 sent for the honeypot (form)', () => post(form({ website: 'x' })), '303'],
  ['200 sent for the honeypot (JSON)', () => post(form({ website: 'x' }), { Accept: 'application/json' }), '200'],
  ['422 not-found (JSON)', () => post(form({ quote: 'zzz nowhere' }), { Accept: 'application/json' }), '422'],
  ['503 failed with no database (JSON)', () => post(form(), { Accept: 'application/json' }), '503'],
];

describe('POST /api/report answers as openapi/report.yaml says', () => {
  it.each(CASES)('%s', async (_, request, status) => {
    const response = await handleReport(request(), {}, () => {});
    expect(String(response.status)).toBe(status);
    expect(await checkResponse(SPEC, '/api/report', 'post', response)).toEqual([]);
  });
});

describe('the spec covers what the code can answer', () => {
  it('lists every status the cases produce, and no other', () => {
    expect(documentedStatuses(SPEC, '/api/report', 'post').sort()).toEqual(
      [...new Set(CASES.map(([, , status]) => status))].sort(),
    );
  });
  it('enumerates the page ids the code accepts', () => {
    expect(pageEnum(SPEC)).toEqual([...PAGE_IDS]);
  });
  it('enumerates the beta locales the code accepts', () => {
    expect(localeEnum(SPEC)).toEqual(LOCALES.filter(isBetaLocale));
  });
});
```

(`pageEnum` / `localeEnum` read `paths./api/report.post.requestBody.content[FORM].schema.properties.{page,locale}.enum`; put them in `tests/openapi-contract.ts` as `formEnum(doc, path, field)`.)

- [ ] **Step 2: Run it and watch it fail** — `npx vitest run tests/unit/report-contract.test.ts`; expected: cannot resolve `../openapi-contract` / `openapi/report.yaml`.

- [ ] **Step 3: Write `tests/openapi-contract.ts`** (fail-closed subset validator; `$ref` resolved only within `#/components/`; unknown keyword => a finding, never a pass):

```ts
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

export type Schema = Record<string, unknown>;
export interface OpenApiDoc { openapi: string; paths: Record<string, Record<string, any>>; components?: { schemas?: Record<string, Schema> } }

const KNOWN = new Set(['type', 'enum', 'const', 'required', 'properties', 'additionalProperties', 'items', 'maxLength', 'minLength', 'description', 'format', 'examples', 'example', '$ref']);

export function loadSpec(path: string): OpenApiDoc {
  const doc = parse(readFileSync(path, 'utf8')) as OpenApiDoc;
  if (!/^3\.1\./.test(doc?.openapi ?? '')) throw new Error(`${path}: not OpenAPI 3.1`);
  return doc;
}

const resolve = (doc: OpenApiDoc, schema: Schema): Schema => {
  const ref = schema.$ref;
  if (typeof ref !== 'string') return schema;
  const name = /^#\/components\/schemas\/(.+)$/.exec(ref)?.[1];
  const target = name && doc.components?.schemas?.[name];
  if (!target) throw new Error(`unresolvable $ref ${ref}`);
  return target;
};

export function validate(doc: OpenApiDoc, raw: Schema, value: unknown, at: string): string[] {
  const schema = resolve(doc, raw);
  const unknown = Object.keys(schema).filter((key) => !KNOWN.has(key));
  if (unknown.length) return [`${at}: schema keyword(s) this checker cannot read: ${unknown.join(', ')}`];
  const found: string[] = [];
  const type = schema.type;
  const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value === 'number' && Number.isInteger(value) ? 'integer' : typeof value;
  if (type && !(type === actual || (type === 'number' && actual === 'integer'))) return [`${at}: ${actual}, spec says ${type}`];
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) found.push(`${at}: ${JSON.stringify(value)} is not in the enum`);
  if ('const' in schema && schema.const !== value) found.push(`${at}: ${JSON.stringify(value)} is not ${JSON.stringify(schema.const)}`);
  if (actual === 'object') {
    const object = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    for (const name of (schema.required ?? []) as string[]) if (!(name in object)) found.push(`${at}.${name}: required, missing`);
    for (const [name, item] of Object.entries(object)) {
      if (properties[name]) found.push(...validate(doc, properties[name], item, `${at}.${name}`));
      else if (schema.additionalProperties === false) found.push(`${at}.${name}: not in the spec`);
    }
  }
  return found;
}

export const operation = (doc: OpenApiDoc, path: string, method: string) => {
  const op = doc.paths?.[path]?.[method];
  if (!op) throw new Error(`the spec has no ${method.toUpperCase()} ${path}`);
  return op;
};

export const documentedStatuses = (doc: OpenApiDoc, path: string, method: string): string[] =>
  Object.keys(operation(doc, path, method).responses ?? {});

export async function checkResponse(doc: OpenApiDoc, path: string, method: string, response: Response): Promise<string[]> {
  const documented = operation(doc, path, method).responses?.[String(response.status)];
  if (!documented) return [`status ${response.status} is not documented`];
  const found: string[] = [];
  for (const [name, header] of Object.entries((documented.headers ?? {}) as Record<string, { required?: boolean }>))
    if (header.required && response.headers.get(name) === null) found.push(`header ${name}: documented as required, missing`);
  const content = documented.content as Record<string, { schema: Schema }> | undefined;
  const type = (response.headers.get('Content-Type') ?? '').split(';')[0].trim();
  const text = await response.text();
  if (!content) return text === '' ? found : [...found, `a body the spec does not document: ${text.slice(0, 80)}`];
  // Form mode answers some statuses with no body; the response says so in the spec, never the checker.
  if (text === '' && type === '' && documented['x-empty-in-form-mode'] === true) return found;
  const media = content[type];
  if (!media) return [...found, `content type ${type || '(none)'} is not documented`];
  return [...found, ...validate(doc, media.schema, JSON.parse(text), 'body')];
}

export const formEnum = (doc: OpenApiDoc, path: string, field: string): unknown[] =>
  operation(doc, path, 'post').requestBody.content['application/x-www-form-urlencoded'].schema.properties[field].enum;
```

- [ ] **Step 4: Write `openapi/report.yaml`** (OpenAPI 3.1; `info.title: Report a translation`; one path `/api/report` with `post` only; `requestBody` `application/x-www-form-urlencoded` with `locale` enum = beta locales, `page` enum = `PAGE_IDS` as on `develop` at the time, `quote` 1-1000, `suggestion`/`note` 0-1000, `website` honeypot; an optional `Accept` header parameter choosing JSON or redirect; responses `200` (JSON `{outcome: sent}`, `additionalProperties: false`), `303` (`Location` header, required), `400` (JSON `{outcome: rejected}` or no body), `403`, `405` (`Allow: POST` header, required), `413`, `415`, `422` (JSON `{outcome: not-found}`), `503` (JSON `{outcome: failed}`); every response documents `Cache-Control: no-store` and `X-Content-Type-Options: nosniff` as required headers). Where a status has both a JSON and an empty form-mode body, document the JSON `content` and say in `description` that the form mode answers with no body, and mark that response `x-empty-in-form-mode: true` (today only `400`); `checkResponse` accepts an empty, untyped body only there. Form-mode-only errors (`403`, `405`, `413`, `415`) document no content. Mutation (f): remove the extension from `400` -> the form-mode 400 case RED.

- [ ] **Step 5: Run and see it pass**; then mutation-verify, logging each: (a) add `418` to the code's 405 branch -> RED "status 418 is not documented"; (b) rename `outcome` to `result` in `json(...)` -> RED (`body.outcome: required, missing` and `body.result: not in the spec`); (c) drop `Allow` from the 405 -> RED; (d) add a page id to `FOOTER_PAGE_IDS` -> RED on the enum test; (e) put `pattern:` in the spec -> RED "keyword(s) this checker cannot read". Restore each and watch GREEN.

- [ ] **Step 6: Measure the file's load and per-test CPU** with the repo's unit timing (the suite prints them); if `loadSpec` at module scope breaks the load limit, cut it, never raise it.

- [ ] **Step 7: Commit** `openapi/report.yaml tests/openapi-contract.ts tests/unit/report-contract.test.ts` — "The report API has a spec its answers are checked against (Refs #781)".

### Task 2: Private health spec and its contract cases

**Files:** Create `openapi/report-health.yaml`; extend `tests/unit/report-contract.test.ts`.

- [ ] **Step 1: Failing tests**: `GET /api/report/health` 200 `{ok:true}` (the `tableWith(REPORT_COLUMNS)` fake from `report-endpoint.test.ts`, copied locally as the existing file does), 503 `{ok:false}` (no binding), 405 for POST (`Allow: GET`); plus "lists every status the cases produce, and no other" for this path.
- [ ] **Step 2: Run, RED (no file).** **Step 3: write the spec** (`info.title: Report health (private)`, `x-private: true`, `servers` omitted). **Step 4: GREEN**, mutations: 503 body `{ok:false, reason}` -> RED; 405 `Allow` dropped -> RED.
- [ ] **Step 5: Commit** "The health route's private spec is checked too (Refs #781)".

### Task 3: The production gate for private paths

**Files:** Create `functions/_lib/access.js`; modify `functions/_middleware.js`; create `tests/unit/access.test.ts`.

**Interfaces:**
- `privatePath(pathname: string): boolean` — decodes (`decodeURIComponent`, a malformed escape counts as private: fail closed), collapses repeated `/`, and matches `/api/docs/private` exactly or followed by `/` or `.`.
- `verifyAccessJwt(token: string | null, { teamDomain, aud, now, keys }): Promise<boolean>` — `keys` is the JWKS `{ keys: JsonWebKey[] }`; RS256 only; checks `iss === https://<teamDomain>`, `aud` includes `aud`, `exp > now`, `nbf <= now` when present, `kid` found; any other shape => false.
- `accessKeys(teamDomain, fetchImpl = fetch)` — GET `https://<teamDomain>/cdn-cgi/access/certs`, cached per isolate for 10 minutes; a non-200 or bad JSON throws, and the middleware answers 403 (fail closed), never 5xx with detail.

- [ ] **Step 1: Failing tests**, one per case: `privatePath` for `/api/docs/private`, `/api/docs/private/`, `/api/docs/private/index.html`, `/api/docs/%70rivate/`, `//api/docs//private/`, `/api/docs/%E0%A4%A/` (malformed -> true); false for `/api/docs/`, `/api/docs/privateer`, `/api/report`. For `verifyAccessJwt`: generate an RSA key pair ONCE at module scope with `crypto.subtle.generateKey` (measure load; if over the load limit, commit a fixed test-only JWK pair as a fixture instead), sign tokens in-process; cases: valid -> true; expired; nbf future; wrong aud; wrong iss; unknown kid; another key under the same kid; a header naming `none`, `HS256` or `RS512` but signed with the team key (so only the alg check can refuse it); `alg: none` with no signature; tampered payload; three-segment garbage; null token; missing teamDomain; missing aud -> each false. No network: `keys` is passed in.
- [ ] **Step 2: RED.** **Step 3: implement** with WebCrypto (`importKey('jwk', …, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' })`, `verify` over `header.payload` bytes, base64url decoding that rejects non-alphabet characters).
- [ ] **Step 4: middleware**: after the www redirect and the legacy redirect, on the prod hostname: `if (privatePath(url.pathname)) { if (!(await accessOk(request, env))) return new Response(null, { status: 403, headers: { 'Cache-Control': 'no-store' } }); }` then `next()`. `accessOk` reads `Cf-Access-Jwt-Assertion`, `env.ACCESS_TEAM_DOMAIN`, `env.ACCESS_AUD`. Dev path unchanged (Basic Auth covers everything).
- [ ] **Step 5: GREEN**; mutations logged: drop the decode; drop the exp check; accept any `alg`; skip the aud check; put the gate after `next()`; make missing env pass — each RED, restored GREEN.
- [ ] **Step 6: Commit** "Production refuses the private docs without a Cloudflare Access sign-in (Refs #781)".

### Task 4: The public docs page

**Files:** `package.json` / `package-lock.json` (`swagger-ui-dist` `5.33.1`); create `src/pages/api/docs/index.astro`, `src/scripts/api-docs.ts`, `src/styles/swagger.css`; modify `src/layouts/BaseLayout.astro` and `src/components/Header.astro` (a `localised?: boolean` prop, default `true`; when `false` the header omits `LanguageSwitcher` and the head omits hreflang); `astro.config.mjs` (sitemap `filter` excluding `/api/docs/`).

- [ ] **Step 1: Failing e2e spec** `tests/e2e/api-docs.spec.ts` (read `tests/e2e/helpers.ts` and the meta-guards in memory "A new e2e spec meets three meta-guards" first: viewport tags, capture order, recorded floors): one test per page per theme per viewport tag: page renders `POST /api/report` with every operation expanded and Try-it-out open; `document.documentElement.scrollWidth === clientWidth`; every visible element with own text meets AA against its effective background (reuse `contrastRatio` from `tests/e2e/helpers.ts`); every visible `button, a, select, input, textarea` is >= 44x44; no request leaves the origin (the existing request-collector idiom, with its liveness count); on a page served as prod host (`isProdHostname` path not reachable in preview: assert the dev behaviour here, prod in Task 6) Try-it-out exists for `post`.
- [ ] **Step 2: RED (no page).** **Step 3: build the page** (feasibility proven in review pass 2): `src/pages/api/docs/index.astro` uses `BaseLayout` with `title="Report API — Shyden"`, `noIndex`, `localised={false}`, `lang="en"`; its frontmatter imports `openapi/report.yaml?raw`, parses it with `yaml` and renders `<div id="swagger" data-spec={JSON.stringify(spec)}>` (frontmatter imports never reach the client: the spec text lands only in the page's HTML). The page imports `swagger-ui-dist/swagger-ui.css`, then `src/styles/swagger.css`. `src/scripts/api-docs.ts` imports `swagger-ui-dist/swagger-ui-bundle.js?url` and loads it as a classic script it appends at run time, then calls `window.SwaggerUIBundle({ spec, domNode, validatorUrl: null, deepLinking: false, supportedSubmitMethods: submitMethods(location.hostname) })`. Do NOT `import` the bundle: Vite makes it one 1.43 MB chunk and warns on every build (measured), and the package's `swagger-ui-es-bundle.js` is CommonJS, not ESM. The options and `window.SwaggerUIBundle` are typed in the script itself (no `@types` package). The page's script inventory is therefore three: the theme script, its inline module, and `/_astro/swagger-ui-bundle.<hash>.js`; `theme-script.spec.ts` lists exactly that for both docs pages.
- [ ] **Step 3c: Scarf opt-out**: `swagger-ui-dist` depends on `@scarf/scarf` 1.4.0 (Apache-2.0), whose `postinstall` reports the install. npm's install-script policy already refuses it here (measured); add `"scarfSettings": { "enabled": false }` to `package.json` as the package documents, and a supply-chain unit test pinning that setting (strip nothing: it is JSON; mutation: remove it -> RED).
- [ ] **Step 3a: Unit-test the Try-it-out switch**: export `submitMethods(hostname: string): string[]` from `src/scripts/api-docs.ts` (pure; `[]` for `isProdHostname`, `['post']` otherwise) and test, one case each with a literal expectation: `shyden.co.uk` -> `[]`, `dev.shyden.co.uk` -> `['post']`, `x.pages.dev` -> `['post']`. Mutation: return `['post']` always -> RED.
- [ ] **Step 3b: Licence (AC6)**: create `THIRD-PARTY-NOTICES.md` (swagger-ui-dist 5.33.1, Apache-2.0) and serve the package's `LICENSE` (and `NOTICE` if it ships one) beside the docs (`public/api/docs/swagger-ui-LICENSE.txt`), linked from both docs pages. Guard (unit, reads two files, no process): the served copy equals `node_modules/swagger-ui-dist/LICENSE` byte for byte. `package.json` pins `"swagger-ui-dist": "5.33.1"` exactly; Dependabot's npm ecosystem already covers it (`supply-chain.test.ts`).
- [ ] **Step 4: Iterate `swagger.css` from tokens until the spec is GREEN in all five engines** (only `var(--…)` tokens; any literal ground carries its own ink per `literal-grounds.test.ts`; `gap` never spaces in `content`); add every new token pair to `tests/unit/contrast.test.ts`.
- [ ] **Step 5: Mutations**: remove one override (e.g. the method label colour) -> the contrast test RED; drop the table's overflow rule -> scroll test RED; set `validatorUrl` back to default -> the off-origin test RED.
- [ ] **Step 6: Commit** "A public Swagger page documents the report API, styled to the site's bar (Refs #781)".

### Task 5: The private docs page

**Files:** create `src/pages/api/docs/private.astro` (same script, inlines `openapi/report-health.yaml`); create `tests/guards/private-spec-stays-private.test.ts`.

- [ ] **Step 1: Failing guard**: after a build, the private spec's sentinel (`x-private: true` serialised, and its `info.title`) appears in exactly one file under `dist/`, `dist/api/docs/private/index.html`, with a liveness probe (the public sentinel appears in exactly `dist/api/docs/index.html`). Guard suite, not unit (it reads the tree).
- [ ] **Step 2-4:** page, GREEN, mutation: import the YAML in `src/scripts/api-docs.ts` -> the sentinel lands in an `/_astro/` chunk -> RED.
- [ ] **Step 5: Commit** "The private health docs live only inside their gated page (Refs #781)".

### Task 6: Page-guard wiring and sanity suites

**Files:** `tests/site-pages.ts` (export `DOCS_PATHS`, derived from `src/pages/api/docs/*.astro`, never listed); `tests/e2e/published-paths.ts` (append `DOCS_PATHS` like `NOT_FOUND_PATH`); `tests/e2e/head-and-sitemap.spec.ts` (the docs pages join the 404 as deliberately out of the sitemap, with their `noindex` asserted); `tests/e2e/theme-script.spec.ts` (inventory: both docs pages carry the theme script plus `api-docs`); `tests/dev/dev-sanity.spec.ts` (public docs renders; Try it out sends `POST /api/report` with the honeypot set and gets `sent` without writing); `tests/prod/prod-sanity.spec.ts` (public docs renders with no Try it out; `@deployed-only` signed-out GET of `/api/docs/private/` is 403 with an empty body, with its reason).

- [ ] Steps: RED per guard where a guard can go red (a docs page missing from `PUBLISHED_ROUTES`, a docs page leaking into the sitemap), wire, GREEN, mutations logged, commit "The docs pages are held by every page guard (Refs #781)".

Note for #782 (not this ticket): it adds `/api/report/health` to `privatePath` and moves its callers to an Access service token.

### Task 7: Operator runbook and PR

- [ ] `docs/ops/cloudflare-access.md`: create the Zero Trust team (if none), an Access application of type self-hosted for `shyden.co.uk/api/docs/private*` with a policy "prod" = the operator's email; copy the team domain and the application's AUD tag into Cloudflare Pages production variables `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`; how to add a developer later.
- [ ] Typecheck (`npx astro check`), prettier, unit; push; floors record; read every CI job by name; PR body with the AC map, mutation logs, and the operator's remaining steps; merge on green; `dev-verified` read off the merge commit; dev Try-it-out shown working.

---

## Review log

**Pass 1 (2026-10-15).** Read: the ticket and its two 2026-10-15 comments, `src/lib/report.ts` (handlers, `JSON_STATUS`, `PAGE_IDS`), `tests/unit/report-endpoint.test.ts` (request builder, D1 fake, its 413 idiom), `functions/_middleware.js`, `functions/_lib/lockdown.js` exports, `tests/site-pages.ts`, `tests/e2e/published-paths.ts`, the 19 tests that iterate pages, `astro.config.mjs`, `BaseLayout.astro` props. Measured stock swagger-ui-dist 5.33.1 at 320px (78px scroll, 7 AA failures, 23 targets < 44px). Ran Task 1 as written in this worktree: RED (module missing), then GREEN 13/13 (commit `0d7d7fff`); mutations (a)-(f) each RED on the predicted test, tree restored to HEAD. Findings fixed in the plan: a hand-set `Content-Length` is not how 413 is reached (oversized body instead); form-mode empty bodies need the spec's own `x-empty-in-form-mode`; the Try-it-out switch needs a pure, unit-tested `submitMethods`; AC6's licence had no home (Step 3b). Not yet run: Tasks 2-7.

**Pass 2 (2026-10-15).** Read: `src/env.d.ts`, how pages attach scripts (`GloryPointsPage.astro`), `swagger-ui-dist`'s files and its dependency. Ran: RSA-2048 key generation in Node, 19.4 ms CPU (load limit 500 ms; sign + verify 0.93 ms), so Task 3 generates its key at module scope. Built the site with a draft docs page: importing the bundle made a 1,426,244-byte chunk and a Vite chunk-size WARN; the `?url` + run-time classic script gives 0 warnings. Rendered it from `astro preview` at 320 px: Swagger UI mounts, 1 operation, Try it out present, only a `data:` SVG outside the origin (no network request), page scroll 390 vs 320 (Task 4's stylesheet). The spec's text is in exactly one built file, `dist/api/docs/index.html`. Findings fixed: Step 3 rewritten for the classic-script load and its three-script inventory; Step 3c added (Scarf). Not yet run: Task 3's JWT code, Tasks 5-7.

**Pass 3 (2026-10-15).** Ran Task 3 as written: RED (module missing), GREEN with `lockdown.test.ts` (83), then 12 mutations. 11 RED at once; "any alg" stayed GREEN because the alg cases also broke the signature, so nothing isolated the header check. Fixed in the plan and the code: the alg cases sign a header naming another algorithm with the team key; re-run, 3 RED. Committed `fc019391`. Also found: `Uint8Array.from` needs `@returns {Uint8Array<ArrayBuffer>}` for `crypto.subtle.verify` under `checkJs`. Not yet run: Task 2, Task 4's stylesheet and guards, Tasks 5-7.

**Pass 4 (2026-10-15).** Built Tasks 4-6 and rehearsed every e2e flow against `astro preview` with the Playwright browser before writing it into a spec. Findings, all fixed in code (the plan's tasks above are superseded where they differ): (1) a header parameter named `Accept` is ignored by OpenAPI and Swagger sent `accept: */*`, which the API answers in form mode, so the spec drops it and the page's `askForJson` request interceptor asks for JSON (unit-tested); (2) `submitMethods` gave production nothing, but AC3 allows what changes nothing, so production allows `get`, dev `get` and `post`; (3) the first e2e flow read Swagger's lists before they rendered and would have measured a collapsed page and passed, so every step now waits for an exact count (one Try it out, one Execute, one response per operation); (4) after an execute, Cancel and Reset overflowed the section header by 55px at 320px, so it wraps; (5) Vite inlines a 55-byte NOTICE as a `data:` URL and `LICENSE` has no extension, so the licence texts are shown in `<details>` instead of linked; (6) Scarf's install script, denied by the operator's decision. Measured with everything open and executed, both pages x both themes x 320/1280: no page or mount scroll, 0 text elements under AA (public 187, private 77), 0 controls under 44px (public 34, private 18). Typecheck 0/0/0. Unit failures only floor growth for the record.
