# Referee rehearsal

A dress rehearsal on **staging**, for a referee who didn't build the system, using only the [runbook](runbook.md) and [If something breaks](if-something-breaks.md). It proves the runbook is enough, and finds the gaps before kickoff. About 75 minutes. Nothing here affects players.

**Before you start** (the organiser does this): add the rehearsing referee's address to staging's `REFEREE_EMAILS` and redeploy staging; give them write access to the GitHub repository. Hand them this page and the runbook, then don't help unless they're completely stuck. Note every time they had to ask.

**While you work:** whenever the runbook is unclear, wrong or missing something, write it down in the notes column. That list is the main result.

## Part 1: launch day (40 minutes)

| # | Task (use the runbook's "Launch day" section) | Expected | Done | Notes |
| --- | --- | --- | --- | --- |
| 1 | Run the load test on staging | "Load test passed ✅" | ☐ | |
| 2 | Run the restore drill | "Restore succeeded", under 60 minutes | ☐ | |
| 3 | Sign in to **staging** as a player; drive 3 laps; train with Recommended settings; submit | Bot on the Frosty Oval board within a minute | ☐ | |
| 4 | Open the Referee page; read the integrity line; press **Check now** | ✓ Integrity check passed | ☐ | |
| 5 | Post an announcement; check it shows on every page; remove it | Shows, then gone | ☐ | |
| 6 | Open the projector view on a second screen | Large board, updates on its own | ☐ | |
| 7 | Close submissions; try to submit as a player; reopen | Player sees "Submissions are closed" | ☐ | |
| 8 | Hide your own test entry; then find where hidden entries are listed (CSV) | Entry gone from the board, still in the CSV | ☐ | |

## Part 2: twist day (20 minutes)

| # | Task (use "Twist day") | Expected | Done | Notes |
| --- | --- | --- | --- | --- |
| 9 | Upload `tracks/twists/ice-hairpins.json` (download it from GitHub) | "not public yet", baseline time shown | ☐ | |
| 10 | Test drive it | You can drive it; a player can't see it | ☐ | |
| 11 | Dry run; read the results | A result for each team's latest bot | ☐ | |
| 12 | Schedule it to open 5 minutes from now; wait | Opens on its own; an announcement appears | ☐ | |
| 13 | Take it down early | Shows "ended"; its board stays | ☐ | |

## Part 3: something breaks (15 minutes)

The organiser picks two scenarios and says only the symptom. Use [If something breaks](if-something-breaks.md).

| # | Symptom given | What you did | Right fix? | Notes |
| --- | --- | --- | --- | --- |
| 14 | e.g. "A team is called something offensive" | | ☐ | |
| 15 | e.g. "Someone deleted all of today's announcements and a team by mistake" | | ☐ | |
| 16 | e.g. "Players say they've hit the daily limit" | | ☐ | |

## Afterwards

- Time taken for the restore drill: ______ minutes (target under 60).
- Every note becomes a fix to the runbook (a pull request, or tell the maintainer).
- Rehearsal passed if tasks 1–13 were done without help, and the scenarios got the right fix.
