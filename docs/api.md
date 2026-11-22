# API (v1)

All endpoints live under `/api/v1` on the same origin as the app. Responses are JSON. Errors look like
`{"error": {"code": "rate_limited", "message": "…plain English…", "details": {}}}`.

**Auth.** The browser uses an HttpOnly session cookie set by Raven sign-in. Every non-GET request must carry an `Origin` header matching the site (browsers do this automatically), which blocks cross-site request forgery. Personal API tokens for the CLI arrive in M3.

| Method and path | Who | What |
| --- | --- | --- |
| `GET /health` | anyone | Liveness check |
| `GET /meta` | anyone | Colleges and levels for forms |
| `GET /auth/raven/start?return=/#/team` → `GET /auth/raven/callback` | anyone | Raven OAuth2 sign-in |
| `POST /auth/logout` | signed in | End the session |
| `GET /me`, `PATCH /me {displayName}`, `DELETE /me` | signed in | Profile; deleting removes personal data |
| `POST /teams {name, college, level}`, `POST /teams/join {code}`, `POST /teams/leave` | signed in | Teams of 1–4 |
| `GET /teams/mine`, `PATCH /teams/mine` | team member | Your team (includes the join code) |
| `GET /teams/:id` | anyone | Public team page |
| `POST /bots/validate` (bot JSON) | anyone | Check a bot file without submitting |
| `POST /submissions {bot, tracks?}` | team member | Submit a bot to every (or the listed) track; 20 per team per day |
| `GET /submissions`, `GET /submissions/:id` | team member | Status: `queued`, `running`, `done`, `rejected` |
| `POST /runs[?submit=1]` (.rgpr body) | team member | Save a lap (verified by re-simulation); `submit=1` enters it on the Human board |
| `GET /runs/count?track=` | team member | Verified saved laps (Beginner bracket needs 3) |
| `GET /boards`, `GET /boards/s1/<track>/base/<bots\|humans>` | anyone | Leaderboard snapshots (cached 5 s) |
| `GET /replays/:id`, `GET /replays/:id/file`, `GET /replays/:id/thumb.png` | anyone (unless hidden) | Replay metadata, file, preview picture |
| `PATCH /replays/:id {visibility}`, `POST /replays/:id/thumbnail` | owning team | Privacy and link-preview picture |
| `GET /announcements` | anyone | Current announcements |
| `GET /admin/overview`, `POST /admin/settings`, `POST /admin/entries/hide`, `POST /admin/teams/:id`, `POST /admin/announcements`, `DELETE /admin/announcements/:id`, `GET /admin/export.csv` | referees | Referee tools; every change is audit-logged |

Outside `/api`, `GET /replay/:id` serves a small page with link-preview tags that forwards to the app.

**Status codes:** 400 bad request, 401 sign in, 403 not allowed or bad origin, 404 not found, 409 conflict (e.g. already in a team), 413 too large, 422 invalid bot or replay (details list the problems), 423 submissions closed, 429 daily limit reached.
