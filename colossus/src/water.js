// Stylised faceted water with depth tint, shore foam, sparkles and ripple rings.
import * as THREE from 'three';
import { MAP_W as W, MAP_D as D, WATER_LEVEL, BASE_Y } from './config.js';

const RIPPLES = 16;

const vert = /* glsl */`
uniform float uTime;
uniform vec4 uRipples[${RIPPLES}];
varying vec3 vW;
#include <fog_pars_vertex>
void main() {
  vec3 p = position;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  float w = sin(wp.x * 0.7 + uTime * 1.4) * 0.06 + cos(wp.z * 0.85 + uTime * 1.1) * 0.05 + sin((wp.x + wp.z) * 0.37 - uTime * 0.8) * 0.04;
  for (int i = 0; i < ${RIPPLES}; i++) {
    vec4 r = uRipples[i];
    float age = uTime - r.z;
    if (age < 0.0 || age > 2.5) continue;
    float d = distance(wp.xz, r.xy);
    w += sin(d * 3.0 - age * 14.0) * exp(-abs(d - age * 5.0) * 1.2) * (1.0 - age / 2.5) * 0.25 * r.w;
  }
  wp.y += w;
  vW = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const frag = /* glsl */`
uniform float uTime;
uniform sampler2D uHeight;
uniform vec2 uMap;
uniform float uWater;
uniform vec3 uSun;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform vec4 uRipples[${RIPPLES}];
varying vec3 vW;
#include <fog_pars_fragment>
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 uv = vW.xz / uMap;
  float th = texture2D(uHeight, uv).r * 255.0 / 8.0;
  float depth = uWater - th;
  if (depth < -0.35) discard;
  vec3 col = mix(uShallow, uDeep, smoothstep(0.3, 3.2, depth));
  // blocky caustic shimmer
  vec2 cell = floor(vW.xz * 1.5);
  float cz = hash(cell + floor(uTime * 0.8 + hash(cell) * 3.0));
  col += vec3(0.05, 0.08, 0.08) * step(0.8, cz) * (1.0 - smoothstep(0.5, 2.5, depth));
  // shore foam
  float wob = 0.16 * sin(uTime * 1.8 + vW.x * 0.9 + vW.z * 0.6) + 0.08 * sin(uTime * 3.1 - vW.z * 1.7);
  float band = depth + wob;
  float foam = step(band, 0.32);
  foam = max(foam, step(abs(band - 0.78 - 0.12 * sin(uTime * 0.9)), 0.07) * 0.55);
  // ripples
  float rip = 0.0;
  for (int i = 0; i < ${RIPPLES}; i++) {
    vec4 r = uRipples[i];
    float age = uTime - r.z;
    if (age < 0.0 || age > 2.5) continue;
    float d = distance(vW.xz, r.xy);
    rip += step(abs(d - age * 5.0), 0.28 + 0.1 * r.w) * (1.0 - age / 2.5);
  }
  // faceted normal
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
  if (n.y < 0.0) n = -n;
  vec3 V = normalize(cameraPosition - vW);
  float spec = pow(max(dot(reflect(-uSun, n), V), 0.0), 80.0);
  float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  float spark = step(0.992, hash(floor(vW.xz * 3.0) + floor(uTime * 6.0))) * 0.6;
  col = mix(col, vec3(0.75, 0.9, 1.0), fres * 0.35);
  col = mix(col, uFoam, clamp(foam + rip, 0.0, 1.0) * 0.9);
  col += spec * 0.9 + spark * (1.0 - foam);
  float alpha = mix(0.5, 0.86, smoothstep(0.0, 2.4, depth));
  alpha = max(alpha, clamp(foam + rip, 0.0, 1.0) * 0.95);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export class Water {
  constructor(G) {
    this.G = G;
    const geo = new THREE.PlaneGeometry(W, D, W, D);
    geo.rotateX(-Math.PI / 2);
    geo.translate(W / 2, WATER_LEVEL, D / 2);
    this.ripples = [];
    for (let n = 0; n < RIPPLES; n++) this.ripples.push(new THREE.Vector4(0, 0, -100, 0));
    this.ri = 0;
    const lin = (h) => new THREE.Color(h);
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
    Object.assign(uniforms, {
      uTime: { value: 0 },
      uHeight: { value: G.terrain.heightTex },
      uMap: { value: new THREE.Vector2(W, D) },
      uWater: { value: WATER_LEVEL },
      uSun: { value: G.sunDir.clone() },
      uShallow: { value: lin(0x5fe0d8) },
      uDeep: { value: lin(0x2a7fd4) },
      uFoam: { value: lin(0xffffff) },
      uRipples: { value: this.ripples },
    });
    this.mat = new THREE.ShaderMaterial({
      uniforms, vertexShader: vert, fragmentShader: frag,
      transparent: true, depthWrite: false, fog: true,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.renderOrder = 2;
    G.scene.add(this.mesh);
    this.buildWalls();
  }

  buildWalls() {
    const T = this.G.terrain, pos = [];
    const q = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < W; i++) {
      let h = T.H[i]; if (h < WATER_LEVEL) q([i + 1, h, 0], [i, h, 0], [i, WATER_LEVEL, 0], [i + 1, WATER_LEVEL, 0]);
      h = T.H[(D - 1) * W + i]; if (h < WATER_LEVEL) q([i, h, D], [i + 1, h, D], [i + 1, WATER_LEVEL, D], [i, WATER_LEVEL, D]);
    }
    for (let j = 0; j < D; j++) {
      let h = T.H[j * W]; if (h < WATER_LEVEL) q([0, h, j], [0, h, j + 1], [0, WATER_LEVEL, j + 1], [0, WATER_LEVEL, j]);
      h = T.H[j * W + W - 1]; if (h < WATER_LEVEL) q([W, h, j + 1], [W, h, j], [W, WATER_LEVEL, j], [W, WATER_LEVEL, j + 1]);
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x4fc3e8, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    m.renderOrder = 1;
    this.G.scene.add(m);
  }

  ripple(x, z, amp = 1) {
    const r = this.ripples[this.ri++ % RIPPLES];
    r.set(x, z, this.mat.uniforms.uTime.value, amp);
  }

  update(t) { this.mat.uniforms.uTime.value = t; }
}
