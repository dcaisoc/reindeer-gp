/**
 * The load test against the whole system running in this process (in-memory
 * database, in-process Evaluator). CI runs a shorter version of this.
 * Usage: npm run loadtest:local -- [--users 200] [--minutes 5]
 */
import { localEnv } from '../server/local/bindings.js';
import { handle } from '../server/src/index.js';
// @ts-expect-error plain JS module
import { runLoadTest } from './loadtest.mjs';

const args = process.argv.slice(2);
const opt = (name: string, d: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);
const env = localEnv({ vars: {} });
const fetchImpl = (u: string, init: RequestInit) => handle(new Request(u, init), env);
const { ok, report } = await runLoadTest({ url: 'http://localhost', users: Number(opt('--users', '200')), minutes: Number(opt('--minutes', '5')), fetchImpl });
console.log(`\n${report}`);
process.exit(ok ? 0 : 1);
