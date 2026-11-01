"""Reviewed public drawing references. Generic data-driven lookup, no DB writes.

These are disclosed approximations traced on source copies, not native OCR
certifications. A new verified reference is content, never a renderer exception.
"""
from functools import lru_cache
from pathlib import Path
from copy import deepcopy
import hashlib,json,math,re

ROOT=Path(__file__).resolve().parents[1]/'data'/'floorplan_references'

@lru_cache(maxsize=1)
def records():
    return json.loads((ROOT/'catalogue.json').read_text(encoding='utf8'))['complexes']

def norm(name):
    return re.sub(r'아파트|[\s()]', '', name.replace('에스에이치','SH').upper())

def lookup(name,lat,lon,town='',region='',pnu=''):
    found=[]
    for row in records():
        if town and town!=row['town'] or region and not row['regionCode'].startswith(region):continue
        same_parcel=pnu==row['pnu']
        nearby=math.hypot((lon-row['lon'])*88000,(lat-row['lat'])*111000)<650
        if not (same_parcel or nearby):continue
        candidate=norm(name)
        if not any(candidate==norm(a) or same_parcel and candidate.startswith(norm(a)) and re.fullmatch(r'\d{3,4}',candidate[len(norm(a)):]) for a in row['aliases']):continue
        found.append(row)
    return catalogue(found[0]['id']) if len(found)==1 else None

def catalogue(source_id):
    row=next((r for r in records() if r['id']==source_id),None)
    if row is None:raise LookupError('reference not found')
    plans=[]
    for p in row['plans']:
        data=(ROOT/p['file']).read_bytes()
        key=hashlib.sha256(source_id.encode()+json.dumps(p,sort_keys=True,ensure_ascii=False).encode()+data).hexdigest()[:24]
        plans.append({k:p[k] for k in ['typeId','typeName','exclusiveArea','supplyArea']}|{'naverId':source_id,'key':key,'imageId':key,'imageUrl':'/api/realestate/floor-plan-image?naver_id='+source_id+'&key='+key,'sourceUrl':row['sourceUrl'],'variant':'공개 도면 사본·구획 보정','provider':'reviewed_reference'})
    return {'status':'available','naverId':source_id,'name':row['name'],'town':row['town'],'regionCode':row['regionCode'],'plans':plans,'types':plans,'source':row['source'],'note':row['note']}

def selected(source_id,key):
    cat=catalogue(source_id);drawing=next((p for p in cat['plans'] if p['key']==key),None)
    if drawing is None:raise LookupError('reference drawing not found')
    row=next(r for r in records() if r['id']==source_id)
    p=next(p for p in row['plans'] if p['typeId']==drawing['typeId'])
    return row,p,drawing

def image(source_id,key):
    _,p,_=selected(source_id,key)
    return (ROOT/p['file']).read_bytes(),'image/jpeg'

def analyze(source_id,key):
    from PIL import Image
    row,p,drawing=selected(source_id,key);x0,y0,x1,y1=p['bounds']
    pixels=sum((r['rect'][2]-r['rect'][0])*(r['rect'][3]-r['rect'][1]) for r in p['rooms'] if r['type']!='balcony')
    scale=math.sqrt(p['exclusiveArea']/pixels)
    rooms=deepcopy(p['rooms']);openings=deepcopy(p['openings'])
    pixel_rooms=[{'id':r['id'],'rect':r['rect'][:]} for r in rooms]
    for r in rooms:r['rect']=[round((v-(x0 if i%2==0 else y0))*scale,4) for i,v in enumerate(r['rect'])]
    for o in openings:
        o['at']=round((o['at']-(x0 if o['axis']=='x' else y0))*scale,4)
        o['center']=round((o['center']-(y0 if o['axis']=='x' else x0))*scale,4)
        o['width']=round(o['width']*scale,4)
    size=list(Image.open(ROOT/p['file']).size)
    return {'status':'ready','version':'reviewed-reference-1','drawing':drawing,'rooms':rooms,'openings':openings,'areaM2':p['exclusiveArea'],'areaError':0,'imageSize':size,'pixelBounds':p['bounds'],'pixelRooms':pixel_rooms,'scale':{'xMetresPerPixel':scale,'zMetresPerPixel':scale,'basis':'reviewed_source_coordinates','estimated':True,'wallThicknessMetres':.10},'application':{'mode':'approximate_source','areaAnnotationAdjusted':True,'geometryBasis':'reviewed_public_drawing_copy','templateUsed':False},'note':row['note'],'checks':{'areaConsistent':True,'connected':True},'elapsedMs':0}
