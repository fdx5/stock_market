"""Bounded public health/static-asset release check; no app-data or admin requests."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time

import requests

parser = argparse.ArgumentParser()
parser.add_argument('--commit', required=True)
parser.add_argument('--source', type=Path, required=True)
parser.add_argument('--out', type=Path, required=True)
parser.add_argument('--build', type=Path, help='Clean frontend build containing the required performance workers.')
parser.add_argument('--timeout', type=int, default=1200)
args = parser.parse_args()
if args.out.exists():
    raise SystemExit('Use a fresh report path.')
base = 'https://kospimap.com'
session = requests.Session()
session.trust_env = False
started = time.monotonic()
checks = []
while time.monotonic() - started < args.timeout:
    checked = {'elapsedSeconds': round(time.monotonic() - started, 1)}
    try:
        response = session.get(base + '/api/health', timeout=20)
        checked['httpStatus'] = response.status_code
        response.raise_for_status()
        health = response.json()
        checked.update(status=health.get('status'), commit=health.get('commit'))
    except Exception as error:
        checked['errorType'] = type(error).__name__
    checks.append(checked)
    print(json.dumps(checked), flush=True)
    if checked.get('status') == 'ok' and checked.get('commit') == args.commit:
        break
    time.sleep(20)
else:
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({'deployed': False, 'checks': checks}, indent=2), encoding='utf8')
    raise SystemExit('Target release is not live within the observation window.')

public = args.source / 'frontend/public'
manifest_path = 'rail/20261010-v7/manifest.json'
paths = [manifest_path, 'rail/20261010-v7/NOTICE.md',
         '3d/drone/mini2-20261010-v2/hover.wav', '3d/drone/mini2-20261010-v2/start.wav']
manifest = json.loads((public / manifest_path).read_text(encoding='utf8'))
corridors = sorted({key for ids in manifest['chunks'].values() for key in ids})
paths += ['rail/20261010-v7/corridors/' + key + '.json' for key in corridors[:3]]
assets = []
for path in paths:
    response = session.get(base + '/' + path, timeout=30)
    response.raise_for_status()
    # Git's canonical bytes match the Linux build; a Windows checkout can use CRLF.
    blob = subprocess.run(['git', 'show', args.commit + ':frontend/public/' + path],
                          cwd=args.source, capture_output=True, check=True).stdout
    expected = hashlib.sha256(blob).hexdigest()
    actual = hashlib.sha256(response.content).hexdigest()
    assert actual == expected, 'Static asset digest mismatch: ' + path
    assets.append({'path': path, 'bytes': len(response.content), 'sha256': actual})
    print(json.dumps({'verifiedAsset': path, 'bytes': len(response.content)}), flush=True)

if args.build:
    for stem in ['coastGeometryWorker', 'roadModelCheckWorker', 'droneSurveyWorker', 'railClearanceWorker']:
        matches=list((args.build / 'assets').glob(stem + '-*.js'))
        assert len(matches) == 1, 'Expected one clean-build worker: ' + stem
        local=matches[0]
        path='/assets/' + local.name
        response=session.get(base + path, timeout=30)
        response.raise_for_status()
        expected=hashlib.sha256(local.read_bytes()).hexdigest()
        actual=hashlib.sha256(response.content).hexdigest()
        assert actual == expected, 'Performance worker digest mismatch: ' + stem
        assets.append({'path':path,'bytes':len(response.content),'sha256':actual})
        print(json.dumps({'verifiedWorker':stem,'bytes':len(response.content)}),flush=True)

# Public HTML references are checked without opening an interactive session or API data.
import re
page = session.get(base + '/drone-explore', timeout=30)
page.raise_for_status()
assert 'text/html' in page.headers.get('Content-Type', '')
scripts = re.findall(r'<script[^>]*src=["\']([^"\']+)', page.text)
assert scripts, 'Drone page has no entry script.'
for path in scripts:
    if path.startswith('/assets/'):
        response = session.get(base + path, timeout=30)
        response.raise_for_status()
        assert 'javascript' in response.headers.get('Content-Type', '')
        assets.append({'path': path, 'bytes': len(response.content)})
report = {'deployed': True, 'commit': args.commit, 'checks': checks, 'assets': assets,
          'durationSeconds': round(time.monotonic() - started, 1),
          'scope': 'Public health, HTML, entry script, seven versioned assets and optional clean-build workers; no browser flight/FPS claim.'}
args.out.parent.mkdir(parents=True, exist_ok=True)
args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps({'deployed': True, 'commit': args.commit, 'assetsVerified': len(assets)}), flush=True)
