"""Fail the release gate unless quality, 3x first-view loading and input/frame budgets pass.
Requires at least three comparable cold-browser reports before AND after changes.
"""
import argparse, json, statistics, sys
from pathlib import Path
ap=argparse.ArgumentParser()
ap.add_argument('--baseline',nargs='+',required=True)
ap.add_argument('--candidate',nargs='+',required=True)
ap.add_argument('--quality',required=True)
ap.add_argument('--memory',required=True)
ap.add_argument('--budget-ms',type=float,default=20)
a=ap.parse_args()
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8'))
before=list(map(read,a.baseline));after=list(map(read,a.candidate));failures=[]
if min(len(before),len(after))<3:failures.append('Need three cold-browser samples per version')
environment=before[0].get('environment')
if not environment or any(r.get('environment')!=environment for r in before+after):failures.append('Baseline and candidate environments are not proven comparable')
def first_ms(r):
 s=r['first']['state'];return float(s['shownAt'])-float(s['selectAt'])
factor=statistics.median(map(first_ms,before))/statistics.median(map(first_ms,after))
if factor<3:failures.append(f'First visible frame only {factor:.2f}x faster')
for i,r in enumerate(after):
 if r.get('errors'):failures.append(f'Candidate {i}: runtime errors')
 for stage in ['overview','street','away','afterSwitch']:
  if r[stage]['raf']['max']>a.budget_ms:failures.append(f'Candidate {i}: {stage} exceeded frame budget')
 for stage in ['pointerDelay','frames']:
  measurement=r.get('loadingInput',{}).get(stage)
  if not measurement or not measurement['count'] or measurement['max']>a.budget_ms:failures.append(f'Candidate {i}: loading {stage} exceeded budget or unmeasured')
 expected=before[0]['first']['state']
 for field in ['quality','pixelRatio','renderer','neighbours']:
  if r['first']['state'].get(field)!=expected.get(field):failures.append(f'Candidate {i}: {field} changed')
q=read(a.quality)
if q.get('errors') or len(q.get('maps',[]))<50 or any(m['max']>1 for m in q.get('maps',[])):failures.append('Texture quality evidence incomplete or failed')
rows=read(a.memory)
if rows.get('errors'):failures.append('Memory lifecycle errors')
closed=next((r for r in rows['rows'] if r['tag']=='all-closed'),None)
if not closed or closed['canvases'] or closed['gl'] or closed['texMB']>rows['rows'][0]['texMB']*.25:failures.append('Closed view retained render resources')
print(json.dumps({'releaseAllowed':not failures,'firstFrameSpeedup':round(factor,3),'failures':failures},ensure_ascii=False,indent=2))
sys.exit(1 if failures else 0)
