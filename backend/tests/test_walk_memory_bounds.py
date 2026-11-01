import io,threading,time
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
from app.services.cache import TTLCache
from app.services.memory_cache import CompressedLRU
from app.services.floorplan_analysis_runtime import analyze_isolated

def test_byte_budget_lru_and_oversized_values():
 c=TTLCache(max_bytes=1200)
 for i in range(8):assert c.get_or_set(str(i),60,lambda i=i:bytes([i])*500)==bytes([i])*500
 assert c.byte_size<=1200 and c.peek('7')==bytes([7])*500 and c.peek('0') is None
 assert c.get_or_set('large',60,lambda:b'x'*2000)==b'x'*2000 and c.peek('large') is None
 c.invalidate('7');assert c.byte_size<=600

def test_snapshots_preserve_values_and_do_not_keep_reader_mutations():
 c=CompressedLRU(max_entries=2,max_bytes=10000);row={'202610':[[1,'영천동',84.52],None,{'source':'원본'}]};c['a']=row
 copy=c['a'];copy['202610'].append('temporary');assert c['a']==row
 c['a']=copy;assert c['a']==copy
 c['b']={'ok':True};c.move_to_end('a');c['c']={};assert 'b' not in c and c['a']==copy
 assert c.byte_size<=c.max_bytes

def test_stale_refreshes_are_bounded_and_failures_keep_good_values():
 c=TTLCache();release=threading.Event();started=[];guard=threading.Lock()
 for i in range(12):c.get_or_set(str(i),-1,lambda:'last good')
 def slow():
  with guard:started.append(1)
  release.wait(2);raise RuntimeError('source offline')
 for i in range(12):assert c.get_or_set(str(i),60,slow)=='last good'
 assert len(c._refreshing)<=2 and len(c._key_locks)==64
 release.set();deadline=time.monotonic()+3
 while c._refreshing and time.monotonic()<deadline:time.sleep(.01)
 assert not c._refreshing and len(started)<=2

def test_concurrent_misses_share_one_factory():
 c=TTLCache();calls=[]
 def make():calls.append(1);time.sleep(.01);return {'value':42}
 with ThreadPoolExecutor(8) as pool:values=list(pool.map(lambda _:c.get_or_set('same',60,make),range(8)))
 assert values==[{'value':42}]*8 and len(calls)==1

def test_image_worker_returns_without_retaining_native_buffers():
 data=io.BytesIO();Image.new('RGB',(400,400),'white').save(data,format='PNG')
 result=analyze_isolated(data.getvalue(),84.52)
 assert result['status']=='needs_review' and result['reason']=='wall_detection'



def test_room_tour_types_do_not_load_or_schedule_district_history(monkeypatch):
 from app.services import realestate_map as rm
 monkeypatch.setattr(rm,'_sgg_index',lambda:{'41597':{'name':'화성시 동탄구'}})
 monkeypatch.setattr(rm,'_district',lambda code:{'202610':[[20261030,'T','동탄역포레너스','영천동','720',84.52,50000,3,2017,0]]})
 monkeypatch.setattr(rm.realestate_rights,'merge',lambda complexes,*a,**kw:complexes)
 def forbidden(*a,**kw):raise AssertionError('room-tour area selection must not load district-wide history')
 monkeypatch.setattr(rm,'_older_trades',forbidden);monkeypatch.setattr(rm,'want_history',forbidden)
 body=rm.complex_detail('41597:T','1y',include_history=False)
 assert body['types'][0]['area']==84.52 and body['types'][0]['trades_total']==1
 assert 'deals' not in body['types'][0]
