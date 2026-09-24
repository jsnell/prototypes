import type { MapJSON } from '../model/map';
import type { Season } from './environment';

/** A band of terrain rows to compute off the main thread. */
export interface TerrainJob {
  map: MapJSON;
  hexSize: number;
  season: Season;
  worldW: number;
  worldH: number;
  y0: number;
  y1: number;
}

/** Result arrays cover rows [y0, y1) exactly. */
export interface TerrainJobResult {
  y0: number;
  y1: number;
  hgt: Float32Array;
  surf: Float32Array;
  albedo: Uint32Array;
  emis: Uint32Array;
  flags: Uint8Array;
  hexId: Int32Array;
  owner: Int32Array;
  alt: Int32Array;
  altW: Uint8Array;
}

/**
 * A pool of terrain workers. The host creates the workers (so any bundler can
 * be used): e.g. `new TerrainWorkerPool(() => new Worker(new URL(
 * 'hex-terrain/worker', import.meta.url), { type: 'module' }))`.
 */
export class TerrainWorkerPool {
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly queue: { job: TerrainJob; resolve: (r: TerrainJobResult) => void; reject: (e: unknown) => void }[] = [];
  private readonly pending = new Map<Worker, { resolve: (r: TerrainJobResult) => void; reject: (e: unknown) => void }>();

  constructor(factory: () => Worker, count = 4) {
    for (let i = 0; i < Math.max(1, count); i++) {
      const w = factory();
      w.onmessage = (e: MessageEvent<TerrainJobResult>) => this.done(w, e.data, null);
      w.onerror = (e) => this.done(w, null, e);
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  get size(): number {
    return this.workers.length;
  }

  run(job: TerrainJob): Promise<TerrainJobResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({ job, resolve, reject });
      this.pump();
    });
  }

  terminate(): void {
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
    this.idle.length = 0;
  }

  private pump(): void {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!;
      const { job, resolve, reject } = this.queue.shift()!;
      this.pending.set(w, { resolve, reject });
      w.postMessage(job);
    }
  }

  private done(w: Worker, result: TerrainJobResult | null, error: unknown): void {
    const p = this.pending.get(w);
    this.pending.delete(w);
    this.idle.push(w);
    if (p) {
      if (result) p.resolve(result);
      else p.reject(error);
    }
    this.pump();
  }
}
