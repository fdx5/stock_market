/** Frontend release preflight. Uses a fresh output directory, no application API/DB
 * or environment files. React and asset transforms match the Docker Vite build. */
import { build } from '../frontend/node_modules/vite/dist/node/index.js';
import react from '../frontend/node_modules/@vitejs/plugin-react/dist/index.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import paintAssetsPlugin from '../frontend/paintAssetsPlugin.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../frontend');
const output = process.argv[2];
if (!output) throw new Error('Pass a new absolute output directory.');
if (!path.isAbsolute(output) || existsSync(output)) throw new Error('Output must be a new absolute directory.');
await build({ root, configFile: false, envFile: false, plugins: [react(), paintAssetsPlugin()],
  build: { outDir: output, emptyOutDir: false } });
