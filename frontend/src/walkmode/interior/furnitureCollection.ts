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
