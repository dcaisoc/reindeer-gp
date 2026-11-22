## What and why

<!-- One or two sentences. Link the issue: "Closes #12". -->

## Checklist

- [ ] `npm run ci` passes locally
- [ ] Docs updated if behaviour or formats changed
- [ ] **Golden traces:** did any hash change?
  - [ ] No
  - [ ] Yes, deliberately: engine major version bumped in `engine/reindeer/config.ts`, corpus regenerated with `npm run golden:update`, and the reason is explained above
