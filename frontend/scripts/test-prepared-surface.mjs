import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash,webcrypto} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import vm from 'node:vm';
import ts from 'typescript';

const pixels=Uint8Array.from({length:64},(_,i)=>i*3%256);
const hash=createHash('sha256').update(pixels).digest('hex');
const entry={width:4,height:4,file:'pixels.rgba.gz',sha256:hash};
const original=readFileSync(new URL('../src/components/preparedSurface.ts',import.meta.url),'utf8');
function fixture({decoded=false,corrupt=false,missing=false,stall=false,unsupported=false}={}) {
  const calls=[],state={aborted:false};
  const code=ts.transpileModule(original.replaceAll('import.meta.env.VITE_PAINT_ASSETS','"test-version"').replaceAll('import.meta.env.VITE_PAINT_ON_PAGE','false'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};
  const context=vm.createContext({exports,Response,Blob,AbortController,Uint8Array,Array,DecompressionStream:unsupported?undefined:DecompressionStream,
    crypto:webcrypto,setTimeout:(f,delay)=>setTimeout(f,Math.min(delay,10)),clearTimeout,
    fetch:async(path,{signal})=>{
      calls.push(path);
      if(path.endsWith('manifest.json'))return new Response(JSON.stringify({'facade-1':entry}));
      if(missing)return new Response('',{status:404});
      if(stall)return new Response(new ReadableStream({start(c){signal.addEventListener('abort',()=>{state.aborted=true;c.error(Error('body stalled'));});}}));
      const bytes=pixels.slice();if(corrupt)bytes[0]^=1;
      return new Response(decoded?bytes:gzipSync(bytes));
    }});
  vm.runInContext(code,context);
  return {load:()=>exports.preparedSurface({kind:'facade',scale:1}),calls,state};
}
test('gzip and transparently decoded HTTP bodies retain exact packed bytes',async()=>{
  for(const decoded of [false,true]){
    const f=fixture({decoded}),result=await f.load();assert.ok(result);
    assert.deepEqual(result.data,pixels);assert.equal(result.width,4);assert.equal(result.height,4);
  }
});
test('same-sized but corrupt packed bytes fail the checksum and use the original path',async()=>{
  for(const decoded of [false,true])assert.equal(await fixture({corrupt:true,decoded}).load(),null);
});
test('a missing asset returns the original path',async()=>{
  assert.equal(await fixture({missing:true}).load(),null);
});
test('the optional download deadline covers a stalled response body',async()=>{
  const f=fixture({stall:true});assert.equal(await f.load(),null);assert.equal(f.state.aborted,true);
});
test('a browser without decompression keeps the original path without downloads',async()=>{
  const f=fixture({unsupported:true});assert.equal(await f.load(),null);assert.equal(f.calls.length,0);
});
