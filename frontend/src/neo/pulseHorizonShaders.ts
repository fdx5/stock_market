/**
 * PULSE HORIZON — a seismograph landscape of live price ridges.
 * Every ridge is a slice of one stationary terrain that the camera flies over;
 * its outline is a price walk, rising strokes glow market-up, falling strokes
 * market-down. Heartbeat shockwaves (an ECG profile) cross the field.
 */

export const PULSES = 8;

/** Mood palettes: the sea takes the colour of the market (blue fall, violet calm, red-gold rise). */
export const MOODS = {
  down: { up: [.45, .93, 1], down: [.22, .45, 1], flat: [.36, .66, 1], hot: [.78, .96, 1], haze: [.22, .42, .86], band1: [.14, .34, .82], band2: [.3, .74, 1], band3: [.42, .62, 1], fog: [.03, .065, .16], variety: .15 },
  calm: { up: [.94, .56, .62], down: [.52, .68, .94], flat: [.68, .6, .9], hot: [.86, .9, 1], haze: [.55, .42, .8], band1: [.5, .28, .7], band2: [.95, .62, .62], band3: [.95, .7, .55], fog: [.105, .055, .15], variety: .1 },
  up: { up: [1, .84, .3], down: [1, .28, .24], flat: [1, .52, .3], hot: [1, .95, .78], haze: [.92, .38, .2], band1: [.82, .24, .14], band2: [1, .66, .26], band3: [1, .82, .4], fog: [.15, .05, .035], variety: .55 },
} as const;
export type Mood = keyof typeof MOODS;
export type Palette = { [K in keyof typeof MOODS.calm]: K extends "variety" ? number : readonly number[] };

const NOISE = `
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vnoise(vec2 p){
  vec2 i=floor(p),f=fract(p);vec2 w=f*f*(3.-2.*f);
  float a=hash(i),b=hash(i+vec2(1.,0.)),c=hash(i+vec2(0.,1.)),d=hash(i+vec2(1.,1.));
  return mix(mix(a,b,w.x),mix(c,d,w.x),w.y);
}
float gauss(float x,float w){return exp(-x*x/(w*w));}
`;

/** Shared camera + terrain. F: focal length, H: camera height, horizon in clip y. */
const SCENE = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_near;
uniform float u_span;
uniform float u_ridgeZ;
uniform float u_ridgeWorld;
uniform vec2 u_cam;
uniform float u_horizon;
uniform vec4 u_pulse[${PULSES}];
uniform float u_points;
uniform float u_cssWidth;
uniform float u_amp;
const float F=1.6;
const float H=.62;
${NOISE}
// price walk with level of detail: octaves finer than ~3 vertices fade out
float fbm(vec2 p,float texel){
  float s=0.,a=.5,f=1.;
  for(int i=0;i<6;i++){
    float keep=1.-smoothstep(.08,.22,f*texel);
    s+=a*(vnoise(p)-.5)*keep+a*.5;
    p=mat2(1.7,1.1,-1.1,1.7)*p+vec2(7.1,3.3);f*=2.02;a*=.47;
  }
  return s;
}
float terrain(float xw,float zw,float xs,float texel,float z){
  vec2 q=vec2(xw*1.2+u_time*.04,zw*.5);
  float n=fbm(q,texel*1.2);
  float swell=vnoise(vec2(xw*.2-u_time*.006,zw*.14+4.));
  float spine=1.-abs(vnoise(q*.18+vec2(3.1,7.7))*2.-1.);
  float side=smoothstep(.15,1.1,abs(xs))*smoothstep(.6,5.,z);
  float amp=mix(.22,.72,side);
  return amp*u_amp*(max(n-.22,0.)*1.05+swell*swell*.32+spine*spine*.3*side);
}
// returns (height, light) of all heartbeat wavefronts at a world point
vec2 heartbeat(float xw,float zw,float z){
  vec2 r=vec2(0.);
  float k=1.3+z*.16;
  for(int i=0;i<${PULSES};i++){
    vec4 p=u_pulse[i];
    if(p.w<=0.)continue;
    float d=length(vec2(xw-p.y,zw-p.z));
    float R=p.x*1.7;
    float s=(R-d)/k;
    if(s<-.5||s>2.6)continue;
    float e=.12*gauss(s-.15,.14)-.22*gauss(s-.48,.08)+gauss(s-.64,.09)-.28*gauss(s-.82,.09)+.2*gauss(s-1.35,.24);
    float fall=p.w*exp(-R*.075)*smoothstep(0.,.35,p.x)*(1.-smoothstep(u_near+u_span*.22,u_near+u_span*.6,z));
    r.x+=e*.2*fall*k;
    r.y+=(max(e,0.)*.55+gauss(s-.64,.7)*.22)*fall;
  }
  return r;
}
vec2 project(float u,out float slope,out float light,out float xsOut){
  float z=u_ridgeZ;
  float aspect=u_res.x/u_res.y;
  float xs=(u*2.-1.)*1.2;
  float zw=u_ridgeWorld;
  float xw=xs*z*aspect/F;
  float dx=2.4*z*aspect/F/u_points;
  // detail is limited by CSS pixels, so phones and desktops show the same calm stroke
  float texel=max(2.4*z*aspect/F/u_points,2.4*z*aspect/F/u_cssWidth*5.);
  float h=terrain(xw,zw,xs,texel,z);
  float h2=terrain(xw+dx,zw,xs,texel,z);
  vec2 hb=heartbeat(xw,zw,z);
  slope=(h2-h)/dx;
  light=hb.y;
  h+=hb.x;
  xsOut=xs;
  float y=u_horizon+u_cam.y*.05/z+(h-H)*F/z;
  float x=xs+u_cam.x*.07/z;
  return vec2(x,y);
}
float depthOf(float z){return (z-u_near)/u_span*1.8-.9;}
`;

export const RIDGE_VERTEX = `${SCENE}
attribute vec2 a_pos;
uniform float u_pass; // 0 fill, 1 line
uniform float u_width;
varying float v_side;
varying float v_drop;
varying float v_slope;
varying float v_light;
varying float v_u;
void main(){
  float u=a_pos.x,side=a_pos.y;
  float slope,light,xs,s2,l2,x2,s3,l3,x3;
  vec2 p=project(u,slope,light,xs);
  v_u=u;v_slope=slope;v_light=light;v_side=side;v_drop=0.;
  float z=u_ridgeZ;
  if(u_pass<.5){
    vec2 q=side>0.?vec2(p.x,-1.08):p;
    v_drop=(p.y-q.y)*u_res.y*.5;
    gl_Position=vec4(q,depthOf(z),1.);
  }else{
    float du=2.5/u_points;
    vec2 a=project(u-du,s2,l2,x2);
    vec2 b=project(u+du,s3,l3,x3);
    vec2 t=normalize((b-a)*u_res);
    vec2 n=vec2(-t.y,t.x);
    vec2 o=n*side*u_width/u_res;
    gl_Position=vec4(p+o,depthOf(z)-.0015,1.);
  }
}`;

export const RIDGE_FRAGMENT = `precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_near;
uniform float u_span;
uniform float u_ridgeZ;
uniform float u_ridgeSeed;
uniform float u_pass;
uniform float u_width;
uniform float u_core;
uniform float u_intensity;
uniform vec3 u_bg;
uniform vec3 u_fog;
uniform float u_horizon;
uniform vec3 u_up;
uniform vec3 u_down;
uniform vec3 u_flat;
uniform vec3 u_hot;
uniform vec3 u_haze;
uniform vec3 u_band1;
uniform vec3 u_band2;
uniform vec3 u_band3;
uniform float u_variety;
varying float v_side;
varying float v_drop;
varying float v_slope;
varying float v_light;
varying float v_u;
${NOISE}
const vec3 GOLD=vec3(.98,.84,.6);
float fogOf(float z){return smoothstep(u_near+.6,u_near+u_span*.92,z);}
vec3 strokeColor(){
  float up=smoothstep(.06,.6,v_slope),dn=smoothstep(.06,.6,-v_slope);
  vec3 c=u_flat;
  c=mix(c,u_up,up);c=mix(c,u_down,dn);
  // some moods weave two hues through the sea (red and gold in a rally)
  float weave=vnoise(vec2(v_u*7.+u_ridgeSeed*.37,u_ridgeSeed*.21));
  c=mix(c,mix(u_up,u_down,step(.5,hash(vec2(u_ridgeSeed,2.3)))),u_variety*smoothstep(.3,.75,weave));
  float fog=fogOf(u_ridgeZ);
  return mix(c,u_haze,fog*.85);
}
void main(){
  float z=u_ridgeZ;
  float fog=fogOf(z);
  float appear=smoothstep(u_near+u_span,u_near+u_span-2.2,z)*smoothstep(u_near-.05,u_near+.55,z);
  vec3 stroke=strokeColor();
  if(u_pass<.5){
    // opaque terrain body; a soft reflection of the stroke just below the ridge
    float hy=gl_FragCoord.y/u_res.y*2.-1.-u_horizon;
    vec3 sky=u_fog+(u_band1*exp(-abs(hy)*7.)*.16+u_band2*exp(-abs(hy)*26.)*.06+u_band3*exp(-abs(hy)*14.-abs(gl_FragCoord.x/u_res.x*2.-1.)*1.4)*.04)*u_intensity;
    vec3 body=mix(u_bg,sky,pow(fog,1.6));
    float sheen=(exp(-v_drop/(14.+40.*(1.-fog)))*.07+exp(-v_drop/180.)*.022)*(1.-fog)*appear;
    body+=u_flat*sheen*u_intensity+u_hot*v_light*exp(-v_drop/60.)*.06*(1.-fog);
    gl_FragColor=vec4(body,1.);
    return;
  }
  float d=abs(v_side)*u_width;
  float core=clamp(u_core*.5+.75-d,0.,1.);
  float halo=exp(-d*d/(u_width*u_width*.12));
  float edge=smoothstep(1.,.55,abs(v_side));
  float bloom=exp(-d/(u_width*.45))*.12*edge;
  halo*=edge;
  // trade sparks: a few ridges carry a gold comet with a fading tail
  float seed=hash(vec2(u_ridgeSeed,7.13));
  float spark=0.;
  if(seed>.82){
    float dir=seed>.91?1.:-1.;
    float pos=fract(hash(vec2(u_ridgeSeed,1.7))+u_time*(.008+.012*hash(vec2(u_ridgeSeed,3.9)))*dir);
    float t=(pos-v_u)*dir;
    spark=t>=0.?exp(-t*28.)*(1.-smoothstep(0.,.3,t)):exp(t*500.);
  }
  float pulse=min(v_light,1.2);
  float energy=(.5+(1.-fog)*.5)*appear*pow(1.-fog*.9,1.8);
  vec3 c=stroke*(core*.66+halo*.26+bloom)*energy;
  c+=u_hot*pulse*(core*.55+halo*.3+bloom)*appear*(1.-fog*.7);
  c+=GOLD*spark*(core*.8+halo*.35+bloom)*energy*edge;
  gl_FragColor=vec4(c*u_intensity,1.);
}`;

export const SKY_VERTEX = `attribute vec2 a_pos;varying vec2 v_p;void main(){v_p=a_pos;gl_Position=vec4(a_pos,.999,1.);}`;

export const SKY_FRAGMENT = `precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_horizon;
uniform vec2 u_cam;
uniform vec3 u_bg;
uniform vec3 u_fog;
uniform float u_intensity;
uniform vec4 u_beacon[${PULSES}];
uniform vec3 u_band1;
uniform vec3 u_band2;
uniform vec3 u_band3;
uniform vec3 u_hot;
uniform vec3 u_flat;
varying vec2 v_p;
${NOISE}
float fbm3(vec2 p){float s=0.,a=.5;for(int i=0;i<3;i++){s+=a*vnoise(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return s;}
void main(){
  vec2 p=v_p;
  float aspect=u_res.x/u_res.y;
  float hy=u_horizon+u_cam.y*.004;
  float h=p.y-hy;
  vec3 c=mix(u_fog,u_bg,smoothstep(0.,.9,h));
  // horizon light band
  c+=u_band1*exp(-abs(h)*7.)*.16*u_intensity;
  c+=u_band2*exp(-abs(h)*26.)*.06*u_intensity;
  c+=u_band3*exp(-abs(h)*14.-abs(p.x)*1.4)*.04*u_intensity;
  if(h>-.02){
    // aurora curtains of order flow: tall, slow, fine vertical rays
    float x=p.x*aspect+u_cam.x*.01;
    float drift=u_time*.018;
    float band=fbm3(vec2(x*.9+drift,drift*.6));
    float rays=fbm3(vec2(x*14.+band*3.,u_time*.08));
    float curtain=smoothstep(.42,.8,band)*(.45+.75*rays*rays);
    float rise=smoothstep(-.02,.06,h)*exp(-h*2.6);
    float hue=vnoise(vec2(x*.35-drift*.5,4.));
    vec3 aur=mix(u_band1+u_flat*.35,u_flat,smoothstep(.3,.8,hue));
    aur=mix(aur,u_band2,smoothstep(.62,.92,vnoise(vec2(x*.5+9.,drift))));
    c+=aur*curtain*rise*.12*u_intensity;
    // stars: quotes ticking far away
    vec2 g=gl_FragCoord.xy/3.2;
    vec2 cell=floor(g/7.);
    float r=hash(cell);
    if(r>.955){
      vec2 o=vec2(hash(cell+3.1),hash(cell+8.7))*5.+1.;
      float dd=length(g-cell*7.-o);
      float tw=.55+.45*sin(u_time*(.3+r*.8)+r*40.);
      c+=mix(vec3(.75,.7,1.),vec3(.55,1.,.95),hash(cell+1.3))*exp(-dd*dd*1.8)*tw*.26*smoothstep(.02,.4,h)*u_intensity;
    }
    // heartbeat beacons: a vertical light rising where a pulse is born
    for(int i=0;i<${PULSES};i++){
      vec4 b=u_beacon[i];
      if(b.w<=0.)continue;
      float flash=exp(-b.x*.7)*smoothstep(0.,.6,b.x)*b.w*.4;
      float dx=abs(p.x-b.y)*aspect;
      float beam=exp(-dx*dx*2500.)*.7+exp(-dx*30.)*.25;
      float top=exp(-max(h-b.z,0.)*1.2)*smoothstep(-.03,.02,h);
      c+=u_hot*beam*top*flash*.85*u_intensity;
      c+=u_band1*1.3*exp(-dx*6.)*exp(-abs(h)*14.)*flash*.25*u_intensity;
    }
  }
  gl_FragColor=vec4(c,1.);
}`;
