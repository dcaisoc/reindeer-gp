# Runbook

For referees and organisers during the competition. Setting things up the first time is in [Going live](setup.md).

## The referee page

Sign in with a Raven account listed in the `REFEREE_EMAILS` secret, then click **Referee** in the top bar. Every change made there is recorded in the audit log at the bottom of the page.

| I want to… | Do this |
| --- | --- |
| Stop new submissions (end of a round, an incident) | **Close submissions**. Players see a clear message; queued jobs still finish. |
| Hide the final standings until the prize-giving | **Freeze boards**. Scores are still saved, but **nothing submitted while frozen enters the boards, even after unfreezing**. Close submissions at the same time so no one wastes a try. |
| Allow more or fewer tries | Change *Bot submissions per team per day* or *Human laps per team per day*. Takes effect immediately. |
| Tell everyone something | Write it under **Announcements** and **Post**. It shows at the top of every page; **Remove** takes it down. |
| Remove a suspicious or offensive entry | **Leaderboard entries** → **Hide**. The team keeps its other entries. |
| Fix an inappropriate team name | **Teams** → **Rename** (or **Hide** to remove the team from every board). |
| Get the results for prizes | **Download results (CSV)**: every board entry, including hidden ones, with college and level. Points and college standings are on the public **Standings** page. |

## Twist day

Weekly twists open and close on their own. A week ahead:

1. **Upload**: Referee page → *Weekly twists* → *Upload twist file* (from `tracks/twists/` or a private folder). Problems are listed in plain English. The upload shows the baseline bot's time; if it doesn't finish, the twist is too hard.
2. **Test drive**: drive it yourself (only referees can see it before it opens).
3. **Dry run**: races every team's latest bot on it privately. Expect many "can't race here" notes on a twist with different sensors; that's the point. Nothing public changes.
4. **Schedule**: set *Opens* (and optionally *Closes*) and *Save schedule*. Times are in your computer's time zone.

At the opening time the twist appears on the home page, gets its own boards, and an announcement goes up automatically (checked every 10 minutes even if nobody visits). Players' bots aren't entered automatically: they submit as usual, and every bot is entered on each live twist its sensors fit.

| I want to… | Do this |
| --- | --- |
| Open it early | **Go live now** (an override; *Follow schedule* removes it) |
| Close it early | **Take down now**. Its boards and replays stay, marked as ended. |
| Fix a mistake before it opens | Upload the corrected file with the same id (or **Delete** it) |
| Fix a mistake after it opened | You can't replace it (boards would mix versions). Take it down and upload the fix under a new id, e.g. `night-oval-2`. |

## Weekly digest

Every Monday at 09:00 the *Weekly digest* workflow posts the summary on the repository's **Actions** page: open the latest run and copy it into the group chat. Or press **Build digest** on the Referee page any time, or run `npm run digest`. It covers leaders, new records, the biggest climbers, the crash of the week, badges and the college standings.

## Kickoff checklist (the day before)

1. Production deploy is green; open the site on a phone and on a laptop.
2. Sign in with Raven with a student account that isn't yours.
3. Drive three laps, train, submit; the entry appears on the board within a minute.
4. Open the projector view (`#/projector/practice-1/bots`) on the room's screen.
5. Check that submissions are **open** and boards **live**, and post a welcome announcement.
6. Take a database backup (below).

## When something goes wrong

| Symptom | Likely cause and fix |
| --- | --- |
| "Raven sign-in not configured" | The `GOOGLE_CLIENT_ID` secret is missing for that environment. See [Going live §3](setup.md). |
| Raven says *invalid_client* or *redirect_uri_mismatch* | The client id was pasted incompletely, or the site address isn't in the Google console's redirect URIs. |
| Submissions stay *queued* | The evaluator is kicked every 10 minutes by a scheduled job and on every submission. Check Cloudflare → Workers → reindeer-gp → Logs for errors. *In the queue* on the referee page should fall. |
| Everyone gets "daily limit reached" | The limit counts per team per day and resets at midnight UK time. Raise it temporarily on the referee page. |
| A bot scores differently locally | It shouldn't: ask the player to run `reindeer selftest`. If that passes and scores still differ, the bot file differs. If it fails, open an issue with the output. |
| Site down or very slow | Check <https://www.cloudflarestatus.com/>. Roll back if a deploy just went out (below). |
| Free-plan limit reached (errors mention limits) | Cloudflare → Workers → Plans → Paid ($5/month). No code change. |

## Backups and rollback

- **Back up:** `npx wrangler d1 export reindeer-gp --remote --output backup-$(date +%F).sql`. D1 also keeps point-in-time history ("Time Travel") for 7 days on the free plan: `npx wrangler d1 time-travel restore reindeer-gp --timestamp <ISO time>`.
- **Roll back code:** Cloudflare → Workers → reindeer-gp → Deployments → previous version → *Deploy*. Database migrations are additive, so older code keeps working.

## Weekly twists

Each twist is a pull request that adds tracks or engine options, reviewed and tested like any change. Deploy it to staging with the `preview` label, play a lap, then release to production at the announced time and post an announcement.
