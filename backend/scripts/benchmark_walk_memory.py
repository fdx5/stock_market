"""Isolated before/after cache replay, synthetic public-schema rows, no DB opened."""
import gc,hashlib,importlib.util,json,sys,threading,time
from pathlib import Path
import psutil
mode=sys.argv[1];base=Path(__file__).resolve().parents[2]/'tmp/source-lookup-20261101'
base.mkdir(parents=True,exist_ok=True)
if mode=='before':
 import subprocess
 (base/'baseline').mkdir(exist_ok=True)
 for name in ['cache.py','realestate_map.py']:
  target=base/'baseline'/name
  if not target.exists():target.write_bytes(subprocess.check_output(['git','show','c18f29da:backend/app/services/'+name],cwd=base.parents[1]))
def module(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
if mode=='before':
 cmod=module('old_cache',base/'baseline/cache.py');rm=module('old_map',base/'baseline/realestate_map.py')
else:
 from app.services import cache as cmod,realestate_map as rm
process=psutil.Process();peak=process.memory_info().rss;stop=threading.Event()
def sample():
 global peak
 while not stop.wait(.02):peak=max(peak,process.memory_info().rss)
t=threading.Thread(target=sample);t.start();initial=process.memory_info().rss;started=time.perf_counter();sizes=[]
def rows(c):return [[20261030,c+'-'+str(i%50),'단지'+str(i%50),'동'+str(i%3),str(i%100),84.5,50000+i,10,2005,0] for i in range(4000)]
def batch(codes,**kwargs):
 sizes.append(len(codes));return {c:{'202610':('2026-11-01',rows(c))} for c in codes}
rm.realestate_store.load_districts=batch
codes=[str(41000+i) for i in range(90)];rm._prefetch(codes)
raw_rss=process.memory_info().rss
cache=cmod.TTLCache()
for i in range(200):cache.get_or_set('sample:'+str(i),3600,lambda i=i:bytes([i%255])*786432)
gc.collect();retained=process.memory_info().rss
# Actual rows and values remain unchanged after storage compression.
value=rm._districts[codes[-1]];assert len(value['202610'])==4000 and value['202610'][37][2]=='단지37'
assert cache.peek('sample:199')==bytes([199])*786432
stop.set();t.join();result={'mode':mode,'initialRss':initial,'rawCacheRss':raw_rss,'retainedRss':retained,'peakRss':peak,'seconds':time.perf_counter()-started,'districts':len(rm._districts),'largestReadBatch':max(sizes),'commonEntries':len(cache._store),'commonBytes':getattr(cache,'byte_size',None),'districtCompressedBytes':getattr(rm._districts,'byte_size',None),'rowsVerified':4000}
(base/('memory-'+mode+'.json')).write_text(json.dumps(result,indent=2),encoding='utf8');print(result)
