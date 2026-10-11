import {useEffect,useRef} from 'react';

const vertex=`attribute vec2 a_position;
void main(){gl_Position=vec4(a_position,0.0,1.0);}`;
const fragment=`precision highp float;
uniform vec2 u_size;
uniform float u_time;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
 return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}
float cloud(vec2 p){float v=0.,a=.55;for(int i=0;i<3;i++){v+=noise(p)*a;p=p*2.07+vec2(4.3,1.7);a*=.48;}return v;}
vec3 spectrum(float h){
 float v=fract(h)*5.,f=fract(v);f=f*f*(3.-2.*f);
 vec3 blue=vec3(.025,.55,1.),violet=vec3(.55,.07,1.),pink=vec3(1.,.12,.47),gold=vec3(1.,.57,.09),mint=vec3(.05,.95,.83);
 if(v<1.)return mix(blue,violet,f);if(v<2.)return mix(violet,pink,f);
 if(v<3.)return mix(pink,gold,f);if(v<4.)return mix(gold,mint,f);return mix(mint,blue,f);
}
void main(){
 float t=u_time,engage=smoothstep(.55,1.65,t);
 vec2 uv=gl_FragCoord.xy/u_size;
 vec2 p=(uv-vec2(.5,.54))*vec2(u_size.x/u_size.y,1.);
 // A gently banking camera travels inside an illuminated, twisting cylinder.
 p-=vec2(sin(t*.63)*.018,cos(t*.47)*.011)*engage;
 float roll=sin(t*.42)*.085;
 p=mat2(cos(roll),-sin(roll),sin(roll),cos(roll))*p;
 p.y*=1.12;
 float r=max(length(p),.007),a=atan(p.y,p.x);
 float z=1./(r+.055),travel=t*(1.1+engage*2.6);
 float bend=sin(z*.42-travel*.23)*.23;
 float theta=a+z*.15+bend+t*.1;
 vec3 colour=vec3(.002,.004,.016);
 // Several translucent cloud strata supply depth, irregular energy currents,
 // and broad jewel-coloured light instead of a flat set of coloured spokes.
 for(int layer=0;layer<4;layer++){
  float l=float(layer),d=z*(.74+l*.12),turn=theta+l*.57;
  vec2 q=vec2(cos(turn)*3.1+sin(d*.3)*.9,sin(turn)*3.1+d*.62-travel*(.8+l*.06));
  float n=cloud(q+vec2(l*5.1,0.));
  float filaments=pow(.5+.5*sin(turn*12.+sin(d*1.8-travel)*1.5+n*5.),8.);
  float ripples=pow(.5+.5*sin(d*9.-travel*7.+n*4.),10.);
  float hue=.23+sin(turn)*.21+cos(turn*2.)*.14+l*.035+d*.012-t*.018;
  vec3 pigment=mix(spectrum(hue),vec3(.23,.65,1.),.12);
  float density=(.18+n*n*1.35+filaments*.95+ripples*.12);
  float body=smoothstep(.025,.2,r)*(1.-smoothstep(.55,1.05,r));
  colour+=pigment*density*body*(.18+engage*.42)/(1.+l*.6);
 }
 // Narrow luminous membranes recede around the dark, far-away aperture.
 float membranes=pow(.5+.5*sin(z*13.-travel*10.+sin(theta*5.)*.9),22.);
 colour+=spectrum(sin(theta)*.18+z*.02+.23)*membranes*.2*engage*smoothstep(.07,.22,r);
 float core=exp(-r*r*80.);
 colour+=vec3(.04,.24,.5)*core*(.15+engage*.24);
 float charge=(1.-smoothstep(.75,1.55,t))*smoothstep(0.,.45,t);
 float aperture=exp(-pow((r-(.09+charge*.05))*28.,2.));
 colour+=vec3(.32,.72,1.)*aperture*charge*2.;
 float ignition=exp(-pow((t-1.28)*5.,2.));
 colour+=vec3(.5,.85,1.)*ignition*(exp(-r*r*5.)+exp(-abs(p.y)*170.)*.8);
 // Cinematic exposure preserves a dark center and bright, coloured walls.
 colour=1.-exp(-colour*1.12);
 colour*=1.-smoothstep(.55,1.3,r)*.7;
 colour+=vec3(hash(gl_FragCoord.xy+floor(t*30.))-.5)*.012;
 gl_FragColor=vec4(max(colour,vec3(0.)),1.);
}`;

/** One bounded procedural GPU pass. Real screen DPR; no textures or downloads.
 * Its owned WebGL resources/context are released when the transition ends. */
export default function DroneWarpTunnel(){
  const canvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const el=canvas.current;if(!el)return;
    const gl=el.getContext('webgl',{alpha:false,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false});
    if(!gl){el.dataset.renderer='fallback';return;}
    const motion=matchMedia('(prefers-reduced-motion: reduce)');
    let raf=0,width=0,height=0,last=-Infinity,draws=0,started=performance.now(),dead=false;
    const compile=(kind:number,source:string)=>{
      const shader=gl.createShader(kind);if(!shader)return null;
      gl.shaderSource(shader,source);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){gl.deleteShader(shader);return null;}
      return shader;
    };
    const vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment),program=gl.createProgram(),buffer=gl.createBuffer();
    const release=()=>{if(buffer)gl.deleteBuffer(buffer);if(program)gl.deleteProgram(program);if(vs)gl.deleteShader(vs);if(fs)gl.deleteShader(fs);if(!el.isConnected)gl.getExtension('WEBGL_lose_context')?.loseContext();};
    if(!vs||!fs||!program||!buffer){release();el.dataset.renderer='fallback';return;}
    gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)){release();el.dataset.renderer='fallback';return;}
    gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    const pos=gl.getAttribLocation(program,'a_position'),size=gl.getUniformLocation(program,'u_size'),time=gl.getUniformLocation(program,'u_time');
    gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
    el.dataset.renderer='webgl';
    const draw=(now:number)=>{
      if(!width||!height||dead||gl.isContextLost())return;
      gl.uniform2f(size,width,height);gl.uniform1f(time,motion.matches?2.8:(now-started)/1000);
      gl.drawArrays(gl.TRIANGLES,0,3);draws++;
      if(draws%30===0)el.dataset.draws=String(draws);
    };
    const tick=(now:number)=>{if(!document.hidden&&now-last>=1000/30){draw(now);last=now;}if(!motion.matches&&!dead)raf=requestAnimationFrame(tick);};
    const restart=()=>{cancelAnimationFrame(raf);el.dataset.motion=motion.matches?'reduced':'animated';draw(performance.now());if(!motion.matches&&!dead)raf=requestAnimationFrame(tick);};
    const resize=()=>{const b=el.getBoundingClientRect(),dpr=devicePixelRatio||1;width=Math.round(b.width*dpr);height=Math.round(b.height*dpr);el.width=width;el.height=height;gl.viewport(0,0,width,height);el.dataset.pixelRatio=String(dpr);restart();};
    const lost=(e:Event)=>{e.preventDefault();dead=true;cancelAnimationFrame(raf);el.dataset.renderer='fallback';};
    const observer=new ResizeObserver(resize);observer.observe(el);resize();
    el.addEventListener('webglcontextlost',lost);window.addEventListener('resize',resize);motion.addEventListener('change',restart);
    return()=>{dead=true;cancelAnimationFrame(raf);observer.disconnect();el.removeEventListener('webglcontextlost',lost);window.removeEventListener('resize',resize);motion.removeEventListener('change',restart);release();el.width=0;el.height=0;};
  },[]);
  return <canvas ref={canvas} className="drone-warp-tunnel" aria-hidden="true"/>;
}
