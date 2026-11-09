/**
 * LIQUIDITY SILK — tens of thousands of particles drift through a
 * divergence-free "capital flow" field. Four meandering rivers of liquidity
 * carry most of them; slow eddies peel off, a cursor stirs a vortex, and a
 * rare surge travels along one river. Trails accumulate like a long exposure.
 */

export const RIVERS = 4;

const NOISE = `
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float hash12(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
`;

/** Field coordinates: x in [0, aspect], y in [0, 1] bottom-up. */
const FIELD = `
uniform float u_time;
uniform float u_aspect;
uniform vec4 u_pulse;   // x position, river, strength, -
uniform vec3 u_pointer; // x, y, strength
const float BASE[${RIVERS}]=float[${RIVERS}](.2,.41,.61,.81);
const float WIDTH[${RIVERS}]=float[${RIVERS}](.03,.045,.026,.04);
const float SPEED[${RIVERS}]=float[${RIVERS}](.2,.15,.18,.14);
float riverY(int i,float x){
  float fi=float(i),t=u_time;
  float dir=mod(fi,2.)<.5?1.:-1.;
  return BASE[i]+.135*sin(x*(.95+fi*.21)+t*.07*dir+fi*1.7)+.055*sin(x*2.3-t*.1+fi*4.)+.02*sin(x*5.1+t*.06+fi);
}
float stream(vec2 p){
  float psi=.012*p.y;
  for(int i=0;i<${RIVERS};i++){
    float w=WIDTH[i];
    float a=SPEED[i];
    if(float(i)==u_pulse.y)a*=1.+.7*u_pulse.z*exp(-pow(p.x-u_pulse.x,2.)/.05);
    psi+=a*w*tanh((p.y-riverY(i,p.x))/w);
  }
  float t=u_time;
  psi+=.011*snoise(vec3(p*1.5,t*.04))+.0035*snoise(vec3(p*3.4+7.,t*.07));
  vec2 e1=vec2(u_aspect*(.5+.36*sin(t*.021)),.5+.26*sin(t*.029+1.));
  vec2 e2=vec2(u_aspect*(.5+.38*sin(t*.017+2.6)),.5+.3*sin(t*.025+4.));
  psi+=.0045*sin(t*.043)*exp(-dot(p-e1,p-e1)/.02);
  psi-=.004*sin(t*.037+1.3)*exp(-dot(p-e2,p-e2)/.016);
  vec2 q=p-u_pointer.xy;
  psi+=u_pointer.z*.0035*exp(-dot(q,q)/.01);
  return psi;
}
vec2 flow(vec2 p){
  const float e=.0025;
  float dx=stream(p+vec2(e,0.))-stream(p-vec2(e,0.));
  float dy=stream(p+vec2(0.,e))-stream(p-vec2(0.,e));
  return vec2(dy,-dx)/(2.*e);
}
`;

export const QUAD_VERTEX = `#version 300 es
in vec2 a_pos;out vec2 v_uv;
void main(){v_uv=a_pos*.5+.5;gl_Position=vec4(a_pos,0.,1.);}`;

export const UPDATE_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D u_state;
uniform sampler2D u_motion;
uniform float u_dt;
uniform float u_drift;
uniform float u_frame;
${NOISE}
${FIELD}
layout(location=0) out vec4 o_state;
layout(location=1) out vec4 o_motion;
void main(){
  ivec2 tc=ivec2(gl_FragCoord.xy);
  vec4 s=texelFetch(u_state,tc,0);
  vec4 m=texelFetch(u_motion,tc,0);
  vec2 p=s.xy;
  float age=s.z+u_dt,life=m.w;
  vec2 v=flow(p);
  v.y+=u_drift;
  p+=v*u_dt;
  bool out_=p.x<-.04||p.x>u_aspect+.04||p.y<-.04||p.y>1.04;
  if(age>life||out_){
    vec2 seed=vec2(gl_FragCoord.xy)+u_frame*vec2(1.618,2.414);
    float r0=hash12(seed),r1=hash12(seed+11.3),r2=hash12(seed+27.1),r3=hash12(seed+43.7),r4=hash12(seed+59.9);
    float river=r0<.8?floor(r1*${RIVERS}.):${RIVERS}.;
    p.x=pow(r2,1.3)*(u_aspect+.1)-.05;
    if(river<${RIVERS}.){
      int ri=int(river);
      float g=(r3+hash12(seed+71.)+hash12(seed+83.)-1.5)*1.6;
      p.y=riverY(ri,p.x)+g*WIDTH[ri];
    } else p.y=r3;
    age=0.;life=4.+r4*9.;
    s.w=river+fract(r1*7.31)*.9;
    v=flow(p);
  }
  o_state=vec4(p,age,s.w);
  o_motion=vec4(v,length(v),life);
}`;

export const PARTICLE_VERTEX = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D u_state;
uniform sampler2D u_motion;
uniform int u_texWidth;
uniform vec2 u_res;
uniform float u_aspect;
uniform float u_width;
uniform float u_dt;
uniform float u_gain;
uniform vec4 u_pulse;
out vec3 v_color;
out float v_side;
const vec3 PALETTE[5]=vec3[5](vec3(1.,.74,.38),vec3(.74,.48,1.),vec3(1.,.3,.68),vec3(.2,.9,1.),vec3(.4,.32,.62));
void main(){
  int id=gl_InstanceID;
  ivec2 tc=ivec2(id%u_texWidth,id/u_texWidth);
  vec4 s=texelFetch(u_state,tc,0);
  vec4 m=texelFetch(u_motion,tc,0);
  vec2 head=s.xy,tail=s.xy-m.xy*u_dt*1.15;
  vec2 hc=vec2(head.x/u_aspect,head.y)*2.-1.;
  vec2 tcp=vec2(tail.x/u_aspect,tail.y)*2.-1.;
  vec2 dpx=(hc-tcp)*u_res*.5;
  float len=length(dpx);
  vec2 dir=len>1e-4?dpx/len:vec2(1.,0.);
  vec2 n=vec2(-dir.y,dir.x);
  int corner=gl_VertexID;
  float along=(corner==2||corner==3)?1.:0.;
  float side=(corner==1||corner==3)?1.:-1.;
  vec2 base=mix(tcp,hc,along);
  vec2 px=dir*(along*2.-1.)*.6+n*side*(u_width*.5+.7);
  gl_Position=vec4(base+px/(u_res*.5),0.,1.);
  v_side=side*(u_width*.5+.7)/(u_width*.5);
  int river=int(floor(s.w));
  float age=s.z,life=m.w;
  float fade=smoothstep(0.,1.4,age)*smoothstep(life,life-1.8,age);
  // light deposited per frame follows distance travelled, so slow eddies never pile up into dots
  float energy=clamp(len*.5,0.,1.)*(.3+.7*smoothstep(.03,.22,m.z));
  vec3 c=PALETTE[river];
  float rise=clamp(m.y/(m.z+1e-4),-1.,1.);
  c=mix(c,vec3(1.,.42,.51),max(rise,0.)*.18);
  c=mix(c,vec3(.39,.67,1.),max(-rise,0.)*.18);
  float surge=float(river)==u_pulse.y?u_pulse.z*exp(-pow(head.x-u_pulse.x,2.)/.035):0.;
  c=mix(c,vec3(1.,.93,.86),surge*.3);
  float ambient=river==${RIVERS}?.35:1.;
  v_color=c*fade*energy*ambient*u_gain*(1.+surge*.65);
}`;

export const PARTICLE_FRAGMENT = `#version 300 es
precision highp float;
in vec3 v_color;in float v_side;out vec4 o;
void main(){float a=1.-smoothstep(.55,1.,abs(v_side));o=vec4(v_color*a,1.);}`;

export const DECAY_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_acc;uniform float u_decay;in vec2 v_uv;out vec4 o;
void main(){o=vec4(max(texture(u_acc,v_uv).rgb*u_decay-.0004,0.),1.);}`;

export const COMPOSITE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_acc;
uniform float u_time;
uniform float u_aspect;
uniform float u_exposure;
uniform float u_glow;
in vec2 v_uv;out vec4 o;
float hash12(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
void main(){
  vec2 uv=v_uv;
  vec2 q=vec2(uv.x*u_aspect,uv.y);
  vec3 bg=vec3(.043,.027,.055);
  vec2 g1=vec2(u_aspect*(.28+.08*sin(u_time*.013)),.7);
  vec2 g2=vec2(u_aspect*(.76+.06*sin(u_time*.011+2.)),.3);
  bg+=vec3(.07,.035,.1)*exp(-dot(q-g1,q-g1)*2.2);
  bg+=vec3(.06,.04,.05)*exp(-dot(q-g2,q-g2)*2.6);
  vec3 a=texture(u_acc,uv).rgb;
  vec3 halo=textureLod(u_acc,uv,3.).rgb*.55+textureLod(u_acc,uv,5.).rgb*.45;
  vec3 silk=1.-exp(-a*u_exposure);
  vec3 glow=(1.-exp(-halo*u_exposure*.8))*u_glow;
  vec3 c=bg+silk+glow;
  c+=(hash12(gl_FragCoord.xy+fract(u_time)*61.)-.5)/255.;
  o=vec4(c,1.);
}`;
