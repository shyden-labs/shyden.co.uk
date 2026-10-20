# Cloudflare Access for production's private pages

Production keeps some paths for signed-in people only (#781, operator decision
2026-10-15): today the private API docs at `/api/docs/private/`, and from #782
the report health check at `/api/report/health`. Each person signs in with their
own email; nobody shares a password, and anyone can be removed alone.

Two layers hold the gate, and both must be in place:

1. **Cloudflare Access**, in front of the site, asks for the sign-in and adds a
   signed token (`Cf-Access-Jwt-Assertion`) to each request it lets through.
2. **The site** (`functions/_middleware.js`, `functions/_lib/access.js`)
   checks that token itself on every private path, and answers 403 with no body
   without it. A path Access forgot to cover still refuses, and so does every
   private path until the two settings below exist: the gate fails closed.

dev.shyden.co.uk is not part of this. It keeps its own shared password for
every path (operator decision 2026-10-15).

## One-time setup (the operator, in the Cloudflare dashboard)

1. **Zero Trust → Settings → Custom pages / Team name.** If the account has no
   Zero Trust team yet, create one on the Free plan (up to 50 users). Note the
   team domain, `<team>.cloudflareaccess.com` (this account's is
   `shyden.cloudflareaccess.com`).
2. **Zero Trust → Access → Applications → Add an application → Self-hosted.**
   - Name: `shyden.co.uk private`.
   - Public hostname: domain `shyden.co.uk`, path `api/docs/private`.
   - Add a second public hostname with path `api/report/health` once #782
     is on `develop` and before the release that carries it: from that
     release on, the after-release check sends the service token, which only
     a path Access covers turns into the signed token the site checks.
   - Session duration: 24 hours.
3. **Policies → Add a policy** named `prod`: action **Allow**, include
   **Emails** with the operator's address. This is the "prod" list; a
   developer who needs production is added here, one email at a time.
4. Save, then open the application's **Overview** and copy its **Application
   Audience (AUD) Tag**.
5. **Workers & Pages → the `shyden-site` Pages project (production's; `deploy-prod.yml` deploys to it) → Settings → Variables
   and Secrets → Production**, add:
   - `ACCESS_TEAM_DOMAIN` = `<team>.cloudflareaccess.com` (no `https://`).
   - `ACCESS_AUD` = the AUD tag.
   Production only; the Preview environment needs neither.
6. Redeploy production (the next release does it), then check from a signed-out
   browser: `https://shyden.co.uk/api/docs/private/` must ask for the Access
   sign-in, and after signing in with the listed email the page must load.

## Automation (#782)

A check that calls a private path uses an Access **service token**, never a
person's sign-in. Set up 2026-10-15: token `prod-sanity-2` (expires
2027-10-15, warned by #796), policy `prod-automation`, read by
`deploy-prod.yml`'s `smoke-and-verify` job from the `prod` environment, which
is why that job asks for the release approval too.

1. **Zero Trust → Access controls → Service credentials → Create Service
   Token**, named for the job. Cloudflare shows the Client Secret once.
2. A Service Auth action cannot share a policy with Allow, so the token has
   its own reusable policy: **Policies → Add a policy**, action **Service
   Auth**, **Include → Service Token** naming it; then add that policy to the
   application.
3. Store both values in the GitHub environment the job runs in, never as
   repository secrets: `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`.
   The job sends them as `CF-Access-Client-Id` and `CF-Access-Client-Secret`
   (`tests/access-service-token.ts`); Access then adds the same signed token,
   and the site's check admits it.

## Rotating a service token

A service token lasts a year by default. The expiry check below opens an issue
45 days before one lapses; when it does, or whenever a token must be replaced:

1. **Zero Trust → Access controls → Service credentials → Create Service
   Token**, named for the job with the next number (`prod-sanity-3`). Copy the
   Client ID and the Client Secret; Cloudflare shows the secret once.
2. **GitHub → Settings → Environments → `prod`**: update the secrets
   `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` with the new pair.
3. **Policies → `prod-automation`**: change its **Include → Service Token** to
   the new token, and save.
4. Prove it: the next release's `smoke-and-verify` job calls
   `/api/report/health` with the new pair (or re-run that job on the last
   release). A 403 there means a step above was missed.
5. Delete the old token in Service credentials, update the token's name and
   expiry in **Automation** above, and close the warning issue.

## The expiry check (#796)

`.github/workflows/access-expiry.yml` runs daily on `main` alone: the schedule
starts it on `main`, and only a run on `main` reads the token. It reads every
service token in the account (`GET /accounts/{id}/access/service_tokens`) and
opens one issue per token per expiry date, assigned to ShydenMcM, from 45 days
before it lapses. A run that cannot read every expiry (an empty list, a token
without a readable `expires_at`, a refused request) fails, and its last step
comments the run on the open issue titled _The Access service token expiry
check could not run_, or opens it.

The scheduled run that cannot start the check on `main` reports the same way
(#882), after asking GitHub for the workflow on `main`. While `main` lacks
both this workflow and `waiting-reports.yml`, it posts nothing: the
waiting-reports count's daily notice on #360 already says `main` lacks its
workflow, and one notice a day is enough (operator, 2026-10-20). Until the
first release, that is every day. Missing alone, its comment starts _The Access
service token expiry check was not started: main has no
.github/workflows/access-expiry.yml_, which after a release means the file was
renamed or removed on `main`.

One-time setup (the operator):

1. **Cloudflare → My Profile → API Tokens → Create Token → Custom token**,
   named `access-expiry`, permission **Account → Access: Service Tokens →
   Read**, on this account only.
2. **GitHub → Settings → Environments → New environment** `access-expiry`:
   **Deployment branches and tags → Selected branches → `main`** alone, no
   required reviewer (an unattended daily job, as `reports-count` is). Add the
   secrets `CLOUDFLARE_ACCESS_READ_TOKEN` (step 1's token) and
   `CLOUDFLARE_ACCOUNT_ID`.
3. Dispatch **Access token expiry** on `main` and read its log: one line per
   token with its expiry, then `… watched; none expires within 45 days.`

## Adding or removing a person

Zero Trust → Access → Applications → `shyden.co.uk private` → Policies →
`prod` → edit the Emails rule. The change applies at the person's next sign-in;
to cut off a live session at once, **Zero Trust → My Team → Users → the person
→ Revoke**.
