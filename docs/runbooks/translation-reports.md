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

## Personal information (#830)

The table holds no personal information by design: no IP address, user agent,
cookie, referrer or account, only the columns the `SELECT` above lists, every
one of them the page, its words or what the visitor typed. Shyden ruled on
2026-10-16 that a translation report needs nothing that identifies the
visitor. The logs suite proves it before every release
(`tests/logs/report-row.test.ts`).

The form asks visitors, above both free-text boxes, not to include names or
contact details, and the endpoint does not refuse a report that does. A
report whose suggestion or note holds personal details anyway is dealt with
first: copy out any translation fix it carries, then delete it at once with
`DELETE FROM reports WHERE id = '<id>';`, before any ticket is raised from it.

## The rate limit (operator, before the production release)

The endpoint validates every report, but only Cloudflare can count requests
per visitor. In the dashboard, Security → WAF → Rate limiting rules:

- When `http.request.uri.path` equals `/api/report`, counted per IP, more than 2 requests in 10 s → Block for 10 s.

Then confirm which Workers plan the account is on. On Free, D1's daily limits
answer with errors, which the endpoint reports as `failed`. On Paid, usage
beyond the included amount is billed, and this rule is the only cap on cost.

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
`main` alone and holds nothing else (#877): only released code reads
production. GitHub fires the schedule on the default branch, `develop`, so that
run only starts the count on `main` (`gh workflow run waiting-reports.yml --ref
main`); the count itself runs on `main` alone.

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
3. Go to Actions → _Waiting reports_ → Run workflow, on `main` (or
   `gh workflow run waiting-reports.yml --ref main`). The log shows
   `Waiting reports: <n>`.
4. Delete the old token in Cloudflare.

A run from any branch other than `main` counts nothing: the count job is
skipped, and the environment would refuse it before a secret is read.
