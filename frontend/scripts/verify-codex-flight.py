"""Alternating production WebGPU checks on a local deterministic fixture. No DB/API access."""
import argparse
import http.server
import json
import threading
from pathlib import Path
from urllib.parse import unquote, urlsplit
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--label', default='flight-clean')
parser.add_argument('--verify-shaders', action='store_true')
args = parser.parse_args()
assert args.label and all(c.isalnum() or c in '-_' for c in args.label)
out = root / 'tmp/codex-render-evidence' / args.label
out.mkdir(parents=True, exist_ok=True)


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, url):
        path = unquote(urlsplit(url).path)
        if path.startswith('/before/') or path.startswith('/after/'):
            kind, relative = path.lstrip('/').split('/', 1)
            base = root / ('tmp/codex-flight-' + kind)
        else:
            relative, base = path.lstrip('/'), root / 'frontend/public'
        target = (base / relative).resolve()
        return str(target if target.is_relative_to(base.resolve()) else out / '__forbidden__')

    def log_message(self, *_):
        pass


server = http.server.ThreadingHTTPServer(('127.0.0.1', 5476), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
reports = []
try:
    with sync_playwright() as p:
        for run, kind in enumerate(['after'] if args.verify_shaders else ['before', 'after', 'after', 'before']):
            browser = p.chromium.launch(channel='msedge', headless=True, args=['--enable-unsafe-webgpu', '--mute-audio'])
            context = browser.new_context(viewport={'width': 1920, 'height': 1080}, device_scale_factor=1)
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            # No external requests or API traffic. Each run gets a fresh context.
            page.route('**/*', lambda route: route.continue_() if route.request.url.startswith('http://127.0.0.1:5476/') else route.abort())
            page.goto('http://127.0.0.1:5476/' + kind + '/scripts/codex-flight.html' + ('?verify-shaders=1' if args.verify_shaders else ''))
            page.wait_for_function('window.__flight?.ready || window.__flight?.errors.length', timeout=150000)
            assert not page.evaluate('__flight.errors'), page.evaluate('__flight.errors')
            result = page.evaluate('()=>window.__flight.run(3)' if args.verify_shaders else '()=>window.__flight.run(12)')
            result.update(kind=kind, run=run, loadedMs=page.evaluate('__flight.loadedMs'), browser=browser.version,
                          adapter=page.evaluate('__flight.gpu'), errors=errors, verifiedShaders=args.verify_shaders)
            page.evaluate('()=>window.__flight.freeze()')
            page.screenshot(path=str(out / f'flight-{kind}-{run}.png'))
            assert result['canvas'] == [2400, 1350], result['canvas']
            assert result['quality']['name'] == 'high', result['quality']
            assert result['frames'] > 0 and not errors, errors
            reports.append(result)
            (out / 'flight-results.json').write_text(json.dumps(reports, indent=2), encoding='utf-8')
            print(json.dumps(result), flush=True)
            browser.close()
finally:
    server.shutdown()
    server.server_close()
