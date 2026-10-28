import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Original, architectural PBR surfaces. No building photographs or changes to surveyed footprints. */
export function enhanceApartmentMaterial(material: THREE.MeshStandardMaterial) {
  const size = 2048, bays = 8, floors = 8, bw = size / bays, fh = size / floors;
  const canvas = () => { const c = document.createElement("canvas"); c.width = c.height = size; return c; };
  const diffuse = canvas(), surface = canvas(), height = canvas(), glow = canvas();
  const d = diffuse.getContext("2d")!, s = surface.getContext("2d")!, h = height.getContext("2d")!, e = glow.getContext("2d")!;
  d.fillStyle = "#aaa79e"; d.fillRect(0, 0, size, size);
  // R=occlusion, G=roughness, B=metalness, A=paint mask (glass must keep its own colour).
  s.fillStyle = "rgba(245,218,0,1)"; s.fillRect(0, 0, size, size);
  h.fillStyle = "#808080"; h.fillRect(0, 0, size, size);
  e.fillStyle = "#000"; e.fillRect(0, 0, size, size);
  let seed = 6253; const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
  const image = d.getImageData(0, 0, size, size);
  for (let i = 0; i < image.data.length; i += 4) { const grain = (random() - 0.5) * 9; image.data[i] += grain; image.data[i + 1] += grain; image.data[i + 2] += grain; }
  d.putImageData(image, 0, 0);
  for (let row = 0; row < floors; row++) for (let col = 0; col < bays; col++) {
    const x = col * bw, y = row * fh, wx = x + bw * 0.16, wy = y + fh * 0.19, ww = bw * 0.67, wh = fh * 0.58;
    // Painted piers, floor/slab joints and modest weathering under the sills.
    d.fillStyle = col === 0 || col === 7 ? "#8c969a" : "#b9b5ac"; d.fillRect(x, y, bw * 0.075, fh);
    d.fillStyle = "#96958e"; d.fillRect(x, y + fh - 5, bw, 4);
    d.fillStyle = "#dedbd1"; d.fillRect(x, y + fh - 1, bw, 2);
    h.fillStyle = "#626262"; h.fillRect(x, y + fh - 5, bw, 4);
    const stain = d.createLinearGradient(0, wy + wh, 0, y + fh);
    stain.addColorStop(0, "#3c39352c"); stain.addColorStop(1, "#3c393500"); d.fillStyle = stain; d.fillRect(wx, wy + wh, ww, fh * 0.2);
    // Recessed, double-glazed balcony windows, aluminium frames, alternating curtains and interiors.
    d.fillStyle = "#474c4f"; d.fillRect(wx - 5, wy - 5, ww + 10, wh + 12);
    h.fillStyle = "#b8b8b8"; h.fillRect(wx - 5, wy - 5, ww + 10, wh + 10);
    const window = d.createLinearGradient(wx, wy, wx + ww, wy + wh);
    const curtained = random() > 0.52;
    window.addColorStop(0, curtained ? "#9baeb5" : "#4f7181"); window.addColorStop(0.45, curtained ? "#a9b3ae" : "#6f91a0"); window.addColorStop(1, curtained ? "#7e8e92" : "#344f60");
    d.fillStyle = window; d.fillRect(wx, wy, ww, wh);
    if (curtained) for (let k = 0; k < 14; k++) { d.fillStyle = k % 2 ? "#e7dfc72a" : "#2730391c"; d.fillRect(wx + k * ww / 14, wy, ww / 14, wh); }
    // Glass highlights come from the live environment, not diagonal stripes baked into a picture.
    // Alpha is zero only in the shader's surface texture; the opaque facade itself stays opaque.
    s.clearRect(wx, wy, ww, wh); s.fillStyle = "rgba(190,40,160,0.01)"; s.fillRect(wx, wy, ww, wh);
    h.fillStyle = "#555555"; h.fillRect(wx, wy, ww, wh);
    for (const u of [0, 0.33, 0.67, 1]) {
      d.fillStyle = "#c8ced0"; d.fillRect(wx + u * ww - 2, wy, 4, wh);
      h.fillStyle = "#a5a5a5"; h.fillRect(wx + u * ww - 2, wy, 4, wh);
    }
    d.fillStyle = "#afb7b8"; d.fillRect(wx, wy + wh * 0.72, ww, 4);
    d.fillStyle = "#e2ded3"; d.fillRect(wx - 7, wy + wh, ww + 14, 6);
    h.fillStyle = "#bcbcbc"; h.fillRect(wx - 7, wy + wh, ww + 14, 6);
    if (random() > 0.76) { e.fillStyle = random() > 0.5 ? "#ffe3b0" : "#d7e5ed"; e.fillRect(wx + 4, wy + 4, ww - 8, wh - 8); }
  }
  const heights = h.getImageData(0, 0, size, size).data, normals = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const dx = (heights[(y * size + (x + size - 1) % size) * 4] - heights[(y * size + (x + 1) % size) * 4]) / 110;
    const dy = (heights[(((y + size - 1) % size) * size + x) * 4] - heights[(((y + 1) % size) * size + x) * 4]) / 110;
    const n = Math.hypot(dx, dy, 1); normals[i] = (dx / n * 0.5 + 0.5) * 255; normals[i + 1] = (dy / n * 0.5 + 0.5) * 255; normals[i + 2] = (1 / n * 0.5 + 0.5) * 255; normals[i + 3] = 255;
  }
  const textures: THREE.Texture[] = [];
  const configure = (t: THREE.Texture, srgb = false) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 25.6, 1 / 23.2); t.offset.y = -0.5 / 23.2;
    t.anisotropy = 16; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true; textures.push(t); return t;
  };
  material.map = configure(new THREE.CanvasTexture(diffuse), true);
  const normal = new THREE.DataTexture(normals, size, size); normal.flipY = true;
  material.normalMap = configure(normal); material.normalScale.set(0.8, 0.8);
  material.roughnessMap = material.metalnessMap = material.aoMap = configure(new THREE.CanvasTexture(surface));
  material.aoMapIntensity = 0.6; material.roughness = 1; material.metalness = 0.65;
  material.emissiveMap = configure(new THREE.CanvasTexture(glow), true);
  material.envMapIntensity = 0.85;
  material.onBeforeCompile = shader => {
    shader.uniforms.walkFacadeSurface = { value: material.roughnessMap };
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 walkFacadePosition;")
      .replace("#include <project_vertex>", "walkFacadePosition = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#include <project_vertex>");
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 walkFacadePosition;\nuniform sampler2D walkFacadeSurface;")
      .replace("#include <map_fragment>", `#include <map_fragment>
        float paintMask = texture2D(walkFacadeSurface, vMapUv).a;
        vec2 district = floor(walkFacadePosition.xz / 29.0);
        float choice = fract(sin(dot(district, vec2(127.1, 311.7))) * 43758.5453);
        vec3 finish = choice < 0.33 ? vec3(0.66, 0.60, 0.49) : choice < 0.66 ? vec3(0.52, 0.63, 0.70) : vec3(0.75, 0.68, 0.54);
        diffuseColor.rgb *= mix(vec3(1.0), finish, paintMask);
      `);
  };
  material.customProgramCacheKey = () => "walk-apartment-pbr-2k-v1";
  material.userData.walkSurfaceQuality = "original-pbr-2048";
  material.needsUpdate = true;
  return { dispose() { textures.forEach(t => t.dispose()); } };
}

interface Block { id: string; points: [number, number][]; height: number; floors: number; ground: number; x: number; y: number }
/** Survey-aligned stone plinths, corner piers and parapets; two draws, capped at 32 nearby blocks. */
export class ApartmentDetails {
  readonly group = new THREE.Group();
  /** the window frame geometry (matching enhanceApartmentMaterial's atlas) */
  windowFrames = false;
  private blocks = new Map<string, Block>();
  private geo = new THREE.BoxGeometry(1, 1, 1);
  private textures: THREE.Texture[] = [];
  private stone: THREE.MeshStandardMaterial;
  private trim = new THREE.MeshStandardMaterial({ color: "#aeb3af", roughness: 0.78, metalness: 0.04 });
  private bases: THREE.InstancedMesh;
  private piers: THREE.InstancedMesh;
  private windows: THREE.InstancedMesh;
  private windowGeo: THREE.BufferGeometry;
  private windowMaterial = new THREE.MeshStandardMaterial({ color: "#aebbbd", roughness: 0.38, metalness: 0.6 });
  private frustum = new THREE.Frustum(); private projection = new THREE.Matrix4(); private check = new THREE.Sphere(new THREE.Vector3(), 2);
  private matrix = new THREE.Matrix4(); private position = new THREE.Vector3(); private quaternion = new THREE.Quaternion(); private scale = new THREE.Vector3();
  /** `roofAt`: the roof drawn over any of the points (x y pairs), 0 for none. The register lists
   * blocks the world does not draw (a record it set aside, a tile not yet built): their corner piers
   * and parapet alone stood as a bare 40 m frame — only a block with its body drawn is trimmed,
   * at the height its body is drawn. */
  constructor(private roofAt?: (points: number[]) => number) {
    const load = (kind: string, srgb = false) => {
      const t = new THREE.TextureLoader().load(`/3d/walk/tex/granite_tile_${kind}.webp`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 16; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; this.textures.push(t); return t;
    };
    this.stone = new THREE.MeshStandardMaterial({ map: load("diff", true), normalMap: load("nor"), roughnessMap: load("arm"), color: "#827d73", roughness: 0.85, normalScale: new THREE.Vector2(0.65, 0.65) });
    this.bases = new THREE.InstancedMesh(this.geo, this.stone, 2048); this.piers = new THREE.InstancedMesh(this.geo, this.trim, 2048);
    const bars: THREE.BufferGeometry[] = [];
    for (const yy of [-0.5, 0.5]) bars.push(new THREE.BoxGeometry(1.04, 0.028, 0.065).translate(0, yy, 0));
    for (const xx of [-0.5, -0.17, 0.17, 0.5]) bars.push(new THREE.BoxGeometry(0.02, 1, 0.065).translate(xx, 0, 0));
    bars.push(new THREE.BoxGeometry(1.07, 0.03, 0.2).translate(0, -0.51, 0.065));
    this.windowGeo = mergeGeometries(bars)!; bars.forEach(g => g.dispose());
    this.windows = new THREE.InstancedMesh(this.windowGeo, this.windowMaterial, 4096);
    for (const mesh of [this.bases, this.piers, this.windows]) { mesh.count = 0; mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); }
    this.group.add(this.bases, this.piers, this.windows);
  }
  /** the plinth's and trim's materials (the walk cuts its entrances' openings through them) */
  materials(): THREE.Material[] { return [this.stone, this.trim]; }
  add(id: string, points: [number, number][], height: number, ground: number, floors = Math.round(height / 2.9)) {
    if (this.blocks.has(id) || !points.length || !Number.isFinite(ground)) return;
    this.blocks.set(id, { id, points, height, floors, ground, x: points.reduce((s, p) => s + p[0], 0) / points.length, y: points.reduce((s, p) => s + p[1], 0) / points.length });
  }
  update(x: number, y: number, camera?: THREE.Camera) {
    const nearest: Block[] = [];
    for (const b0 of [...this.blocks.values()].filter(b => Math.hypot(b.x - x, b.y - y) < 170).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))) {
      if (nearest.length >= 32) break;
      if (!this.roofAt) { nearest.push(b0); continue; }
      // (its centre and a point 1.5 m in from each corner: an L or a bent slab's centre is outside it)
      const probe = [b0.x, b0.y];
      for (const [px, py] of b0.points) { const dx = b0.x - px, dy = b0.y - py, l = Math.hypot(dx, dy) || 1; probe.push(px + dx / l * 1.5, py + dy / l * 1.5); }
      const top = this.roofAt(probe);
      if (top > b0.ground + 2.5) nearest.push({ ...b0, height: top - b0.ground });
    }
    let base = 0, trim = 0, windows = 0;
    if (camera) this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const put = (mesh: THREE.InstancedMesh, index: number, px: number, py: number, z: number, w: number, h: number, depth: number, angle: number) => {
      this.position.set(px, z, -py); this.scale.set(w, h, depth); this.quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, angle);
      mesh.setMatrixAt(index, this.matrix.compose(this.position, this.quaternion, this.scale));
    };
    for (const b of nearest) for (let i = 0; i < b.points.length - 1; i++) {
      const [ax, ay] = b.points[i], [bx, by] = b.points[i + 1], dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy);
      if (length < 0.1 || base >= 2048 || trim + 2 > 2048) continue;
      const angle = Math.atan2(dy, dx), mx = (ax + bx) * 0.5, my = (ay + by) * 0.5;
      put(this.bases, base++, mx, my, b.ground + 0.55, length, 1.1, 0.17, angle);
      put(this.piers, trim++, mx, my, b.ground + b.height - 0.12, length + 0.1, 0.24, 0.21, angle);
      put(this.piers, trim++, ax, ay, b.ground + b.height * 0.5, 0.26, b.height, 0.26, angle);
      // Real geometry at the same metre-based positions as the PBR atlas, not extra flat window pictures.
      // (off with the walk's facade shader: its windows are drawn on their own grid — facades.ts)
      if (!this.windowFrames || length < 3 || Math.hypot(mx - x, my - y) > 95 || windows >= 4096) continue;
      let nx = dy / length, ny = -dx / length;
      if ((mx - b.x) * nx + (my - b.y) * ny < 0) { nx = -nx; ny = -ny; }
      if ((x - mx) * nx + (y - my) * ny < -2) continue;
      const alongX = Math.abs(dy) < Math.abs(dx), a = alongX ? ax : ay, delta = alongX ? dx : dy;
      if (Math.abs(delta) < 1) continue;
      const lo = Math.min(a, a + delta), hi = Math.max(a, a + delta), kv = Math.min(2, Math.max(0.5, 2.9 / (b.height / b.floors)));
      const windowWidth = 2.144 * length / Math.abs(delta), windowHeight = 1.682 / kv;
      for (let bay = Math.floor(lo / 3.2); bay <= Math.ceil(hi / 3.2); bay++) {
        const u = bay * 3.2 + 1.584, t = (u - a) / delta;
        if (u - 1.072 < lo + 0.2 || u + 1.072 > hi - 0.2) continue;
        const px = ax + dx * t + nx * 0.045, py = ay + dy * t + ny * 0.045;
        for (let floor = 0; floor < b.floors && windows < 4096; floor++) {
          const z = b.ground + 1 + (2.9 * (floor + 0.48) - 0.5) / kv;
          if (z + windowHeight * 0.5 > b.ground + b.height - 0.3) continue;
          this.check.center.set(px, z, -py);
          if (camera && !this.frustum.intersectsSphere(this.check)) continue;
          put(this.windows, windows++, px, py, z, windowWidth, windowHeight, 1, Math.atan2(nx, -ny));
        }
      }
    }
    this.bases.count = base; this.piers.count = trim; this.windows.count = windows;
    this.bases.instanceMatrix.needsUpdate = this.piers.instanceMatrix.needsUpdate = this.windows.instanceMatrix.needsUpdate = true;
  }
  dispose() { this.group.removeFromParent(); this.blocks.clear(); this.bases.dispose(); this.piers.dispose(); this.windows.dispose(); this.geo.dispose(); this.windowGeo.dispose(); this.windowMaterial.dispose(); this.stone.dispose(); this.trim.dispose(); this.textures.forEach(t => t.dispose()); }
}
