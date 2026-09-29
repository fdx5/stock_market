import type { Scene, PerspectiveCamera } from 'three';
import type { Look } from '../complexScene';
export interface Quality { name: 'high' | 'medium' | 'low'; shadow: number; pcss: number; ssr: boolean; clouds: boolean }
export const QUALITY: Record<'high' | 'medium' | 'low', Quality>;
/** The shared WebGPU device, made ahead of the first view. */
export function warmDevice(): Promise<void>;
export class ComplexRenderer {
  static create(host: HTMLElement, quality?: Quality): Promise<ComplexRenderer>;
  canvas: HTMLCanvasElement;
  ready: boolean;
  shown: boolean;
  failed: boolean;
  /** Canvases emptied after upload (a fall back to WebGL must repaint them). */
  released?: number;
  quality: Quality;
  stats: { draws: number; triangles: number; pipelines: number };
  /** Smoothed GPU ms per pass and their sum (total); empty without timestamp queries. */
  timer: { enabled: boolean; ms: Record<string, number>; samples: number };
  render(scene: Scene, camera: PerspectiveCamera, look: Look, time: number): void;
  setSize(width: number, height: number, ratio: number): void;
  setQuality(quality: Quality): void;
  dispose(): void;
}
