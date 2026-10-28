"""Decode and render the actual vehicle recording banks; Chrome stays muted."""
import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:5197');p.add_argument('--out',default='../tmp/walk-car-recordings');args=p.parse_args();out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome',headless=True,args=['--mute-audio']);page=browser.new_page();page.route('**/car-audio-test',lambda r:r.fulfill(content_type='text/html',body='<title>Recorded car audio QA</title>'));page.goto(args.base+'/car-audio-test')
    result=page.evaluate('''async()=>{
      const {CarAudio,loadCarRecordings}=await import('/src/walkmode/game/CarAudio.ts');await loadCarRecordings();const results=[];
      for(const [engine,label,seed]of [['petrol','city-hatch',0],['petrol','sedan',0],['petrol','sedan-large',0],['sport','sport-coupe',1],['sport','sport-fastback',2],['diesel','van',0],['truck','cargo',0],['truck','container',0],['ev','electric-sedan',0]]){
        for(const mode of ['idle','accel','coast','brake']){
          const ctx=new OfflineAudioContext(1,96000,48000),output=ctx.createGain();output.gain.value=.8;output.connect(ctx.destination);let sources=0,oscillators=0;const create=ctx.createBufferSource.bind(ctx);ctx.createBufferSource=()=>{sources++;return create();};ctx.createOscillator=()=>{oscillators++;throw Error('Synthesized vehicle oscillator');};
          const audio=new CarAudio(ctx,output,ctx.createBuffer(1,1,48000),{engine,seed,spec:{label}});
          audio.update(mode==='idle'?.05:.7,mode==='accel'?1:0,mode==='idle'?0:20,mode==='brake',mode==='brake'?.8:0);
          for(let i=0;i<200;i++)audio.update(.7,1,20,false,0);
          const stopped=ctx.suspend(1).then(()=>{audio.stop();return ctx.resume();}),render=ctx.startRendering();await stopped;const b=(await render).getChannelData(0);let energy=0,peak=0,tail=0;
          for(let i=9600;i<43200;i++){energy+=b[i]*b[i];peak=Math.max(peak,Math.abs(b[i]));}for(let i=86400;i<b.length;i++)tail+=b[i]*b[i];
          const row={engine,label,bank:audio.bank,mode,rms:Math.sqrt(energy/33600),peak,tailRms:Math.sqrt(tail/9600),sources,oscillators};if((engine!=='ev'||mode!=='idle')&&row.rms<.002)throw Error('Silent '+JSON.stringify(row));if(peak>.98||row.tailRms>.0001||sources!==5)throw Error('Audio lifecycle/clipping '+JSON.stringify(row));results.push(row);audio.dispose();
        }
      }return {recordingBanks:[...new Set(results.map(r=>r.bank))],results};
    }''')
    (out/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps({'banks':result['recordingBanks'],'renderedModes':len(result['results']),'oscillators':sum(r['oscillators'] for r in result['results'])}),flush=True);browser.close()
