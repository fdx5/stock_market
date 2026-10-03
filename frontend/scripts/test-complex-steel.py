"""Require original pixels, sampling and actual GPU texels for the prepared steel map."""
import argparse,atexit,json
from pathlib import Path
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:39415');a=p.parse_args()
root=Path(__file__).resolve().parents[2];front=root/'frontend'
paths=[front/'src/__steelqa.ts',front/'__steelqa.html'];assert not any(x.exists() for x in paths)
atexit.register(lambda:[x.unlink(missing_ok=True) for x in paths])
paths[1].write_text('<script type="module" src="/src/__steelqa.ts"></script>',encoding='utf8')
paths[0].write_text('''
import {heroSurface} from './components/heroVehicles';import {preparedSteel} from './components/preparedSteel';
import {GPU} from './vendor/tidewater/engine/gpu/GPU';import {Texture} from './vendor/tidewater/engine/gpu/Texture';
import {ComplexRenderer} from './components/tidewater/ComplexRenderer';
import {warmPack,packInto} from './components/tidewater/texturePack';
(window as any).check=async()=>{
 const oldMat=heroSurface('cyber'),old=oldMat.roughnessMap!,next=await preparedSteel();if(!next)throw Error('Prepared steel unavailable');
 for(const key of ['wrapS','wrapT','anisotropy','colorSpace','minFilter','magFilter','generateMipmaps'])if(old[key as keyof typeof old]!==next[key as keyof typeof next])throw Error('Sampling changed '+key);
 for(const key of ['repeat','offset'])if(!old[key as 'repeat'].equals(next[key as 'repeat']))throw Error('UV changed '+key);
 if(next.flipY||next.image.width!==old.image.width||next.image.height!==old.image.height)throw Error('Bitmap orientation or dimensions changed');
 const c=document.createElement('canvas');c.width=c.height=512;const g=c.getContext('2d')!;g.translate(0,512);g.scale(1,-1);g.drawImage(next.image,0,0);
 const x=old.image.getContext('2d').getImageData(0,0,512,512).data,y=g.getImageData(0,0,512,512).data;
 let pixelMax=0;for(let i=0;i<x.length;i++)pixelMax=Math.max(pixelMax,Math.abs(x[i]-y[i]));
 await GPU.init({headless:true});GPU.device.pushErrorScope('validation');
 const reference=new Texture({width:512,height:512,format:'rgba8unorm',usage:['copyDst','copySrc','sample','render']});
 GPU.queue.copyExternalImageToTexture({source:old.image,flipY:old.flipY},{texture:reference.getGPU()},[512,512]);
 await warmPack('r8unorm','vec4f(A.y, 0.0, 0.0, 1.0)',1);
 await warmPack('rgba8unorm','vec4f(A.x, A.x, A.x, 1.0)',1);
 const renderer=Object.create(ComplexRenderer.prototype);renderer.frameNo=1;renderer.shown=false;renderer.textures=new Map();
 const actual=renderer.staged(next);if(!actual)throw Error('Staged upload incomplete');
 const read=async(t:any)=>{const b=GPU.device.createBuffer({size:512*512*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 GPU.getEncoder().copyTextureToBuffer({texture:t.getGPU()},{buffer:b,bytesPerRow:2048},[512,512]);GPU.submit();await b.mapAsync(GPUMapMode.READ);
 const bytes=new Uint8Array(b.getMappedRange()).slice();b.unmap();b.destroy();return bytes};
 const before=await read(reference),after=await read(actual);let gpuMax=0;for(let i=0;i<before.length;i++)gpuMax=Math.max(gpuMax,Math.abs(before[i]-after[i]));
 const channel=renderer.singleChannel(next),other=Object.create(ComplexRenderer.prototype);other.textures=new Map();
 if(other.singleChannel(next)!==channel||channel.repack)throw Error('Immutable channel not shared safely');
 renderer.pool().releaseOwner(renderer);if(!other.pool().has(channel))throw Error('First owner released active texture');
 const sampled=new Texture({width:512,height:512,format:'rgba8unorm',usage:['copySrc','sample','render']});
 packInto(sampled,[{texture:channel.getGPU()}],'vec4f(A.x, A.x, A.x, 1.0)');
 const channelBytes=await read(sampled);let channelMax=0;for(let i=0;i<before.length;i+=4)channelMax=Math.max(channelMax,Math.abs(before[i+1]-channelBytes[i]));
 other.pool().releaseOwner(other);if(other.pool().has(channel))throw Error('Last owner retained GPU allocation');sampled.destroy();
 const error=await GPU.device.popErrorScope();if(error)throw Error(error.message);
 reference.destroy();actual.destroy();old.dispose();oldMat.dispose();const image=next.image;next.dispose();
 if(image.width!==0)throw Error('Disposed texture retained bitmap');
 return {pixelMax,gpuMax,channelMax,sharedChannel:true,lastOwnerReleased:true,bitmapReleased:true};
};(window as any).fallback=async()=>{const t=await preparedSteel();t?.dispose();return t===null};
''',encoding='utf8')
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=True,args=['--enable-unsafe-webgpu']);page=b.new_page();errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)));page.goto(a.base+'/__steelqa.html');page.wait_for_function('typeof check === "function"')
 result=page.evaluate('check()');page.route('**/3d/steel/*.png',lambda r:r.fulfill(status=503,body='unavailable'))
 result['missingAssetFallback']=page.evaluate('fallback()');b.close()
print(json.dumps(result));assert not errors,errors;assert result['pixelMax']==result['gpuMax']==result['channelMax']==0 and result['missingAssetFallback'],result
(root/'tmp').mkdir(exist_ok=True);(root/'tmp/steel-quality.json').write_text(json.dumps(result,indent=2),encoding='utf8')
