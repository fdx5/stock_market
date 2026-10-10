type Point={x:number;y:number};
type Ring=readonly (readonly number[])[];
const SIZE=36/2**15;
/** Search a model centre across source tile boundaries and through the interior
 * of multipart registered outlines. Corner-only probes can miss entire wings. */
export function surveySearch(lat0:number,lon0:number,points:Point[],outlines:readonly Ring[]=[]){
  const kx=111320*Math.cos(lat0*Math.PI/180),ky=110540,tiles=new Map<string,[number,number]>(),cells=new Set<string>();
  const areas:number[][]=[];
  const add=(box:number[])=>{
    const x0=Math.floor((lon0+box[0]/kx+180)/SIZE),x1=Math.floor((lon0+box[2]/kx+180)/SIZE);
    const y0=Math.floor((lat0+box[1]/ky+90)/SIZE),y1=Math.floor((lat0+box[3]/ky+90)/SIZE);
    for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)tiles.set(x+','+y,[x,y]);
  };
  for(const ring of outlines){if(ring.length<3)continue;
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for(const [x,y] of ring){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
    const box=[x0-40,y0-40,x1+40,y1+40];areas.push(box);add(box);
  }
  for(const p of points){cells.add(Math.round(p.x/40)+','+Math.round(p.y/40));
    // A complete outline already covers every corner/interior source tile.
    // Do not add another 80m halo at each of its vertices and wait for dozens
    // of unrelated lists before any matching model may start downloading.
    if(!areas.some(([a,b,c,d])=>p.x>=a+40&&p.x<=c-40&&p.y>=b+40&&p.y<=d-40))add([p.x-80,p.y-80,p.x+80,p.y+80]);
  }
  return{tiles:[...tiles.values()],near(x:number,y:number){
    const a=Math.round(x/40),b=Math.round(y/40);
    for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)if(cells.has(a+i+','+(b+j)))return true;
    return areas.some(([x0,y0,x1,y1])=>x>=x0&&x<=x1&&y>=y0&&y<=y1);
  }};
}

/** Source lists include the model's world-space box. Use this conservative
 * bound to avoid decoding unrelated neighbours in the 40m discovery margin.
 * Unknown/invalid bounds always retain the old discovery path. */
export function surveySourceOverlaps(box:readonly number[]|undefined,lat0:number,lon0:number,outlines:readonly Ring[]=[]){
  if(!box||box.length!==6||box.some(v=>!Number.isFinite(v))||!outlines.some(r=>r.length>=3))return true;
  const R=6378137,kx=111320*Math.cos(lat0*Math.PI/180),ky=110540,degrees=180/Math.PI,la0=lat0*Math.PI/180,lo0=lon0*Math.PI/180;
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(let i=0;i<8;i++){
    const x=box[i&1?3:0],y=box[i&2?4:1],z=box[i&4?5:2],r=Math.hypot(x,y,z);
    if(r<R*.9||r>R*1.1)return true;
    const px=kx*degrees*(Math.atan2(-y,x)-lo0),py=ky*degrees*(Math.asin(z/r)-la0);
    x0=Math.min(x0,px);x1=Math.max(x1,px);y0=Math.min(y0,py);y1=Math.max(y1,py);
  }
  return outlines.some(r=>{
    if(r.length<3)return true;
    let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity;
    for(const [x,y] of r){a=Math.min(a,x);b=Math.min(b,y);c=Math.max(c,x);d=Math.max(d,y);}
    return x0<=c+5&&x1>=a-5&&y0<=d+5&&y1>=b-5;
  });
}
