# HTTP API (v1)

All endpoints live under `/api/v1` on the same origin as the app. Responses are JSON. Errors look like
`{"error": {"code": "rate_limited", "message": "…plain English…", "details": {}}}`.

**Auth.** The browser uses an HttpOnly session cookie set by Raven sign-in. Every non-GET request must carry an `Origin` header matching the site (browsers do this automatically), which blocks cross-site request forgery. 

**API tokens.** For scripts and the `reindeer` CLI, create a personal token on your Team page (or `POST /me/tokens {name}`) and send it as `Authorization: Bearer rgp_…`. Requests with a token skip the Origin check, but a token can only reach the routes marked **token** below, and never has referee powers, even if you are a referee. Tokens are stored hashed; you see the value once. Each person can have 5.

| Method and path | Who | What |
| --- | --- | --- |
| `GET /health` | anyone | Liveness check |
| `GET /meta` | anyone | Colleges and levels for forms |
| `GET /auth/raven/start?return=/#/team` → `GET /auth/raven/callback` | anyone | Raven OAuth2 sign-in |
| `POST /auth/logout` | signed in | End the session |
| `GET /me`, `PATCH /me {displayName}`, `DELETE /me` | signed in (`GET`: token) | Profile; deleting removes personal data |
| `GET /me/tokens`, `POST /me/tokens {name}`, `DELETE /me/tokens/:id` | signed in (browser only) | Your API tokens |
| `POST /teams {name, college, level}`, `POST /teams/join {code}`, `POST /teams/leave` | signed in | Teams of 1–4 |
| `GET /teams/mine`, `PATCH /teams/mine` | team member (`GET`: token) | Your team (includes the join code) |
| `GET /teams/:id` | anyone | Public team page |
| `POST /bots/validate[?track=<id>]` (bot JSON) | anyone, token | Check a bot file without submitting (against a twist's sensors if given) |
| `POST /submissions {bot, tracks?}` | team member, token | Submit a bot to the listed tracks/twists, or by default to every public track and every live twist whose sensors it fits (the response lists `skipped` ones with a reason); 20 per team per day |
| `GET /submissions`, `GET /submissions/:id` | team member, token | Status: `queued`, `running`, `done`, `rejected` |
| `POST /runs[?submit=1]` (.rgpr body) | team member, token | Save a lap (verified by re-simulation); `submit=1` enters it on the Human board |
| `GET /runs/count?track=` | team member, token | Verified saved laps (Beginner bracket needs 3) |
| `GET /boards`, `GET /boards/s1/<track>/<base or twist id>/<bots\|humans>` | anyone, token | Leaderboard snapshots (cached 5 s), including the baseline bot's result |
| `GET /replays/:id`, `GET /replays/:id/file`, `GET /replays/:id/thumb.png` | anyone unless hidden (first two: token) | Replay metadata, file, preview picture |
| `PATCH /replays/:id {visibility}`, `POST /replays/:id/thumbnail` | owning team | Privacy and link-preview picture |
| `GET /twists`, `GET /twists/:id` | anyone, token | Weekly twists that are live or ended (a twist is invisible until it opens); `:id` returns the full twist file |
| `GET /standings` | anyone, token | Team and college points, with the formula |
| `GET /digest.md?days=7` | anyone, token | The weekly digest as markdown |
| `GET /announcements` | anyone | Current announcements |
| `GET /admin/overview`, `POST /admin/settings`, `POST /admin/entries/hide`, `POST /admin/teams/:id`, `POST /admin/announcements`, `DELETE /admin/announcements/:id`, `GET /admin/export.csv`, `GET/POST /admin/twists`, `PATCH/DELETE /admin/twists/:id {liveFrom, liveUntil, override}`, `POST /admin/twists/:id/dry-run` | referees | Referee tools; every change is audit-logged |

Outside `/api`, `GET /replay/:id` serves a small page with link-preview tags that forwards to the app.

**Status codes:** 400 bad request, 401 sign in, 403 not allowed or bad origin, 404 not found, 409 conflict (e.g. already in a team), 413 too large, 422 invalid bot or replay (details list the problems), 423 submissions closed, 429 daily limit reached.
