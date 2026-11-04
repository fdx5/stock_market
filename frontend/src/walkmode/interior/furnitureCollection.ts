import * as THREE from "three";
import { boxUV } from "./geom";
import type { Palette } from "./materials";
import { bx, cy, rb, puff, desk, diningTable, tvCabinet, wardrobe, washerDryer, type Kit } from "./models";
import { sofaV } from "./variants";

/** Additional collections use the same batched materials and physical furniture dimensions.
 * New objects do not allocate lights, texture copies or one draw call per decorative detail. */
export function sofaCollection(P:Palette,w:number,v:number):Kit {
  if(v<5)return sofaV(P,w,v);
  const k:Kit=[],d=.94,F=P.fabricSofa;
  if(v===5){ // rounded bouclé modules, pill-shaped backs and individual bolsters
    for(let i=0;i<3;i++){
      const x=(i-1)*w/3;
      k.push(rb(F,w/3-.012,.32,d,.12,x,.24,d/2,5),rb(F,w/3-.03,.48,.22,.1,x,.58,.13,5));
      const cushion=puff(w/3-.04,.13,.64,{bulge:.3,pinch:.5,crease:.06,seed:i+20});cushion.translate(x,.44,.58);k.push({m:P.linen,g:cushion});
    }
    k.push(rb(P.rubber,w-.1,.1,d-.1,.025,0,.05,d/2));
  }else if(v===6){ // oak daybed frame with visible slats, linen roll cushions
    k.push(rb(P.woodLight,w,.08,d,.02,0,.3,d/2));
    for(const s of [-1,1])for(const z of [.1,d-.1])k.push(cy(P.woodLight,.025,.018,.27,s*(w/2-.08),.135,z,10));
    for(let i=0;i<Math.ceil(w/.13);i++)k.push(rb(P.woodLight,.045,.45,.045,.008,-w/2+.05+i*(w-.1)/Math.ceil(w/.13),.55,.045));
    k.push(rb(P.woodLight,w,.055,.065,.02,0,.79,.045),rb(F,w-.08,.19,d-.12,.07,0,.43,d/2));
    for(const s of [-1,1]){const g=boxUV(new THREE.CylinderGeometry(.12,.12,.55,20));g.rotateZ(Math.PI/2);g.translate(s*(w/2-.34),.64,.3);k.push({m:P.linen,g});}
  }else if(v===7){ // a tuxedo sofa: equal-height arms/back, vertical channel upholstery
    k.push(rb(F,w,.26,d,.04,0,.2,d/2),rb(F,w,.48,.18,.05,0,.56,.09));
    for(const s of [-1,1])k.push(rb(F,.13,.48,d,.04,s*(w/2-.065),.56,d/2));
    for(let i=0;i<Math.floor(w/.16);i++)k.push(rb(P.linen,.12,.4,.025,.04,-w/2+.16+i*.16,.6,.19));
    for(let i=0;i<2;i++)k.push(rb(F,(w-.3)/2-.015,.16,.68,.055,(i-.5)*(w-.3)/2,.4,.58));
    for(const s of [-1,1])for(const z of [.1,.82])k.push(cy(P.handle,.012,.009,.08,s*(w/2-.1),.04,z,10));
  }else if(v===8){ // a light armless sofa: thin metal sled frame and oversized back cushions
    k.push(rb(P.blackMetal,w-.04,.06,d-.1,.015,0,.26,d/2));
    for(const x of [-w/2+.06,w/2-.06])k.push(bx(P.blackMetal,.025,.26,.025,x,.13,.12),bx(P.blackMetal,.025,.26,.025,x,.13,.82),bx(P.blackMetal,.025,.025,.73,x,.013,.47));
    for(let i=0;i<2;i++){const x=(i-.5)*w/2;k.push(rb(F,w/2-.025,.23,.84,.09,x,.4,.5));const g=puff(w/2-.03,.17,.44,{bulge:.4,pinch:.4,seed:i+8});g.rotateX(Math.PI/2-.2);g.translate(x,.65,.16);k.push({m:P.velvet,g});}
  }else{ // tailored leather with a low rail and diamond buttons
    k.push(rb(P.leather,w,.25,d,.055,0,.25,d/2),rb(P.leather,w,.5,.2,.075,0,.57,.1));
    for(const s of [-1,1])k.push(rb(P.leather,.16,.42,d,.07,s*(w/2-.08),.52,d/2));
    for(let i=0;i<3;i++)k.push(rb(P.leather,(w-.36)/3-.02,.13,.64,.045,-(w-.36)/2+(i+.5)*(w-.36)/3,.43,.58));
    for(let j=0;j<2;j++)for(let x=-w/2+.22+j*.1;x<w/2-.15;x+=.22){const g=new THREE.SphereGeometry(.009,6,4);g.translate(x,.52+j*.16,.203);k.push({m:P.rubber,g,cast:false});}
    for(const s of [-1,1])for(const z of [.1,.82])k.push(cy(P.woodDark,.025,.017,.12,s*(w/2-.08),.06,z,10));
  }
  return k;
}

export function wardrobeCollection(P:Palette,w:number,h:number,v:number):Kit {
  if(v===0)return wardrobe(P,w,h);
  const depth=.6,k:Kit=[bx(P.cabinet,w,h,depth,0,h/2,depth/2)];
  const count=Math.max(2,Math.round(w/(v===1?.75:.5))),width=w/count;
  for(let i=0;i<count;i++){
    const x=-w/2+(i+.5)*width,m=v===2&&i===0?P.mirror:v===3?P.woodDark:v===4?P.cabinetUpper:P.woodLight;
    k.push(rb(m,width-.008,h-.06,.018,.004,x,h/2,depth+.009));
    if(v===3)for(let c=0;c<5;c++)k.push(bx(P.woodLight,.014,h-.12,.012,x-width/2+(c+1)*width/6,h/2,depth+.024));
    if(v===1)k.push(rb(P.blackMetal,.02,h*.52,.02,.005,x+width*.32,h*.48,depth+.027));
    else if(v!==4)k.push(rb(P.handle,.012,.18,.025,.004,x+width*.3,h*.46,depth+.032));
    if(v===5)k.push(bx(P.trim,width-.08,.008,.004,x,h*.64,depth+.02));
  }
  return k;
}

export function deskCollection(P:Palette,w:number,v:number):Kit {
  if(v===0)return desk(P,w);
  const k:Kit=[rb(v===2?P.counter:P.woodLight,w,.035,.58,.014,0,.74,.29)];
  if(v===1||v===3){ // sit/stand T legs or a metal trestle
    for(const s of [-1,1])k.push(rb(P.applianceDark,.055,.67,.055,.008,s*(w/2-.13),.36,.29),rb(P.applianceDark,.075,.025,.52,.008,s*(w/2-.13),.025,.29));
    k.push(rb(P.blackMetal,w-.22,.04,.04,.008,0,.58,.29));
  }else{for(const s of [-1,1])k.push(rb(P.woodDark,.06,.72,.49,.012,s*(w/2-.05),.36,.29));k.push(rb(P.cabinet,w-.16,.12,.44,.008,0,.65,.25));}
  k.push(rb(P.applianceDark,.28,.003,.2,.006,w*.2,.76,.38));
  if(v===3){k.push(rb(P.applianceDark,.53,.32,.026,.015,0,1.06,.12),cy(P.blackMetal,.025,.025,.17,0,.84,.12,10),rb(P.blackMetal,.26,.015,.15,.01,0,.77,.15));}
  return k;
}

export function tvCabinetCollection(P:Palette,w:number,v:number):Kit {
  if(v===0)return tvCabinet(P,w);
  const k:Kit=[],h=.36,d=.42;
  k.push(rb(v===1?P.cabinetUpper:P.woodDark,w,h,d,.012,0,.3,d/2));
  for(const s of [-1,1])k.push(cy(v===2?P.handle:P.blackMetal,.012,.01,.12,s*(w/2-.12),.06,.12,8),cy(P.blackMetal,.012,.01,.12,s*(w/2-.12),.06,.33,8));
  if(v===2)for(let i=0;i<Math.round(w/.05);i++)k.push(bx(P.woodLight,.025,h-.02,.012,-w/2+.03+i*.05,.3,d+.006));
  else for(let i=1;i<4;i++)k.push(bx(P.rubber,.004,h-.02,.003,-w/2+i*w/4,.3,d+.002));
  k.push(rb(P.applianceDark,w*.45,.05,.1,.02,0,.505,.23));
  return k;
}

export function diningCollection(P:Palette,w:number,d:number,v:number):Kit {
  if(v===0)return diningTable(P,w,d);
  const k:Kit=[];
  if(v===1){const g=boxUV(new THREE.CylinderGeometry(d/2,d/2,.035,32));g.scale(w/d,1,1);g.translate(0,.74,0);k.push({m:P.counter,g});k.push(cy(P.woodDark,.19,.25,.72,0,.36,0,24));}
  else{k.push(rb(v===2?P.counter:P.woodDark,w,.04,d,.055,0,.74,0));for(const s of [-1,1])k.push(rb(v===2?P.woodLight:P.blackMetal,v===2?.12:.04,.71,d*.68,.012,s*(w/2-.16),.355,0));}
  return k;
}

export function laundryCollection(P:Palette,v:number):Kit {
  if(v===0)return washerDryer(P);
  const k:Kit=[],n=v===1?1:2;
  for(let i=0;i<n;i++){
    const y=i*.86;k.push(rb(v===3?P.applianceDark:P.appliance,.6,.84,.65,.025,0,y+.42,.325));
    const rim=boxUV(new THREE.CylinderGeometry(.185,.185,.025,28));rim.rotateX(Math.PI/2);rim.translate(0,y+.4,.665);k.push({m:P.chrome,g:rim});
    const glass=new THREE.CircleGeometry(.16,28);glass.translate(0,y+.4,.681);k.push({m:P.applianceDark,g:glass});
    k.push(rb(P.screen,.18,.045,.006,.006,.1,y+.73,.654),cy(P.chrome,.025,.025,.018,-.18,y+.73,.66,14));
  }
  if(n===1)k.push(rb(P.woodLight,.64,.04,.67,.01,0,.86,.33));
  return k;
}

/** Worktop appliances, modelled in metres: espresso machine, microwave, toaster, rice cooker. */
export function countertopAppliance(P:Palette,v:number):Kit {
  if(v===0){const k:Kit=[rb(P.steel,.28,.34,.3,.025,0,.17,.15),rb(P.applianceDark,.24,.2,.03,.01,0,.16,.308),rb(P.blackMetal,.24,.02,.18,.006,0,.02,.27)];
    for(const x of [-.065,.065])k.push(cy(P.chrome,.018,.018,.08,x,.19,.34,10));k.push(rb(P.blackMetal,.13,.018,.035,.006,.08,.15,.36),cy(P.ceramic,.035,.03,.065,-.055,.06,.28,16));return k;}
  if(v===1)return[rb(P.appliance,.44,.27,.3,.015,0,.135,.15),rb(P.applianceDark,.31,.19,.008,.008,-.04,.135,.305),rb(P.handle,.012,.17,.025,.004,.12,.135,.32),rb(P.screen,.04,.055,.005,.005,.18,.19,.306)];
  if(v===2)return[rb(P.steel,.27,.18,.17,.035,0,.09,.085),rb(P.applianceDark,.2,.008,.015,.006,0,.183,.06),rb(P.applianceDark,.2,.008,.015,.006,0,.183,.11),rb(P.blackMetal,.015,.08,.02,.004,.143,.1,.085)];
  return[rb(P.appliance,.26,.25,.3,.065,0,.125,.15),rb(P.applianceDark,.16,.055,.008,.012,0,.19,.302),rb(P.chrome,.1,.015,.03,.008,0,.255,.15),bx(P.rubber,.25,.02,.28,0,.012,.15)];
}

export function airPurifier(P:Palette,v:number):Kit {
  const k:Kit=[cy(v===1?P.applianceDark:P.appliance,.17,.18,.56,0,.28,.18,24),cy(P.applianceDark,.155,.155,.015,0,.567,.18,24)];
  for(let i=0;i<8;i++){const g=new THREE.TorusGeometry(.177,.002,4,24);g.rotateX(Math.PI/2);g.translate(0,.08+i*.035,.18);k.push({m:P.rubber,g,cast:false});}
  k.push(rb(P.screen,.05,.012,.018,.005,0,.578,.18));return k;
}

/** coffee tables sized to the sofa and the room (w along the sofa, d across): 14 kinds — oak slab,
 * marble oval, travertine drum, two-tier glass, lift-top with a shelf, a pair of nesting rounds, a
 * leather ottoman, a black steel frame with a smoked top, a walnut box with drawers, a round
 * pedestal, terrazzo blocks, a rattan tray, a ceramic trio and a low Japanese board */
export const COFFEE_KINDS = 14;
export function coffeeTableSized(P:Palette,v:number,w:number,d:number):Kit {
  const k:Kit=[],h=.38;
  const legs4=(m:THREE.Material,s:number,hh:number,inset=.06)=>{for(const [x,z] of [[-1,-1],[1,-1],[-1,1],[1,1]])k.push(bx(m,s,hh,s,x*(w/2-inset),hh/2,z*(d/2-inset)));};
  const oval=(m:THREE.Material,ww:number,dd:number,y:number,t:number)=>{const g=new THREE.CylinderGeometry(.5,.5,t,48);g.scale(ww,1,dd);k.push({m,g:boxUV(g).translate(0,y,0)});};
  switch(((v%COFFEE_KINDS)+COFFEE_KINDS)%COFFEE_KINDS){
    case 0:k.push(rb(P.woodLight,w,.05,d,.015,0,h-.025,0));legs4(P.woodLight,.06,h-.05);break;
    case 1:oval(P.counter,w,d,h-.02,.04);k.push(cy(P.counter,Math.min(w,d)*.18,Math.min(w,d)*.22,h-.04,0,(h-.04)/2,0,32));break;
    case 2:{const r=Math.min(w,d)/2;k.push(cy(P.sill,r,r,h,0,h/2,0,48));if(w>d*1.3)k.push(cy(P.sill,r*.7,r*.7,h*.8,w/2-r*.7,h*.4,0,40));break;}
    case 3:k.push(part(P.glass,w,.012,d,0,h-.006,0),part(P.glass,w-.06,.01,d-.06,0,.12,0));for(const [x,z] of [[-1,-1],[1,-1],[-1,1],[1,1]])k.push(cy(P.chrome,.012,.012,h,x*(w/2-.03),h/2,z*(d/2-.03),10));break;
    case 4:k.push(rb(P.woodDark,w,.04,d,.012,0,h-.02,0),rb(P.woodDark,w-.1,.02,d-.1,.006,0,.12,0),rb(P.cabinet,w-.1,h-.18,.02,.004,0,(h+.12)/2-.02,d/2-.06));legs4(P.woodDark,.045,h-.04,.05);break;
    case 5:{const r1=Math.min(d,w*.55)/2,r2=r1*.75;k.push(cy(P.woodLight,r1,r1,.025,-w/2+r1,h,0,40),cy(P.blackMetal,.012,.012,h,-w/2+r1,h/2,0,8),cy(P.blackMetal,r1*.5,r1*.5,.01,-w/2+r1,.005,0,24),cy(P.counter,r2,r2,.022,w/2-r2,h-.08,d*.12,36),cy(P.blackMetal,.012,.012,h-.08,w/2-r2,(h-.08)/2,d*.12,8),cy(P.blackMetal,r2*.5,r2*.5,.01,w/2-r2,.005,d*.12,24));break;}
    case 6:k.push(rb(P.leather,w,h-.03,d,.06,0,(h-.03)/2+.03,0,5),rb(P.woodDark,w*.95,.03,d*.95,.01,0,.015,0));for(let x=-w/2+.18;x<w/2-.1;x+=.22)k.push({m:P.rubber,g:new THREE.SphereGeometry(.008,6,4).translate(x,h,0),cast:false});break;
    case 7:k.push(part(P.glass,w,.01,d,0,h-.005,0));for(const z of [-1,1])k.push(bx(P.blackMetal,w,.02,.02,0,h-.02,z*(d/2-.01)),bx(P.blackMetal,w,.02,.02,0,.01,z*(d/2-.01)));for(const x of [-1,1])for(const z of [-1,1])k.push(bx(P.blackMetal,.02,h,.02,x*(w/2-.01),h/2,z*(d/2-.01)));break;
    case 8:k.push(rb(P.woodDark,w,h-.05,d,.01,0,(h-.05)/2+.05,0));for(const x of [-w/4,w/4])k.push(bx(P.handle,.12,.012,.012,x,h*.6,d/2+.006),bx(P.rubber,w/2-.03,.003,.002,x,h*.45,d/2+.001));legs4(P.woodDark,.04,.05,.04);break;
    case 9:{const r=Math.min(w,d)/2;k.push(cy(P.woodLight,r,r,.035,0,h-.018,0,48),cy(P.woodLight,.07,.09,h-.07,0,(h-.07)/2+.035,0,24),cy(P.woodLight,r*.55,r*.6,.035,0,.018,0,36));break;}
    case 10:k.push(rb(P.floorMain,w*.62,h,d,.01,-w*.19,h/2,0),rb(P.floorMain,w*.36,h*.7,d*.8,.01,w*.31,h*.35,d*.08));break;
    case 11:oval(P.woodLight,w,d,h-.04,.06);oval(P.linen,w*.86,d*.86,h-.005,.012);for(let i=0;i<10;i++){const a=i/10*Math.PI*2;k.push(cy(P.woodLight,.012,.012,h-.07,Math.cos(a)*w*.42,(h-.07)/2,Math.sin(a)*d*.42,8));}break;
    case 12:{const r=Math.min(d/2,w/3.2);for(const [x,hh] of [[-w/2+r,h],[0,h*.86],[w/2-r,h*.72]] as [number,number][])k.push(cy(P.ceramic,r*.96,r,hh,x,hh/2,0,40));break;}
    default:k.push(rb(P.woodLight,w,.04,d,.01,0,.3,0));for(const x of [-1,1])k.push(rb(P.woodLight,.04,.28,d-.08,.008,x*(w/2-.08),.14,0));break;
  }
  return k;
}
function part(m:THREE.Material,w:number,h:number,d:number,x:number,y:number,z:number){return {m,g:new THREE.BoxGeometry(w,h,d).translate(x,y,z)};}
