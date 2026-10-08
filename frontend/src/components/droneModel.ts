import * as THREE from "three";

/* The drone itself, for the third-person view (드론 mode): a camera quadcopter of the usual
 * shape (a DJI-type airframe, ~0.6 m across the motors) — a rounded body, four arms, motors,
 * two-blade propellers turning with the throttle, landing legs, a gimbal camera under the nose,
 * navigation lights (red and green at the front arms, white flashing behind). Pitched and banked
 * as the flight is (droneFlight). Built from simple solids; four materials for all of it. */

export class DroneModel {
  readonly group = new THREE.Group();
  private props: THREE.Object3D[] = [];
  private flash: THREE.Mesh;
  private spin = 0;
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];

  constructor() {
    const shell = this.mat(new THREE.MeshStandardMaterial({ color: "#d9dcdf", roughness: 0.38, metalness: 0.1 }));
    const dark = this.mat(new THREE.MeshStandardMaterial({ color: "#26292d", roughness: 0.55, metalness: 0.3 }));
    const blade = this.mat(new THREE.MeshStandardMaterial({ color: "#1c1e21", roughness: 0.6, metalness: 0.1, transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
    const lamp = this.mat(new THREE.MeshStandardMaterial({ color: "#000000", emissive: "#ffffff", emissiveIntensity: 2.2, vertexColors: true }));
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = this.group) => {
      this.geos.push(g);
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    // body: a rounded shell, the battery on top, a darker belly
    const body = new THREE.SphereGeometry(0.13, 20, 12); body.scale(1, 0.55, 1.55);
    add(body, shell, 0, 0, 0);
    add(new THREE.BoxGeometry(0.13, 0.05, 0.22), dark, 0, 0.065, 0.02);
    const belly = new THREE.SphereGeometry(0.11, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2); belly.scale(1, 0.5, 1.4);
    add(belly, dark, 0, -0.02, 0);
    // arms and motors (front arms forward-out, rear arms back-out: an X)
    const arms: [number, number][] = [[0.24, -0.2], [-0.24, -0.2], [0.24, 0.2], [-0.24, 0.2]];
    for (const [x, z] of arms) {
      const len = Math.hypot(x, z) - 0.06;
      const arm = new THREE.BoxGeometry(0.032, 0.028, len);
      const m = add(arm, shell, x / 2, 0.005, z / 2);
      m.rotation.y = Math.atan2(x, z);
      add(new THREE.CylinderGeometry(0.026, 0.03, 0.045, 14), dark, x, 0.03, z);
      // a two-blade propeller, turning about its hub
      const hub = new THREE.Group();
      hub.position.set(x, 0.058, z);
      this.group.add(hub);
      for (const s of [1, -1]) {
        const b = new THREE.BoxGeometry(0.2, 0.004, 0.026);
        b.translate(0.1 * s, 0, 0);
        add(b, blade, 0, 0, 0, hub);
      }
      add(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 10), dark, 0, 0, 0, hub);
      this.props.push(hub);
      // landing legs under the front arms' motors
      if (z < 0) add(new THREE.CylinderGeometry(0.008, 0.008, 0.09, 6), dark, x * 0.8, -0.06, z * 0.8);
    }
    // gimbal and camera under the nose, looking forward
    add(new THREE.SphereGeometry(0.03, 12, 8), dark, 0, -0.06, -0.17);
    add(new THREE.BoxGeometry(0.06, 0.045, 0.05), dark, 0, -0.085, -0.18);
    const lens = add(new THREE.CylinderGeometry(0.016, 0.016, 0.012, 14), this.mat(new THREE.MeshStandardMaterial({ color: "#0a0d14", roughness: 0.1, metalness: 0.8 })), 0, -0.085, -0.208);
    lens.rotation.x = Math.PI / 2;
    // navigation lights: red front-left, green front-right, a white strobe behind
    const light = (col: string, x: number, z: number) => {
      const g = new THREE.SphereGeometry(0.011, 8, 6);
      const c = new THREE.Color(col), n = g.getAttribute("position").count, arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
      g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
      return add(g, lamp, x, -0.012, z);
    };
    light("#ff2a2a", -0.24, -0.2); light("#2aff5a", 0.24, -0.2);
    this.flash = light("#ffffff", 0, 0.205);
    // (forward is −z, as the camera looks; the model a little larger than life: it is seen from behind)
    this.group.scale.setScalar(1.35);
    this.group.name = "drone";
    this.group.visible = false;
  }

  private mat<T extends THREE.Material>(m: T) { this.mats.push(m); return m; }

  /** Place it: position, heading (yaw, radians), body pitch and roll; props spin with `load`. */
  update(dt: number, pos: THREE.Vector3, yaw: number, pitch: number, roll: number, load: number, t: number) {
    this.group.position.copy(pos);
    this.group.rotation.set(-pitch, yaw, -roll, "YXZ");
    this.spin += dt * (60 + 90 * load);
    this.props.forEach((p, i) => { p.rotation.y = (i === 0 || i === 3 ? 1 : -1) * this.spin; });
    this.flash.visible = (t % 1.2) < 0.08;
  }

  materials() { return this.mats; }

  dispose() {
    this.group.removeFromParent();
    this.geos.forEach(g => g.dispose());
    this.mats.forEach(m => m.dispose());
  }
}
