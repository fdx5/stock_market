import * as T from "three";
import { DOMAIN_COLORS } from "./atlasFlowModel";

/** Functional landmarks rather than repeated cards: market, stream, city, neural core, turbine, jewel. */
export function createServiceLandmark(scene: T.Scene, id: string, point: T.Vector3) {
  const root = new T.Group(); root.position.copy(point); scene.add(root);
  const hue = DOMAIN_COLORS[id], metal = new T.MeshStandardMaterial({ color: "#33455e", metalness: .83, roughness: .26 });
  const glass = new T.MeshPhysicalMaterial({ color: hue, emissive: hue, emissiveIntensity: .3, metalness: .5, roughness: .17, clearcoat: 1, transparent: true, opacity: .84 });
  const dark = new T.MeshStandardMaterial({ color: "#132039", metalness: .72, roughness: .35 });
  const light = new T.MeshBasicMaterial({ color: hue, transparent: true, opacity: .8, blending: T.AdditiveBlending, depthWrite: false });
  const add = (parent: T.Group, geo: T.BufferGeometry, mat: T.Material, x = 0, y = 0, z = 0) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
  const base = add(root, new T.CylinderGeometry(58, 62, 5, id === "realestate" ? 4 : id === "prediction" ? 6 : id === "support" ? 5 : 64), dark, 0, 0, -13); base.rotation.x = Math.PI / 2; if (id === "realestate") base.rotation.z = Math.PI / 4;
  const glyph = new T.Group(); glyph.rotation.set(-.65, .08, -.25); root.add(glyph);
  let rotor: T.Object3D | null = null;
  if (id === "market") {
    // Bull/bear candles rising from a luminous trading lattice.
    for (let i = 0; i < 5; i++) {
      const h = [20, 33, 27, 46, 37][i], x = -34 + i * 16;
      add(glyph, new T.BoxGeometry(9, 13, h), i % 3 === 2 ? metal : glass, x, 0, h / 2);
      add(glyph, new T.BoxGeometry(1.2, 1.2, h + 16), light, x, 0, h / 2);
      add(glyph, new T.BoxGeometry(12, 17, 2), metal, x, 0, 1);
    }
    const chart = new T.BufferGeometry().setFromPoints([[-42, -17, 2], [-24, -15, 9], [-8, -16, 7], [8, -17, 22], [23, -17, 18], [41, -17, 33]].map(p => new T.Vector3(...p as [number, number, number]))); glyph.add(new T.Line(chart, new T.LineBasicMaterial({ color: hue })));
  } else if (id === "community") {
    // News sheets radiating from a broadcast mast.
    for (let i = 0; i < 3; i++) {
      const sheet = new T.Group(); sheet.position.set(-25 + i * 25, 0, 10 + i * 7); sheet.rotation.z = -.3 + i * .25; glyph.add(sheet);
      add(sheet, new T.BoxGeometry(24, 3, 34), i === 1 ? glass : metal, 0, 0, 12);
      for (let j = 0; j < 4; j++) add(sheet, new T.BoxGeometry(15 - j * 2, .7, 1.1), light, 0, -2, 23 - j * 6);
    }
    const wave = add(glyph, new T.TorusGeometry(43, .9, 5, 90), light, 0, 5, 13); wave.rotation.x = .35; rotor = wave;
  } else if (id === "realestate") {
    // A surveyed city block: glass skyscraper, stepped roof and low-rise volumes.
    add(glyph, new T.BoxGeometry(76, 51, 4), metal, 0, 0, 0);
    [[-22,-8,18,18,24], [4,5,19,20,51], [26,-8,15,22,30], [-19,16,19,12,13]].forEach(([x,y,w,d,h]) => {
      add(glyph,new T.BoxGeometry(w,d,h),dark,x,y,h/2+3); add(glyph,new T.BoxGeometry(w+1,d+1,2),glass,x,y,h+4);
      for(let floor=8;floor<h;floor+=7) { add(glyph,new T.BoxGeometry(w+.4,.8,1.6),light,x,y-d/2-.3,floor+3); add(glyph,new T.BoxGeometry(.8,d+.4,1.6),light,x+w/2+.3,y,floor+3); }
    });
  } else if (id === "prediction") {
    // A neural constellation; every node is connected to the inference core.
    const core = add(glyph,new T.IcosahedronGeometry(17,1),glass,0,0,22); rotor = core;
    const links:number[]=[];
    for(let i=0;i<12;i++) { const a=i*Math.PI*2/12, p=new T.Vector3(Math.cos(a)*38,Math.sin(a)*29,10+(i%3)*13); add(glyph,new T.SphereGeometry(i%3===0?4.2:2.8,12,10),i%3===0?glass:light,p.x,p.y,p.z); links.push(...p.toArray(),0,0,22); }
    const geometry=new T.BufferGeometry(); geometry.setAttribute('position',new T.Float32BufferAttribute(links,3)); glyph.add(new T.LineSegments(geometry,new T.LineBasicMaterial({color:hue,transparent:true,opacity:.5})));
    add(glyph,new T.TorusGeometry(39,1.2,6,80),metal,0,0,21);
  } else if (id === "operations") {
    // Exposed turbine: eight blades, control spindle and luminous concentric tracks.
    const turbine = new T.Group(); turbine.position.z=16; glyph.add(turbine); rotor=turbine;
    for(let i=0;i<8;i++) { const blade=add(turbine,new T.BoxGeometry(23,8,7),i%2?metal:glass,0,0,0); const a=i*Math.PI/4; blade.position.set(Math.cos(a)*23,Math.sin(a)*23,0); blade.rotation.z=a+.45; }
    add(glyph,new T.CylinderGeometry(12,15,25,24),glass,0,0,16).rotation.x=Math.PI/2;
    add(glyph,new T.TorusGeometry(44,3,8,80),metal,0,0,9); add(glyph,new T.TorusGeometry(46,.8,5,80),light,0,0,11);
  } else {
    // Faceted energy jewel with a gold collection orbit, distinct from the API portal.
    const jewel=add(glyph,new T.OctahedronGeometry(24),glass,0,0,25); jewel.scale.set(.85,.85,1.2); rotor=jewel;
    const ring=add(glyph,new T.TorusGeometry(41,1.4,6,80),light,0,0,15); ring.rotation.x=.45;
    for(let i=0;i<5;i++) { const a=i*Math.PI*2/5; add(glyph,new T.SphereGeometry(3,12,10),glass,Math.cos(a)*41,Math.sin(a)*41,15); }
  }
  return { id, root, update(time:number, selected:boolean) { light.opacity=selected?.85:.55; glass.emissiveIntensity=.25; if(rotor) rotor.rotation.z=time*(id==='operations'?.22:.06); } };
}
