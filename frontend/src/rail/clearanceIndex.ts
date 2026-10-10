import type { Clearance } from './railClearance';
type Box = { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
/** Conservative XZ bins, followed by the same bounds used by the subtraction worker. */
export class ClearanceIndex {
  private bins = new Map<string, number[]>();
  private boxes: number[][];
  constructor(private rows: Clearance[], private cell = 80) {
    this.boxes = rows.map(c => [Math.min(c.a[0],c.b[0])-c.half-.3,Math.min(c.a[1],c.b[1])+c.bottom-.3,Math.min(c.a[2],c.b[2])-c.half-.3,Math.max(c.a[0],c.b[0])+c.half+.3,Math.max(c.a[1],c.b[1])+c.top+.3,Math.max(c.a[2],c.b[2])+c.half+.3]);
    this.boxes.forEach((b,i) => {
      for(let x=Math.floor(b[0]/cell);x<=Math.floor(b[3]/cell);x++)for(let z=Math.floor(b[2]/cell);z<=Math.floor(b[5]/cell);z++){
        const k=x+','+z, bucket=this.bins.get(k)??[];bucket.push(i);this.bins.set(k,bucket);
      }
    });
  }
  query(box: Box) {
    const found = new Set<number>(), {min:a,max:b}=box;
    for(let x=Math.floor(a.x/this.cell);x<=Math.floor(b.x/this.cell);x++)for(let z=Math.floor(a.z/this.cell);z<=Math.floor(b.z/this.cell);z++)for(const i of this.bins.get(x+','+z)??[])found.add(i);
    return [...found].filter(i => {const c=this.boxes[i];return a.x<=c[3]&&b.x>=c[0]&&a.y<=c[4]&&b.y>=c[1]&&a.z<=c[5]&&b.z>=c[2];}).map(i=>this.rows[i]);
  }
}
