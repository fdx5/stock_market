import assert from 'node:assert/strict';
import {apartmentName,apartmentBlock,drawingLookupIdentity} from '../src/walkmode/apartmentIdentity';
import {complexOf} from '../src/walkmode/complexOf';
import {drawingSelection} from '../src/walkmode/drawingSelection';
import type {Drawing} from '../src/walkmode/interior/plan/imagePlan';
void(async()=>{
 const real='11680:수서동:708:삼익',pnu='1168011500107080000';
 for(const name of ['삼익 403동','삼익아파트403동','삼익 아파트 제 403 동','수서동 삼익 403동','삼익(403동)'])assert.equal(apartmentName(name,'수서동'),'삼익');
 assert.equal(apartmentName('목동'),'목동');assert.equal(apartmentName('삼익2단지403동'),'삼익2단지');assert.equal(apartmentName('403동'),'');
 assert.equal(apartmentBlock('삼익 403동'),'403동');
 assert.equal(drawingLookupIdentity('삼익403동','수서동','11680',37.488,127.1),drawingLookupIdentity('삼익404동','수서동','11680',37.489,127.102));
 assert.notEqual(drawingLookupIdentity('삼익','도곡동','11680',37.488,127.1),drawingLookupIdentity('삼익','수서동','11680',37.488,127.1));
 const original=globalThis.fetch;
 globalThis.fetch=async input=>{
  const url=new URL(String(input),'https://kospimap.com');assert.equal(url.searchParams.get('q'),'삼익');assert.equal(url.searchParams.get('dong'),'수서동');
  return new Response(JSON.stringify({items:[{id:'11680:도곡동:708:삼익',name:'삼익'},{id:real,name:'삼익',built:1992}]}));
 };
 try{assert.equal((await complexOf('삼익 403동',pnu,undefined,'수서동'))?.id,real);}finally{globalThis.fetch=original;}
 const plan=(typeId:string,area:number):Drawing=>({key:typeId,naverId:'668',typeId,typeName:typeId,exclusiveArea:area,supplyArea:area*1.3,variant:'기본형',imageId:typeId,imageUrl:'https://example.test/source.jpg',sourceUrl:'https://example.test'});
 const plans=[plan('68',49.2),plan('86',60),plan('115',84.48)];
 assert.equal(drawingSelection(plans,49.06,'').chosen?.typeId,'68','small registered/source area differences must not block source application');
 assert.equal(drawingSelection(plans,undefined,'').chosen?.typeId,'68','a found original must supply a default when units are unavailable');
 assert.equal(drawingSelection(plans,59.9,'').chosen?.typeId,'86');
 assert.equal(drawingSelection(plans,70,'').chosen,undefined,'different flat sizes must not silently switch types');
 assert.equal(drawingSelection([plan('A',60),plan('B',60)],60,'').chosen,undefined);
 assert.equal(drawingSelection([plan('A',60),plan('B',60)],60,'B').chosen?.typeId,'B');
 console.log('Apartment drawings: parent name, block separation, locality, shared catalogue, area rounding and explicit A/B selection PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
