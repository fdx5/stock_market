"""Check centre, edges and painted lane dash samples against real rendered geometry."""
import argparse,bisect,json,math
from pathlib import Path
from collections import defaultdict
p=argparse.ArgumentParser();p.add_argument('capture');p.add_argument('--expect-missing',action='store_true');a=p.parse_args()
d=json.loads(Path(a.capture).read_text(encoding='utf8'))
assert d['roads'] and d['plans'] and d['state'].get('roadsReadyAt') and d['state'].get('trafficArmedAt'), 'road scene is incomplete'
if 'native' in d:
 assert d['native']['ready'] and not any(d['native'].get(k) for k in ['pending','compiling','failed']),d['native']
class Surface:
 def __init__(self,geometry):
  self.bins=defaultdict(list)
  for g in geometry:
   pos=g['position'];idx=g['index'] or range(len(pos)//3)
   for i in range(0,len(idx),3):
    t=[(pos[k*3],-pos[k*3+2],pos[k*3+1]) for k in idx[i:i+3]]
    den=(t[1][0]-t[0][0])*(t[2][1]-t[0][1])-(t[1][1]-t[0][1])*(t[2][0]-t[0][0])
    if abs(den)<1e-8:continue
    for x in range(math.floor(min(v[0] for v in t)/12),math.floor(max(v[0] for v in t)/12)+1):
     for y in range(math.floor(min(v[1] for v in t)/12),math.floor(max(v[1] for v in t)/12)+1):self.bins[x,y].append((t,den))
 def height(self,x,y):
  heights=[]
  for t,den in self.bins.get((math.floor(x/12),math.floor(y/12)),[]):
   A,B,C=t;u=((x-A[0])*(C[1]-A[1])-(y-A[1])*(C[0]-A[0]))/den;v=((B[0]-A[0])*(y-A[1])-(B[1]-A[1])*(x-A[0]))/den
   if min(u,v,1-u-v)>=-1e-4:heights.append(A[2]*(1-u-v)+B[2]*u+C[2]*v)
  return max(heights) if heights else None
asphalt=Surface([g for g in d['geometry'] if g['name']=='road surface'])
yellow=Surface([g for g in d['geometry'] if g['parent']=='road markings' and g['color'][0]>g['color'][2]*2])
white=Surface([g for g in d['geometry'] if g['parent']=='road markings' and g['color'][0]<=g['color'][2]*2])
plans={p['road']:p for p in d['plans']};samples=defaultdict(int);missing=[];missing_plans=[]
for ri,r in enumerate(d['roads']):
 if d['arms'][ri]['inside']:continue
 plan=plans.get(ri)
 if plan is None:missing_plans.append({'road':ri,'width':r['width'],'lanes':r['lanes'],'length':r['len']});continue
 pts=[]
 for A,B in zip(r['line'],r['line'][1:]):
  length=math.dist(A,B)
  for i in range(math.ceil(length/3)):
   t=i*3/length;pts.append([A[0]+(B[0]-A[0])*t,A[1]+(B[1]-A[1])*t])
 pts.append(r['line'][-1]);cum=[0]
 for A,B in zip(pts,pts[1:]):cum.append(cum[-1]+math.dist(A,B))
 normals=[]
 for i,P in enumerate(pts):
  A=pts[max(0,i-1)];B=pts[min(len(pts)-1,i+1)];dx=B[0]-A[0];dy=B[1]-A[1];length=math.hypot(dx,dy) or 1;normals.append([-dy/length,dx/length])
 def at(s,off):
  i=max(1,min(len(cum)-1,bisect.bisect_left(cum,s)));t=(s-cum[i-1])/(cum[i]-cum[i-1] or 1)
  return tuple(pts[i-1][k]+(pts[i][k]-pts[i-1][k])*t+(normals[i-1][k]+(normals[i][k]-normals[i-1][k])*t)*off for k in [0,1])
 def check(s,off,surface,kind):
  x,y=at(s,off);road=asphalt.height(x,y)
  if road is None:return
  samples[kind]+=1;paint=surface.height(x,y)
  if paint is None or paint<road+.001:
   if len(missing)<100:missing.append({'road':ri,'kind':kind,'s':s,'at':[x,y],'roadHeight':road,'paintHeight':paint})
 for lo,hi in plan['spans']:
  s=lo+.35
  while s<hi-.2:
   lanes=plan['lanes'];width=r['width']
   if lanes>=4:
    for off in [.17,-.17]:check(s,off,yellow,'centre')
   elif lanes>=2:check(s,0,yellow,'centre')
   if width>=2.4:
    for side in [1,-1]:check(s,side*(width/2-.3),white,'edge')
   if .1<s%8<2.9:
    for side in [1,-1]:
     count=lanes//2 if side==1 else math.ceil(lanes/2)
     for k in range(1,count):check(s,side*k*width/2/count,white,'lane')
   s+=1
report={'roads':len(d['roads']),'intersectionPieces':sum(x['inside'] for x in d['arms']),'plans':len(plans),'samples':dict(samples),'missingPlans':missing_plans,'missingPaint':missing,'errors':d['errors']}
out=Path(a.capture).with_name(Path(a.capture).stem+'-coverage.json');out.write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps(report))
if a.expect_missing:assert missing_plans or missing,report
else:assert not missing_plans and not missing and not d['errors'],report
