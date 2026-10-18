"""Build NEW versioned static cells from read-only OSM exports; no database access.

python scripts/build-drone-places.py --raw national.json members.json --output frontend/public/3d/drone/places-20261018-v1
The raw export is nwr shops/markets/named districts in area ISO3166-1=KR,
`out geom`; member-way tags can come from the public OSM multi-fetch GET API.
Only selected place/geometry fields are published; contributor/account fields are omitted.
"""
from __future__ import annotations
import argparse,json,math,re
from collections import Counter
from datetime import datetime,timezone
from pathlib import Path

CELL=.05
DISTRICT=re.compile(r'먹자골목|먹거리거리|음식문화거리|특화거리|카페거리|부대찌[개게]거리|닭갈비골목|족발거리|순대타운|차이나타운|한옥마을|벽화마을')
BIG=re.compile(r'백화점|아울렛|아웃렛|쇼핑몰|쇼핑센터|스타필드|코스트코|costco|홈플러스|home\s?plus|롯데마트|트레이더스|하나로마트|메가마트|AK플라자|뉴코아|이마트|e[ -]?mart',re.I)
TENANT={'bag','jewelry','cosmetics','computer','fashion_accessories','shoes','watches','books','coffee','mobile_phone','electronics','clothes','optician','sports','toys','perfumery'}

def name_of(t):
    n=str(t.get('name:ko') or t.get('name') or '').strip()
    if t.get('shop')=='department_store' and n in {'신세계','Shinsegae','SHINSEGAE'}:return '신세계백화점'
    return re.sub(r'\s+',' ',n)[:100]

def kind_of(t):
    n=name_of(t);shop=t.get('shop','')
    if not n or t.get('highway')=='bus_stop' or t.get('public_transport') in {'platform','stop_position'}:return None
    if shop in {'vacant','no'} or t.get('disused:shop') or t.get('abandoned:shop'):return None
    if shop in {'department_store','mall','wholesale'}:return 'commercial'
    if t.get('amenity')=='marketplace':return 'market'
    # A tenant/service name can mention its enclosing mall. It is not a second
    # mall: e.g. stationery, car repair, chargers and parking at Starfield.
    if t.get('amenity') or (shop and shop not in {'supermarket','hypermarket','general','discount'}):return None
    if DISTRICT.search(n):return 'district'
    if re.search(r'(전통시장|재래시장|[가-힣A-Za-z]시장)$',n):return 'market'
    match=BIG.search(n)
    if match and not re.search(r'이마트\s*24|e[ -]?mart\s*24|충전소|주차장|화장실|고객센터|수선실',n,re.I):
        if shop and match.start()>1 and not (t.get('building') or t.get('building:part')):return None
        return 'commercial'
    return None

def geometry(e):
    return [[round(p['lon'],7),round(p['lat'],7)] for p in e.get('geometry',[]) if 'lon' in p and 'lat' in p]

def closed(r):return len(r)>=4 and r[0]==r[-1]
def inside(p,r):
    x,y=p;v=False
    for a,b in zip(r,r[1:]+r[:1]):
        if (a[1]>y)!=(b[1]>y) and x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:v=not v
    return v

def stitch(parts):
    waiting=[p[:] for p in parts if len(p)>1];out=[]
    while waiting:
        r=waiting.pop()
        while not closed(r):
            for i,p in enumerate(waiting):
                if r[-1]==p[0]:r+=p[1:]
                elif r[-1]==p[-1]:r+=p[-2::-1]
                elif r[0]==p[-1]:r=p[:-1]+r
                elif r[0]==p[0]:r=p[:0:-1]+r
                else:continue
                waiting.pop(i);break
            else:break
        if closed(r):out.append(r)
    return out

def outlines(e):
    if e['type']=='way':
        r=geometry(e);return [[r]] if closed(r) else []
    outer=[];holes=[]
    for m in e.get('members',[]):
        r=geometry(m)
        if m.get('role')=='inner':holes.append(r)
        elif m.get('role','') in {'outer','outline',''}:outer.append(r)
    rs=stitch(outer);hs=stitch(holes)
    return [[r,*[h for h in hs if inside(h[0],r)]] for r in rs]

def metres(v):
    m=re.match(r'^\s*(\d+(?:\.\d+)?)\s*(m|ft|feet)?\s*$',str(v or ''))
    return float(m[1])*(.3048 if m[2] in {'ft','feet'} else 1) if m else None

def model_piece(e,parent):
    t=e.get('tags',{});polys=outlines(e)
    if not polys or not (t.get('building') or t.get('building:part')):return []
    h=metres(t.get('height') or t.get('building:height'));minimum=metres(t.get('min_height')) or 0
    levels=metres(t.get('building:levels'));estimated=h is None
    if h is None:h=max(3,(levels or metres(parent.get('building:levels')) or 2)*3.6)
    if not minimum<h<=400:return []
    # Preserve actual min_height (market canopies remain open below their roof).
    out=[]
    for i,rings in enumerate(polys):
        p={'id':f"{e['type'][0]}{e['id']}:{i}",'rings':rings,'height':round(h,2),'minHeight':round(minimum,2),'estimated':estimated}
        for tag,key in [('building:colour','wall'),('roof:colour','roof')]:
            if re.fullmatch(r'#[0-9a-fA-F]{6}',str(t.get(tag,''))):p[key]=t[tag]
        if levels:p['floors']=round(levels)
        if t.get('building')=='roof':p['canopy']=True
        out.append(p)
    return out

def build(raws):
    elements={};stamp=None
    for raw in raws:
        if raw.get('remark') or raw.get('error'):raise ValueError('Incomplete OSM export')
        stamp=raw.get('osm3s',{}).get('timestamp_osm_base') or stamp
        for e in raw.get('elements',[]):
            old=elements.get((e['type'],e['id']),{});elements[(e['type'],e['id'])]={**old,**e,'tags':{**old.get('tags',{}),**e.get('tags',{})}}
    for e in list(elements.values()):
        for m in e.get('members',[]):
            if m.get('type')=='way' and m.get('geometry'):
                key=('way',m['ref']);elements.setdefault(key,{'type':'way','id':m['ref']})['geometry']=m['geometry']
    selected=[e for e in elements.values() if kind_of(e.get('tags',{}))]
    member_parent={m['ref']:e['id'] for e in selected if e['type']=='relation' for m in e.get('members',[]) if m.get('type')=='way'}
    rows=[]
    for e in selected:
        if e['type']=='way' and e['id'] in member_parent:continue
        t=e.get('tags',{});kind=kind_of(t);polys=outlines(e)
        points=[p for poly in polys for p in poly[0]] or geometry(e)
        b=e.get('bounds')
        if 'lat' in e:lat,lon=e['lat'],e['lon']
        elif b:lat=(b['minlat']+b['maxlat'])/2;lon=(b['minlon']+b['maxlon'])/2
        elif points:lon=sum(p[0] for p in points)/len(points);lat=sum(p[1] for p in points)/len(points)
        else:continue
        if not (32<lat<39.5 and 124<lon<132):continue
        models=[]
        if kind!='district':
            members=[elements.get(('way',m['ref'])) for m in e.get('members',[]) if m.get('type')=='way' and m.get('role') in {'part','outer'}]
            pieces=[p for m in members if m for p in model_piece(m,t)]
            models=pieces or model_piece(e,t)
        row={'id':f"{e['type'][0]}{e['id']}",'name':name_of(t),'kind':kind,'lat':round(lat,7),'lon':round(lon,7)}
        if polys:row['outlines']=polys
        if models:row['models']=models
        address=t.get('addr:full') or ' '.join(str(t.get(k,'')) for k in ['addr:province','addr:city','addr:district','addr:street','addr:housenumber']).strip()
        fields={'address':address,'brand':t.get('brand:ko') or t.get('brand'),'phone':t.get('phone') or t.get('contact:phone'),'hours':t.get('opening_hours'),'website':t.get('website') or t.get('contact:website'),'checked':t.get('check_date')}
        row.update({k:str(v)[:240] for k,v in fields.items() if v})
        if 'website' in row and not re.match(r'^https?://',row['website']):row.pop('website')
        rows.append(row)
    # A named node and its enclosing named building/area identify one place.
    keep=[]
    for r in sorted(rows,key=lambda r:(not bool(r.get('models')),not bool(r.get('outlines')),-len(r.get('address','')))):
        alias=re.sub(r'[\s()（）]','',r['name']).casefold();duplicate=None
        for q in keep:
            if q['kind']!=r['kind']:continue
            qa=re.sub(r'[\s()（）]','',q['name']).casefold()
            if not (alias==qa or min(len(alias),len(qa))>=3 and (alias in qa or qa in alias)):continue
            distance=math.hypot((r['lon']-q['lon'])*111320*math.cos(math.radians(r['lat'])),(r['lat']-q['lat'])*110540)
            contained=any(inside([r['lon'],r['lat']],p[0]) for p in q.get('outlines',[]))
            if distance<45 or contained:duplicate=q;break
        if duplicate:
            for k in ['address','brand','phone','hours','website','checked']:
                if not duplicate.get(k) and r.get(k):duplicate[k]=r[k]
        else:keep.append(r)
    return keep,stamp

def main():
    p=argparse.ArgumentParser();p.add_argument('--raw',nargs='+',required=True);p.add_argument('--output',required=True);a=p.parse_args()
    rows,stamp=build([json.loads(Path(f).read_text(encoding='utf8')) for f in a.raw]);cells={}
    for row in rows:cells.setdefault(f"{math.floor(row['lat']/CELL)}_{math.floor(row['lon']/CELL)}",[]).append(row)
    out=Path(a.output);out.mkdir(parents=True,exist_ok=False)
    for key,items in cells.items():(out/(key+'.json')).write_text(json.dumps(items,ensure_ascii=False,separators=(',',':')),encoding='utf8')
    counts=dict(Counter(r['kind'] for r in rows));manifest={'version':1,'cell':CELL,'built':datetime.now(timezone.utc).isoformat(),'osmBase':stamp,'attribution':'© OpenStreetMap contributors · ODbL 1.0','sourceUrl':'https://www.openstreetmap.org/copyright','counts':counts,'models':sum(len(r.get('models',[])) for r in rows),'cells':sorted(cells)}
    (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')),encoding='utf8');print(json.dumps({'places':len(rows),'cells':len(cells),'counts':counts,'models':manifest['models']},ensure_ascii=False))

if __name__=='__main__':main()
