# Security review checklist

Reviewed for M5 (December 2026). ✓ = in place and tested; ⚠ = a known gap we accept, with the reason. Re-check this list after any change to sign-in, uploads or the referee tools.

## Sign-in and sessions

- ✓ **Raven (Google OAuth2) only**, restricted to `@cam.ac.uk`: the server checks the issuer, audience, expiry, nonce, `email_verified`, the `hd` claim and the email's domain. The OAuth `state` is signed and expires in 10 minutes.
- ⚠ The Google ID token's signature isn't verified. Acceptable because the server receives it directly from Google's token endpoint over TLS, in exchange for a one-time code, so it can't be forged in transit.
- ✓ **Sessions:** random tokens, stored only as SHA-256 hashes; cookies `HttpOnly; SameSite=Lax; Secure`; 30 days; sign-out deletes the session.
- ✓ **Test sign-in** is refused in production and needs a shared secret (`DEV_LOGIN_KEY`) on staging. Tested.
- ✓ **Referees** are a list of addresses in a secret (`REFEREE_EMAILS`), checked on every admin request; every referee action is audit-logged.

## Requests

- ✓ **CSRF:** every non-GET API request must carry an `Origin` matching the site. API tokens (Bearer) skip that check but reach only an allowlist of routes. Tested.
- ✓ **API tokens:** hashed, at most 5 per person, revocable, and they never carry referee powers, even for referees.
- ✓ **XSS:** the web app never inserts HTML strings (no `innerHTML`; text is set as text); Content-Security-Policy `script-src 'self'`, no inline scripts, `object-src 'none'`, `base-uri 'none'`.
- ✓ **Headers:** `nosniff`, a strict referrer policy, `X-Frame-Options: SAMEORIGIN` (no clickjacking from other sites), HSTS on static files.
- ⚠ **No per-IP rate limit on sign-in or validation.** Mitigated by Cloudflare's built-in protection and the per-team daily limits on submissions; signing in needs a real Raven account. Add Cloudflare rate-limiting rules if abuse appears.

## Uploads (untrusted input)

- ✓ **Bots are data, never code:** a JSON network checked for size (200 KB), shape, value ranges and NaN/Infinity on 256 probe inputs, then run by our own inference code. Fuzz-tested: 2,000 random mutations, never a crash.
- ✓ **Replays** are size-capped (64 KB), parsed defensively, and re-simulated by the server; any hash mismatch is rejected. Fuzz-tested: 400 corrupted files, refused cleanly.
- ✓ **Twist files** can only be uploaded by referees and are validated (fields, config ranges, track geometry).
- ✓ **Heavy work** (evaluation, twist checks, integrity checks) runs in the Evaluator, so a request can't exhaust the API's CPU.

## Integrity of results

- ✓ Every leaderboard result is produced or re-verified by the server's own engine.
- ✓ **Nightly integrity check:** the top 10 of every board are re-simulated and bots re-run; mismatches are shown to referees and audit-logged. Tested with tampered data.
- ✓ Engine determinism is checked on every change: 24 golden traces in Node, Chromium, Firefox and Python on 3 operating systems.
- ⚠ The Beginner bracket can't prove who trained a bot; it's social, proportionate for a competition with no money at stake ([design](https://claude.ai/artifact/Jrk3TGEUDhtkVEcqABvjQv)).

## Data and privacy

- ✓ Stored personal data: a hash of your email, your display name, and your team's college. No real names, no analytics cookies.
- ✓ **Account deletion** removes personal data and tokens; leaderboard history stays under the team name.
- ✓ **Backups are encrypted** (AES-256, passphrase in a GitHub secret) because artifacts of a public repository can be downloaded by any GitHub user.
- ⚠ Weekly twist files committed to the public repository can be read before they open. The runbook says how to keep surprises out of the repository.

## Supply chain and secrets

- ✓ Secrets live in Cloudflare and GitHub secrets only; **gitleaks** scans every push; **CodeQL** analyses the code; **Dependabot** proposes dependency updates.
- ✓ The Python SDK is published by GitHub Actions with PyPI trusted publishing (no stored PyPI password).
- ✓ Production deploys and production restores need a person's approval (the `production` environment).
