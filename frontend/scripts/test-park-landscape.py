"""Exercise the real canvas painter and parcel worker in Edge, without remote map calls."""
import asyncio, json, subprocess
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
BUNDLE=ROOT/'tmp'/'park-tests.js'
subprocess.run(['node','-e',"require('esbuild').buildSync({stdin:{contents:\"export {groundCanvasSteps,runNow} from './src/components/complexScene';export {farGround} from './src/components/farGround';\",resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'iife',globalName:'ParkTest',define:{'import.meta.env':'{}'},outfile:'tmp/park-tests.js'})"],cwd=ROOT,check=True)

async def main():
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(channel='msedge',headless=True)
  context=await browser.new_context()
  async def mock(route):
   lat,lon=37.5,127
   import math
   kx=math.cos(math.radians(lat))*111320;ky=110540
   def parcel(kind,ring):return {'properties':{'pnu':kind,'jibun':'test'+kind},'geometry':{'type':'Polygon','coordinates':[[[lon+x/kx,lat+y/ky]for x,y in ring]]}}
   features=[parcel('임',[[180,-220],[450,-220],[450,220],[180,220],[180,-220]]),parcel('천',[[-450,-180],[-240,-180],[-240,180],[-450,180],[-450,-180]])]
   await route.fulfill(status=200,content_type='application/javascript',body='farCb('+json.dumps({'response':{'result':{'featureCollection':{'features':features}}}})+');')
  await context.route('https://api.vworld.kr/**',mock)
  page=await context.new_page();await page.goto('http://127.0.0.1:4195/')
  await page.add_script_tag(path=str(BUNDLE))
  result=await page.evaluate('''async()=>{
   const box=(x,y,r)=>[[x-r,y-r],[x+r,y-r],[x+r,y+r],[x-r,y+r]];
   const data={site:[box(-140,0,40)],buildings:[{rings:[box(-140,0,8)]}],context:[{rings:[box(150,0,10)]}],roads:[{line:[[0,-300],[0,300]],width:12}],streets:[],parcels:[{kind:'임',ring:box(210,160,70)}]};
   const old=ParkTest.runNow(ParkTest.groundCanvasSteps(data,300,512,71));
   const green=ParkTest.runNow(ParkTest.groundCanvasSteps(data,300,512,71,true));
   const pixel=(paint,x,y)=>Array.from(paint.color.getContext('2d').getImageData(Math.floor((x+300)/600*512),Math.floor((300-y)/600*512),1,1).data);
   const at=pixel(green,95,-100),before=pixel(old,95,-100),road=pixel(green,0,-100);
   if(!(at[1]>at[0]*1.18&&at[1]>at[2]*1.18))throw Error('background stayed cement');
   if(Math.abs(road[1]-road[0])>15)throw Error('road turned into grass');
   if(!green.planting.trees.some(([x])=>x>60)||!green.planting.flowers.some(([x])=>x>60))throw Error('landscaping restricted to selected site');
   for(const [x,y]of [...green.planting.trees,...green.planting.shrubs,...green.planting.flowers,...green.planting.grass,...green.planting.woodlandFlowers.flatMap(b=>b.points)]){
    if(Math.abs(x)<8 || Math.abs(x-150)<11&&Math.abs(y)<11)throw Error('plants overlap roadway/building');
   }
   if(!green.planting.groves.length)throw Error('woodland not grouped');
   if(new Set(green.planting.woodlandFlowers.map(b=>b.species)).size<5)throw Error('near woodland flower diversity missing');
   const courtyardData={...data,site:[box(-140,0,60)],parcels:[...data.parcels,{kind:'차',ring:box(-110,25,10)}]};
   const courtyard=ParkTest.runNow(ParkTest.groundCanvasSteps(courtyardData,300,1024,71,true));
   let earthPixels=0;const c=courtyard.color.getContext('2d'),size=courtyard.color.width;
   for(let y=-45;y<=45;y+=2)for(let x=-185;x<=-95;x+=2){const p=c.getImageData(Math.floor((x+300)/600*size),Math.floor((300-y)/600*size),1,1).data;if(p[0]>p[1]*1.14&&p[1]>p[2]*1.2&&p[2]<115)earthPixels++;}
   if(earthPixels<30)throw Error('courtyard has no visible soil/flower beds');
   const parkPixel=c.getImageData(Math.floor((-110+300)/600*size),Math.floor((300-25)/600*size),1,1).data;
   if(parkPixel[1]>parkPixel[0]*1.18)throw Error('mapped parking overwritten by lawn');
   if(!courtyard.planting.border?.length)throw Error('courtyard flower walk missing');
   for(const[x,y]of [...courtyard.planting.trees,...courtyard.planting.shrubs,...courtyard.planting.flowers,...courtyard.planting.grass,...courtyard.planting.border]){
    if(Math.abs(x+110)<10&&Math.abs(y-25)<10)throw Error('plants occupy mapped courtyard parking');
   }
   const n=151,cell=4,R=300,grid={h:Float32Array.from({length:n*n},(_,k)=>(k%n*cell-R)*.13),n,cell,R};
   const unclassified={...data,parcels:[]};
   const hill=ParkTest.runNow(ParkTest.groundCanvasSteps(unclassified,300,512,71,true,grid));
   if(!hill.planting.groves.some(p=>p.points.some(([x,y])=>x>60&&Math.abs(y)<200)))throw Error('near hill without 임야 parcel has no grouped trees');
   const farHill=await ParkTest.farGround({...unclassified,center:{lat:37.5,lon:127},vworld_key:'test'}, {grid,at:()=>0,base:()=>0,relief:78,source:'fixture',elevation:100}, {half:300,size:512,lawn:'#508548',paddy:'#5f7d3c',landscape:true,nearHalf:100,footprints:[]});
   if(!farHill?.planting.groves.some(p=>p.points.some(([x,y])=>x>100&&x<170&&Math.abs(y)<100)))throw Error('far hill below +35m has no grouped trees');
   farHill.bitmap.close();
   const far=await ParkTest.farGround({...data,center:{lat:37.5,lon:127},vworld_key:'test'}, {at:()=>0,base:()=>0,relief:0,source:null,elevation:null}, {half:500,size:512,lawn:'#508548',paddy:'#5f7d3c',landscape:true,nearHalf:100,footprints:[box(300,0,35)]});
   if(!far?.planting.groves.length)throw Error('far woodland missing');
   for(const patch of far.planting.groves)for(const[x,y]of patch.points){if(x<0||Math.abs(x-300)<35&&Math.abs(y)<35)throw Error('far groves overlap water/building '+x+','+y);}
   for(const bed of far.planting.woodlandFlowers)for(const[x,y]of bed.points){if(x<0||Math.abs(x-300)<35&&Math.abs(y)<35)throw Error('woodland flowers overlap water/building');}
   if(new Set(far.planting.woodlandFlowers.map(b=>b.species)).size!==6)throw Error('far woodland flower diversity missing');
   const counts=Object.fromEntries(['trees','flowers','shrubs','grass','groves'].map(k=>[k,green.planting[k]?.length??0]));
   const farCounts={trees:far.planting.trees.length,groves:far.planting.groves.length,canopies:far.planting.groves.reduce((n,p)=>n+p.points.length,0),flowerBeds:far.planting.woodlandFlowers.length,flowerSpecies:[...new Set(far.planting.woodlandFlowers.map(b=>b.species))]};
   far.bitmap.close();return {before,after:at,road,counts,farCounts,courtyard:{earthPixels,flowerWalk: courtyard.planting.border.length,parking:Array.from(parkPixel)},unclassifiedHill:{nearGroves:hill.planting.groves.length,farGroves:farHill.planting.groves.length}};
  }''')
  print(json.dumps(result,ensure_ascii=False));await browser.close()

asyncio.run(main())
