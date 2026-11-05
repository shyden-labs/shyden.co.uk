# shyden.co.uk — Company Site v1 (Homepage + Glory Points Calculator) — Design Spec

- **Date:** 2026-07-23
- **Status:** Reviewed — brand/AA, legal-disclosure, SEO and calculator-input fixes applied; ready for implementation plan
- **Repo:** `Shyden-Ltd/shyden.co.uk`
- **Owner:** claude (with operator)

---

## 1. Purpose & Context

**Shyden Ltd** is a bespoke, AI-powered software company. It offers two engagement models:

1. **Build your product** — Shyden plans, builds, and maintains software end-to-end for a client.
2. **Hire our specialists** — Shyden's people embed in a client's existing software and processes.

This spec covers **v1** of the company website served at **shyden.co.uk**:

- A **Homepage** — the company landing page, whose job is lead generation: convince a prospective client to get in touch.
- A **Glory Points Calculator** page (`/glory-points`) — a small companion tool Shyden built for the third-party **YeeTalk** app (not Shyden's product), currently a bare Flask page, to be **re-designed and re-coded** properly and folded into this site as a static, client-side page.

The site is built as an **Astro** static site with **multi-page infrastructure** from day one (shared layout/components), deployed to **Cloudflare Pages** at $0, and held to a **mobile-first, TDD, all-browser-compatible** bar.

### Why now / coordination note

shyden.co.uk currently serves the Glory Points Calculator at its **root** (a Flask app on a separate server). When this new homepage takes the root, the calculator **must** move — so porting it into this site (as `/glory-points`) is part of v1, and the old Flask app is retired at DNS cutover.

---

## 2. Goals & Non-Goals

### Goals (v1)
- A polished, on-brand, mobile-first **homepage** that positions Shyden and drives a "Get in touch" action.
- A re-designed, on-brand, mobile-first **Glory Points Calculator** doing the calculation live in the browser (no server), with the input validation the original lacks.
- **Multi-page infrastructure** (Astro layout + shared Header/Footer/components) so Services / Work / About / Contact / a Tools section can be added later with no rework.
- Full **TDD**: unit tests for the calculator's pure logic; Playwright E2E across chromium/firefox/webkit + mobile viewports.

### Non-Goals (v1 — explicitly deferred)
- Contact **form** / any backend (v1 uses a `mailto:` — chosen 2026-07-23).
- Standalone **Services / Work / About / Contact** pages (infrastructure supports them; content is later tickets).
- **More YeeTalk tools** / a `/tools/` hub (revisit if a second tool appears).
- Internationalisation, blog/news, analytics, CMS.

---

## 3. Tech Stack & Architecture

- **Astro** (static output; ships **zero JS by default** — only the calculator page includes a small script).
- **Language:** TypeScript for scripts + tests; `.astro` components.
- **Styling:** a small global **design-token** stylesheet (CSS custom properties) + component-scoped CSS. No CSS framework.
- **Fonts:** self-hosted (no external CDN — faster, privacy-friendly, cross-browser). See §4.
- **SEO / Head:** every page sets a unique `<title>` + meta description via `BaseLayout` props; the homepage adds Open Graph + Twitter-card tags and an OG image; canonical URLs throughout. `@astrojs/sitemap` generates the sitemap; `robots.txt` lives in `public/`.
- **Testing:** **Vitest** for the pure calc module; **Playwright** for E2E + cross-browser.
- **Hosting:** **Cloudflare Pages** → `shyden.co.uk`. Build command `astro build`, output `dist/`.
- **CI:** GitHub Actions — build, lint/format, unit + Playwright on push/PR (mirrors ShyTalk's discipline, scaled down).

### Proposed repo structure
```
shyden.co.uk/
├── astro.config.mjs
├── package.json
├── tsconfig.json
├── playwright.config.ts
├── CLAUDE.md                      # project instructions (mobile-first, TDD, cross-browser)
├── README.md
├── public/                        # static assets, fonts, favicon, robots.txt
├── src/
│   ├── styles/tokens.css          # design tokens (colour, type, spacing)
│   ├── layouts/BaseLayout.astro   # <html>, head (SEO/meta/OG/canonical), header, footer, slot
│   ├── components/
│   │   ├── Header.astro           # wordmark + nav + mobile hamburger
│   │   ├── Footer.astro
│   │   ├── Button.astro           # primary/secondary CTA
│   │   ├── ServiceCard.astro
│   │   └── WorkCard.astro
│   ├── lib/gloryPoints.ts         # PURE calc + validation (unit-tested, no DOM)
│   ├── scripts/glory-points.ts    # DOM wiring for the calculator page
│   └── pages/
│       ├── index.astro            # homepage
│       ├── glory-points.astro     # calculator
│       └── 404.astro              # custom not-found
└── tests/
    ├── unit/gloryPoints.test.ts   # pure-logic tests
    └── e2e/*.spec.ts              # Playwright
```

**Isolation principle:** the calculator's arithmetic lives in a **pure, DOM-free module** (`lib/gloryPoints.ts`) so it is unit-tested in isolation; the page script only wires inputs/outputs to it. Components each have one clear job and a small interface.

---

## 4. Brand & Visual Design — PROPOSAL (please react)

Distinct **Shyden** identity — deliberately **not** ShyTalk's dark purple, and deliberately not template-generic. Direction: **clean, confident, editorial-modern** — a studio you'd trust to build serious software: precise, technical, human, premium-but-approachable.

- **Theme:** light. A clean, high-legibility, trustworthy look reads more "agency you'd hire" than a dark dev-tool aesthetic. (Dark is a possible alternative — flag it in review if preferred.)
- **Proposed palette (design tokens):**
  | Token | Value | Use |
  |---|---|---|
  | `--bg` | `#F7F6F2` | warm paper background (distinct from flat white) |
  | `--surface` | `#FFFFFF` | cards |
  | `--ink` | `#16171C` | primary text / headings |
  | `--ink-soft` | `#565A66` | secondary text |
  | `--border` | `#E7E4DC` | hairlines, card borders |
  | `--accent` | `#0A7D66` | **signature deep teal** — CTAs, links, highlights (a confident, less-default alternative to the usual startup blue) |
  | `--accent-ink` | `#096452` | accent hover/pressed (darker) |
  | `--danger` | `#C0392B` | validation errors |
- **Palette verified for WCAG AA (computed):** body ink 16.6:1, secondary text 6.4:1 and error red 5.0:1 on paper all pass comfortably; the accent clears AA in every use — white-on-accent 5.1:1 (buttons), accent-on-paper 4.7:1 and accent-on-white 5.1:1 (links). *The originally-proposed `#0E8C74` failed AA for normal text (≈4.2:1) and was darkened to `#0A7D66`; do not lighten it past that without re-checking contrast.*
- **Typography (self-hosted, open-source):** **Space Grotesk** for headings (technical, distinctive, geometric) + **Inter** for body (highly legible, cross-browser). Strong hierarchy, generous line-height, comfortable measure (~66ch max).
- **Feel:** generous whitespace, subtle depth (soft 1px borders + faint shadows, no heavy gradients), rounded-but-restrained corners, motion only for affordance (hover/focus), full dark-mode deferred.
- **Voice:** confident, clear, jargon-light. e.g. *"We build bespoke software — AI-accelerated, yours end-to-end. Or embed our specialists in the team you already have."*

> All of §4 is a starting proposal. Colours/type/tone are the easiest thing to iterate — react and I'll adjust before any build.

---

## 5. Homepage Design (`/`)

Mobile-first, single scrolling column that becomes a centred max-width (~1080px) layout on larger screens. Sections top→bottom:

1. **Header** — Shyden wordmark (left) + nav (right): `Services · Work · Contact` (anchors for v1, in scroll order; real pages later). On mobile: wordmark + hamburger toggling an accessible menu. Sticky, subtle border on scroll.
2. **Hero** — H1 on the bespoke/AI positioning; one-line subhead; **primary CTA "Get in touch"** (`mailto:support@shyden.co.uk`) + secondary "See our work" (scrolls to Work). Restrained, confident, lots of space.
3. **Services** — two `ServiceCard`s: **"We build your product"** (end-to-end: plan → build → maintain, AI-accelerated) and **"Hire our specialists"** (embed in your existing software & processes). Stack on mobile, side-by-side ≥720px.
4. **Our work** — `WorkCard`s: **ShyTalk** (Shyden's flagship product → `https://shytalk.shyden.co.uk`) featured; the **Glory Points Calculator** (a tool we built → `/glory-points`) as a smaller secondary card. Extensible list. *(Launch dependency: the ShyTalk subdomain must resolve at cutover — see §11.)*
5. **Contact** — closing band repeating **"Get in touch" → `mailto:support@shyden.co.uk`**, with the address shown in plain text too.
6. **Footer** — © Shyden Ltd + year. **UK legal disclosure (required in v1):** registered company name, **company number**, **place of registration** ("Registered in England & Wales"), and **registered office address** — a Companies Act 2006 / Trading Disclosures requirement for a UK limited company's website (actual values supplied at content/build time — see §11). Plus the contact email and room for legal/social links later.

**Copy** will be drafted in-spec/PR for operator approval; the above is structure + intent.

---

## 6. Glory Points Calculator Design (`/glory-points`)

A single-purpose, on-brand tool. Re-designed from the bare Flask original into a clean card: title, one-line explainer, a number input, a **Calculate** button, and a clear **results breakdown**. Computed **live in the browser** (instant; no page reload).

### YeeTalk attribution (this tool is YeeTalk-specific)
Glory points belong to **YeeTalk** — a global social chat app (video/voice/text with worldwide auto-matching and translation) with an in-app gifting economy — **not** to Shyden. The page makes that explicit so users know exactly what it's for:
- A **"For YeeTalk" lockup** near the title: YeeTalk's name (and official logo when sourced), linking to **https://yeetalkapp.com/** (`target="_blank"`, `rel="noopener noreferrer"`).
- A one-line explainer, e.g. *"Glory points are part of YeeTalk's in-app gifting. This companion tool, built by Shyden, converts them to coins, beans and gift value."*
- **Framing:** neutral companion-tool wording — clearly a Shyden-built tool *for* YeeTalk, presented inside an unmistakably Shyden page (Shyden header/footer). This is **nominative use** (naming + linking a third party), **not** an official YeeTalk product and not an impersonation. *(Open item §11: confirm whether to add an explicit "unofficial" disclaimer or state an official partnership.)*
- **Asset:** use YeeTalk's **real** logo, sourced from their site — do **not** fabricate a YeeTalk mark. Until the asset is available, ship a plain-text "YeeTalk" wordmark link (still clear, still branded).

### Ported logic (from the operator's Flask source — verified)
Given `gloryPoints` (a positive whole number):
```
coinsNeeded    = ceil(gloryPoints * 1)          // 1 coin per point  → == gloryPoints
beansNeeded    = ceil(coinsNeeded / 0.9)         // 0.9 coins per bean
totalGiftValue = ceil(beansNeeded / 0.40)        // gifts convert to beans at 40%
```
All results formatted with thousands separators. Result copy mirrors the original's three lines (coins → beans → total gift value).

### Input parsing & validation (improvement over the original)
**Parse strategy (canonical, so the tests are unambiguous):** trim the input, then accept **plain digits only** (`/^\d+$/`) — mirroring the original Python `int()`. This deliberately rejects decimals (`3.5`), scientific notation (`1e3`), thousands separators (`1,000`) and signs (`+5` / `-5`) with a clear message rather than silently truncating.
- Empty / whitespace-only → "Please enter a number."
- Not plain digits (letters, decimals, `1e3`, `1,000`, signs) → "Please enter a whole number."
- **Zero → "Enter a number greater than zero."** (the original silently produced nonsense for zero — an impossible-good-state we now reject; negatives can't occur because `-` isn't a digit).
- **Upper bound:** reject values above **1,000,000,000** → "That number is too large." — across the accepted range `[1, 1e9]` the naive `ceil` arithmetic is exact (verified exhaustively to 50M and by BigInt cross-check to 1e9; float division by 0.9/0.4 loses integer precision only far above the cap, first divergence ~2^51 — a >1,000,000× margin). Valid inputs format with thousands separators.

### UX / a11y
- Instant result on submit (Enter key + button), `inputmode="numeric"`, mobile keyboard shows digits.
- Results in an `aria-live` region; errors associated with the input via `aria-describedby`.
- Full keyboard operation; visible focus; WCAG AA contrast.
- Explains the conversion assumptions briefly so users trust the numbers.

---

## 7. Mobile-First & Cross-Browser Requirements (applies to every page)

- **Mobile-first CSS**: base styles target small screens; enhance up with `min-width` breakpoints. Fluid units, `clamp()` type, `max-width:100%` media.
- **No horizontal scroll** at any width from 320px up; **content never clips** (pages scroll).
- **Touch targets ≥ 44×44px**; comfortable spacing.
- **WCAG AA** contrast (palette verified in §4); semantic HTML; keyboard-navigable; visible focus; `prefers-reduced-motion` respected.
- **Cross-browser**: correct on chromium, firefox, webkit (desktop) + mobile chromium + mobile webkit. No JS required for the homepage; the calculator degrades to a clear message if JS is off.

---

## 8. Testing (TDD — tests first, every layer)

- **Unit (pure logic)** — `lib/gloryPoints.ts`: the three-step formula at representative + boundary inputs (1, 9, 10, 100, 1000, and the 1,000,000,000 cap), rounding edges (values that do/don't need `ceil`), and every validation branch (empty/whitespace, letters, decimal `3.5`, `1e3`, `1,000`, signs `+5`/`-5`, zero, and the too-large bound). RED before GREEN.
- **E2E (Playwright)** across the config's browser projects (chromium/firefox/webkit + mobile viewports):
  - **Homepage**: renders; hero CTA is a `mailto:support@shyden.co.uk`; nav works (incl. mobile hamburger open/close); "See our work" scrolls; work cards link correctly (ShyTalk external, calculator internal); footer shows the legal disclosure; no horizontal scroll at 320/375/768/1280; no console errors.
  - **Calculator**: entering a value shows the correct coins/beans/gift breakdown (asserts exact numbers from the formula); each validation message appears for its bad input; keyboard (Enter) works; `aria-live` updates.
- **Cross-browser + mobile-first** are gate conditions, not afterthoughts.
- **Owed on device return**: the real mobile-device browser gauntlet (real Android + real iPhone browsers) — per the standing rule, web work is verified on real devices too; here it's Mac-browser-verified first, devices owed.

---

## 9. Deployment

- **Cloudflare Pages** project targeting `shyden.co.uk`; build `astro build` → `dist/`; automatic deploys from `main` (preview deploys on PRs).
- **Cutover**: the new site replaces the Flask calculator at the root; `/glory-points` serves the ported tool; the old Flask server is retired once cutover is verified. (Operator coordinates DNS.)
- **$0**: static hosting only; no server, no paid services.

---

## 10. Acceptance Criteria (v1)

- [ ] Astro site builds clean; homepage + `/glory-points` render as static HTML; a custom `404` page is present.
- [ ] Homepage matches the approved brand + structure; "Get in touch" is `mailto:support@shyden.co.uk`; work cards link to ShyTalk + the calculator.
- [ ] Footer shows the required UK company disclosures (registered name, company number, place of registration, registered office address).
- [ ] Every page has a unique `<title>` + meta description; the homepage has Open Graph / Twitter-card tags + an OG image; sitemap + `robots.txt` present.
- [ ] The chosen accent passes WCAG AA in every use (white-on-accent ≥ 4.5:1, accent-on-bg ≥ 4.5:1) — verified.
- [ ] Calculator computes coins/beans/gift **exactly** per the ported formula, formatted; all input branches covered (digits-only, zero, too-large); live/instant; accessible.
- [ ] Mobile-first: no clipping / no horizontal scroll 320px+, touch targets ≥44px, WCAG AA.
- [ ] Unit tests (calc) + Playwright E2E green across all configured browsers; lint/format clean; CI green.
- [ ] Deployed to Cloudflare Pages; ready for shyden.co.uk cutover.
- [ ] Real mobile-device browser gauntlet run on device return (owed, tracked).

---

## 11. Open Items / Future

- **Brand review** (§4) — confirm/adjust palette (accent is now `#0A7D66`, AA-fixed), type, light-vs-dark, before build.
- **Legal values (before launch)** — obtain Shyden Ltd's **company number** and **registered office address** for the footer disclosure (§5.6). The requirement is specced now; the values are filled at content time.
- **ShyTalk subdomain (launch dependency)** — the flagship Work card links to `https://shytalk.shyden.co.uk`; confirm it resolves before cutover, else the flagship card dead-links.
- **YeeTalk branding** — source YeeTalk's official logo asset for the `/glory-points` lockup (§6); confirm the affiliation framing (neutral "for YeeTalk" vs an explicit "unofficial" note vs an official-partnership statement).
- **Copy** — finalise hero/services/work/footer wording during build for approval.
- **Calculator home** — `/glory-points` now; promote to `/tools/glory-points` under a Tools hub only if a second YeeTalk tool appears.
- **Future pages** — Services / Work / About / Contact (+ contact form/backend) as separate tickets on the same infrastructure.
