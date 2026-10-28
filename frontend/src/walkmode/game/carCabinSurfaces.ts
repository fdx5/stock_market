import * as THREE from "three";
/** Existing scanned leather/linen assets, shared by this game's cabins. */
export class CarCabinSurfaces {
  leather!:THREE.Texture;leatherNormal!:THREE.Texture;leatherArm!:THREE.Texture;linen!:THREE.Texture;linenNormal!:THREE.Texture;
  readonly ready:Promise<void>;private textures:THREE.Texture[]=[];private dead=false;
  constructor(){const loader=new THREE.TextureLoader();this.ready=Promise.all([
    ["leather","leather_white_diff",true],["leatherNormal","leather_white_nor",false],["leatherArm","leather_white_arm",false],["linen","rough_linen_diff",true],["linenNormal","rough_linen_nor",false]
  ].map(async([field,file,color])=>{const t=await loader.loadAsync(`/3d/walk/tex/${file}.webp`);if(this.dead){t.dispose();return;}t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(3,3);t.anisotropy=8;if(color)t.colorSpace=THREE.SRGBColorSpace;this.textures.push(t);(this as unknown as Record<string,unknown>)[field as string]=t;})).then(()=>{});}
  dispose(){this.dead=true;this.textures.forEach(t=>t.dispose());this.textures=[];}
}
