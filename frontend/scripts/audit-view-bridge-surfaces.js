// Inspect rendered bridge triangles in the actual app, including building view.
// No network, storage, credentials or application data is changed.
() => {
  const stage = window.__holoStageAny?.current;
  const roads = (window.__qaViewRoads ?? []).filter(r => r.id?.startsWith('deck:'));
  if (!stage || !roads.length) return { error: 'Bridge scene is not ready' };
  stage.scene.updateMatrixWorld(true);
  const cells = new Map(), size = 20;
  let meshes = 0, triangles = 0;
  stage.scene.traverseVisible(m => {
    if (!m.isMesh || m.name!=='road surface') return;
    meshes++;
    const p = m.geometry.getAttribute('position'), ix = m.geometry.index, e = m.matrixWorld.elements;
    const level=m.geometry.getAttribute('roadLevel'),profile=m.geometry.getAttribute('roadProfile');
    const profiles=new Map([...(m.geometry.userData.roadProfiles??[])].map(([key,value])=>[value,key]));
    const point = i => { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); return [e[0]*x+e[4]*y+e[8]*z+e[12], -(e[2]*x+e[6]*y+e[10]*z+e[14]), e[1]*x+e[5]*y+e[9]*z+e[13]]; };
    for (let k = 0; k < (ix?.count ?? p.count); k += 3) {
      const t = [0,1,2].map(j => point(ix ? ix.getX(k+j) : k+j));
      const first=ix?ix.getX(k):k,owner={t,level:level?.getX(first),profile:profiles.get(profile?.getX(first))};
      const x0 = Math.min(...t.map(p=>p[0])), x1 = Math.max(...t.map(p=>p[0]));
      const y0 = Math.min(...t.map(p=>p[1])), y1 = Math.max(...t.map(p=>p[1]));
      for (let i=Math.floor(x0/size);i<=Math.floor(x1/size);i++) for(let j=Math.floor(y0/size);j<=Math.floor(y1/size);j++) {
        const key=i+','+j;let list=cells.get(key);if(!list)cells.set(key,list=[]);list.push(owner);
      }
      triangles++;
    }
  });
  const heights=(x,y,road)=>{
    const values=[];
    for(const hit of cells.get(Math.floor(x/size)+','+Math.floor(y/size))??[]) {
      if(hit.level!==1||hit.profile!==(road.link_id??road.id))continue;
      const [a,b,c]=hit.t;
      const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-10)continue;
      const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den;
      const v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den;
      if(u>=-1e-5&&v>=-1e-5&&u+v<=1.00001)values.push(u*a[2]+v*b[2]+(1-u-v)*c[2]);
    }
    return values;
  };
  return {meshes,triangles,roads:roads.map(r=>{
    let samples=0,missing=0,over680=0,missingOutside=0,maxStep=0,previous=null;
    const findings=[];
    for(let i=1;i<r.line.length;i++) {
      const a=r.line[i-1],b=r.line[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
      const n=Math.max(1,Math.ceil(length/3));
      for(let j=0;j<=n;j++) {
        const x=a[0]+(b[0]-a[0])*j/n,y=a[1]+(b[1]-a[1])*j/n,zs=heights(x,y,r);
        samples++;const outside=Math.max(Math.abs(x),Math.abs(y))>680;if(outside)over680++;
        if(!zs.length){missing++;if(outside)missingOutside++;previous=null;if(findings.length<4)findings.push({x,y});continue;}
        const z=Math.max(...zs);if(previous!==null){const step=Math.abs(z-previous);maxStep=Math.max(maxStep,step);if(step>.8&&findings.length<8)findings.push({type:'step',x,y,z,previous,step});}previous=z;
      }
    }
    return {id:r.id,samples,missing,over680,missingOutside,maxStep,findings};
  })};
}
