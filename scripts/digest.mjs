#!/usr/bin/env node
// Print the weekly digest (markdown) for pasting into the group chat.
// Usage: npm run digest -- [--url https://reindeer-gp.dcaisoc.workers.dev] [--days 7]
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const url = (opt('--url', process.env.REINDEER_URL ?? 'https://reindeer-gp.dcaisoc.workers.dev')).replace(/\/$/, '');
const days = opt('--days', '7');
const res = await fetch(`${url}/api/v1/digest.md?days=${encodeURIComponent(days)}`);
if (!res.ok) {
  console.error(`Could not fetch the digest from ${url} (${res.status}): ${await res.text()}`);
  process.exit(1);
}
process.stdout.write(await res.text());
