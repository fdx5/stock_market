import type { MonitorEdge, MonitorGraph, MonitorNode } from "../adminApi";

/** Where every node sits in space, and what colour it burns.
 *
 * The layout is deterministic rather than force-directed, and that is the whole point:
 * a force simulation would settle somewhere different on every load, so an operator
 * could never learn the shape. Here the same site always produces the same brain, and
 * "the admin lobe" is a place you can point at.
 *
 * Three concentric shells, one per layer of the diagram — pages innermost, endpoints
 * around them, stores and upstream feeds on the outside. Within a shell, nodes cluster
 * by group onto a lobe, so related endpoints sit together and a signal crossing from
 * one lobe to another is visibly a long-distance connection.
 */

export interface PlacedNode extends MonitorNode {
  x: number;
  y: number;
  z: number;
  /** Base radius in world units — pages read as the large cell bodies, depots as the
   * heavy terminals they feed into, endpoints as the dense middle layer. */
  size: number;
  color: number;
}

export interface MonitorLayout {
  nodes: PlacedNode[];
  edges: MonitorEdge[];
  byId: Map<string, PlacedNode>;
  /** Endpoint path -> node id, for matching an API pulse event to its node. */
  byApiPath: Map<string, string>;
  /** Client route -> node id, for matching a visitor's page event to its node. */
  byPagePath: Map<string, string>;
  /** Outgoing edges per node, so a signal arriving somewhere knows where it can go
   * next without re-scanning the edge list every frame. */
  outgoing: Map<string, MonitorEdge[]>;
  warnings: string[];
}

/** Distance from the origin for each layer. The gaps are wide enough that the three
 * shells stay legible as shells when the camera is anywhere outside the graph. */
const SHELL: Record<MonitorNode["kind"], number> = { page: 30, api: 66, depot: 108 };

/** How far a lobe's members spread across the shell's surface. Pages are few and want
 * to stay a tight cluster; endpoints are many and need room not to overlap. */
const SPREAD: Record<MonitorNode["kind"], number> = { page: 13, api: 26, depot: 17 };

const SIZE: Record<MonitorNode["kind"], number> = { page: 2.5, api: 1.35, depot: 2.3 };

/** Group palette. Chosen to stay distinct *after* the bloom pass washes everything
 * toward white — closely-spaced hues that look fine flat become the same glow once
 * they bleed, so these are spaced around the wheel with saturation to spare. */
const GROUP_COLOR: Record<string, number> = {
  entry: 0xffe066,
  stock: 0x4dd2ff,
  map: 0x5b8cff,
  board: 0x00e5c0,
  market: 0x2ee6a8,
  predict: 0xffa63d,
  play: 0xff5ea8,
  news: 0xc98cff,
  core: 0x7de3ff,
  admin: 0xff6b5e,
  monitor: 0xffffff,
  store: 0x9aa7ff,
  upstream: 0xffd07a,
};

const FALLBACK_COLOR = 0x8fa3bf;

export function groupColor(group: string): number {
  return GROUP_COLOR[group] ?? FALLBACK_COLOR;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Evenly-spaced directions on a unit sphere — the classic Fibonacci sphere. Used to
 * give each lobe its own heading so no two clusters sit on top of each other. */
function sphereDirection(index: number, total: number): [number, number, number] {
  const y = total === 1 ? 0 : 1 - (index / (total - 1)) * 2;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = GOLDEN_ANGLE * index;
  return [Math.cos(theta) * radius, y, Math.sin(theta) * radius];
}

/** Any unit vector perpendicular to `d`. Picking the axis `d` leans on least avoids the
 * degenerate cross product that would collapse a lobe into a line. */
function perpendicular(d: [number, number, number]): [number, number, number] {
  const [x, y, z] = d;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  const axis: [number, number, number] = ax < ay && ax < az ? [1, 0, 0] : ay < az ? [0, 1, 0] : [0, 0, 1];
  const cx = y * axis[2] - z * axis[1];
  const cy = z * axis[0] - x * axis[2];
  const cz = x * axis[1] - y * axis[0];
  const len = Math.hypot(cx, cy, cz) || 1;
  return [cx / len, cy / len, cz / len];
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Stable pseudo-random in [0,1) from a string. Deterministic layout needs jitter that
 * is *fixed per node* rather than per render — same node, same wobble, every load. */
function hash01(text: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export function layoutGraph(graph: MonitorGraph): MonitorLayout {
  // Lobes are keyed by group *and* kind: an endpoint in the "stock" group and the page
  // that calls it belong to the same theme but different shells, and they should sit
  // on the same heading so the connection between them is a short radial hop rather
  // than a wire across the whole brain.
  const groups = Array.from(new Set(graph.nodes.map((n) => n.group))).sort();
  const direction = new Map<string, [number, number, number]>();
  groups.forEach((group, i) => direction.set(group, sphereDirection(i, groups.length)));

  const membersSeen = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const node of graph.nodes) {
    const key = `${node.kind}:${node.group}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  // Depots get their own heading each, spread over the whole outer sphere, instead of
  // inheriting their group's lobe. There are only two depot groups (store, upstream), so
  // by-group placement piled all ten terminals into two spots on one side and dragged
  // every dependency edge the same way — the graph came out as a comet with a tail
  // rather than a brain. Ringing them around the outside also happens to be the honest
  // picture: these are the terminals the whole cortex drains into, not a region of it.
  const depotIds = graph.nodes.filter((n) => n.kind === "depot").map((n) => n.id);
  const depotOrder = new Map(depotIds.map((id, i) => [id, i]));

  const nodes: PlacedNode[] = graph.nodes.map((node) => {
    const key = `${node.kind}:${node.group}`;
    const index = membersSeen.get(key) ?? 0;
    membersSeen.set(key, index + 1);
    const total = counts.get(key) ?? 1;

    const dir =
      node.kind === "depot"
        ? sphereDirection(depotOrder.get(node.id) ?? 0, depotIds.length)
        : direction.get(node.group) ?? [0, 1, 0];
    const u = perpendicular(dir);
    const v = cross(dir, u);

    // Golden-angle spiral over the lobe's disc: equal-area, so a lobe with forty
    // endpoints stays as evenly packed as one with three.
    const angle = index * GOLDEN_ANGLE;
    const spread = SPREAD[node.kind];
    // A depot owns its heading outright (above), so it sits on it rather than spiralling
    // out from a shared lobe centre.
    const radius = node.kind === "depot" || total <= 1 ? 0 : spread * Math.sqrt((index + 0.5) / total);

    // Without this the lobe is a flat disc facing the camera from one side, which reads
    // as a diagram. Pushing each node a little along its own heading gives the cluster
    // volume — the thing that makes it look like tissue rather than a chart.
    const depth = (hash01(node.id, 1) - 0.5) * spread * 0.85;
    const shell = SHELL[node.kind] + depth;

    const jitterU = (hash01(node.id, 2) - 0.5) * spread * 0.25;
    const jitterV = (hash01(node.id, 3) - 0.5) * spread * 0.25;

    const ru = radius * Math.cos(angle) + jitterU;
    const rv = radius * Math.sin(angle) + jitterV;

    return {
      ...node,
      x: dir[0] * shell + u[0] * ru + v[0] * rv,
      y: dir[1] * shell + u[1] * ru + v[1] * rv,
      z: dir[2] * shell + u[2] * ru + v[2] * rv,
      size: SIZE[node.kind],
      color: groupColor(node.group),
    };
  });

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const byApiPath = new Map<string, string>();
  const byPagePath = new Map<string, string>();
  for (const node of nodes) {
    if (!node.path) continue;
    if (node.kind === "api") byApiPath.set(node.path, node.id);
    if (node.kind === "page") byPagePath.set(node.path, node.id);
  }

  // Edges naming a node that isn't in the payload would otherwise crash the geometry
  // build with an undefined position; dropped here so a malformed graph degrades to a
  // sparser picture rather than a blank screen.
  const edges = graph.edges.filter((e) => byId.has(e.source) && byId.has(e.target));

  const outgoing = new Map<string, MonitorEdge[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.source);
    if (list) list.push(edge);
    else outgoing.set(edge.source, [edge]);
  }

  return { nodes, edges, byId, byApiPath, byPagePath, outgoing, warnings: graph.warnings };
}
