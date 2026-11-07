const MAX = 28;
type Drop = {x:number;y:number;dx:number;dy:number;radius:number;born:number;phase:number;speed:number};
const VERTEX = `attribute vec2 a_position;void main(){gl_Position=vec4(a_position,0.,1.);}`;
const FRAGMENT = `
precision highp float;
uniform vec2 u_resolution;
uniform float u_dpr;
uniform float u_time;
uniform float u_intensity;
uniform vec2 u_pointer;
uniform int u_count;
uniform vec4 u_drops[28];
uniform vec4 u_flow[28];
void main(){
  vec2 pixel=vec2(gl_FragCoord.x,u_resolution.y-gl_FragCoord.y)/u_dpr;
  float height=0.;vec2 gradient=vec2(0.);
  for(int i=0;i<28;i++){
    if(i>=u_count)break;
    vec4 drop=u_drops[i],flow=u_flow[i];
    vec2 local=(pixel-drop.xy)/drop.z;
    vec2 axis=flow.xy,tangent=vec2(-axis.y,axis.x);
    float depth=.55+.45*flow.w;
    float breadth=.85+.65*flow.w;
    vec2 q=vec2(dot(local,axis)/depth,dot(local,tangent)/breadth);
    float radius=max(length(q),.001);
    float bandWidth=.16+.30*flow.w;
    float band=(radius-.75)/bandWidth;
    float forward=smoothstep(-.28,.58,q.x/radius);
    float amount=exp(-band*band*2.)*drop.w*forward;
    height+=amount;
    vec2 radial=axis*(q.x/depth)+tangent*(q.y/breadth);
    gradient+=(-4.*band*amount/(bandWidth*radius*drop.z))*radial;
  }
  if(height<.002)discard;
  vec3 normal=normalize(vec3(-gradient*42.,1.));
  float cover=1.-exp(-height*1.8);
  float fresnel=pow(max(0.,1.-normal.z),.72);
  float thickness=340.+height*70.+sin(pixel.x*.017+pixel.y*.013+u_time*.35)*24.;
  vec3 phase=(12.5663706*1.36*thickness*normal.z)/vec3(650.,510.,475.);
  vec3 interference=.5+.5*cos(phase);
  vec3 film=mix(vec3(.81,.88,.95),interference,.82);
  float spec=pow(max(dot(normal,normalize(vec3(-.5,-.35,1.))),0.),24.)*cover;
  float centerFade=smoothstep(18.,64.,distance(pixel,u_pointer));
  float alpha=(fresnel*cover*.24+cover*.006+spec*.03)*u_intensity*centerFade;
  vec3 color=mix(film,vec3(1.,.95,.83),min(.78,spec*.85));
  gl_FragColor=vec4(color*alpha,alpha);
}`;
let nextId=0;

/** Speed-shaped oil-film wavefronts propagate in the pointer's movement direction. */
export function installCursorFlow(level:"full"|"balanced"){
  const root=document.createElement("div");root.className="ng-cursor-flow";
  root.dataset.state="idle";root.dataset.renderer="directional-thin-film";root.setAttribute("aria-hidden","true");
  const glass=document.createElement("div");glass.className="ng-liquid-refraction";
  const canvas=document.createElement("canvas");canvas.className="ng-liquid-film";
  const ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg"),defs=document.createElementNS(ns,"defs"),filter=document.createElementNS(ns,"filter");
  const id=`ng-oil-glass-${++nextId}`;filter.id=id;filter.setAttribute("color-interpolation-filters","sRGB");
  filter.setAttribute("x","-10%");filter.setAttribute("y","-10%");filter.setAttribute("width","120%");filter.setAttribute("height","120%");
  const noise=document.createElementNS(ns,"feTurbulence");noise.setAttribute("type","fractalNoise");noise.setAttribute("baseFrequency",".012 .009");noise.setAttribute("numOctaves","2");noise.setAttribute("seed","12");noise.setAttribute("result","wave");
  const smooth=document.createElementNS(ns,"feGaussianBlur");smooth.setAttribute("in","wave");smooth.setAttribute("stdDeviation","1.6");smooth.setAttribute("result","water");
  const warp=document.createElementNS(ns,"feDisplacementMap");warp.setAttribute("in","SourceGraphic");warp.setAttribute("in2","water");warp.setAttribute("scale",level==="full"?"10":"6");warp.setAttribute("xChannelSelector","R");warp.setAttribute("yChannelSelector","G");
  filter.append(noise,smooth,warp);defs.appendChild(filter);svg.appendChild(defs);svg.classList.add("ng-liquid-defs");svg.setAttribute("width","0");svg.setAttribute("height","0");
  glass.style.backdropFilter=`url(#${id}) blur(.6px)`;glass.style.setProperty("-webkit-backdrop-filter",`url(#${id}) blur(.6px)`);
  root.append(svg,glass,canvas);document.body.appendChild(root);
  const dropsData=new Float32Array(MAX*4),flowData=new Float32Array(MAX*4);
  let gl:WebGLRenderingContext|null=null,program:WebGLProgram|null=null,buffer:WebGLBuffer|null=null;
  let dropsLocation:WebGLUniformLocation|null=null,flowLocation:WebGLUniformLocation|null=null,countLocation:WebGLUniformLocation|null=null,timeLocation:WebGLUniformLocation|null=null,resolutionLocation:WebGLUniformLocation|null=null,dprLocation:WebGLUniformLocation|null=null;
  let pointerLocation:WebGLUniformLocation|null=null;
  let frame=0,last=0,lastEmit=0,disposed=false,failed=false;
  let viewWidth=0,viewHeight=0,dpr=0,drops:Drop[]=[];
  let target:{x:number;y:number}|null=null,head:{x:number;y:number}|null=null,anchor:{x:number;y:number}|null=null;
  const lifetime=level==="full"?1300:1150;
  function release(){if(gl){gl.deleteBuffer(buffer);gl.deleteProgram(program);}buffer=null;program=null;gl=null;}
  function init(){
    if(gl)return true;if(failed)return false;
    try{
      gl=canvas.getContext("webgl",{alpha:true,premultipliedAlpha:true,antialias:false,depth:false,stencil:false});
      if(!gl)throw new Error("WebGL unavailable");
      const shaders:WebGLShader[]=[];
      try{
        for(const[type,source]of[[gl.VERTEX_SHADER,VERTEX],[gl.FRAGMENT_SHADER,FRAGMENT]]as const){
          const shader=gl.createShader(type);if(!shader)throw new Error("Shader unavailable");shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);
          if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error("Shader compilation failed");
        }
        program=gl.createProgram();if(!program)throw new Error("Program unavailable");
        shaders.forEach(shader=>gl!.attachShader(program!,shader));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error("Shader link failed");
      }finally{shaders.forEach(shader=>gl!.deleteShader(shader));}
      gl.useProgram(program);buffer=gl.createBuffer();if(!buffer)throw new Error("Buffer unavailable");
      gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
      const position=gl.getAttribLocation(program!,"a_position");gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,8,0);
      const loc=(name:string)=>gl!.getUniformLocation(program!,name);
      dropsLocation=loc("u_drops[0]");flowLocation=loc("u_flow[0]");countLocation=loc("u_count");timeLocation=loc("u_time");resolutionLocation=loc("u_resolution");dprLocation=loc("u_dpr");
      pointerLocation=loc("u_pointer");
      gl.uniform1f(loc("u_intensity"),level==="full"?1.15:.92);
      gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.clearColor(0,0,0,0);
      return true;
    }catch{failed=true;release();root.dataset.state="unavailable";return false;}
  }
  function tick(now:number){
    frame=0;if(disposed||!gl||failed)return;
    const dt=Math.min(40,Math.max(1,now-last||16.7));last=now;
    if(viewWidth!==innerWidth||viewHeight!==innerHeight||dpr!==(devicePixelRatio||1)){
      viewWidth=innerWidth;viewHeight=innerHeight;dpr=devicePixelRatio||1;
      canvas.width=Math.round(viewWidth*dpr);canvas.height=Math.round(viewHeight*dpr);gl.viewport(0,0,canvas.width,canvas.height);
    }
    if(target&&head){
      const ease=1-Math.exp(-dt/18);head.x+=(target.x-head.x)*ease;head.y+=(target.y-head.y)*ease;
      if(anchor&&now-lastEmit>=95){
        const dx=head.x-anchor.x,dy=head.y-anchor.y,distance=Math.hypot(dx,dy);
        if(distance>1){
          const speed=distance/Math.max(16,now-lastEmit)*1000;
          const energy=Math.min(1,speed/1800);
          drops.push({x:head.x,y:head.y,dx:dx/distance,dy:dy/distance,radius:36+energy*(level==="full"?36:28),born:now,phase:now*.003,speed});
          anchor={...head};lastEmit=now;
        }
      }
    }
    drops=drops.filter(drop=>now-drop.born<lifetime).slice(-8);
    gl.disable(gl.SCISSOR_TEST);gl.clear(gl.COLOR_BUFFER_BIT);
    if(drops.length){
      const positions=drops.map(drop=>{
        const age=(now-drop.born)/lifetime;
        const drift=Math.sin(drop.phase+age*3)*age*3;
        const energy=Math.min(1,drop.speed/1800);
        const propagation=Math.min(2600,120+drop.speed*1.2)*(now-drop.born)/1000;
        return{x:drop.x+drop.dx*propagation-drop.dy*drift,y:drop.y+drop.dy*propagation+drop.dx*drift,r:drop.radius*(.8+age*2.3),age,weight:(.24+energy*.14)*Math.pow(1-age,2.1),drop};
      });
      let left=viewWidth,top=viewHeight,right=0,bottom=0;
      positions.forEach((p,i)=>{
        left=Math.min(left,p.x-p.r*1.8);top=Math.min(top,p.y-p.r*1.8);right=Math.max(right,p.x+p.r*1.8);bottom=Math.max(bottom,p.y+p.r*1.8);
        dropsData.set([p.x,p.y,p.r,p.weight],i*4);flowData.set([p.drop.dx,p.drop.dy,p.age,Math.min(1,p.drop.speed/1800)],i*4);
      });
      left=Math.max(0,Math.floor(left));top=Math.max(0,Math.floor(top));right=Math.min(viewWidth,Math.ceil(right));bottom=Math.min(viewHeight,Math.ceil(bottom));
      if(right>left&&bottom>top){
        glass.style.visibility="visible";
        gl.enable(gl.SCISSOR_TEST);gl.scissor(Math.floor(left*dpr),Math.floor((viewHeight-bottom)*dpr),Math.ceil((right-left)*dpr),Math.ceil((bottom-top)*dpr));
        gl.uniform2f(resolutionLocation,canvas.width,canvas.height);gl.uniform1f(dprLocation,dpr);gl.uniform1f(timeLocation,now/1000);
        gl.uniform2f(pointerLocation,head?.x??-1000,head?.y??-1000);
        gl.uniform1i(countLocation,positions.length);gl.uniform4fv(dropsLocation,dropsData);gl.uniform4fv(flowLocation,flowData);gl.drawArrays(gl.TRIANGLES,0,6);
        glass.style.left=`${left}px`;glass.style.top=`${top}px`;glass.style.width=`${right-left}px`;glass.style.height=`${bottom-top}px`;
        const mask=positions.filter((_,i)=>positions.length<18||i%2===0).map(p=>{
          const alpha=Math.min(.95,p.weight*2.3).toFixed(3);
          const x=p.x+p.drop.dx*p.r*.22-left,y=p.y+p.drop.dy*p.r*.22-top;
          return `radial-gradient(circle ${(p.r*1.05).toFixed(1)}px at ${x.toFixed(1)}px ${y.toFixed(1)}px,transparent 0% 16%,rgba(0,0,0,${(+alpha*.7).toFixed(3)}) 42%,rgba(0,0,0,${(+alpha*.2).toFixed(3)}) 70%,transparent 100%)`;
        }).join(",");
        glass.style.maskImage=mask;glass.style.setProperty("-webkit-mask-image",mask);
      }else glass.style.visibility="hidden";
      root.dataset.state="active";frame=requestAnimationFrame(tick);
    }else if(target&&head&&Math.hypot(target.x-head.x,target.y-head.y)>.8){frame=requestAnimationFrame(tick);}
    else{root.dataset.state="idle";last=0;}
  }
  function move(event:PointerEvent){
    if(event.pointerType!=="mouse"||document.hidden||document.pointerLockElement||failed)return;
    if(!init())return;
    target={x:event.clientX,y:event.clientY};
    if(!head){head={...target};anchor={...target};lastEmit=performance.now();}
    if(!frame)frame=requestAnimationFrame(tick);
  }
  function reset(){cancelAnimationFrame(frame);frame=0;last=0;target=head=anchor=null;drops=[];if(gl){gl.disable(gl.SCISSOR_TEST);gl.clear(gl.COLOR_BUFFER_BIT);}root.dataset.state="idle";glass.style.maskImage="none";}
  function leave(event:PointerEvent){if(!event.relatedTarget)target=null;}
  function lost(event:Event){event.preventDefault();reset();failed=true;root.dataset.state="unavailable";}
  function restored(){release();failed=false;dpr=0;root.dataset.state="idle";}
  window.addEventListener("pointermove",move,{passive:true});window.addEventListener("pointerout",leave,{passive:true});
  window.addEventListener("blur",reset);window.addEventListener("resize",reset);window.addEventListener("pagehide",reset);window.addEventListener("beforeprint",reset);
  document.addEventListener("visibilitychange",reset);document.addEventListener("pointerlockchange",reset);
  canvas.addEventListener("webglcontextlost",lost);canvas.addEventListener("webglcontextrestored",restored);
  return()=>{
    disposed=true;reset();window.removeEventListener("pointermove",move);window.removeEventListener("pointerout",leave);window.removeEventListener("blur",reset);window.removeEventListener("resize",reset);window.removeEventListener("pagehide",reset);window.removeEventListener("beforeprint",reset);document.removeEventListener("visibilitychange",reset);document.removeEventListener("pointerlockchange",reset);canvas.removeEventListener("webglcontextlost",lost);canvas.removeEventListener("webglcontextrestored",restored);
    const context=gl;release();context?.getExtension("WEBGL_lose_context")?.loseContext();root.remove();
  };
}
