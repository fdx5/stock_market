"""Controlled browser CPU benchmark, using captured real road/paint triangles.
Serve with serve-bvh-preview.mjs first. No changes to production services.
"""
import argparse,asyncio,json,statistics,platform
from pathlib import Path
from playwright.async_api import async_playwright
p=argparse.ArgumentParser();p.add_argument('--runs',type=int,default=5);p.add_argument('--out',default='tmp/bvh-kernel-benchmark.json');a=p.parse_args()
async def main():
 async with async_playwright() as pw:
  b=await pw.chromium.launch(channel='msedge',headless=True,args=['--enable-unsafe-webgpu'])
  page=await b.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto('http://127.0.0.1:4196/__bvh-bench');await page.wait_for_function('!!window.runBvhCase')
  report={'environment':await page.evaluate('({ua:navigator.userAgent,cores:navigator.hardwareConcurrency})'),'cases':[]}
  for case in ['ganeung','shindonga','luceheim']:
   result=await page.evaluate('([c,r])=>window.runBvhCase(c,r)',[case,a.runs]);result['summary']={}
   for mode in ['grid','js1','wasm1','wasm2']:
    rows=[r for r in result['rows'] if r['mode']==mode]
    result['summary'][mode]={key:round(statistics.median(r[key] for r in rows),3) for key in ['buildMs','queryMs','paintMs','totalMs','workerMs']}
   report['cases'].append(result);Path(a.out).write_text(json.dumps(report,indent=2),encoding='utf8')
   print(json.dumps({key:result[key] for key in ['name','triangles','coldMs','summary','correctness']}),flush=True)
   assert not any(result['correctness'].values()),result['correctness']
  report['errors']=errors;assert not errors,errors
  Path(a.out).write_text(json.dumps(report,indent=2),encoding='utf8');await b.close()
asyncio.run(main())
