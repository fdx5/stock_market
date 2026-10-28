import * as THREE from "three";
/** Camera-only cutaway of buildings between a fixed rear camera and its car.
 * Collision geometry stays intact. No orbit, height jump or extra render pass. */
export class RearCameraOcclusion {
  private eye=new THREE.Vector4();private target=new THREE.Vector4();
  apply(material:THREE.Material){const before=material.onBeforeCompile,key=material.customProgramCacheKey();
    material.onBeforeCompile=(shader,renderer)=>{before.call(material,shader,renderer);shader.uniforms.walkRearEye={value:this.eye};shader.uniforms.walkRearTarget={value:this.target};
      shader.vertexShader=shader.vertexShader.replace("#include <common>","#include <common>\nvarying vec3 walkRearWorld;").replace("#include <project_vertex>","#include <project_vertex>\nwalkRearWorld=(modelMatrix*vec4(transformed,1.0)).xyz;");
      shader.fragmentShader=shader.fragmentShader.replace("#include <common>","#include <common>\nvarying vec3 walkRearWorld;uniform vec4 walkRearEye;uniform vec4 walkRearTarget;").replace("#include <clipping_planes_fragment>",`#include <clipping_planes_fragment>
        if(walkRearEye.w>0.0){vec3 axis=walkRearTarget.xyz-walkRearEye.xyz;float t=dot(walkRearWorld-walkRearEye.xyz,axis)/max(dot(axis,axis),0.01);
          if(t>-.05&&t<.88){float radius=mix(.65,walkRearTarget.w,clamp(t,0.0,1.0));if(distance(walkRearWorld,walkRearEye.xyz+axis*t)<radius)discard;}}
      `);
    };material.customProgramCacheKey=()=>key+"-fixed-rear-camera-cutaway-v1";material.needsUpdate=true;
  }
  update(camera:THREE.Camera,car:{x:number;y:number;z:number;height:number;width:number}|null){
    if(!car){this.eye.w=0;return;}this.eye.set(camera.position.x,camera.position.y,camera.position.z,1);this.target.set(car.x,car.z+car.height*.5,-car.y,Math.max(1.2,car.width*.65));
  }
}
