"""Manual public-source refresh. Never used by browser/startup/deploy.
Writes a NEW source snapshot; refuses to overwrite any saved file.
python scripts/download-surface-rail.py NEW_SNAPSHOT.json
"""
import json
from pathlib import Path
import sys
import requests
output=Path(sys.argv[1])
if output.exists():raise SystemExit('Existing snapshot preserved; choose a new filename.')
session=requests.Session();session.trust_env=False
session.headers['User-Agent']='Kospimap-local-surface-rail-review/1.0 (public geometry; no database)'
query='[out:json][timeout:90];area["ISO3166-1"="KR"][admin_level=2]->.a;relation(area.a)[type=route][route~"^(subway|light_rail|monorail|train)$"];out body;'
r=session.get('https://overpass-api.de/api/interpreter',params={'data':query},timeout=110);r.raise_for_status();relations=r.json()
if relations.get('remark'):raise SystemExit('Incomplete relation list rejected.')
ids=[]
for element in relations['elements']:
    tags=element.get('tags',{});name=tags.get('name','')
    if tags.get('route')!='train' or any(s in name for s in ['경의','수인','경춘','서해','공항철도','동해선 광역','대경선','수도권 전철']):ids.append(element['id'])
query='[out:json][timeout:150];rel(id:'+','.join(map(str,ids))+');(._;>>;);out body geom;'
r=session.post('https://overpass-api.de/api/interpreter',data={'data':query},timeout=175);r.raise_for_status();source=r.json()
if source.get('remark'):raise SystemExit('Incomplete geometry response rejected.')
output.parent.mkdir(parents=True,exist_ok=True)
with output.open('xb') as f:f.write(r.content)
print(json.dumps({'eligibleRoutes':len(ids),'elements':len(source['elements']),'bytes':len(r.content)}))
