"""Compile actual old/new interior snippets under WGSL derivative-uniformity errors."""
import asyncio,re,json,subprocess
from pathlib import Path
from playwright.async_api import async_playwright

FILE='frontend/src/components/tidewater/ComplexRenderer.js'
old=subprocess.check_output(['git','show','4e3b741:'+FILE]).decode('utf8')
new=Path(FILE).read_text(encoding='utf8')
def snippet(source,name):
 return re.search(r'(?:export )?const '+name+r' = /\* wgsl \*/`(.*?)`;',source,re.S).group(1)
def shader(source,hoisted):
 body=snippet(source,'INTERIOR_WGSL').replace('in.uv * REPEAT','puv * REPEAT').replace('REPEAT','mat.uvemissiveMap.xy').replace('OFFSET','mat.uvemissiveMap.zw').replace('GRID','mat.room.xy').replace('BAYW','mat.room.z').replace('STOREY','mat.room.w').replace('CEIL;','mat.roomCF.x;').replace('FLOOR;','mat.roomCF.y;')
 return '''diagnostic(error, derivative_uniformity);
const PI=3.14159265;const INV_PI=0.31830989;
fn skyHash(p:vec2f)->f32{return fract(sin(dot(p,vec2f(127.1,311.7)))*43758.5453);}
fn sat(v:f32)->f32{return clamp(v,0.0,1.0);}
struct Frame{cameraPos:vec3f,skyIrradiance:vec3f,sunColor:vec3f,sunDir:vec3f};
struct Mat{uvemissiveMap:vec4f,room:vec4f,roomCF:vec4f};
@group(0) @binding(0) var<uniform> frame:Frame;
@group(0) @binding(1) var<uniform> mat:Mat;
struct Input{P:vec3f,N:vec3f,uv:vec2f};
struct Surface{albedo:vec3f,emissive:vec3f,metalness:f32,roughness:f32,specularIntensity:f32};
@fragment fn main(@builtin(position) pos:vec4f)->@location(0) vec4f{
let in=Input(pos.xyz,vec3f(0,0,1),pos.xy/256.0);let puv=in.uv;
var s=Surface(vec3f(0.8),vec3f(0),0.0,0.8,1.0);
let roomOpen=select(0.0,1.0,pos.x>128.0);
''' +(snippet(source,'INTERIOR_DERIVATIVES_WGSL') if hoisted else '') +'if(roomOpen>0.02){'+body+'} return vec4f(s.albedo+s.emissive,1.0);}'

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(channel='msedge',headless=True,args=['--enable-unsafe-webgpu'])
  page=await browser.new_page();await page.goto('http://127.0.0.1:4195')
  results=await page.evaluate('''async(codes)=>{const d=await (await navigator.gpu.requestAdapter()).requestDevice();const out=[];for(const code of codes){const info=await d.createShaderModule({code}).getCompilationInfo();out.push(info.messages.map(m=>({type:m.type,message:m.message})));}d.destroy();return out;}''',[shader(old,False),shader(new,True)])
  assert any(m['type']=='error' and 'uniform' in m['message'] for m in results[0]),results
  assert not any(m['type']=='error' for m in results[1]),results
  Path('tmp/interior-wgsl-validation.json').write_text(json.dumps(results,indent=2),encoding='utf8')
  print(json.dumps({'beforeErrors':len([m for m in results[0] if m['type']=='error']),'afterErrors':len([m for m in results[1] if m['type']=='error'])}))
  await browser.close()
asyncio.run(main())
