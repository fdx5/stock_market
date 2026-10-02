"""Fail explicitly when measured 3D performance misses the requested release targets."""
import argparse, json, statistics
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument('reports', nargs='+', type=Path)
ap.add_argument('--baseline-first-ms', type=float, required=True)
ap.add_argument('--speedup', type=float, default=3)
ap.add_argument('--frame-budget-ms', type=float, default=20)
ap.add_argument('--input-budget-ms', type=float, default=20)
ap.add_argument('--output', type=Path, required=True)
args = ap.parse_args()
reports = [json.loads(p.read_text(encoding='utf-8')) for p in args.reports]
assert args.speedup > 0 and args.baseline_first_ms > 0
first = [int(r['first']['state']['shownAt']) - int(r['first']['state']['selectAt']) for r in reports]
frame_max = max([r['loadingInput']['frames']['max'] for r in reports] +
                [r[phase]['raf']['max'] for r in reports for phase in ['overview','street','away','afterSwitch']])
input_max = max(r['loadingInput']['pointerDelay']['max'] for r in reports)
result = {
    'firstMedianMs': statistics.median(first), 'requiredFirstMs': args.baseline_first_ms / args.speedup,
    'frameMaxMs': frame_max, 'requiredFrameMaxMs': args.frame_budget_ms,
    'inputMaxMs': input_max, 'requiredInputMaxMs': args.input_budget_ms,
    'targets': {
        'initialLoading': statistics.median(first) <= args.baseline_first_ms / args.speedup,
        'frameIntervals': frame_max <= args.frame_budget_ms,
        'loadingInput': input_max <= args.input_budget_ms,
        'webgpuHigh': all(r['overview']['state'].get('renderer') == 'tidewater-webgpu' and
                          r['overview']['state'].get('quality') == 'high' for r in reports),
        'noBrowserErrors': all(not r['errors'] for r in reports),
    },
    'reports': [str(p) for p in args.reports],
}
result['passed'] = all(result['targets'].values())
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result))
raise SystemExit(0 if result['passed'] else 1)
