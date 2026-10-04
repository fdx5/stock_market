/** A stable, spatially mixed autumn palette. Existing foliage textures carry the
 * detail; vertex tints add colour without another texture, material or draw. */
export const FOLIAGE_TONES = [
  {name:'green',share:69.2,tint:[1,1,1]},
  {name:'gold',share:12.6,tint:[1.9,1.25,.38]},
  {name:'orange',share:8.4,tint:[2.6,.92,.32]},
  {name:'red',share:7,tint:[3.1,.5,.36]},
  {name:'bronze',share:2.8,tint:[1.8,.76,.38]},
] as const;
export function treeFoliageTone(x:number,y:number){
 let h=Math.imul(Math.floor(x/9),73856093)^Math.imul(Math.floor(y/9),19349663)^0x9e3779b9;
 h=Math.imul(h^(h>>>16),0x45d9f3b);h=Math.imul(h^(h>>>16),0x45d9f3b);h^=h>>>16;
 let bucket=(h>>>0)/4294967296*100;
 return FOLIAGE_TONES.find(t=>(bucket-=t.share)<0)??FOLIAGE_TONES[0];
}
