"""Read-only real-scene 360-second traffic simulation with exact overlap checks. Run from repo root."""
import ast, asyncio, json, argparse
from pathlib import Path
from urllib.parse import urlencode
from playwright.async_api import async_playwright
mod=ast.parse(Path('frontend/scripts/audit-3d-landscape.py').read_text(encoding='utf8'))
v={n.targets[0].id:ast.literal_eval(n.value) for n in mod.body if isinstance(n,ast.Assign) and isinstance(n.value,(ast.Constant,ast.Dict)) and n.targets[0].id in ['hook','CASES']}
parser=argparse.ArgumentParser();parser.add_argument('--base',default='http://127.0.0.1:4195');parser.add_argument('--case',choices=v['CASES'],default='luceheim');parser.add_argument('--out',default='tmp/live-traffic-result.json');args=parser.parse_args()
async def run():
 async with async_playwright() as pw:
  b=await pw.chromium.launch(channel='msedge',headless=True,args=['--enable-unsafe-webgpu']);p=await b.new_page(viewport={'width':1440,'height':900});errors=[]
  p.on('pageerror',lambda e:errors.append(str(e)))
  sido,sgg,dong,lot,name,area=v['CASES'][args.case]
  await p.goto(args.base+'/realestate-map?'+urlencode(dict(sido=sido,sgg=sgg,dong=dong,complex=f'{sgg}:{dong}:{lot}:{name}',area=area,**{'3d':'1'})))
  for i in range(40):
   await p.evaluate(v['hook']);await p.wait_for_timeout(500)
   if await p.evaluate("!!document.querySelector('.re-holo-stage')?.dataset.trafficArmedAt"):break
  state=await p.evaluate("()=>{const n=window.__sceneNative,o=[...(n?.active??[])].find(o=>o.parent?.userData?.traffic);window.__trafficGroup=o?.parent;const e=document.querySelector('.re-holo-stage');return {dataset:{...e?.dataset},native:{ready:n?.ready,pending:n?.pending,failed:n?.failed},readyTraffic:o?n.objectsReady(o.parent):null};}")
  print(json.dumps(state),flush=True)
  if await p.evaluate('!!window.__trafficGroup'):
   result=await p.evaluate('''()=>{const t=window.__trafficGroup.userData.traffic;
    const overlap=(a,b)=>{for(const[u,v]of [[a.hx,a.hy],[a.hy,-a.hx],[b.hx,b.hy],[b.hy,-b.hx]]){const ra=a.length/2*Math.abs(a.hx*u+a.hy*v)+a.width/2*Math.abs(a.hy*u-a.hx*v),rb=b.length/2*Math.abs(b.hx*u+b.hy*v)+b.width/2*Math.abs(b.hy*u-b.hx*v);if(Math.abs((b.x-a.x)*u+(b.y-a.y)*v)>ra+rb)return false;}return true;};
    const initial=t.cars.map(c=>({x:c.x,y:c.y,wd:c.wheelDistance??0}));let overlaps=0,first=null;const snapshots=[],lastMoved=t.cars.map(()=>0),lastDistance=t.cars.map(c=>c.wheelDistance??0);
    for(let frame=0;frame<3600;frame++){t.advance(.1);t.cars.forEach((c,i)=>{const d=c.wheelDistance??0;if(d-lastDistance[i]>.001)lastMoved[i]=frame/10;lastDistance[i]=d;});
     const bins=new Map();for(const c of t.cars){if(c.hide)continue;const x=Math.floor(c.x/24),y=Math.floor(c.y/24);for(let i=x-1;i<=x+1;i++)for(let j=y-1;j<=y+1;j++)for(const o of bins.get(i+':'+j)??[])if(overlap(c,o)){overlaps++;first??={frame,a:c.id,b:o.id};}const k=x+':'+y;if(!bins.has(k))bins.set(k,[]);bins.get(k).push(c);}
     if(frame%300===299){const why={};t.cars.forEach(c=>{if(c.speed<.1)why[c.why]=(why[c.why]??0)+1;});snapshots.push({seconds:(frame+1)/10,moving:t.cars.filter(c=>c.speed>.1).length,inJunction:t.cars.filter(c=>c.inConn).length,why});}
    }
    return {longWait:t.cars.filter((c,i)=>360-lastMoved[i]>80).map(c=>({id:c.id,seconds:360-lastMoved[c.id],why:c.why,by:c.bodyBy?.id,inConn:c.inConn,cluster:c.conn.cluster,go:c.go})),cars:t.cars.length,signals:t.signals.filter(Boolean).length,heads:t.heads.length,overlaps,first,snapshots,moved:t.cars.filter((c,i)=>Math.hypot(c.x-initial[i].x,c.y-initial[i].y)>.1).length,stuck:t.cars.filter((c,i)=>(c.wheelDistance??0)-initial[i].wd<.1).map(c=>({id:c.id,why:c.why,cluster:c.conn.cluster,inConn:c.inConn,go:c.go,s:c.s,end:c.conn.endS,u:c.u,len:c.conn.len,light:t.lightAt(c.conn.node,c.conn.approach)})),final:t.cars.map(c=>({id:c.id,x:c.x,y:c.y,hx:c.hx,hy:c.hy,why:c.why,speed:c.speed,cluster:c.conn.cluster,inConn:c.inConn,go:c.go,road:c.road,forward:c.forward,lane:c.lane,arrive:c.arrive,conn:{approach:c.conn.approach,link:c.conn.link,turn:c.conn.turn,toKey:c.conn.toKey}}))};}''')
   Path(args.out).write_text(json.dumps({'state':state,'result':result,'errors':errors},indent=2),encoding='utf8')
   print(json.dumps({k:v for k,v in result.items() if k not in ['final','stuck']}),flush=True)
   assert result['overlaps']==0,result['first']
   assert not errors,errors
  await b.close()
asyncio.run(run())
