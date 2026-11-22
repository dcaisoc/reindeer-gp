#!/usr/bin/env bash
# One-off GitHub setup for the repository: labels, milestones and branch protection.
# Needs the GitHub CLI (`gh auth login` first) and admin rights on the repo.
# Usage: scripts/gh-bootstrap.sh [owner/repo]     (default: dcaisoc/reindeer-gp)
# Safe to re-run: existing labels and milestones are left alone.
set -euo pipefail
REPO="${1:-dcaisoc/reindeer-gp}"
echo "Setting up $REPO"

label() { gh label create "$1" --repo "$REPO" --color "$2" --description "$3" 2>/dev/null || echo "  label '$1' exists"; }
label bug           d73a4a "Something is broken"
label enhancement   a2eeef "New feature or improvement"
label track         1f6f50 "Track proposals and track data"
label twist         e8b931 "Weekly twist proposals"
label engine        0f2340 "Physics, determinism, golden traces"
label web           2b6cb0 "Browser app"
label sdk           6b46c1 "Python SDK and notebooks"
label server        7a4a2a "Workers, database, API"
label docs          0075ca "Documentation"
label "good first issue" 7057ff "Small and well-defined: great for a first contribution"
label "launch-blocker"   b60205 "Must be fixed before the next milestone date"

milestone() {
  if gh api "repos/$REPO/milestones?state=all" --jq '.[].title' | grep -qx "$1"; then echo "  milestone '$1' exists"
  else gh api "repos/$REPO/milestones" -f title="$1" -f due_on="$2" -f description="$3" >/dev/null; echo "  milestone '$1' created"; fi
}
milestone "M1 Playable core"          2026-11-29T23:59:00Z "Engine, 3 tracks, drive with recording, replay viewer, local ghost, repo and CI"
milestone "M2 Kickoff-ready MVP"      2026-12-01T23:59:00Z "Accounts, teams, in-browser trainer, submit and verify, live boards, permalinks, admin basics"
milestone "M3 SDK and notebooks"      2026-12-13T23:59:00Z "reindeer-sdk, CLI, Colab notebooks, docs site"
milestone "M4 Weekly twists"          2026-12-20T23:59:00Z "Scheduled twists, leader ghosts, badges, college standings, digest"
milestone "M5 Polish and hardening"   2026-12-20T23:59:00Z "GIF export, accessibility, load test, restore drill, runbook rehearsal"

echo "Repository settings: auto-delete merged branches, squash or rebase merges only"
gh api -X PATCH "repos/$REPO" -F delete_branch_on_merge=true -F allow_merge_commit=false \
  -F allow_squash_merge=true -F allow_rebase_merge=true >/dev/null

echo "Protecting main: PR review, passing CI, linear history"
gh api -X PUT "repos/$REPO/branches/main/protection" --input - >/dev/null <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["Lint, unit tests, golden traces, build", "Golden traces in browsers + end-to-end", "Secret scan"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 1, "dismiss_stale_reviews": true },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
echo "Done. Next: create the 'staging' and 'production' environments (Settings -> Environments),"
echo "add a required reviewer to 'production', and add CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID secrets."
