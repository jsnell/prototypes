/// <reference lib="webworker" />
// Computes bands of terrain (heights and surface colour) off the main thread.
import { HexLayout } from '../core/hex';
import { HexMap } from '../model/map';
import { TerrainField } from './field';
import type { TerrainJob, TerrainJobResult } from './pool';
import { SurfaceShader } from './surface';
import { allocBuffers, computeHeights, computeTerrain } from './terrain';

let cache: { key: string; field: TerrainField; shader: SurfaceShader } | null = null;

self.onmessage = (e: MessageEvent<TerrainJob>) => {
  const job = e.data;
  const key = `${job.hexSize}|${JSON.stringify(job.map)}`;
  if (!cache || cache.key !== key) {
    const map = HexMap.fromJSON(job.map);
    const field = new TerrainField(map, new HexLayout(job.hexSize));
    cache = { key, field, shader: new SurfaceShader(field) };
  }
  const { field, shader } = cache;
  shader.season = job.season;
  const W = job.worldW;
  // Hold one extra row on each side so slopes at the band edges are correct.
  const top = Math.max(0, job.y0 - 1);
  const bottom = Math.min(job.worldH, job.y1 + 1);
  const B = allocBuffers(W, top, bottom - top);
  if (top < job.y0) computeHeights(field, B, 0, W, top, job.y0);
  if (bottom > job.y1) computeHeights(field, B, 0, W, job.y1, bottom);
  computeTerrain(field, shader, B, 0, W, job.y0, job.y1, job.worldH);

  const a = (job.y0 - top) * W;
  const b = (job.y1 - top) * W;
  const out: TerrainJobResult = {
    y0: job.y0,
    y1: job.y1,
    hgt: B.hgt.slice(a, b),
    surf: B.surf.slice(a, b),
    albedo: B.albedo.slice(a, b),
    emis: B.emis.slice(a, b),
    flags: B.flags.slice(a, b),
    hexId: B.hexId.slice(a, b),
    owner: B.owner.slice(a, b),
    alt: B.alt.slice(a, b),
    altW: B.altW.slice(a, b),
  };
  (self as unknown as Worker).postMessage(out, [
    out.hgt.buffer,
    out.surf.buffer,
    out.albedo.buffer,
    out.emis.buffer,
    out.flags.buffer,
    out.hexId.buffer,
    out.owner.buffer,
    out.alt.buffer,
    out.altW.buffer,
  ]);
};
