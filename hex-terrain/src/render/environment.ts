import type { RGB } from '../core/color';
import { clamp01, smoothstep } from '../core/noise';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];

export interface Environment {
  season: Season;
  /** Hour of day, 0..24. Sun rises in the east (right) around 6, sets in the west around 18. */
  hour: number;
}

export const DEFAULT_ENVIRONMENT: Environment = { season: 'summer', hour: 14.5 };

export interface Lighting {
  /** Unit vector pointing towards the light (x right, y towards viewer, z up). */
  sun: [number, number, number];
  sunColor: RGB;
  ambient: RGB;
  /** Multiplier that brings flat, sunlit ground to roughly 1.0. */
  exposure: number;
  /** Colour multiplier applied to pre-painted sprites so they match the terrain. */
  spriteTint: RGB;
  /** 0 by day, 1 at full night; drives window lights and lava glow. */
  night: number;
  /** Strength of cast shadows (0..1). */
  shadow: number;
  /** Direction sprite shadows fall, in screen space (unit). */
  shadowDir: [number, number];
  /** Background colour around the map. */
  backdrop: RGB;
  /** Colour desaturation (0..1): night vision loses colour. */
  desat: number;
}

export function computeLighting(env: Environment): Lighting {
  const h = ((env.hour % 24) + 24) % 24;
  // Day fraction: 0 at 6:00, 1 at 18:00.
  const t = (h - 6) / 12;
  const day = t >= -0.08 && t <= 1.08;
  const elevDeg = day ? Math.max(9, Math.sin(Math.PI * clamp01(t)) * 58) : 40;
  const az = day ? Math.PI * clamp01(t) : Math.PI * 0.72;
  const el = (elevDeg * Math.PI) / 180;
  // Sun sweeps east -> south (towards viewer) -> west, but stays a little north
  // of the viewer so front faces are never fully back-lit.
  let sx = Math.cos(az);
  let sy = Math.sin(az) * 0.75;
  const len = Math.hypot(sx, sy) || 1;
  sx /= len;
  sy /= len;
  const sun: [number, number, number] = [sx * Math.cos(el), sy * Math.cos(el), Math.sin(el)];

  // Warmth rises as the sun gets low.
  const low = 1 - smoothstep(8, 30, elevDeg);
  const dusk = day ? 0 : 1;
  const night = smoothstep(-0.02, 0.12, -t) + smoothstep(1.02, 1.12, t);
  const nightK = clamp01(night);

  const daySun: RGB = [1.0, 0.97, 0.9];
  const goldSun: RGB = [1.2, 0.8, 0.48];
  const moon: RGB = [0.3, 0.38, 0.58];
  const dayAmb: RGB = [0.5, 0.56, 0.66];
  const goldAmb: RGB = [0.6, 0.47, 0.44];
  const nightAmb: RGB = [0.1, 0.13, 0.24];

  const mix3 = (a: RGB, b: RGB, k: number): RGB => [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
  ];
  let sunColor = mix3(daySun, goldSun, low);
  let ambient = mix3(dayAmb, goldAmb, low);
  sunColor = mix3(sunColor, moon, nightK || dusk);
  ambient = mix3(ambient, nightAmb, nightK || dusk);

  const flat = Math.max(0, sun[2]);
  const refLum = 0.72 * (ambient[1] + sunColor[1] * flat);
  const dayRef = 0.72 * (dayAmb[1] + daySun[1] * Math.sin((58 * Math.PI) / 180));
  // Exposure keeps midday ground near 1.0; evenings and nights stay darker.
  const exposure = (1 / dayRef) * Math.sqrt(dayRef / Math.max(0.02, refLum));
  const spriteTint: RGB = [
    (ambient[0] + sunColor[0] * flat) * 0.72 * exposure,
    (ambient[1] + sunColor[1] * flat) * 0.72 * exposure,
    (ambient[2] + sunColor[2] * flat) * 0.72 * exposure,
  ];

  const sl = Math.hypot(sun[0], sun[1]) || 1;
  const backdropDay: RGB = [0.12, 0.15, 0.17];
  return {
    sun,
    sunColor,
    ambient,
    exposure,
    spriteTint,
    night: nightK,
    shadow: 0.55 * (1 - nightK * 0.5),
    shadowDir: [-sun[0] / sl, -sun[1] / sl],
    backdrop: mix3(backdropDay, [0.04, 0.05, 0.09], nightK),
    desat: 0.6 * nightK + 0.1 * low * (1 - nightK),
  };
}
