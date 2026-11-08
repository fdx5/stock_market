import { NANOTUBES } from "./nanotubeGeometry";

const SCENE = `
precision highp float;
uniform vec2 u_viewport;
uniform float u_time;
uniform float u_length;
uniform float u_scale;
uniform vec4 u_shape[${NANOTUBES.length}];
uniform vec4 u_motion[${NANOTUBES.length}];
uniform float u_form[${NANOTUBES.length}];
uniform vec3 u_colorA[${NANOTUBES.length}];
uniform vec3 u_colorB[${NANOTUBES.length}];
const float TAU=6.28318530718;
vec2 turn(vec2 point,float angle){
  return vec2(point.x*cos(angle)-point.y*sin(angle),point.x*sin(angle)+point.y*cos(angle));
}
float cameraOrbit(){return .12+sin(u_time*.025)*.035;}
vec3 skin(float tube,vec2 uv,float branch,out float facing){
  int id=int(tube+.5);
  vec4 shape=u_shape[id],motion=u_motion[id];
  float y=(uv.y-.5)*u_length;
  float t=u_time*motion.y,phase=motion.x;
  float knot=y*.00145+u_time*.048+phase*.28;
  float p=y*.0022+t*.14+phase;
  float q=y*.0043-t*.085+phase*.3;
  float spinePhase=y*.0015+u_time*.065+phase*.45;
  float x=shape.y*u_viewport.x*(.84+.14*sin(knot))+shape.z*y;
  x+=sin(spinePhase)*24.*u_scale+sin(p)*motion.z*u_scale+sin(q)*motion.z*.3*u_scale;
  float dx=shape.y*u_viewport.x*.14*cos(knot)*.00145+shape.z;
  dx+=cos(spinePhase)*24.*u_scale*.0015+cos(p)*motion.z*u_scale*.0022+cos(q)*motion.z*.3*u_scale*.0043;
  float z=shape.w*u_scale+sin(y*.0017+t*.12+phase)*24.*u_scale+cos(y*.0031-t*.1+phase*.8)*13.*u_scale;
  float radius=shape.x*u_scale*(.96+.028*sin(y*.0044+t*.23+phase)+.014*cos(y*.0107-t*.15));
  float theta=uv.x*TAU+y*.0006*motion.w+sin(y*.0021+t*.085+phase)*.27+t*.04*motion.w;
  vec2 side=normalize(vec2(1.,-dx));
  float form=u_form[id];
  vec2 crossSection;
  vec2 crossNormal=vec2(sin(theta),cos(theta));
  if(form<.5){
    float winding=uv.y*TAU*2.4+t*.065+sin(uv.y*13.+phase)*.24+branch*3.14159265;
    vec2 lobe=vec2(cos(winding),sin(winding))*radius*.66;
    crossSection=lobe+vec2(sin(theta),cos(theta))*radius*.34;
  }else if(form<1.5){
    float lateral=sin(theta)*radius*1.5;
    float crease=sin(lateral/max(radius,.01)*3.2+uv.y*7.+t*.08)*radius*.14;
    float fold=uv.y*TAU*1.35+sin(uv.y*9.+t*.075)*.45+t*.055;
    crossSection=turn(vec2(lateral,cos(theta)*radius*.1+crease),fold);
    float lateralTangent=cos(theta)*radius*1.5;
    float creaseTangent=cos(lateral/max(radius,.01)*3.2+uv.y*7.+t*.08)*.448*lateralTangent;
    vec2 tangent=turn(vec2(lateralTangent,-sin(theta)*radius*.1+creaseTangent),fold);
    crossNormal=vec2(-tangent.y,tangent.x)/max(length(tangent),.001);
  }else if(form<2.5){
    float fork=pow(.5+.5*sin(uv.y*TAU*3.6+t*.055+phase),1.4);
    float winding=branch*TAU/3.+uv.y*4.+t*.03+sin(uv.y*11.+phase)*.3;
    vec2 lobe=vec2(cos(winding),sin(winding))*radius*fork*1.18;
    crossSection=lobe+vec2(sin(theta),cos(theta))*radius*(.3-.09*fork);
  }else{
    float node=.5+.5*cos(uv.y*TAU*13.+t*.065);
    float ribRadius=radius*1.65*(.42+.76*pow(node,1.5));
    theta+=uv.y*TAU*1.8;
    float radiusTangent=-ribRadius*.36*sin(theta*3.+uv.y*TAU*4.+t*.05);
    ribRadius*=.88+.12*cos(theta*3.+uv.y*TAU*4.+t*.05);
    crossSection=vec2(sin(theta),cos(theta))*ribRadius;
    vec2 tangent=vec2(radiusTangent*sin(theta)+ribRadius*cos(theta),radiusTangent*cos(theta)-ribRadius*sin(theta));
    crossNormal=vec2(-tangent.y,tangent.x)/max(length(tangent),.001);
  }
  // Keep the reflected light attached to the surface as the camera slowly orbits.
  facing=turn(vec2(crossNormal.x*side.x,crossNormal.y),cameraOrbit()).y;
  return vec3(x+side.x*crossSection.x,y+side.y*crossSection.x,z+crossSection.y);
}
vec4 projectPoint(vec3 point){
  // A gentle camera orbit exposes depth between folds without pointer-driven motion.
  point.xz=turn(point.xz,cameraOrbit());
  float angle=.4537856;
  point.xy=mat2(cos(angle),sin(angle),-sin(angle),cos(angle))*point.xy;
  float focal=1100.*u_scale+600.;
  vec2 screen=point.xy*(focal/(focal-point.z));
  return vec4(screen.x/u_viewport.x*2.,-screen.y/u_viewport.y*2.,-point.z/(800.*u_scale),1.);
}
vec3 material(float tube,vec2 uv){
  int id=int(tube+.5);
  // Circumferential color is periodic, avoiding a color seam at UV 0/1.
  float mixRatio=.34+.19*sin(uv.y*7.+sin(uv.x*TAU)*.32+u_motion[id].x*.4+u_time*.035);
  return mix(u_colorA[id],u_colorB[id],mixRatio);
}
`;

export const HULL_VERTEX = SCENE + `
attribute vec3 a_uv;
uniform float u_tube;
varying vec3 v_surfaceColor;
varying vec3 v_surface;
void main(){
  float facing;
  vec3 point=skin(u_tube,a_uv.xy,a_uv.z,facing);
  gl_Position=projectPoint(point);
  v_surfaceColor=material(u_tube,a_uv.xy);
  v_surface=vec3(facing,a_uv.y,point.z/u_scale);
}
`;
export const HULL_FRAGMENT = `
precision highp float;
uniform float u_intensity;
varying vec3 v_surfaceColor;
varying vec3 v_surface;
void main(){
  float face=clamp(abs(v_surface.x),0.,1.);
  float rim=pow(1.-face,2.6);
  float sheenOffset=(face-.7)/.2;
  float sheen=exp(-sheenOffset*sheenOffset);
  float fade=smoothstep(.015,.085,v_surface.y)*(1.-smoothstep(.915,.985,v_surface.y));
  float depth=.72+.28*smoothstep(-150.,150.,v_surface.z);
  float alpha=(.009+.026*rim+.018*sheen)*fade*depth*u_intensity;
  vec3 color=mix(v_surfaceColor,vec3(.81,.91,.95),sheen*.16);
  gl_FragColor=vec4(color*alpha,alpha);
}
`;

export const WIRE_VERTEX = SCENE + `
attribute vec4 a_edge;
attribute vec4 a_style;
attribute vec2 a_tubes;
attribute vec2 a_link;
uniform float u_width;
uniform vec4 u_packets[${NANOTUBES.length}];
varying vec3 v_color;
varying vec4 v_data;
varying vec3 v_details;
varying vec4 v_packet;
vec3 bridge(vec3 a,vec3 b,float t,float seed){
  vec3 point=mix(a,b,t);
  float arch=sin(t*3.14159265);
  point.z+=arch*(34.+20.*sin(seed*TAU))*u_scale;
  point.y+=arch*sin(seed*TAU+u_time*.13)*14.*u_scale;
  point.x+=arch*sin(u_time*.12+seed*TAU)*8.*u_scale;
  return point;
}
vec3 filament(float tube,vec2 uv,float branch,float seed,out float facing){
  float handedness=seed>.5?1.:-1.;
  float drift=u_time*(.025+seed*.021)*handedness;
  // Unequal helical pitches, reversing strands and wandering radii form an irregular braid.
  uv.x+=uv.y*(2.2+seed*2.6)*handedness+drift;
  uv.x+=sin(uv.y*(11.+seed*7.)+u_time*.18+seed*TAU)*.12;
  uv.x+=sin(uv.y*37.-u_time*.13+seed*19.)*.046;
  vec3 outside=skin(tube,uv,branch,facing);
  float otherFace;
  vec3 opposite=skin(tube,uv+vec2(.5,0.),branch,otherFace);
  vec3 center=(outside+opposite)*.5;
  float radius=length(outside-center);
  float inset=.29+seed*.39+sin(uv.y*27.+u_time*.19+seed*31.)*.09;
  vec3 point=mix(center,outside,inset);
  // Depth on the transparent front envelope reveals the contained light through its cage.
  float transverse=length(point.xy-center.xy);
  point.z=center.z+sqrt(max(0.,radius*radius-transverse*transverse))+1.8*u_scale;
  facing=1.;
  return point;
}
void main(){
  float fa,fb;
  bool isFilament=a_style.z>2.5&&a_style.z<3.5;
  bool isBridge=a_style.z>1.5&&a_style.z<2.5;
  float branchA=isBridge?0.:a_link.x,branchB=isBridge?0.:a_link.y;
  vec3 a=skin(a_tubes.x,a_edge.xy,branchA,fa),b=skin(a_tubes.y,a_edge.zw,branchB,fb);
  vec3 ca=material(a_tubes.x,a_edge.xy),cb=material(a_tubes.y,a_edge.zw);
  float tube=mix(a_tubes.x,a_tubes.y,a_style.x);
  if(isFilament){
    a=filament(a_tubes.x,a_edge.xy,branchA,a_style.w,fa);b=filament(a_tubes.y,a_edge.zw,branchB,a_style.w,fb);
    vec3 ice=mix(vec3(.42,.72,.89),vec3(.90,.96,1.),.28+.65*a_style.w);
    ca=mix(ice,ca,.7);cb=mix(ice,cb,.7);
  }else if(isBridge){
    vec3 start=a,end=b;
    a=bridge(start,end,a_link.x,a_style.w);b=bridge(start,end,a_link.y,a_style.w);
    vec3 startColor=ca,endColor=cb;
    ca=mix(startColor,endColor,a_link.x);cb=mix(startColor,endColor,a_link.y);
    fa=1.;fb=1.;tube=mix(a_tubes.x,a_tubes.y,mix(a_link.x,a_link.y,a_style.x));
  }
  vec4 pa=projectPoint(a),pb=projectPoint(b);
  vec2 direction=(pb.xy-pa.xy)*u_viewport;
  vec2 normal=vec2(-direction.y,direction.x)/max(length(direction),.001);
  vec4 clip=mix(pa,pb,a_style.x);
  float strandWidth=isFilament?u_width*(.65+a_style.w*.4):u_width;
  clip.xy+=normal*a_style.y*strandWidth/u_viewport;
  clip.z-=.0018;
  gl_Position=clip;
  v_color=mix(ca,cb,a_style.x);
  v_data=vec4(a_style.y,mix(a_edge.y,a_edge.w,a_style.x),mix(fa,fb,a_style.x),tube);
  v_details=vec3(a_style.z,a_style.w,-mix(pa.z,pb.z,a_style.x)*800.);
  v_packet=u_packets[int(a_tubes.x+.5)];
}
`;

export const WIRE_FRAGMENT = `
precision highp float;
uniform float u_time;
uniform float u_pass;
uniform float u_intensity;
varying vec3 v_color;
varying vec4 v_data;
varying vec3 v_details;
varying vec4 v_packet;
void main(){
  float across=abs(v_data.x),along=v_data.y,tube=v_data.w;
  float tempo=.27+tube*.031;
  float pulse=pow(.5+.5*sin(along*19.+u_time*tempo+tube*1.7),9.);
  float trace=pow(.5+.5*sin(along*43.-u_time*.28+v_details.y*5.),12.);
  float rim=pow(1.-clamp(abs(v_data.z),0.,1.),3.);
  float front=.22+.62*pow(max(v_data.z,0.),1.3)+rim*.27;
  float depth=.68+.32*smoothstep(-150.,150.,v_details.z);
  float endFade=smoothstep(.015,.085,along)*(1.-smoothstep(.915,.985,along));
  float feather=exp(-across*across*2.8)*(1.-smoothstep(.65,1.,across));
  // Each crest runs along the twisted light strands, with small strand-to-strand delays.
  float signalAlong=along+sin(v_details.y*17.+tube)*v_packet.z*.32;
  float signalOffset=(signalAlong-v_packet.x)/max(.001,v_packet.z);
  float trailOffset=(signalAlong-v_packet.x-v_packet.z*1.5)/max(.001,v_packet.z*1.8);
  float signal=exp(-signalOffset*signalOffset*2.)*v_packet.y;
  float afterglow=exp(-trailOffset*trailOffset*2.)*v_packet.y*.23;
  float alpha;
  if(u_pass>1.5)alpha=exp(-across*across*4.)*(1.-smoothstep(.75,1.,across))*(.0025+.008*pulse)*depth;
  else if(u_pass>.5)alpha=exp(-across*across*4.)*(1.-smoothstep(.78,1.,across))*(.01+.023*pulse)*front*depth;
  else alpha=feather*(.27+.065*pulse+.02*trace)*front*depth;
  bool isFilament=v_details.x>2.5&&v_details.x<3.5;
  if(isFilament){
    float filamentPulse=pow(.5+.5*sin(along*21.+u_time*(.55+v_details.y*.4)+v_details.y*6.2831853),6.);
    if(u_pass<.5)alpha=feather*(.38+.065*filamentPulse)*depth;
    else if(u_pass<1.5)alpha=exp(-across*across*4.)*(.02+.028*filamentPulse)*depth;
  }else if(v_details.x>1.5&&v_details.x<2.5)alpha*=.62;
  // Energy travels inside the tubes; the outer weave catches a softer reflected glow.
  float carrier=isFilament?1.:(v_details.x>.5&&v_details.x<1.5?.42:.16);
  float light=(signal+afterglow)*carrier;
  if(u_pass>1.5)alpha+=exp(-across*across*3.)*light*.095;
  else if(u_pass>.5)alpha+=exp(-across*across*3.)*light*.34;
  else alpha=mix(alpha,feather*.88,min(.9,light));
  vec3 color=mix(v_color,vec3(.92,.98,1.),pulse*.09*front);
  color=mix(color,vec3(.68,.87,1.),rim*.16);
  if(isFilament&&u_pass<.5)color=mix(color,vec3(.88,.97,1.),pow(1.-across,3.)*.26);
  color=mix(color,vec3(.85,.97,1.),min(.65,signal*carrier*.65));
  alpha=min(.98,alpha*endFade*u_intensity);
  gl_FragColor=vec4(color*alpha*(1.+signal*carrier*.22),alpha);
}
`;
