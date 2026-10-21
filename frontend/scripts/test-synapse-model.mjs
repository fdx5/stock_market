import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const output = await build({entryPoints:[fileURLToPath(new URL('../src/monitor/synapseModel.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {buildSynapseGraph,observedFlows,snapshotSignals,statsFor,httpLink,apiId}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
const node=(id,kind)=>({id,kind,label:id,description:id,subtitle:'',modules:[],endpoint_count:0,color:'#55cccc'});
const graph={nodes:[node('gateway','gateway'),node('market','service'),node('database','storage')],edges:[{id:'gateway:market',source:'gateway',target:'market',protocol:'REST',evidence:'route table'}],
  endpoints:[{path:'/api/quote',methods:['GET'],group:'market',module:'app.quote',function:'quote',dependencies:['app.quote']},{path:'/api/quote',methods:['POST'],group:'market',module:'app.quote',function:'quote_post',dependencies:['app.quote']}],
  modules:[{id:'app.quote',group:'market',file:'quote.py',imports:[],hosts:[],tables:[],cache:false}],frontend:{},backend_dependencies:{},coverage:{}};
const summary={count:0,errors:0,client_errors:0,avg_ms:null,last_at:null};
const request={id:1,ts:100,route:'/api/quote',method:'GET',status:200,ms:20,trace_id:1};
const http={id:2,ts:99,host:'observed-db.example',target:'database',method:'POST',status:503,ms:10,trace_id:1};
const unscoped={id:3,ts:99,host:'batch.example',method:'GET',status:200,ms:5};
const live={at:100,api:{...summary,recent:[request],groups:{},endpoints:[{...summary,path:'/api/quote',method:'GET',count:2,avg_ms:20},{...summary,path:'/api/quote',method:'POST',count:1,avg_ms:80}]},
  external:{...summary,recent:[http,unscoped],hosts:[],groups:{},flows:[]},traces:[{request,calls:[http]}]};
const flows=observedFlows(live),model=buildSynapseGraph(graph,flows);
assert.equal(model.nodes.filter(n=>n.id===apiId('/api/quote')).length,1,'One node per route, including multiple methods');
assert.equal(model.nodes[model.byId.get('host:observed-db.example')].group,'database','Use server-supplied host classification');
assert.equal(new Set(model.links.map(e=>e.id)).size,model.links.length,'No duplicate edges');
for(const e of model.links){assert.ok(model.nodes[e.source]);assert.ok(model.nodes[e.target]);assert.ok(model.adjacency.get(e.source).includes(model.links.indexOf(e)));}
const batch=model.links.find(e=>e.id===httpLink('','batch.example'));
assert.equal(model.nodes[batch.source].id,'unscoped-http','Unknown causality must not be attributed to an API');
const signals=snapshotSignals(live);
assert.equal(signals.length,3,'Deduplicate HTTP shared by recent journal and request trace');
assert.equal(signals.filter(s=>s.fault).length,1);
assert.equal(statsFor(model.nodes[model.byId.get(apiId('/api/quote'))],live).avg_ms,40,'Weighted average across methods');
assert.equal(statsFor(model.nodes[model.byId.get('unscoped-http')],live).count,1,'Unscoped HTTP is not API throughput');
assert.deepEqual(snapshotSignals(null),[],'No fabricated traffic during loading');
assert.deepEqual(observedFlows(null),[]);
console.log('Synapse model: route aggregation, graph integrity, causal HTTP mapping, unscoped calls, signal deduplication, weighted latency, empty state passed.');

const services=['market','community','realestate','prediction','operations','support'];
const sphereGraph={...graph,nodes:[node('gateway','gateway'),...services.map(id=>node(id,'service')),...Array.from({length:12},(_,i)=>node(`external-${i}`,'external'))],
  endpoints:Array.from({length:600},(_,i)=>({path:`/api/sphere/${i}`,methods:['GET'],group:services[i%6],module:'app.quote',function:'quote',dependencies:[]})),modules:[],edges:[]};
const sphere=buildSynapseGraph(sphereGraph),again=buildSynapseGraph(sphereGraph);
assert.deepEqual(sphere.nodes.map(n=>n.position),again.nodes.map(n=>n.position),'Inventory refreshes retain stable positions');
assert.ok(sphere.nodes.every(n=>n.position.every(Number.isFinite)));
const clouds=[sphere.domains,sphere.nodes.filter(n=>n.kind==='api')];
for(const cloud of clouds){
  const spans=[0,1,2].map(axis=>Math.max(...cloud.map(n=>n.position[axis]))-Math.min(...cloud.map(n=>n.position[axis])));
  assert.ok(Math.min(...spans)/Math.max(...spans)>.75,`Depth must match the other axes: ${spans}`);
  // Sweep every viewing azimuth: the topology must not collapse to a narrow side view.
  for(let i=0;i<24;i++){
    const angle=i/24*Math.PI*2;
    const horizontal=cloud.map(n=>n.position[0]*Math.cos(angle)+n.position[2]*Math.sin(angle));
    const width=Math.max(...horizontal)-Math.min(...horizontal);
    assert.ok(width/Math.max(...spans)>.7,`Thin side view at azimuth ${i}: ${width}`);
  }
}
assert.ok(sphere.nodes.every(n=>Math.hypot(...n.position)<=405),'All inventory items stay inside the spherical field');
console.log('Synapse sphere: stable inventory positions, XYZ depth, 24 side-view azimuths and field bounds passed.');
