'use strict';
// ---------- WebGL2 deferred renderer: pixel-art G-buffer + dynamic lights + bloom ----------
const GFX = {};
const INST = 16; // floats per sprite instance
const LINST = 12; // floats per light

class Batch {
  constructor(n, stride = INST) { this.data = new Float32Array(n * stride); this.n = 0; this.max = n; this.stride = stride; }
  reset() { this.n = 0; }
  // generic sprite instance
  add(x, y, w, h, reg, r, g, b, a, ang, depthY, z, em) {
    if (this.n >= this.max) return;
    const d = this.data, o = this.n++ * INST;
    d[o] = x; d[o + 1] = y; d[o + 2] = w; d[o + 3] = h;
    d[o + 4] = reg.x; d[o + 5] = reg.y; d[o + 6] = reg.x + reg.w; d[o + 7] = reg.y + reg.h;
    d[o + 8] = r; d[o + 9] = g; d[o + 10] = b; d[o + 11] = a;
    d[o + 12] = ang; d[o + 13] = depthY; d[o + 14] = z; d[o + 15] = em;
  }
  light(x, y, z, rad, r, g, b, dx = 0, dy = 0, cone = -2, soft = 0.1) {
    if (this.n >= this.max) return;
    const d = this.data, o = this.n++ * LINST;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = rad;
    d[o + 4] = r; d[o + 5] = g; d[o + 6] = b; d[o + 7] = 0;
    d[o + 8] = dx; d[o + 9] = dy; d[o + 10] = cone; d[o + 11] = soft;
  }
}

const SH_COMMON = `#version 300 es
precision highp float; precision highp int;
const vec2 RES = vec2(${W}.0, ${H}.0);
const float HMAX = ${HMAX}.0;
`;
const VS_FULL = SH_COMMON + `
out vec2 vUV;
void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2); vUV = p; gl_Position = vec4(p*2.0-1.0, 0.0, 1.0); }`;

const VS_SPRITE = SH_COMMON + `
layout(location=0) in vec2 aQuad;
layout(location=1) in vec4 aPos;
layout(location=2) in vec4 aUV;
layout(location=3) in vec4 aTint;
layout(location=4) in vec4 aEx;
uniform vec2 uAtlas;
out vec2 vUV; out vec4 vTint; out float vZ; out float vEm;
void main(){
  vec2 p = (aQuad - 0.5) * aPos.zw;
  float c = cos(aEx.x), s = sin(aEx.x);
  p = vec2(c*p.x - s*p.y, s*p.x + c*p.y);
  vec2 w = aPos.xy + p;
  vec2 ndc = w / RES * 2.0 - 1.0; ndc.y = -ndc.y;
  float depth = 0.95 - clamp(aEx.y / (RES.y + 200.0), -0.2, 1.2) * 0.8;
  gl_Position = vec4(ndc, depth, 1.0);
  vUV = mix(aUV.xy, aUV.zw, aQuad) / uAtlas;
  vTint = aTint; vZ = aEx.z; vEm = aEx.w;
}`;

const FS_GBUF = SH_COMMON + `
in vec2 vUV; in vec4 vTint; in float vZ; in float vEm;
uniform sampler2D uAlb, uNrm, uEmi;
layout(location=0) out vec4 oAlb; layout(location=1) out vec4 oNrm; layout(location=2) out vec4 oEmi;
void main(){
  vec4 a = texture(uAlb, vUV); if (a.a < 0.5 || vTint.a < 0.02) discard;
  vec4 n = texture(uNrm, vUV); vec4 e = texture(uEmi, vUV);
  oAlb = vec4(a.rgb * vTint.rgb, 1.0);
  oNrm = vec4(n.rgb, n.a + vZ / HMAX);
  oEmi = vec4(e.rgb * vEm * vTint.rgb, e.a);
}`;

const FS_FLAT = SH_COMMON + `
in vec2 vUV; in vec4 vTint; in float vZ; in float vEm;
uniform sampler2D uAlb; uniform int uMode;
out vec4 o;
void main(){
  float a = texture(uAlb, vUV).a * vTint.a;
  if (uMode == 0) o = vec4(vTint.rgb * a * vEm, 0.0);        // additive emissive
  else o = vec4(vTint.rgb, a);                               // alpha blended
}`;

const FS_TERRAIN = SH_COMMON + `
uniform sampler2D uTAlb, uTNrm, uTEmi, uDCol, uDEmi;
layout(location=0) out vec4 oAlb; layout(location=1) out vec4 oNrm; layout(location=2) out vec4 oEmi;
void main(){
  ivec2 fc = ivec2(gl_FragCoord.xy);
  ivec2 wc = ivec2(fc.x, ${H - 1} - fc.y);
  vec4 a = texelFetch(uTAlb, wc, 0), n = texelFetch(uTNrm, wc, 0), e = texelFetch(uTEmi, wc, 0);
  vec4 dc = texelFetch(uDCol, fc, 0); vec4 de = texelFetch(uDEmi, fc, 0);
  vec3 alb = mix(a.rgb, dc.rgb, clamp(dc.a, 0.0, 1.0));
  float spec = mix(e.a, 0.9, clamp(dc.a, 0.0, 1.0) * 0.6);
  oAlb = vec4(alb, 1.0); oNrm = n; oEmi = vec4(e.rgb + clamp(de.rgb, 0.0, 0.35), spec);
}`;

const FS_AMBIENT = SH_COMMON + `
uniform sampler2D uGA, uGN, uGE;
uniform vec3 uAmb, uSunDir, uSunCol; uniform float uEmScale;
out vec4 o;
float hAt(vec2 fc){ return texelFetch(uGN, ivec2(clamp(fc, vec2(0.0), RES-1.0)), 0).a * HMAX; }
void main(){
  vec2 fc = gl_FragCoord.xy;
  ivec2 ic = ivec2(fc);
  vec3 alb = texelFetch(uGA, ic, 0).rgb;
  vec4 nh = texelFetch(uGN, ic, 0); vec4 em = texelFetch(uGE, ic, 0);
  vec3 N = normalize(nh.rgb * 2.0 - 1.0);
  float h = nh.a * HMAX;
  // AO from neighbouring heights
  float occ = 0.0;
  for (int i = 0; i < 8; i++) { float a = float(i) * 0.785; vec2 d = vec2(cos(a), sin(a)) * 3.0; occ += max(0.0, hAt(fc + d) - h - 0.5); }
  float ao = clamp(1.0 - occ * 0.045, 0.35, 1.0);
  // sun / moon with raymarched shadows (world y is down; fb y is up)
  vec2 sd = normalize(uSunDir.xy); vec2 sdf = vec2(sd.x, -sd.y);
  float slope = uSunDir.z / max(length(uSunDir.xy), 0.001);
  float sh = 1.0;
  for (int i = 1; i <= 22; i++) { float t = float(i) * 1.6; float rh = h + t * slope + 0.4; float sH = hAt(fc + sdf * t); sh = min(sh, clamp(1.0 - (sH - rh) * 0.5, 0.0, 1.0)); }
  float diff = max(dot(N, uSunDir), 0.0);
  vec3 V = normalize(vec3(0.0, 0.55, 1.0));
  vec3 Hh = normalize(uSunDir + V);
  float spec = pow(max(dot(N, Hh), 0.0), mix(6.0, 80.0, em.a)) * em.a * 1.5;
  vec3 col = alb * (uAmb * ao + uSunCol * diff * sh) + uSunCol * spec * sh + em.rgb * uEmScale;
  o = vec4(col, 1.0);
}`;

const VS_LIGHT = SH_COMMON + `
layout(location=0) in vec2 aQuad;
layout(location=1) in vec4 aL0; layout(location=2) in vec4 aL1; layout(location=3) in vec4 aL2;
out vec4 vL0; out vec4 vL1; out vec4 vL2;
void main(){
  vec2 w = aL0.xy + (aQuad * 2.0 - 1.0) * aL0.w;
  vec2 ndc = w / RES * 2.0 - 1.0; ndc.y = -ndc.y;
  gl_Position = vec4(ndc, 0.0, 1.0);
  vL0 = aL0; vL1 = aL1; vL2 = aL2;
}`;
const FS_LIGHT = SH_COMMON + `
in vec4 vL0; in vec4 vL1; in vec4 vL2;
uniform sampler2D uGA, uGN, uGE;
out vec4 o;
void main(){
  vec2 fc = gl_FragCoord.xy; ivec2 ic = ivec2(fc);
  vec2 wp = vec2(fc.x, RES.y - fc.y);
  vec2 dl = vL0.xy - wp; float d = length(dl);
  if (d > vL0.w) discard;
  vec4 nh = texelFetch(uGN, ic, 0);
  float h = nh.a * HMAX;
  vec3 N = normalize(nh.rgb * 2.0 - 1.0);
  vec3 Lv = vec3(dl, vL0.z - h); vec3 L = normalize(Lv);
  float x = d / vL0.w;
  float att = (1.0 - x) * (1.0 - x) / (1.0 + d * d * 0.004);
  float spot = 1.0;
  if (vL2.z > -1.5) { vec2 dir = normalize(-dl + 0.0001); spot = smoothstep(vL2.z - vL2.w, vL2.z + 0.02, dot(dir, vL2.xy)); if (d < 3.0) spot = max(spot, 0.6); }
  if (att * spot < 0.002) discard;
  // shadows: march toward the light through the height buffer
  float sh = 1.0; float steps = clamp(d * 0.5, 2.0, 18.0);
  for (int i = 1; i < 18; i++) {
    float fi = float(i); if (fi >= steps) break;
    float t = fi / steps;
    vec2 p = mix(wp, vL0.xy, t);
    float rh = mix(h + 0.6, vL0.z, t);
    float sH = texelFetch(uGN, ivec2(clamp(vec2(p.x, RES.y - p.y), vec2(0.0), RES - 1.0)), 0).a * HMAX;
    sh = min(sh, clamp(1.0 - (sH - rh) * 0.35, 0.0, 1.0));
  }
  vec3 alb = texelFetch(uGA, ic, 0).rgb; float gloss = texelFetch(uGE, ic, 0).a;
  float diff = max(dot(N, L), 0.0) * 0.85 + 0.15 * max(L.z, 0.0);
  vec3 V = normalize(vec3(0.0, 0.55, 1.0)); vec3 Hh = normalize(L + V);
  float spec = pow(max(dot(N, Hh), 0.0), mix(6.0, 90.0, gloss)) * gloss * 2.2;
  o = vec4((alb * diff + spec) * vL1.rgb * att * spot * sh, 0.0);
}`;

const FS_FADE = SH_COMMON + `uniform vec4 uCol; out vec4 o; void main(){ o = uCol; }`;
const FS_BRIGHT = SH_COMMON + `
in vec2 vUV; uniform sampler2D uSrc; uniform float uThresh; out vec4 o;
void main(){ vec3 c = texture(uSrc, vUV).rgb; float l = max(c.r, max(c.g, c.b)); o = vec4(c * max(l - uThresh, 0.0) / max(l, 0.0001), 1.0); }`;
const FS_BLUR = SH_COMMON + `
in vec2 vUV; uniform sampler2D uSrc; uniform vec2 uDir; out vec4 o;
void main(){
  vec3 c = texture(uSrc, vUV).rgb * 0.227;
  c += (texture(uSrc, vUV + uDir * 1.385).rgb + texture(uSrc, vUV - uDir * 1.385).rgb) * 0.316;
  c += (texture(uSrc, vUV + uDir * 3.231).rgb + texture(uSrc, vUV - uDir * 3.231).rgb) * 0.070;
  o = vec4(c, 1.0);
}`;
const FS_FINAL = SH_COMMON + `
in vec2 vUV; uniform sampler2D uHdr, uB1, uB2; uniform vec2 uShake; uniform float uFlash, uTime, uExposure, uScan, uBloom;
out vec4 o;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main(){
  vec2 g = vUV * RES + uShake;
  ivec2 ip = ivec2(clamp(floor(g), vec2(0.0), RES - 1.0));
  vec3 c = max(texelFetch(uHdr, ip, 0).rgb, 0.0);
  vec2 buv = g / RES;
  vec3 b1 = texture(uB1, buv).rgb, b2 = texture(uB2, buv).rgb;
  vec3 b2r = vec3(texture(uB2, buv + vec2(0.003, 0.0)).r, b2.g, texture(uB2, buv - vec2(0.003, 0.0)).b);
  c += (b1 * 0.55 + b2r * 0.9) * uBloom;
  c *= uExposure;
  c += vec3(uFlash);
  c = aces(c);
  vec2 q = vUV - 0.5; c *= 1.0 - dot(q, q) * 0.85;
  float sub = fract(g.y); c *= 1.0 - uScan * (1.0 - smoothstep(0.0, 0.35, sub) * smoothstep(1.0, 0.65, sub));
  c = pow(max(c, 0.0), vec3(1.0 / 2.2));
  c += (hash(vec2(ip) + fract(uTime * 7.13) * 91.0) - 0.5) * 0.035;
  o = vec4(c, 1.0);
}`;

function glCompile(gl, vs, fs) {
  const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(sh); console.error(log, s); throw new Error('shader: ' + log); } return sh; };
  const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

function initRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  if (!gl) throw new Error('WebGL2 is required');
  GFX.gl = gl; GFX.canvas = canvas;
  GFX.float = !!gl.getExtension('EXT_color_buffer_float');
  const HF = GFX.float ? [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT] : [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE];
  const tex = (w, h, fmt, filter, data = null) => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt[0], w, h, 0, fmt[1], fmt[2], data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  GFX.tex = tex;
  GFX.SRGB = [gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE];
  GFX.LIN = [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE];
  const fb = (texs, depth) => {
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    texs.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
    if (depth) { const rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, W, H); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb); }
    gl.drawBuffers(texs.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER); if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('fb incomplete ' + st);
    return f;
  };
  // G-buffer
  GFX.gA = tex(W, H, HF, gl.NEAREST); GFX.gN = tex(W, H, GFX.LIN, gl.NEAREST); GFX.gE = tex(W, H, HF, gl.NEAREST);
  GFX.gFB = fb([GFX.gA, GFX.gN, GFX.gE], true);
  GFX.hdr = tex(W, H, HF, gl.LINEAR); GFX.hdrFB = fb([GFX.hdr]);
  GFX.dCol = tex(W, H, HF, gl.NEAREST); GFX.dColFB = fb([GFX.dCol]);
  GFX.dEmi = tex(W, H, HF, gl.NEAREST); GFX.dEmiFB = fb([GFX.dEmi]);
  GFX.b1a = tex(W / 2, H / 2, HF, gl.LINEAR); GFX.b1b = tex(W / 2, H / 2, HF, gl.LINEAR);
  GFX.b2a = tex(W / 8, H / 8, HF, gl.LINEAR); GFX.b2b = tex(W / 8, H / 8, HF, gl.LINEAR);
  GFX.b1aFB = fb([GFX.b1a]); GFX.b1bFB = fb([GFX.b1b]); GFX.b2aFB = fb([GFX.b2a]); GFX.b2bFB = fb([GFX.b2b]);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // atlas
  GFX.aAlb = tex(ATLAS, ATLAS, GFX.SRGB, gl.NEAREST, new Uint8Array(Atlas.alb.buffer));
  GFX.aNrm = tex(ATLAS, ATLAS, GFX.LIN, gl.NEAREST, new Uint8Array(Atlas.nrm.buffer));
  GFX.aEmi = tex(ATLAS, ATLAS, GFX.SRGB, gl.NEAREST, new Uint8Array(Atlas.emi.buffer));
  GFX.linSampler = gl.createSampler();
  gl.samplerParameteri(GFX.linSampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.samplerParameteri(GFX.linSampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.samplerParameteri(GFX.linSampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.samplerParameteri(GFX.linSampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // programs
  GFX.pG = glCompile(gl, VS_SPRITE, FS_GBUF);
  GFX.pFlat = glCompile(gl, VS_SPRITE, FS_FLAT);
  GFX.pTer = glCompile(gl, VS_FULL, FS_TERRAIN);
  GFX.pAmb = glCompile(gl, VS_FULL, FS_AMBIENT);
  GFX.pLight = glCompile(gl, VS_LIGHT, FS_LIGHT);
  GFX.pFade = glCompile(gl, VS_FULL, FS_FADE);
  GFX.pBright = glCompile(gl, VS_FULL, FS_BRIGHT);
  GFX.pBlur = glCompile(gl, VS_FULL, FS_BLUR);
  GFX.pFinal = glCompile(gl, VS_FULL, FS_FINAL);

  // geometry
  const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const mkVao = (stride, locs) => {
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, 4 * stride * 70000, gl.DYNAMIC_DRAW);
    for (let i = 0; i < locs; i++) { gl.enableVertexAttribArray(i + 1); gl.vertexAttribPointer(i + 1, 4, gl.FLOAT, false, stride * 4, i * 16); gl.vertexAttribDivisor(i + 1, 1); }
    gl.bindVertexArray(null);
    return { vao, buf };
  };
  GFX.sVao = mkVao(INST, 4); GFX.lVao = mkVao(LINST, 3);
  GFX.emptyVao = gl.createVertexArray();

  // batches
  GFX.bG = new Batch(40000);      // lit sprites into the G-buffer
  GFX.bE = new Batch(40000);      // additive emissive
  GFX.bS = new Batch(12000);      // alpha smoke
  GFX.bDC = new Batch(8000);      // decal colour stamps
  GFX.bDE = new Batch(4000);      // decal emissive stamps
  GFX.bL = new Batch(1200, LINST);// lights
  GFX.bTop = new Batch(4000);     // alpha sprites above everything (aircraft)
  clearDecals();
}

function uploadTerrain(t) {
  const gl = GFX.gl;
  for (const k of ['tAlb', 'tNrm', 'tEmi']) if (GFX[k]) gl.deleteTexture(GFX[k]);
  GFX.tAlb = GFX.tex(W, H, GFX.SRGB, gl.NEAREST, t.alb);
  GFX.tNrm = GFX.tex(W, H, GFX.LIN, gl.NEAREST, t.nrm);
  GFX.tEmi = GFX.tex(W, H, GFX.SRGB, gl.NEAREST, t.emi);
}
function clearDecals() {
  const gl = GFX.gl;
  for (const f of [GFX.dColFB, GFX.dEmiFB]) { gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
}

function bindTex(unit, t, loc, sampler = null) { const gl = GFX.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.bindSampler(unit, sampler); gl.uniform1i(loc, unit); }
function drawBatch(b, vaoObj) {
  if (!b.n) return;
  const gl = GFX.gl;
  gl.bindVertexArray(vaoObj.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vaoObj.buf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, b.data, 0, b.n * b.stride);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, b.n);
}
function fullscreen() { const gl = GFX.gl; gl.bindVertexArray(GFX.emptyVao); gl.drawArrays(gl.TRIANGLES, 0, 3); }
function flatPass(b, mode, useLinear) {
  const gl = GFX.gl, P = GFX.pFlat;
  gl.useProgram(P.p); gl.uniform2f(P.u.uAtlas, ATLAS, ATLAS); gl.uniform1i(P.u.uMode, mode);
  bindTex(0, GFX.aAlb, P.u.uAlb, useLinear ? GFX.linSampler : null);
  drawBatch(b, GFX.sVao);
}

// env: { amb:[3], sunDir:[3], sunCol:[3], emScale, exposure, flash, shake:[2], time, decalFade }
function renderFrame(env) {
  const gl = GFX.gl;
  gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
  gl.viewport(0, 0, W, H);
  // --- decals (persistent) ---
  gl.enable(gl.BLEND);
  if (env.decalFade) {
    gl.useProgram(GFX.pFade.p);
    gl.blendFunc(gl.ZERO, gl.SRC_COLOR); // multiplicative fade
    if (env.decalFade & 1) { gl.bindFramebuffer(gl.FRAMEBUFFER, GFX.dColFB); gl.uniform4f(GFX.pFade.u.uCol, 1, 1, 1, 0.993); fullscreen(); }
    if (env.decalFade & 2) { gl.bindFramebuffer(gl.FRAMEBUFFER, GFX.dEmiFB); gl.uniform4f(GFX.pFade.u.uCol, 0.997, 0.997, 0.997, 1); fullscreen(); }
  }
  if (GFX.bDC.n) { gl.bindFramebuffer(gl.FRAMEBUFFER, GFX.dColFB); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); flatPass(GFX.bDC, 1, false); }
  if (GFX.bDE.n) { gl.bindFramebuffer(gl.FRAMEBUFFER, GFX.dEmiFB); gl.blendFunc(gl.ONE, gl.ONE); flatPass(GFX.bDE, 0, false); }
  gl.disable(gl.BLEND);

  // --- G-buffer ---
  gl.bindFramebuffer(gl.FRAMEBUFFER, GFX.gFB);
  gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);
  let P = GFX.pTer; gl.useProgram(P.p);
  bindTex(0, GFX.tAlb, P.u.uTAlb); bindTex(1, GFX.tNrm, P.u.uTNrm); bindTex(2, GFX.tEmi, P.u.uTEmi); bindTex(3, GFX.dCol, P.u.uDCol); bindTex(4, GFX.dEmi, P.u.uDEmi);
  fullscreen();
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
  P = GFX.pG; gl.useProgram(P.p); gl.uniform2f(P.u.uAtlas, ATLAS, ATLAS);
  bindTex(0, GFX.aAlb, P.u.uAlb); bindTex(1, GFX.aNrm, P.u.uNrm); bindTex(2, GFX.aEmi, P.u.uEmi);
  drawBatch(GFX.bG, GFX.sVao);
  gl.disable(gl.DEPTH_TEST);

  // --- lighting ---
  gl.bindFramebuffer(gl.FRAMEBUFFER, GFX.hdrFB);
  P = GFX.pAmb; gl.useProgram(P.p);
  bindTex(0, GFX.gA, P.u.uGA); bindTex(1, GFX.gN, P.u.uGN); bindTex(2, GFX.gE, P.u.uGE);
  gl.uniform3fv(P.u.uAmb, env.amb); gl.uniform3fv(P.u.uSunDir, env.sunDir); gl.uniform3fv(P.u.uSunCol, env.sunCol); gl.uniform1f(P.u.uEmScale, env.emScale);
  fullscreen();
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  P = GFX.pLight; gl.useProgram(P.p);
  bindTex(0, GFX.gA, P.u.uGA); bindTex(1, GFX.gN, P.u.uGN); bindTex(2, GFX.gE, P.u.uGE);
  drawBatch(GFX.bL, GFX.lVao);
  // particles
  flatPass(GFX.bE, 0, true);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  flatPass(GFX.bS, 1, true);
  if (GFX.bTop.n) {
    gl.disable(gl.BLEND);
    // aircraft etc: draw lit-ish directly (reuse flat alpha with tint pre-lit)
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    flatPass(GFX.bTop, 1, false);
  }
  gl.disable(gl.BLEND);

  // --- bloom ---
  gl.viewport(0, 0, W / 2, H / 2);
  gl.bindFramebuffer(gl.FRAMEBUFFER, GFX.b1aFB);
  P = GFX.pBright; gl.useProgram(P.p); bindTex(0, GFX.hdr, P.u.uSrc); gl.uniform1f(P.u.uThresh, env.bloomThresh || 0.7); fullscreen();
  P = GFX.pBlur; gl.useProgram(P.p);
  gl.bindFramebuffer(gl.FRAMEBUFFER, GFX.b1bFB); bindTex(0, GFX.b1a, P.u.uSrc); gl.uniform2f(P.u.uDir, 2 / W, 0); fullscreen();
  gl.bindFramebuffer(gl.FRAMEBUFFER, GFX.b1aFB); bindTex(0, GFX.b1b, P.u.uSrc); gl.uniform2f(P.u.uDir, 0, 2 / H); fullscreen();
  gl.viewport(0, 0, W / 8, H / 8);
  gl.bindFramebuffer(gl.FRAMEBUFFER, GFX.b2aFB); bindTex(0, GFX.b1a, P.u.uSrc); gl.uniform2f(P.u.uDir, 2 / W, 0); fullscreen();
  gl.bindFramebuffer(gl.FRAMEBUFFER, GFX.b2bFB); bindTex(0, GFX.b2a, P.u.uSrc); gl.uniform2f(P.u.uDir, 8 / W, 0); fullscreen();
  gl.bindFramebuffer(gl.FRAMEBUFFER, GFX.b2aFB); bindTex(0, GFX.b2b, P.u.uSrc); gl.uniform2f(P.u.uDir, 0, 8 / H); fullscreen();

  // --- final ---
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, GFX.canvas.width, GFX.canvas.height);
  P = GFX.pFinal; gl.useProgram(P.p);
  bindTex(0, GFX.hdr, P.u.uHdr); bindTex(1, GFX.b1a, P.u.uB1); bindTex(2, GFX.b2a, P.u.uB2);
  gl.uniform2f(P.u.uShake, env.shake[0], -env.shake[1]); gl.uniform1f(P.u.uFlash, env.flash); gl.uniform1f(P.u.uTime, env.time);
  gl.uniform1f(P.u.uExposure, env.exposure); gl.uniform1f(P.u.uScan, GFX.canvas.height / H >= 2.5 ? 0.12 : 0.0); gl.uniform1f(P.u.uBloom, env.bloom || 1);
  fullscreen();
  for (let i = 0; i < 5; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindSampler(i, null); }
}
