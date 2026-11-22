// Build the web app into dist/ with esbuild.
//   --watch  rebuild on every change (used by `npm run dev`, which also runs the API)
//   --serve  pages only on http://localhost:8001, no API (rarely needed)
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const serve = process.argv.includes('--serve');
const watch = serve || process.argv.includes('--watch');
const dev = watch || process.argv.includes('--dev');
const out = 'dist';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync('web/index.html', `${out}/index.html`);
cpSync('web/styles.css', `${out}/styles.css`);
cpSync('web/public', out, { recursive: true });

const options = {
  entryPoints: { app: 'web/src/main.ts', 'train-worker': 'web/src/train/worker.ts' },
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outdir: out,
  sourcemap: true,
  minify: !dev,
  loader: { '.json': 'json' },
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.rebuild();
  await ctx.watch();
  if (serve) {
    const { port } = await ctx.serve({ servedir: out, port: 8001 });
    console.log(`Pages only (no sign-in, no leaderboards) at http://localhost:${port}`);
  } else console.log('Watching web/ and engine/ for changes…');
} else {
  const r = await esbuild.build({ ...options, metafile: true });
  const bytes = Object.values(r.metafile.outputs).reduce((s, o) => s + o.bytes, 0);
  console.log(`Built ${out}/ (${(bytes / 1024).toFixed(0)} KB including source maps)`);
}
