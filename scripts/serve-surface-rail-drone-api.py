"""Local drone UI: preserved public review snapshots and bundled geography only.
Never imports app.main, dotenv, collectors or database stores. No DB connection.
The public, domain-bound browser map key stays in memory and is not logged.
"""
import importlib.util
import json
import math
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parent.parent
CAPTURES = Path('I:/ai_root/stock_market/tmp')
snapshot = json.loads((CAPTURES/'central-xi-explore.json').read_text(encoding='utf8'))
peek = json.loads((CAPTURES/'central-xi-peek.json').read_text(encoding='utf8'))
regions = json.loads((ROOT/'backend/app/data/realestate_regions.json').read_text(encoding='utf8'))
districts={g['code']:(s['name'],g['name']) for s in regions['sido'] for g in s['sgg']}
spec = importlib.util.spec_from_file_location('review_coast', ROOT/'backend/app/services/realestate_coast.py')
coast = importlib.util.module_from_spec(spec)
spec.loader.exec_module(coast)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def reply(self, body, status=200):
        raw=json.dumps(body,ensure_ascii=False).encode('utf8')
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        self.send_header('Content-Length',str(len(raw)))
        self.end_headers()
        if self.command!='HEAD':self.wfile.write(raw)
    def do_HEAD(self): self.do_GET()
    def do_GET(self):
        p=urlparse(self.path);q=parse_qs(p.query)
        value=lambda k,default='':q.get(k,[default])[0]
        item=next((x for x in snapshot['items'] if x['id']==value('id')),None)
        if p.path=='/health':return self.reply({'status':'ok','mode':'local-drone','database':False,'snapshot':snapshot['generated_at']})
        if p.path=='/api/visitors/count':return self.reply({'count':None,'total':None,'source':'local-review-no-recording'})
        if p.path.endswith('/regions'):return self.reply({'source':'preserved-public-catalog','sido':regions['sido']})
        if p.path.endswith('/map') or p.path.endswith('/explore'):
            items=[x for x in snapshot['items'] if not value('sgg') or x['sgg_code']==value('sgg')]
            if value('dong'):items=[x for x in items if x['dong']==value('dong')]
            if value('q'):items=[x for x in items if value('q') in x['name']]
            return self.reply({**snapshot,'items':items,'count':len(items),'status':{**snapshot['status'],'configured':False,'collecting':False,'from':'2026-10-05 local review snapshot'}})
        if p.path.endswith('/complex') and item:
            return self.reply({'id':item['id'],'name':item['name'],'item':item,'period':snapshot['period'],'types':[]})
        if p.path.endswith('/buildings'):
            identifier=value('id');parts=identifier.split(':',3)
            if len(parts)!=4 or parts[0] not in districts or len(identifier)>200:
                return self.reply({'error':'valid Korean complex address required'},400)
            if identifier==peek['id']:return self.reply(peek)
            district,dong,lot,name=parts;sido,sgg=districts[district]
            return self.reply({**peek,'id':identifier,'name':name,'built':item['built'] if item else None,
                'query':{'parcel':f'{sido} {sgg} {dong} {lot}','name':name}})
        if p.path.endswith('/summary'):return self.reply({'level':value('level','sgg'),'period':snapshot['period'],'pending':0,'items':[]})
        if p.path.endswith('/facts'):return self.reply({'id':value('id'),'matched':False,'households':None,'parking':None,'parking_per_household':None})
        if p.path.endswith('/rent'):return self.reply({'id':value('id'),'types':[],'status':{'configured':False,'collecting':False,'coverage':0,'error':None,'from':'local snapshot'}})
        if p.path.endswith('/crossings'):return self.reply({'crossings':[],'points':[],'signals':[],'source':None})
        if p.path.endswith('/water'):
            try:
                lat,lon,r=float(value('lat')),float(value('lon')),float(value('r','700'))
                if not (33<=lat<=39 and 124<=lon<=132 and 100<=r<=4000):return self.reply({'error':'outside review range'},400)
                k=111320*math.cos(math.radians(lat))
                project=lambda lo,la:((lo-lon)*k,(la-lat)*110540)
                ways=coast.coastline_near(lat,lon,r,project)
                made=coast.sea(ways,r) if ways else {'rings':[], 'islands':[]}
                islands=made.get('islands',[])
                sea=[{'ring':ring,'kind':'sea','name':None,**({'islands':islands} if islands else {})} for ring in made['rings']]
                if not sea and coast.sea_at(lat,lon):
                    sea=[{'ring':[(-r,-r),(r,-r),(r,r),(-r,r)],'kind':'sea','name':None,**({'islands':islands} if islands else {})}]
                return self.reply({'rings':sea,'beaches':coast.beaches_near(lat,lon,r,project) or [],'works':coast.works_near(lat,lon,r,project),'source':'bundled-coastline'})
            except Exception:return self.reply({'error':'geography unavailable'},503)
        return self.reply({'error':'not available in local drone review'},404)
    def do_POST(self):
        # Query-shaped nearby calls can return only captured complexes, with no writes.
        if urlparse(self.path).path=='/api/realestate/nearby':return self.reply({'items':[],'source':'local snapshot'})
        return self.reply({'error':'local review does not record requests'},405)
    def do_PUT(self):self.reply({'error':'read-only review'},405)
    def do_DELETE(self):self.reply({'error':'read-only review'},405)

class ReviewServer(ThreadingHTTPServer): request_queue_size=128
print('Local drone API: http://127.0.0.1:8003 (no database, public snapshots)',flush=True)
ReviewServer(('127.0.0.1',8003),Handler).serve_forever()
