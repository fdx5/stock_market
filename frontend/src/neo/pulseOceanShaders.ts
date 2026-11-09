/**
 * PULSE OCEAN — a physically based sea for the pulse board (WebGL2).
 *
 * Simulation (Tessendorf): a JONSWAP wind sea plus a long swell is sampled into three
 * wavelength cascades. Every frame the spectrum is advanced with deep-water dispersion and
 * eight real fields (height, choppy displacement, slopes, displacement Jacobian) are packed
 * into four complex fields and brought back to space by one Stockham FFT over an atlas that
 * stacks all cascades (18 full-screen passes in total, whatever the cascade count).
 * Breaking crests, where the Jacobian folds, inject foam that decays in place.
 *
 * Rendering: a projected screen-space grid displaced by the cascades, Fresnel sky reflection,
 * GGX sun glitter widened with distance, crest subsurface scattering, lacy foam, spray
 * particles flung from breaking crests, and heartbeat ring waves that keep the market pulse.
 */

export const OCEAN_PULSES = 8;

const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
`;
const CONST = `
const float PI=3.14159265359;
const float G=9.81;
vec2 cmul(vec2 a,vec2 b){return vec2(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x);}
`;
const PCG = `
uvec2 pcg2d(uvec2 v){
  v=v*1664525u+1013904223u;
  v.x+=v.y*1664525u;v.y+=v.x*1664525u;
  v=v^(v>>16u);
  v.x+=v.y*1664525u;v.y+=v.x*1664525u;
  v=v^(v>>16u);
  return v;
}
`;

export const FULLSCREEN_VERTEX = `${HEADER}
in vec2 a_pos;
void main(){gl_Position=vec4(a_pos,0.,1.);}`;

/** Initial spectrum h0(k) and conj(h0(-k)) for every cascade, stacked vertically (N x N*C). */
export const SPECTRUM_FRAGMENT = `${HEADER}${CONST}${PCG}
uniform int u_N;
uniform float u_L[3];
uniform float u_cut[4];
uniform vec4 u_sea;     // wind wp, alpha, spread s, spread norm
uniform vec4 u_swell;   // swell wp, alpha, spread s, spread norm
uniform vec4 u_dirs;    // wind dir xy, swell dir xy
uniform float u_scale;
uniform uint u_seed;
out vec4 o;
vec2 gauss(ivec2 nm,int c){
  uvec2 h=pcg2d(uvec2(nm+ivec2(4096,4096+c*8192))+uvec2(u_seed,0u));
  vec2 u=vec2(h)*(1./4294967296.);
  float r=sqrt(-2.*log(max(u.x,1e-7)));
  return r*vec2(cos(2.*PI*u.y),sin(2.*PI*u.y));
}
float jonswap(float w,float wp,float alpha,float gamma){
  float s=w<=wp?.07:.09;
  float r=exp(-(w-wp)*(w-wp)/(2.*s*s*wp*wp));
  return alpha*G*G/pow(w,5.)*exp(-1.25*pow(wp/w,4.))*pow(gamma,r);
}
float spreading(vec2 kd,vec2 d,float s,float norm){
  float half_=sqrt(max(0.,(1.+dot(kd,d))*.5));
  return norm*pow(half_,2.*s);
}
vec2 h0(ivec2 nm,int c){
  int N=u_N;
  if(abs(nm.x)==N/2||abs(nm.y)==N/2)return vec2(0.);
  float dk=2.*PI/u_L[c];
  vec2 k=vec2(nm)*dk;
  float kl=length(k);
  if(kl<1e-6||kl<u_cut[c]||kl>=u_cut[c+1])return vec2(0.);
  float w=sqrt(G*kl);
  vec2 kd=k/kl;
  float S=jonswap(w,u_sea.x,u_sea.y,3.3)*spreading(kd,u_dirs.xy,u_sea.z,u_sea.w)
         +jonswap(w,u_swell.x,u_swell.y,9.)*spreading(kd,u_dirs.zw,u_swell.z,u_swell.w);
  float Sk=S*(G/(2.*w))/kl*exp(-kl*kl*.0004);
  return gauss(nm,c)*sqrt(Sk*dk*dk*.25)*u_scale;
}
void main(){
  ivec2 px=ivec2(gl_FragCoord.xy);
  int N=u_N,c=px.y/N;
  ivec2 l=ivec2(px.x,px.y-c*N);
  ivec2 nm=ivec2(l.x<N/2?l.x:l.x-N,l.y<N/2?l.y:l.y-N);
  vec2 a=h0(nm,c),b=h0(-nm,c);
  o=vec4(a,b.x,-b.y);
}`;

/** h(k,t) by dispersion, expanded into four packed complex fields (eight real outputs). */
export const EVOLVE_FRAGMENT = `${HEADER}${CONST}
uniform sampler2D u_h0;
uniform int u_N;
uniform float u_L[3];
uniform float u_time;
layout(location=0) out vec4 o0;
layout(location=1) out vec4 o1;
void main(){
  ivec2 px=ivec2(gl_FragCoord.xy);
  int N=u_N,c=px.y/N;
  ivec2 l=ivec2(px.x,px.y-c*N);
  vec2 nm=vec2(l.x<N/2?l.x:l.x-N,l.y<N/2?l.y:l.y-N);
  vec4 s=texelFetch(u_h0,px,0);
  vec2 k=nm*(2.*PI/u_L[c]);
  float kl=length(k);
  // frequencies quantised to a 256 s loop keep the phase precise forever
  float w0=2.*PI/256.;
  float w=floor(sqrt(G*kl)/w0)*w0;
  float ph=w*u_time;
  vec2 e=vec2(cos(ph),sin(ph));
  vec2 h=cmul(s.xy,e)+cmul(s.zw,vec2(e.x,-e.y));
  vec2 kn=kl>1e-6?k/kl:vec2(0.);
  vec2 ih=vec2(-h.y,h.x);
  o0=vec4(h+kn.x*h, -kn.y*ih-k.x*h);              // (h + i Dx), (Dz + i dh/dx)
  o1=vec4(ih*(k.y+k.x*kn.x), (k.y*kn.y)*h+(k.x*kn.y)*ih); // (dh/dz + i dDx/dx), (dDz/dz + i dDx/dz)
}`;

/** One radix-2 Stockham stage of the inverse FFT, rows or (per cascade) columns. */
export const FFT_FRAGMENT = `${HEADER}${CONST}
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform int u_N;
uniform int u_size;
uniform int u_vertical;
layout(location=0) out vec4 o0;
layout(location=1) out vec4 o1;
void main(){
  ivec2 px=ivec2(gl_FragCoord.xy);
  int idx=u_vertical==1?px.y%u_N:px.x;
  int base=u_vertical==1?px.y-idx:0;
  int half_=u_size/2;
  int ei=(idx/u_size)*half_+idx%half_;
  int oi=ei+u_N/2;
  ivec2 pe=u_vertical==1?ivec2(px.x,base+ei):ivec2(ei,px.y);
  ivec2 po=u_vertical==1?ivec2(px.x,base+oi):ivec2(oi,px.y);
  float ang=2.*PI*float(idx%u_size)/float(u_size);
  vec2 tw=vec2(cos(ang),sin(ang));
  vec4 ea=texelFetch(u_a,pe,0),oa=texelFetch(u_a,po,0);
  vec4 eb=texelFetch(u_b,pe,0),ob=texelFetch(u_b,po,0);
  o0=vec4(ea.xy+cmul(tw,oa.xy),ea.zw+cmul(tw,oa.zw));
  o1=vec4(eb.xy+cmul(tw,ob.xy),eb.zw+cmul(tw,ob.zw));
}`;

/** Unpacks one cascade into filterable displacement + slope layers and advances its foam. */
export const ASSEMBLE_FRAGMENT = `${HEADER}
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform sampler2DArray u_prev;
uniform int u_N;
uniform int u_layer;
uniform float u_lambda;
uniform float u_decay;
uniform vec2 u_foam;   // threshold, gain
layout(location=0) out vec4 o0;
layout(location=1) out vec4 o1;
void main(){
  ivec2 p=ivec2(gl_FragCoord.xy);
  ivec2 q=ivec2(p.x,p.y+u_layer*u_N);
  vec4 a=texelFetch(u_a,q,0),b=texelFetch(u_b,q,0);
  float l=u_lambda;
  float Dxx=l*b.y,Dzz=l*b.z,Dxz=l*b.w;
  float J=(1.+Dxx)*(1.+Dzz)-Dxz*Dxz;
  float prev=texelFetch(u_prev,ivec3(p,u_layer),0).w;
  float inject=clamp((u_foam.x-J)*u_foam.y,0.,1.);
  float foam=max(prev*u_decay,inject);
  o0=vec4(l*a.y,a.x,l*a.z,foam);
  o1=vec4(a.w,b.x,Dxx,Dzz);
}`;

/** Tileable lacy foam: cell borders of two Worley layers (R fine lace, G coarse patches). */
export const FOAM_PATTERN_FRAGMENT = `${HEADER}${PCG}
uniform float u_size;
out vec4 o;
vec2 rnd(vec2 c){return vec2(pcg2d(uvec2(c+256.)))*(1./4294967296.);}
vec2 worley(vec2 p,float period){
  vec2 i=floor(p),f=fract(p);
  float d1=9.,d2=9.;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    vec2 g=vec2(x,y);
    vec2 cell=mod(i+g,period);
    vec2 r=g+rnd(cell)-f;
    float d=dot(r,r);
    if(d<d1){d2=d1;d1=d;}else if(d<d2)d2=d;
  }
  return sqrt(vec2(d1,d2));
}
void main(){
  vec2 uv=gl_FragCoord.xy/u_size;
  vec2 a=worley(uv*14.,14.),b=worley(uv*31.+.37,31.),c=worley(uv*6.,6.);
  float lace=smoothstep(.16,.02,a.y-a.x)*.75+smoothstep(.12,.0,b.y-b.x)*.55;
  float bubbles=smoothstep(.22,.05,b.x)*.35;
  float patch_=smoothstep(.95,.25,c.x);
  o=vec4(clamp(lace+bubbles,0.,1.),patch_,0.,1.);
}`;

const PALETTE = `
uniform vec3 u_zenith;
uniform vec3 u_horizonCol;
uniform vec3 u_band1;
uniform vec3 u_band2;
uniform vec3 u_hot;
uniform vec3 u_sunCol;
uniform vec3 u_sunDir;
uniform vec3 u_deep;
uniform vec3 u_scatter;
uniform float u_intensity;
vec3 sky(vec3 d){
  float e=d.y;
  float up=max(e,0.);
  vec3 c=mix(u_horizonCol,u_zenith,smoothstep(0.,.2,pow(up,.8)));
  c+=u_band1*exp(-abs(e)*16.)*.55+u_band2*exp(-abs(e)*55.)*.35;
  float sd=max(dot(d,u_sunDir),0.);
  float az=max(dot(normalize(d.xz+1e-5),normalize(u_sunDir.xz)),0.);
  c+=u_sunCol*(pow(sd,8.)*.04+pow(sd,64.)*.3+pow(az,12.)*exp(-abs(e)*30.)*.22);
  c+=u_sunCol*(smoothstep(.99988,.99996,sd)*5.+pow(sd,900.)*.6);
  return c;
}
vec3 tonemap(vec3 c){
  c*=u_intensity;
  vec3 x=c*(2.51*c+.03)/(c*(2.43*c+.59)+.14);
  return pow(clamp(x,0.,1.),vec3(1./2.2));
}
`;

const PULSE = `
uniform vec4 u_pulse[${OCEAN_PULSES}];
// ECG-shaped ring packet expanding from each pulse; returns (height, light)
vec2 pulseAt(vec2 xz){
  vec2 r=vec2(0.);
  for(int i=0;i<${OCEAN_PULSES};i++){
    vec4 p=u_pulse[i];
    if(p.w<=0.)continue;
    float d=length(xz-p.yz);
    float R=p.x*24.;
    float k=9.+R*.035;
    float s=(R-d)/k;
    if(s<-.6||s>2.8)continue;
    float e=.12*exp(-pow((s-.15)/.14,2.))-.22*exp(-pow((s-.48)/.08,2.))+exp(-pow((s-.64)/.09,2.))-.28*exp(-pow((s-.82)/.09,2.))+.2*exp(-pow((s-1.35)/.24,2.));
    float fall=p.w*exp(-R*.0042)*smoothstep(0.,.35,p.x);
    r.x+=e*.9*fall;
    r.y+=(max(e,0.)*.7+exp(-pow((s-.64)/.7,2.))*.2)*fall;
  }
  return r;
}
`;

export const SKY_FRAGMENT = `${HEADER}${PALETTE}
uniform vec2 u_res;
uniform float u_time;
uniform float u_F;
uniform float u_horizon;
uniform vec4 u_beacon[${OCEAN_PULSES}];
out vec4 o;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 w=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),w.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),w.x),w.y);}
float fbm3(vec2 p){float s=0.,a=.5;for(int i=0;i<3;i++){s+=a*vnoise(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return s;}
void main(){
  vec2 p=gl_FragCoord.xy/u_res*2.-1.;
  float aspect=u_res.x/u_res.y;
  vec3 d=normalize(vec3(p.x*aspect,p.y-u_horizon,u_F));
  vec3 c=sky(d);
  float h=d.y;
  if(h>0.){
    // high thin cloud streaks catching the low light
    float x=d.x/(h+.08);
    float cl=fbm3(vec2(x*1.4+u_time*.004,1./(h+.05)*.9));
    c+=u_band2*smoothstep(.5,.85,cl)*exp(-h*5.)*.16;
    // aurora curtains of order flow
    float drift=u_time*.018;
    float band=fbm3(vec2(p.x*aspect*.9+drift,drift*.6));
    float rays=fbm3(vec2(p.x*aspect*14.+band*3.,u_time*.08));
    c+=mix(u_band1,u_hot,.3)*smoothstep(.45,.8,band)*(.45+.75*rays*rays)*smoothstep(0.,.08,h)*exp(-h*3.)*.07;
    vec2 g=gl_FragCoord.xy/3.2;
    vec2 cell=floor(g/7.);
    float r=hash(cell);
    if(r>.955){
      vec2 off=vec2(hash(cell+3.1),hash(cell+8.7))*5.+1.;
      float dd=length(g-cell*7.-off);
      float tw=.55+.45*sin(u_time*(.3+r*.8)+r*40.);
      c+=vec3(.8,.78,1.)*exp(-dd*dd*5.)*tw*.05*smoothstep(.03,.3,h);
    }
    for(int i=0;i<${OCEAN_PULSES};i++){
      vec4 b=u_beacon[i];
      if(b.w<=0.)continue;
      float flash=exp(-b.x*.7)*smoothstep(0.,.6,b.x)*b.w*.09;
      float dx=abs(p.x-b.y)*aspect;
      float beam=exp(-dx*dx*2500.)*.7+exp(-dx*30.)*.25;
      float top=exp(-max(p.y-u_horizon,0.)*3.5);
      c+=u_hot*beam*top*flash*.9+u_band1*exp(-dx*6.)*exp(-h*14.)*flash*.3;
    }
  }
  o=vec4(tonemap(c)+(hash(gl_FragCoord.xy+fract(u_time))-.5)/255.,1.);
}`;

const CASCADE = `
uniform sampler2DArray u_disp;
uniform sampler2DArray u_deriv;
uniform float u_L[3];
uniform float u_texel;   // N
uniform vec3 u_cam;
uniform float u_F;
uniform float u_aspect;
uniform float u_horizon;
uniform vec2 u_res;
uniform vec4 u_ship;      // world x, z, heading cos, sin
uniform vec4 u_shipInfo;  // speed m/s, half length, half beam, active
uniform float u_wakeTime;
/* The ship's own waves: two Kelvin systems (bow, stern), the propeller wash and the bow wave
   folding along the hull. Returns (height m, foam, aeration). Free outside the ship's box. */
vec3 wakeAt(vec2 xz){
  if(u_shipInfo.w<=0.)return vec3(0.);
  vec2 rel=xz-u_ship.xy;
  float a=dot(rel,u_ship.zw);
  float c=dot(rel,vec2(-u_ship.w,u_ship.z));
  float L=u_shipInfo.y,B=u_shipInfo.z,U=clamp(u_shipInfo.x,2.,14.);
  if(a>L+60.||a<-L-1700.||abs(c)>750.)return vec3(0.);
  float ac=abs(c),k=9.81/(U*U);
  float h=0.,foam=0.,air=0.;
  // propeller wash: churned, aerated water widening astern
  float d=-a-L,ds=max(d,0.);
  // the wash meanders: its width breathes along the track instead of running ruler-straight
  float w=(B*.8+ds*.08)*(1.+.2*sin(ds*.045+1.3)+.12*sin(ds*.11+c*.03));
  float wash=exp(-c*c/(w*w))*smoothstep(-L*.7,40.,d)*exp(-ds/900.);
  // screw race: a twisting, boiling column right behind the stern, turning with the blades
  float race=exp(-c*c/(B*B*.35))*smoothstep(-L*.25,6.,d)*exp(-ds/150.);
  float twist=.5+.5*sin(ds*.55-u_wakeTime*9.+atan(c,6.)*3.);
  // ragged bright bands where the wash meets the undisturbed sea
  float edge=exp(-pow((abs(c)-w*.95)/(w*.16+2.),2.))*smoothstep(-L*.5,60.,d)*exp(-ds/700.);
  air+=wash+race*.6;
  // dense churn close astern, then a long, thinning tail
  foam+=wash*(1.6*exp(-ds/260.)+.55*exp(-ds/1100.))+race*(1.2+.8*twist)+edge*.45*exp(-ds/400.);
  h+=race*(twist-.5)*.6;
  for(int i=0;i<2;i++){
    float o=i==0?L*.97:-L;
    float dd=o-a;
    if(dd<0.)continue;
    float amp=(i==0?.75:.5)*clamp(U/7.,.5,1.4);
    float arm=ac-dd*.354-(i==0?B*.35:B*.95);
    float aw=5.+dd*.035;
    float armM=exp(-arm*arm/(aw*aw))*exp(-dd/1000.);
    float inside=smoothstep(6.,-25.,arm)*exp(-dd/520.);
    float crest=cos(k*(dd*.94+ac*.38)*1.2);
    // feathered divergent crests on the arms, transverse crests across the V
    h+=amp*(armM*crest*.85+inside*cos(k*dd)*.4)*smoothstep(0.,25.,dd);
    foam+=armM*smoothstep(520.,0.,dd)*(i==0?1.6:.95)*(.55+.45*crest);
  }
  // bow wave rolling back along both sides of the hull
  float fore=clamp((a-L*.35)/(L*.65),0.,1.);
  float hw=B*sqrt(max(0.,1.-fore*fore))+2.;
  // densest against the plating, thinning outward
  float side=exp(-max(ac-hw,0.)/14.)*smoothstep(hw-4.,hw,ac)*smoothstep(-L*1.25,-L*.8,a)*smoothstep(L+12.,L-3.,a);
  foam+=side*(1.3+1.1*smoothstep(L*.4,L,a));
  h+=side*.35*smoothstep(L*.3,L,a);
  return vec3(h,clamp(foam,0.,2.2),clamp(air,0.,1.));
}
`;

export const OCEAN_VERTEX = `${HEADER}${CASCADE}${PULSE}
in vec2 a_grid;
out vec3 v_world;
out vec2 v_xz;
out float v_h;
void main(){
  vec2 clip=vec2(mix(-1.14,1.14,a_grid.x),mix(-1.3,u_horizon-.0008,pow(a_grid.y,.82)));
  vec3 d=vec3(clip.x*u_aspect,clip.y-u_horizon,u_F);
  float t=u_cam.y/max(-d.y,1e-6);
  t=min(t,26000./length(d.xz));
  vec2 xz=u_cam.xz+d.xz*t;
  float dist=length(xz-u_cam.xz);
  float perPixel=dist/(u_F*u_res.y*.5);
  vec3 disp=vec3(0.);
  for(int c=0;c<3;c++){
    float texel=u_L[c]/u_texel;
    float lod=log2(max(perPixel*2./texel,1.));
    float fade=1.-smoothstep(log2(u_texel)-2.,log2(u_texel),lod);
    if(fade>0.)disp+=textureLod(u_disp,vec3(xz/u_L[c],float(c)),lod).xyz*fade;
  }
  disp.y+=pulseAt(xz).x+wakeAt(xz).x;
  vec3 P=vec3(xz.x+disp.x,disp.y,xz.y+disp.z);
  v_world=P;v_xz=xz;v_h=disp.y;
  vec3 rel=P-u_cam;
  float z=max(rel.z,.5);
  const float n=1.,f=40000.;
  gl_Position=vec4(rel.x*u_F/u_aspect,rel.y*u_F+u_horizon*z,z*(f+n)/(f-n)-2.*f*n/(f-n),z);
}`;

export const OCEAN_FRAGMENT = `${HEADER}${CASCADE}${PALETTE}${PULSE}
uniform sampler2D u_foamTex;
uniform float u_time;
uniform vec2 u_wind;
uniform float u_foamAmount;
in vec3 v_world;
in vec2 v_xz;
in float v_h;
out vec4 o;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
void main(){
  vec3 toCam=u_cam-v_world;
  float dist=length(toCam.xz);
  vec3 V=toCam/length(toCam);
  vec2 slope=vec2(0.);
  float jx=0.,jz=0.,foam=0.;
  for(int c=0;c<3;c++){
    vec3 uv=vec3(v_xz/u_L[c],float(c));
    vec4 dv=texture(u_deriv,uv);
    slope+=dv.xy;jx+=dv.z;jz+=dv.w;
    foam+=texture(u_disp,uv,1.6).w*(c==0?1.:c==1?.9:.35);
  }
  // heartbeat ring slope by central differences
  vec2 pc=pulseAt(v_xz);
  vec2 px=pulseAt(v_xz+vec2(.6,0.)),pz=pulseAt(v_xz+vec2(0.,.6));
  slope+=vec2(px.x-pc.x,pz.x-pc.x)/.6;
  vec3 wk=wakeAt(v_xz);
  if(wk.y+wk.z>0.)slope+=vec2(wakeAt(v_xz+vec2(1.,0.)).x-wk.x,wakeAt(v_xz+vec2(0.,1.)).x-wk.x);
  vec3 n=normalize(vec3(-slope.x/max(1.+jx,.25),1.,-slope.y/max(1.+jz,.25)));
  // the wash flattens the short sea behind the screw
  n=normalize(mix(n,vec3(0.,1.,0.),wk.z*.5));
  // never shade a facet facing away from the eye
  float nv=dot(n,V);
  if(nv<.02)n=normalize(n+V*(.02-nv));
  nv=max(dot(n,V),0.);
  float far=smoothstep(60.,3000.,dist);
  float rough=mix(.07,.38,far);
  vec3 R=reflect(-V,n);
  // grazing reflections would alias the razor-thin horizon band into sparkling lines
  R.y=max(abs(R.y),.035+far*.06);
  R=normalize(R);
  float fres=.02+.98*pow(1.-nv,5.);
  vec3 refl=sky(R);
  // GGX glitter of the low sun
  vec3 L=u_sunDir,Hh=normalize(L+V);
  float nh=max(dot(n,Hh),0.),a2=rough*rough*rough*rough;
  float dd=nh*nh*(a2-1.)+1.;
  float ggx=a2/(PI_*dd*dd);
  float spec=ggx*fres*max(dot(n,L),0.)/max(4.*nv*max(dot(n,L),.02),.05);
  // body: deep scatter, plus light through thin crests (subsurface)
  float crest=max(v_h,0.);
  float back=pow(max(dot(L,-V),0.)*.5+.5,3.);
  vec3 body=u_deep*(.55+.45*max(n.y,0.))
           +u_scatter*(crest*.55*back*pow(.5-.5*dot(L,n),2.)+pow(max(dot(V,n),0.),3.)*.06)*(1.-far*.8);
  // aerated wash glows pale turquoise from the bubbles below
  body=mix(body,u_scatter*1.1+u_horizonCol*.35,wk.z*.28);
  vec3 col=mix(body,refl,fres*(1.-wk.z*.35))+u_sunCol*spec*.9;
  // foam: simulated coverage revealed through a lacy pattern drifting with the wind
  vec2 fuv=(v_xz+u_wind*u_time*.6)/23.;
  vec4 pat=texture(u_foamTex,fuv);
  vec4 pat2=texture(u_foamTex,fuv*.37+.5);
  float lace=mix(pat.r,pat2.r,.35);
  // the wake boils: two lace layers sliding against each other
  float boil=mix(texture(u_foamTex,v_xz/31.+vec2(u_time*.013,0.)).r,texture(u_foamTex,v_xz/19.-vec2(0.,u_time*.017)).r,.5);
  float cover=foam*u_foamAmount;
  // wake foam: its density sets how much of the lace survives - solid by the hull, broken patches and streaks further out
  float dens=clamp(wk.y*.55,0.,.82);
  float wakeFoam=smoothstep(1.-dens,1.-dens+.22,clamp(boil*.55+lace*.45,0.,1.))*(.5+.5*dens);
  // whitecap cores are solid and break into lace at the edges; old foam lingers only as lace
  float fresh=smoothstep(.3,.75,cover)*mix(.55,1.,lace)*(.6+.4*pat2.g);
  float old=smoothstep(.18,.55,cover)*smoothstep(.5,.95,lace)*.45;
  // aged foam drawn out into streaks along the wind
  vec2 wd=normalize(u_wind+1e-4);
  vec2 sp=vec2(dot(v_xz,wd)/70.,dot(v_xz,vec2(-wd.y,wd.x))/3.2);
  float streak=texture(u_foamTex,sp).g*texture(u_foamTex,sp*.31+.2).r;
  old=max(old,smoothstep(.08,.4,cover)*smoothstep(.25,.6,streak)*.5);
  float f=clamp(max(max(fresh,old),wakeFoam),0.,1.);
  // bubbles under fresh whitecaps light the water from below
  col+=u_scatter*(1.4*smoothstep(.15,.8,cover)+.45*dens)*(1.-far);
  vec3 foamCol=u_horizonCol*1.5+u_band1*.5+u_sunCol*(.16+.5*max(dot(n,L),0.))+vec3(.03,.034,.04);
  foamCol=mix(foamCol,vec3(dot(foamCol,vec3(.3,.45,.25))),.55);  // foam is white; only a hint of the sky's tint
  col=mix(col,foamCol,f*(1.-far*.5));
  // bioluminescent pulse rings
  col+=u_hot*pc.y*(.35+.65*smoothstep(.4,1.,lace))*.55*(1.-far*.5);
  col+=u_hot*f*pc.y*.4;
  // aerial perspective toward the horizon
  float haze=1.-exp(-dist*.00016);
  col=mix(col,sky(normalize(vec3(-V.x,.0,-V.z)))*.92,haze);
  o=vec4(tonemap(col)+(hash(gl_FragCoord.xy+fract(u_time))-.5)/255.,1.);
}`.replace("PI_", "3.14159265");

/** Spray: stateless particles reborn every cycle on a random crest; only breaking ones fly. */
export const SPRAY_VERTEX = `${HEADER}${CASCADE}
in float a_id;
uniform float u_time;
uniform vec2 u_wind;
uniform vec3 u_camVel;
uniform float u_sprayGain;
uniform float u_bowFrom;
uniform float u_sternFrom;
out float v_alpha;
out float v_age;
vec3 h3(float n){
  uvec2 h=uvec2(uint(n)*747796405u+2891336453u,uint(n)*277803737u+1u);
  h=h*1664525u+1013904223u;h.x+=h.y*1664525u;h.y+=h.x*1664525u;h=h^(h>>16u);h.x+=h.y*1664525u;h.y+=h.x*1664525u;h=h^(h>>16u);
  return vec3(vec2(h)*(1./4294967296.),fract(float(h.x^h.y)*(1./4294967296.)*7.13));
}
void project(vec3 pos,float size){
  vec3 rel=pos-u_cam;
  float z=max(rel.z,.5);
  gl_PointSize=clamp(size*u_F*u_res.y*.5/z,1.,52.);
  if(v_alpha<.004||rel.z<1.){gl_Position=vec4(2.,2.,2.,1.);return;}
  const float n=1.,f=40000.;
  gl_Position=vec4(rel.x*u_F/u_aspect,rel.y*u_F+u_horizon*z,z*(f+n)/(f-n)-2.*f*n/(f-n),z);
}
void main(){
  vec3 r=h3(a_id);
  if(a_id>=u_sternFrom){
    // screw spray: sheets flung off at the water line in a turning spiral, falling back into the race
    float P=.7+r.z*.8,t=u_time/P+r.x,age=fract(t)*P;
    vec3 s=h3(a_id*3.+floor(t)*53.+5.);
    float L=u_shipInfo.y,B=u_shipInfo.z,U=clamp(u_shipInfo.x,2.,14.);
    vec2 f=u_ship.zw,pr=vec2(-f.y,f.x);
    float th=u_time*11.+s.x*6.2832;
    // born thickest right at the transom, thinning astern (exponential spacing)
    float back=-log(1.-s.z*.995)*9.;
    vec2 at=u_ship.xy-f*(L*.97+back)+pr*(s.y-.5)*B*(1.+back*.02);
    vec3 swirl=(vec3(pr.x,0.,pr.y)*cos(th)+vec3(0.,1.,0.)*abs(sin(th)))*(2.+3.*r.y);
    vec3 vel=vec3(-f.x,0.,-f.y)*(U*.35+2.)*(.5+r.x)+swirl*(.4+.8*s.z)+vec3(pr.x,0.,pr.y)*(r.z-.5)*4.+vec3(0.,1.+2.5*r.y,0.);
    vec3 pos=vec3(at.x,.2,at.y)+vel*age+vec3(0.,-4.9*age*age,0.);
    v_alpha=u_shipInfo.w*step(0.,pos.y)*pow(1.-age/P,1.5)*smoothstep(0.,.06,age)*.32*exp(-back/30.);
    v_age=age/P;
    project(pos,.1+.3*r.y+age*.6);
    return;
  }
  if(a_id>=u_bowFrom){
    // bow spray: sheets thrown off both sides of the stem, falling back into the bow wave
    float P=.8+r.z*.9,t=u_time/P+r.x,age=fract(t)*P;
    vec3 s=h3(a_id*5.+floor(t)*71.+9.);
    float L=u_shipInfo.y,B=u_shipInfo.z,U=clamp(u_shipInfo.x,2.,14.);
    vec2 f=u_ship.zw,side=vec2(-f.y,f.x)*(s.x<.5?-1.:1.);
    // thickest at the stem, thinning exponentially aft along the waterline
    float along=max(L*.98-(-log(1.-s.y*.995))*L*.2,-L*.9);
    float bowness=exp(-(L*.98-along)/(L*.35));
    float fore=clamp((along-L*.35)/(L*.65),0.,1.);
    vec2 at=u_ship.xy+f*along+side*(B*sqrt(max(0.,1.-fore*fore))+1.5);
    vec3 vel=vec3(side.x,0.,side.y)*(.8+3.2*s.z)*(.4+.6*bowness)+vec3(f.x,0.,f.y)*U*(.1+.3*r.z)+vec3(0.,1.+4.*r.y*clamp(U/7.,.5,1.3)*(.3+.7*bowness),0.);
    vec3 pos=vec3(at.x,.3,at.y)+vel*age+vec3(0.,-4.6*age*age,0.);
    v_alpha=u_shipInfo.w*step(0.,pos.y)*pow(1.-age/P,1.5)*smoothstep(0.,.08,age)*.34*(.25+.75*bowness);
    v_age=age/P;
    project(pos,.1+.32*r.y+age*.55);
    return;
  }
  float P=1.5+r.z*1.6;
  float t=u_time/P+r.x;
  float cyc=floor(t),age=fract(t)*P;
  vec3 s=h3(a_id*7.+cyc*131.+3.);
  // spawn where the camera looked when this particle was born
  vec3 cam=u_cam-u_camVel*age;
  vec2 clip=vec2(s.x*2.2-1.1,mix(-1.08,u_horizon-.012,pow(s.y,1.35)));
  vec3 d=vec3(clip.x*u_aspect,clip.y-u_horizon,u_F);
  vec2 xz=cam.xz+d.xz*(cam.y/max(-d.y,1e-6));
  float dist=length(xz-cam.xz);
  vec4 a=textureLod(u_disp,vec3(xz/u_L[0],0.),1.);
  vec4 b=textureLod(u_disp,vec3(xz/u_L[1],1.),1.);
  float breaking=smoothstep(.62,.98,max(a.w*1.05,b.w*.9));
  vec3 base=vec3(xz.x+a.x+b.x,a.y+b.y,xz.y+a.z+b.z);
  float big=step(.78,r.y);           // a few large, slow mist puffs among the droplets
  vec3 vel=vec3(u_wind.x,0.,u_wind.y)*(2.+3.5*s.z)+vec3((s.z-.5)*2.,mix(1.6+3.2*r.y,.8,big),(r.z-.5)*2.);
  float drag=mix(1.,.55,big);
  vec3 pos=base+vel*age*drag+vec3(0.,-.5*mix(7.5,1.2,big)*age*age,0.);
  float alive=step(base.y-.25,pos.y);
  v_alpha=breaking*alive*pow(1.-age/P,1.6)*smoothstep(0.,.12,age)*u_sprayGain*(1.-smoothstep(900.,2600.,dist));
  v_age=age/P;
  project(pos,mix(.18+.3*r.y,1.6+1.8*age,big));
}`;

export const SPRAY_FRAGMENT = `${HEADER}
uniform vec3 u_sunCol;
uniform vec3 u_horizonCol;
uniform float u_intensity;
in float v_alpha;
in float v_age;
out vec4 o;
void main(){
  vec2 q=gl_PointCoord*2.-1.;
  float r=dot(q,q);
  if(r>1.)discard;
  float a=exp(-r*3.)*v_alpha;
  vec3 c=mix(vec3(.9,.92,1.),u_sunCol*1.4+u_horizonCol,.35)*u_intensity;
  o=vec4(pow(c,vec3(1./2.2))*a,a*.85);
}`;
