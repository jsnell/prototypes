// Free orbit camera: diorama overview by default, zoom all the way in if you like.
import * as THREE from 'three';
import { MAP_W as W, MAP_D as D } from './config.js';
import { clamp } from './util.js';

export class CameraRig {
  constructor(G, camera) {
    this.G = G;
    this.camera = camera;
    this.target = new THREE.Vector3(W / 2, 6, D * 0.42);
    this.yaw = 0; this.pitch = 0.92; this.dist = 235;
    this.want = { x: this.target.x, z: this.target.z, yaw: this.yaw, pitch: this.pitch, dist: this.dist };
    this.follow = null;
    this.minDist = 4; this.maxDist = 300;
    this.shakeOff = new THREE.Vector3();
  }

  forward() { return [Math.sin(this.yaw), Math.cos(this.yaw)]; }
  right() { return [-Math.cos(this.yaw), Math.sin(this.yaw)]; }

  pan(dx, dz) { // camera-relative, world units
    const [fx, fz] = this.forward(), [rx, rz] = this.right();
    this.want.x += rx * dx + fx * dz;
    this.want.z += rz * dx + fz * dz;
    this.follow = null;
    this.clampWant();
  }
  panWorld(dx, dz) { this.want.x += dx; this.want.z += dz; this.follow = null; this.clampWant(); }
  clampWant() {
    this.want.x = clamp(this.want.x, -10, W + 10);
    this.want.z = clamp(this.want.z, -10, D + 10);
  }
  rotate(dyaw, dpitch) {
    this.want.yaw += dyaw;
    this.want.pitch = clamp(this.want.pitch + dpitch, 0.18, 1.45);
  }
  zoom(factor, toward = null) {
    const nd = clamp(this.want.dist * factor, this.minDist, this.maxDist);
    const real = nd / this.want.dist;
    if (toward && factor < 1) {
      this.want.x += (toward.x - this.want.x) * (1 - real);
      this.want.z += (toward.z - this.want.z) * (1 - real);
      this.follow = null;
    } else if (toward && factor > 1) {
      this.want.x += (this.want.x - toward.x) * (real - 1) * 0.3;
      this.want.z += (this.want.z - toward.z) * (real - 1) * 0.3;
    }
    this.want.dist = nd;
    this.clampWant();
  }
  focus(x, z, dist = null) {
    this.want.x = x; this.want.z = z;
    if (dist) this.want.dist = dist;
  }

  update(dt) {
    const G = this.G;
    if (this.follow) {
      const f = this.follow;
      if (f.alive === false && !f.dead) this.follow = null;
      else { this.want.x = f.x; this.want.z = f.z; }
    }
    const k = 1 - Math.exp(-dt * 10);
    this.target.x += (this.want.x - this.target.x) * k;
    this.target.z += (this.want.z - this.target.z) * k;
    this.yaw += (this.want.yaw - this.yaw) * k;
    this.pitch += (this.want.pitch - this.pitch) * k;
    this.dist += (this.want.dist - this.dist) * k;
    const T = G.terrain;
    const gy = T ? T.surfaceAt(clamp(this.target.x, 0, W - 1), clamp(this.target.z, 0, D - 1)) : 6;
    this.target.y += (gy - this.target.y) * Math.min(1, dt * 4);
    const cp = Math.cos(this.pitch);
    const pos = this.camera.position;
    pos.set(
      this.target.x - Math.sin(this.yaw) * cp * this.dist,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z - Math.cos(this.yaw) * cp * this.dist,
    );
    // keep above ground
    if (T) {
      const ch = T.surfaceAt(clamp(pos.x, 0, W - 1), clamp(pos.z, 0, D - 1));
      if (pos.x > 0 && pos.x < W && pos.z > 0 && pos.z < D && pos.y < ch + 1.2) pos.y = ch + 1.2;
    }
    // shake
    const tr = G.fx ? G.fx.trauma : 0;
    const s = tr * tr * Math.min(3, 0.4 + this.dist * 0.02);
    const t = performance.now() / 1000;
    this.shakeOff.set(Math.sin(t * 43) * s, Math.sin(t * 57 + 1) * s, Math.sin(t * 37 + 2) * s);
    pos.add(this.shakeOff);
    this.camera.lookAt(this.target.x + this.shakeOff.x * 0.5, this.target.y, this.target.z + this.shakeOff.z * 0.5);
    // fog scales with zoom so the far side of the diorama stays crisp from above
    if (G.scene.fog) { G.scene.fog.near = this.dist * 1.1 + 40; G.scene.fog.far = this.dist * 2.8 + 150; }
    this.camera.near = Math.max(0.1, this.dist * 0.01);
    this.camera.far = this.dist * 5 + 600;
    this.camera.updateProjectionMatrix();
  }

  // project the screen corners to the ground (for the minimap)
  groundCorners() {
    const G = this.G, out = [];
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -6);
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ray.setFromCamera({ x, y }, this.camera);
      const p = new THREE.Vector3();
      if (ray.ray.intersectPlane(plane, p)) out.push(p);
      else {
        const d = ray.ray.direction;
        out.push(new THREE.Vector3(this.camera.position.x + d.x * 400, 6, this.camera.position.z + d.z * 400));
      }
    }
    return out;
  }
}
