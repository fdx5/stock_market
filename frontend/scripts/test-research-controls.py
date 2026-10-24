"""Measure actual label/control/button and icon alignment across research pages."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[2]
BASE = 'http://127.0.0.1:5184'
OUT = ROOT / 'tmp/research-controls-qa'
OUT.mkdir(parents=True,exist_ok=True)
fixture={'__file__':str(Path(__file__).with_name('test-all-research-services.py'))}
exec(Path(__file__).with_name('test-all-research-services.py').read_text(encoding='utf-8').split('with sync_playwright() as pw:')[0],fixture)
MEASURE = r"""() => {
  const rect = el => { const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}; };
  const issues=[];
  document.querySelectorAll('.rs-symbol-input').forEach(el=>{
    const icon=rect(el.querySelector('span')),input=rect(el.querySelector('input'));
    if(icon.right>input.x+.6) issues.push({issue:'icon overlaps input',icon,input});
  });
  document.querySelectorAll('.ng-research :is(.rs-context,.rs-control-grid,.mdis-recovery-controls,.mdis-filters)').forEach((group,index)=>{
    const fields=[...group.children].filter(el=>el.matches('.rs-field,label')).map(el=>{
      const control=el.querySelector('.rs-symbol-input') ?? el.querySelector('input:not([type=checkbox]),select');
      return control ? {field:rect(el),control:rect(control),label:el.textContent.slice(0,45)}:null;
    }).filter(Boolean);
    fields.forEach((a,i)=>{
      if(Math.abs(a.control.h-44)>1) issues.push({issue:'control height',group:index,field:a});
      fields.slice(i+1).filter(b=>Math.abs(a.field.y-b.field.y)<1).forEach(b=>{
        if(Math.abs(a.control.y-b.control.y)>1) issues.push({issue:'control row misaligned',group:index,a,b});
      });
    });
    [...group.children].filter(el=>el.matches('button,a')).forEach(el=>{
      const button=rect(el);
      if(Math.abs(button.h-44)>1)issues.push({issue:'button height',group:index,button});
      const row=fields.filter(f=>Math.abs(f.control.y-button.y)<44);
      if(row.length && row.every(f=>Math.abs(f.control.y-button.y)>1)) issues.push({issue:'button row misaligned',group:index,button,row});
    });
  });
  if(document.documentElement.scrollWidth>innerWidth) issues.push({issue:'page overflow'});
  return issues;
}"""
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,args=['--mute-audio'])
    context=browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce')
    def route(r):
        if not r.request.url.startswith(BASE):r.abort();return
        if r.request.url.startswith(BASE+'/api/'):r.fulfill(content_type='application/json',body=json.dumps(fixture['payload'](r.request.url),ensure_ascii=False))
        else:r.continue_()
    context.route('**/*',route)
    page=context.new_page();checks=[];issues=[];errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    for width in [1440,1024,390,360]:
        page.set_viewport_size({'width':width,'height':1000 if width>600 else 844})
        for service in fixture['SERVICES']:
            page.goto(BASE+service['path'],wait_until='domcontentloaded')
            expect(page.locator('.ng-research h1')).to_contain_text(service['name'],timeout=20000)
            page.wait_for_timeout(60)
            result=page.evaluate(MEASURE)
            if result:issues.append({'width':width,'path':service['path'],'issues':result})
            checks.append({'width':width,'path':service['path']})
            if service['path'] in ['/currency-lens','/etf-overlap'] and width in [1440,390]:
                page.locator('main').evaluate('el=>el.scrollIntoView()')
                page.screenshot(path=str(OUT/f'{service["path"].strip("/")}-{width}.png'),full_page=False)
    # The exact same amount must carry the correct source/local row unit.
    for region,code,currency,suffix in [('KR','069500','KRW','원 (KRW)'),('US','VOO','USD','달러 (USD)')]:
        page.goto(BASE+f'/dividend-reality?region={region}&code={code}')
        expect(page.locator('.rs-table tbody')).to_contain_text(suffix)
        checks.append({'currency':currency})
    page.goto(BASE+'/dividend-reality')
    page.locator('input[type=file]').set_input_files({'name':'dividends.csv','mimeType':'text/csv','buffer':b'ex_date,payment_date,amount,currency\n2026-01-01,2026-01-03,183,KRW\n2026-02-01,2026-02-03,1.823,USD\n'})
    expect(page.locator('.rs-table tbody')).to_contain_text('183원 (KRW)')
    expect(page.locator('.rs-table tbody')).to_contain_text('1.823달러 (USD)')
    checks.append({'local_csv':'per-row currencies'})
    (OUT/'result.json').write_text(json.dumps({'checks':len(checks),'issues':issues,'javascript_errors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'checks':len(checks),'issues':len(issues),'javascript_errors':errors}))
    assert not issues,issues
    assert not errors,errors
    browser.close()
