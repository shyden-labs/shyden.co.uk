# The DEV sign-in (#1262)

One sign-in at `dev-signin.shyden.co.uk` gives a DEV pass that every product's `dev.`
door accepts. The design, its limits and how a product adopts it are in
shyden-labs/repo-template's `docs/dev-pass.md` (shyden-labs/repo-template#207). This
repository hosts the two Workers:

| Worker | Folder | Account | Reached at |
| --- | --- | --- | --- |
| `shyden-dev-signin` | `workers/dev-signin/` | TEST+DEV | its `workers.dev` address, only from the door |
| `shyden-dev-signin-door` | `workers/dev-signin-door/` | PROD (holds the shyden.co.uk zone) | `dev-signin.shyden.co.uk`, behind Cloudflare Access |

The host map (`workers/dev-signin/config.ts`) lists every `dev.` host a pass may be
minted for. A product joins by adding its hosts there.

## One-time setup (Shyden)

Each step says what it needs. Nothing here puts a private key in the repository.

1. **Key pair** (on the Mac, nothing needed):

   ```sh
   node --input-type=module -e "const k = await crypto.subtle.generateKey('Ed25519', true, ['sign','verify']); console.log(JSON.stringify({ private: await crypto.subtle.exportKey('jwk', k.privateKey), x: (await crypto.subtle.exportKey('jwk', k.publicKey)).x }))"
   ```

   Keep the `private` part for step 2 only. The `x` part is public: send it to the
   session, which gives it to every door as `{ "2026-11": "<x>" }`.

2. **Sign-in Worker** (wrangler logged in to the TEST+DEV account):

   ```sh
   npx wrangler deploy --config workers/dev-signin/wrangler.jsonc
   npx wrangler secret put DEV_PASS_PRIVATE_JWK --config workers/dev-signin/wrangler.jsonc   # paste the private JWK
   openssl rand -base64 32   # the door secret, used here and in step 3
   npx wrangler secret put DOOR_SECRET --config workers/dev-signin/wrangler.jsonc
   ```

   The first deploy creates the `CODES` KV namespace. Send the session the
   `workers.dev` address it prints; it goes into the door's `SIGNIN_URL`.

3. **Door** (wrangler logged in to the PROD account, after the session has set `SIGNIN_URL`):

   ```sh
   npx wrangler deploy --config workers/dev-signin-door/wrangler.jsonc
   npx wrangler secret put DOOR_SECRET --config workers/dev-signin-door/wrangler.jsonc   # the same value as step 2
   ```

4. **Access** (Cloudflare dashboard, PROD account, Zero Trust → Access → Applications):
   - A self-hosted application on `dev-signin.shyden.co.uk`: an **Allow** policy for
     the allowed emails (one-time PIN and GitHub login), and a **Service Auth** policy
     with one service token per machine (each CI environment and the Mac), named after it.
   - A second self-hosted application on `dev-signin.shyden.co.uk/app/exchange` with a
     single **Bypass** policy for everyone (PKCE guards that path).

5. **Read back** the team domain (`https://<team>.cloudflareaccess.com`, Zero Trust →
   Settings) and the first application's AUD tag (its overview). Send both to the
   session: they go into `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`, and the sign-in Worker
   is deployed again (step 2's first command).

The session then measures, on the deployed site, that `/app/exchange` with no Access
cookie reaches the Worker and `/pass` with none gets the Access login, before any
door relies on it.
