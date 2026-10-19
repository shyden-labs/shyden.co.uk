# Translation reports — runbook (#97)

Reports from the footer form land in the D1 table `reports`: database
`shyden-reports` on prod, `shyden-reports-dev` on dev, each bound to its Pages
project as `REPORTS`. A row exists only while its report is pending. Dealing
with a report deletes it; nothing is kept "just in case".

**A review starts with the script** (#348). It reads the table and changes
nothing, and prints each report beside the English its text was translated
from and what its suggestion says in English:

```sh
BACK_TRANSLATE_URL=http://localhost:5000 npm run reports:review shyden-reports
```

Name `shyden-reports-dev` for dev. The engine is the LibreTranslate container
whose `docker run` line heads `scripts/i18n-back-translate.mjs`. Without
`BACK_TRANSLATE_URL` the script prints everything else, and each report says
no back-translation was made.

Then, in the Cloudflare dashboard's D1 console:

```sql
SELECT id, received_at, locale, page, quote, keys, suggestion, note
  FROM reports ORDER BY received_at;
-- once a report has been dealt with, with <id> replaced by its id from the SELECT
DELETE FROM reports WHERE id = '<id>';
-- dev database only: the rows the dev sanity suite writes, one per dev deploy
DELETE FROM reports WHERE note LIKE 'automated dev check %';
```

**A ticket raised from a report goes into a public repository.** It carries
the locale, the key and, once reviewed, the suggested wording. It never
carries the note.

`GET /api/report/health` answers `200 {"ok":true}` when the binding and the
table's columns match `migrations/0001_reports.sql`, and `503` otherwise. The
dev and prod sanity suites call it after every deploy.

A failure writes one line to the Functions log (Cloudflare dashboard → Workers
& Pages → the project → Logs), and nothing a visitor sent (#829):

| Line | Means |
| --- | --- |
| `report failed: binding-missing` | A report arrived and the `REPORTS` binding is not set on this environment. |
| `report failed: database` | The insert into D1 failed; D1's own metrics say why. The error's text is never logged, because it can repeat what was bound. |
| `report health: binding-missing` | The health check found no `REPORTS` binding. |
| `report health: database` | The health check's query failed. |
| `report health: the reports table does not match the migration` | The table's columns differ from `migrations/0001_reports.sql`. |
| `report failed: limits-invalid` | A limit variable holds a value that is not `on`, `off` or a whole number from 1 to 1000000 (see _The daily limits_). |
| `report failed: secret-missing` | The limits are on (always, on production) and `REPORT_COUNTER_SECRET` is missing or under 32 characters. |
| `report failed: address-missing` | The limits are on and the request carried no readable `CF-Connecting-IP`. |
| `report health: limits-invalid` | The health check found a limit variable it cannot read. |
| `report health: secret-missing` | The health check found the limits on and no usable secret. |
| `report health: the report_counts table does not match the migration` | The counts table is missing, or its columns differ from `migrations/0002_report_counts.sql`. |

## The rate limit (operator, before the production release)

The endpoint validates every report, but only Cloudflare can count requests
per visitor. In the dashboard, Security → WAF → Rate limiting rules:

- When `http.request.uri.path` equals `/api/report`, counted per IP, more than 2 requests in 10 s → Block for 10 s.

Then confirm which Workers plan the account is on. On Free, D1's daily limits
answer with errors, which the endpoint reports as `failed`. On Paid, usage
beyond the included amount is billed, and this rule is the only cap on cost.

## The daily limits (#872)

One person, or a bot, can put only so many reports in front of the operator
in a day. A report is refused, and nothing is stored, once the form has taken
its total for the UTC day, or once one internet connection has taken its
share. The visitor is told which, politely, with no time of reset: the day
turns at 00:00 UTC (07:00 in Jakarta and Bangkok).

| Variable | Values | Default |
| --- | --- | --- |
| `REPORT_LIMITS` | `on` or `off`; read only off production | off |
| `REPORT_LIMIT_TOTAL` | a whole number from 1 to 1000000: reports a day, from everyone | 50 |
| `REPORT_LIMIT_CONNECTION` | a whole number from 1 to 1000000: reports a day, from one connection | 5 |
| `REPORT_COUNTER_SECRET` | at least 32 characters, an encrypted variable | none |

**Production always applies the limits**, whatever `REPORT_LIMITS` says; only
the two numbers can change there. Every other host (dev, a Pages preview) has
them off unless `REPORT_LIMITS` is `on`, so dev's automated check, which sends
one real report per deploy, never meets them. A value that is not one of the
above fails closed: every report is refused as `failed`, and the health check
answers 503.

To change one: Cloudflare dashboard → Workers & Pages → the project →
Settings → Variables and Secrets, edit it, then re-run the deploy (Actions →
the deploy workflow → Run workflow), because Pages applies a variable at the
next deployment. To test the limits on dev, set `REPORT_LIMITS` to `on` and
small numbers (`REPORT_LIMIT_CONNECTION` = `1` makes the second report the
refused one), redeploy, test, then set it back to `off` and redeploy.

The secret: `openssl rand -hex 32`, pasted as an encrypted variable on each
environment, never written anywhere else. Production needs it always, and
dev only while its limits are on. Changing it starts that day's
per-connection counts again; nothing else is lost.

**What is kept:** the `report_counts` table (`migrations/0002_report_counts.sql`),
one row per counter per UTC day: the day, `all` or a 64-character
HMAC-SHA-256 of the day and the connection under the secret, and a count.
Never an IP address, and nothing that links a count to a report. Someone
holding the secret and a guessed address could confirm that the address
reported that day, so the rows are pseudonymous rather than anonymous; every
report deletes the rows of any other day, so none outlives its day. An IPv4
address is counted whole; an IPv6 address by its /64 block, the part one line
is usually given (Shyden 2026-10-19), so moving within it does not reset the
count.

The connection is read from `CF-Connecting-IP`, which Cloudflare sets. Keep
the zone's Network → Pseudo IPv4 setting Off or "Add header": "Overwrite
Headers" would put a made-up IPv4 address there and undo the /64 rule. Read it
before the first production release with the limits.

Before the code reaches an environment, run the migration in that database's
D1 console (`shyden-reports-dev` before the merge into `develop`,
`shyden-reports` before the release), pasting the `CREATE TABLE` from
`migrations/0002_report_counts.sql`. Until it runs, the health check answers
503 and every report fails.

## The daily count (#349)

Once a day at 01:17 UTC (08:17 WIB), `.github/workflows/waiting-reports.yml`
counts the rows in `shyden-reports`. When there are any, it comments the count
on #360, _Waiting translation reports_, which is assigned to the operator, so
every comment arrives as a GitHub notification. `3 translation reports are
waiting.` means exactly that: start from the review script above. Nothing is
posted on a day with none, and at most one count per UTC day, so a re-run or a
dispatch cannot post a second. The comment carries the count and nothing else,
because the repository and its Actions logs are public.

`The waiting-reports count could not be read.`, followed by a run's link, means
the job failed, and its log says why. The likely causes are an expired or
revoked token, a renamed database, or Cloudflare's API being down.

**No comment for days while reports wait?** In a public repository, GitHub
disables a scheduled workflow after 60 days without repository activity. A
workflow that does not run posts nothing, not even the failure notice. Under
Actions, select _Waiting reports_, and _Enable workflow_ turns it back on.

The job reads two secrets from the `reports-count` environment, which accepts
`develop` alone and holds nothing else:

- `CLOUDFLARE_ACCOUNT_ID`;
- `CLOUDFLARE_D1_READ_TOKEN`, an API token with one permission,
  `Account › D1 › Read`, on this account. The first token was shown to be
  refused a write against `shyden-reports-dev` before the job first ran
  (#349). A replacement carries that one permission and nothing more.

The job installs no npm packages: the script uses Node's own `fetch`.

To rotate the token:

1. In Cloudflare, go to My Profile → API Tokens → Create Token → Custom token,
   with the permission `Account › D1 › Read` and this account only.
2. In GitHub, go to Settings → Environments → `reports-count`, and replace
   `CLOUDFLARE_D1_READ_TOKEN`.
3. Go to Actions → _Waiting reports_ → Run workflow, on `develop`. The log
   shows `Waiting reports: <n>`.
4. Delete the old token in Cloudflare.

A run from any branch other than `develop` is refused by the environment before
a secret is read.
