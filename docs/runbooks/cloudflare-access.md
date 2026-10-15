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
   team domain, `<team>.cloudflareaccess.com`.
2. **Zero Trust → Access → Applications → Add an application → Self-hosted.**
   - Name: `shyden.co.uk private`.
   - Public hostname: domain `shyden.co.uk`, path `api/docs/private`.
   - Add a second public hostname with path `api/report/health` when #782
     lands.
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

A scheduled check that calls a private path uses an Access **service token**,
never a person's sign-in:

1. **Zero Trust → Access → Service Auth → Create Service Token**, named for the
   job. Copy the Client ID and Client Secret once; Cloudflare will not show the
   secret again.
2. Add to the `prod` policy an **Include → Service Token** rule naming it, with
   action **Service Auth**.
3. Store both values in the GitHub environment the job runs in (branch-restricted
   to `main`, as `prod-cron` is), never as repository secrets. The job sends
   them as `CF-Access-Client-Id` and `CF-Access-Client-Secret`; Access then
   adds the same signed token, and the site's check admits it.

## Adding or removing a person

Zero Trust → Access → Applications → `shyden.co.uk private` → Policies →
`prod` → edit the Emails rule. The change applies at the person's next sign-in;
to cut off a live session at once, **Zero Trust → My Team → Users → the person
→ Revoke**.
