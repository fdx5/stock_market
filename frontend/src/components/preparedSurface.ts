import type { PaintJob } from './paintClient';

export type SurfacePixels = {width:number;height:number;data:Uint8Array};
type SurfaceRecord = {width:number;height:number;file:string;sha256:string};
const version = import.meta.env.VITE_PAINT_ASSETS as string | undefined;
const base = `/3d/surface/${version}/`;
let manifest: Promise<Record<string,SurfaceRecord> | null> | undefined;
async function download(path:string): Promise<Response> {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),1500);
  try {
    const response=await fetch(path,{signal:controller.signal});
    if(!response.ok)throw Error('surface pixels unavailable');
    // The deadline covers the body; optional data never holds a paint reply.
    return new Response(await response.blob());
  } finally {clearTimeout(timer);}
}
/** Final packed GPU channels, verified against the original pack operation. */
export async function preparedSurface(job:PaintJob): Promise<SurfacePixels | null> {
  if(!version || import.meta.env.VITE_PAINT_ON_PAGE || (job.kind==='context' && job.style!=='apt')
    || typeof DecompressionStream==='undefined' || !globalThis.crypto?.subtle)return null;
  if(typeof navigator!=='undefined' && !(navigator as Navigator & {gpu?:unknown}).gpu)return null;
  try {
    const key=job.kind==='plinth'?'plinth':`facade-${job.scale??1}`;
    const maps=await (manifest??=download(base+'manifest.json').then(r=>r.json()).catch(()=>null));
    const entry=maps?.[key];if(!entry)return null;
    const response=await download(base+entry.file);
    const received=await response.arrayBuffer();
    // Some static servers send .gz with Content-Encoding, so fetch has already
    // decoded it. Others send the gzip file unchanged. Accept both transports.
    const buffer=received.byteLength===entry.width*entry.height*4 ? received
      : await new Response(new Blob([received]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    if(buffer.byteLength!==entry.width*entry.height*4)return null;
    const digest=await crypto.subtle.digest('SHA-256',buffer);
    const hex=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
    if(hex!==entry.sha256)return null;
    return {width:entry.width,height:entry.height,data:new Uint8Array(buffer)};
  } catch {return null;}
}
