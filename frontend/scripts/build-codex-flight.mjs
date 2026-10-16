import { build } from 'vite';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const baseline = process.argv.includes('--baseline');
const root = fileURLToPath(new URL('../', import.meta.url));
const files = ['src/components/tidewater/ComplexRenderer.js', 'src/vendor/tidewater/engine/gpu/ShaderAnalysis.js'];
await build({ root, base: './', configFile: false, envFile: false, publicDir: false,
  plugins: [{ name: 'frozen-baseline', load(id) {
    const relative = path.relative(root, id).replaceAll('\\', '/');
    if (baseline && files.includes(relative)) return execFileSync('git', ['show', '3e71dc0:frontend/' + relative], { cwd: root, encoding: 'utf8' });
  } }],
  define: { 'import.meta.env.VITE_STATIC_CDN': JSON.stringify('http://127.0.0.1:5476'), 'import.meta.env.VITE_FILM': '"1"' },
  build: { outDir: '../tmp/codex-flight-' + (baseline ? 'before' : 'after'), emptyOutDir: false, target: 'esnext', rollupOptions: { input: 'scripts/codex-flight.html' } },
});
