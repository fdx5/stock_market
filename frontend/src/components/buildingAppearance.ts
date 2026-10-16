import * as THREE from 'three';

export type AppearanceInput={id?:string;title?:string|null;name?:string|null;use?:string|null;structureCode?:string|null;structureName?:string|null;approved?:number|null;height:number;floors:number;style?:string;ring?:number[][]};
export type BuildingAppearance={style:string;finish:number;variant:number;layout?:number;lightSeed?:number;bay:number;storey:number;floors:number;wall:[number,number,number];roof:[number,number,number];inferred:boolean};

/** Kept self-contained so the identical rule runs in the JSONP ring worker.
 * Structure/use/floors constrain materials; a stable identity varies compatible
 * paint, joints and windows. Structure codes describe the frame, not a surveyed
 * exterior finish: inferred appearances must never be labelled exact façades. */
export function buildingAppearanceProfile(b:AppearanceInput):BuildingAppearance{
  const use=b.use??'',name=(b.title??'')+' '+(b.name??'');
  const residential=/^02|공동주택|아파트|apartments|residential/.test(use)||/아파트|위브|래미안|자이|캐슬/.test(name);
  const office=/^14|업무|office|commercial/.test(use);
  const shop=/^0[347]|근린|판매|retail|shop/.test(use);
  const style=b.style??(residential&&b.height>16?'apt':office||b.height>36?'office':shop?'shop':'villa');
  const structure=b.structureName??'',code=b.structureCode??'';
  const masonry=/벽돌|brick/.test(structure),stone=/석조|stone/.test(structure),metal=/철골|steel|금속/.test(structure);
  let finish=masonry?1:stone?2:metal&&style==='office'?3:0;
  if(style==='office'&&b.height>=24&&!masonry&&!stone)finish=4;
  if(style==='apt'&&b.height>=180&&!masonry&&!stone)finish=4;
  // Broad provider structure families are useful hints, not exterior surveys.
  if(!structure&&code.startsWith('1')&&b.height<24)finish=1;
  if(!structure&&code.startsWith('3')&&style==='office'&&b.height<24)finish=3;
  const identity=b.id||name.trim()||JSON.stringify(b.ring??[]);
  let hash=2166136261;for(let i=0;i<identity.length;i++){hash^=identity.charCodeAt(i);hash=Math.imul(hash,16777619)>>>0;}
  const variant=hash%8;
  // Restrained, compatible paints. Do not bleach every apartment toward white.
  const paints=[[.91,.90,.87],[.78,.77,.73],[.86,.81,.72],[.69,.71,.72],[.84,.84,.81],[.66,.61,.54],[.74,.77,.78],[.91,.86,.78]];
  const bricks=[[.57,.31,.23],[.68,.44,.32],[.49,.30,.24],[.72,.58,.44],[.53,.43,.34],[.65,.50,.39],[.45,.38,.32],[.74,.63,.53]];
  const panels=[[.68,.72,.75],[.46,.52,.57],[.75,.76,.74],[.62,.66,.69],[.52,.59,.63],[.76,.73,.66],[.42,.47,.51],[.66,.68,.69]];
  let paint=(finish===1?bricks:finish>=3?panels:paints)[variant].slice();
  if(style==='apt'&&finish===0&&b.approved&&b.approved<2000)paint=paints[[0,1,2,4][hash%4]].slice();
  // Known complex names retain their established muted palette; this is a
  // representation rule, not an assertion about an individual repaint date.
  if(style==='apt'&&finish===0){
    if(/래미안/.test(name))paint=[.87,.88,.82];
    else if(/힐스테이트/.test(name))paint=[.86,.79,.69];
    else if(/자이/.test(name))paint=[.83,.84,.83];
    else if(/푸르지오/.test(name))paint=[.87,.87,.78];
  }
  const linear=(v:number)=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
  const wall=paint.map(linear) as [number,number,number];
  // Roof slabs have their own mineral/coating palette; neither the wall's brand
  // accent nor an unknown rooftop finish is evidence for green waterproofing.
  const roofs=[[.48,.48,.47],[.56,.55,.53],[.40,.42,.44],[.61,.60,.57],[.46,.45,.43],[.52,.53,.54],[.37,.38,.39],[.58,.57,.55]];
  const roof=roofs[(hash>>>8)%roofs.length].map(linear) as [number,number,number];
  const storey=Math.max(2.4,Math.min(5,b.height/Math.max(1,b.floors||Math.round(b.height/(style==='office'?3.8:2.9)))));
  const bay=(style==='office'?1.65:style==='apt'?3.15:style==='shop'?2.6:2.3)*(1+(variant-3.5)*.035);
  const floors=Math.max(1,b.floors||Math.round(b.height/storey));
  // User rule: below FIVE STOREYS, not five metres. Half the stable identities
  // retain the current openings; the rest use punched, paired, ribbon or spaced
  // windows. This is a compatible inferred facade, not a surveyed window plan.
  const layout=floors<5&&((hash>>>16)&1)?1+(hash>>>21)%4:0;
  return {style,finish,variant,layout,lightSeed:((hash>>>8)%8192+.5)/8192,bay,storey,floors,wall,roof,inferred:true};
}

/** Satellite medians are sRGB, while vertex colours are linear. A registered
 * footprint can sample trees/grass beside a displaced tall roof, so a green or
 * yellow-green median is not evidence of its coating. Keep the building's own
 * neutral roof in that case. Red/brown tiled and restrained slab colours remain
 * usable; this is colour evidence, never a photograph mapped onto a building. */
export function observedRoofColour(p:BuildingAppearance,roof:readonly number[],pitched=false):[number,number,number]{
  if(roof.length!==3||roof.some(v=>!Number.isFinite(v)||v<0||v>1))return p.roof;
  const [r,g,b]=roof,max=Math.max(r,g,b),min=Math.min(r,g,b),saturation=(max-min)/Math.max(max,1e-6);
  const green=g>r+.018&&g>b+.018;
  const yellowGreen=g>=r-.015&&Math.min(r,g)>b+.07;
  const tile=pitched&&r>g&&r>b;
  if(green||yellowGreen||(!tile&&saturation>.3)||max<.12)return p.roof;
  const linear=(v:number)=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
  return roof.map(linear) as [number,number,number];
}

/** Appearance attributes never change measured positions, indices or normals.
 * One shader reads per-building parameters: GPU sharing does not force identical
 * paint, glazing, cladding joints or window proportions. */
export function applyBuildingAppearance(geometry:THREE.BufferGeometry,p:BuildingAppearance,ground:number,plain=false){
  const pos=geometry.getAttribute('position'),normal=geometry.getAttribute('normal'),oldUV=geometry.getAttribute('uv');
  const uv=new Float32Array(pos.count*2),color=new Float32Array(pos.count*3),facade=new Float32Array(pos.count*4);
  const style=['apt','villa','shop','office'].indexOf(p.style),kind=Math.max(0,style)*8+p.finish+(plain?32:0);
  for(let i=0;i<pos.count;i++){
    const roof=normal&&Math.abs(normal.getZ(i))>.7;
    const along=oldUV?.getX(i)??pos.getX(i);
    uv[i*2]=along/p.bay;uv[i*2+1]=(pos.getZ(i)-ground)/p.storey;
    color.set(roof?p.roof:p.wall,i*3);facade.set([kind,p.variant+(p.layout??0)*8+(p.lightSeed??0)*.99,p.bay,p.storey],i*4);
  }
  geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  geometry.setAttribute('color',new THREE.BufferAttribute(color,3));
  geometry.setAttribute('facade',new THREE.BufferAttribute(facade,4));
  geometry.userData.buildingAppearance={finish:p.finish,variant:p.variant,layout:p.layout??0,inferred:p.inferred};
  return geometry;
}

/** Keep registered storeys aligned to a measured replacement, even when the
 * registry height was wrong. Low annexes cannot change the entire floor grid. */
export function surveyedAppearance(p:BuildingAppearance,height:number){
  return {...p,storey:Math.max(2.4,Math.min(6,height/p.floors))};
}
