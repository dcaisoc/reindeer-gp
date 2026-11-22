# If something breaks

One page, for launch day and after. Find the symptom, do the first fix, then tell the group chat what happened. More detail is in the [runbook](runbook.md).

**First, always:** if players are affected, **Close submissions** on the Referee page and post an announcement ("We're fixing a problem; your laps and bots are safe"). Reopen when it's fixed.

| Symptom | First check | Fix |
| --- | --- | --- |
| **Site doesn't load at all** | `<site>/api/v1/health` in a browser; <https://www.cloudflarestatus.com/> | Cloudflare outage: wait and announce. If a deploy went out in the last hour: roll it back (Cloudflare → reindeer-gp → Deployments → previous → Deploy). |
| **"Raven sign-in not configured"** | Which site (staging or production)? | That site lacks `GOOGLE_CLIENT_ID`. Re-add the four Raven secrets ([setup §3](setup.md)). |
| **Raven: *invalid_client* / *redirect_uri_mismatch*** | Google Cloud console → Credentials | Client id pasted incompletely, or the site address missing from the redirect URIs. |
| **Raven: "admin approval required" / blocked** | Does it happen for every student? | The university restricts third-party apps: email raven-support@uis.cam.ac.uk with the client id. Meanwhile, players can drive and train without signing in; only submitting needs it. |
| **Submissions stuck in "queued"** | Referee page: *In the queue* rising? | Wait 10 minutes (a scheduled job wakes the queue). Still stuck: Cloudflare → reindeer-gp → **Logs**, look for errors; roll back the last deploy. |
| **"Daily limit reached" for everyone** | Referee page limits | Raise *Bot submissions per team per day*; it resets at midnight UK time. |
| **Errors mentioning limits, or the site refusing requests** | Cloudflare → Metrics → requests today | Switch to the paid plan (Workers → Plans → Paid). Takes minutes, no code change. |
| **A player says their bot scores differently on the board** | Ask them to run `reindeer selftest` | If selftest passes, their bot file differs from what they think. If it fails, open a GitHub issue with the output. |
| **Offensive team name or a cheating entry** | Referee page → Teams / Leaderboard entries | **Rename** or **Hide** the team; **Hide** the entry. It's all in the audit log. |
| **⚠ Integrity check found problems** | The listed entries | Hide them, press **Check now**, tell a maintainer ([runbook](runbook.md#integrity-problems)). |
| **Data lost or wrong** (deleted by mistake, corrupted) | When did it happen? | Within 7 days and you know the minute: Cloudflare Time Travel. Otherwise run **Restore database** from last night's backup ([runbook](runbook.md#backups-and-restoring)). |
| **A twist opened early or broken** | Referee page → Weekly twists | **Take down now**; fix and re-upload under a new id. |
| **The projector board froze** | Is the laptop online? | Reload the page (`#/projector/practice-1/bots`). |

**Who to call:** the repository owner (GitHub `dcaisoc`, dcaisoc@outlook.com) for anything needing code or Cloudflare access.
