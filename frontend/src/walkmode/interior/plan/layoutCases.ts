import type { Opening, RoomType } from "./types";
import type { Template, R, O } from "./generate";

/** Eight different circulation/room organisations, with 64 dimensional cases each. These are
 * explicitly simulations; an address/area match alone never turns one into an actual drawing. */
export const LAYOUT_FAMILIES = ["전면 베이", "중앙 세로복도", "코너 거실", "공사 분리형", "가로 갤러리", "ㄱ자 주거", "와이드 거실", "컴팩트 분리형"] as const;
export const LAYOUT_CASES = LAYOUT_FAMILIES.length * 64;
export const caseNumber = (value: number) => Number.isFinite(value) ? ((Math.trunc(value) % LAYOUT_CASES) + LAYOUT_CASES) % LAYOUT_CASES : 0;

export function makeCaseLayout(area: number, index: number, rnd: () => number): Template | null {
  const family = caseNumber(index) % LAYOUT_FAMILIES.length;
  if (family === 0) return null; // the existing bay layouts remain one of the eight families
  const rows: R[] = [], openings: O[] = [];
  const vary = (v: number, spread = .08) => v * (1 + (rnd() - .5) * spread * 2);
  const W = vary(family === 1 ? 9.8 : 11.2), D = vary(family === 1 ? 11.6 : family===2?10.8:9.6);
  const add = (id: string, type: RoomType, label: string, x0: number, z0: number, x1: number, z1: number, zone?: string) => rows.push([id, type, label, x0, z0, x1, z1, zone]);
  const bed = (id: string, x0: number, z0: number, x1: number, z1: number) => add(id, id === "master" ? "master" : "bedroom", id === "master" ? "안방" : id === "bed2" ? "침실2" : "침실3", x0, z0, x1, z1);
  if (family === 1) {
    const a = W * vary(.42, .035), b = a + 1.45, z = D * vary(.245, .035), y = D * vary(.59, .035);
    add("entry", "entrance", "현관", a, 0, b, z);
    add("hall", "hall", "중앙 복도", a, z, b, y, "circulation");
    bed("bed3", 0, 0, a, z); bed("bed2", 0, z, a, y); bed("master", b, z, W, y);
    add("bath2", "bathroom", "욕실", b, 0, W, z);
    add("living", "living", "거실", 0, y, b, D, "lk"); add("kitchen", "kitchen", "주방·다이닝", b, y, W, D, "lk");
  } else if (family === 2) {
    const a = W * vary(.35, .04), b = W * vary(.68, .035), z = D * vary(.32, .04), y = z + 1.4, s = D * .67;
    bed("master", 0, 0, a, z); bed("bed2", a, 0, b, z); bed("bed3", b, 0, W, z);
    add("hall", "hall", "가로 복도", 0, z, W, y, "circulation");
    add("bath2", "bathroom", "욕실", 0, y, a * .54, s); add("util", "utility", "세탁실", a * .54, y, a, s);
    add("hall2", "hall", "거실 진입 홀", a, y, W - 1.8, s, "circulation"); add("entry", "entrance", "측면 현관", W - 1.8, y, W, s);
    add("kitchen", "kitchen", "분리 주방", 0, s, a, D); add("living", "living", "코너 거실", a, s, W, D);
  } else if (family === 3 || family === 7) {
    const a = W * vary(.34, .035), b = W * vary(.67, .035), z = D * .25, y = D * vary(.43, .035), s = D * .72;
    add("entry", "entrance", "현관", 0, 0, a * .48, z); add("bath2", "bathroom", "공용 욕실", a * .48, 0, a, z);
    add("hall", "hall", "진입 복도", 0, z, a, y, "circulation");
    add("kitchen", "kitchen", family === 7 ? "독립 다이닝" : "주방·다이닝", a, 0, b, y, family === 7 ? undefined : "lk");
    add("util", "utility", "다용도실", b, 0, W, z);
    add("dress", "dressroom", "드레스룸", b, z, (b + W) / 2, y); add("ensuite", "ensuite", "안방 욕실", (b + W) / 2, z, W, y);
    add("living", "living", "중앙 거실", a, y, b, D, family === 7 ? undefined : "lk"); bed("master", b, y, W, D);
    if (area >= 70 && family === 3) { bed("bed2", 0, y, a, s); bed("bed3", 0, s, a, D); }
    else { bed("bed2", 0, y, a, D); }
  } else if (family === 4) {
    const a = W * vary(.35, .03), b = a + 1.65, c = b + W * .18, z = D * vary(area<52?.50:area<65?.43:.34, .03), y = z + (area<52?1.1:1.4), split = W * vary(.53, .03);
    add("kitchen", "kitchen", "주방·식당", 0, 0, a, z); add("entry", "entrance", "현관", a, 0, b, z);
    add("bath2", "bathroom", "욕실", b, 0, c, z); bed("bed2", c, 0, W, z);
    add("hall", "hall", "갤러리 복도", 0, z, W, y, "circulation");
    add("living", "living", "거실", 0, y, split, D); bed("master", split, y, W, D);
    if(area>=52)add("util", "utility", "세탁실", 0, -1.2, Math.min(a, 2.1), 0);
  } else if (family === 5) {
    const a = W * vary(.33, .03), b = a + 1.6, c = W * .72, z = D * .3, y = D * vary(.6, .03);
    bed("bed2", 0, 0, a, z); add("entry", "entrance", "현관", a, 0, b, z); add("bath2", "bathroom", "욕실", b, 0, c, z);
    bed("master", 0, z, a, y); add("hall", "hall", "꺾인 복도", a, z, b, y, "circulation");
    add("kitchen", "kitchen", "코너 다이닝", b, z, W, y, "lk");
    add("living", "living", "ㄱ자 거실", 0, y, c, D, "lk"); bed("bed3", c, y, W, D);
  } else {
    const a = W * vary(.3, .035), b = W * vary(.62, .035), z = D * .31, y = z + 1.35;
    add("entry", "entrance", "현관", 0, 0, a * .47, z); add("bath2", "bathroom", "욕실", a * .47, 0, a, z);
    bed("bed2", a, 0, b, z); bed("master", b, 0, W, z);
    add("hall", "hall", "침실 복도", 0, z, W, y, "circulation");
    add("kitchen", "kitchen", "오픈 주방", 0, y, a, D, "lk"); add("living", "living", "와이드 거실·다이닝", a, y, W, D, "lk");
    add("util", "utility", "세탁실", 0, -1.2, Math.min(a, 2), 0);
  }

  // For small units, join the secondary bedrooms before fitting to their actual area.
  if (area < 52 && family === 1) {
    const first = rows.find(r => r[0] === "bed3")!, second = rows.find(r => r[0] === "bed2")!;
    second[4] = first[4]; rows.splice(rows.indexOf(first), 1);
  }
  if(area<52&&(family===2||family===5)){
    const third=rows.find(r=>r[0]==="bed3")!,target=rows.find(r=>r[0]===(family===2?"bed2":"living"))!;
    target[3]=Math.min(target[3],third[3]);target[5]=Math.max(target[5],third[5]);rows.splice(rows.indexOf(third),1);
  }
  const programme=Math.floor(caseNumber(index)/LAYOUT_FAMILIES.length);
  const swap=(a:R,b:R)=>{const old=[a[0],a[1],a[2],a[7]] as const;[a[0],a[1],a[2],a[7]]=[b[0],b[1],b[2],b[7]];[b[0],b[1],b[2],b[7]]=[...old];};
  const master=rows.find(r=>r[0]==="master")!,second=rows.find(r=>r[0]==="bed2");
  if((programme&1)&&second)swap(master,second);
  const living=rows.find(r=>r[0]==="living")!,kitchen=rows.find(r=>r[0]==="kitchen")!;
  // The public/private programme changes too, not just wall lengths or reflected coordinates.
  if((programme&2)&&area>=52&&(kitchen[4]===0||kitchen[6]===D))swap(living,kitchen);
  const third=rows.find(r=>r[0]==="bed3");
  if((programme&4)&&third&&area>=65){third[0]="study";third[1]="alpha";third[2]="서재·홈오피스";}
  const shared = (a: R, b: R) => {
    const aa = a.slice(3,7) as number[], bb = b.slice(3,7) as number[];
    for (const axis of ["x", "z"] as const) {
      const j = axis === "x" ? 0 : 1, k = axis === "x" ? 1 : 0;
      const at = Math.abs(aa[j + 2] - bb[j]) < .001 ? bb[j] : Math.abs(bb[j + 2] - aa[j]) < .001 ? aa[j] : null;
      const lo = Math.max(aa[k], bb[k]), hi = Math.min(aa[k + 2], bb[k + 2]);
      if (at !== null && hi - lo > .78) return {axis, at, lo, hi};
    }
    return null;
  };
  const publicRoom = (r: R) => ["living", "kitchen", "hall", "entrance"].includes(r[1]);
  const connected = new Set(["entry"]), edges = new Set<string>();
  const join = (a: R, b: R) => {
    const wall = shared(a, b); if (!wall) return false;
    const {axis, at, lo, hi} = wall, closedKitchen = (family===2||family===7||!!(programme&8))&&(a[1]==="kitchen"||b[1]==="kitchen");
    const closedLiving=!!(programme&32)&&(a[1]==="living"||b[1]==="living");
    const isOpen = publicRoom(a) && publicRoom(b) && a[1] !== "entrance" && b[1] !== "entrance" && !closedKitchen && !closedLiving;
    const isGlass = a[1] === "utility" || b[1] === "utility" || (publicRoom(a) && publicRoom(b));
    const living = a[1]==="living"||b[1]==="living";
    const width = Math.min(isOpen ? living?1.7:2.2 : isGlass ? 1.1 : .9, hi - lo - .2);
    // Offset living-room circulation: retain a usable wall run for the sofa/TV pair.
    const privateRoom=[a,b].find(r=>["master","bedroom","alpha"].includes(r[1]));
    const high=privateRoom&&(axis==="z"?privateRoom[5]===W:privateRoom[6]===D);
    const center=privateRoom?(high?hi-.15-width/2:lo+.15+width/2):living&&hi-lo>2.5?lo+.16+width/2:lo+width/2+.1+(hi-lo-width-.2)*(.25+rnd()*.5);
    openings.push({type:isOpen ? "open" : isGlass ? (programme&16)?"sliding_door":"glass_door" : "door",a:a[0],b:b[0],axis,at,center,width,height:isOpen?2.3:2.1,sill:0,hinge:rnd()<.5?"start":"end",swingInto:publicRoom(a)?b[0]:a[0]});
    edges.add([a[0],b[0]].sort().join("|")); return true;
  };
  // Public circulation first, then private rooms. Bathrooms/dressrooms can open off the master.
  for (let step = 0; step < rows.length * 2; step++) {
    let changed = false;
    for (const room of [...rows].sort((a,b)=>Number(publicRoom(b))-Number(publicRoom(a)))) {
      if (connected.has(room[0])) continue;
      const parents = rows.filter(r => connected.has(r[0]) && shared(room,r)).sort((a,b) => {
        const score = (r:R) => (publicRoom(r)?20:0)+(r[1]==="hall"?10:0)+(room[1]==="ensuite"&&r[1]==="master"?40:0)+(r[1]==="bathroom"||r[1]==="ensuite"?-60:0);
        return score(b)-score(a);
      });
      if (parents[0] && join(room,parents[0])) {connected.add(room[0]);changed=true;}
    }
    if (!changed) break;
  }
  if (connected.size !== rows.length) throw Error(`Disconnected layout ${index}`);
  for (const a of rows.filter(publicRoom)) for (const b of rows.filter(publicRoom)) if (a[0]<b[0] && !edges.has([a[0],b[0]].sort().join("|"))) join(a,b);
  const entry = rows.find(r=>r[0]==="entry")!;
  if (family===2) openings.push({type:"front_door",a:"entry",b:"out",axis:"x",at:W,center:(entry[4]+entry[6])/2,width:.95,height:2.1,sill:0,hinge:"end",swingInto:"out"});
  else openings.push({type:"front_door",a:"entry",b:"out",axis:"z",at:0,center:(entry[3]+entry[5])/2,width:.95,height:2.1,sill:0,hinge:"start",swingInto:"out"});
  // Exposed edge intervals only: subtract every neighbouring rectangle before adding glazing.
  for (const r of rows.filter(r=>!["hall","entrance","dressroom","bathroom","ensuite"].includes(r[1]))) {
    for (const [axis,at,lo,hi] of [["z",r[4],r[3],r[5]],["z",r[6],r[3],r[5]],["x",r[3],r[4],r[6]],["x",r[5],r[4],r[6]]] as [Opening["axis"],number,number,number][]) {
      if(r[1]==="living"&&axis==="x")continue;
      let free:[number,number][]=[[lo,hi]];
      for (const n of rows) {
        if (n===r) continue;
        const nr=n.slice(3,7) as number[],j=axis==="x"?0:1,k=axis==="x"?1:0;
        if (at>nr[j]-.001&&at<nr[j+2]+.001) free=free.flatMap(([a,b])=>nr[k]>=b-.001||nr[k+2]<=a+.001?[[a,b]]:[[a,Math.min(b,nr[k])],[Math.max(a,nr[k+2]),b]].filter(([c,d])=>d-c>.01) as [number,number][]);
      }
      for (const [a,b] of free) if (b-a>1.3) {
        const front=r[1]==="living"&&axis==="z"&&at===r[6];
        openings.push({type:front?"balcony_window":"window",a:r[0],b:"out",axis,at,center:(a+b)/2,width:(b-a)*(.62+rnd()*.18),height:front?2.15:1.4,sill:front?.1:.65});
      }
    }
  }
  const ref=rows.filter(r=>r[1]!=="utility"&&r[1]!=="balcony").reduce((s,r)=>s+(r[5]-r[3])*(r[6]-r[4]),0);
  return {name:`case-${caseNumber(index)}`,label:`${LAYOUT_FAMILIES[family]} · CASE ${String(caseNumber(index)+1).padStart(3,"0")}`,rooms:rows,openings,ref};
}
