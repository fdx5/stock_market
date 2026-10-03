"""Real-data road audit: rendered-ground occlusion, extras, requests and errors.
The centroid audit is supplemented by exact plane-partition regression tests.
"""
import argparse,asyncio,base64,io,json,time
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit,parse_qsl,urlencode
from PIL import Image
from playwright.async_api import async_playwright
p=argparse.ArgumentParser();p.add_argument('--base',default='https://kospimap.com');p.add_argument('--iterations',type=int,default=3);p.add_argument('--cpu-rate',type=float,default=1);p.add_argument('--seconds',type=int,default=40);p.add_argument('--out',type=Path,default=Path('tmp/shindo-scene.json'));p.add_argument('--capture-black',action='store_true');a=p.parse_args()
query='sido=41&period=3m&sgg=41150&dong=%ED%98%B8%EC%9B%90%EB%8F%99&complex=41150%3A%ED%98%B8%EC%9B%90%EB%8F%99%3A401-1%3A%EC%8B%A0%EB%8F%846&area=60&3d=1'
def request_key(url):
 u=urlsplit(url);q=[(k,v) for k,v in parse_qsl(u.query) if k.lower() not in ['key','apikey','token','callback']];return urlunsplit((u.scheme,u.netloc,u.path,urlencode(q),'') )
async def main():
 reports=[];a.out.parent.mkdir(parents=True,exist_ok=True)
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(channel='msedge',headless=True,args=['--enable-unsafe-webgpu'])
  context=await browser.new_context(viewport={'width':1440,'height':900})
  if a.base!='https://kospimap.com':
   async def api(route):
    u=urlsplit(route.request.url)
    if route.request.method=='POST' and u.path=='/api/activity/event':await route.fulfill(status=204);return
    if route.request.method not in ['GET','HEAD','OPTIONS'] and u.path!='/api/realestate/nearby':await route.abort();return
    try:
     response=await route.fetch(url='https://kospimap.com'+u.path+('?' +u.query if u.query else ''),timeout=90000)
     await route.fulfill(response=response)
    except Exception:
     if not route.request.is_navigation_request():
      try:await route.abort()
      except Exception:pass
   await context.route(a.base+'/api/**',api)
  for iteration in range(a.iterations):
   page=await context.new_page();events=[];requests=[];black=[];captured=0
   page.on('pageerror',lambda e:events.append(str(e)))
   page.on('console',lambda m:events.append(m.text) if m.type=='error' or 'WebGPU fallback' in m.text else None)
   page.on('request',lambda r:requests.append(request_key(r.url)) if 'vworld.kr' in urlsplit(r.url).netloc else None)
   await page.add_init_script('''window.__sceneFrames=[];window.__sceneInput=[];let previous=0;function sample(t){const e=document.querySelector('.re-holo-layer .re-holo-stage, .re-holo--expanded .re-holo-stage');if(e&&previous)window.__sceneFrames.push({at:t,ms:t-previous,shown:!!e.dataset.shownAt,complete:e.dataset.plantsPhase==='complete'});previous=t;requestAnimationFrame(sample);}requestAnimationFrame(sample);addEventListener('pointermove',()=>{if(window.__pointerSent)window.__sceneInput.push(performance.now()-window.__pointerSent);});''')
   cdp=await context.new_cdp_session(page);await cdp.send('Emulation.setCPUThrottlingRate',{'rate':a.cpu_rate})
   if a.capture_black:
    async def frame(event):
     nonlocal captured
     try:await cdp.send('Page.screencastFrameAck',{'sessionId':event['sessionId']})
     except Exception:return
     captured+=1
     im=Image.open(io.BytesIO(base64.b64decode(event['data']))).convert('RGB');w,h=im.size
     crop=im.crop((int(w*.15),int(h*.2),int(w*.85),int(h*.75))).resize((80,50))
     pixels=list(crop.getdata());ratio=sum(max(v)<=3 for v in pixels)/len(pixels)
     if ratio>.99:black.append({'timestamp':event['metadata'].get('timestamp'),'darkFraction':ratio})
    cdp.on('Page.screencastFrame',frame);await cdp.send('Page.startScreencast',{'format':'jpeg','quality':45,'everyNthFrame':1})
   await page.goto(a.base+'/realestate-map?'+query,wait_until='domcontentloaded',timeout=60000)
   snapshots=[];full_at=None;landscape_at=None;stable=0;start=time.monotonic()
   while time.monotonic()-start<a.seconds:
    await page.wait_for_timeout(250)
    locator=page.locator('.re-holo-layer .re-holo-stage, .re-holo--expanded .re-holo-stage').first
    state=await locator.evaluate('(e)=>({...e.dataset})') if await locator.count() else {}
    debug=await page.evaluate(r'''async()=>{
      if(!window.__nativeHook){const u=performance.getEntriesByType('resource').find(e=>/\/ComplexRenderer-[^/]+\.js/.test(e.name))?.name;if(u){const m=await import(u);const C=Object.values(m).find(v=>typeof v==='function'&&v.prototype?.sync&&v.prototype?.render);if(C){const original=C.prototype.render;C.prototype.render=function(...args){window.__sceneNative=this;return original.apply(this,args)};window.__nativeHook=true;}}}
      const n=window.__sceneNative;if(!n)return null;
      let sourceLeaves=0,nativeLeaves=0,sourceInstances=0,nativeInstances=0,missing=0;
      for(const obj of n.active??[]){const mats=Array.isArray(obj.material)?obj.material:[obj.material];if(!n.meshes.has(obj))missing++;if(mats.some(m=>m?.userData.leafCluster)){sourceLeaves++;sourceInstances+=obj.count??1;const mesh=n.meshes.get(obj);if(mesh){nativeLeaves++;nativeInstances+=mesh.count??1;}}}
      return {ready:!!n.ready,pending:!!n.pending,compiling:!!n.compiling,missing,sourceLeaves,nativeLeaves,sourceInstances,nativeInstances,draws:n.stats.draws};
    }''')
    if debug:state['nativeVerification']=debug
    if landscape_at is None and state.get('plantsPhase')=='complete' and debug and debug['ready'] and not debug['missing'] and debug['sourceInstances']==debug['nativeInstances']:
     landscape_at=await page.evaluate('performance.now()')
    ready=state.get('plantsPhase')=='complete' and all(state.get(k) for k in ['shownAt','roadsReadyAt','lampsReadyAt','trafficReadyAt','ringAt','farGround']) and state.get('sceneReady')=='true'
    stable=stable+1 if ready else 0
    if stable>=2 and full_at is None:full_at=await page.evaluate('performance.now()')
    if not snapshots or time.monotonic()-start>=len(snapshots):snapshots.append(state)
    await page.evaluate('window.__pointerSent=performance.now()');await page.mouse.move(650+(len(snapshots)%2)*20,460)
   roadAudit=await page.evaluate(r'''()=>{const n=window.__sceneNative;if(!n)return null;const objects=[...n.active];const ground=objects.find(o=>o.material?.userData?.groundDetail);const road=objects.find(o=>o.name==='road surface');if(!ground||!road)return {missing:true};ground.updateWorldMatrix(true,false);road.updateWorldMatrix(true,false);const m=ground.matrixWorld.clone().invert().multiply(road.matrixWorld).elements,p=road.geometry.attributes.position.array,g=ground.geometry.attributes.position.array,{xs,ys}=ground.geometry.userData.grid,row=xs.length;function segment(a,v,up){let lo=0,hi=a.length-1;while(hi-lo>1){const k=(lo+hi)>>1;if(up?a[k]<=v:a[k]>=v)lo=k;else hi=k;}return lo;}let worst=0,hidden=0,count=0;for(let k=0;k<p.length;k+=9){let x=0,y=0,z=0;for(let j=0;j<9;j+=3){x+=p[k+j]/3;y+=p[k+j+1]/3;z+=p[k+j+2]/3;}const X=m[0]*x+m[4]*y+m[8]*z+m[12],Y=m[1]*x+m[5]*y+m[9]*z+m[13],Z=m[2]*x+m[6]*y+m[10]*z+m[14];const i=segment(xs,X,true),j=segment(ys,Y,false),u=(X-xs[i])/(xs[i+1]-xs[i]),v=(Y-ys[j])/(ys[j+1]-ys[j]);if(u<0||u>1||v<0||v>1)continue;const a=(j*row+i)*3+2,b=((j+1)*row+i)*3+2,d=a+3,c=b+3;const height=u+v<=1?g[a]*(1-u-v)+g[d]*u+g[b]*v:g[c]*(u+v-1)+g[b]*(1-u)+g[d]*(1-v);const over=height-Z;worst=Math.max(worst,over);hidden+=over>.01?1:0;count++;}return {triangles:count,hiddenCentroids:hidden,maxBurialM:worst};}''');print('roadAudit',roadAudit,flush=True)
   measured=await page.evaluate('({frames:window.__sceneFrames,input:window.__sceneInput,at:performance.now()})')
   tape=await page.locator('.d2-tape').count();await page.locator(':is(.re-holo-layer,.re-holo--expanded) input[type=range]').evaluate("e=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'12');e.dispatchEvent(new Event('input',{bubbles:true}));}");await page.wait_for_timeout(1500);await page.screenshot(path=str(a.out.with_name(a.out.stem+f'-{iteration}.png')))
   if a.capture_black:await cdp.send('Page.stopScreencast')
   state=snapshots[-1] if snapshots else {};selected=float(state.get('selectAt',0));counts=Counter(requests)
   result={'roadAudit':roadAudit,'iteration':iteration,'cpuRate':a.cpu_rate,'state':state,'snapshots':snapshots,'landscapeReadyMs':landscape_at-selected if landscape_at else None,'fullSceneMs':full_at-selected if full_at else None,'within3Seconds':full_at is not None and full_at-selected<=3000,'vworldRequests':len(requests),'vworldUnique':len(counts),'duplicateRequests':sum(n-1 for n in counts.values()),'requestPaths':dict(Counter(urlsplit(u).path for u in requests)),'frames':measured['frames'],'pointerDelays':measured['input'],'blackCaptures':black,'capturedFrames':captured,'errors':events,'tapeElements':tape}
   reports.append(result);a.out.write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf8')
   print(json.dumps({k:result[k] for k in ['iteration','cpuRate','landscapeReadyMs','fullSceneMs','within3Seconds','vworldRequests','duplicateRequests','blackCaptures','capturedFrames','errors','tapeElements']}),flush=True)
   assert roadAudit and not roadAudit.get('missing') and roadAudit['hiddenCentroids']==0, roadAudit
   assert not events, events
   await page.close();await asyncio.sleep(1)
  await browser.close()
asyncio.run(main())
