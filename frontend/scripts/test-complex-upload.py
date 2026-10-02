"""Verify bounded bitmap uploads and channel packing against the original GPU path."""
import argparse, atexit, json
from pathlib import Path
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://127.0.0.1:39410')
opts = ap.parse_args()
root = Path(__file__).resolve().parents[2]
files = [root/'frontend/__uploadqa.html', root/'frontend/src/__uploadqa.ts']
assert not any(p.exists() for p in files)
atexit.register(lambda: [p.unlink(missing_ok=True) for p in files])
files[0].write_text('<html><script type="module" src="/src/__uploadqa.ts"></script></html>', encoding='utf-8')
files[1].write_text('''
import {GPU} from './vendor/tidewater/engine/gpu/GPU.js';
import {Texture} from './vendor/tidewater/engine/gpu/Texture.js';
import {ComplexRenderer} from './components/tidewater/ComplexRenderer.js';
import {packInto,warmPack} from './components/tidewater/texturePack.js';
(window as any).check=async()=>{
 await GPU.init({headless:true});GPU.device.pushErrorScope('validation');
 const read=async(t:any)=>{const row=t.width*4,buf=GPU.device.createBuffer({size:row*t.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  GPU.getEncoder().copyTextureToBuffer({texture:t.getGPU()},{buffer:buf,bytesPerRow:row},[t.width,t.height]);GPU.submit();
  await buf.mapAsync(GPUMapMode.READ);const bytes=new Uint8Array(buf.getMappedRange()).slice();buf.unmap();buf.destroy();return bytes;};
 const make=(w:number,h:number,seed:number)=>{const c=new OffscreenCanvas(w,h),ctx=c.getContext('2d')!,d=ctx.createImageData(w,h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;d.data[i]=(x*7+y*3+seed)%256;d.data[i+1]=(y*11+seed)%256;d.data[i+2]=(x+y*5+seed)%256;d.data[i+3]=255;}ctx.putImageData(d,0,0);return c.transferToImageBitmap();};
 const reports=[];await warmPack('rgba8unorm','vec4f(A.x, A.y, B.y, B.z)',2);
 for(const flipY of [false,true])for(const [w,h] of [[512,1536],[1024,768]]){
  const r:any=Object.create(ComplexRenderer.prototype);r.shown=true;r.frameNo=0;
  const bitmap=make(w,h,17),other=make(w,h,93),source={image:bitmap,flipY,version:1},second={image:other,flipY,version:1};
  const tex=(format='rgba8unorm')=>new Texture({width:w,height:h,format,mips:true,usage:['sample','render','copySrc','copyDst']});
  const direct=tex('rgba8unorm-srgb'),bounded=tex('rgba8unorm-srgb');
  GPU.queue.copyExternalImageToTexture({source:bitmap,flipY},{texture:direct.getGPU()},[w,h]);
  let frames=0;while(true){r.frameNo++;frames++;const a=r.staged(source),b=r.staged(second);GPU.submit();if(a&&b)break;if(frames>100)throw Error('upload never completes');}
  r.fromStaged(source,r.stagings.get(source).tex,bounded);
  const a=await read(direct),b=await read(bounded);let max=0;for(let i=0;i<a.length;i++)max=Math.max(max,Math.abs(a[i]-b[i]));
  const original=tex(),packed=tex();
  packInto(original,[{img:bitmap,flipY},{img:other,flipY}],'vec4f(A.x, A.y, B.y, B.z)');
  // Re-stage the first source after its colour copy consumed the temporary.
  while(true){r.frameNo++;if(r.staged(source))break;GPU.submit();}
  packInto(packed,[r.packSource(source),r.packSource(second)],'vec4f(A.x, A.y, B.y, B.z)');r.dropStaging(source);r.dropStaging(second);
  const x=await read(original),y=await read(packed);let packedMax=0;for(let i=0;i<x.length;i++)packedMax=Math.max(packedMax,Math.abs(x[i]-y[i]));
  if(max||packedMax)throw Error('GPU pixels changed '+JSON.stringify({flipY,w,h,max,packedMax}));
  reports.push({flipY,w,h,frames,max,packedMax});[direct,bounded,original,packed].forEach(t=>t.destroy());bitmap.close();other.close();
 }
 GPU.submit();await GPU.queue.onSubmittedWorkDone();const error=await GPU.device.popErrorScope();if(error)throw Error(error.message);return reports;
};
''', encoding='utf-8')
with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True, args=['--enable-unsafe-webgpu'])
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(opts.base+'/__uploadqa.html')
    page.wait_for_function("typeof window.check==='function'")
    report = page.evaluate('check()')
    browser.close()
assert not errors, errors
(root/'tmp/complex-upload-quality.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
