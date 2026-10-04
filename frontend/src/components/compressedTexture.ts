import { fetchStatic } from '../staticCdn';

/** Offline BC7/ETC2 mips: upload blocks directly instead of encoding on the GPU. */
export async function compressedTexture(path:string,kind:'bc7'|'etc2') {
  const response=await fetchStatic(`${path}.${kind}.gz`);if(!response.ok)throw Error('compressed texture download');
  let bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes[0]===0x1f&&bytes[1]===0x8b){
    bytes=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  }
  if(new TextDecoder().decode(bytes.subarray(0,4))!==(kind==='bc7'?'BC7A':'ETC2'))throw Error('compressed texture header');
  const length=new DataView(bytes.buffer).getUint32(4,true),base=8+length;
  const header=JSON.parse(new TextDecoder().decode(bytes.subarray(8,base))) as {width:number;height:number;levels:[number,number,number,number][]};
  return {format:kind==='bc7'?'bc7-rgba-unorm-srgb':'etc2-rgba8unorm-srgb',width:header.width,height:header.height,
    levels:header.levels.map(([w,h,offset,size])=>({w,h,data:bytes.subarray(base+offset,base+offset+size)}))};
}
