"""Header layout, actual clock formatting, audio controls and visualizer fixtures."""
import datetime as dt, json, os
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

base=os.getenv('NEO_TEST_URL','http://127.0.0.1:5521')
out=Path(__file__).resolve().parents[2]/'qa'/('neo-header-'+dt.datetime.now().strftime('%Y%m%d-%H%M%S'));out.mkdir()
fake='''window.YT={Player:class {
 constructor(host,options){this.events=options.events;this.state=2;this.origin=performance.now();window.testPlayer=this;window.playerCount=(window.playerCount||0)+1;setTimeout(()=>this.events.onReady({target:this}),0)}
 emit(s){this.state=s;this.events.onStateChange({target:this,data:s})}
 playVideo(){if(this.state!==1)this.emit(1)} pauseVideo(){this.emit(2)}
 loadVideoById(id){this.id=id;this.origin=performance.now();this.playVideo()}
 getPlayerState(){return this.state} getCurrentTime(){return (performance.now()-this.origin)/1000}
 setVolume(){} destroy(){}
}};'''
report=[]
with sync_playwright() as p:
  for engine in ('chrome','webkit'):
    b=p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio']) if engine=='chrome' else p.webkit.launch(headless=True)
    c=b.new_context(viewport={'width':1440,'height':1000})
    c.add_init_script(fake+"localStorage.setItem('site_lang','en')")
    c.route('**/*',lambda r:r.fulfill(status=503,json={'detail':'Independent UI fixture'}) if urlsplit(r.request.url).path.startswith('/api/') else r.fulfill(body='') if 'youtube.com' in r.request.url else r.continue_())
    page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(base+'/');page.locator('.ng-header-clock').first.wait_for()
    for width in (360,390,430,768,1024,1440,1920):
      page.set_viewport_size({'width':width,'height':1000});page.wait_for_timeout(250)
      assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
      assert page.locator('.ng-header-clock:visible').count()==2
      assert page.locator('.ng-audio-toolbar .d2-bgm-play').is_visible()
      assert page.locator('.ng-audio-toolbar').bounding_box()['height']<=50
      for clock in page.locator('.ng-header-clock').all():
        box=clock.bounding_box();assert box['x']>=0 and box['x']+box['width']<=width+1
      page.screenshot(path=str(out/f'{engine}-{width}.png'))
    first=page.locator('.ng-header-clock time').first.inner_text();page.wait_for_timeout(1100)
    assert page.locator('.ng-header-clock time').first.inner_text()!=first
    player=page.locator('.ng-audio-toolbar .d2-bgm')
    title=player.locator('.d2-bgm-title')
    initial=title.get_attribute('title');player.get_by_role('button',name='Next track',exact=True).click();chosen=title.get_attribute('title');assert initial!=chosen
    player.get_by_role('button',name='Play',exact=True).click();page.wait_for_function("document.querySelector('.ng-audio-toolbar .is-playing:not(.is-loading)')")
    canvas=player.locator('.d2-bgm-eq canvas');page.wait_for_timeout(350);before=canvas.evaluate('c=>c.toDataURL()');page.wait_for_timeout(600);assert before!=canvas.evaluate('c=>c.toDataURL()')
    player.get_by_role('button',name='Next track',exact=True).click();assert title.get_attribute('title')!=chosen
    player.get_by_role('button',name='Previous track',exact=True).click();assert title.get_attribute('title')==chosen
    assert canvas.count()==1
    page.locator('.ng-region-title[href="/desk"]').click();page.locator('.ed-market-overview').wait_for()
    assert page.evaluate('window.playerCount')==1
    assert player.locator('.d2-bgm-title').get_attribute('title')==chosen
    player.get_by_role('button',name='Pause',exact=True).click();assert not player.evaluate("e=>e.classList.contains('is-playing')")
    player.get_by_role('button',name='Play',exact=True).click();page.emulate_media(reduced_motion='reduce');page.wait_for_timeout(500)
    before=canvas.evaluate('c=>c.toDataURL()');page.wait_for_timeout(500);assert before==canvas.evaluate('c=>c.toDataURL()')
    assert page.locator('.ng-header-clock time').first.evaluate('e=>getComputedStyle(e).color')=='rgb(239, 209, 107)'
    assert not errors,errors
    report.append({'engine':engine,'widths':7,'clock_ticks':True,'next_previous':True,'play_pause':True,'canvas_changes_while_playing':True,'single_player_across_routes':True,'reduced_motion':True,'errors':errors})
    c.close()
    for stamp,expected in [('2026-01-15T00:00:00Z',['09:00:00','19:00:00','EST']),('2026-07-15T00:00:00Z',['09:00:00','20:00:00','EDT'])]:
      c=b.new_context();milliseconds=int(dt.datetime.fromisoformat(stamp.replace('Z','+00:00')).timestamp()*1000)
      c.add_init_script('''const OriginalDate=Date;window.Date=class extends OriginalDate{constructor(...args){if(args.length)super(...args);else super(__TIME__)}static now(){return __TIME__}};'''.replace('__TIME__',str(milliseconds)))
      c.route('**/*',lambda r:r.fulfill(status=503,json={}) if urlsplit(r.request.url).path.startswith('/api/') else r.continue_())
      page=c.new_page();page.goto(base+'/');page.locator('.ng-header-clock').first.wait_for()
      clocks=page.locator('.ng-header-clocks').inner_text()
      assert all(x in clocks for x in expected),clocks
      assert '01.14' in clocks if '01-' in stamp else '07.14' in clocks
      c.close()
    b.close()
(out/'result.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps({'checks':report,'output':str(out)}))
