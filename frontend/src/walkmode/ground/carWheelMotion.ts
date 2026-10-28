import * as THREE from "three";

export interface Axle { z:number;y:number;radius:number;x:number;front:boolean }
/** Find actual tyre axles, including the three/four-axle heavy vehicles. */
export function carAxles(geometry:THREE.BufferGeometry):Axle[]{
  const p=geometry.getAttribute("position"),uv=geometry.getAttribute("uv"),tyres:number[]=[];
  for(let i=0;i<p.count;i++)if(Math.floor(uv.getX(i)*16)===9)tyres.push(i);
  tyres.sort((a,b)=>p.getZ(a)-p.getZ(b));const groups:number[][]=[];
  for(const i of tyres){const last=groups[groups.length-1];if(!last||p.getZ(i)-p.getZ(last[last.length-1])>.12)groups.push([i]);else last.push(i);}
  return groups.map((indices,k)=>{let y0=Infinity,y1=-Infinity,z0=Infinity,z1=-Infinity,x0=Infinity,x1=0;
    for(const i of indices){y0=Math.min(y0,p.getY(i));y1=Math.max(y1,p.getY(i));z0=Math.min(z0,p.getZ(i));z1=Math.max(z1,p.getZ(i));x0=Math.min(x0,Math.abs(p.getX(i)));x1=Math.max(x1,Math.abs(p.getX(i)));}
    return {z:(z0+z1)/2,y:(y0+y1)/2,radius:(y1-y0)/2,x:(x0+x1)/2,front:k===groups.length-1};
  });
}
/** xyz is the wheel centre; signed w is radius (negative = steering axle).
 * A zero radius keeps body panels and suspension fixed. */
export function carWheelAttribute(geometry:THREE.BufferGeometry,axles:Axle[]){
  const p=geometry.getAttribute("position"),uv=geometry.getAttribute("uv"),data=new Float32Array(p.count*4);
  for(let i=0;i<p.count;i++){
    const part=Math.floor(uv.getX(i)*16);if(![2,3,4,9,14].includes(part))continue;
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);let axle:Axle|undefined,best=Infinity;
    for(const a of axles){const d=(y-a.y)**2+(z-a.z)**2;if(d<best){best=d;axle=a;}}
    if(!axle)continue;const r=axle.radius,radial=Math.sqrt(best);
    if((part===2&&(radial<r*.90||radial>r*1.06||Math.abs(Math.abs(x)-axle.x)>.28))||(part===4&&(radial>r*.90||Math.abs(Math.abs(x)-axle.x)>.28)))continue;
    data.set([Math.sign(x)*axle.x,axle.y,axle.z,axle.front?-r:r],i*4);
  }
  return new THREE.BufferAttribute(data,4);
}

/** Five values per fixed traffic slot: previous x/z/yaw, signed travel, steer.
 * Teleports/spawn reuse reset history; stationary cars retain their wheel angle. */
export function advanceCarWheel(state:Float64Array,slot:number,matrix:ArrayLike<number>,offset:number,wheelbase:number){
  const at=slot*6,x=matrix[offset+12],z=matrix[offset+14],yaw=Math.atan2(matrix[offset+8],matrix[offset+10]);
  if(state[at+5]){
    const dx=x-state[at],dz=z-state[at+1],distance=Math.hypot(dx,dz);
    if(distance<8){const signed=dx*matrix[offset+8]+dz*matrix[offset+10]>=0?distance:-distance;
      state[at+3]+=signed;
      if(distance>.0001){const turn=Math.atan2(Math.sin(yaw-state[at+2]),Math.cos(yaw-state[at+2]));const steering=Math.max(-.55,Math.min(.55,Math.atan(wheelbase*turn/signed)));state[at+4]+=(steering-state[at+4])*.25;}
    }else{state[at+3]=0;state[at+4]=0;}
  }
  state[at]=x;state[at+1]=z;state[at+2]=yaw;state[at+5]=1;
}

/** Same vertex rotation for the visible surfaces and their shadow geometry. */
export function wheelShader(shader:{vertexShader:string}){
  shader.vertexShader=shader.vertexShader.replace("#include <common>",`#include <common>
    attribute vec4 walkWheel;attribute vec2 walkWheelMotion;
    vec3 walkWheelRotate(vec3 v){
      float angle=walkWheelMotion.x/max(abs(walkWheel.w),0.01),c=cos(angle),s=sin(angle);
      v=vec3(v.x,c*v.y-s*v.z,s*v.y+c*v.z);
      float steer=walkWheel.w<0.0?walkWheelMotion.y:0.0;c=cos(steer);s=sin(steer);
      return vec3(c*v.x+s*v.z,v.y,-s*v.x+c*v.z);
    }`)
    .replace("#include <beginnormal_vertex>",`#include <beginnormal_vertex>
      if(abs(walkWheel.w)>0.01){objectNormal=walkWheelRotate(objectNormal);
        #ifdef USE_TANGENT
          objectTangent=walkWheelRotate(objectTangent);
        #endif
      }`)
    .replace("#include <begin_vertex>",`#include <begin_vertex>
      if(abs(walkWheel.w)>0.01)transformed=walkWheel.xyz+walkWheelRotate(transformed-walkWheel.xyz);`);
}
