/**
 * Each script that decides whether it was run directly, run as a script with
 * an input it refuses. A refusal is the cheapest proof that `main()` ran: a
 * non-zero exit carrying the script's own words, where a skipped `main()` is
 * a silent 0.
 */
export interface Probe {
  readonly args: readonly string[];
  /** Variables to set; `undefined` removes one the parent had. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly status: number;
  /** Words only the script's own refusal prints. */
  readonly says: string;
}

export const PROBES: Readonly<Record<string, Probe>> = {
  // With no file to check there is nothing it could report, so it refuses.
  // That refusal is also the only cheap proof its entry point ran at all: a
  // skipped `main()` exits 0 in silence, which reads exactly like a clean
  // message (#278).
  'closing-keywords.mjs': {
    args: [],
    status: 1,
    says: 'usage: node scripts/closing-keywords.mjs',
  },
  // Without its three paths it prints its usage and refuses.
  'build-evidence-page.mjs': {
    args: [],
    status: 2,
    says: 'usage: build-evidence-page.mjs',
  },
  // With no plan and no listing it has nothing to pair, so it refuses before
  // reading anything. Its refusal is also the only cheap proof its entry point
  // ran: a skipped `main()` exits 0 in silence.
  'upload-evidence-assets.mjs': {
    args: [],
    status: 2,
    says: 'usage: upload-evidence-assets.mjs',
  },
  // With no page and no sign-off to read it can give no verdict, so it
  // refuses with 2, which is neither a sign-off nor an out-of-date one (#197).
  'signoff-status.mjs': {
    args: [],
    status: 2,
    says: 'usage: signoff-status.mjs',
  },
  // With nowhere to hand its verdict on, it refuses rather than decide
  // nothing, which would leave the browser jobs to a missing output (#582).
  'docs-only.mjs': {
    args: [],
    env: { GITHUB_OUTPUT: undefined },
    status: 1,
    says: 'GITHUB_OUTPUT is not set',
  },
  // Without the API it can prove nothing, so it refuses to proceed.
  'deploy-gate.mjs': {
    args: [],
    env: { GITHUB_REPOSITORY: undefined, GITHUB_TOKEN: undefined },
    status: 1,
    says: 'GITHUB_REPOSITORY and GITHUB_TOKEN are required',
  },
  // With no needs to read and no shard accounts, build-and-test's verdict has
  // nothing to vouch for, so it refuses rather than pass on nothing (#163).
  'e2e-shards.mjs': {
    args: [],
    env: { NEEDS_JSON: undefined },
    status: 1,
    says: 'build-and-test REFUSED',
  },
  // It refuses a shard it could not account for before it lists or runs
  // anything (#163). The probe once passed an option only Playwright rejects,
  // which started the Playwright CLI twice per probe and timed out under load
  // (#572).
  'test-e2e.mjs': {
    args: ['--shard=0/8'],
    status: 1,
    says: '--shard=0/8 is not a shard',
  },
  // Neither of these takes an argument, so one is a mistake they refuse
  // before doing any work (#227). They earned probes by gaining an entry
  // decision: until then each called `main()` unconditionally, so importing
  // either ran it -- which is why `dashboard.mjs` kept its own copies of
  // three helpers rather than importing them.
  'dashboard.mjs': {
    args: ['--no-such-flag'],
    status: 1,
    says: 'dashboard.mjs takes no arguments',
  },
  'test-devices.mjs': {
    args: ['--no-such-flag'],
    status: 1,
    says: 'test-devices.mjs takes no arguments',
  },
  // With no `docker` on PATH it refuses rather than compare nothing (#202).
  'visual.mjs': {
    args: [],
    env: { PATH: '/nonexistent' },
    status: 1,
    says: 'docker is not available',
  },
  // The three that did all their work at module scope until #276. Each refuses
  // on `argv` alone, before it reads the cache or the catalogue, so the probe
  // proves the entry point ran without touching either.
  'i18n-scaffold.mjs': {
    args: [],
    status: 1,
    says: 'name a locale: npm run i18n:scaffold -- zh',
  },
  'i18n-translate.mjs': {
    args: [],
    status: 1,
    says: 'usage: npm run i18n:translate -- <locale>',
  },
  // With no engine it could read nothing back, so it refuses before any
  // request (#95) -- and a skipped `main()` would exit 0 in silence.
  // Without a database to read it has nothing to review, so it refuses with
  // the usage before it reaches for wrangler or the network (#348).
  'reports-review.mjs': {
    args: [],
    status: 2,
    says: 'usage: npm run reports:review <shyden-reports-dev|shyden-reports>',
  },
  'i18n-back-translate.mjs': {
    args: [],
    env: { BACK_TRANSLATE_URL: undefined },
    status: 1,
    says: 'BACK_TRANSLATE_URL must be the engine',
  },
  // Takes no arguments either, and refuses one before it reads the config or
  // reaches for `gh` -- so the probe proves the entry point ran without a
  // token, a network call or a repository (#299).
  'dependabot-labels.mjs': {
    args: ['--no-such-flag'],
    status: 1,
    says: 'usage: node scripts/dependabot-labels.mjs',
  },
  // Without a token and an account it has nothing to prove, so it refuses
  // with the usage before any request reaches Cloudflare (#415).
  'token-reach.mjs': {
    args: [],
    env: { CLOUDFLARE_API_TOKEN: undefined, CLOUDFLARE_ACCOUNT_ID: undefined },
    status: 1,
    says: 'usage: CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node scripts/token-reach.mjs',
  },
  // It takes no arguments, and refuses one before it reads the lockfile or
  // asks mcr.microsoft.com anything (#454).
  'playwright-image.mjs': {
    args: ['--no-such-flag'],
    status: 1,
    says: 'usage: node scripts/playwright-image.mjs (takes no arguments)',
  },
  // It had no refusal at all, being written never to fail an install, so #276
  // gave it the one the other argument-free scripts have. `prepare` passes
  // nothing, so nothing that is not already a mistake reaches it.
  'install-hooks.mjs': {
    args: ['--no-such-flag'],
    status: 1,
    says: 'install-hooks.mjs takes no arguments',
  },
  // With no range and no --tests it has nothing to read, so it refuses (#362).
  'release-inventory.mjs': {
    args: [],
    status: 2,
    says: 'usage: release-inventory.mjs',
  },
  // Without a release file and a head it can build nothing, so it refuses (#362).
  'build-release-content.mjs': {
    args: [],
    status: 2,
    says: 'usage: build-release-content.mjs',
  },
  // Without its four paths it prints its usage and refuses (#651).
  'floors-diff.mjs': {
    args: [],
    status: 1,
    says: 'usage: floors-diff.mjs',
  },
  // Without its four paths it prints its usage and refuses (#654).
  'visual-capture.mjs': {
    args: [],
    status: 1,
    says: 'usage: visual-capture.mjs',
  },
  // The gate never records the guards' floors, so under CI it refuses before
  // it runs anything (#468), unless told it is the dispatched recorder (#651).
  'record-floors.mjs': {
    args: [],
    env: { CI: 'true' },
    status: 1,
    says: 'CI never records floors',
  },
};
