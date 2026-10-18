/** A closed tetrahedral leaf has four positions and four face normals. Match each
 * face to a distinct corner, then cyclically rotate its indices so that corner is
 * first. Flat interpolation takes that corner's original normal for the face.
 * All triangles, winding, positions, UVs, colours and face normals are retained.
 * No derivative normals, quantisation, leaf removal or geometric simplification.
 * https://www.w3.org/TR/WGSL/#interpolation
 */
export function compactFlatLeaves(geometry) {
  const attrs=geometry.attributes,index=geometry.index;
  if(!index||index.count%12||Object.keys(attrs).some(n=>!['position','normal','uv','color'].includes(n)))return null;
  if(!attrs.position||!attrs.normal||!attrs.uv||!attrs.color)return null;
  const entries=Object.entries(attrs),bits={},values=Object.fromEntries(entries.map(([n])=>[n,[]]));
  for(const [name,a]of entries){if(a.isInterleavedBufferAttribute||!(a.array instanceof Float32Array))return null;bits[name]=new Uint32Array(a.array.buffer,a.array.byteOffset,a.array.length);}
  if(attrs.position.itemSize!==3||attrs.normal.itemSize!==3||attrs.uv.itemSize!==2||![3,4].includes(attrs.color.itemSize))return null;
  const ids=[],keyOf=i=>entries.filter(([n])=>n!=='normal').map(([n,a])=>Array.from(bits[n].subarray(i*a.itemSize,(i+1)*a.itemSize)).join(',')).join('|');
  for(let at=0;at<index.count;at+=12){
    const vertices=[],faces=[],keys=new Map(),faceKeys=new Set();
    for(let face=0;face<4;face++){
      const source=Array.from(index.array.subarray(at+face*3,at+face*3+3));
      if(source.some(i=>i<0||i>=attrs.position.count))return null;
      const n=source[0]*3;
      for(const i of source)for(let k=0;k<3;k++)if(bits.normal[i*3+k]!==bits.normal[n+k])return null;
      const corners=source.map(i=>{const key=keyOf(i);let id=keys.get(key);if(id===undefined){id=vertices.length;vertices.push(i);keys.set(key,id);}return id;});
      if(new Set(corners).size!==3)return null;
      faceKeys.add([...corners].sort((a,b)=>a-b).join(','));faces.push({source,corners});
    }
    if(vertices.length!==4||faceKeys.size!==4)return null;
    const matched=[];
    const match=(f,used)=>{if(f===4)return true;for(const corner of faces[f].corners)if(!(used&(1<<corner))){matched[f]=corner;if(match(f+1,used|(1<<corner)))return true;}return false;};
    if(!match(0,0))return null;
    const base=values.position.length/3;
    for(let corner=0;corner<4;corner++){
      const face=matched.indexOf(corner);
      for(const [name,a]of entries){const src=name==='normal'?faces[face].source[0]:vertices[corner];for(let k=0;k<a.itemSize;k++)values[name].push(a.array[src*a.itemSize+k]);}
    }
    for(let face=0;face<4;face++){const corners=faces[face].corners,first=corners.indexOf(matched[face]);for(let k=0;k<3;k++)ids.push(base+corners[(first+k)%3]);}
  }
  const attributes=Object.fromEntries(entries.map(([name,a])=>[name,{array:Float32Array.from(values[name]),itemSize:a.itemSize,count:values[name].length/a.itemSize,version:0}]));
  return{attributes,indices:attributes.position.count<=65536?Uint16Array.from(ids):Uint32Array.from(ids)};
}
