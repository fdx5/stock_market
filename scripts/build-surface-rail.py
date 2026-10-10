"""Convert an explicit public OSM snapshot to immutable, spatially indexed rail assets.
No environment files, application databases, live service or data cleanup is used.
Usage: python scripts/build-surface-rail.py INPUT_JSON OUTPUT_DIRECTORY
"""
import collections
import hashlib
import json
import math
import re
from pathlib import Path
import sys

CELL = 0.025
ACTIVE = {'rail', 'subway', 'light_rail', 'monorail'}


def surface_kind(tags):
    if tags.get('railway') not in ACTIVE or tags.get('service') in {'yard', 'siding', 'spur'}:
        return None
    if tags.get('tunnel', 'no') != 'no' or tags.get('location') == 'underground':
        return None
    if tags.get('construction') or tags.get('disused') == 'yes' or tags.get('abandoned') == 'yes':
        return None
    try:
        layer = float(tags.get('layer', 0))
    except ValueError:
        return None
    if layer < 0:
        return None
    # Missing subway tunnel metadata does not establish a surface alignment.
    elevated = tags.get('bridge', 'no') != 'no' or layer > 0
    if tags['railway'] == 'subway' and not elevated and tags.get('tunnel') != 'no' and tags.get('layer') != '0':
        return None
    return 2 if tags['railway'] == 'monorail' else 1 if elevated else 0


def distance(a, b):
    return math.hypot((a[0]-b[0])*111320*math.cos(math.radians((a[1]+b[1])/2)), (a[1]-b[1])*110540)


def line_info(tags):
    name = tags.get('name:ko', tags.get('name', '전철'))
    base_name = name.split(':')[0]
    network = tags.get('network:ko', tags.get('network', ''))
    ref = tags.get('ref', '')
    number = re.search(r'(\d+)호선',base_name)
    if number: ref=number.group(1)
    family = '수도권'
    for region in ['부산', '대구', '대전', '광주', '인천']:
        if region in base_name:
            family = region
            break
    if '동해선' in base_name: family, ref = '부산', '동해'
    if '대경선' in base_name: family, ref = '대구', '대경'
    if '용인' in base_name: ref = '용인'
    if '의정부경전철' in base_name.replace(' ', ''): ref = '의정부'
    if '신림' in base_name: ref = '신림'
    if '광주' in name and '2호선' in name: return None  # under construction snapshot
    if '자기부상' in name or '월미' in name or '셔틀트레인' in name: return None
    colour = tags.get('colour', '#3b83ba')
    if not colour.startswith('#') or len(colour) != 7: colour = '#3b83ba'
    mode = 'monorail' if tags['route'] == 'monorail' and family == '대구' else 'agt' if ref == '의정부' or (family == '부산' and ref == '4') else 'light' if tags['route'] in {'light_rail', 'monorail'} else 'emu'
    cars = 3 if mode == 'monorail' else 2 if mode == 'light' else 10 if family == '수도권' and ref in {'1','2','3','4'} else 4 if ref in {'동해','대경','경강','공항철도','AREX'} else 6
    car_length, width = (15,2.9) if mode == 'monorail' else (13,2.65) if mode == 'light' else (19.5,3.12)
    if mode == 'agt': cars,car_length,width=6,9.14,2.4
    # ULINE: two-car VAL208, rubber tyres and side guidance. Siemens' published
    # drawing has a 26.14 m pair / 12.70 m body and 1.620 m running-wheel spacing.
    if ref=='의정부': cars,car_length,width=2,12.70,2.08
    if ref=='용인': cars,car_length,width=1,17.4,3.2
    if family=='부산' and ref in {'1','2','3'}: cars,width,car_length={'1':8,'2':6,'3':4}[ref],2.8,17.5
    if family=='수도권' and ref in {'경의·중앙','경춘'}: cars=8
    if ref=='수인·분당': cars=6
    if ref in {'공항철도','AREX'}: cars=6
    if ref=='서해': cars=4
    if ref=='대경': cars=2
    if ref=='경의·중앙' and ('셔틀' in name or '서울역' in name): cars=4
    if family=='수도권' and ref in {'5','6','7'}: cars=8
    if family=='수도권' and ref=='2' and '성수지선' in name: cars=4
    if family=='수도권' and ref=='2' and '신정지선' in name: cars=6
    if family=='인천' and ref=='1': cars=8
    if family=='광주' and ref=='1': cars=4
    # Representative dimensions; fleet-by-fleet measured models remain a documented task.
    branch=':성수지선' if '성수지선' in name else ':신정지선' if '신정지선' in name else ':서울역셔틀' if ref=='경의·중앙' and ('서울역' in name or '셔틀' in name) else ':광명셔틀' if ref=='1' and '광명셔틀' in name else ''
    if branch==':광명셔틀':cars=4
    return dict(id=family+':'+(ref or name.split(':')[0])+branch, name=name.split(':')[0], colour=colour,
                mode=mode, cars=cars, carLength=car_length,width=width,
                gauge=1.62 if ref=='의정부' else 1.435,
                **({'vehicle':'val208'} if ref=='의정부' else {}),
                source='OpenStreetMap', network=network)


def reverse_corridor(c):
    return dict(c, points=list(reversed(c['points'])), nodes=list(reversed(c['nodes'])), ways=list(reversed(c['ways'])),
                stops=[dict(s, d=round(c['length']-s['d'], 2)) for s in reversed(c['stops'])])


def surface_level(tags, kind):
    if not kind: return 0
    try: return max(1, float(tags.get('layer', 1)))
    except (ValueError, TypeError): return 1


def station_facilities(path):
    if not path: return []
    doc=json.loads(path.read_bytes())
    if doc.get('remark'): raise ValueError('Incomplete station source rejected')
    out=[]
    for e in doc['elements']:
        t=e.get('tags', {})
        if t.get('location')=='underground' or t.get('tunnel', 'no')!='no': continue
        try:
            if float(t.get('layer', 0))<0 or float(t.get('level', 0))<0: continue
        except ValueError: continue
        rings=[]
        if e['type']=='way': rings=[e.get('geometry', [])]
        elif e['type']=='relation': rings=[m.get('geometry', []) for m in e.get('members', []) if m.get('role')=='outer']
        for i,g in enumerate(rings):
            if len(g)<4 or distance([g[0]['lon'],g[0]['lat']], [g[-1]['lon'],g[-1]['lat']])>.2: continue
            points=[[round(p['lon'],7),round(p['lat'],7)] for p in g[:-1]]
            try: height=float(str(t.get('height', '')).removesuffix(' m'))
            except ValueError: height=None
            out.append(dict(id=f"{e['type'][0]}{e['id']}:{i}",kind='platform' if t.get('railway')=='platform' else 'station',
                            points=points,name=t.get('name:ko',t.get('name','')),height=height,
                            level=surface_level(t,1),levelKnown='layer' in t or 'level' in t,shelter=t.get('shelter')=='yes',source='OpenStreetMap'))
    return out


def build(source, output, station_source=None):
    if output.exists(): raise SystemExit('Existing asset directory preserved; choose a new version directory.')
    raw = source.read_bytes()
    doc = json.loads(raw)
    if doc.get('remark'): raise SystemExit('Incomplete source response rejected.')
    nodes = {e['id']:e for e in doc['elements'] if e['type']=='node'}
    ways = {e['id']:e for e in doc['elements'] if e['type']=='way'}
    rels = [e for e in doc['elements'] if e['type']=='relation' and e.get('tags',{}).get('type')=='route']
    kinds = {i:surface_kind(w.get('tags',{})) for i,w in ways.items()}
    node_kinds=collections.defaultdict(int)
    node_levels=collections.defaultdict(float)
    for wid,w in ways.items():
        if kinds[wid] is not None:
            for nid in w.get('nodes',[]):
                node_kinds[nid]=max(node_kinds[nid],kinds[wid])
                node_levels[nid]=max(node_levels[nid],surface_level(w.get('tags',{}),kinds[wid]))
    candidates, lines, line_stops = [], {}, collections.defaultdict(set)
    excluded = collections.Counter('tunnel_or_unknown_or_inactive' for k in kinds.values() if k is None)
    for rel in rels:
        info = line_info(rel['tags'])
        if not info: continue
        lines[info['id']] = info
        stop_ids = {m['ref'] for m in rel['members'] if m['type']=='node' and m.get('role','').startswith('stop')}
        line_stops[info['id']].update(stop_ids)
        rail_members = [m for m in rel['members'] if m['type']=='way' and m.get('role') not in {'platform','platform_entry_only','platform_exit_only'} and m['ref'] in ways]
        chain, previous = [], None
        def finish():
            nonlocal chain
            if chain:
                candidates.append(dict(line=info['id'], route=rel['id'], chain=chain, stops=stop_ids))
            chain = []
        for j,m in enumerate(rail_members):
            w = ways[m['ref']]; ns = w.get('nodes', [])[:]
            if len(ns)<2 or any(n not in nodes for n in ns): finish(); previous=None; continue
            if previous is not None and ns[-1]==previous: ns.reverse()
            elif previous is None and j+1<len(rail_members):
                next_nodes=ways[rail_members[j+1]['ref']].get('nodes',[])
                if next_nodes and ns[0] in {next_nodes[0],next_nodes[-1]} and ns[-1] not in {next_nodes[0],next_nodes[-1]}: ns.reverse()
            if m.get('role')=='backward' and previous is None: ns.reverse()
            if kinds[w['id']] is None:
                finish(); previous=ns[-1]; continue
            if chain and chain[-1][1][-1]!=ns[0]: finish()
            chain.append((w['id'],ns))
            previous=ns[-1]
        finish()
    # Long services establish the physical tracks first; overlapping express/short-turn
    # relations add no duplicate rails or fleets. Branches retain their own geometry.
    candidates.sort(key=lambda c:sum(len(ns) for _,ns in c['chain']), reverse=True)
    owned, corridors, breaks = set(), [], 0
    station_keys=set()
    for candidate in candidates:
        parts, chain=[],[]
        for wid,ns in candidate['chain']:
            if wid in owned:
                if chain: parts.append(chain); chain=[]
                continue
            owned.add(wid); chain.append((wid,ns))
        if chain: parts.append(chain)
        for part in parts:
            ns_all, ks = [], []
            for wid,ns in part:
                if ns_all and ns_all[-1]!=ns[0]: raise AssertionError('Disconnected ways joined')
                if ns_all:
                    ks[-1]=max(ks[-1],kinds[wid]); ns=ns[1:]
                ns_all.extend(ns);ks.extend([kinds[wid]]*len(ns))
            pts = [[round(nodes[n]['lon'],7),round(nodes[n]['lat'],7),max(k,node_kinds[n]),node_levels[n]] for n,k in zip(ns_all,ks)]
            along=[0.0]
            for a,b in zip(pts,pts[1:]): along.append(along[-1]+distance(a,b))
            if along[-1]<40: continue
            stops=[]
            for j,n in enumerate(ns_all):
                if n not in line_stops[candidate['line']]: continue
                tags=nodes[n].get('tags',{}); name=tags.get('name:ko',tags.get('name','역'))
                key=candidate['line']+':'+name
                station_keys.add(key)
                stops.append(dict(id=str(n),name=name,d=round(along[j],2),point=pts[j][:2]))
            identifier=hashlib.sha256(','.join(str(w) for w,_ in part).encode()).hexdigest()[:16]
            corridors.append(dict(id=identifier,line=candidate['line'],route=candidate['route'],points=pts,
                                  stops=stops,length=round(along[-1],2),ways=[w for w,_ in part],nodes=ns_all,
                                  overhead=all(ways[w].get('tags',{}).get('electrified')=='contact_line' for w,_ in part)))
    # Restore non-branching seams introduced when overlapping services were deduplicated.
    # Only identical source node IDs can join. XY crossings and neighbouring tracks cannot.
    while True:
        ends=collections.defaultdict(list)
        for i,c in enumerate(corridors):
            ends[c['nodes'][0]].append((i,0));ends[c['nodes'][-1]].append((i,1))
        merge=None
        for values in ends.values():
            if len(values)!=2: continue
            (ia,sa),(ib,sb)=values
            if ia==ib or corridors[ia]['line']!=corridors[ib]['line']: continue
            if sa==sb: corridors[ib]=reverse_corridor(corridors[ib]);sb=1-sb
            merge=(ia,ib) if sa else (ib,ia);break
        if not merge: break
        ia,ib=merge;a,b=corridors[ia],corridors[ib];shift=a['length']
        joined=dict(a,points=a['points'][:-1]+b['points'],nodes=a['nodes'][:-1]+b['nodes'],ways=a['ways']+b['ways'],
                    stops=a['stops']+[dict(s,d=round(s['d']+shift,2)) for s in b['stops'] if s['id'] not in {x['id'] for x in a['stops']}],
                    length=round(shift+b['length'],2),overhead=a['overhead'] and b['overhead'])
        joined['id']=hashlib.sha256(','.join(map(str,joined['ways'])).encode()).hexdigest()[:16]
        corridors=[c for i,c in enumerate(corridors) if i not in {ia,ib}]+[joined]
    facilities=station_facilities(station_source)
    facility_index=collections.defaultdict(list)
    for f in facilities:
        x=sum(p[0] for p in f['points'])/len(f['points']);y=sum(p[1] for p in f['points'])/len(f['points'])
        facility_index[math.floor(x/.005),math.floor(y/.005)].append((x,y,f))
    facility_ids=set()
    for c in corridors:
        found={}
        for s in c['stops']:
            x,y=s['point'];cx,cy=math.floor(x/.005),math.floor(y/.005)
            stop_level=min(c['points'],key=lambda p:distance(p,[x,y]))[3]
            for ix in range(cx-1,cx+2):
                for iy in range(cy-1,cy+2):
                    for fx,fy,f in facility_index[ix,iy]:
                        if distance([x,y],[fx,fy])>240: continue
                        if f['levelKnown'] and abs(f['level']-max(1,stop_level))>.5: continue
                        found[f['id']]=dict(f,stationName=s['name'],d=s['d'])
        c['facilities']=list(found.values());facility_ids.update(found)
    chunks=collections.defaultdict(set)
    for c in corridors:
        # Index each segment, not just vertices: long straight bridges cannot be skipped.
        for a,b in zip(c['points'],c['points'][1:]):
            x0,x1=sorted([math.floor(a[0]/CELL),math.floor(b[0]/CELL)])
            y0,y1=sorted([math.floor(a[1]/CELL),math.floor(b[1]/CELL)])
            for x in range(x0,x1+1):
                for y in range(y0,y1+1): chunks[f'{x}_{y}'].add(c['id'])
    output.mkdir(parents=True)
    (output/'corridors').mkdir()
    sizes=[]
    for c in corridors:
        data=json.dumps(c,ensure_ascii=False,separators=(',',':')).encode()
        (output/'corridors'/f"{c['id']}.json").write_bytes(data);sizes.append(len(data))
    exported_ways={w for c in corridors for w in c['ways']}
    exported_lines={c['line'] for c in corridors}
    manifest=dict(version=1,cell=CELL,snapshot=doc.get('osm3s',{}).get('timestamp_osm_base'),
        sourceSha256=hashlib.sha256(raw).hexdigest(),attribution='© OpenStreetMap contributors · ODbL 1.0',
        sourceUrl='https://www.openstreetmap.org/copyright', elevation='estimated DEM-relative heights; not surveyed',
        lines=[info for lid,info in lines.items() if lid in exported_lines],chunks={k:sorted(v) for k,v in chunks.items()},
        stationSourceSha256=hashlib.sha256(station_source.read_bytes()).hexdigest() if station_source else None,
        stats=dict(corridors=len(corridors),surfaceStations=len(station_keys),stationFacilities=len(facility_ids),ways=len(exported_ways),shortSourceWays=len(owned-exported_ways),
                   chunks=len(chunks),corridorBytes=sum(sizes),maxCorridorBytes=max(sizes),excluded=dict(excluded)))
    (output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')),encoding='utf8')
    print(json.dumps(manifest['stats']))


if __name__=='__main__': build(Path(sys.argv[1]),Path(sys.argv[2]),Path(sys.argv[3]) if len(sys.argv)>3 else None)
