"""Bake exact GPU-packed normal/roughness maps; verify palette/seed independence."""
import argparse, atexit, base64, gzip, hashlib, json, os
from pathlib import Path
from playwright.sync_api import sync_playwright

p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:5192');p.add_argument('--verify',action='store_true');a=p.parse_args()
root=Path(__file__).resolve().parents[2]
files=[root/f'frontend/__surfaceqa_{os.getpid()}.html',root/f'frontend/src/__surfaceqa_{os.getpid()}.ts']
assert not any(f.exists() for f in files)
atexit.register(lambda:[f.unlink(missing_ok=True) for f in files])
files[0].write_text(f'<html><script type="module" src="/src/{files[1].name}"></script></html>',encoding='utf8')
files[1].write_text('''
import {GPU} from './vendor/tidewater/engine/gpu/GPU.js';
import {Texture} from './vendor/tidewater/engine/gpu/Texture.js';
import {packInto,warmPack} from './components/tidewater/texturePack.js';
import {warmMipmaps} from './vendor/tidewater/engine/gpu/Mipmaps.js';
import {paletteFor} from './components/complexScene';
const worker=new Worker(new URL('./components/paintRasterWorker.ts',import.meta.url),{type:'module'});
let id=0;
const raster=(job:any)=>new Promise<any>((resolve,reject)=>{worker.onerror=e=>reject(Error(e.message));worker.onmessage=e=>resolve(e.data);worker.postMessage({id:++id,job})});
(window as any).check=async()=>{
 console.log('surface-device');await GPU.init({headless:true});GPU.device.pushErrorScope('validation');await warmPack('rgba8unorm','vec4f(A.x, A.y, B.y, B.z)',2);await warmMipmaps(['rgba8unorm']);console.log('surface-device-ready');
 const read=async(tex:any)=>{
  const row=tex.width*4,b=GPU.device.createBuffer({size:row*tex.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  GPU.getEncoder().copyTextureToBuffer({texture:tex.getGPU()},{buffer:b,bytesPerRow:row},[tex.width,tex.height]);GPU.submit();
  await b.mapAsync(GPUMapMode.READ);const bytes=new Uint8Array(b.getMappedRange()).slice();b.unmap();b.destroy();
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);
 };
 const reports=[];
 for(const scale of [1,2])for(const [brand,seed] of [['래미안',123],['자이',991]] as [string,number][]){
  console.log('surface-start',scale,seed);
  const reply=await raster({kind:'facade',palette:paletteFor(brand),seed,scale});if(!reply.bitmaps)throw Error('raster failed');
  const n=reply.bitmaps.normalMap,r=reply.bitmaps.rmMap;
  const tex=new Texture({width:n.width,height:n.height,format:'rgba8unorm',mips:true,usage:['sample','render','copySrc','copyDst']});
  packInto(tex,[{img:n,flipY:reply.params.normalMap.flipY},{img:r,flipY:reply.params.rmMap.flipY}],'vec4f(A.x, A.y, B.y, B.z)');
  reports.push({key:'facade-'+scale,width:n.width,height:n.height,data:await read(tex)});
  console.log('surface-read',scale,seed);
  tex.destroy();Object.values(reply.bitmaps).forEach((b:any)=>b.close());
 }
 for(const [tone,seed] of [['#8d8a84',13],['#3c3f45',731]] as [string,number][]){
  const reply=await raster({kind:'plinth',tone,seed});if(!reply.bitmaps)throw Error('raster failed');
  const n=reply.bitmaps.normalMap,r=reply.bitmaps.rmMap;
  const tex=new Texture({width:n.width,height:n.height,format:'rgba8unorm',mips:true,usage:['sample','render','copySrc','copyDst']});
  packInto(tex,[{img:n,flipY:reply.params.normalMap.flipY},{img:r,flipY:reply.params.rmMap.flipY}],'vec4f(A.x, A.y, B.y, B.z)');
  reports.push({key:'plinth',width:n.width,height:n.height,data:await read(tex)});
  tex.destroy();Object.values(reply.bitmaps).forEach((b:any)=>b.close());
 }
 worker.terminate();const error=await GPU.device.popErrorScope();if(error)throw error;
 return {version:import.meta.env.VITE_PAINT_ASSETS,reports};
};
''',encoding='utf8')
with sync_playwright() as pw:
 browser=pw.chromium.launch(channel='msedge',headless=True,args=['--enable-unsafe-webgpu']);page=browser.new_page();errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('console',lambda m:print(m.type,m.text,flush=True))
 page.goto(a.base+'/'+files[0].name);page.wait_for_function("typeof window.check === 'function'");result=page.evaluate('Promise.race([check(),new Promise((_,reject)=>setTimeout(()=>reject(Error("Surface bake timed out")),90000))])');browser.close()
 assert not errors,errors
 assert result['version'],'Prepared paint assets disabled'
 destination=root/'frontend/public/3d/surface'/result['version'];destination.mkdir(parents=True,exist_ok=True)
 manifest={}
 for r in result['reports']:
  raw=base64.b64decode(r.pop('data'));key=r.pop('key');digest=hashlib.sha256(raw).hexdigest()
  entry={**r,'file':digest[:20]+'.rgba.gz','sha256':digest}
  if key in manifest: assert manifest[key]==entry,('palette/seed changes packed pixels',key)
  elif a.verify:
   expected=json.loads((destination/'manifest.json').read_text())[key];assert expected==entry,(key,entry,expected)
   assert gzip.decompress((destination/entry['file']).read_bytes())==raw,key
  else:(destination/entry['file']).write_bytes(gzip.compress(raw,compresslevel=9,mtime=0))
  manifest[key]=entry
 if not a.verify:(destination/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')
 print(json.dumps({'version':result['version'],'maps':manifest,'compressedBytes':sum((destination/e['file']).stat().st_size for e in manifest.values()),'verified':a.verify}),flush=True)
