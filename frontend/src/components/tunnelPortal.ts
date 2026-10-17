/** A tunnel's mouth where a road or a track leaves the surface: the portal's concrete face round an
 * arched opening, and the bore a short way in (its lining dark, an end wall closing it) — only the
 * entrance; the rest of the tunnel is not drawn (the hill, or the ground, is over it). With a
 * grade the bore goes down with its track (a subway's portal on flat ground: its roof sinks in).
 * Flat triangles, z up: [x, y, z] in the caller's local metres. */
export type PortalShape = { concrete: number[]; dark: number[] };

export function tunnelPortal(px: number, py: number, z0: number, dx: number, dy: number,
  o: { halfWidth: number; height: number; length: number; floor: number; grade?: number }, out: PortalShape = { concrete: [], dark: [] }): PortalShape {
  const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
  const ux = dy, uy = -dx; // (to the right, facing in)
  const hw = o.halfWidth, H = o.height, L = o.length, base = -1.6, F = .9, shell = .6, side = 1.6, head = 1.5;
  // (at u across, s in from the face, z up from the road)
  const g = o.grade ?? 0;
  const P = (u: number, s: number, z: number) => [px + ux * u + dx * s, py + uy * u + dy * s, z0 + z - g * Math.max(0, s)];
  const tri = (to: number[], a: number[], b: number[], c: number[]) => to.push(...a, ...b, ...c);
  const quad = (to: number[], a: number[], b: number[], c: number[], d: number[]) => { tri(to, a, b, c); tri(to, a, c, d); };
  // The opening: walls to the springing, then a half-ellipse arch to the crown.
  const spring = Math.max(H * .45, H - hw), rise = H - spring, N = 12;
  const profile = (grow: number): [number, number][] => {
    const p: [number, number][] = [[-hw - grow, base], [-hw - grow, spring]];
    for (let k = 1; k < N; k++) { const a = Math.PI - (Math.PI * k) / N; p.push([Math.cos(a) * (hw + grow), spring + Math.sin(a) * (rise + grow)]); }
    p.push([hw + grow, spring], [hw + grow, base]);
    return p;
  };
  const inner = profile(0), outer = profile(shell);
  // the bore's lining (dark) from the face's front to the end wall, and the shell over it (concrete)
  for (let k = 1; k < inner.length; k++) {
    const [a, b] = [inner[k - 1], inner[k]], [c, d] = [outer[k - 1], outer[k]];
    quad(out.dark, P(a[0], -F, a[1]), P(b[0], -F, b[1]), P(b[0], L, b[1]), P(a[0], L, a[1]));
    quad(out.concrete, P(c[0], 0, c[1]), P(c[0], L, c[1]), P(d[0], L, d[1]), P(d[0], 0, d[1]));
    // (the shell's end: the ring between lining and shell)
    quad(out.concrete, P(a[0], L, a[1]), P(b[0], L, b[1]), P(d[0], L, d[1]), P(c[0], L, c[1]));
  }
  // the end wall: dark, closing the bore
  for (let k = 1; k < inner.length; k++) tri(out.dark, P(0, L, base), P(inner[k - 1][0], L, inner[k - 1][1]), P(inner[k][0], L, inner[k][1]));
  // the floor inside (the road or the track bed runs on over it)
  quad(out.dark, P(-hw, -F, o.floor), P(hw, -F, o.floor), P(hw, L, o.floor), P(-hw, L, o.floor));
  // The face: a slab F deep, `side` past the opening each side and `head` over the crown.
  const W = hw + side, top = H + head;
  for (const s of [-F, 0]) {
    // the two piers beside the opening, the header over the crown, and between them the arch's
    // spandrels: each half of the arch fanned to its top corner
    quad(out.concrete, P(-W, s, base), P(-hw, s, base), P(-hw, s, top), P(-W, s, top));
    quad(out.concrete, P(hw, s, base), P(W, s, base), P(W, s, top), P(hw, s, top));
    quad(out.concrete, P(-hw, s, H), P(hw, s, H), P(hw, s, top), P(-hw, s, top));
    for (let k = 2; k < inner.length - 1; k++) {
      const a = inner[k - 1], b = inner[k], corner = (a[0] + b[0]) / 2 < 0 ? -hw : hw;
      tri(out.concrete, P(corner, s, H), P(a[0], s, a[1]), P(b[0], s, b[1]));
    }
  }
  // the slab's edges: top, the two outer sides
  quad(out.concrete, P(-W, -F, top), P(W, -F, top), P(W, 0, top), P(-W, 0, top));
  for (const u of [-W, W]) quad(out.concrete, P(u, -F, base), P(u, 0, base), P(u, 0, top), P(u, -F, top));
  // a coping along the top, a little proud of the face
  quad(out.concrete, P(-W - .2, -F - .25, top), P(W + .2, -F - .25, top), P(W + .2, -F - .25, top + .35), P(-W - .2, -F - .25, top + .35));
  quad(out.concrete, P(-W - .2, -F - .25, top + .35), P(W + .2, -F - .25, top + .35), P(W + .2, 0, top + .35), P(-W - .2, 0, top + .35));
  return out;
}

/** Flat normals for the triangles of a portal (as the winding gives them). */
export function portalNormals(p: ArrayLike<number>): Float32Array {
  const n = new Float32Array(p.length);
  for (let i = 0; i + 8 < p.length; i += 9) {
    const ax = p[i + 3] - p[i], ay = p[i + 4] - p[i + 1], az = p[i + 5] - p[i + 2], bx = p[i + 6] - p[i], by = p[i + 7] - p[i + 1], bz = p[i + 8] - p[i + 2];
    let x = ay * bz - az * by, y = az * bx - ax * bz, z = ax * by - ay * bx; const s = Math.hypot(x, y, z) || 1; x /= s; y /= s; z /= s;
    for (let k = 0; k < 9; k += 3) { n[i + k] = x; n[i + k + 1] = y; n[i + k + 2] = z; }
  }
  return n;
}
