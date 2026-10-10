/** Read-only built UI review; no env files, application backend or database. */
import {preview} from '../frontend/node_modules/vite/dist/node/index.js';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../frontend');
const out=process.argv[2],port=Number(process.argv[3]??5173);
if(!out||!path.isAbsolute(out)||!existsSync(path.join(out,'index.html')))throw new Error('Pass an existing absolute built UI directory.');
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid local port.');
const places={haeundae:'26350:우동:1407:해운대두산위브더제니스',changdong:'11320:창동:333:창동동아청솔',sinhak:'11320:방학동:460-5:서울신학초등학교',seondeok:'11320:쌍문동:263:선덕중학교',sanggyeong:'11350:상계동:653:상경중학교',uijeongbu:'41150:의정부동:724:의정부역센트럴자이앤위브캐슬'};
const entry={name:'built-drone-review-entry',configurePreviewServer(server){
  server.middlewares.use((req,res,next)=>{
    const place=req.url?.split('?')[0].replace(/^\/drone-review\//,'');
    if(!place||!places[place]){next();return;}
    const q=new URLSearchParams({complex:places[place],hour:'12',fps:'1',dronedebug:'1'});
    res.statusCode=302;res.setHeader('Cache-Control','no-store');res.setHeader('Location','/drone-explore?'+q.toString());res.end();
  });
}};
const server=await preview({root,configFile:false,envFile:false,plugins:[entry],build:{outDir:out},
  preview:{host:'127.0.0.1',port,strictPort:true,proxy:{'/api':'http://127.0.0.1:8003'}}});
server.printUrls();
console.log(`Built drone review: http://127.0.0.1:${port}/drone-review/haeundae`);
