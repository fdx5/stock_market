import type { Matrix4 } from 'three';

/** Post-multiply a body frame by translation and an X rotation. All joints use
 * this same sparse transform; avoid two general 4x4 products per joint. */
export function walkerJoint(out: Matrix4, from: Matrix4, x: number, y: number, z: number, angle: number) {
  const a = from.elements, b = out.elements, c = Math.cos(angle), s = Math.sin(angle);
  // Read before writing: elbows reuse their parent's scratch matrix.
  const a0=a[0], a1=a[1], a2=a[2], a3=a[3];
  const a4=a[4], a5=a[5], a6=a[6], a7=a[7];
  const a8=a[8], a9=a[9], a10=a[10], a11=a[11];
  const a12=a[12], a13=a[13], a14=a[14], a15=a[15];
  b[0]=a0; b[1]=a1; b[2]=a2; b[3]=a3;
  b[4]=a4*c+a8*s+0; b[5]=a5*c+a9*s+0; b[6]=a6*c+a10*s+0; b[7]=a7*c+a11*s+0;
  b[8]=a4*-s+a8*c+0; b[9]=a5*-s+a9*c+0; b[10]=a6*-s+a10*c+0; b[11]=a7*-s+a11*c+0;
  b[12]=a0*x+a4*y+a8*z+a12; b[13]=a1*x+a5*y+a9*z+a13;
  b[14]=a2*x+a6*y+a10*z+a14; b[15]=a3*x+a7*y+a11*z+a15;
  return out;
}
