# Going live: GitHub, Cloudflare and Raven

About 45 minutes, once. Everything here is free and needs no payment card.
You need: the `dcaisoc` GitHub account, a Cloudflare account, a Google account (any) to register the Raven sign-in, and Node.js 20+ on your laptop.

## 1. GitHub settings (5 min)

Claude cannot change repository settings, so do these in the browser:

1. **Settings → General**: tick *Automatically delete head branches*. Under *Pull Requests*, allow squash merging and untick merge commits.
2. **Settings → Branches → Add branch ruleset** for `main`: require a pull request (approvals: 0 if you are the only maintainer, or 1 and use your admin override), require status checks *Lint, unit tests, golden traces, build*, *Golden traces in browsers + end-to-end* and *Secret scan*, and require linear history.
3. **Settings → Environments**: create `staging` and `production`. On `production`, add yourself as a required reviewer, so a production deploy always waits for your click.
4. **Issues → Labels**: create a label called `preview`. Adding it to a pull request deploys that PR to staging.

## 2. Cloudflare (15 min)

1. Sign up at <https://dash.cloudflare.com/sign-up> with `dcaisoc@outlook.com`. The free plan is enough; skip any upgrade prompts.
2. On your laptop, in the repository folder:

   ```sh
   npm install
   npx wrangler login                       # opens the browser once
   npx wrangler d1 create reindeer-gp
   npx wrangler d1 create reindeer-gp-staging
   ```

   Each `d1 create` prints a `database_id`. Paste them into `wrangler.toml` in place of `REPLACE_WITH_D1_DATABASE_ID` and `REPLACE_WITH_STAGING_D1_DATABASE_ID`, and commit that change through a pull request.
3. Note your `workers.dev` subdomain: Workers & Pages → Overview, on the right. Your sites will be
   `https://reindeer-gp.<subdomain>.workers.dev` (production) and `https://reindeer-gp-staging.<subdomain>.workers.dev` (staging).
4. Create an API token for GitHub Actions: My Profile → API Tokens → Create Token → template *Edit Cloudflare Workers*, and add the permission *Account → D1 → Edit*. Copy it.
5. In GitHub: Settings → Secrets and variables → Actions → New repository secret:
   - `CLOUDFLARE_API_TOKEN`: the token from step 4
   - `CLOUDFLARE_ACCOUNT_ID`: shown on the Workers & Pages overview page

## 3. Raven sign-in (15 min)

Raven OAuth2 is Google sign-in restricted to `@cam.ac.uk` accounts (see the [Raven docs](https://docs.raven.cam.ac.uk/en/latest/raven-oauth2/)). You register an ordinary Google OAuth client; the server only accepts `@cam.ac.uk` identities.

1. Go to <https://console.cloud.google.com/>, create a project called `reindeer-gp`.
2. **APIs & Services → OAuth consent screen**: user type *External*; app name *Reindeer Grand Prix*; support email your Google address; scopes `openid`, `email`, `profile` only. Then **Publish app** (status *In production*), so sign-in isn't limited to test users. With only these basic scopes Google does not require a review, though students may see the app marked as unverified until brand verification is done.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**. Authorised redirect URIs:
   - `https://reindeer-gp.<subdomain>.workers.dev/api/v1/auth/raven/callback`
   - `https://reindeer-gp-staging.<subdomain>.workers.dev/api/v1/auth/raven/callback`
4. Store the secrets in Cloudflare (each command asks for the value):

   ```sh
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put SESSION_SECRET        # any long random string: openssl rand -base64 32
   npx wrangler secret put REFEREE_EMAILS        # e.g. abc12@cam.ac.uk,def34@cam.ac.uk
   # and the same four for staging, plus a key for the test sign-in:
   npx wrangler secret put GOOGLE_CLIENT_ID --env staging
   npx wrangler secret put GOOGLE_CLIENT_SECRET --env staging
   npx wrangler secret put SESSION_SECRET --env staging
   npx wrangler secret put REFEREE_EMAILS --env staging
   npx wrangler secret put DEV_LOGIN_KEY --env staging
   ```

5. Optional but polite: email `raven-support@uis.cam.ac.uk` to say a student society site is using Raven OAuth2 for sign-in.

## 4. First deploy (5 min)

Merge the PR with the database ids. The *Deploy* workflow applies the database migrations and deploys staging. Open the staging URL, sign in with Raven, create a team and submit a bot. Then run **Actions → Deploy → Run workflow → production** and approve it.

If Raven sign-in fails with "unverified app" or an admin-approval message, the Cambridge Google Workspace may restrict third-party apps. Email raven-support with the client id and ask for it to be allowed. Test this early: it is the one external dependency we don't control.

## Day to day

| I want to… | Do this |
| --- | --- |
| Try a PR on staging | Add the `preview` label to it |
| Release to players | Actions → Deploy → Run workflow → production, then approve |
| Roll back | Cloudflare dashboard → Workers → reindeer-gp → Deployments → previous version → *Deploy*; or re-run the production deploy from an older commit |
| Back up the database | `npx wrangler d1 export reindeer-gp --remote --output backup.sql` (D1 also keeps 7 days of point-in-time history on the free plan) |
| Run everything locally | `npm run dev:server` → <http://localhost:8787>, with test sign-in. Add `REFEREE_EMAILS=you@cam.ac.uk` to see the referee page |
| See whether free limits are close | Cloudflare dashboard → Workers → reindeer-gp → Metrics (requests per day; the free plan allows 100,000) |
| Move to the $5 plan if limits bite | Cloudflare dashboard → Workers → Plans → Paid. No code change |

## Lockfile

The first time someone runs `npm install` with network access, commit the generated `package-lock.json`, so CI installs exact versions.
