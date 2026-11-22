# Bot file format (`rgp-bot` version 1)

A bot is a JSON file describing a small fully connected network. The server runs it with deterministic float64 maths, so the score is identical everywhere. Check a file with `reindeer validate my-bot.json` or the `POST /api/v1/bots/validate` endpoint; both use the rules below and give the same messages.

```json
{
  "format": "rgp-bot",
  "version": 1,
  "game": "reindeer-gp",
  "meta": { "name": "Rudolph v3", "method": "imitation", "trainer": "my-notebook" },
  "inputs": ["ray0", "ray1", "ray2", "ray3", "ray4", "ray5", "ray6", "speed"],
  "outputs": ["steer", "throttle"],
  "layers": [
    { "type": "dense", "in": 8, "out": 32, "activation": "relu", "weights": [[...8 numbers], ...32 rows], "bias": [...32 numbers] },
    { "type": "dense", "in": 32, "out": 2, "activation": "tanh", "weights": [[...32 numbers], ...2 rows], "bias": [0.0, 0.0] }
  ]
}
```

## Fields

| Field | Rule |
| --- | --- |
| `format`, `version`, `game` | Exactly `"rgp-bot"`, `1`, `"reindeer-gp"`. |
| `meta.name` | Required, 1–60 characters. Other `meta` fields are free-form and shown on your submission. |
| `inputs` | 1–16 distinct sensor names from the table below, in the order the first layer expects them. |
| `outputs` | Exactly `["steer", "throttle"]`. |
| `layers` | 1–6 `dense` layers. Each has `in` and `out` (1–512), `activation`, `weights` (`out` rows of `in` numbers: row *j* feeds output *j*) and `bias` (`out` numbers). Each layer's `in` must equal the previous layer's `out`; the last layer's `out` must be 2. |
| `activation` | `relu`, `tanh`, `sigmoid` or `linear`. |
| Numbers | Finite, with absolute value at most 1000. |
| Size | At most **5,000 parameters** in total (weights plus biases). |

The server also feeds 256 random sensor readings through the network and rejects it if any output is NaN or infinite.

## Sensors

| Name | Meaning | Range |
| --- | --- | --- |
| `ray0` … `ray6` | Distance to the nearest wall at −60°, −40°, −20°, 0°, 20°, 40°, 60° from straight ahead, divided by 40 m. | 0 to 1 |
| `speed` | Forward speed ÷ top speed (28 m/s). Negative when reversing. | below 1 |
| `lateral` | Sideways slide ÷ top speed. | −1 to 1 |
| `surf_snow`, `surf_ice`, `surf_rough` | 1 if the sleigh is on that surface, else 0. | 0 or 1 |

Weekly twists may add sensors; `reindeer_sdk.input_names()` lists those available.

## How the bot drives

Every 3 ticks (20 times a second) the server reads the sensors, runs the network, clamps each output to [−1, 1], multiplies by 127 and rounds to the nearest whole number (NaN becomes 0). That action is held for the next 3 ticks of the 60 Hz physics. Outputs above 1 or below −1 are clamped, so a final `tanh` is a sensible choice but not required.
