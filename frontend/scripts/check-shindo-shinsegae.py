"""Read-only reproduction of the Shindo 6 to Uijeongbu Shinsegae flight."""
import json, sys, time
from pathlib import Path
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright

base, label = sys.argv[1:3]
out = Path(__file__).resolve().parents[2] / 'tmp/first-lanes-qa'
out.mkdir(parents=True, exist_ok=True)
result = {'base':base, 'errors':[], 'tiles':[]}
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=False,args=['--mute-audio','--window-position=0,0'])
    ctx=browser.new_context(viewport={'width':1200,'height':800})
    ctx.route('**/api/**',lambda route:route.continue_() if route.request.method=='GET' and not any(k in route.request.url.lower() for k in ['activity','visitor','track','pulse','heartbeat','analytics','beacon','page-view']) else route.fulfill(status=200,content_type='application/json',body='{}'))
    ctx.route('**/*youtube*',lambda route:route.abort())
    page=ctx.new_page()
    page.add_init_script("""(()=>{window.__routeFrames=[];let prev=0;const tick=t=>{const n=window.__holoNative?.frameNo??0;if(n>prev){window.__routeFrames.push(t);prev=n;}requestAnimationFrame(tick);};requestAnimationFrame(tick);})();""")
    page.on('pageerror',lambda e:result['errors'].append(str(e)[:250]))
    page.on('console',lambda m:result['tiles'].append(m.text) if m.text.startswith('[dtile]') else None)
    page.goto(base+'/drone-explore?'+urlencode({'complex':'41150:호원동:401-1:신도6','hour':12,'dronedebug':1,'dtrace':1}),wait_until='domcontentloaded')
    page.wait_for_function('!!window.__drone?.world',timeout=120000)
    result['setup']=page.evaluate("""()=>{const d=window.__drone,w=d.world,c=w.o.data.center;window.__routeCosts={};for(const [obj,key,name]of [[w,'update','world'],[w.places,'update','places'],[w.placeFootprints,'covered','coverage']]){const f=obj[key];obj[key]=function(...args){const t=performance.now();try{return f.apply(this,args);}finally{(window.__routeCosts[name]??=[]).push(performance.now()-t);}};}return {center:c,now:performance.now(),to:[(127.0461211-c.lon)*w.kx,(37.7374156-c.lat)*110540],canvas:[window.__holoNative.canvas.width,window.__holoNative.canvas.height]};}""")
    if '--no-places' in sys.argv:
        page.evaluate('window.__drone.world.places.update=()=>{};window.__drone.world.places.root.visible=false')
    page.wait_for_timeout(10000)
    page.screenshot(path=str(out/(label+'-start.png')))
    page.evaluate('window.__routeFrames=[]')
    result['flight']=page.evaluate("""async()=>{const d=window.__drone,w=d.world,f=d.flight,c=w.o.data.center,tx=(127.0461211-c.lon)*w.kx,ty=(37.7374156-c.lat)*110540,dist=Math.hypot(tx,ty),yaw=-Math.atan2(tx,ty),seconds=Math.max(15,dist/35),samples=[];f.setAutopilot(false);f.setAutoSpeed(0);const start=performance.now();let next=0;await new Promise(resolve=>{const tick=t=>{const elapsed=(t-start)/1000,u=Math.min(1,elapsed/seconds),x=tx*u,y=ty*u;f.place(x,y,w.groundAt(x,y),100,yaw);f.vel.set(tx/dist*35,0,-ty/dist*35);f.tilt=-.2;if(elapsed>=next){next+=5;const tiles=[...w.tiles.values()].filter(tile=>{const dx=tile.cx-x,dy=tile.cy-y;return dx*tx+dy*ty>0&&Math.hypot(dx,dy)<900}).map(tile=>({key:tile.key,state:tile.state,survey:tile.survey,age:Math.round(t-tile.startedAt),ground:!!tile.grid,buildings:!!tile.buildingGroup,unready:tile.state==='placed'?w.notReady(tile.key):[]}));samples.push({s:Math.round(elapsed),x,y,clear:w.clearAhead(x,y,tx/dist,ty/dist,800),stats:w.stats(),tiles});}if(u<1)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);});return {seconds,distance:dist,samples};}""")
    page.screenshot(path=str(out/(label+'-arrival.png')))
    result['render']=page.evaluate("""()=>{const f=window.__routeFrames,g=f.slice(1).map((t,i)=>t-f[i]).sort((a,b)=>a-b),wins=[];let left=0;for(let i=0;i<f.length;i++){while(f[left]<f[i]-1000)left++;if(f[i]>=f[0]+1000)wins.push(i-left+1);}const n=window.__holoNative;return {canvas:[n.canvas.width,n.canvas.height],quality:n.quality.name,renderer:document.querySelector('.re-holo-stage')?.dataset.renderer,mean:(f.length-1)*1000/(f.at(-1)-f[0]),minOneSecond:Math.min(...wins),p95:g[Math.floor(g.length*.95)],p99:g[Math.floor(g.length*.99)],max:g.at(-1)};}""")
    result['costs']=page.evaluate("""()=>Object.fromEntries(Object.entries(window.__routeCosts).map(([k,a])=>{a.sort((a,b)=>a-b);return[k,{calls:a.length,total:a.reduce((s,x)=>s+x,0),p95:a[Math.floor(a.length*.95)],max:a.at(-1)}]}))""")
    print(json.dumps({'setup':result['setup'],'costs':result['costs'],'flight':[{'s':r['s'],'clear':r['clear'],'stats':r['stats'],'pending':[(t['key'],t['state'],t['age']) for t in r['tiles'] if t['state']!='ready']} for r in result['flight']['samples']]},ensure_ascii=True),flush=True)
    browser.close()
(out/(label+'.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
