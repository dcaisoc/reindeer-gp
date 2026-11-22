# Runbook

Everything a referee needs to run the competition, written for someone who didn't build it. Setting things up the first time is in [Going live](setup.md). If something is broken right now, go to **[If something breaks](if-something-breaks.md)**.

## What you need

| Access | What it's for | How to get it |
| --- | --- | --- |
| A Raven account listed as a referee | The **Referee** page in the app | An organiser adds your `@cam.ac.uk` address to the `REFEREE_EMAILS` secret ([setup §3](setup.md)) and redeploys |
| GitHub, with write access to `dcaisoc/reindeer-gp` | Running workflows: deploy, digest, backups, restore, load test | Ask the repository owner |
| Cloudflare dashboard (optional) | Logs, usage, rolling back a deploy | Ask the account owner to invite you |

Workflows are run from GitHub: **Actions** → pick the workflow on the left → **Run workflow**.

## The Referee page

Sign in, then click **Referee** in the top bar. Every change is recorded in the audit log at the bottom of the page.

| I want to… | Do this |
| --- | --- |
| See how things are going | **At a glance**: players, teams, submissions today, queue length, and last night's **integrity check** |
| Stop new submissions (end of a round, an incident) | **Close submissions**. Players see a clear message; queued jobs still finish. |
| Hide the final standings until the prize-giving | **Freeze boards**. Scores are still saved, but **nothing submitted while frozen enters the boards, even after unfreezing**. Close submissions at the same time so no one wastes a try. |
| Allow more or fewer tries | Change *Bot submissions per team per day* or *Human laps per team per day*. Takes effect immediately. |
| Tell everyone something | Write it under **Announcements** and **Post**. It shows at the top of every page; **Remove** takes it down. |
| Remove a suspicious or offensive entry | **Leaderboard entries** → choose the board → **Hide**. The team keeps its other entries. |
| Fix an inappropriate team name | **Teams** → **Rename** (or **Hide** to remove the team from every board). |
| Re-check the top results now | **Check now** next to the integrity line (it also runs every night) |
| Get the weekly summary | **Weekly digest** → **Build digest** → **Copy** |
| Get the results for prizes | **Download results (CSV)**. Points and college standings are on the public **Standings** page. |

## Launch day

Kickoff is **Wednesday 2 December 2026, 19:00**. Tick each step; the expected result is in brackets.

**The day before**

1. GitHub → Actions → **Load test (staging)** → Run workflow (defaults). *(About 6 minutes. The run page says "Load test passed ✅" with 0 errors.)*
2. GitHub → Actions → **Restore database** → Run workflow (defaults: production backup onto staging). *(The summary says "Restore succeeded" and the time taken. This also clears the load-test players off staging.)*
3. GitHub → Actions → **Deploy** → Run workflow → *production* → approve. *(The run ends with a green "Smoke test".)*
4. On a laptop and on a phone, open the production site. Sign in with Raven using a student account that isn't a referee. *(You see your display name top right.)*
5. Drive three laps of Frosty Oval, open **Train**, press **Use Recommended settings**, **Train my bot**, then **Submit to the leaderboard**. *(Within a minute your bot is on the Frosty Oval board.)*
6. Referee page: the integrity line says ✓ (or "not run yet"); **Submissions: open**; **Boards: live**.
7. Remove the test team (Referee → Teams → **Hide**), or keep it as a demo.

**One hour before**

1. Post an announcement, e.g. "Welcome to the Reindeer Grand Prix! Drive three laps, then click Train."
2. On the room's screen, open `<site>/#/projector/practice-1/bots`. *(Large board; it refreshes on its own and flashes "New record!")*
3. Keep the Referee page open on your laptop, with this runbook.

**During**

- Watch **In the queue** on the Referee page. It should stay low (under 20) and fall within a minute.
- Player questions: the [player guide](play.md) answers most. "Driving is too fast": the ⚙ Settings page (top right) has half-speed and auto-throttle assists.

**After**

- Next morning: check the integrity line (✓) and that the **Nightly backup** run is green.

## Twist day

Weekly twists open and close on their own. A week ahead:

1. **Upload**: Referee page → *Weekly twists* → *Upload twist file* (from `tracks/twists/` or a private folder). Problems are listed in plain English. The upload shows the baseline bot's time; if it doesn't finish, the twist is too hard.
2. **Test drive** it yourself (only referees can see it before it opens).
3. **Dry run**: races every team's latest bot on it privately. Expect many "can't race here" notes on a twist with different sensors; that's the point. Nothing public changes.
4. **Schedule**: set *Opens* (and optionally *Closes*) and **Save schedule**. Times are in your computer's time zone. *(The twist shows "Opens …" with your time.)*

At the opening time the twist appears on the home page, gets its own boards, and an announcement goes up automatically. Players submit as usual; every bot is entered on each live twist its sensors fit.

| I want to… | Do this |
| --- | --- |
| Open it early | **Go live now** (an override; *Follow schedule* removes it) |
| Close it early | **Take down now**. Its boards and replays stay, marked as ended. |
| Fix a mistake before it opens | Upload the corrected file with the same id (or **Delete** it) |
| Fix a mistake after it opened | You can't replace it (boards would mix versions). Take it down and upload the fix under a new id, e.g. `night-oval-2`. |

Making a new twist file is described in the [twist format](formats/twist.md). Keep surprises out of the public repository.

## Every Monday

At 09:00 the **Weekly digest** workflow posts the summary on its run page (Actions → Weekly digest → latest run). Copy it into the group chat. You can also make one any time on the Referee page.

## Backups and restoring

**Every night** at 02:30 the **Nightly backup** workflow exports the production and staging databases (including all bot and replay files), encrypts them with the `BACKUP_PASSPHRASE` secret and keeps them for 30 days. Check now and then that its runs are green.

**Restore drill** (monthly, and the day before kickoff): Actions → **Restore database** → Run workflow with the defaults (*production* backup onto *staging*). It wipes staging, loads last night's backup, checks every table's row count, checks the site answers, and reports the time taken. Afterwards staging is a copy of production as of last night; sign in on staging and look at the boards to see for yourself.

**Real restore of production** (data lost or corrupted). Pick one:

| Situation | Use |
| --- | --- |
| A mistake in the last 7 days, and you know when it happened | Cloudflare **Time Travel**, to the minute: `npx wrangler d1 time-travel restore reindeer-gp --timestamp 2026-12-03T18:55:00Z` (needs Wrangler set up as in [setup §2](setup.md)) |
| Anything else | **Restore database** with *source* production, *target* production, the backup run you want (blank = last night), and type `RESTORE PRODUCTION`; then approve the production environment |

Either way: close submissions first, post an announcement, and reopen after you've looked at the boards. Results submitted after the backup are lost; tell players to resubmit.

**Roll back code** (a deploy broke something): Cloudflare → Workers & Pages → reindeer-gp → **Deployments** → the previous version → **Deploy**. Database changes are additive, so older code keeps working.

## Integrity problems

Each night the system re-runs the top 10 of every board (replays re-simulated, bots re-run) and compares. If the Referee page shows **⚠ Integrity check found problems**:

1. Note the listed entries and **Hide** each one (Leaderboard entries).
2. Press **Check now**: the warning clears once the bad entries are hidden.
3. Ask a maintainer to look at the audit log and the database. A mismatch means someone changed stored data, or (very unlikely) an engine change broke determinism.

## Before a big event: load test

Actions → **Load test (staging)** simulates 200 players signing up and submitting within 5 minutes. It passes with no errors and every entry on its board within 30 seconds. Then run the restore drill, which also clears the test players from staging.

## Limits to keep an eye on

The free Cloudflare plan allows 100,000 requests a day; about 50 players use under 10,000. Cloudflare → Workers → reindeer-gp → **Metrics** shows today's count. If it passes 70,000, switch to the paid plan (Workers → Plans → Paid, about £4 a month; no code change).
