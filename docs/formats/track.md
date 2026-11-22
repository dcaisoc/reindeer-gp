# Track format (`rgp-track` v1)

A track is one JSON file in `tracks/`. Coordinates are metres, **x right, y down** (screen orientation). Headings are radians from +x towards +y (clockwise on screen).

| Field | Meaning |
| --- | --- |
| `format`, `version` | Always `"rgp-track"` and `1` |
| `id`, `trackVersion`, `name`, `difficulty`, `description` | Identity and display. Bump `trackVersion` whenever geometry changes. |
| `width` | Nominal width in metres (informational) |
| `centreline` | Closed racing line, for drawing only |
| `walls.left`, `walls.right` | Closed polylines. These are what the sleigh collides with and the sensors see. |
| `start` | `{x, y, heading}` behind the start line |
| `checkpoints` | Ordered lines `[Lx, Ly, Rx, Ry]`, L on the driver's left. Index 0 is start/finish. Crossing counts only for the next checkpoint and only going forwards. |
| `sectors` | Two checkpoint indices that end sectors 1 and 2 |
| `surfaces` | `{type: "ice" \| "rough", polygon}` patches; the last matching patch wins, otherwise snow |
| `decorations` | Trees, cabins and presents (drawing only) |
| `bounds` | Bounding box of the walls |

All geometry is stored explicitly so every engine (TypeScript, Python) reads identical numbers. Tracks are generated from `tracks/src/defs.ts` by `npm run tracks` and checked by `npm run validate:tracks`, which rejects self-crossing walls, gaps narrower than 6 m, checkpoints that don't reach both walls, and a start that isn't behind the start line.
