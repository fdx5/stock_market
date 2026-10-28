import * as THREE from "three";
import { boxesOverlap, type Body } from "../../drivegame/vehicle/physics";
import { carCollisionSize } from "./carCollisionSize";

export interface ParkedCar {
  id: string; kind: string; label: string; x: number; y: number; z: number; heading: number;
  length: number; width: number; height: number; paint: THREE.Color; matrix: THREE.Matrix4;
  body: Body; parked: boolean; separate: boolean;
}
/** Session-only vehicle positions. Streamed aerial patches share these records. */
export class ParkedCars {
  readonly records = new Map<string, ParkedCar>();
  private grid=new Map<string,Set<ParkedCar>>();
  private index(r:ParkedCar){const key=`${Math.floor(r.x/18)}:${Math.floor(r.y/18)}`,cell=this.grid.get(key)??new Set<ParkedCar>();cell.add(r);this.grid.set(key,cell);}
  provide(kind: string, matrix: THREE.Matrix4, paint: THREE.Color, geometry: THREE.BufferGeometry) {
    const p = new THREE.Vector3().setFromMatrixPosition(matrix), id = `${Math.round(p.x * 2)}:${Math.round(p.z * 2)}`;
    const prior = this.records.get(id); if (prior) return prior;
    const e = matrix.elements, heading = Math.atan2(-e[10], e[8]), b = geometry.boundingBox!,hull=carCollisionSize(geometry);
    const record: ParkedCar = { id, kind, label: geometry.userData.carMeta?.label ?? kind, x: p.x, y: -p.z, z: p.y, heading,
      length: b.max.z - b.min.z, width: b.max.x - b.min.x, height: b.max.y - b.min.y, paint: paint.clone(), matrix: matrix.clone(), parked: true, separate: false,
      body: { x: p.x, y: -p.z, hx: Math.cos(heading), hy: Math.sin(heading), length: hull.length, width: hull.width, speed: 0 } };
    this.records.set(id, record); this.index(record); return record;
  }
  nearest(x: number, y: number) {
    let result: ParkedCar | null = null, best = 1.9;
    for (const r of this.records.values()) {
      if (!r.parked || Math.hypot(r.x - x, r.y - y) > 8) continue;
      const dx = x - r.x, dy = y - r.y, a = dx * r.body.hx + dy * r.body.hy, b = -dx * r.body.hy + dy * r.body.hx;
      const distance = Math.hypot(Math.max(0, Math.abs(a) - r.length / 2), Math.max(0, Math.abs(b) - r.width / 2));
      if (distance < best) { best = distance; result = r; }
    }
    return result;
  }
  near(x: number, y: number, radius: number) { const out:Body[]=[];const reach=radius+7;for(let i=Math.floor((x-reach)/18);i<=Math.floor((x+reach)/18);i++)for(let j=Math.floor((y-reach)/18);j<=Math.floor((y+reach)/18);j++)for(const r of this.grid.get(`${i}:${j}`)??[])if(r.parked&&Math.hypot(r.x-x,r.y-y)<radius+r.length)out.push(r.body);return out; }
  blocks(body: Body, ignore?: string) { const ignored=ignore?this.records.get(ignore)?.body:null;return this.near(body.x,body.y,body.length+6).some(r=>r!==ignored&&boxesOverlap(body,r,.03)); }
  /** Keep chase cameras out of closed car shells. */
  cameraBlocked(x:number,y:number,z:number,padding=.18){
    for(let i=Math.floor((x-9)/18);i<=Math.floor((x+9)/18);i++)for(let j=Math.floor((y-9)/18);j<=Math.floor((y+9)/18);j++)for(const r of this.grid.get(`${i}:${j}`)??[]){
      if(!r.parked||z<r.z-.1||z>r.z+r.height+padding)continue;const dx=x-r.x,dy=y-r.y;
      if(Math.abs(dx*r.body.hx+dy*r.body.hy)<r.length/2+padding&&Math.abs(-dx*r.body.hy+dy*r.body.hx)<r.width/2+padding)return true;
    }return false;
  }
  position(r: ParkedCar, x: number, y: number, z: number, heading: number) {
    this.grid.get(`${Math.floor(r.x/18)}:${Math.floor(r.y/18)}`)?.delete(r);
    Object.assign(r, { x, y, z, heading }); Object.assign(r.body, { x, y, hx: Math.cos(heading), hy: Math.sin(heading), speed: 0 });
    r.matrix.compose(new THREE.Vector3(x, z, -y), new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(Math.cos(heading), -Math.sin(heading))), new THREE.Vector3(1, 1, 1));
    this.index(r);
  }
  dispose() { this.records.clear();this.grid.clear(); }
}
