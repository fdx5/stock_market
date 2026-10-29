import * as THREE from 'three';
import type {DroneLabel} from './ringBuildings';

export type PlaceModel={id:string;rings:[number,number][][];height:number;minHeight:number;estimated:boolean;wall?:string;roof?:string;canopy?:boolean};
export type DronePlace={id:string;name:string;kind:'commercial'|'market'|'district';lat:number;lon:number;models?:PlaceModel[];address?:string;brand?:string;phone?:string;hours?:string;website?:string;checked?:string};
type Manifest={cell:number;cells:string[]};
type Cell={rows?:DronePlace[];stop?:AbortController;retry:number;tries:number};
const ROOT='/3d/drone/places-20261018-v2';
export const PLACE_SOURCE='https://www.openstreetmap.org/copyright';

export function inPlaceRing(x:number,y:number,r:readonly (readonly number[])[]) {
  let hit=false;
  for(let i=0,j=r.length-1;i<r.length;j=i++){
    const a=r[i],b=r[j];
    if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;
  }
  return hit;
}

/** Spatial buckets contain only currently owned building evidence. Registered
 * streamed geometry takes priority once its GPU buffers are ready. */
export class PlaceFootprints {
  private owners=new Map<string,{buckets:Map<string,[number,number][][]>;ready:()=>boolean}>();
  set(key:string,rings:[number,number][][],ready:()=>boolean=()=>true){
    const buckets=new Map<string,[number,number][][]>();
    for(const r of rings){if(r.length<3)continue;const xs=r.map(p=>p[0]),ys=r.map(p=>p[1]);
      for(let i=Math.floor(Math.min(...xs)/340);i<=Math.floor(Math.max(...xs)/340);i++)for(let j=Math.floor(Math.min(...ys)/340);j<=Math.floor(Math.max(...ys)/340);j++){
        const key=i+','+j;let b=buckets.get(key);if(!b)buckets.set(key,b=[]);b.push(r);
      }
    }
    this.owners.set(key,{buckets,ready});
  }
  remove(key:string){this.owners.delete(key);}
  /** the building outline holding (x, y), if any (the drone's walker at a wall: the building it is) */
  ringAt(x:number,y:number):[number,number][]|null{
    const key=Math.floor(x/340)+','+Math.floor(y/340);
    for(const owner of this.owners.values()){const r=owner.buckets.get(key)?.find(r=>inPlaceRing(x,y,r));if(r)return r;}
    return null;
  }
  /** every outline with a corner within r of (x, y), each once */
  ringsNear(x:number,y:number,r:number):[number,number][][]{
    const out=new Set<[number,number][]>();
    for(let i=Math.floor((x-r)/340);i<=Math.floor((x+r)/340);i++)for(let j=Math.floor((y-r)/340);j<=Math.floor((y+r)/340);j++)
      for(const owner of this.owners.values())for(const ring of owner.buckets.get(i+','+j)??[])if(ring.some(p=>Math.hypot(p[0]-x,p[1]-y)<r))out.add(ring);
    return [...out];
  }
  clear(){this.owners.clear();}
  covered(ring:[number,number][]){
    const cx=ring.reduce((s,p)=>s+p[0],0)/ring.length,cy=ring.reduce((s,p)=>s+p[1],0)/ring.length;
    const samples:[[number,number],...[number,number][]]=[[cx,cy],...ring.slice(0,-1).map(p=>[p[0]*.85+cx*.15,p[1]*.85+cy*.15] as [number,number])];
    let covered=0;
    for(const [x,y] of samples){const key=Math.floor(x/340)+','+Math.floor(y/340);let hit=false;
      for(const owner of this.owners.values()){const rs=owner.buckets.get(key);if(rs&&owner.ready()&&rs.some(r=>inPlaceRing(x,y,r))){hit=true;break;}}
      if(hit)covered++;
    }
    return covered>=Math.ceil(samples.length*.45);
  }
}

/** Per-view bounded cells: no runtime Overpass dependency or retained worldwide cache.
 * Failures keep a retry deadline; a cancelled/late response cannot repopulate a view. */
export class DronePlaceCells {
  private cells=new Map<string,Cell>();
  private manifest:Manifest|null=null;
  private manifestStop:AbortController|null=null;
  private manifestRetry=0;
  private closed=false;
  constructor(private changed:()=>void,private request:typeof fetch=fetch.bind(globalThis)){}
  private async json(path:string,stop:AbortController) {
    const timer=setTimeout(()=>stop.abort(),10000);
    try{const response=await this.request(path,{signal:stop.signal});if(!response.ok)throw Error('place HTTP '+response.status);return await response.json();}
    finally{clearTimeout(timer);}
  }
  update(lat:number,lon:number,now=Date.now()) {
    if(this.closed)return;
    if(!this.manifest){
      if(!this.manifestStop&&now>=this.manifestRetry){
        const stop=new AbortController();this.manifestStop=stop;
        void this.json(ROOT+'/manifest.json',stop).then(m=>{
          if(this.closed||stop.signal.aborted)return;
          if(m.cell!==.05||!Array.isArray(m.cells))throw Error('place manifest');
          this.manifest=m;
        }).catch(()=>{this.manifestRetry=Date.now()+5000;}).finally(()=>{if(this.manifestStop===stop)this.manifestStop=null;});
      }
      return;
    }
    const d=this.manifest.cell,ky=110540,kx=111320*Math.cos(lat*Math.PI/180),R=2600;
    const wanted=this.manifest.cells.filter(k=>{
      const [i,j]=k.split('_').map(Number);
      return Math.hypot(Math.max(i*d-lat,0,lat-(i+1)*d)*ky,Math.max(j*d-lon,0,lon-(j+1)*d)*kx)<R;
    }).sort((a,b)=>{
      const dist=(k:string)=>{const [i,j]=k.split('_').map(Number);return Math.hypot(((i+.5)*d-lat)*ky,((j+.5)*d-lon)*kx);};return dist(a)-dist(b);
    }).slice(0,16);
    const keep=new Set(wanted);
    for(const [key,cell] of this.cells)if(!keep.has(key)){cell.stop?.abort();this.cells.delete(key);this.changed();}
    let busy=[...this.cells.values()].filter(c=>c.stop).length;
    for(const key of wanted){
      const c=this.cells.get(key)??{retry:0,tries:0};this.cells.set(key,c);
      if(c.rows||c.stop||now<c.retry||busy>=2)continue;
      const stop=new AbortController();c.stop=stop;busy++;
      void this.json(ROOT+'/'+key+'.json',stop).then(rows=>{
        if(this.closed||stop.signal.aborted||this.cells.get(key)!==c)return;
        if(!Array.isArray(rows))throw Error('place cell');
        c.rows=rows;this.changed();
      }).catch(()=>{c.retry=Date.now()+Math.min(60000,2000*2**Math.min(c.tries++,5));})
        .finally(()=>{if(c.stop===stop)c.stop=undefined;});
    }
  }
  rows(){return [...this.cells.values()].flatMap(c=>c.rows??[]);}
  dispose(){this.closed=true;this.manifestStop?.abort();for(const c of this.cells.values())c.stop?.abort();this.cells.clear();this.manifest=null;}
}

export function placeGeometry(model:PlaceModel,project:(p:[number,number])=>[number,number],ground:number){
  const rings=model.rings.map(r=>r.map(project));
  const shape=new THREE.Shape(rings[0].map(p=>new THREE.Vector2(...p)));
  for(const hole of rings.slice(1))shape.holes.push(new THREE.Path(hole.map(p=>new THREE.Vector2(...p))));
  const g=new THREE.ExtrudeGeometry(shape,{depth:model.height-model.minHeight,bevelEnabled:false,steps:1,curveSegments:1});
  g.translate(0,0,ground+model.minHeight);g.rotateX(-Math.PI/2);g.computeBoundingSphere();
  return g;
}

type Entry={row:DronePlace;label:DroneLabel;models:Map<string,THREE.Mesh>;};
/** Signs use the existing canvas. Only mapped building polygons create meshes;
 * a market/retail area or a named street never becomes a solid building. */
export class DronePlaces {
  readonly root=new THREE.Group();
  private cells:DronePlaceCells;
  private entries=new Map<string,Entry>();
  private materials=new Map<string,THREE.MeshStandardMaterial>();
  private changed=true;
  private at=-Infinity;
  private x=Infinity;private y=Infinity;
  private kx:number;
  private disposed=false;
  constructor(private o:{lat:number;lon:number;groundAt:(x:number,y:number)=>number;roofAt:(x:number,y:number)=>number;
    covered:(ring:[number,number][])=>boolean;addWarm:(parent:THREE.Object3D,obj:THREE.Object3D)=>void;
    forget?:(materials:Set<THREE.Material>)=>void;onLabels?:(key:string,labels:DroneLabel[]|null)=>void;}){
    this.kx=111320*Math.cos(o.lat*Math.PI/180);this.root.name='mapped commercial places';this.root.matrixAutoUpdate=false;
    this.cells=new DronePlaceCells(()=>{this.changed=true;});
  }
  private project=(p:[number,number]):[number,number]=>[(p[0]-this.o.lon)*this.kx,(p[1]-this.o.lat)*110540];
  private material(colour:string){let m=this.materials.get(colour);if(!m){m=new THREE.MeshStandardMaterial({color:colour,roughness:.85,side:THREE.DoubleSide});this.materials.set(colour,m);}return m;}
  update(x:number,y:number,now=performance.now()){
    if(this.disposed||now-this.at<500)return;this.at=now;
    this.cells.update(this.o.lat+y/110540,this.o.lon+x/this.kx);
    const moved=Math.hypot(x-this.x,y-this.y)>60;
    if(!this.changed&&!moved&&now%2000>500)return;
    this.changed=false;this.x=x;this.y=y;
    const rows=this.cells.rows().filter(p=>Math.hypot((p.lon-this.o.lon)*this.kx-x,(p.lat-this.o.lat)*110540-y)<2600)
      .sort((a,b)=>Math.hypot((a.lon-this.o.lon)*this.kx-x,(a.lat-this.o.lat)*110540-y)-Math.hypot((b.lon-this.o.lon)*this.kx-x,(b.lat-this.o.lat)*110540-y)).slice(0,400);
    const keep=new Set(rows.map(r=>r.id));
    for(const [id,e] of this.entries)if(!keep.has(id)){for(const m of e.models.values()){this.root.remove(m);m.geometry.dispose();}this.entries.delete(id);}
    let made=0;
    for(const row of rows){
      const [px,py]=this.project([row.lon,row.lat]);
      let entry=this.entries.get(row.id);
      if(!entry){entry={row,label:{key:'place:'+row.id,name:row.name,kind:row.kind,x:px,y:py,top:0,n:1,info:{bx:px,by:py,place:{category:row.kind==='commercial'?'상업시설':row.kind==='market'?'시장':'특색 거리·지역 명소',address:row.address,brand:row.brand,phone:row.phone,hours:row.hours,website:row.website,checked:row.checked,sourceUrl:'https://www.openstreetmap.org/'+({n:'node',w:'way',r:'relation'}[row.id[0]]??'node')+'/'+row.id.slice(1)}}},models:new Map()};this.entries.set(row.id,entry);}
      let top=Math.max(this.o.groundAt(px,py),this.o.roofAt(px,py));
      for(const model of row.models??[]){
        const ring=model.rings[0].map(this.project),cx=ring.reduce((s,p)=>s+p[0],0)/ring.length,cy=ring.reduce((s,p)=>s+p[1],0)/ring.length;
        const ground=this.o.groundAt(cx,cy),d=Math.hypot(cx-x,cy-y);
        top=Math.max(top,ground+model.height);
        const old=entry.models.get(model.id),covered=this.o.covered(ring);
        if(covered||d>1700){if(old){this.root.remove(old);old.geometry.dispose();entry.models.delete(model.id);}continue;}
        if(old){old.castShadow=d<700;const delta=ground-(old.userData.placeGround as number);if(Math.abs(delta)>.2){old.position.y+=delta;old.userData.placeGround=ground;old.updateMatrix();}continue;}
        if(d>1300||made>=2)continue;
        const mesh=new THREE.Mesh(placeGeometry(model,this.project,ground),[this.material(model.roof??'#c1bfba'),this.material(model.wall??'#b4ada1')]);
        mesh.name=row.name+' '+model.id;mesh.userData.placeGround=ground;mesh.userData.placeId=row.id;
        mesh.castShadow=d<700;mesh.receiveShadow=true;mesh.matrixAutoUpdate=false;mesh.updateMatrix();
        this.o.addWarm(this.root,mesh);entry.models.set(model.id,mesh);made++;
      }
      entry.label.top=top;
    }
    this.o.onLabels?.('named-places',[...this.entries.values()].map(e=>e.label));
    // Release colours no longer referenced by visible cells, including renderer side caches.
    const used=new Set([...this.entries.values()].flatMap(e=>[...e.models.values()].flatMap(m=>m.material as THREE.Material[])));
    for(const [key,m] of this.materials)if(!used.has(m)){this.o.forget?.(new Set([m]));m.dispose();this.materials.delete(key);}
  }
  roofAt(x:number,y:number){let h=-1e4;for(const e of this.entries.values())for(const model of e.row.models??[]){if(!e.models.has(model.id))continue;const p:[number,number]=[this.o.lon+x/this.kx,this.o.lat+y/110540];if(inPlaceRing(...p,model.rings[0])&&!model.rings.slice(1).some(r=>inPlaceRing(...p,r)))h=Math.max(h,this.o.groundAt(x,y)+model.height);}return h;}
  dispose(){this.disposed=true;this.cells.dispose();this.o.onLabels?.('named-places',null);for(const e of this.entries.values())for(const m of e.models.values())m.geometry.dispose();this.entries.clear();this.root.clear();this.o.forget?.(new Set(this.materials.values()));for(const m of this.materials.values())m.dispose();this.materials.clear();}
}
