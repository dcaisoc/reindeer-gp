# Setting up GitHub and Cloudflare

1. **Repository.** Create `dcaisoc/reindeer-gp` (public), push this code, then run `scripts/gh-bootstrap.sh` with the GitHub CLI logged in. It creates labels, milestones M1–M5 and protects `main`.
2. **Environments.** In GitHub: Settings → Environments → create `staging` and `production`; give `production` a required reviewer so production deploys need a human click.
3. **Cloudflare.** Create a free Cloudflare account. Workers & Pages → Create → Pages → "Direct upload", project name `reindeer-gp`. Then My Profile → API Tokens → create a token with *Cloudflare Pages: Edit*. Add it as the repository secret `CLOUDFLARE_API_TOKEN`, and your account id as `CLOUDFLARE_ACCOUNT_ID`.
4. **Deploys.** Every PR gets a preview URL in a comment; every merge to `main` updates `staging.reindeer-gp.pages.dev`; production is "Actions → Deploy → Run workflow → production".
5. **Rollback.** Cloudflare Pages keeps every deployment: Pages → reindeer-gp → Deployments → pick the previous one → "Rollback to this deployment". Or re-run the production deploy from an older commit.
6. **Lockfile.** The first time someone runs `npm install` with network access, commit the generated `package-lock.json` so CI installs exact versions.
