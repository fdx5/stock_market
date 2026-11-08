// Pure procedural geometry validation. Never opens an application or database.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../src/neo/nanotubeGeometry.ts'),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const context={exports:{},Float32Array,Uint16Array};vm.runInNewContext(code,context);
const {NANOTUBES,buildNanotubeGeometry,geometryTransfers,fiberCount,surfaceCount,formId}=context.exports;
const geometry=buildNanotubeGeometry();assert.equal(geometry.tubes.length,4);
assert.equal(new Set(NANOTUBES.map(t=>t.radius)).size,4);assert.equal(new Set(NANOTUBES.map(t=>t.tempo)).size,4);
assert.equal(new Set(NANOTUBES.map(t=>t.form)).size,4,'each bundle has a distinct topology');
assert.deepEqual(Array.from(NANOTUBES,formId),[0,1,2,3]);
let bytes=0;
geometry.tubes.forEach((tube,i)=>{
  const vertices=tube.vertices.length/12,hullVertices=tube.hullVertices.length/3;
  assert.ok(vertices<=65536);assert.ok(hullVertices<=65536);
  assert.ok(tube.vertices.every(Number.isFinite));assert.ok(tube.hullVertices.every(Number.isFinite));
  assert.ok(tube.indices.every(index=>index<vertices));assert.ok(tube.haloIndices.every(index=>index<vertices));assert.ok(tube.hullIndices.every(index=>index<hullVertices));
  let internal=0;
  const branches=new Set();
  for(let offset=0;offset<tube.vertices.length;offset+=48){
    const v=tube.vertices;assert.equal(v[offset+8],i);assert.equal(v[offset+9],i);
    assert.ok(v[offset+10]>=0&&v[offset+10]<surfaceCount(NANOTUBES[i]));assert.ok(v[offset+11]>=0&&v[offset+11]<surfaceCount(NANOTUBES[i]));branches.add(v[offset+10]);
    if(v[offset+6]===3){internal++;assert.ok(v[offset]>=0&&v[offset]<1);assert.ok(v[offset+1]>=0&&v[offset+3]<=1);}
  }
  assert.equal(internal,fiberCount(NANOTUBES[i])*NANOTUBES[i].rows,'fiber count follows diameter, with no gaps in its axial segments');
  assert.equal(branches.size,surfaceCount(NANOTUBES[i]),'all helical and neural branches are present');
});
const connected=new Set();for(let offset=0;offset<geometry.links.vertices.length;offset+=48){const v=geometry.links.vertices;assert.equal(v[offset+9],v[offset+8]+1);connected.add(v[offset+8]);}
assert.equal(connected.size,3,'all four tubes belong to one connected scaffold');
assert.ok(geometry.links.indices.every(index=>index<geometry.links.vertices.length/12));
const transfers=geometryTransfers(geometry);assert.equal(transfers.length,22);assert.equal(new Set(transfers).size,22);transfers.forEach(buffer=>bytes+=buffer.byteLength);
const bySize=[...NANOTUBES].sort((a,b)=>a.radius-b.radius);for(let i=1;i<4;i++)assert.ok(fiberCount(bySize[i])>fiberCount(bySize[i-1]));
console.log(JSON.stringify({tubes:4,fibers:NANOTUBES.map(fiberCount),total_fibers:NANOTUBES.reduce((n,t)=>n+fiberCount(t),0),bonds:geometry.edgeCount,geometry_mib:+(bytes/1048576).toFixed(2),indices_valid:true,finite_vertices:true,connected_scaffold:true,worker_transfer_buffers:22,actual_gpu_fps_not_measured:true}));

const pulseSource=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/neo/nanotubePulse.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const pulseContext={exports:{},Float32Array};vm.runInNewContext(pulseSource,pulseContext);
const pulses=new pulseContext.exports.NanotubePulses(NANOTUBES.length),previous=Array(4).fill(null),starts=Array.from({length:4},()=>[]);
let checks=0;
for(let time=0;time<120;time+=.05){
 const data=pulses.sample(time);assert.equal(data.length,16);assert.ok(data.every(Number.isFinite));
 for(let i=0;i<4;i++){
  const position=data[i*4],weight=data[i*4+1],width=data[i*4+2],cycle=data[i*4+3],last=previous[i];
  assert.ok(weight>=0&&weight<=1.001);assert.ok(width>=.026&&width<=.0531);
  if(weight>0){
   if(last&&last.weight>0&&last.cycle===cycle){assert.ok(position<last.position,'signal must move from bottom to top');checks++;}
   else starts[i].push(+time.toFixed(2));
  }
  previous[i]={position,weight,cycle};
 }
}
assert.ok(checks>1000);assert.equal(new Set(starts.map(times=>times[0])).size,4,'independent launch times');
assert.ok(starts.every(times=>times.length>=10));assert.ok(starts.every(times=>new Set(times.slice(1).map((t,i)=>(t-times[i]).toFixed(1))).size>4),'irregular signal intervals');
console.log(JSON.stringify({signal_tubes:4,first_launch_seconds:starts.map(times=>times[0]),bottom_to_top_checks:checks,independent_irregular_intervals:true,finite_signal_uniforms:true}));
