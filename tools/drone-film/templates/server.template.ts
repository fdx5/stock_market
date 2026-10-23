import {defineConfig,mergeConfig} from 'vite';
import base from './.local-drone-review.config';
import {writeFile,mkdir,stat} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {spawn} from 'node:child_process';
import path from 'node:path';
const output=path.resolve('I:/ai_root/stock_market/output/haeundae-cinematic-20261024');
const ffmpeg='C:/Users/fdx5/AppData/Local/Programs/Python/Python312/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe';
const sessions=new Map();
export default defineConfig(async env=>mergeConfig(await base(env),{
 plugins:[{name:'local-film-output',configureServer(server){server.middlewares.use('/__film',async(req,res,next)=>{
  try{
   const u=new URL(req.url||'/', 'http://localhost');
   if(req.method==='POST'&&u.pathname==='/start'){
    await mkdir(output,{recursive:true});const id=Date.now().toString(36),filename=path.join(output,id+'.mp4');
    const args=['-hide_banner','-n','-f','image2pipe','-vcodec','mjpeg','-framerate','60','-threads','8','-i','pipe:0','-i',path.join(output,'inception.webm'),'-map','0:v:0','-map','1:a:0','-c:v','h264_nvenc','-preset','p7','-tune','hq','-rc','vbr','-cq','15','-b:v','85M','-maxrate','120M','-bufsize','240M','-spatial-aq','1','-temporal-aq','1','-aq-strength','8','-profile:v','high','-level:v','5.2','-pix_fmt','yuv420p','-r','60','-c:a','aac','-b:a','320k','-af','afade=t=in:st=0:d=0.4,afade=t=out:st=160.5:d=1.5','-t','162','-shortest','-video_track_timescale','60000','-movflags','+faststart','-metadata','title=HAEUNDAE / THE ZENITH','-metadata','artist=KOSPIMAP','-metadata','comment=Music: Inception - Angel Lover. Use authorized by requester. Map: VWorld and OpenStreetMap contributors.',filename];
    const child=spawn(ffmpeg,args,{windowsHide:true,stdio:['pipe','ignore','pipe']});
    const log=createWriteStream(path.join(output,id+'-encode.log'),{flags:'wx'});child.stderr.pipe(log);
    const session={child,filename,seq:0,bytes:0,error:null,exit:new Promise(resolve=>child.once('close',resolve))};
    child.on('error',e=>{session.error=String(e);});child.stdin.on('error',e=>{session.error=String(e);});sessions.set(id,session);res.end(JSON.stringify({id}));return;
   }
   const id=u.searchParams.get('id');if(!id||!sessions.has(id)){res.statusCode=404;res.end();return;}
   const s=sessions.get(id);const parts=[];let bytes=0;for await(const part of req){bytes+=part.length;if(bytes>32*1024*1024)throw Error('Chunk too large');parts.push(part);}const data=Buffer.concat(parts);
   if(req.method==='POST'&&u.pathname==='/frame'){
    if(Number(u.searchParams.get('seq'))!==s.seq)throw Error('Out-of-order video frame');
    if(s.error)throw Error(s.error);await new Promise((resolve,reject)=>s.child.stdin.write(data,e=>e?reject(e):resolve()));s.bytes+=bytes;++s.seq;res.end('ok');return;
   }
   if(req.method==='POST'&&u.pathname==='/still'){
    const frame=Number(u.searchParams.get('frame'));if(!Number.isSafeInteger(frame)||frame<0||frame>9720)throw Error('Bad frame');await writeFile(path.join(output,`${id}-frame-${frame}.png`),data,{flag:'wx'});res.end('ok');return;
   }
   if(req.method==='POST'&&u.pathname==='/finish'){
    const meta=JSON.parse(data.toString());if(meta.frames!==s.seq)throw Error('Incomplete frame stream');s.child.stdin.end();const code=await s.exit;if(code!==0)throw Error('Video encoder failed: '+code);
    await writeFile(path.join(output,id+'.json'),JSON.stringify({...meta,inputBytes:s.bytes,bytes:(await stat(s.filename)).size,encodedFrames:s.seq,encoder:'NVIDIA NVENC H.264 High 5.2 / p7 / CQ15 / 85-120 Mbps',intermediate:'4K JPEG quality 1.0, streamed in memory'},null,2),{flag:'wx'});sessions.delete(id);res.end('ok');return;
   }
   res.statusCode=405;res.end();
  }catch(e){res.statusCode=500;res.end(String(e));}
 });}}],
 server:{port:5200,strictPort:true,hmr:false},
}));
