import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const source = readFileSync(new URL('../src/components/palaceGardens.ts', import.meta.url), 'utf8');
const module = { exports: {} };
vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, { module, exports: module.exports });
const { palaceGardens, palaceParcelGarden, palaceGardenCover, paintPalaceGarden } = module.exports;
const square = (x, y, h) => [[x-h,y-h],[x+h,y-h],[x+h,y+h],[x-h,y+h]];

test('garden treatment selects the requested palace heritage parcel, excluding other palaces, roads and holes', () => {
  const gardens = palaceGardens(37.5787,126.9948,170);
  const target = palaceParcelGarden('사',[square(0,0,160)],gardens);
  assert.equal(target.id,'changgyeonggung');
  assert.equal(palaceParcelGarden('도',[square(0,0,160)],gardens),null);
  assert.equal(palaceParcelGarden('공',[square(0,0,160)],gardens),null);
  assert.equal(palaceParcelGarden('사',[square(0,0,160),square(0,0,10)],gardens),null);
  assert.equal(palaceParcelGarden('사',[square(-400,100,100)],gardens),null);
  assert.equal(palaceGardens(35.1457,129.1283,170).length,0);
});

test('each palace keeps earth, lawn and flowers, and the central courtyard axis remains earth', () => {
  for (const [lat,lon] of [[37.5796,126.9770],[37.5787,126.9948],[37.5658,126.9751]]) {
    const g=palaceGardens(lat,lon,170).find(g=>Math.abs(g.x)<1 && Math.abs(g.y)<1);
    g.rings=[square(0,0,160)];
    const counts=[0,0,0];
    for(let y=-160;y<160;y+=2)for(let x=-160;x<160;x+=2){const cover=palaceGardenCover(g,x,y);counts[cover===0?0:cover===1?1:2]++;}
    const total=counts.reduce((a,b)=>a+b,0);
    assert.ok(counts[0]/total>.25 && counts[0]/total<.8,'keep substantial connected earth courts');
    assert.ok(counts[1]/total>.2 && counts[1]/total<.7,'visible lawn pockets');
    assert.ok(counts[2]/total>.005 && counts[2]/total<.12,'flowers accent the lawns');
    for(let y=-200;y<=200;y+=5)assert.equal(palaceGardenCover(g,0,y),0);
  }
});

test('garden layout stays fixed when the origin and tile latitude change', () => {
  const lat=37.5796,lon=126.9770;
  const a=palaceGardens(lat,lon,170).find(g=>g.id==='gyeongbokgung');
  const tileLat=lat+340/110540,tileLon=lon+340/(Math.cos(lat*Math.PI/180)*111320);
  const b=palaceGardens(tileLat,tileLon,170).find(g=>g.id===a.id);
  a.rings=b.rings=[square(0,90,280)];
  for(let y=-180;y<400;y+=7)for(let x=-220;x<220;x+=7){
    assert.equal(palaceGardenCover(a,x,y),palaceGardenCover(b,b.x+x/b.scaleX,b.y+y));
  }
});

test('lawns and flowers stay on the compound perimeter, leaving all interior courts as earth', () => {
  for(const [lat,lon] of [[37.5796,126.9770],[37.5787,126.9948],[37.5658,126.9751]]){
    const g=palaceGardens(lat,lon,170).find(g=>Math.abs(g.x)<1 && Math.abs(g.y)<1);g.rings=[square(0,0,160)];
    for(let y=-120;y<=120;y+=8)for(let x=-120;x<=120;x+=8)assert.equal(palaceGardenCover(g,x,y),0);
    assert.equal(palaceGardenCover(g,155,0),1);
    assert.ok(palaceGardenCover(g,160-g.rimWidth+3,0)>1);
  }
});

test('painted gardens and 3D plants respect water, road and building exclusions', () => {
  const size=120,half=170,area=size*size*4;
  const data=new Uint8ClampedArray(area),mask=new Uint8ClampedArray(area),blocked=new Uint8ClampedArray(area);
  for(let i=0;i<area;i+=4){data.set([159,152,136,255],i);mask[i+3]=255;if(i%(size*4)<24*4)blocked[i+3]=255;}
  // A pond across the upper quarter, inside the heritage parcel.
  for(let i=0;i<area/4;i+=4)data.set([31,61,73,128],i);
  const before=data.slice(),ctx={getImageData:()=>({data}),putImageData:()=>{}};
  const g=palaceGardens(37.5658,126.9751,half).find(g=>g.id==='deoksugung');
  g.rings=[square(0,0,160)];
  const result=paintPalaceGarden(ctx,mask,g,size,half,blocked,0,palaceGardenCover);
  assert.ok(result.earthM2>0 && result.lawnM2>0 && result.flowerM2>0);
  assert.ok(result.grass.length>0 && result.beds.some(b=>b.points.length));
  for(let i=0;i<area;i+=4)if(before[i+3]<200 || blocked[i+3])assert.deepEqual(data.slice(i,i+4),before.slice(i,i+4));
  for(const [x,y] of [...result.grass,...result.beds.flatMap(b=>b.points)]){
    const px=Math.floor((x+half)/(2*half)*size),py=Math.floor((half-y)/(2*half)*size),o=(py*size+px)*4;
    assert.ok(!blocked[o+3] && before[o+3]>200);
  }
});
