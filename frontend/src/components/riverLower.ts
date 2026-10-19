import {fieldFrom,gridAt,type FieldData,type HeightGrid} from './waterCore';

export type RiverLowerArgs={
  /** the tile's river field (about the tile's centre) and the relief it was made on */
  field:FieldData;grid:HeightGrid|null;
  /** the tile's half size and centre (view frame) */
  H:number;cx:number;cy:number;
  /** the tile's ground (view frame, z up): positions, normals, and the grid's row when it has a skirt */
  ground:Float32Array;normal:Float32Array;skirtRow:number|null;
  /** the street surfaces (positions) and how far each stays over the water */
  surfaces:{position:Float32Array;lift:number}[];
  /** the cars' lanes: [n, width, x, y, z, …] */
  lanes:Float32Array|null;
};
/** The arrays changed (null: as they were). */
export type RiverLowerResult={ground:Float32Array|null;normal:Float32Array|null;surfaces:(Float32Array|null)[];lanes:Float32Array|null};

/** The ground under a streamed tile's river lowered to its bed, and its roads, paint, paving and
 * lanes kept over the water. In the scene worker (droneWorld.riverOn): on the page, between
 * frames, these loops were 10-30 s of a slow laptop's riverside tile. */
export function lowerUnderRiver(a:RiverLowerArgs,at:(x:number,y:number)=>number=a.grid?gridAt(a.grid):()=>0):RiverLowerResult{
  const f=fieldFrom(a.field,at),{H,cx,cy}=a,p=a.ground,row=a.skirtRow;
  let changed=false;
  for(let i=0,n=p.length/3;i<n;i++){
    // (asked 2 m inside the tile: a vertex on its edge, outside its own raster, stood as a wall
    // under the water against its neighbour's lowered bed — a line along the tile's edge)
    const x=Math.max(-H+2,Math.min(H-2,p[i*3]-cx)),y=Math.max(-H+2,Math.min(H-2,p[i*3+1]-cy));
    if(!f.wet(x,y)&&!f.wet(x+4,y)&&!f.wet(x-4,y)&&!f.wet(x,y+4)&&!f.wet(x,y-4))continue;
    // The bed by the ground's own height over the water: at or under the surface, lowered to the
    // bed (0.35 m deep at the bank, 1.5 m 12 m out — depth, not the land-use picture under a film
    // of water); 0.4 m and more over it, as it is; between, eased — the water's edge is the
    // ground's own contour, not the 4 m grid's steps.
    const below=row!==null&&i>=row*row?4:0,z0=p[i*3+2]+below,L=f.level(x,y);
    // (out in the channel — 6 m and more from its bank — always: where the DEM's own surface there
    // stands over the water's level (a step between its survey sheets), it showed as a strip of
    // bed across the river)
    const sh=f.shore(x,y),bed=L-Math.min(3,0.35+0.15*sh),k=f.wet(x,y)?1:Math.max(0,Math.min(1,(L+0.4-z0)/0.4));
    if(!k||z0<=bed)continue;
    p[i*3+2]=z0+k*(bed-z0)-below;changed=true;
  }
  let normal:Float32Array|null=null;
  if(changed&&row!==null){
    // (the grid's normals again from its own heights: the skirt never bends them)
    normal=a.normal;
    const X=(i:number)=>p[i*3],Y=(i:number)=>p[i*3+1],Z=(i:number)=>p[i*3+2];
    for(let j=0;j<row;j++)for(let i=0;i<row;i++){
      const k=j*row+i,l=j*row+Math.max(0,i-1),r=j*row+Math.min(row-1,i+1),d=Math.max(0,j-1)*row+i,u=Math.min(row-1,j+1)*row+i;
      const nx=(Z(l)-Z(r))/((X(r)-X(l))||1),ny=(Z(d)-Z(u))/((Y(u)-Y(d))||1),L=Math.hypot(nx,ny,1);
      normal[k*3]=nx/L;normal[k*3+1]=ny/L;normal[k*3+2]=1/L;
    }
  }
  // No road under the water's surface: a road the data lays across the channel at the relief's
  // height (the water's own, there) is kept over it — its paving, paint, kerbs and lanes.
  const over=(x:number,y:number)=>{const lx=x-cx,ly=y-cy;return f.wet(lx,ly)?f.level(lx,ly)+0.3:-Infinity;};
  const surfaces=a.surfaces.map(({position:q,lift})=>{
    let moved=false;
    for(let i=0;i<q.length;i+=3){const want=over(q[i],q[i+1])+lift;if(q[i+2]<want){q[i+2]=want;moved=true;}}
    return moved?q:null;
  });
  let lanes:Float32Array|null=null;
  if(a.lanes){
    const ln=a.lanes;let moved=false;
    for(let o=0;o<ln.length;){
      const n=ln[o];for(let i=0;i<n;i++){const k=o+2+i*3,want=over(ln[k],ln[k+1])+0.08;if(ln[k+2]<want){ln[k+2]=want;moved=true;}}o+=2+n*3;
    }
    if(moved)lanes=ln;
  }
  return {ground:changed?p:null,normal,surfaces,lanes};
}
