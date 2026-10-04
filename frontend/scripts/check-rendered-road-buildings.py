import sys,json
from pathlib import Path
sys.path.insert(0,'tmp/qa-geometry-python')
from shapely.geometry import Polygon
from shapely.ops import unary_union
prefix=sys.argv[1];d=json.loads(Path(f'tmp/{prefix}-map-geometry.json').read_text(encoding='utf8'))
def triangles(s):
 a=s['position'];idx=s['index'] or list(range(len(a)//3))
 for i in range(0,len(idx),3):
  p=Polygon([(a[k*3],-a[k*3+2]) for k in idx[i:i+3]])
  if p.area>1e-5 and p.is_valid:yield p
asphalt=unary_union([p for s in d['surfaces'] if s['name']=='road surface' for p in triangles(s)])
out=[]
for s in d['buildingSurfaces']:
 hits=[p.intersection(asphalt) for p in triangles(s) if p.intersects(asphalt)]
 hit=unary_union(hits)
 if hit.area>.01:out.append({'category':s.get('category'),'area':hit.area,'parts':[{'at':list(g.centroid.coords)[0],'area':g.area,'bounds':list(g.bounds)} for g in (list(hit.geoms) if hasattr(hit,'geoms') else [hit]) if g.area>.01]})
Path(f'tmp/{prefix}-rendered-road-buildings.json').write_text(json.dumps(out,indent=2),encoding='utf8')
print(json.dumps({'meshes':len(d['buildingSurfaces']),'overlap':out}))
assert d['buildingSurfaces'] and not out, out
