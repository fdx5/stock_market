import type { Scene, PerspectiveCamera } from 'three';
import type { Look } from '../complexScene';
export class ComplexRenderer {
  static create(host: HTMLElement): Promise<ComplexRenderer>;
  canvas: HTMLCanvasElement;
  ready: boolean;
  shown: boolean;
  failed: boolean;
  stats: { draws: number; triangles: number; pipelines: number };
  render(scene: Scene, camera: PerspectiveCamera, look: Look, time: number): void;
  setSize(width: number, height: number, ratio: number): void;
  dispose(): void;
}
