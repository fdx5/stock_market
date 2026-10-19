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
