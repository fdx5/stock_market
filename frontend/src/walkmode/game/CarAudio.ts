import type { CarProfile } from "./carProfiles";
import type { Sound } from "./sound";

const ROOT="/3d/walk/cars/audio/";
const NAMES=["small-idle","small-load-steady","sedan-idle","sedan-load-steady","v8-idle","v8-load-steady","sport-idle","sport-load-steady","race-idle","race-load-steady","van-idle","van-load-steady","truck-idle","truck-load-steady","heavy-idle","heavy-load-steady","ev-idle","ev-load-steady","road","skid","door","ignition"];
const recordings=new Map<string,AudioBuffer>();let loading:Promise<void>|null=null;
/** Decode at loading time, at most three downloads/decodes in flight. */
export function loadCarRecordings(){
  if(loading)return loading;
  loading=(async()=>{const decoder=new OfflineAudioContext(1,1,48000);let next=0;await Promise.all(Array.from({length:3},async()=>{while(next<NAMES.length){const name=NAMES[next++],r=await fetch(ROOT+name+".wav");if(!r.ok)throw Error("Vehicle recording "+name+": "+r.status);recordings.set(name,await decoder.decodeAudioData(await r.arrayBuffer()));}}));})().catch(error=>{loading=null;throw error;});
  return loading;
}
export function playCarEffect(name:"door"|"ignition"|"impact",sound:Sound,level=1){
  const graph=sound.audioGraph,buffer=recordings.get(name==="impact"?"door":name);if(!graph||!buffer)return;
  const source=graph.ctx.createBufferSource(),gain=graph.ctx.createGain();source.buffer=buffer;source.playbackRate.value=name==="impact"?.63:1;
  gain.gain.value=(name==="impact"?.60:name==="ignition"?.24:.36)*Math.min(1.4,level);source.connect(gain);gain.connect(graph.output);source.onended=()=>{source.disconnect();gain.disconnect();};source.start();
}
interface Track {source:AudioBufferSourceNode;gain:GainNode}
/** Actual vehicle field recordings only. Idle, loaded engine and overrun are
 * crossfaded; no oscillator/noise generator remains in the vehicle audio graph. */
export class CarAudio {
  private nodes:AudioNode[]=[];private tracks:Track[]=[];private engineGain:GainNode;private filter:BiquadFilterNode;
  private last=-Infinity;private pitch:number;readonly bank:string;
  constructor(private ctx:AudioContext,output:AudioNode,_noise:AudioBuffer,private profile:CarProfile){
    const label=profile.spec.label;
    this.bank=profile.engine==="ev"?"ev":profile.engine==="truck"?(/container|mixer|garbage|bus/.test(label)?"heavy":"truck"):profile.engine==="diesel"?"van":profile.engine==="sport"?["v8","sport","race"][profile.seed%3]:/hatch|kei|compact|city/.test(label)?"small":/luxury|executive|large|premium/.test(label)?"v8":"sedan";
    this.pitch=.97+(profile.seed%9)*.007;
    this.engineGain=ctx.createGain();this.engineGain.gain.value=.9;this.filter=ctx.createBiquadFilter();this.filter.type="lowpass";this.filter.frequency.value=5000;
    const limiter=ctx.createDynamicsCompressor();limiter.threshold.value=-3;limiter.knee.value=3;limiter.ratio.value=8;limiter.attack.value=.003;limiter.release.value=.15;
    this.filter.connect(this.engineGain);this.engineGain.connect(limiter);limiter.connect(output);this.nodes.push(this.filter,this.engineGain,limiter);
    for(const name of [this.bank+"-idle",this.bank+"-load-steady",this.bank+"-idle","road","skid"]){
      const buffer=recordings.get(name);if(!buffer)throw Error("Vehicle audio not prepared: "+name);
      const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=buffer;source.loop=true;gain.gain.value=0;source.connect(gain);gain.connect(this.filter);source.start(ctx.currentTime,0);
      this.tracks.push({source,gain});this.nodes.push(source,gain);
    }
  }
  update(revs:number,throttle:number,speed:number,braking:boolean,slip:number,inside=false){
    const t=this.ctx.currentTime;if(t-this.last<.035)return;this.last=t;
    const ev=this.profile.engine==="ev",v=Math.min(1,Math.abs(speed)/55),load=Math.max(0,Math.min(1,throttle)),r=Math.max(0,Math.min(1,revs));
    const levels=[ev?.006:.16*(1-r*.65),(ev?.24:.36)*load*(.24+r*.76),ev?.06*v:(1-load)*(.05+r*.13)*Math.min(1,Math.abs(speed)),.14*Math.pow(v,1.3),Math.min(.24,Math.max(0,slip-.25)*.30+(braking&&Math.abs(speed)>9?.025:0))];
    const target=(param:AudioParam,value:number,fade=.12)=>{param.cancelScheduledValues(t);param.setTargetAtTime(value,t,fade);};
    target(this.engineGain.gain,inside?.68:.85);target(this.filter.frequency,inside?2200:4400);
    this.tracks.forEach((track,i)=>{target(track.gain.gain,levels[i]);target(track.source.playbackRate,i===0?this.pitch*(.94+r*.16):i===1?this.pitch*(.78+r*.60):i===2?this.pitch*(.96+r*.35):i===3?.88+v*.18:.94+v*.10,.18);});
  }
  stop(){const t=this.ctx.currentTime;this.engineGain.gain.cancelScheduledValues(t);this.engineGain.gain.setTargetAtTime(0,t,.025);}
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
