import * as T from "three";

/** Real strand geometry: spokes are laid first, followed by bowed capture threads. */
export function createAtlasWeb(scene: T.Scene, id: string, position: T.Vector3, size: [number, number]) {
  const group = new T.Group(); group.name = `silk-web:${id}`; group.position.copy(position); group.scale.set(size[0], size[1], 1); group.visible = false; scene.add(group);
  const vertices: number[] = [], reveal: number[] = [], pearls: number[] = [], pearlReveal: number[] = [];
  const spokes = 16, seed = [...id].reduce((a,c)=>a+c.charCodeAt(0),0);
  const anchors = Array.from({length:spokes},(_,i)=>{const a=i*Math.PI*2/spokes+.04*Math.sin(i*7.3+seed),r=1+.07*Math.sin(i*3.1+seed);return new T.Vector3(Math.cos(a)*r,Math.sin(a)*r,0);});
  function point(i:number,r:number) { const p=anchors[i%spokes].clone().multiplyScalar(r);p.z=Math.sin(r*Math.PI)*1.5;return p; }
  function strand(a:T.Vector3,b:T.Vector3,orderA:number,orderB:number) { vertices.push(...a.toArray(),...b.toArray());reveal.push(orderA,orderB); }
  for(let i=0;i<spokes;i++) {
    for(let j=0;j<14;j++) {
      const a=point(i,j/14*1.16),b=point(i,(j+1)/14*1.16); strand(a,b,j/14*.34,(j+1)/14*.34);
    }
    for(let ring=1;ring<=7;ring++) {
      const radius=ring/7*.96, start=point(i,radius), end=point(i+1,radius), order=.3+radius*.62+i/spokes*.04;
      let prior=start;
      for(let j=1;j<=6;j++) { const t=j/6, p=start.clone().lerp(end,t).multiplyScalar(1-Math.sin(t*Math.PI)*.075);p.z+=Math.sin(t*Math.PI)*.8;strand(prior,p,order+(j-1)/6*.025,order+t*.025);prior=p; }
      if((i+ring)%3===0) { pearls.push(...start.toArray());pearlReveal.push(order); }
    }
  }
  const geometry = new T.BufferGeometry(); geometry.setAttribute("position",new T.Float32BufferAttribute(vertices,3));geometry.setAttribute("reveal",new T.Float32BufferAttribute(reveal,1));
  const uniforms = { progress:{value:0}, opacity:{value:0}, time:{value:0}, hue:{value:new T.Color("#cde7f7")}, pixelRatio:{value:1} };
  const vertexShader = `attribute float reveal; varying float vReveal; uniform float time;
    void main(){vReveal=reveal;vec3 p=position;p.z+=sin(time*3.+position.x*13.+position.y*9.)*.22;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`;
  const material = new T.ShaderMaterial({uniforms,vertexShader,fragmentShader:`varying float vReveal;uniform float progress;uniform float opacity;uniform vec3 hue;
    void main(){float ink=smoothstep(vReveal-.035,vReveal+.015,progress);float tip=1.-smoothstep(.0,.07,abs(progress-vReveal));gl_FragColor=vec4(mix(hue,vec3(1.),tip*.65),ink*opacity);}`,transparent:true,depthWrite:false,toneMapped:false});
  group.add(new T.LineSegments(geometry,material));
  const dew = new T.BufferGeometry();dew.setAttribute("position",new T.Float32BufferAttribute(pearls,3));dew.setAttribute("reveal",new T.Float32BufferAttribute(pearlReveal,1));
  const dewMaterial = new T.ShaderMaterial({uniforms,vertexShader:`attribute float reveal;varying float vReveal;uniform float pixelRatio;
    void main(){vReveal=reveal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=3.2*pixelRatio;}`,fragmentShader:`varying float vReveal;uniform float progress;uniform float opacity;uniform vec3 hue;
    void main(){float d=length(gl_PointCoord-.5)*2.;float a=(1.-smoothstep(.2,1.,d))*smoothstep(vReveal,vReveal+.07,progress)*opacity;gl_FragColor=vec4(mix(hue,vec3(1.),.7),a*.75);}`,transparent:true,depthWrite:false,toneMapped:false});
  group.add(new T.Points(dew,dewMaterial));
  let born=-100, selected=false, leaving=-100, active=false;
  return { id, group, uniforms,
    play(now:number,color:string,persistent=false,instant=false) { born=now-(instant?1.3:0);active=true;selected=persistent;leaving=-100;uniforms.hue.value.set(color).lerp(new T.Color("#eef6ff"),.76);group.visible=true; },
    deselect(now:number) { if(selected) {selected=false;leaving=now;} },
    update(now:number,pixelRatio:number) {
      const age=Math.max(0,now-born),draw=Math.min(1,age/1.3),fade=selected?1:leaving>=0?Math.max(0,1-(now-leaving)/.65):Math.max(0,1-(age-1.7)/1.1);
      group.visible=active&&fade>0;uniforms.progress.value=draw;uniforms.opacity.value=fade*(selected?.67:.84);uniforms.time.value=now;uniforms.pixelRatio.value=pixelRatio;
      return group.visible;
    }
  };
}
