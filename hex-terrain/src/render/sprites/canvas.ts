/** Pre-rendered sprite image, blitted in software with depth testing. */
export interface SpriteImage {
  w: number;
  h: number;
  /** Anchor (the point that sits on the ground) inside the image. */
  ax: number;
  ay: number;
  /** Straight (non-premultiplied) RGBA. */
  data: Uint8ClampedArray;
  /** Optional emissive layer (window lights, lava), added at night. */
  glow: Uint8ClampedArray | null;
}

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

export function createCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function context(c: AnyCanvas): Ctx2D {
  const ctx = c.getContext('2d', { willReadFrequently: true }) as Ctx2D | null;
  if (!ctx) throw new Error('2D canvas unavailable');
  return ctx;
}

let scratch: { c: AnyCanvas; g: AnyCanvas; w: number; h: number } | null = null;

/**
 * Draw a sprite with `draw` (origin at the anchor) into a scratch canvas
 * of the given half-extents, then capture and trim it.
 */
export function captureSprite(
  left: number,
  top: number,
  right: number,
  bottom: number,
  draw: (ctx: Ctx2D, glow: Ctx2D | null) => void,
  withGlow = false,
): SpriteImage {
  const w = Math.ceil(left + right) + 2;
  const h = Math.ceil(top + bottom) + 2;
  if (!scratch || scratch.w < w || scratch.h < h) {
    const sw = Math.max(w, scratch?.w ?? 0, 64);
    const sh = Math.max(h, scratch?.h ?? 0, 64);
    scratch = { c: createCanvas(sw, sh), g: createCanvas(sw, sh), w: sw, h: sh };
  }
  const ctx = context(scratch.c);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const ax = Math.ceil(left) + 1;
  const ay = Math.ceil(top) + 1;
  ctx.translate(ax, ay);
  let gctx: Ctx2D | null = null;
  if (withGlow) {
    gctx = context(scratch.g);
    gctx.setTransform(1, 0, 0, 1, 0, 0);
    gctx.clearRect(0, 0, w, h);
    gctx.translate(ax, ay);
  }
  draw(ctx, gctx);
  const img = ctx.getImageData(0, 0, w, h).data;
  const glow = gctx ? gctx.getImageData(0, 0, w, h).data : null;

  // Trim fully transparent borders.
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4 + 3;
      if (img[i] > 0 || (glow && glow[i] > 0)) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { w: 0, h: 0, ax: 0, ay: 0, data: new Uint8ClampedArray(0), glow: null };
  const tw = x1 - x0 + 1;
  const th = y1 - y0 + 1;
  const data = new Uint8ClampedArray(tw * th * 4);
  const gdata = glow ? new Uint8ClampedArray(tw * th * 4) : null;
  let anyGlow = false;
  for (let y = 0; y < th; y++) {
    const src = ((y + y0) * w + x0) * 4;
    data.set(img.subarray(src, src + tw * 4), y * tw * 4);
    if (gdata && glow) {
      gdata.set(glow.subarray(src, src + tw * 4), y * tw * 4);
      for (let i = 3; i < tw * 4; i += 4) if (glow[src + i] > 0) anyGlow = true;
    }
  }
  return { w: tw, h: th, ax: ax - x0, ay: ay - y0, data, glow: anyGlow ? gdata : null };
}
