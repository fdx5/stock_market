import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {RoundedBoxGeometry} from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type {RailLine} from './railCore';

/** Original procedural models; no downloaded manufacturer textures/models.
 * Seoul Line 2's white cab, black mask and stainless/green body are based on
 * the manufacturer's public photograph. Other lines use representative liveries. */
export function trainKit(line:RailLine){
  const length=line.carLength,width=line.width,colour=new THREE.Color(line.colour);
  const material=new THREE.MeshStandardMaterial({vertexColors:true,metalness:.32,roughness:.48});
  const make=(cab:boolean,detail:boolean)=>{
    const parts:THREE.BufferGeometry[]=[];
    const add=(g:THREE.BufferGeometry,c:THREE.ColorRepresentation)=>{
      const b=g.toNonIndexed();g.dispose();const n=b.getAttribute('position').count,rgb=new THREE.Color(c),col=new Float32Array(n*3);
      for(let i=0;i<n;i++)col.set([rgb.r,rgb.g,rgb.b],i*3);b.setAttribute('color',new THREE.BufferAttribute(col,3));b.deleteAttribute('uv');parts.push(b);
    };
    const box=(w:number,h:number,d:number,x:number,y:number,z:number,c:THREE.ColorRepresentation)=>add(new THREE.BoxGeometry(w,h,d).translate(x,y,z),c);
    add(new RoundedBoxGeometry(width,2.95,length-.6,detail?2:1,.18).translate(0,2.25,0),'#c9d1d3');
    box(width+.018,.28,length-.66,0,1.68,0,colour);
    box(width+.025,.025,length-.66,0,1.49,0,'#939da0');
    box(width*.74,.68,length-1.3,0,.8,0,'#26323a');
    box(width*.8,.14,length-.9,0,3.76,0,'#adb9be');
    for(const side of [-1,1]){
      if(!detail){box(.02,.84,length-2,side*(width/2+.014),2.76,0,'#243e4c');continue;}
      const doors=line.mode==='emu'?4:3,span=(length-2.5)/doors;
      for(let i=0;i<doors;i++){
        const z=-length/2+1.25+(i+.32)*span;
        // Two sliding door leaves, their inset windows and central seam.
        box(.025,1.96,1.36,side*(width/2+.015),2.04,z,'#9ba9ae');
        for(const dz of [-.35,.35])box(.032,.76,.52,side*(width/2+.04),2.52,z+dz,'#1a333e');
        box(.035,1.86,.026,side*(width/2+.05),2.08,z,'#34434b');
        const wz=z+span*.53;
        box(.03,.93,Math.max(.75,span-1.9),side*(width/2+.03),2.68,wz,'#1f3d4b');
        box(.035,.035,Math.max(.75,span-1.9),side*(width/2+.05),2.2,wz,'#e2e7e6');
      }
      box(.03,.045,length-1.5,side*(width/2+.03),3.42,0,'#f2f4f1');
    }
    for(const z of [-length*.33,length*.33]){
      box(width*.73,.39,2.55,0,.66,z,'#28323a');
      if(detail)for(const side of [-1,1])for(const dz of line.vehicle==='val208'?[0]:[-.8,.8]){
        const wheelX=line.mode==='monorail'?.22:line.vehicle==='val208'?line.gauge/2:line.mode==='agt'?.85:line.gauge/2;
        const wheel=new THREE.CylinderGeometry(.4,.4,.16,10).rotateZ(Math.PI/2).translate(side*wheelX,.4,z+dz);
        add(wheel,line.mode==='monorail'||line.mode==='agt'?'#1b242a':'#49545a');
      }
      else box(width*.6,.35,2,0,.39,z,'#434c51');
    }
    if(detail){
      for(const z of [-length*.23,length*.23]){
        box(width*.7,.36,2.35,0,3.98,z,'#bdc6c9');
        for(let k=-3;k<=3;k++)box(width*.57,.015,.065,0,4.17,z+k*.25,'#69777e');
      }
      for(const z of [-length/2+.25,length/2-.25])box(width*.43,2.35,.22,0,2.15,z,'#3b454b');
      if(!cab&&line.mode==='emu'){
        for(const side of [-1,1])add(new THREE.BoxGeometry(.055,.055,1.05).rotateX(side*.65).translate(0,4.48,side*.34),'#454c50');
        box(1.32,.06,.19,0,4.86,0,'#5c6669');
      }
      if(line.mode==='monorail')for(const x of [-.56,.56])for(const z of [-length*.33,length*.33])add(new THREE.CylinderGeometry(.2,.2,.12,8).translate(x,-.24,z),'#1b242a');
      if(line.mode==='agt')for(const side of [-1,1])for(const z of [-length*.33,length*.33])for(const dz of [-.55,.55]){
        // Horizontal rubber guide wheels meet the inner face of the side rail.
        const x=side*(width/2-.175);
        add(new THREE.CylinderGeometry(.18,.18,.12,8).translate(x,.3,z+dz),'#1b242a');
      }
    }
    if(cab)for(const end of line.cars===1?[-1,1]:[1]){
      box(width*.98,3.08,.2,0,2.16,end*(length/2-.28),'#eef1ee');
      box(width*.76,1.7,.24,0,2.55,end*(length/2-.16),'#101f28');
      box(width*.82,.42,.26,0,1.35,end*(length/2-.14),'#293942');
      box(width*.56,.27,.27,0,3.14,end*(length/2-.12),colour);
      for(const side of [-1,1])box(.16,.12,.3,side*width*.33,1.43,end*(length/2-.1),'#fdf4d5');
      box(width*.65,.23,.24,0,.68,end*(length/2-.1),'#56646b');
      if(detail){box(.21,.18,.65,0,.61,end*(length/2+.02),'#26333b');box(.015,1.2,.03,0,2.6,end*(length/2-.01),'#829197');}
    }
    const result=mergeGeometries(parts)!;parts.forEach(g=>g.dispose());result.computeBoundingSphere();return result;
  };
  const geometries={cab:make(true,true),car:make(false,true),far:make(false,false)};
  return {material,geometries,dispose(){material.dispose();Object.values(geometries).forEach(g=>g.dispose());}};
}
