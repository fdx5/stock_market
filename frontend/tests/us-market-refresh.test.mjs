import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

// Exercise the real shared hooks and visibility scheduler against a fake clock and
// memory-only API. No browser, backend process or saved store is used.
let moduleId = 0;
const flush = async () => { for (let i=0;i<12;i++) await Promise.resolve(); };
function runtime(api) {
  let now=0, id=0;
  const timers=new Map(), listeners=new Map();
  const rt={api,states:[],effects:[],cleanups:[],requests:[]};
  globalThis.__usQuoteTest=rt;
  globalThis.document={visibilityState:'visible',addEventListener:(name,fn)=>listeners.set(fn,name),removeEventListener:(_name,fn)=>listeners.delete(fn)};
  const schedule=(fn,ms,interval=0)=>{timers.set(++id,{fn,at:now+ms,interval});return id;};
  globalThis.window={setTimeout:(fn,ms)=>schedule(fn,ms),clearTimeout:(key)=>timers.delete(key),setInterval:(fn,ms)=>schedule(fn,ms,ms),clearInterval:(key)=>timers.delete(key)};
  rt.advance=async(ms)=>{
    const end=now+ms;
    while(true){
      const entry=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!entry)break;
      const [key,timer]=entry; now=timer.at;
      if(timer.interval)timer.at+=timer.interval;else timers.delete(key);
      timer.fn();await flush();
    }
    now=end;await flush();
  };
  rt.mount=async()=>{for(const effect of rt.effects.splice(0))rt.cleanups.push(effect());await flush();};
  rt.unmount=()=>{for(const cleanup of rt.cleanups.splice(0))cleanup?.();};
  rt.visible=(value)=>{document.visibilityState=value;for(const fn of listeners.keys())fn();};
  return rt;
}
async function hooks(name) {
  const result=await build({entryPoints:[new URL(`../src/${name}.ts`,import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'memory-hook-environment',setup(b){
    b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'fixture'}));
    b.onResolve({filter:/api\/client$/},()=>({path:'api',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='react' ? `
      export const useEffect=(effect)=>globalThis.__usQuoteTest.effects.push(effect);
      export const useState=(initial)=>{const rt=globalThis.__usQuoteTest;const i=rt.states.length;rt.states.push(initial);return [initial,(next)=>{rt.states[i]=typeof next==='function'?next(rt.states[i]):next;}];};
    ` : `export const api=new Proxy({}, {get:(_target,name)=>(...args)=>globalThis.__usQuoteTest.api[name](...args)});`}));
  }}]});
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text+`\n// module ${++moduleId}`).toString('base64')}`);
}

test('ticker subscribers share one poller; partial and older replies preserve newer prices',async()=>{
  let calls=0;
  const replies=[
    [{symbol:'ES=F',price:100,quote_time:10},{symbol:'NQ=F',price:200,quote_time:10}],
    [{symbol:'ES=F',price:101,quote_time:20}],
    [{symbol:'ES=F',price:99,quote_time:5}],
  ];
  const rt=runtime({marketTicker:async()=>({items:replies[Math.min(calls++,2)]})});
  const {useMarketTicker}=await hooks('useMarketTicker');
  useMarketTicker();await rt.mount();
  useMarketTicker();await rt.mount();
  assert.equal(calls,1);assert.equal(rt.states[1].length,2);
  await rt.advance(5000);
  assert.deepEqual(rt.states[0].map(q=>q.price),[101,200]);
  await rt.advance(5000);
  assert.deepEqual(rt.states[1].map(q=>q.price),[101,200]);
  rt.unmount();await rt.advance(30000);assert.equal(calls,3);
});

test('a slow ticker response never starts overlapping requests',async()=>{
  let calls=0,resolve;
  const rt=runtime({marketTicker:()=>{calls++;return new Promise(done=>{resolve=done;});}});
  const {useMarketTicker}=await hooks('useMarketTicker');useMarketTicker();await rt.mount();
  await rt.advance(20000);assert.equal(calls,1);
  resolve({items:[{symbol:'ES=F',price:100,quote_time:10}]});await flush();
  await rt.advance(5000);assert.equal(calls,2);rt.unmount();resolve({items:[]});await flush();
});

test('hidden tabs pause polling and resume with current prices',async()=>{
  let calls=0;
  const rt=runtime({marketTicker:async()=>({items:[{symbol:'NQ=F',price:++calls,quote_time:calls}]})});
  const {useMarketTicker}=await hooks('useMarketTicker');useMarketTicker();await rt.mount();
  rt.visible('hidden');await rt.advance(30000);assert.equal(calls,1);
  rt.visible('visible');await rt.advance(0);assert.equal(calls,2);assert.equal(rt.states[0][0].price,2);rt.unmount();
});

test('one failed index does not block the other index from updating',async()=>{
  let tick=0;
  const row=(code,close)=>({code,close,change_pct:close,marcap:1});
  const rt=runtime({
    sp500Map:async()=>{if(tick)throw new Error('fixture failure');return {items:[row('AAPL',100)],session:'post',generated_at:'t1'};},
    nasdaq100Map:async()=>({items:[row('NVDA',200+tick)],session:'post',generated_at:'t2'}),
  });
  const {useUsMarketSnapshot}=await hooks('useUsMarketSnapshot');useUsMarketSnapshot();await rt.mount();
  assert.equal(rt.states[0].all.length,2);tick=1;await rt.advance(10000);
  assert.equal(rt.states[0].sp500[0].close,100);assert.equal(rt.states[0].nasdaq[0].close,201);
  rt.unmount();
});
