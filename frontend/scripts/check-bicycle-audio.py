"""Render the bicycle graph offline: signal, distinct modes, silence and lifecycle.
Chrome is muted. Generates a reviewable WAV, without using stored app data.
"""
import argparse
import base64
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--base', default='http://127.0.0.1:5197')
parser.add_argument('--out', default='../tmp/walk-bicycle-audio')
args = parser.parse_args()
out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True, args=['--mute-audio'])
    page = browser.new_page()
    page.route('**/bicycle-audio-test', lambda route: route.fulfill(content_type='text/html', body='<title>Bicycle offline audio test</title>'))
    page.goto(args.base+'/bicycle-audio-test')
    result = page.evaluate('''async () => {
      const {BicycleAudio} = await import('/src/walkmode/game/BicycleAudio.ts');
      const modes = {stationary:{speed:0,pedal:1,brake:0},slowPedal:{speed:3,pedal:1,brake:0},fastPedal:{speed:15,pedal:1,brake:0},coast:{speed:15,pedal:0,brake:0},brake:{speed:15,pedal:0,brake:1},stopped:{speed:15,pedal:1,brake:0}};
      const report={}, recordings=[];
      for (const [name,state] of Object.entries(modes)) {
        const ctx=new OfflineAudioContext(1,72000,48000), output=ctx.createGain();output.gain.value=.8;output.connect(ctx.destination);
        const noise=ctx.createBuffer(1,96000,48000), raw=noise.getChannelData(0);let seed=1729;
        for(let i=0;i<raw.length;i++){seed=Math.imul(seed,1664525)+1013904223|0;raw[i]=(seed>>>0)/2147483648-1;}
        let allocated=0;const original=ctx.createBufferSource.bind(ctx);ctx.createBufferSource=()=>{allocated++;return original();};
        const bike=new BicycleAudio(ctx,output,noise);bike.update(state);
        const before=allocated;for(let i=0;i<300;i++)bike.update(state);
        if(allocated!==before)throw Error('Audio source leaked on update');
        let stopping;
        if(name==='stopped')stopping=ctx.suspend(.6).then(()=>{bike.stop();return ctx.resume();});
        const render=ctx.startRendering();if(stopping)await stopping;const samples=(await render).getChannelData(0);
        let energy=0,high=0,peak=0,tail=0;
        for(let i=14400;i<samples.length;i++){energy+=samples[i]**2;high+=(samples[i]-samples[i-1])**2;peak=Math.max(peak,Math.abs(samples[i]));if(i>57600)tail+=samples[i]**2;}
        report[name]={rms:Math.sqrt(energy/(samples.length-14400)),highFrequencyEnergy:Math.sqrt(high/(samples.length-14400)),peak,tailRms:Math.sqrt(tail/14399),bufferSources:allocated};
        recordings.push(samples.slice());bike.dispose();
      }
      if(report.stationary.rms!==0)throw Error('Stationary bicycle is audible');
      for(const name of ['slowPedal','fastPedal','coast','brake'])if(report[name].rms<.005||report[name].peak>.9)throw Error(name+' silent or clipping');
      if(report.fastPedal.rms<=report.slowPedal.rms)throw Error('Speed does not increase sound');
      if(report.stopped.tailRms>.0001)throw Error('Sound remains after stopping');
      if(Math.abs(report.coast.highFrequencyEnergy-report.fastPedal.highFrequencyEnergy)<.001)throw Error('Freewheel indistinguishable from pedal');
      const length=recordings.reduce((n,b)=>n+b.length,0), wav=new ArrayBuffer(44+length*2),view=new DataView(wav);let offset=0;
      const str=s=>{for(const c of s)view.setUint8(offset++,c.charCodeAt(0));};
      str('RIFF');view.setUint32(offset,36+length*2,true);offset+=4;str('WAVEfmt ');view.setUint32(offset,16,true);offset+=4;
      for(const n of [1,1]){view.setUint16(offset,n,true);offset+=2;}view.setUint32(offset,48000,true);offset+=4;view.setUint32(offset,96000,true);offset+=4;
      for(const n of [2,16]){view.setUint16(offset,n,true);offset+=2;}str('data');view.setUint32(offset,length*2,true);offset+=4;
      for(const b of recordings)for(const s of b){view.setInt16(offset,Math.max(-32768,Math.min(32767,s*32767)),true);offset+=2;}
      let bytes='';for(const n of new Uint8Array(wav))bytes+=String.fromCharCode(n);
      return {report,wav:btoa(bytes)};
    }''')
    (out/'bicycle-modes.wav').write_bytes(base64.b64decode(result.pop('wav')))
    (out/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result),flush=True)
    browser.close()
