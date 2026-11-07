const STRANDS = 104;
const SEGMENTS = 96;
const VERTEX = `
precision highp float;
attribute vec4 a_data;
uniform vec2 u_viewport;
uniform float u_time;
uniform float u_length;
uniform float u_width;
varying vec4 v_data;
void main(){
  float y=(a_data.x-.5)*u_length;
  float s=a_data.y, r=a_data.z;
  float tempo=r<.5?.64:r<1.5?.98:1.38;
  float t=u_time*tempo+r*4.7;
  float waveScale=r<.5?.78:r<1.5?1.05:1.32;
  float wave=y*waveScale;
  float breadth=clamp(u_viewport.x*.047,34.,84.);
  float amplitude=clamp(u_viewport.x*.024,20.,62.)*(r<.5?.88:r<1.5?1.23:.74);
  float p=wave*.0038+t*.39+r*2.1;
  float q=wave*.0071-t*.27+r*.8;
  float w=wave*.0043+t*.31+r;
  float a=wave*.009+t*.73+s*9.+r;
  float b=wave*.0056-t*.59+s*14.-r;
  float spread=breadth*(.90+.13*sin(w));
  float x=(r-1.)*u_viewport.x*.36+sin(p)*amplitude+sin(q)*amplitude*.34+s*spread;
  x+=sin(a)*breadth*.20*(1.-s*s)+sin(b)*breadth*.13*(1.-.5*abs(s));
  float dx=cos(p)*amplitude*.0038+cos(q)*amplitude*.34*.0071+s*breadth*.13*cos(w)*.0043;
  dx+=cos(a)*breadth*.20*(1.-s*s)*.009+cos(b)*breadth*.13*(1.-.5*abs(s))*.0056;
  vec2 normal=normalize(vec2(1.,-dx*waveScale));
  vec2 pos=vec2(x,y)+normal*a_data.w*u_width*.5;
  float angle=.4537856;
  pos=mat2(cos(angle),sin(angle),-sin(angle),cos(angle))*pos;
  vec2 clip=pos/u_viewport*2.;
  gl_Position=vec4(clip.x,-clip.y,0.,1.);
  v_data=vec4(y,s,r,a_data.w);
}`;
const FRAGMENT = `
precision highp float;
uniform float u_time;
uniform float u_glow;
uniform float u_brightness;
uniform vec3 u_violet;
varying vec4 v_data;
void main(){
  float y=v_data.x, s=v_data.y, r=v_data.z;
  float t=u_time*(r<.5?.72:r<1.5?1.05:1.36)+r*3.2;
  float a=.5+.5*sin(y*.0037+t*1.12+r*2.3);
  float b=.5+.5*sin(y*.0061+t*.79+r*.7);
  float packet=pow(a,12.)*(.48+.52*b);
  float inner=.5+.5*sin(y*.010+t*1.87+s*8.+r);
  float filaments=pow(inner,10.)*pow(b,5.);
  float energy=packet*.85+filaments*.45;
  vec3 color=r<.5?vec3(.33,.89,.98):r<1.5?u_violet:vec3(.48,.69,1.);
  color=mix(color,vec3(.88,.98,1.),min(.8,energy*.72));
  float across=abs(v_data.w);
  float feather=1.-smoothstep(.35,1.,across);
  float alpha;
  if(u_glow>1.5){alpha=exp(-across*across*4.)*(1.-smoothstep(.75,1.,across))*(.004+energy*.033);}
  else if(u_glow>.5){alpha=exp(-across*across*4.)*(1.-smoothstep(.78,1.,across))*(.008+energy*.1);}
  else {alpha=feather*(.11+energy*.72)*(.72+.28*sin(s*19.+r)*sin(s*19.+r));}
  alpha*=u_brightness;
  gl_FragColor=vec4(color*alpha,alpha);
}`;

/** Static strand geometry; waves, crossings and emission evolve entirely on GPU. */
export function installElectricRivers(canvas: HTMLCanvasElement, level: "full" | "balanced" | "minimal") {
  const gl = canvas.getContext("webgl", {alpha:true,premultipliedAlpha:true,antialias:true,depth:false,stencil:false});
  if (!gl) throw new Error("WebGL unavailable");
  const shaders: WebGLShader[] = [];
  let program: WebGLProgram | null = null;
  let vertexBuffer: WebGLBuffer | null = null;
  let indexBuffer: WebGLBuffer | null = null;
  let haloBuffer: WebGLBuffer | null = null;
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]] as const) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("Shader unavailable");
      shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "Shader compilation failed");
    }
    program = gl.createProgram();
    if (!program) throw new Error("Program unavailable");
    shaders.forEach(shader => gl.attachShader(program!, shader)); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Shader link failed");
    gl.useProgram(program);
    const vertices = new Float32Array(3 * STRANDS * (SEGMENTS + 1) * 2 * 4);
    const indices = new Uint16Array(3 * STRANDS * SEGMENTS * 6);
    const haloIndices: number[] = [];
    let vi = 0, ii = 0, vertex = 0;
    for (let river = 0; river < 3; river++) for (let strand = 0; strand < STRANDS; strand++) {
      for (let segment = 0; segment <= SEGMENTS; segment++) {
        for (const side of [-1,1]) {
          vertices[vi++]=segment/SEGMENTS; vertices[vi++]=strand/(STRANDS-1)*2-1;
          vertices[vi++]=river; vertices[vi++]=side;
        }
        if (segment < SEGMENTS) {
          const base=vertex+segment*2;
          indices[ii++]=base; indices[ii++]=base+1; indices[ii++]=base+2;
          indices[ii++]=base+1; indices[ii++]=base+3; indices[ii++]=base+2;
          if(strand%16===8)haloIndices.push(base,base+1,base+2,base+1,base+3,base+2);
        }
      }
      vertex+=(SEGMENTS+1)*2;
    }
    vertexBuffer=gl.createBuffer(); indexBuffer=gl.createBuffer(); haloBuffer=gl.createBuffer();
    if(!vertexBuffer||!indexBuffer||!haloBuffer) throw new Error("Buffer unavailable");
    gl.bindBuffer(gl.ARRAY_BUFFER,vertexBuffer); gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indexBuffer); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,indices,gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,haloBuffer);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(haloIndices),gl.STATIC_DRAW);
    const data=gl.getAttribLocation(program,"a_data");gl.enableVertexAttribArray(data);gl.vertexAttribPointer(data,4,gl.FLOAT,false,16,0);
    gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);gl.clearColor(0,0,0,0);
    const loc=(name:string)=>gl.getUniformLocation(program!,name);
    const viewport=loc("u_viewport"), time=loc("u_time"), length=loc("u_length"), width=loc("u_width"), glow=loc("u_glow");
    const violet=getComputedStyle(canvas).getPropertyValue("--accent-neon").trim();
    const hex=/^#([\da-f]{6})$/i.exec(violet)?.[1] ?? "bf85ff";
    gl.uniform3f(loc("u_violet"),parseInt(hex.slice(0,2),16)/255,parseInt(hex.slice(2,4),16)/255,parseInt(hex.slice(4,6),16)/255);
    gl.uniform1f(loc("u_brightness"),level==="full"?1.85:level==="minimal"?.85:1.5);
    let frame=0, last=0, elapsed=0, disposed=false, lost=false;
    let viewWidth=0,viewHeight=0,pixelRatio=0;
    const reduced=matchMedia("(prefers-reduced-motion: reduce)");
    function draw(now:number){
      frame=0;
      if(disposed||lost||document.hidden)return;
      if(last)elapsed+=Math.min(50,now-last)/1000;
      last=now;
      if(viewWidth!==innerWidth||viewHeight!==innerHeight||pixelRatio!==devicePixelRatio){
        viewWidth=innerWidth;viewHeight=innerHeight;pixelRatio=devicePixelRatio||1;
        canvas.width=Math.round(viewWidth*pixelRatio);canvas.height=Math.round(viewHeight*pixelRatio);
        gl!.viewport(0,0,canvas.width,canvas.height);
        gl!.uniform2f(viewport,viewWidth,viewHeight);gl!.uniform1f(length,Math.hypot(viewWidth,viewHeight)*1.38);
      }
      gl!.clear(gl!.COLOR_BUFFER_BIT);gl!.uniform1f(time,elapsed+5.3);
      gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER,haloBuffer);
      gl!.uniform1f(glow,2);gl!.uniform1f(width,112);gl!.drawElements(gl!.TRIANGLES,haloIndices.length,gl!.UNSIGNED_SHORT,0);
      gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER,indexBuffer);
      gl!.uniform1f(glow,1);gl!.uniform1f(width,4.8);gl!.drawElements(gl!.TRIANGLES,indices.length,gl!.UNSIGNED_SHORT,0);
      gl!.uniform1f(glow,0);gl!.uniform1f(width,.64);gl!.drawElements(gl!.TRIANGLES,indices.length,gl!.UNSIGNED_SHORT,0);
      canvas.dataset.state=level==="minimal"||reduced.matches?"still":"live";
      if(level!=="minimal"&&!reduced.matches)frame=requestAnimationFrame(draw);
    }
    function sync(){cancelAnimationFrame(frame);frame=0;last=0;if(!document.hidden)frame=requestAnimationFrame(draw);}
    function contextLost(event:Event){event.preventDefault();lost=true;cancelAnimationFrame(frame);canvas.dataset.state="unavailable";}
    document.addEventListener("visibilitychange",sync);window.addEventListener("resize",sync);reduced.addEventListener("change",sync);
    canvas.addEventListener("webglcontextlost",contextLost);
    sync();
    return ()=>{
      disposed=true;cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange",sync);window.removeEventListener("resize",sync);reduced.removeEventListener("change",sync);
      canvas.removeEventListener("webglcontextlost",contextLost);
      gl.clear(gl.COLOR_BUFFER_BIT);gl.deleteBuffer(vertexBuffer);gl.deleteBuffer(indexBuffer);gl.deleteBuffer(haloBuffer);gl.deleteProgram(program);
    };
  }catch(error){gl.deleteBuffer(vertexBuffer);gl.deleteBuffer(indexBuffer);gl.deleteBuffer(haloBuffer);gl.deleteProgram(program);throw error;}
  finally{shaders.forEach(shader=>gl.deleteShader(shader));}
}
