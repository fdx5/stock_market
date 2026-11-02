import assert from 'node:assert/strict';
import {entryKind,resolveEntryKind} from '../src/walkmode/entryKind';
import {resolveWalkEntry,rememberWalkEntry,recalledWalkEntry,type WalkEntry} from '../src/walkmode/walkLink';
import {entryComplexId,apartmentName} from '../src/walkmode/apartmentIdentity';
void(async()=>{
 // a hospital's card: its building name in the dong field must not make it a block of flats
 assert.equal(entryKind({name:'삼성서울병원 신관',kind:'building',dong:'삼성서울병원 신관'}),'building');
 assert.equal(entryKind({name:'삼성서울병원',dong:'양성자센터'}),'building');
 assert.equal(entryKind({name:'래미안대치팰리스 101동',kind:'building',dong:'101동'}),'apartment','an apartment name still wins');
 for(const name of ['삼익','신동아','은마','수서1단지에스에이치빌']){
  assert.equal(entryKind({name,kind:'apartment'},{}),'apartment','sign classification survives a missing register');
  assert.equal(entryKind({name,use:'02000'},{}),'apartment','GIS housing code survives missing floor counts');
  assert.equal(entryKind({name},{use:'공동주택'}),'apartment');
 }
 assert.equal(entryKind({name:'삼익아파트403동'},{}),'apartment');
 assert.equal(entryKind({name:'건물',complexId:'11680:수서동:708:삼익'},{}),'apartment');
 assert.equal(entryComplexId('삼익403동','403동','11680:수서동:708:삼익'),'11680:수서동:708:삼익');
 assert.equal(entryComplexId('수서1단지 에스에이치빌 114','114','11680:일원동:711:수서1-2단지'),undefined,'same parcel does not authorize another complex/phase');
 assert.equal(apartmentName('수서1단지 에스에이치빌 114','','114동'),'수서1단지 에스에이치빌');
 assert.equal(entryKind({name:'삼익아파트 관리사무소'},{}),'building');
 assert.equal(entryKind({name:'삼익 상가'},{use:'근린생활시설'}),'building');
 assert.equal(entryKind({name:'',floors:0} as never,{}),'unknown','missing values do not authorize a general first floor');
 const original=globalThis.fetch;let lookups=0;
 globalThis.fetch=async()=>{lookups++;return new Response(JSON.stringify({items:[{id:'11680:수서동:708:삼익',name:'삼익',built:1992}]}));};
 try{
  const route=await resolveEntryKind({name:''},{},'1168011500107080000','수서동');
  assert.equal(route.kind,'apartment');assert.equal(route.complex?.name,'삼익');
  const before=lookups;assert.equal((await resolveEntryKind({name:'병원',kind:'building'},{use:'의료시설'},'1168011500107080000')).kind,'building');assert.equal(lookups,before);
 }finally{globalThis.fetch=original;}
 const ring:[number,number][]=[[127.1,37.488],[127.1002,37.488],[127.1002,37.4882],[127.1,37.4882]];
 const restored=resolveWalkEntry(37.4881,127.1001,[{id:'block',name:'삼익403동',pnu:'1168011500107080000',use:'02000',floors:0,ring}]);
 assert.equal(restored.use,'02000');assert.equal(restored.pnu,'1168011500107080000');
 const saved=new Map<string,string>();Object.assign(globalThis,{sessionStorage:{setItem:(k:string,v:string)=>saved.set(k,v),getItem:(k:string)=>saved.get(k)??null}});
 const entry:WalkEntry={...restored,kind:'apartment',complexId:'11680:수서동:708:삼익',dong:'403동'};
 rememberWalkEntry(entry);assert.deepEqual(recalledWalkEntry(entry.lat,entry.lon),entry);
 console.log('Entry routing: missing register, GIS housing, all apartment signs, cold links, metadata persistence, parcel recovery and facility separation PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
