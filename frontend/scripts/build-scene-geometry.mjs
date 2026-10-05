import {execFileSync} from 'node:child_process';
import {copyFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const front=fileURLToPath(new URL('..',import.meta.url)),crate=path.join(front,'wasm/scene-geometry'),out=path.join(front,'src/wasm/scene-geometry');
execFileSync(process.env.CARGO??'cargo',['build','--release','--target','wasm32-unknown-unknown'],{cwd:crate,stdio:'inherit'});mkdirSync(out,{recursive:true});
copyFileSync(path.join(crate,'target/wasm32-unknown-unknown/release/scene_geometry.wasm'),path.join(out,'scene_geometry.wasm'));
const hash=d=>createHash('sha256').update(d).digest('hex');writeFileSync(path.join(out,'build.json'),JSON.stringify({sourceSha256:hash(readFileSync(path.join(crate,'src/lib.rs'),'utf8').replace(/\r\n/g,'\n')),wasmSha256:hash(readFileSync(path.join(out,'scene_geometry.wasm')))},null,2)+'\n');
