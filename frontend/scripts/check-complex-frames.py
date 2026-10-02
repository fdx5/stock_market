"""Fail unless every measured loading, extras, switching and gesture frame meets the budget."""
import argparse, json
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('reports',nargs='+');p.add_argument('--budget-ms',type=float,default=20)
a=p.parse_args();results=[]
for path in a.reports:
    r=json.loads(Path(path).read_text(encoding='utf8'));phases={}
    for frame in r['frameTimeline']:phases.setdefault(frame['phase'],[]).append(frame['ms'])
    counts={k:{'frames':len(v),'maxMs':round(max(v),2),'drops':sum(x>a.budget_ms for x in v)} for k,v in phases.items()}
    required={'loading','extras','overview','cameraTransition','street','away','switchLoading','afterSwitch','interaction'}
    passed=required<=counts.keys() and all(v['drops']==0 for v in counts.values()) and not r['errors'] and r['overview']['state']['renderer']=='tidewater-webgpu' and r['overview']['state']['quality']=='high'
    results.append({'report':path,'passed':passed,'budgetMs':a.budget_ms,'phases':counts})
print(json.dumps(results,indent=2));raise SystemExit(0 if all(r['passed'] for r in results) else 1)
