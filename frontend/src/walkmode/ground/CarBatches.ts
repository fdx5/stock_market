import * as THREE from "three";
import { attachCarWindows, type loadWalkCarModels } from "./carModels";
import { carAxles, carWheelAttribute,advanceCarWheel,wheelShader } from "./carWheelMotion";

type Models = Awaited<ReturnType<typeof loadWalkCarModels>>;
interface Pool { meshes:THREE.InstancedMesh[];windows:THREE.InstancedMesh[];counts:number[];refs:number }
interface Batch { source:THREE.InstancedMesh;pool:Pool;key:string;wheelState:Float64Array;wheelbase:number }
/** Full close-range geometry within 38 m; material-preserving distance meshes
 * farther away. Output resolution is fixed. Per-frame matrix copies retain traffic
 * interpolation, without creating new geometries or materials while moving. */
export class CarBatches {
  readonly group=new THREE.Group();
  private entries = new Set<Batch>();
  private pools=new Map<string,Pool>();
  private drawnRecords=new Set<object>();
  private animatedMaterials=new Map<THREE.Material,THREE.Material>();
  private wheelAttributes=new WeakMap<THREE.BufferGeometry,THREE.BufferAttribute>();
  private ownedGeometries:THREE.BufferGeometry[]=[];
  private geometryCache=new Map<string,THREE.BufferGeometry>();
  private shadow=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});
  private frustum = new THREE.Frustum(); private projection = new THREE.Matrix4(); private sphere = new THREE.Sphere(new THREE.Vector3(), 4.5);
  constructor(private models: Models, private glass: THREE.Material) {this.shadow.onBeforeCompile=wheelShader;this.shadow.customProgramCacheKey=()=>"walk-traffic-wheel-depth-v1";}
  add(source: THREE.InstancedMesh) {
    // Traffic and parked cars use the same physical surface factory. Instance
    // colours carry paint; one pool per kind keeps wheel animation draw-neutral.
    const kind=source.geometry.userData.walkKind,key=kind;
    let pool=this.pools.get(key);
    if(!pool){
      const baseMaterial=source.material as THREE.Material;let material=this.animatedMaterials.get(baseMaterial);
      if(!material){const baseCompile=baseMaterial.onBeforeCompile;material=baseMaterial.clone();material.onBeforeCompile=(shader,r)=>{baseCompile.call(baseMaterial,shader,r);wheelShader(shader);};const shaderKey=baseMaterial.customProgramCacheKey();material.customProgramCacheKey=()=>shaderKey+"-walk-traffic-wheels-v1";this.animatedMaterials.set(baseMaterial,material);}
      const axles=carAxles(this.models.bodies.get(kind)??source.geometry);
      const meshes:THREE.InstancedMesh[]=[],windows:THREE.InstancedMesh[]=[];
      for(let level=0;level<3;level++){
        const base=this.models.levels[level].bodies.get(kind)??source.geometry,geometryKey=kind+"|"+level;let geometry=this.geometryCache.get(geometryKey);
        if(!geometry){geometry=new THREE.BufferGeometry();for(const [name,attribute]of Object.entries(base.attributes))geometry.setAttribute(name,attribute);geometry.setIndex(base.index);
          let wheels=this.wheelAttributes.get(base);if(!wheels){wheels=carWheelAttribute(base,axles);this.wheelAttributes.set(base,wheels);}geometry.setAttribute("walkWheel",wheels);
          geometry.setAttribute("walkWheelMotion",new THREE.InstancedBufferAttribute(new Float32Array(512*2),2).setUsage(THREE.DynamicDrawUsage));
          geometry.boundingSphere=base.boundingSphere;geometry.boundingBox=base.boundingBox;geometry.userData={...base.userData,walkWheelAnimated:true};this.ownedGeometries.push(geometry);this.geometryCache.set(geometryKey,geometry);}
        const mesh=new THREE.InstancedMesh(geometry,material,512);mesh.customDepthMaterial=this.shadow;
        mesh.count=0;mesh.visible=false;mesh.frustumCulled=false;mesh.castShadow=level<2;mesh.receiveShadow=true;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(512*3).fill(1),3);
        this.group.add(mesh);meshes.push(mesh);
        const glazing=this.models.levels[level].windows.get(kind);if(glazing?.getIndex()?.count)windows.push(attachCarWindows(mesh,glazing,this.glass));
      }
      pool={meshes,windows,counts:[0,0,0],refs:0};this.pools.set(key,pool);
    }
    source.geometry.computeBoundingBox();const bounds=source.geometry.boundingBox!;
    pool.refs++;const batch={source,pool,key,wheelState:new Float64Array(source.instanceMatrix.count*6),wheelbase:(bounds.max.z-bounds.min.z)*.6};this.entries.add(batch);source.visible=false;
    return {dispose:()=>{this.entries.delete(batch);source.visible=true;if(--batch.pool.refs===0){for(const m of [...batch.pool.windows,...batch.pool.meshes]){m.removeFromParent();m.dispose();}this.pools.delete(key);}}};
  }
  update(camera: THREE.Camera) {
    this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const eye = camera.position;
    for(const pool of this.pools.values())pool.counts.fill(0);
    this.drawnRecords.clear();
    for (const b of this.entries) {
      const counts=b.pool.counts,matrices = b.source.instanceMatrix.array, colors = b.source.instanceColor?.array;
      const records = b.source.userData.carRecords as { parked: boolean; separate?:boolean; matrix: THREE.Matrix4 }[] | undefined;
      for (let i = 0; i < b.source.count; i++) {
        if (records && (!records[i].parked||records[i].separate)) continue;
        if(records){if(this.drawnRecords.has(records[i]))continue;this.drawnRecords.add(records[i]);}
        const matrix = records?.[i]?.matrix.elements ?? matrices, offset = records ? 0 : i * 16;
        if(!records){if(Math.abs(matrix[offset])+Math.abs(matrix[offset+2])<.00001){b.wheelState[i*6+5]=0;continue;}advanceCarWheel(b.wheelState,i,matrix,offset,b.wheelbase);}
        const x = matrix[offset + 12], y = matrix[offset + 13], z = matrix[offset + 14], d = (x - eye.x) ** 2 + (z - eye.z) ** 2;
        // (past 170 m a car is a few pixels: not drawn; the full model to 30 m, the middle one to 80 m)
        if (d > 170 * 170) continue;
        if (d > 70 * 70) { this.sphere.center.set(x, y + 1, z); if (!this.frustum.intersectsSphere(this.sphere)) continue; }
        const level = d < 30 * 30 ? 0 : d < 80 * 80 ? 1 : 2,mesh=b.pool.meshes[level],n=counts[level];if(n>=512)continue;counts[level]++;
        const target = mesh.instanceMatrix.array; for (let j = 0; j < 16; j++) target[n * 16 + j] = matrix[offset + j];
        const motion=mesh.geometry.getAttribute("walkWheelMotion") as THREE.InstancedBufferAttribute;
        motion.setXY(n,records?0:b.wheelState[i*6+3],records?0:b.wheelState[i*6+4]);
        if (colors && mesh.instanceColor) for (let j = 0; j < 3; j++) mesh.instanceColor.array[n * 3 + j] = colors[i * 3 + j];
      }
    }
    for(const pool of this.pools.values())pool.meshes.forEach((mesh,i)=>{mesh.count=pool.counts[i];mesh.visible=mesh.count>0;mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor!.needsUpdate=true;mesh.geometry.getAttribute("walkWheelMotion").needsUpdate=true;});
  }
  dispose() {for(const pool of this.pools.values())for(const m of [...pool.windows,...pool.meshes]){m.removeFromParent();m.dispose();}this.ownedGeometries.forEach(g=>g.dispose());this.animatedMaterials.forEach(m=>m.dispose());this.shadow.dispose();this.entries.clear();this.pools.clear();this.group.removeFromParent();}
}
