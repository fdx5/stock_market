export interface NanotubeSpec {
  form: "braid" | "ribbon" | "neural" | "vertebra";
  radius: number;
  offset: number;
  lean: number;
  depth: number;
  phase: number;
  tempo: number;
  sway: number;
  twist: number;
  columns: number;
  rows: number;
  wire: number;
  colors: readonly [string, string];
}

export const NANOTUBES: readonly NanotubeSpec[] = [
  { form: "braid", radius: 43, offset: -.34, lean: -.075, depth: -48, phase: .3, tempo: .66, sway: 49, twist: 1, columns: 16, rows: 112, wire: 1.25, colors: ["#69d9a6", "#dcfff0"] },
  { form: "ribbon", radius: 22, offset: -.115, lean: .07, depth: 36, phase: 5.9, tempo: .96, sway: 43, twist: 1, columns: 12, rows: 168, wire: 1.0, colors: ["#dfb166", "#dc8798"] },
  { form: "neural", radius: 35, offset: .115, lean: -.105, depth: -72, phase: 2.9, tempo: .73, sway: 57, twist: -1, columns: 14, rows: 132, wire: 1.2, colors: ["#d093c4", "#778cdb"] },
  { form: "vertebra", radius: 14, offset: .34, lean: .035, depth: 76, phase: 6.7, tempo: 1.2, sway: 33, twist: 1, columns: 10, rows: 196, wire: .92, colors: ["#7bd2e3", "#e6f7ff"] },
];

export const fiberCount = (spec: NanotubeSpec) => Math.round(Math.max(6, Math.round(spec.radius * .55)) / 2);
export const surfaceCount = (spec: NanotubeSpec) => spec.form === "braid" ? 2 : spec.form === "neural" ? 3 : 1;
export const formId = (spec: NanotubeSpec) => ["braid", "ribbon", "neural", "vertebra"].indexOf(spec.form);

export interface NanotubeBatch {
  vertices: Float32Array;
  indices: Uint16Array;
  haloIndices: Uint16Array;
  hullVertices: Float32Array;
  hullIndices: Uint16Array;
  edges: number;
}
export interface NanotubeGeometry {
  tubes: NanotubeBatch[];
  links: { vertices: Float32Array; indices: Uint16Array };
  edgeCount: number;
}

// One screen-facing quad per bond. UV endpoints follow each structure's parametric skin.
// Layout: edge UVs (4), corner / kind / seed (4), bundle IDs (2), branch IDs or bridge range (2).
function addEdge(vertices: number[], indices: number[], a: readonly number[], b: readonly number[],
  tubeA: number, tubeB: number, kind: number, seed: number, range: readonly number[] = [0, 1]) {
  const start = vertices.length / 12;
  if (start + 3 > 65535) throw new Error("Nanotube batch exceeds 16-bit index range");
  for (const [along, side] of [[0, -1], [0, 1], [1, -1], [1, 1]]) {
    vertices.push(a[0], a[1], b[0], b[1], along, side, kind, seed, tubeA, tubeB, range[0], range[1]);
  }
  indices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2);
}

function tubeGeometry(spec: NanotubeSpec, tubeId: number): NanotubeBatch {
  const vertices: number[] = [], indices: number[] = [], haloIndices: number[] = [];
  const surfaces = surfaceCount(spec), columns = Math.max(6, Math.ceil(spec.columns / surfaces));
  const seen = new Set<string>();
  const key = (u: number, v: number) => {
    const period = columns * 2;
    const x = ((Math.round(u * period) % period) + period) % period;
    return `${x}:${Math.round(v * spec.rows * 6)}`;
  };
  const wire = (a: number[], b: number[], kind: number, seed: number, branch: number, other = branch, glow = false) => {
    const start = indices.length;
    addEdge(vertices, indices, a, b, tubeId, tubeId, kind, seed, [branch, other]);
    if (glow) haloIndices.push(...indices.slice(start));
  };
  for (let branch = 0; branch < surfaces; branch++) {
    if (spec.form === "ribbon") {
      // A diagonal woven sheet, with transverse stitch lines at its folds.
      for (let row = 0; row < spec.rows; row++) for (let column = 0; column < columns; column++) {
        const u = column / columns, v = row / spec.rows, du = 1 / columns, dv = 1 / spec.rows;
        wire([u,v],[u+du,v+dv],0,column/columns,branch);
        wire([u+du,v],[u,v+dv],0,(column+.5)/columns,branch);
        if (row % 4 === 0) wire([u,v],[u+du,v],0,row/spec.rows,branch);
      }
    } else if (spec.form === "vertebra") {
      // Ribbed, articulated lanterns around a winding central spine.
      for (let row = 0; row <= spec.rows; row += 4) for (let ring = 0; ring < columns * 2; ring++) {
        wire([ring/(columns*2),row/spec.rows],[(ring+1)/(columns*2),row/spec.rows],0,row/spec.rows,branch);
      }
    } else {
      // Independent cages keep seams separate while helices and branches cross in space.
      for (let row = 0; row < spec.rows; row++) for (let column = 0; column < columns; column++) {
        const u = (column + (row % 2) * .5) / columns, v = (row + .5) / spec.rows;
        const points = Array.from({ length: 6 }, (_, corner) => {
          const angle = Math.PI / 6 + corner * Math.PI / 3;
          return [u + Math.cos(angle) / (Math.sqrt(3) * columns), v + Math.sin(angle) * 2 / (3 * spec.rows)];
        });
        for (let edge = 0; edge < 6; edge++) {
          const a = points[edge], b = points[(edge + 1) % 6];
          const hash = `${branch}|${[key(a[0],a[1]),key(b[0],b[1])].sort().join("|")}`;
          if (seen.has(hash)) continue;
          seen.add(hash);
          wire(a,b,0,((row*71+column*31+edge*17)%997)/997,branch);
        }
      }
    }
    const rails = spec.form === "vertebra" ? 8 : 4;
    for (let rail = 0; rail < rails; rail++) for (let row = 0; row < spec.rows; row += 2) {
      wire([rail/rails,row/spec.rows],[rail/rails,Math.min(1,(row+2)/spec.rows)],1,rail/rails,branch,branch,true);
    }
    if (spec.form === "neural") for (let row = 6; row < spec.rows; row += 11) {
      wire([.1,row/spec.rows],[.9,(row+2)/spec.rows],4,row/spec.rows,branch,(branch+1)%surfaces);
    }
  }
  // The reduced filament count is preserved and distributed across each structure's branches.
  const fibers = fiberCount(spec);
  for (let fiber = 0; fiber < fibers; fiber++) for (let row = 0; row < spec.rows; row++) {
    const branch = fiber % surfaces, count = Math.ceil((fibers-branch)/surfaces);
    const u = Math.floor(fiber/surfaces)/count;
    wire([u,row/spec.rows],[u,(row+1)/spec.rows],3,((fiber*17+3)%101)/101,branch,branch,fiber%3===0);
  }
  const ringSegments = columns * 2;
  const axialSegments = spec.rows * 3;
  const perSurface = (ringSegments + 1) * (axialSegments + 1);
  if (perSurface * surfaces > 65536) throw new Error("Structure hull exceeds 16-bit index range");
  const hullVertices = new Float32Array(perSurface * surfaces * 3);
  const hullIndices = new Uint16Array(ringSegments * axialSegments * surfaces * 6);
  let vp = 0, ip = 0;
  for (let branch = 0; branch < surfaces; branch++) for (let row = 0; row <= axialSegments; row++) for (let ring = 0; ring <= ringSegments; ring++) {
    hullVertices[vp++] = ring / ringSegments; hullVertices[vp++] = row / axialSegments; hullVertices[vp++] = branch;
    if (row < axialSegments && ring < ringSegments) {
      const a = branch * perSurface + row * (ringSegments + 1) + ring, b = a + ringSegments + 1;
      hullIndices.set([a, b, a + 1, a + 1, b, b + 1], ip); ip += 6;
    }
  }
  return { vertices: new Float32Array(vertices), indices: new Uint16Array(indices), haloIndices: new Uint16Array(haloIndices), hullVertices, hullIndices, edges: vertices.length / 48 };
}

export function buildNanotubeGeometry(): NanotubeGeometry {
  const tubes = NANOTUBES.map(tubeGeometry);
  const vertices: number[] = [], indices: number[] = [];
  // Three quiet connection zones join the tubes into a continuous scaffold.
  for (let pair = 0; pair < NANOTUBES.length - 1; pair++) for (let zone = 0; zone < 3; zone++) {
    const v = .22 + zone * .28 + Math.sin(pair * 1.8 + zone) * .018;
    for (let thread = 0; thread < 5; thread++) {
      const a = [.015 + thread * .009, v + thread * .0018];
      const b = [-.015 - thread * .009, v + .012 + thread * .0018];
      for (let segment = 0; segment < 12; segment++) {
        addEdge(vertices, indices, a, b, pair, pair + 1, 2, (pair * 13 + zone * 7 + thread) / 127, [segment / 12, (segment + 1) / 12]);
      }
    }
  }
  return { tubes, links: { vertices: new Float32Array(vertices), indices: new Uint16Array(indices) }, edgeCount: tubes.reduce((total, tube) => total + tube.edges, 0) + vertices.length / 48 };
}

export function geometryTransfers(geometry: NanotubeGeometry): ArrayBuffer[] {
  return [
    ...geometry.tubes.flatMap(tube => [tube.vertices.buffer, tube.indices.buffer, tube.haloIndices.buffer, tube.hullVertices.buffer, tube.hullIndices.buffer]),
    geometry.links.vertices.buffer, geometry.links.indices.buffer,
  ] as ArrayBuffer[];
}
