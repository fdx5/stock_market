import {execFileSync} from 'node:child_process';
import {copyFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const front=fileURLToPath(new URL('..',import.meta.url)),crate=path.join(front,'wasm/road-bvh');
execFileSync(process.env.CARGO??'cargo',['build','--locked','--release','--target','wasm32-unknown-unknown'],{cwd:crate,stdio:'inherit'});
mkdirSync(path.join(front,'src/wasm/road-bvh'),{recursive:true});
copyFileSync(path.join(crate,'target/wasm32-unknown-unknown/release/road_bvh.wasm'),path.join(front,'src/wasm/road-bvh/road_bvh.wasm'));
const hash=data=>createHash('sha256').update(data).digest('hex');
writeFileSync(path.join(front,'src/wasm/road-bvh/build.json'),JSON.stringify({target:'wasm32-unknown-unknown',
 sourceSha256:hash(readFileSync(path.join(crate,'src/lib.rs'),'utf8').replace(/\r\n/g,'\n')),wasmSha256:hash(readFileSync(path.join(front,'src/wasm/road-bvh/road_bvh.wasm')))},null,2)+'\n');
