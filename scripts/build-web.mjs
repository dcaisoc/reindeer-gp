// Build the web app into dist/ with esbuild. `--serve` starts a local dev server
// on http://localhost:8000 that rebuilds on every change.
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const serve = process.argv.includes('--serve');
const dev = serve || process.argv.includes('--dev');
const out = 'dist';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync('web/index.html', `${out}/index.html`);
cpSync('web/styles.css', `${out}/styles.css`);
cpSync('web/public', out, { recursive: true });

const options = {
  entryPoints: ['web/src/main.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outfile: `${out}/app.js`,
  sourcemap: true,
  minify: !dev,
  loader: { '.json': 'json' },
  logLevel: 'info',
};

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: out, port: 8000 });
  console.log(`Reindeer Grand Prix running at http://localhost:${port}`);
} else {
  const r = await esbuild.build({ ...options, metafile: true });
  const bytes = Object.values(r.metafile.outputs).reduce((s, o) => s + o.bytes, 0);
  console.log(`Built ${out}/ (${(bytes / 1024).toFixed(0)} KB including source maps)`);
}
