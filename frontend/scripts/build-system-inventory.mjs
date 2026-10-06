/** Build metadata for System Atlas, using the TypeScript AST rather than comments.
 * Backend Python imports and FastAPI routes are inspected in the running backend.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.dirname(frontend);
const manifest = JSON.parse(fs.readFileSync(path.join(frontend, 'package.json'), 'utf8'));
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const files = walk(path.join(frontend, 'src'));
const routes = new Set(), external = [], workers = [];
for (const file of files) {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  if (/worker|\.wgsl$/i.test(path.basename(file))) workers.push(relative);
  if (!/\.[jt]sx?$/.test(file)) continue;
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const hosts = new Set();
  function visit(node) {
    if (path.basename(file) === 'App.tsx' && ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
        ts.isIdentifier(node.left) && node.left.text === 'path' && ts.isStringLiteral(node.right)) routes.add(node.right.text);
    if (ts.isStringLiteralLike(node) || node.kind === ts.SyntaxKind.TemplateHead || node.kind === ts.SyntaxKind.TemplateMiddle) {
      for (const match of node.text.matchAll(/https?:\/\/([a-zA-Z0-9.-]+)/g)) {
        const host = match[1].toLowerCase();
        if (host.includes('.') && !['localhost','127.0.0.1','kospimap.com'].includes(host)) hosts.add(host);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (hosts.size) external.push({ file: relative, hosts: [...hosts].sort() });
}
const workflowDir = path.join(root, '.github/workflows');
const schedules = fs.existsSync(workflowDir) ? fs.readdirSync(workflowDir).filter(n => /\.ya?ml$/.test(n)).sort().map(file => {
  const text = fs.readFileSync(path.join(workflowDir, file), 'utf8');
  return { file, cron: [...text.matchAll(/cron:\s*['"]([^'"]+)/g)].map(m => m[1]),
    endpoints: [...new Set([...text.matchAll(/\/api\/[a-zA-Z0-9_/{}/-]+/g)].map(m => m[0]))].sort() };
}) : [];
const result = { dependencies: manifest.dependencies, dev_dependencies: manifest.devDependencies,
  routes: [...routes].sort(), source_files: files.length, workers, external, schedules,
  deployment: { provider: 'Render', container: 'Docker multi-stage', runtime: 'Python 3.11 / Node 20 build',
    worker_policy: 'WEB_CONCURRENCY=1 (Dockerfile)', domain: 'kospimap.com' } };
const target = path.join(root, 'backend/app/data/system_inventory.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(result, null, 2) + '\n');
console.log(`System Atlas inventory: ${routes.size} routes, ${files.length} frontend files, ${external.length} external-reference files`);
