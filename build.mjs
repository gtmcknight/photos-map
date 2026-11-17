// Builds the extension into dist/. `--dev` adds sourcemaps and the reload hook;
// `--watch` rebuilds on change.
import * as esbuild from 'esbuild';
import { cp, copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Everything relative to this file, wherever the build is run from.
process.chdir(fileURLToPath(new URL('.', import.meta.url)));

const dev = process.argv.includes('--dev');
const watch = process.argv.includes('--watch');
const out = 'dist';

await rm(out, { recursive: true, force: true });
await mkdir(`${out}/licenses`, { recursive: true });
await cp('static', out, { recursive: true });
await copyFile('node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs', `${out}/maplibre-gl-worker.mjs`);
await copyFile('node_modules/maplibre-gl/LICENSE.txt', `${out}/licenses/maplibre-gl.txt`);

/**
 * MapLibre draws heatmaps into a buffer a quarter of the screen's width and
 * height, then stretches it, which is what made the heat look pixelated.
 * Draw it at full resolution instead. Pinned to maplibre-gl 6.16.0: if the
 * minified code changes, fail the build rather than ship blurry heat.
 */
const sharpHeat = {
  name: 'sharp-heat',
  setup(build) {
    build.onLoad({ filter: /maplibre-gl[\\/]dist[\\/]maplibre-gl\.mjs$/ }, async (args) => {
      const source = await readFile(args.path, 'utf8');
      const quarter = 't.width/4,t.height/4';
      const found = source.split(quarter).length - 1;
      if (found !== 2) throw new Error(`sharp-heat: expected 2 quarter-size heatmap buffers in maplibre-gl, found ${found}`);
      return { contents: source.replaceAll(quarter, 't.width,t.height'), loader: 'js' };
    });
  },
};

const common = {
  bundle: true,
  target: 'chrome120',
  define: { __DEV__: String(dev) },
  minify: !dev,
  sourcemap: dev ? 'linked' : false,
  legalComments: 'eof',
  logLevel: 'info',
};

const builds = [
  // Small: runs on every Photos page.
  { ...common, entryPoints: ['src/content/index.ts'], outfile: `${out}/content.js`, format: 'iife' },
  // MapLibre and the map, imported by the content script the first time the map opens.
  {
    ...common,
    entryPoints: ['src/engine/index.ts'],
    outfile: `${out}/engine.js`,
    format: 'esm',
    loader: { '.css': 'text' },
    plugins: [sharpHeat],
  },
  { ...common, entryPoints: ['src/background.ts'], outfile: `${out}/background.js`, format: 'esm' },
];

if (watch) {
  for (const options of builds) await (await esbuild.context(options)).watch();
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
