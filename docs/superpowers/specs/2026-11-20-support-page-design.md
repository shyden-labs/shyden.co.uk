# Support page (#1032) — design

Date: 2026-11-20. Status: approved by Shyden 2026-11-20 (AskUserQuestion, "Approve as written"), English copy included: heading 'Support', line 'Questions, problems or ideas about any Shyden Labs product? Send a message here and the reply comes by email.'

## Intent

Visitors get help from Shyden Labs on shyden.co.uk's own page, through ShyDesk's shared support form, instead of being handed an email address. ShyTalk and Yawelo Idle use the same piece. This page is also the only contact for privacy requests, so the privacy page (#1080) waits on it.

## Decisions (Shyden, 2026-11-20)

- **Embed only.** The page loads ShyDesk's `embed.js` and places `<shydesk-support>`. The form talks to ShyDesk directly. Nothing on this site forwards requests to ShyDesk or holds a ShyDesk key.
- **Hosts picked when the site is built**, the same way the ShyTalk and Yawelo Idle links are. Dev uses `https://shydesk.shydesk-non-prod.workers.dev`. Production uses `https://shydesk.dpdns.org`. Only the dev build may name `workers.dev`.
- **Production always publishes the page**, even before live ShyDesk answers (Shyden chose this over hiding it). Until then the live form will not load. Shyden has asked ShyDesk to go live as soon as possible.
- **Copy:** a heading and one line above the form, in all five languages. The English is approved by Shyden, and every translation is read back by Google before commit.

## Contract (ShyDesk session shydesk-a9, 2026-11-20, from shydesk `0a2abc8`)

- `<script src="<host>/embed.js" defer></script>`: a classic script, never a module.
- `<shydesk-support product="shyden-co-uk" view="contact|ticket" lang="…">`. `lang` accepts every locale but is not used yet, so the form shows English.
- The ticket view reads `#t=<token>` from the address itself.
- The form draws in its own shadow DOM. It is styled through inherited `--shydesk-font`, `--shydesk-text`, `--shydesk-background`, `--shydesk-accent`, `--shydesk-accent-text`, `--shydesk-border` and `--shydesk-error`, set on `shydesk-support`.
- Turnstile (`challenges.cloudflare.com`) runs inside it. The site has no content security policy, so nothing to change here.
- The ticket-page address is `https://dev.shyden.co.uk/support/ticket` on Non-Prod (already set). It will be `https://shyden.co.uk/support/ticket` on live, which ShyDesk sets up when it creates the live product.

## The build

1. **Routes:**
   - `/support` (en) and `/<locale>/support` (id, zh, vi, th) use one `SupportPage.astro` with the `[locale]` route pattern, holding a heading, one line and `<shydesk-support view="contact" lang>`.
   - `/support/ticket` is one page only, because ShyDesk emails a single address per product. It is English and holds `<shydesk-support view="ticket">`.
   - Every support page goes in the sitemap. The ticket page is `noindex`, since it is a private link.
2. **Host:** `src/lib/shydesk.ts` answers the embed origin from `PUBLIC_SHYDESK_URL`, defaulting to the live host, and `deploy-dev.yml` sets the dev value. It is unit-tested.
3. **Styling:** the `--shydesk-*` values are mapped from the site's palette tokens, so both themes are covered. `contrast.test.ts` scores the new pairs.
4. **Script inventory:** `served-page.ts` lists the support and ticket pages as carrying one external classic `defer` script from the ShyDesk host. No other page changes.
5. **Copy:** catalogue keys go in each locale. Each translation is drafted by DeepL, except Indonesian, which is written by hand, and every line is read back by Google with a per-line table on the ticket.
6. **Guards:**
   - A plain test over the production `dist/` finds no `workers.dev`. It is watched failing once.
   - The dev build names only the Non-Prod host.
7. **Tests:**
   - The page walk covers the new pages in every theme, with 320px containment, AA contrast and 44px targets.
   - A real-input journey on every engine against the dev deploy (dev-sanity): type a message with real keys, attach a photo through the real file chooser, send it with a real click, and see it in the thread.
   - The homepage and the footer still use `mailto` here. Moving them is #1018's job.
8. **Not in scope:** translating the form itself (ShyDesk's job), the appeal view, and #1018's links.

## Left to the builder

The exact page layout follows the existing page shell (`BaseLayout`, header, footer), and the e2e file names follow the suite's conventions.

## Risks

- The Turnstile site key may not list `dev.shyden.co.uk` (not measured). If the widget errors on dev, ShyDesk checks it.
- A production release before live ShyDesk serves ships a page whose form does not load. Shyden accepted this.
