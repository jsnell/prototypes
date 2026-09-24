/** Colours as mutable [r, g, b] tuples in 0..1 (sRGB). */
export type RGB = [number, number, number];

export function hex(h: string): RGB {
  const s = h.startsWith('#') ? h.slice(1) : h;
  const n = parseInt(s, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Mix b into out in place. */
export function mixInto(out: RGB, b: RGB, t: number): void {
  out[0] += (b[0] - out[0]) * t;
  out[1] += (b[1] - out[1]) * t;
  out[2] += (b[2] - out[2]) * t;
}

export function scale(a: RGB, k: number): RGB {
  return [a[0] * k, a[1] * k, a[2] * k];
}

export function mul(a: RGB, b: RGB): RGB {
  return [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
}

export function toCss(c: RGB, alpha = 1): string {
  const r = Math.round(Math.max(0, Math.min(1, c[0])) * 255);
  const g = Math.round(Math.max(0, Math.min(1, c[1])) * 255);
  const b = Math.round(Math.max(0, Math.min(1, c[2])) * 255);
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

export function luminance(c: RGB): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** Scale saturation around luminance. */
export function saturate(c: RGB, k: number): RGB {
  const l = luminance(c);
  return [l + (c[0] - l) * k, l + (c[1] - l) * k, l + (c[2] - l) * k];
}

/** Shift a colour: brightness multiplier plus warm (+) / cool (-) tint. */
export function shade(c: RGB, k: number, warm = 0): RGB {
  return [c[0] * k * (1 + warm * 0.12), c[1] * k * (1 + warm * 0.03), c[2] * k * (1 - warm * 0.12)];
}
