# Handover note

For whoever runs or maintains the Reindeer Grand Prix next. Written at the end of M5 (December 2026).

## What is built

| Area | What you get |
| --- | --- |
| **Game** | A deterministic sleigh-racing engine (TypeScript, with a line-by-line Python port), three practice tracks, three example weekly twists. Identical results in every browser, on the server and in Python, checked by 24 golden traces on every change. |
| **Web app** | Drive (keyboard, touch, slow mode and auto-throttle assists), record laps, train a bot in the browser, submit, live leaderboards (bots, humans, levels, Beginner bracket, baseline row, Race the leader), replays (permalinks, ghosts, GIF/video export), standings, badges, team pages, settings (reduced motion), referee tools. Keyboard-accessible with WCAG AA contrast on every page except the driving view. |
| **Server** | One Cloudflare Worker (free plan): Raven sign-in, teams, API tokens, the evaluation queue (Evaluator Durable Object), weekly twist scheduling and dry runs, badges, standings, digest, nightly integrity check. Data and files in D1. |
| **Python** | `reindeer-sdk` and the `reindeer` command line (scores identical to the server), three Colab notebooks, Gym-style environments. |
| **Operations** | CI on every pull request (unit, golden traces in 3 engines, SDK on 3 OSes × 4 Pythons, notebooks, 4 browser journeys, accessibility audit, load test in-process, secret scan, CodeQL); deploy to staging/production; nightly encrypted backups; restore workflow; load-test workflow; weekly digest; docs site. |
| **Docs** | [Player guide](play.md), [SDK](sdk.md), formats, [API](api.md), [runbook](runbook.md), [if something breaks](if-something-breaks.md), [rehearsal](rehearsal.md), [security checklist](security.md), [adding a new game](new-game.md). |

## Deliberately missing

- **Games 2 and 3** (Grinch vs. Elves, Snowball Arena), the hackathon bracket and big-screen views: out of scope. The seams for them (Game interface, replay container, board keys) are in place; see [adding a new game](new-game.md).
- **An OpenAPI file and generated client**: the API is documented by hand in [api.md](api.md).
- **Pruning old bots and replays**: at ~50 players, D1's 500 MB limit is far away (expected well under 100 MB for the season).
- **Error tracking (e.g. Sentry) and alerting**: rely on Cloudflare logs, the integrity line on the Referee page, and GitHub's emails when a scheduled workflow fails (GitHub sends them to whoever last edited that workflow file).
- **A track editor, team history graphs, the "Most Improved" and "Comeback" badges, a feedback widget**: nice to have; not needed to run the season.
- **Recurrent bot layers and any execution of user code**: never, by design.

## Known risks

1. **Things not yet run against real Cloudflare.** The backup, restore and staging load-test workflows were built and tested locally (the restore logic against SQLite with foreign keys; the load test in-process with 200 players), but their first real runs are the owner's: see "Before kickoff" below. Most likely to need a tweak: the exact `wrangler d1 export` output and the time the import takes.
2. **Raven access policy.** If the university restricts third-party Google apps, students can't sign in. Test with a non-referee student account well before kickoff.
3. **One maintainer over Christmas.** Twists run on schedule and the runbook covers routine work, but code fixes need someone with GitHub and Cloudflare access. Run the [rehearsal](rehearsal.md) with a second referee.
4. **Free-plan limits.** 100,000 requests a day is plenty for ~50 players (~10,000), but a runaway script could hit it. Switching to the paid plan (~£4/month) takes minutes.
5. **Spoilers.** Twist files in the public repository can be read early; keep surprises (the hidden final) out of the repo.

## Before kickoff (owner)

1. Add GitHub secrets `BACKUP_PASSPHRASE` (keep a copy in a password manager) and `DEV_LOGIN_KEY` (same value as staging's), see [setup](setup.md#backups-load-tests-and-restores).
2. Run **Nightly backup** once by hand; then **Load test (staging)**; then **Restore database** (the drill). All three should be green, and the restore should report under 60 minutes.
3. Run the [rehearsal](rehearsal.md) with a referee who didn't build the system; fix the runbook where they got stuck.

## The first three things I would improve

1. **Alerting.** Email the referees when the integrity check finds a problem, the queue is stuck for 15 minutes, or a backup fails. Today these are visible only to someone who looks.
2. **Team history.** A best-time-over-time graph on each team page, plus "Most Improved" in the digest. This is the most-requested kind of feature in competitions like this, and the data is already stored (evaluations).
3. **An OpenAPI description**, generating the TypeScript and Python clients, so the web app, SDK and docs can't drift apart as games 2 and 3 arrive.
