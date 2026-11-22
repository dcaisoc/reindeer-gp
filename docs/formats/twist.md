# Twist file format (`rgp-twist` version 1)

A weekly twist is **data, not code**: a complete track plus a few engine settings that differ from normal. The engine needs nothing new to race one. Every replay on a twist records `"twist": {"id", "version"}`, so it re-simulates with exactly the right track and settings forever.

```json
{
  "format": "rgp-twist",
  "version": 1,
  "id": "night-oval",
  "twistVersion": "1.0.0",
  "name": "Frosty Oval by Night",
  "description": "Night falls: your sleigh has only 3 short headlamp rays (−45°, 0°, 45°, 25 m).",
  "baseTrack": "practice-1",
  "track": { "...": "a full track (see the track format); its id and trackVersion equal the twist's" },
  "config": { "rayAnglesDeg": [-45, 0, 45], "rayRange": 25 }
}
```

| Field | Rule |
| --- | --- |
| `id` | Lowercase letters, digits and hyphens. Can't be a public track id or `base`. Used in board names and URLs. |
| `twistVersion` | Like `1.0.0`. Equal to `track.trackVersion`. |
| `baseTrack` | The public track the twist's boards are grouped under (any id for a brand-new track, like the hidden final). |
| `track` | A complete track that passes the track validator. |
| `config` | Overrides of the engine settings. Anything not listed keeps its normal value. `{}` means no changes. |

## What `config` may change

| Setting | Allowed | Normal |
| --- | --- | --- |
| `rayAnglesDeg` | 1–9 increasing angles, −90° to 90° | −60, −40, −20, 0, 20, 40, 60 |
| `rayRange` (m) | 5–80 | 40 |
| `penaltySeconds` | 0–10 | 1 |
| `penaltyCooldownTicks` | 0–120 | 30 |
| `timeoutTicks` | 600–10,800 | 7,200 (2 minutes) |
| `maxSpeed`, `accel`, `brake`, `turnRate`, … | see `TWIST_LIMITS` in `engine/reindeer/twist.ts` | |
| `surfaces.<snow/ice/rough>.<grip/drag/traction>` | grip 0.01–5, drag 0.1–10, traction 0.05–3 | merged one property at a time |

**Sensors follow the rays.** A twist with 3 rays offers bots `ray0`–`ray2` (plus `speed`, `lateral`, `surf_*`). A bot is entered only on courses where every input it lists exists; the server says which it skipped and why.

## Making one

1. Add an entry to [`tracks/src/twists.ts`](https://github.com/dcaisoc/reindeer-gp/blob/main/tracks/src/twists.ts): start from a public track and change `reverse`, `width`, `patches` (ice and rough) and/or `config`.
2. `npm run tracks` writes `tracks/twists/<id>.json`; `npm run validate:tracks` and `npm run balance` check it (the baseline bot should still finish).
3. Upload the file on the Referee page and schedule it ([runbook](../runbook.md#twist-day)).

The repository is public, so anything in `tracks/` can be read before it goes live. For a surprise (like the hidden final track), generate the file outside the repo with `npm run tracks -- --out ~/secret-twists`, upload it, and don't commit it. The server never shows a twist before its start time.
