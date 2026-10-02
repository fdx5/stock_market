import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
export function paintSourceHash() {
  const hash = createHash('sha256');
  for (const file of ['complexScene.ts', 'normalKernel.ts']) hash.update(readFileSync(path.join(root, 'src/components', file), 'utf8').replace(/\r\n/g, '\n'));
  return hash.digest('hex').slice(0, 20);
}
export default function paintAssetsPlugin() {
  return { name: 'verified-paint-assets', config() {
    const hash = paintSourceHash();
    const manifest = path.join(root, 'public/3d/paint', hash, 'manifest.json');
    // A painter edit automatically disables stale precomputed maps; the original
    // painter remains the exact fallback until the assets are regenerated.
    return { define: { 'import.meta.env.VITE_PAINT_ASSETS': JSON.stringify(existsSync(manifest) ? hash : '') } };
  } };
}
