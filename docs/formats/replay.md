# Replay format (`rgp-replay` v1)

A replay stores the **inputs** of a run plus fingerprints of the resulting state. Positions are recomputed by re-simulating, so a 2-minute lap is about 1–3 KB, and any edit to the inputs is caught by a hash mismatch.

## Binary (`.rgpr`)

| Bytes | Content |
| --- | --- |
| 0–3 | ASCII `RGPR` |
| 4 | Format version (`1`) |
| 5… | zlib-deflate of: `uint32 LE` header length N, N bytes of UTF-8 JSON header, then the action stream |

The action stream is signed 8-bit pairs `(steer, throttle)`, each in −127…127, one pair per decision. Each pair is held for `ticksPerAction` physics ticks (1 for humans at 60 Hz, 3 for bots at 20 Hz).

## Header

| Field | Meaning |
| --- | --- |
| `format`, `version` | `"rgp-replay"`, `1` |
| `game`, `engineVersion` | `"reindeer-gp"` and the engine semver that produced it |
| `track` | `{id, version}`; `twist` is `{id, version}` or `null` |
| `seed` | Reserved for games with randomness (0 for Grand Prix) |
| `ticksPerAction` | See above |
| `participants` | `[{kind: "human" \| "bot", name?, teamId?, botId?}]` |
| `result` | `{valid, score, ticks, penalties, collisions}`; `score` is `null` when invalid |
| `hashes` | State hash (FNV-1a 64-bit, hex) after every 60 ticks |
| `finalHash` | State hash at the end |
| `createdAt` | ISO timestamp |

The JSON twin has the same header plus `actions: [[steer, throttle], …]`; the golden-trace corpus uses it.

## Verifying

Re-simulate from the start with the actions; compare every 60-tick hash and the final hash. The viewer shows a banner on mismatch, and the server (M2) rejects mismatching human runs.
