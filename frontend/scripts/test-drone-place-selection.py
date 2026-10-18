"""Real Chrome combobox regression; mocked search only, no server/data writes.

python scripts/test-drone-place-selection.py
--source-ref=74a6776a runs the same test against the previous component.
Requires the existing frontend node_modules and Python Playwright/Chrome.
"""
import functools,json,subprocess,sys,tempfile,threading
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs,urlparse
from playwright.sync_api import sync_playwright

frontend=Path(__file__).resolve().parents[1]
ref=next((x.split('=',1)[1] for x in sys.argv if x.startswith('--source-ref=')),None)
old=subprocess.check_output(['git','show',ref+':frontend/src/components/DronePlaceSearch.tsx'],cwd=frontend,encoding='utf8') if ref else None
fixtureRoot=Path(tempfile.gettempdir())/'stock-market-drone-search-tests'
fixtureRoot.mkdir(exist_ok=True)
fixture=Path(tempfile.mkdtemp(prefix='selection-',dir=fixtureRoot)).resolve()
assert fixture.is_relative_to(fixtureRoot.resolve())
jsx="""
import React from 'react';import {createRoot} from 'react-dom/client';
import DronePlaceSearch from COMPONENT;
window.moves=[];window.focusTrace=[];
document.addEventListener('focusout',e=>window.focusTrace.push(e.target.tagName),true);
createRoot(document.getElementById('root')).render(<div className="re-holo"><div className="re-holo-head"><div className="re-holo-tools"><DronePlaceSearch mapKey="test-only-public-key" onMove={p=>window.moves.push(p)} onTyping={()=>{}} /></div></div></div>);
""".replace('COMPONENT',json.dumps((frontend/'src/components/DronePlaceSearch.tsx').as_posix()))
build="""
import {createRequire} from 'node:module';import fs from 'node:fs';import path from 'node:path';
const require=createRequire(PACKAGE),{build}=require('esbuild'),out=OUT,old=OLD;
await build({stdin:{contents:JSX,loader:'tsx',resolveDir:ROOT},bundle:true,format:'esm',platform:'browser',jsx:'automatic',outfile:out+'/app.js',plugins:old?[{name:'baseline-component',setup(b){b.onLoad({filter:/DronePlaceSearch\\.tsx$/},a=>({contents:old,loader:'tsx',resolveDir:path.dirname(a.path)}));}}]:[]});
fs.writeFileSync(out+'/index.html','<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"></head><body style="margin:20px;background:#243240"><div id="root"></div><button id="outside">outside</button><script type="module" src="/app.js"></script></body></html>');
"""
for name,value in [('PACKAGE',(frontend/'package.json').as_posix()),('OUT',fixture.as_posix()),('OLD',old),('JSX',jsx),('ROOT',frontend.as_posix())]:build=build.replace(name,json.dumps(value))
built=subprocess.run(['node','--input-type=module','-'],input=build,encoding='utf8',cwd=frontend,capture_output=True)
if built.returncode:print(built.stderr,file=sys.stderr)
built.check_returncode()
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=fixture))
threading.Thread(target=server.serve_forever,daemon=True).start()
results=[]
def respond(route):
 q=parse_qs(urlparse(route.request.url).query)
 items=[{'id':str(i),'title':'강남데시앙파크'+str(i),'category':'아파트','address':{'road':'서울특별시 강남구 헌릉로590길 63','parcel':'서울특별시 강남구 세곡동 523'},'point':{'x':str(127.1+i*.001),'y':'37.46'}} for i in range(12)] if q['type'][0]=='PLACE' else []
 route.fulfill(content_type='application/javascript; charset=utf-8',body=q['callback'][0]+'('+json.dumps({'response':{'status':'OK','result':{'items':items}}},ensure_ascii=True)+');')
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(channel='chrome',headless=False,args=['--mute-audio'])
  for touch in [False,True]:
   for kind in ['click','ime','keyboard','keyboard-reflow','scroll']:
    if kind=='scroll' and not touch:continue
    ctx=browser.new_context(viewport={'width':933,'height':704},is_mobile=touch,has_touch=touch)
    ctx.route('https://api.vworld.kr/req/search?*',respond)
    page=ctx.new_page();page.goto(f'http://127.0.0.1:{server.server_port}')
    field=page.get_by_role('combobox');field.click()
    cdp=ctx.new_cdp_session(page)
    if kind=='ime':cdp.send('Input.imeSetComposition',{'text':'강남','selectionStart':2,'selectionEnd':2})
    else:field.fill('강남')
    option=page.get_by_role('option').first;option.wait_for()
    page.wait_for_timeout(200)
    if kind=='keyboard-reflow':
     # A soft-keyboard dismissal can reflow the list before mouseup/click.
     # Model that viewport change on the real browser focusout event.
     field.evaluate("e=>e.addEventListener('blur',()=>document.querySelector('#root').style.marginTop='100px',{once:true})")
    if kind=='keyboard':field.press('ArrowDown');field.press('Enter')
    elif kind=='scroll':
     r=page.get_by_role('listbox').bounding_box();x=r['x']+r['width']/2;y=r['y']+r['height']*.8
     cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
     for n in range(1,6):cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x,'y':y-n*20}]});page.wait_for_timeout(20)
     cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
    elif touch:option.tap()
    else:option.click()
    page.wait_for_timeout(100)
    go=page.locator('.re-drone-place-go')
    if kind=='scroll':passed=go.is_disabled() and page.get_by_role('listbox').is_visible() and page.get_by_role('listbox').evaluate('e=>e.scrollTop')>0
    else:
     passed=go.is_enabled() and field.input_value()=='세곡동 강남데시앙파크0' and page.get_by_role('option').count()==0
     if passed:
      go.click();moves=page.evaluate('window.moves');passed=len(moves)==1 and moves[0]['lat']==37.46 and moves[0]['lon']==127.1
    results.append({'touch':touch,'case':kind,'passed':passed})
    print(json.dumps(results[-1]),flush=True)
    ctx.close()
  browser.close()
finally:server.shutdown();server.server_close()
report={'sourceRef':ref or 'working tree','results':results,'fixture':str(fixture)}
(fixture/'result.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
print(json.dumps({'passed':sum(r['passed'] for r in results),'total':len(results),'report':str(fixture/'result.json')}),flush=True)
assert all(r['passed'] for r in results),report
