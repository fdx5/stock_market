import type { CarProfile } from "./carProfiles";
import type { Sound } from "./sound";

const ROOT="/3d/walk/cars/audio/";
const NAMES=["small-idle","small-load-steady","sedan-idle","sedan-load-steady","v8-idle","v8-load-steady","sport-idle","sport-load-steady","race-idle","race-load-steady","van-idle","van-load-steady","truck-idle","truck-load-steady","heavy-idle","heavy-load-steady","ev-idle","ev-load-steady","road","skid","door","ignition"];
const recordings=new Map<string,AudioBuffer>();let loading:Promise<void>|null=null;
/** Decode at loading time, at most three downloads/decodes in flight. */
export function loadCarRecordings(){
  if(loading)return loading;
  loading=(async()=>{const decoder=new OfflineAudioContext(1,1,48000);let next=0;await Promise.all(Array.from({length:3},async()=>{while(next<NAMES.length){const name=NAMES[next++],r=await fetch(ROOT+name+".wav");if(!r.ok)throw Error("Vehicle recording "+name+": "+r.status);const buffer=await decoder.decodeAudioData(await r.arrayBuffer());if(name!=="door"&&name!=="ignition")closeLoop(buffer);recordings.set(name,buffer);}}));})().catch(error=>{loading=null;throw error;});
  return loading;
}
/** A loop's last 50 ms bent toward its first sample: the step where it wraps (up to a tenth of full
 * scale) clicked once a loop under the engine. */
function closeLoop(buffer:AudioBuffer){
  for(let ch=0;ch<buffer.numberOfChannels;ch++){const d=buffer.getChannelData(ch),n=Math.min(d.length>>2,Math.round(buffer.sampleRate*.05)),step=d[0]-d[d.length-1];
    for(let i=0;i<n;i++)d[d.length-n+i]+=step*((i+1)/n);}
}
export function playCarEffect(name:"door"|"ignition"|"impact",sound:Sound,level=1){
  const graph=sound.audioGraph,buffer=recordings.get(name==="impact"?"door":name);if(!graph||!buffer)return;
  const source=graph.ctx.createBufferSource(),gain=graph.ctx.createGain();source.buffer=buffer;source.playbackRate.value=name==="impact"?.63:1;
  gain.gain.value=(name==="impact"?.60:name==="ignition"?.24:.36)*Math.min(1.4,level);source.connect(gain);gain.connect(graph.output);source.onended=()=>{source.disconnect();gain.disconnect();};source.start();
}
interface Track {source:AudioBufferSourceNode;gain:GainNode}
/** One engine voice, not a stack of loops: the car's own steady engine recording (its idle loop —
 * the steadiest, no swell to repeat) played faster with the revs, louder and brighter under the
 * throttle, quieter and duller lifting off (engine braking), the revs dipping at each shift and
 * flaring with the throttle at a standstill. Beside it only what a real car adds: the tyres on the
 * road, rising with speed, and under the brakes a soft brake hiss — a squeal of the tyres only
 * when they slide (a hard stop at speed, the handbrake, a drift). Recordings only. */
export class CarAudio {
  private nodes:AudioNode[]=[];private tracks:Track[]=[];private engineGain:GainNode;private filter:BiquadFilterNode;
  private brakeFilter:BiquadFilterNode;private last=-Infinity;private pitch:number;readonly bank:string;
  private rpm=.12;private lastT=0;
  constructor(private ctx:AudioContext,output:AudioNode,_noise:AudioBuffer,private profile:CarProfile){
    const label=profile.spec.label;
    this.bank=profile.engine==="ev"?"ev":profile.engine==="truck"?(/container|mixer|garbage|bus/.test(label)?"heavy":"truck"):profile.engine==="diesel"?"van":profile.engine==="sport"?["v8","sport","race"][profile.seed%3]:/hatch|kei|compact|city/.test(label)?"small":/luxury|executive|large|premium/.test(label)?"v8":"sedan";
    this.pitch=.97+(profile.seed%9)*.007;
    const limiter=ctx.createDynamicsCompressor();limiter.threshold.value=-6;limiter.knee.value=6;limiter.ratio.value=6;limiter.attack.value=.004;limiter.release.value=.2;limiter.connect(output);
    // the engine: one source → its tone (low-pass, opened by the throttle) → its level
    this.filter=ctx.createBiquadFilter();this.filter.type="lowpass";this.filter.frequency.value=1400;this.filter.Q.value=.5;
    this.engineGain=ctx.createGain();this.engineGain.gain.value=0;
    this.filter.connect(this.engineGain);this.engineGain.connect(limiter);
    // the brakes' hiss and the tyres' squeal: the skid recording through a band filter
    this.brakeFilter=ctx.createBiquadFilter();this.brakeFilter.type="bandpass";this.brakeFilter.frequency.value=1800;this.brakeFilter.Q.value=.8;this.brakeFilter.connect(limiter);
    this.nodes.push(limiter,this.filter,this.engineGain,this.brakeFilter);
    const add=(name:string,to:AudioNode)=>{
      const buffer=recordings.get(name);if(!buffer)throw Error("Vehicle audio not prepared: "+name);
      const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=buffer;source.loop=true;gain.gain.value=0;source.connect(gain);gain.connect(to);source.start(ctx.currentTime,Math.random()*buffer.duration*.5);
      this.tracks.push({source,gain});this.nodes.push(source,gain);
    };
    add(this.bank+"-idle",this.filter);add("road",limiter);add("skid",this.brakeFilter);
    this.tracks[0].gain.gain.value=1;
  }
  update(revs:number,throttle:number,speed:number,braking:boolean,slip:number,inside=false){
    const t=this.ctx.currentTime;if(t-this.last<.03)return;const dt=Math.min(.2,t-(this.lastT||t));this.last=t;this.lastT=t;
    const ev=this.profile.engine==="ev",v=Math.abs(speed),load=Math.max(0,Math.min(1,throttle)),gearRevs=Math.max(0,Math.min(1,revs));
    // (the revs: the gear's share, and at a standstill or a crawl what the throttle asks; eased —
    // quick to rise with the throttle, slower to fall, a shift a quick dip)
    const want=Math.max(v<2?.12+load*.55:gearRevs,.12);
    this.rpm+=(want-this.rpm)*Math.min(1,dt*(want>this.rpm?(load>0?7:4):5));
    const r=this.rpm,kv=Math.min(1,v/40);
    const set=(param:AudioParam,value:number,fade=.06)=>{param.cancelScheduledValues(t);param.setTargetAtTime(value,t,fade);};
    const [engine,road,squeal]=this.tracks;
    // pitch with the revs (an EV's motor whine narrower), level and brightness with the load
    set(engine.source.playbackRate,this.pitch*(ev?.85+r*.75:.82+r*1.35),.05);
    set(this.engineGain.gain,(inside?.7:1)*(ev?.05+.16*load+.08*kv:.11+.2*load*(.45+.55*r)+.05*r),.07);
    set(this.filter.frequency,(inside?.55:1)*(ev?2400+2600*load:700+2600*load*(.5+.5*r)+900*r),.08);
    // the tyres on the road, with speed
    set(road.gain.gain,.11*Math.pow(kv,1.2),.15);set(road.source.playbackRate,.85+kv*.25,.2);
    // under the brakes at speed a soft hiss; sliding tyres a squeal
    const brakeK=braking&&v>3?Math.min(1,v/25):0,slide=Math.max(0,slip-.25);
    set(squeal.gain.gain,Math.min(.22,brakeK*.035+slide*.28),.05);
    set(this.brakeFilter.frequency,slide>.05?2600:1500,.1);set(this.brakeFilter.Q,slide>.05?3:.7,.1);
    set(squeal.source.playbackRate,.9+Math.min(.2,v/120),.1);
  }
  stop(){const t=this.ctx.currentTime;this.engineGain.gain.cancelScheduledValues(t);this.engineGain.gain.setTargetAtTime(0,t,.025);for(const k of this.tracks){k.gain.gain.cancelScheduledValues(t);k.gain.gain.setTargetAtTime(0,t,.025);}}
  dispose(){for(const track of this.tracks){try{track.source.stop();}catch{/*already stopped*/}}this.nodes.forEach(n=>n.disconnect());this.tracks.length=0;}
}

/** A crash, made here: the body's thump, the crumple of sheet metal (bursts of band noise falling
 * in pitch), on a car a tinkle of glass after; on foot or a bike a lighter knock. `level` 0…1.5. */
export function crashSound(ctx:AudioContext,output:AudioNode,level:number,car:boolean){
  const t=ctx.currentTime,len=Math.floor(ctx.sampleRate*1.2),buf=ctx.createBuffer(1,len,ctx.sampleRate),d=buf.getChannelData(0);
  for(let i=0;i<len;i++)d[i]=Math.random()*2-1;
  const burst=(at:number,dur:number,f0:number,f1:number,q:number,gain:number,type:BiquadFilterType="bandpass")=>{
    const src=ctx.createBufferSource();src.buffer=buf;const f=ctx.createBiquadFilter();f.type=type;f.Q.value=q;f.frequency.setValueAtTime(f0,t+at);f.frequency.exponentialRampToValueAtTime(f1,t+at+dur);
    const g=ctx.createGain();g.gain.setValueAtTime(0,t+at);g.gain.linearRampToValueAtTime(gain,t+at+.006);g.gain.exponentialRampToValueAtTime(.0001,t+at+dur);
    src.connect(f);f.connect(g);g.connect(output);src.start(t+at,Math.random()*.5);src.stop(t+at+dur+.05);src.onended=()=>{src.disconnect();f.disconnect();g.disconnect();};
  };
  const k=Math.min(1.5,level);
  // (the thump: a low body blow)
  const o=ctx.createOscillator(),og=ctx.createGain();o.frequency.setValueAtTime(car?90:140,t);o.frequency.exponentialRampToValueAtTime(38,t+.25);og.gain.setValueAtTime(.55*k,t);og.gain.exponentialRampToValueAtTime(.0001,t+.3);o.connect(og);og.connect(output);o.start(t);o.stop(t+.32);
  burst(0,.22,600,120,.9,.5*k,"lowpass");
  if(car){
    for(let i=0;i<5;i++)burst(.01+i*.035+Math.random()*.02,.12+Math.random()*.1,2600-i*300,700,2.5,.22*k);
    burst(.03,.5,3000,1200,1.2,.12*k);
    if(level>.45)for(let i=0;i<10;i++)burst(.12+i*.04+Math.random()*.05,.05,5200+Math.random()*3000,4200,8,.08*k);
  } else burst(.01,.1,1800,900,2,.15*k);
}
