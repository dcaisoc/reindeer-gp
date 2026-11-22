# Contributing

Thanks for helping! This project is run by student volunteers, so we value code that the next volunteer can read over code that is clever.

## Your first contribution

1. Fork the repo and run `make dev` (see the README).
2. Pick an issue labelled `good first issue`, or open one describing what you want to change.
3. Make a branch, keep the change small, and run `npm run ci` before pushing.
4. Open a pull request using the template. CI must pass and a maintainer reviews it.

## Ground rules

- **Never change engine behaviour by accident.** Any change in `engine/` that alters a golden-trace hash changes every score and replay. If that is intended, bump the engine major version in `engine/reindeer/config.ts`, run `npm run golden:update`, and say why in the PR.
- **Deterministic maths only in the engine.** No `Math.sin`, `Math.exp`, `Math.random`, `Date.now()` and so on in `engine/core` or `engine/reindeer`; use `engine/core/fmath.ts`. `npm run lint` checks this.
- **No user code ever runs on the server.** Bots are weights-only files.
- **Plain language in the UI.** Most players have never trained a network. Explain, don't show off.
- **Accessibility matters.** Real buttons and labels, keyboard access for everything except the driving itself, and colours that pass WCAG AA.

## Useful commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Local app with rebuild on save |
| `npm test` | Unit tests |
| `npm run test:golden` | Golden traces in Node |
| `npm run test:browser` | Golden traces in a browser and end-to-end checks |
| `npm run tracks` / `npm run validate:tracks` | Regenerate and validate tracks |
| `npm run balance` | Baseline vs tuned driver times on each track |

By contributing you agree your contributions are licensed under the MIT licence.
