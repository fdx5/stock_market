"""Verify running commit, real road coverage and deployed geometry/instance WASM bytes."""
import ast,json,subprocess,sys,time,urllib.request,argparse,hashlib
from pathlib import Path
from urllib.parse import urlencode,urlsplit
from datetime import datetime,timezone
p=argparse.ArgumentParser();p.add_argument('--base',default='https://kospimap.com');p.add_argument('--commit');p.add_argument('--skip-health',action='store_true');p.add_argument('--out',default='tmp/hybrid-production-verification.json');a=p.parse_args()
commit=a.commit or subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip();health={}
if not a.skip_health:
 for _ in range(120):
  try:
   with urllib.request.urlopen(a.base+'/api/health',timeout=15)as r:health=json.load(r)
   if health.get('commit')==commit:break
   print('waiting for healthy release',health.get('commit'),flush=True)
  except Exception as e:print(type(e).__name__,flush=True)
  time.sleep(5)
 else:raise AssertionError('release did not become healthy')
tree=ast.parse(Path('frontend/scripts/audit-3d-landscape.py').read_text(encoding='utf8'))
cases=next(ast.literal_eval(n.value)for n in tree.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='CASES'for t in n.targets))
cases['ganeung']=('41','41150','가능동','860','의정부롯데캐슬골드포레','60')
proof={'commit':commit,'health':health,'verified':False,'production':{},'assetSha256':hashlib.sha256(Path('frontend/src/wasm/scene-geometry/scene_geometry.wasm').read_bytes()).hexdigest()}
out=Path(a.out);out.parent.mkdir(parents=True,exist_ok=True)
for case in ['ganeung','shindonga','luceheim']:
 sido,sgg,dong,lot,name,area=cases[case]
 url=a.base+'/realestate-map?'+urlencode(dict(sido=sido,period='3m',sgg=sgg,dong=dong,complex=f'{sgg}:{dong}:{lot}:{name}',area=area,**{'3d':'1','hour':'12'}))
 prefix=str(out.with_name(out.stem+'-'+case))
 subprocess.run([sys.executable,'frontend/scripts/audit-road-markings.py','--url',url,'--out',prefix],check=True)
 subprocess.run([sys.executable,'frontend/scripts/check-road-markings.py',prefix+'.json'],check=True)
 capture=json.loads(Path(prefix+'.json').read_text(encoding='utf8'));coverage=json.loads(Path(prefix+'-coverage.json').read_text(encoding='utf8'))
 assert capture['state']['geometryCompute']=='rust-wasm',capture['state']
 assert capture['state']['roadIndex']=='rust-wasm-bvh',capture['state']
 assert capture['instanceCompute'] and all(r['mode']=='rust-wasm'for r in capture['instanceCompute']),capture['instanceCompute']
 assert not capture['errors'] and not coverage['missingPaint'] and not coverage['missingPlans']
 assert capture['wasmAssets'],'no geometry WASM request recorded'
 for asset in set(capture['wasmAssets']):
  assert urlsplit(asset).netloc==urlsplit(a.base).netloc,'unexpected asset origin'
  with urllib.request.urlopen(asset,timeout=30)as response:asset_hash=hashlib.sha256(response.read()).hexdigest()
  assert asset_hash==proof['assetSha256'],'running WASM bytes differ from checked binary'
 proof['production'][case]={'state':capture['state'],'native':capture['native'],'instanceMode':'rust-wasm','instances':capture['instanceCompute'],'coverage':coverage,'wasmMatches':True}
 out.write_text(json.dumps(proof,indent=2),encoding='utf8')
proof['verified']=True;proof['verifiedAt']=datetime.now(timezone.utc).isoformat();out.write_text(json.dumps(proof,indent=2),encoding='utf8')
print(json.dumps({'verified':True,'commit':commit,'cases':list(proof['production'])}),flush=True)
