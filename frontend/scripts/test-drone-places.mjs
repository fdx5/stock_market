import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
const scope={module:{exports:{}},exports:{}};
vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/dronePlaces.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code,scope);
const {normalizePlace,mergePlaces,placeSources,readDronePlace,placeDisplayTitle}=scope.module.exports;
test('similar apartment names display their real dong, eup or myeon with one space',()=>{
 for(const locality of ['망미동','내곡동','진접읍','청운면']){
  const p={title:'강남데시앙',kind:'아파트',parcel:`서울특별시 지역 ${locality} 209-4`,address:'도로명주소 20'};
  assert.equal(placeDisplayTitle(p),`${locality} 강남데시앙`);
  assert.equal(placeDisplayTitle({...p,title:locality+'강남데시앙'}),`${locality} 강남데시앙`);
 }
 assert.equal(placeDisplayTitle({title:'강남데시앙',kind:'아파트',parcel:'',address:''}),'강남데시앙');
});
test('a real address response carries the provider coordinates without address re-geocoding',()=>{
 const p=normalizePlace({id:'lot',address:{road:'부산광역시 해운대구 마린시티2로 33',parcel:'부산광역시 해운대구 우동 1407',bldnm:'해운대 두산위브더제니스'},point:{x:'129.1482',y:'35.1567'}},{type:'ADDRESS',kind:'도로명주소'});
 assert.equal(p.title,'해운대 두산위브더제니스');assert.equal(p.lon,129.1482);assert.equal(p.lat,35.1567);assert.equal(p.kind,'도로명주소');
});
test('school results do not mislabel libraries and school bus stops',()=>{
 const source={type:'PLACE',kind:'장소'},item={category:'교육',point:{x:129.1,y:35.1}};
 assert.equal(normalizePlace({...item,title:'망미초등학교'},source).kind,'학교');
 assert.equal(normalizePlace({...item,title:'수영구도서관'},source).kind,'장소');
 assert.equal(normalizePlace({...item,title:'망미초등학교(버스정류장)'},source).kind,'장소');
});
test('coordinate validation refuses missing, malformed and projected coordinates',()=>{
 for(const point of [undefined,{x:NaN,y:35},{x:129,y:0},{x:14000000,y:4300000}])assert.equal(normalizePlace({title:'invalid',point},{type:'PLACE',kind:'장소'}),null);
 assert.equal(readDronePlace(new URLSearchParams('place=wrong')),undefined);
 assert.equal(readDronePlace(new URLSearchParams('lat=35&lon=Infinity')),undefined);
});
test('duplicate entrance/address results collapse, while same names in different addresses remain',()=>{
 const base={id:'a',title:'망미초등학교',address:'부산광역시 수영구 수미로35번길 27',parcel:'',kind:'학교',lat:35.16,lon:129.1};
 const result=mergePlaces([base,{...base,id:'b',kind:'도로명주소',address:base.address+' (망미동)',lat:35.1602},{...base,id:'c',address:'다른 지역 주소'}],'망미초등학교');
 assert.equal(result.length,2);assert.equal(result[0].id,'a');
});
test('district centre wins over a similarly named facility for a district query',()=>{
 const base={id:'a',title:'수영구청',address:'부산광역시 수영구',parcel:'',kind:'장소',lat:35.16,lon:129.1};
 assert.equal(mergePlaces([base,{...base,id:'b',title:'부산광역시 수영구',kind:'지역'}],'수영구')[0].id,'b');
 const sources=placeSources('부산광역시 수영구 망미동 209-4');
 assert.equal(sources[0].type,'ADDRESS');assert.ok(sources.some(s=>s.category==='PARCEL'));assert.ok(sources.some(s=>s.category==='ROAD'));
});
test('the named complex precedes entrances, libraries and estate offices without hiding them',()=>{
 const base={id:'main',title:'강남데시앙파크',address:'서울특별시 강남구 헌릉로590길 63',parcel:'서울특별시 강남구 세곡동 523',kind:'장소',lat:37.46,lon:127.1};
 const facilities=['입구','작은도서관','공인중개사사무소'].map((suffix,i)=>({...base,id:String(i),title:base.title+suffix}));
 assert.equal(mergePlaces([...facilities,base],'강남데시앙')[0].id,'main');
 assert.equal(mergePlaces([...facilities,base],facilities[0].title)[0].id,'0');
 assert.equal(mergePlaces([...facilities,base],'강남데시앙').length,4);
});
