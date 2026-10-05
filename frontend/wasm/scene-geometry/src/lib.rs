//! Batched building walls/roofs. Roof triangulation remains the original Earcut.
use std::slice;
pub struct Batch { attrs:Vec<f32>, ids:Vec<u32>, offsets:Vec<u32> }
#[no_mangle] pub extern "C" fn alloc_input(n:usize)->*mut f64 {Box::into_raw(vec![0f64;n].into_boxed_slice()) as *mut f64}
#[no_mangle] pub unsafe extern "C" fn free_input(p:*mut f64,n:usize){drop(Box::from_raw(slice::from_raw_parts_mut(p,n)));}
#[no_mangle] pub unsafe extern "C" fn geometry_build(p:*const f64,n:usize)->*mut Batch {
 let input=slice::from_raw_parts(p,n);let mut cursor=0;let mut pos=Vec::new();let mut normal=Vec::new();let mut uv=Vec::new();let mut colors=Vec::new();let mut ids=Vec::new();let mut offsets=Vec::new();
 while cursor<n {
  if n-cursor<10{return std::ptr::null_mut();}let h=&input[cursor..cursor+10];cursor+=10;
  let edges=h[0] as usize;let roof=h[1] as usize;let tris=h[2] as usize;let ground=h[3];let z0=h[4];let z1=h[5];let scale=h[6];
  if edges>100000||roof>100000||tris>300000||n-cursor<edges*4+roof*2+tris{return std::ptr::null_mut();}
  let start=pos.len()/3;let i0=ids.len();
  for e in input[cursor..cursor+edges*4].chunks_exact(4) {
   let (ax,ay,bx,by)=(e[0],e[1],e[2],e[3]);let dx=bx-ax;let dy=by-ay;let len=dx.hypot(dy);if len<1e-4{continue;}
   let v=(pos.len()/3-start) as u32;let nx=dy/len;let ny=-dx/len;let along_x=dy.abs()<dx.abs();
   for (x,y,z) in [(ax,ay,z0),(bx,by,z0),(bx,by,z1),(ax,ay,z1)] {pos.extend([x as f32,y as f32,z as f32]);normal.extend([nx as f32,ny as f32,0.]);uv.extend([if along_x{x as f32}else{y as f32},((1.-(z-ground))*scale) as f32]);colors.extend([h[7] as f32,h[8] as f32,h[9] as f32]);}
   ids.extend([v,v+1,v+2,v,v+2,v+3]);
  }
  cursor+=edges*4;let roof_start=(pos.len()/3-start) as u32;
  for xy in input[cursor..cursor+roof*2].chunks_exact(2){pos.extend([xy[0] as f32,xy[1] as f32,z1 as f32]);normal.extend([0.,0.,1.]);uv.extend([xy[0] as f32,xy[1] as f32]);colors.extend([h[7] as f32,h[8] as f32,h[9] as f32]);}
  cursor+=roof*2;for &i in &input[cursor..cursor+tris]{if i<0.||i>=roof as f64{return std::ptr::null_mut();}ids.push(roof_start+i as u32);}cursor+=tris;
  offsets.extend([start as u32,(pos.len()/3-start) as u32,i0 as u32,(ids.len()-i0) as u32]);
 }
 let mut attrs=pos;attrs.extend(normal);attrs.extend(uv);attrs.extend(colors);Box::into_raw(Box::new(Batch{attrs,ids,offsets}))
}
#[no_mangle] pub unsafe extern "C" fn geometry_attrs(p:*const Batch)->*const f32 {(*p).attrs.as_ptr()}
#[no_mangle] pub unsafe extern "C" fn geometry_vertices(p:*const Batch)->usize {(*p).attrs.len()/11}
#[no_mangle] pub unsafe extern "C" fn geometry_ids(p:*const Batch)->*const u32 {(*p).ids.as_ptr()}
#[no_mangle] pub unsafe extern "C" fn geometry_offsets(p:*const Batch)->*const u32 {(*p).offsets.as_ptr()}
#[no_mangle] pub unsafe extern "C" fn geometry_free(p:*mut Batch){drop(Box::from_raw(p));}

#[no_mangle] pub extern "C" fn alloc_matrices(n:usize)->*mut f32 {Box::into_raw(vec![0f32;n*16].into_boxed_slice()) as *mut f32}
#[no_mangle] pub unsafe extern "C" fn free_matrices(p:*mut f32,n:usize){drop(Box::from_raw(slice::from_raw_parts_mut(p,n*16)));}
/// Compose Y-yaw then X-pitch, retaining f64 arithmetic until the final store.
#[no_mangle] pub unsafe extern "C" fn instance_compose(p:*const f64,out:*mut f32,n:usize){
 let input=slice::from_raw_parts(p,n*9);let output=slice::from_raw_parts_mut(out,n*16);
 for (a,t) in input.chunks_exact(9).zip(output.chunks_exact_mut(16)){
  let (s,c)=((a[3]/2.).sin(),(a[3]/2.).cos());let (p,q)=((a[4]/2.).sin(),(a[4]/2.).cos());
  let (x,y,z,w)=(c*p,s*q,-s*p,c*q);let (x2,y2,z2)=(x+x,y+y,z+z);
  let (xx,xy,xz,yy,yz,zz,wx,wy,wz)=(x*x2,x*y2,x*z2,y*y2,y*z2,z*z2,w*x2,w*y2,w*z2);
  let (sx,sy,sz)=(a[5],a[6],a[7]);
  let m=[(1.-(yy+zz))*sx,(xy+wz)*sx,(xz-wy)*sx,0.,(xy-wz)*sy,(1.-(xx+zz))*sy,(yz+wx)*sy,0.,(xz+wy)*sz,(yz-wx)*sz,(1.-(xx+yy))*sz,0.,a[0],a[1],a[2],1.];
  for (dst,src) in t.iter_mut().zip(m){*dst=src as f32;}
 }
}
