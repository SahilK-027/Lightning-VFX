import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import GUI from 'lil-gui';
import './style.css';

import boltVS from './shaders/bolt.vert.glsl';
import boltFS from './shaders/bolt.frag.glsl';
import crackVS from './shaders/crack.vert.glsl';
import crackFS from './shaders/crack.frag.glsl';
import groundFlashVS from './shaders/groundFlash.vert.glsl';
import groundFlashFS from './shaders/groundFlash.frag.glsl';
import sparksVS from './shaders/sparks.vert.glsl';
import sparksFS from './shaders/sparks.frag.glsl';
import shockwaveVS from './shaders/shockwave.vert.glsl';
import shockwaveFS from './shaders/shockwave.frag.glsl';

const canvas = document.querySelector('canvas.webgl');
if (!canvas) throw new Error('Missing canvas.webgl in index.html.');

class LightningUI {
  constructor() {
    this.flashOverlayEl = document.getElementById('flash-overlay');
    this.flashT = -99;
    this.fpsEl = document.getElementById('fps');
    this.boltCountEl = document.getElementById('bolt-count');
    this.strikeCountEl = document.getElementById('strike-count');

    this.statusDot = document.getElementById('status-dot');
    this.statusText = document.getElementById('status-text');

    this.btnSingle = document.getElementById('btn-single');
    this.btnAuto = document.getElementById('btn-auto');
    this.autoDot = document.getElementById('auto-dot');
  }

  setStatus(text, active) {
    if (this.statusText) this.statusText.textContent = text;
    if (this.statusDot) {
      this.statusDot.className = 'status-indicator' + (active ? ' active' : '');
    }
  }

  setStats({ fps, active, strikes }) {
    if (this.fpsEl) this.fpsEl.textContent = String(fps);
    if (this.boltCountEl) this.boltCountEl.textContent = String(active);
    if (this.strikeCountEl) this.strikeCountEl.textContent = String(strikes);
  }

  setAutoRunning(running) {
    if (!this.btnAuto || !this.autoDot) return;
    this.autoDot.className = 'btn-dot' + (running ? ' pulse' : '');
    this.btnAuto.textContent = '';
    this.btnAuto.appendChild(this.autoDot);
    this.btnAuto.append(running ? 'Stop Loop' : 'Start Loop');
  }

  triggerFlash(nowSec) {
    this.flashT = nowSec;
  }

  updateFlash(nowSec, { overlayMaxAlpha, overlayDecay, overlayTint }) {
    if (!this.flashOverlayEl) return;
    const t = nowSec - this.flashT;
    const a = Math.max(0, Math.exp(-t * overlayDecay) * overlayMaxAlpha);
    const { r, g, b } = LightningUI.hexToRgb(overlayTint);
    this.flashOverlayEl.style.background = `rgba(${r},${g},${b},${a.toFixed(
      3,
    )})`;
  }

  bindHandlers({ onSingle, onToggleAuto }) {
    if (this.btnSingle) this.btnSingle.addEventListener('click', onSingle);
    if (this.btnAuto) this.btnAuto.addEventListener('click', onToggleAuto);
  }

  static hexToRgb(hex) {
    const h = hex.replace('#', '').trim();
    const full =
      h.length === 3
        ? h
            .split('')
            .map((c) => c + c)
            .join('')
        : h;
    const n = parseInt(full, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
}

class LightningEffect {
  constructor({ scene, camera, ui, params }) {
    this.scene = scene;
    this.camera = camera;
    this.ui = ui;
    this.params = params;

    this.activeBolts = [];
    this.strikeCount = 0;

    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this._layerColorObjs = params.layers.map((l) => new THREE.Color(l.color));

    // Shared resources for optimization (avoid per-frame allocations)
    this._debrisSharedGeo = new THREE.PlaneGeometry(1, 1);
    this._dummy = new THREE.Object3D();
    this._fadeColor = new THREE.Color();
  }

  getStats() {
    return { active: this.activeBolts.length, strikes: this.strikeCount };
  }

  setParams(nextParams) {
    this.params = nextParams;
    // Update cached colors used by existing materials
    this._layerColorObjs = this.params.layers.map(
      (l) => new THREE.Color(l.color),
    );
  }

  // ───────────────────────── Lightning geometry (optimized) ────────────────
  buildBoltGeo(points, strikeOffset, thickness, alpha, color) {
    const segs = points.length - 1;
    const vc = segs * 4;
    const pos = new Float32Array(vc * 3);
    const ratios = new Float32Array(vc);
    const dirs = new Float32Array(vc * 3);
    const sides = new Float32Array(vc);
    const sOff = new Float32Array(vc).fill(strikeOffset);
    const thick = new Float32Array(vc).fill(thickness);
    const alph = new Float32Array(vc).fill(alpha);
    const col = new Float32Array(vc * 3);
    const idx = [];

    for (let i = 0; i < segs; i++) {
      const a = points[i];
      const b = points[i + 1];
      const rA = i / (points.length - 1);
      const rB = (i + 1) / (points.length - 1);
      const dir = new THREE.Vector3().subVectors(b, a).normalize();
      const vi = i * 4;
      const verts = [
        [a, rA, -0.5],
        [a, rA, 0.5],
        [b, rB, -0.5],
        [b, rB, 0.5],
      ];

      verts.forEach(([p, r, s], j) => {
        const k = (vi + j) * 3;
        pos[k] = p.x;
        pos[k + 1] = p.y;
        pos[k + 2] = p.z;
        ratios[vi + j] = r;
        dirs[k] = dir.x;
        dirs[k + 1] = dir.y;
        dirs[k + 2] = dir.z;
        sides[vi + j] = s;
        col[k] = color.r;
        col[k + 1] = color.g;
        col[k + 2] = color.b;
      });
      idx.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aRatio', new THREE.BufferAttribute(ratios, 1));
    g.setAttribute('aDirection', new THREE.BufferAttribute(dirs, 3));
    g.setAttribute('aSide', new THREE.BufferAttribute(sides, 1));
    g.setAttribute('aStrikeOffset', new THREE.BufferAttribute(sOff, 1));
    g.setAttribute('aThickness', new THREE.BufferAttribute(thick, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alph, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    return g;
  }

  fractalPath(start, end, depth, roughness) {
    if (depth <= 0) return [start.clone(), end.clone()];
    const mid = start.clone().lerp(end, 0.45 + Math.random() * 0.1);
    const dist = start.distanceTo(end);
    mid.x += (Math.random() - 0.5) * dist * roughness;
    mid.z += (Math.random() - 0.5) * dist * roughness;
    const L = this.fractalPath(start, mid, depth - 1, roughness * 0.88);
    const R = this.fractalPath(mid, end, depth - 1, roughness * 0.88);
    return [...L.slice(0, -1), ...R];
  }

  // ───────────────────────────── Effects (optimized) ────────────────────────
  createBoltMesh(strandDefs) {
    // Merge all strands × all layers into a single mesh — 1 draw call
    const geos = [];
    for (const { points, strikeOffset, thickMult, alphaMult } of strandDefs) {
      for (const layer of this.params.layers) {
        geos.push(
          this.buildBoltGeo(
            points,
            strikeOffset,
            layer.thick * thickMult,
            layer.alpha * alphaMult,
            new THREE.Color(layer.color),
          ),
        );
      }
    }

    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());

    const material = new THREE.ShaderMaterial({
      vertexShader: boltVS,
      fragmentShader: boltFS,
      uniforms: {
        uTime: { value: 0 },
        uStrikeDur: { value: this.params.strikeDur },
        uFadeDur: { value: this.params.fadeDur },
        uSpread: { value: this.params.boltSpread },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(merged, material);
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    return { mesh, material, geometry: merged };
  }

  createGroundFlash(cx, cz, groundY, scene) {
    const p = this.params;
    const mat = new THREE.ShaderMaterial({
      vertexShader: groundFlashVS,
      fragmentShader: groundFlashFS,
      uniforms: {
        uTime: { value: -0.13 },
        uDur: { value: p.groundFlashDur },
        uColor: { value: new THREE.Color(p.groundFlashColor) },
        uIntensity: { value: p.groundFlashIntensity },
        uRadialPow: { value: p.groundFlashRadialPow },
        uFadePow: { value: p.groundFlashFadePow },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(p.groundFlashSize, p.groundFlashSize),
      mat,
    );
    mesh.position.set(cx, groundY + 0.2, cz);
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 2;
    scene.add(mesh);
    return { mesh, mat };
  }

  buildCrackGeo(points, hw, passAlpha, fadeDurMult) {
    const segs = points.length - 1;
    if (segs < 1) return null;
    const vc = segs * 4;
    const pos = new Float32Array(vc * 3);
    const ratios = new Float32Array(vc);
    const sides = new Float32Array(vc);
    const alpha = new Float32Array(vc).fill(passAlpha);
    const fadeMul = new Float32Array(vc).fill(fadeDurMult);
    const idx = [];

    for (let i = 0; i < segs; i++) {
      const a = points[i];
      const b = points[i + 1];
      const rA = i / (points.length - 1);
      const rB = (i + 1) / (points.length - 1);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      const px = (-dz / len) * hw;
      const pz = (dx / len) * hw;
      const vi = i * 4;

      [
        { p: a, r: rA, s: -1, ox: -px, oz: -pz },
        { p: a, r: rA, s: 1, ox: px, oz: pz },
        { p: b, r: rB, s: -1, ox: -px, oz: -pz },
        { p: b, r: rB, s: 1, ox: px, oz: pz },
      ].forEach(({ p: pt, r, s, ox, oz }, j) => {
        const k = (vi + j) * 3;
        pos[k] = pt.x + ox;
        pos[k + 1] = pt.y;
        pos[k + 2] = pt.z + oz;
        ratios[vi + j] = r;
        sides[vi + j] = s;
      });

      idx.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aRatio', new THREE.BufferAttribute(ratios, 1));
    g.setAttribute('aSide', new THREE.BufferAttribute(sides, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    g.setAttribute('aFadeMult', new THREE.BufferAttribute(fadeMul, 1));
    g.setIndex(idx);
    return g;
  }

  generateCrackBranches(origin, angle, length, depth, roughness, all) {
    const p = this.params;
    const steps =
      p.crackBranchStepsMin +
      Math.floor(
        Math.random() * (p.crackBranchStepsMax - p.crackBranchStepsMin + 1),
      );
    const points = [origin.clone()];
    let cur = origin.clone();

    for (let i = 0; i < steps; i++) {
      angle += (Math.random() - 0.5) * roughness;
      const step = (length / steps) * (0.6 + Math.random() * 0.8);
      cur = cur.clone();
      cur.x += Math.cos(angle) * step;
      cur.z += Math.sin(angle) * step;
      cur.y = origin.y;
      points.push(cur.clone());
    }

    all.push(points);

    if (depth > 0 && Math.random() < p.crackBranchChance) {
      const fi = 1 + Math.floor(Math.random() * (points.length - 2));
      const sign = Math.random() > 0.5 ? 1 : -1;
      this.generateCrackBranches(
        points[fi].clone(),
        angle +
          sign *
            (p.crackBranchAngleOffsetMin +
              Math.random() *
                (p.crackBranchAngleOffsetMax - p.crackBranchAngleOffsetMin)),
        length *
          (p.crackBranchLengthScaleMin +
            Math.random() *
              (p.crackBranchLengthScaleMax - p.crackBranchLengthScaleMin)),
        depth - 1,
        roughness * 0.9,
        all,
      );
    }
  }

  spawnCracks(cx, cz, groundY, delay, scene) {
    const p = this.params;
    const geos = [];

    const n =
      p.crackCountMin +
      Math.floor(Math.random() * (p.crackCountMax - p.crackCountMin + 1));

    for (let m = 0; m < n; m++) {
      const angle =
        (m / n) * Math.PI * 2 + (Math.random() - 0.5) * p.crackAngleJitter;
      const length =
        p.crackLengthMin +
        Math.random() * (p.crackLengthMax - p.crackLengthMin);
      const branches = [];

      this.generateCrackBranches(
        new THREE.Vector3(cx, groundY + p.crackOriginYOffset, cz),
        angle,
        length,
        p.crackBranchDepth,
        p.crackRoughness,
        branches,
      );

      for (const pts of branches) {
        // Wide glow pass — thinner ribbon, lower alpha, slower fade
        const gWide = this.buildCrackGeo(pts, p.crackThinHW, p.crackThinAlpha, 1.0);
        if (gWide) geos.push(gWide);

        // Narrow core pass — wider ribbon, full alpha, faster fade
        const gNarrow = this.buildCrackGeo(
          pts,
          p.crackThickHW,
          p.crackThickAlpha,
          p.crackThickFadeMult,
        );
        if (gNarrow) geos.push(gNarrow);
      }
    }

    if (geos.length === 0) return null;

    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());

    const material = new THREE.ShaderMaterial({
      vertexShader: crackVS,
      fragmentShader: crackFS,
      uniforms: {
        uTime: { value: 0 },
        uDelay: { value: delay },
        uRevealDur: { value: p.crackReveal },
        uFadeDur: { value: p.crackFade },
        uCoreColor: { value: new THREE.Color(p.crackCoreColor) },
        uMidColor: { value: new THREE.Color(p.crackMidColor) },
        uEdgeColor: { value: new THREE.Color(p.crackEdgeColor) },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(merged, material);
    mesh.renderOrder = 1;
    scene.add(mesh);
    return { mesh, material, geometry: merged };
  }

  spawnSparks(cx, cz, groundY, delay, scene) {
    const p = this.params;
    const count =
      p.sparkCountMin +
      Math.floor(Math.random() * (p.sparkCountMax - p.sparkCountMin + 1));

    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    const life = new Float32Array(count);
    const seeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      pos[i * 3] = cx + (Math.random() - 0.5) * p.sparkPosJitter;
      pos[i * 3 + 1] = groundY + p.sparkPosYOffset;
      pos[i * 3 + 2] = cz + (Math.random() - 0.5) * p.sparkPosJitter;
      const a = Math.random() * Math.PI * 2;
      const spd =
        p.sparkVelocitySpdMin +
        Math.random() * (p.sparkVelocitySpdMax - p.sparkVelocitySpdMin);
      const up =
        p.sparkVelocityUpMin +
        Math.random() * (p.sparkVelocityUpMax - p.sparkVelocityUpMin);
      vel[i * 3] = Math.cos(a) * spd;
      vel[i * 3 + 1] = up;
      vel[i * 3 + 2] = Math.sin(a) * spd;
      life[i] =
        p.sparkLifeMin + Math.random() * (p.sparkLifeMax - p.sparkLifeMin);
      seeds[i] = Math.random();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aVelocity', new THREE.BufferAttribute(vel, 3));
    geo.setAttribute('aLifetime', new THREE.BufferAttribute(life, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader: sparksVS,
      fragmentShader: sparksFS,
      uniforms: {
        uTime: { value: 0 },
        uDelay: { value: delay },
        uSize: { value: p.sparkSize },
        uGravity: { value: p.sparkGravity },
        uDepthScale: { value: p.sparkDepthScale },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    mat.userData = { type: 'sparks' };

    const mesh = new THREE.Points(geo, mat);
    mesh.renderOrder = 3;
    scene.add(mesh);
    return { mesh, mat, geo };
  }

  spawnShockwave(cx, cz, groundY, delay, scene) {
    const p = this.params;
    const mat = new THREE.ShaderMaterial({
      vertexShader: shockwaveVS,
      fragmentShader: shockwaveFS,
      uniforms: {
        uTime: { value: 0 },
        uDelay: { value: delay },
        uDur: { value: p.shockwaveDur },
        uAlphaMult: { value: p.shockwaveAlphaMult },
        uColorA: { value: new THREE.Color(p.shockwaveColorA) },
        uColorB: { value: new THREE.Color(p.shockwaveColorB) },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    mat.userData = { type: 'shockwave' };

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), mat);
    mesh.position.set(cx, groundY + 0.06, cz);
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 1;
    scene.add(mesh);
    return { mesh, mat };
  }

  spawnDebris(cx, cz, groundY, scene) {
    const p = this.params;
    const count =
      p.debrisCountMin +
      Math.floor(Math.random() * (p.debrisCountMax - p.debrisCountMin + 1));

    const material = new THREE.MeshBasicMaterial({
      vertexColors: true, // instanceColor used as per-instance tint/fade
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const instanced = new THREE.InstancedMesh(
      this._debrisSharedGeo,
      material,
      count,
    );
    instanced.renderOrder = 2;
    scene.add(instanced);

    const dummy = this._dummy;
    const shards = [];

    for (let i = 0; i < count; i++) {
      // Random scale encodes shard size variation (unit geo, scaled per instance)
      const sx = p.debrisWMin + Math.random() * (p.debrisWMax - p.debrisWMin);
      const sy = p.debrisHMin + Math.random() * (p.debrisHMax - p.debrisHMin);

      dummy.position.set(cx, groundY + p.debrisBaseYOffset, cz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(sx, sy, 1);
      dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);

      const color = this.pickDebrisColor();
      instanced.setColorAt(i, color);

      const a = Math.random() * Math.PI * 2;
      const spd =
        p.debrisVelocitySpdMin +
        Math.random() * (p.debrisVelocitySpdMax - p.debrisVelocitySpdMin);
      const up =
        p.debrisVelocityUpMin +
        Math.random() * (p.debrisVelocityUpMax - p.debrisVelocityUpMin);

      shards.push({
        index: i,
        baseScaleX: sx,
        baseScaleY: sy,
        baseColor: color.clone(),
        pos: new THREE.Vector3(cx, groundY + p.debrisBaseYOffset, cz),
        rotEuler: new THREE.Euler(),
        vx: Math.cos(a) * spd,
        vy: up,
        vz: Math.sin(a) * spd,
        rx: (Math.random() - 0.5) * p.debrisRotationScale,
        ry: (Math.random() - 0.5) * p.debrisRotationScale,
        rz: (Math.random() - 0.5) * p.debrisRotationScale,
        lifetime:
          p.debrisLifetimeMin +
          Math.random() * (p.debrisLifetimeMax - p.debrisLifetimeMin),
        active: false,
        t: 0,
        groundY,
      });
    }

    instanced.instanceMatrix.needsUpdate = true;
    instanced.instanceColor.needsUpdate = true;

    return { instanced, material, shards };
  }

  pickDebrisColor() {
    const p = this.params;
    if (Math.random() < p.debrisBlueChance) {
      const hue =
        p.debrisBlueHueMin +
        Math.random() * (p.debrisBlueHueMax - p.debrisBlueHueMin);
      const sat = p.debrisBlueSat;
      const light =
        p.debrisBlueLightMin +
        Math.random() * (p.debrisBlueLightMax - p.debrisBlueLightMin);
      return new THREE.Color().setHSL(hue, sat, light);
    }

    // Warm/ember-ish color range
    const r =
      p.debrisWarmRMin + Math.random() * (p.debrisWarmRMax - p.debrisWarmRMin);
    const g =
      p.debrisWarmGMin + Math.random() * (p.debrisWarmGMax - p.debrisWarmGMin);
    const b =
      p.debrisWarmBMin + Math.random() * (p.debrisWarmBMax - p.debrisWarmBMin);
    return new THREE.Color(r, g, b);
  }

  getGroundY() {
    return 0;
  }

  // ───────────────────────────── Spawning (optimized) ────────────────────────
  spawnAt(cx, cz, nowSec) {
    const p = this.params;
    const groundY = this.getGroundY(cx, cz);

    const height =
      p.spawnHeightMin + Math.random() * (p.spawnHeightMax - p.spawnHeightMin);
    const roughness =
      p.roughnessMin + Math.random() * (p.roughnessMax - p.roughnessMin);

    const top = new THREE.Vector3(
      cx + (Math.random() - 0.5) * p.spawnTopXZJitter,
      groundY + height,
      cz + (Math.random() - 0.5) * p.spawnTopXZJitter,
    );
    const bottom = new THREE.Vector3(cx, groundY, cz);
    const mainPoints = this.fractalPath(
      top,
      bottom,
      p.mainFractalDepth,
      roughness,
    );

    // Collect all strand definitions — merged into 1 mesh below
    const strandDefs = [
      {
        points: mainPoints,
        strikeOffset: 0,
        thickMult: p.mainStrandThickMult,
        alphaMult: p.mainStrandAlphaMult,
      },
    ];

    const bc =
      p.branchCountMin +
      Math.floor(Math.random() * (p.branchCountMax - p.branchCountMin + 1));

    for (let b = 0; b < bc; b++) {
      const ff =
        p.branchFFMin + Math.random() * (p.branchFFMax - p.branchFFMin);
      const fi = Math.floor(ff * (mainPoints.length - 1));
      const fp = mainPoints[fi].clone();

      const ba = Math.random() * Math.PI * 2;
      const bl =
        (1 - ff) *
        height *
        (p.branchLengthFactorMin +
          Math.random() * (p.branchLengthFactorMax - p.branchLengthFactorMin));

      const be = fp.clone();
      be.x += Math.cos(ba) * bl * p.branchXZScaleX;
      be.y -=
        bl *
        (p.branchDropFactorMin +
          Math.random() * (p.branchDropFactorMax - p.branchDropFactorMin));
      be.z += Math.sin(ba) * bl * p.branchXZScaleZ;
      be.y = Math.max(
        be.y,
        groundY + p.branchMinYClampOffset + Math.random() * p.branchEndYJitter,
      );

      const altPoints = this.fractalPath(
        fp,
        be,
        p.altFractalDepth,
        roughness * p.altRoughnessMult,
      );

      strandDefs.push({
        points: altPoints,
        strikeOffset: ff,
        thickMult: p.altStrandThickMult,
        alphaMult: p.altStrandAlphaMult,
      });
    }

    // ── Spawn all VFX (optimized to ~7 draw calls total) ──────────────────
    const boltMesh = this.createBoltMesh(strandDefs); // 1 draw call
    const flash = this.createGroundFlash(cx, cz, groundY, this.scene); // 1
    const cracks = this.spawnCracks(cx, cz, groundY, p.strikeDur, this.scene); // 1
    const sparks = this.spawnSparks(cx, cz, groundY, p.strikeDur, this.scene); // 1
    const debris = this.spawnDebris(cx, cz, groundY, this.scene); // 1
    const shockwave = this.spawnShockwave(
      cx,
      cz,
      groundY,
      p.strikeDur,
      this.scene,
    ); // 1

    this.activeBolts.push({
      boltMesh,
      flash,
      cracks,
      sparks,
      debris,
      shockwave,
      startTime: nowSec,
      debrisStarted: false,
      shakeTriggered: false,
      strikePos: { x: cx, z: cz, groundY },
    });

    this.strikeCount++;
    this.ui.triggerFlash(nowSec);
  }

  // ───────────────────────────── Update (optimized) ──────────────────────────
  update(dt, nowSec) {
    const p = this.params;
    const maxD = Math.max(
      p.strikeDur + p.fadeDur + p.tailExtra,
      p.strikeDur + p.crackReveal + p.crackFade + p.impactExtra,
    );

    const dummy = this._dummy;
    const fadeColor = this._fadeColor;

    for (let i = this.activeBolts.length - 1; i >= 0; i--) {
      const bolt = this.activeBolts[i];
      const elapsed = nowSec - bolt.startTime;

      if (!bolt.shakeTriggered && elapsed >= p.strikeDur) {
        bolt.shakeTriggered = true;
        this.ui.shakeCamera(p.shakeOnStrike);
      }

      // ── Uniform updates (6 writes, not 50+) ───────────────────────────
      bolt.boltMesh.material.uniforms.uTime.value = elapsed;
      bolt.boltMesh.material.uniforms.uStrikeDur.value = p.strikeDur;
      bolt.boltMesh.material.uniforms.uFadeDur.value = p.fadeDur;
      bolt.boltMesh.material.uniforms.uSpread.value = p.boltSpread;

      bolt.flash.mat.uniforms.uTime.value = elapsed - p.strikeDur;
      bolt.flash.mat.uniforms.uDur.value = p.groundFlashDur;
      bolt.flash.mat.uniforms.uIntensity.value = p.groundFlashIntensity;
      bolt.flash.mat.uniforms.uRadialPow.value = p.groundFlashRadialPow;
      bolt.flash.mat.uniforms.uFadePow.value = p.groundFlashFadePow;
      bolt.flash.mat.uniforms.uColor.value.set(p.groundFlashColor);

      if (bolt.cracks) {
        bolt.cracks.material.uniforms.uTime.value = elapsed;
        bolt.cracks.material.uniforms.uRevealDur.value = p.crackReveal;
        bolt.cracks.material.uniforms.uFadeDur.value = p.crackFade;
        bolt.cracks.material.uniforms.uCoreColor.value.set(p.crackCoreColor);
        bolt.cracks.material.uniforms.uMidColor.value.set(p.crackMidColor);
        bolt.cracks.material.uniforms.uEdgeColor.value.set(p.crackEdgeColor);
      }

      bolt.sparks.mat.uniforms.uTime.value = elapsed;
      bolt.sparks.mat.uniforms.uSize.value = p.sparkSize;
      bolt.sparks.mat.uniforms.uGravity.value = p.sparkGravity;
      bolt.sparks.mat.uniforms.uDepthScale.value = p.sparkDepthScale;

      bolt.shockwave.mat.uniforms.uTime.value = elapsed;
      bolt.shockwave.mat.uniforms.uDur.value = p.shockwaveDur;
      bolt.shockwave.mat.uniforms.uAlphaMult.value = p.shockwaveAlphaMult;
      bolt.shockwave.mat.uniforms.uColorA.value.set(p.shockwaveColorA);
      bolt.shockwave.mat.uniforms.uColorB.value.set(p.shockwaveColorB);

      // ── Debris physics (CPU, InstancedMesh) ───────────────────────────
      if (elapsed >= p.strikeDur && !bolt.debrisStarted) {
        bolt.debrisStarted = true;
        for (const s of bolt.debris.shards) s.active = true;
      }

      if (bolt.debrisStarted) {
        let matrixDirty = false;
        let colorDirty = false;

        for (const s of bolt.debris.shards) {
          if (!s.active) continue;
          s.t += dt;

          if (s.t >= s.lifetime) {
            // Hide expired shard by zeroing scale
            s.active = false;
            dummy.position.copy(s.pos);
            dummy.rotation.copy(s.rotEuler);
            dummy.scale.set(0, 0, 0);
            dummy.updateMatrix();
            bolt.debris.instanced.setMatrixAt(s.index, dummy.matrix);
            matrixDirty = true;
            continue;
          }

          // Physics integration
          s.pos.x += s.vx * dt;
          s.pos.z += s.vz * dt;
          s.vy -= p.debrisGravity * dt;
          s.pos.y = Math.max(s.groundY + 0.05, s.pos.y + s.vy * dt);

          s.rotEuler.x += s.rx * dt;
          s.rotEuler.y += s.ry * dt;
          s.rotEuler.z += s.rz * dt;

          dummy.position.copy(s.pos);
          dummy.rotation.copy(s.rotEuler);
          dummy.scale.set(s.baseScaleX, s.baseScaleY, 1);
          dummy.updateMatrix();
          bolt.debris.instanced.setMatrixAt(s.index, dummy.matrix);
          matrixDirty = true;

          // Encode fade in instanceColor (additive blend → color scale = opacity)
          const life = s.t / s.lifetime;
          const fade = Math.max(
            0,
            (1 - Math.pow(life, p.debrisFadePower)) * p.debrisFadeMult,
          );
          fadeColor.copy(s.baseColor).multiplyScalar(fade);
          bolt.debris.instanced.setColorAt(s.index, fadeColor);
          colorDirty = true;
        }

        if (matrixDirty)
          bolt.debris.instanced.instanceMatrix.needsUpdate = true;
        if (colorDirty) bolt.debris.instanced.instanceColor.needsUpdate = true;
      }

      if (elapsed > maxD) {
        // Cleanup GPU resources
        this.scene.remove(bolt.boltMesh.mesh);
        bolt.boltMesh.material.dispose();
        bolt.boltMesh.geometry.dispose();

        this.scene.remove(bolt.flash.mesh);
        bolt.flash.mat.dispose();

        if (bolt.cracks) {
          this.scene.remove(bolt.cracks.mesh);
          bolt.cracks.material.dispose();
          bolt.cracks.geometry.dispose();
        }

        if (bolt.sparks) {
          this.scene.remove(bolt.sparks.mesh);
          bolt.sparks.mat.dispose();
          bolt.sparks.geo.dispose();
        }

        if (bolt.shockwave) {
          this.scene.remove(bolt.shockwave.mesh);
          bolt.shockwave.mat.dispose();
        }

        this.scene.remove(bolt.debris.instanced);
        bolt.debris.material.dispose();
        // NOTE: _debrisSharedGeo is shared — disposed only in clear()

        this.activeBolts.splice(i, 1);
      }
    }
  }

  clear() {
    for (const bolt of this.activeBolts) {
      this.scene.remove(bolt.boltMesh.mesh);
      bolt.boltMesh.material.dispose();
      bolt.boltMesh.geometry.dispose();

      this.scene.remove(bolt.flash.mesh);
      bolt.flash.mat.dispose();

      if (bolt.cracks) {
        this.scene.remove(bolt.cracks.mesh);
        bolt.cracks.material.dispose();
        bolt.cracks.geometry.dispose();
      }

      if (bolt.sparks) {
        this.scene.remove(bolt.sparks.mesh);
        bolt.sparks.mat.dispose();
        bolt.sparks.geo.dispose();
      }

      if (bolt.shockwave) {
        this.scene.remove(bolt.shockwave.mesh);
        bolt.shockwave.mat.dispose();
      }

      this.scene.remove(bolt.debris.instanced);
      bolt.debris.material.dispose();
    }
    this.activeBolts.length = 0;

    // Dispose shared geometry
    this._debrisSharedGeo.dispose();
  }
}

class LightningWorld {
  constructor({ scene, params }) {
    this.scene = scene;
    this.params = params;

    this.ground = null;
    this.grid = null;
    this.rings = [];

    this.ambient = new THREE.AmbientLight(0xffffff, params.ambientIntensity);
    this.dir = new THREE.DirectionalLight(0xffffff, params.dirIntensity);
    this.dir.position.set(15, 30, 10);
    this.hemi = new THREE.HemisphereLight(
      params.hemiSkyColor,
      params.hemiGroundColor,
      params.hemiIntensity,
    );

    this.scene.add(this.ambient, this.dir, this.hemi);

    this.buildTerrain();
  }

  buildTerrain() {
    const p = this.params;

    // Ground
    const groundGeo = new THREE.PlaneGeometry(p.groundSize, p.groundSize);
    const groundMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(p.groundColor),
      roughness: p.groundRoughness,
      metalness: p.groundMetalness,
    });
    this.ground = new THREE.Mesh(groundGeo, groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = 0;
    this.scene.add(this.ground);

    // Grid
    this.grid = new THREE.GridHelper(
      p.gridSize,
      p.gridDivisions,
      p.gridColor,
      p.gridColorAlt,
    );
    this.grid.position.y = 0.01;
    this.scene.add(this.grid);

    // Rings
    this.rings.forEach((r) => this.scene.remove(r));
    this.rings.length = 0;

    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(p.ringColor),
      transparent: true,
      opacity: p.ringOpacity,
      side: THREE.DoubleSide,
    });

    for (let i = 0; i < p.ringCount; i++) {
      const r0 = p.ringBase + i * p.ringStep;
      const geo = new THREE.RingGeometry(
        r0 - p.ringThickness,
        r0 + p.ringThickness,
        96,
      );
      const mesh = new THREE.Mesh(geo, ringMat.clone());
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.015;
      this.scene.add(mesh);
      this.rings.push(mesh);
    }
  }

  updateParams(next) {
    this.params = next;
    const p = next;

    // Scene background is handled by LightningApp.
    // Lights:
    this.ambient.intensity = p.ambientIntensity;
    this.dir.intensity = p.dirIntensity;
    this.hemi.intensity = p.hemiIntensity;
    this.hemi.color.set(p.hemiSkyColor);
    this.hemi.groundColor.set(p.hemiGroundColor);

    // Terrain changes need rebuild.
    this.scene.remove(this.grid);
    this.scene.remove(this.ground);
    this.rings.forEach((r) => this.scene.remove(r));
    this.rings.length = 0;
    this.buildTerrain();
  }
}

class LightningApp {
  constructor() {
    this.params = this.getDefaultParams();

    this.ui = new LightningUI();
    this.worldScene = new THREE.Scene();

    this.worldScene.fog = new THREE.Fog(
      this.params.backgroundColor,
      this.params.fogNear,
      this.params.fogFar,
    );
    this.worldScene.background = new THREE.Color(this.params.backgroundColor);

    // Camera
    const { width, height } = this.getSizes();
    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 400);
    this.camera.position.set(0, 9, 0);
    this.worldScene.add(this.camera);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
    });
    this.renderer.setClearColor(this.params.backgroundColor);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);

    // World (ground/grid/lights)
    this.world = new LightningWorld({
      scene: this.worldScene,
      params: this.params,
    });

    // Effect system
    this.effect = new LightningEffect({
      scene: this.worldScene,
      camera: this.camera,
      ui: this.ui,
      params: this.params,
    });

    // Let effect request shake via UI (small wiring convenience)
    this.ui.shakeCamera = (intensity) => this.shakeCamera(intensity);

    // Input
    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.bindInput();

    // Stats
    this.lastT = performance.now();
    this.frameCount = 0;
    this.fpsSmooth = 60;

    // Camera orbit state
    this.camAngle = 0;
    this.camShake = { x: 0, y: 0, decay: 0 };

    // Auto storm state
    this.autoRunning = false;
    this.autoTimer = null;

    // GUI
    this.gui = new GUI({ title: 'Lightning Controls' });
    this.buildGUI();

    // Initial UI
    this.ui.setStatus('Idle — click scene to strike', false);

    window.addEventListener('resize', () => this.handleResize());

    this.animate();
  }

  getSizes() {
    return { width: window.innerWidth, height: window.innerHeight };
  }

  shakeCamera(intensity) {
    const p = this.params;
    this.camShake.x = (Math.random() - 0.5) * intensity * p.shakeXMult;
    this.camShake.y = (Math.random() - 0.5) * intensity * p.shakeYMult;
    this.camShake.decay = p.shakeDecay;
  }

  bindInput() {
    this.ui.bindHandlers({
      onSingle: () => {
        this.spawnRandom();
      },
      onToggleAuto: () => {
        this.toggleAuto();
      },
    });

    canvas.addEventListener('click', (e) => {
      const p = this.params;
      const { width: W, height: H } = this.getSizes();
      const nx = (e.clientX / W) * 2 - 1;
      const ny = -(e.clientY / H) * 2 + 1;

      this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
      const hit = new THREE.Vector3();
      const ok = this.raycaster.ray.intersectPlane(this.plane, hit);

      if (ok && !this.isTooCloseToCamera(hit.x, hit.z)) {
        this.effect.spawnAt(hit.x, hit.z, performance.now() / 1000);
        if (!this.autoRunning) {
          this.ui.setStatus('Strike emitted', true);
          window.setTimeout(() => {
            if (!this.autoRunning)
              this.ui.setStatus('Idle — click scene to strike', false);
          }, 1200);
        }
      }
    });
  }

  isTooCloseToCamera(cx, cz) {
    const camX = Math.cos(this.camAngle) * this.params.cameraRadius;
    const camZ = Math.sin(this.camAngle) * this.params.cameraRadius;
    const dx = cx - camX;
    const dz = cz - camZ;
    return (
      dx * dx + dz * dz <
      this.params.tooCloseRadius * this.params.tooCloseRadius
    );
  }

  spawnRandom() {
    const p = this.params;
    let cx = 0;
    let cz = 0;
    let tries = 0;
    do {
      const a = Math.random() * Math.PI * 2;
      const d =
        p.spawnRadialMin +
        Math.random() * (p.spawnRadialMax - p.spawnRadialMin);
      cx = Math.cos(a) * d;
      cz = Math.sin(a) * d;
      tries++;
    } while (this.isTooCloseToCamera(cx, cz) && tries < 40);

    const nowSec = performance.now() / 1000;
    this.effect.spawnAt(cx, cz, nowSec);

    if (!this.autoRunning) {
      this.ui.setStatus('Strike emitted', true);
      window.setTimeout(() => {
        if (!this.autoRunning)
          this.ui.setStatus('Idle — click scene to strike', false);
      }, 1200);
    }
  }

  toggleAuto() {
    if (this.autoRunning) {
      this.autoRunning = false;
      if (this.autoTimer) clearTimeout(this.autoTimer);
      this.autoTimer = null;
      this.ui.setAutoRunning(false);
      this.ui.setStatus('Idle — click scene to strike', false);
      return;
    }

    this.autoRunning = true;
    this.ui.setAutoRunning(true);
    this.ui.setStatus('Auto storm running…', true);
    this.spawnRandom();

    const scheduleNext = (delay) => {
      this.autoTimer = setTimeout(() => {
        this.spawnRandom();
        const nextDelay =
          this.params.autoNextDelayMin +
          Math.random() *
            (this.params.autoNextDelayMax - this.params.autoNextDelayMin);
        scheduleNext(nextDelay);
      }, delay);
    };

    const initialDelay =
      this.params.autoInitialDelayMin +
      Math.random() *
        (this.params.autoInitialDelayMax - this.params.autoInitialDelayMin);
    scheduleNext(initialDelay);
  }

  handleResize() {
    const { width, height } = this.getSizes();
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  updateFps(now) {
    const dt = Math.min((now - this.lastT) / 1000, 0.05);
    this.lastT = now;
    const instFps = 1 / dt;
    this.fpsSmooth += (instFps - this.fpsSmooth) * 0.05;
    this.frameCount++;

    if (this.frameCount % 10 === 0) {
      const { active, strikes } = this.effect.getStats();
      this.ui.setStats({
        fps: Math.round(this.fpsSmooth),
        active,
        strikes,
      });
    }
    return dt;
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    const now = performance.now();
    const dt = Math.min((now - this.lastT) / 1000, 0.05);
    // Keep internal dt aligned with updateFps smoothing.
    this.lastT = now;
    this.frameCount++;

    const nowSec = now / 1000;

    // FPS update
    const instFps = 1 / dt;
    this.fpsSmooth += (instFps - this.fpsSmooth) * 0.05;
    if (this.frameCount % 10 === 0) {
      const { active, strikes } = this.effect.getStats();
      this.ui.setStats({
        fps: Math.round(this.fpsSmooth),
        active,
        strikes,
      });
    }

    // Camera orbit + shake
    const p = this.params;
    this.camAngle += dt * p.cameraOrbitSpeed;
    const camBase = new THREE.Vector3(
      Math.cos(this.camAngle) * p.cameraRadius,
      p.cameraHeight,
      Math.sin(this.camAngle) * p.cameraRadius,
    );

    if (Math.abs(this.camShake.x) > 0.0001) {
      camBase.x += this.camShake.x;
      camBase.y += this.camShake.y;
      this.camShake.x *= this.camShake.decay;
      this.camShake.y *= this.camShake.decay;
    }

    this.camera.position.copy(camBase);
    this.camera.lookAt(0, 0, 0);

    // Update effects
    this.effect.update(dt, nowSec);
    this.ui.updateFlash(nowSec, {
      overlayMaxAlpha: p.overlayMaxAlpha,
      overlayDecay: p.overlayDecay,
      overlayTint: p.overlayTint,
    });

    this.renderer.render(this.worldScene, this.camera);
  }

  buildGUI() {
    const gui = this.gui;

    // Actions
    const actions = {
      emitSingle: () => this.spawnRandom(),
      toggleAuto: () => this.toggleAuto(),
      clearBolts: () => this.effect.clear(),
    };
    gui.add(actions, 'emitSingle').name('Emit Single');
    gui.add(actions, 'toggleAuto').name('Start/Stop Auto');
    gui.add(actions, 'clearBolts').name('Clear Bolts');

    const fCamera = gui.addFolder('Camera').close();
    fCamera
      .add(this.params, 'cameraOrbitSpeed', 0, 0.2, 0.001)
      .name('Orbit Speed');
    fCamera.add(this.params, 'cameraRadius', 10, 60, 0.1).name('Radius');
    fCamera.add(this.params, 'cameraHeight', 2, 30, 0.1).name('Height');
    fCamera
      .add(this.params, 'shakeOnStrike', 0, 1.5, 0.01)
      .name('Shake Intensity');
    fCamera.add(this.params, 'shakeXMult', 0, 0.12, 0.001).name('Shake X Mult');
    fCamera.add(this.params, 'shakeYMult', 0, 0.1, 0.001).name('Shake Y Mult');
    fCamera
      .add(this.params, 'shakeDecay', 0.7, 0.98, 0.001)
      .name('Shake Decay');

    const fSpawn = gui.addFolder('Spawning').close();
    fSpawn.add(this.params, 'spawnRadialMin', 0, 30, 0.1).name('Min Distance');
    fSpawn.add(this.params, 'spawnRadialMax', 10, 70, 0.1).name('Max Distance');
    fSpawn
      .add(this.params, 'tooCloseRadius', 1, 25, 0.1)
      .name('Too Close Radius');
    fSpawn
      .add(this.params, 'spawnHeightMin', 5, 30, 0.1)
      .name('Bolt Height Min');
    fSpawn
      .add(this.params, 'spawnHeightMax', 10, 40, 0.1)
      .name('Bolt Height Max');
    fSpawn
      .add(this.params, 'roughnessMin', 0.1, 1.0, 0.001)
      .name('Roughness Min');
    fSpawn
      .add(this.params, 'roughnessMax', 0.1, 1.0, 0.001)
      .name('Roughness Max');
    fSpawn
      .add(this.params, 'spawnTopXZJitter', 0.1, 4, 0.01)
      .name('Top Jitter');

    fSpawn.add(this.params, 'branchCountMin', 0, 5, 1).name('Branches Min');
    fSpawn.add(this.params, 'branchCountMax', 0, 6, 1).name('Branches Max');
    fSpawn.add(this.params, 'branchFFMin', 0.0, 0.9, 0.001).name('FF Min');
    fSpawn.add(this.params, 'branchFFMax', 0.0, 0.9, 0.001).name('FF Max');
    fSpawn
      .add(this.params, 'branchLengthFactorMin', 0.05, 1.5, 0.001)
      .name('Drop Len Min');
    fSpawn
      .add(this.params, 'branchLengthFactorMax', 0.05, 1.8, 0.001)
      .name('Drop Len Max');
    fSpawn
      .add(this.params, 'branchDropFactorMin', 0.1, 1.8, 0.001)
      .name('Drop Min');
    fSpawn
      .add(this.params, 'branchDropFactorMax', 0.1, 2.0, 0.001)
      .name('Drop Max');
    fSpawn
      .add(this.params, 'branchEndYJitter', 0, 10, 0.1)
      .name('End Y Jitter');
    fSpawn
      .add(this.params, 'branchMinYClampOffset', 0.0, 3.0, 0.01)
      .name('Min Y Clamp');
    fSpawn
      .add(this.params, 'branchXZScaleX', 0.0, 2.0, 0.01)
      .name('Branch X Scale');
    fSpawn
      .add(this.params, 'branchXZScaleZ', 0.0, 2.0, 0.01)
      .name('Branch Z Scale');

    const fBolt = gui.addFolder('Bolt').close();
    fBolt.add(this.params, 'strikeDur', 0.03, 0.3, 0.001).name('Strike Dur');
    fBolt.add(this.params, 'fadeDur', 0.1, 2.5, 0.01).name('Fade Dur');
    fBolt.add(this.params, 'tailExtra', 0, 0.6, 0.01).name('Tail Extra');
    fBolt.add(this.params, 'impactExtra', 0, 2.0, 0.01).name('Impact Extra');
    fBolt.add(this.params, 'boltSpread', 0, 0.05, 0.0005).name('Bolt Spread');

    const fLayers = fBolt.addFolder('Layers').close();
    this.params.layers.forEach((layer, idx) => {
      const f = fLayers.addFolder(`Layer ${idx + 1}`);
      f.addColor(layer, 'color')
        .name('Color')
        .onChange(() => this.syncEffectParams());
      f.add(layer, 'thick', 0.001, 1.0, 0.001).name('Thickness');
      f.add(layer, 'alpha', 0.0, 2.0, 0.001).name('Alpha');
    });
    fBolt
      .add(this.params, 'mainStrandThickMult', 0.0, 2.0, 0.01)
      .name('Main Thick Mult');
    fBolt
      .add(this.params, 'mainStrandAlphaMult', 0.0, 2.0, 0.01)
      .name('Main Alpha Mult');
    fBolt
      .add(this.params, 'altFractalDepth', 1, 8, 1)
      .name('Alt Fractal Depth');
    fBolt
      .add(this.params, 'altRoughnessMult', 0.3, 1.5, 0.001)
      .name('Alt Roughness Mult');
    fBolt
      .add(this.params, 'mainFractalDepth', 1, 9, 1)
      .name('Main Fractal Depth');
    fBolt
      .add(this.params, 'altStrandThickMult', 0.0, 2.0, 0.01)
      .name('Alt Thick Mult');
    fBolt
      .add(this.params, 'altStrandAlphaMult', 0.0, 2.0, 0.01)
      .name('Alt Alpha Mult');

    const fCracks = gui.addFolder('Cracks').close();
    fCracks.add(this.params, 'crackReveal', 0.05, 0.5, 0.001).name('Reveal');
    fCracks.add(this.params, 'crackFade', 0.1, 6.0, 0.01).name('Fade');
    fCracks.addColor(this.params, 'crackCoreColor').name('Core Color');
    fCracks.addColor(this.params, 'crackMidColor').name('Mid Color');
    fCracks.addColor(this.params, 'crackEdgeColor').name('Edge Color');
    fCracks.add(this.params, 'crackCountMin', 0, 20, 1).name('Count Min');
    fCracks.add(this.params, 'crackCountMax', 0, 30, 1).name('Count Max');
    fCracks.add(this.params, 'crackBranchDepth', 0, 4, 1).name('Branch Depth');
    fCracks
      .add(this.params, 'crackBranchChance', 0, 1, 0.01)
      .name('Branch Chance');
    fCracks
      .add(this.params, 'crackRoughness', 0.05, 2.0, 0.001)
      .name('Roughness');
    fCracks
      .add(this.params, 'crackOriginYOffset', 0.0, 0.2, 0.001)
      .name('Origin Y Offset');
    fCracks
      .add(this.params, 'crackAngleJitter', 0.0, 2.0, 0.01)
      .name('Angle Jitter');
    fCracks
      .add(this.params, 'crackLengthMin', 0.0, 2.0, 0.01)
      .name('Length Min');
    fCracks
      .add(this.params, 'crackLengthMax', 0.0, 8.0, 0.01)
      .name('Length Max');
    fCracks
      .add(this.params, 'crackBranchAngleOffsetMin', 0.0, 2.0, 0.01)
      .name('Branch Angle Min');
    fCracks
      .add(this.params, 'crackBranchAngleOffsetMax', 0.0, 2.5, 0.01)
      .name('Branch Angle Max');
    fCracks
      .add(this.params, 'crackBranchLengthScaleMin', 0.0, 1.0, 0.01)
      .name('Branch Len Scale Min');
    fCracks
      .add(this.params, 'crackBranchLengthScaleMax', 0.0, 1.5, 0.01)
      .name('Branch Len Scale Max');
    fCracks.add(this.params, 'crackBranchStepsMin', 1, 20, 1).name('Steps Min');
    fCracks.add(this.params, 'crackBranchStepsMax', 1, 30, 1).name('Steps Max');
    fCracks.add(this.params, 'crackThinHW', 0.005, 0.08, 0.001).name('Thin HW');
    fCracks
      .add(this.params, 'crackThinAlpha', 0.0, 1.5, 0.01)
      .name('Thin Alpha');
    fCracks.add(this.params, 'crackThickHW', 0.01, 0.2, 0.001).name('Thick HW');
    fCracks
      .add(this.params, 'crackThickAlpha', 0.0, 2.5, 0.01)
      .name('Thick Alpha');
    fCracks
      .add(this.params, 'crackThickFadeMult', 0.1, 2.0, 0.01)
      .name('Thick Fade Mult');

    const fSparks = gui.addFolder('Sparks').close();
    fSparks.add(this.params, 'sparkCountMin', 0, 60, 1).name('Count Min');
    fSparks.add(this.params, 'sparkCountMax', 0, 80, 1).name('Count Max');
    fSparks.add(this.params, 'sparkSize', 0.1, 8, 0.1).name('Point Size');
    fSparks.add(this.params, 'sparkGravity', 1, 30, 0.1).name('Gravity');
    fSparks.add(this.params, 'sparkDepthScale', 10, 400, 1).name('Depth Scale');
    fSparks
      .add(this.params, 'sparkPosJitter', 0.0, 1.0, 0.01)
      .name('Pos Jitter');
    fSparks
      .add(this.params, 'sparkPosYOffset', 0.0, 0.5, 0.01)
      .name('Pos Y Offset');
    fSparks.add(this.params, 'sparkVelocitySpdMin', 0, 10, 0.1).name('Spd Min');
    fSparks.add(this.params, 'sparkVelocitySpdMax', 0, 12, 0.1).name('Spd Max');
    fSparks.add(this.params, 'sparkVelocityUpMin', 0, 10, 0.1).name('Up Min');
    fSparks.add(this.params, 'sparkVelocityUpMax', 0, 12, 0.1).name('Up Max');
    fSparks.add(this.params, 'sparkLifeMin', 0.0, 2.0, 0.01).name('Life Min');
    fSparks.add(this.params, 'sparkLifeMax', 0.0, 3.0, 0.01).name('Life Max');

    const fShock = gui.addFolder('Shockwave').close();
    fShock.add(this.params, 'shockwaveDur', 0.1, 2.0, 0.01).name('Dur');
    fShock
      .add(this.params, 'shockwaveAlphaMult', 0.0, 2.0, 0.01)
      .name('Alpha Mult');
    fShock
      .addColor(this.params, 'shockwaveColorA')
      .name('Color A')
      .onChange(() => this.syncEffectParams());
    fShock
      .addColor(this.params, 'shockwaveColorB')
      .name('Color B')
      .onChange(() => this.syncEffectParams());

    const fDebris = gui.addFolder('Debris').close();
    fDebris.add(this.params, 'debrisCountMin', 0, 20, 1).name('Count Min');
    fDebris.add(this.params, 'debrisCountMax', 0, 30, 1).name('Count Max');
    fDebris
      .add(this.params, 'debrisBaseYOffset', 0.0, 0.5, 0.01)
      .name('Base Y Offset');
    fDebris
      .add(this.params, 'debrisLifetimeMin', 0.0, 2.0, 0.01)
      .name('Life Min');
    fDebris
      .add(this.params, 'debrisLifetimeMax', 0.0, 3.0, 0.01)
      .name('Life Max');
    fDebris.add(this.params, 'debrisGravity', 0.0, 60, 0.5).name('Gravity');
    fDebris
      .add(this.params, 'debrisFadePower', 0.1, 5.0, 0.1)
      .name('Fade Power');
    fDebris
      .add(this.params, 'debrisFadeMult', 0.0, 1.5, 0.01)
      .name('Fade Mult');
    fDebris
      .add(this.params, 'debrisVelocitySpdMin', 0.0, 10, 0.1)
      .name('Spd Min');
    fDebris
      .add(this.params, 'debrisVelocitySpdMax', 0.0, 10, 0.1)
      .name('Spd Max');
    fDebris
      .add(this.params, 'debrisVelocityUpMin', 0.0, 10, 0.1)
      .name('Up Min');
    fDebris
      .add(this.params, 'debrisVelocityUpMax', 0.0, 10, 0.1)
      .name('Up Max');
    fDebris
      .add(this.params, 'debrisRotationScale', 0.0, 25, 0.1)
      .name('Rot Scale');
    fDebris
      .add(this.params, 'debrisBlueChance', 0.0, 1.0, 0.01)
      .name('Blue Chance');
    fDebris
      .add(this.params, 'debrisBlueHueMin', 0.3, 0.95, 0.001)
      .name('Blue Hue Min');
    fDebris
      .add(this.params, 'debrisBlueHueMax', 0.3, 1.1, 0.001)
      .name('Blue Hue Max');
    fDebris.add(this.params, 'debrisBlueSat', 0.0, 1.0, 0.01).name('Blue Sat');
    fDebris
      .add(this.params, 'debrisBlueLightMin', 0.0, 1.0, 0.01)
      .name('Blue Light Min');
    fDebris
      .add(this.params, 'debrisBlueLightMax', 0.0, 1.2, 0.01)
      .name('Blue Light Max');
    fDebris
      .add(this.params, 'debrisWMin', 0.02, 0.4, 0.01)
      .name('Debris W Min');
    fDebris
      .add(this.params, 'debrisWMax', 0.02, 0.6, 0.01)
      .name('Debris W Max');
    fDebris
      .add(this.params, 'debrisHMin', 0.01, 0.3, 0.01)
      .name('Debris H Min');
    fDebris
      .add(this.params, 'debrisHMax', 0.01, 0.4, 0.01)
      .name('Debris H Max');

    fDebris
      .add(this.params, 'debrisWarmRMin', 0.0, 1.0, 0.01)
      .name('Warm R Min');
    fDebris
      .add(this.params, 'debrisWarmRMax', 0.0, 1.0, 0.01)
      .name('Warm R Max');
    fDebris
      .add(this.params, 'debrisWarmGMin', 0.0, 1.0, 0.01)
      .name('Warm G Min');
    fDebris
      .add(this.params, 'debrisWarmGMax', 0.0, 1.0, 0.01)
      .name('Warm G Max');
    fDebris
      .add(this.params, 'debrisWarmBMin', 0.0, 1.0, 0.01)
      .name('Warm B Min');
    fDebris
      .add(this.params, 'debrisWarmBMax', 0.0, 1.0, 0.01)
      .name('Warm B Max');

    const fFlash = gui.addFolder('Flash Overlay').close();
    fFlash.addColor(this.params, 'overlayTint').name('Tint');
    fFlash
      .add(this.params, 'overlayMaxAlpha', 0.0, 0.8, 0.01)
      .name('Max Alpha');
    fFlash.add(this.params, 'overlayDecay', 1.0, 60, 0.5).name('Decay');

    const fGround = gui.addFolder('Ground Flash').close();
    fGround.add(this.params, 'groundFlashDur', 0.05, 1.2, 0.01).name('Dur');
    fGround
      .add(this.params, 'groundFlashIntensity', 0.01, 1.0, 0.01)
      .name('Intensity');
    fGround
      .add(this.params, 'groundFlashRadialPow', 0.2, 6.0, 0.1)
      .name('Radial Pow');
    fGround
      .add(this.params, 'groundFlashFadePow', 0.2, 6.0, 0.1)
      .name('Fade Pow');
    fGround.add(this.params, 'groundFlashSize', 1, 12, 0.1).name('Size');
    fGround.addColor(this.params, 'groundFlashColor').name('Color');

    const fAuto = gui.addFolder('Storm').close();
    fAuto
      .add(this.params, 'autoInitialDelayMin', 0, 12000, 50)
      .name('Initial Min');
    fAuto
      .add(this.params, 'autoInitialDelayMax', 0, 15000, 50)
      .name('Initial Max');
    fAuto.add(this.params, 'autoNextDelayMin', 0, 12000, 50).name('Next Min');
    fAuto.add(this.params, 'autoNextDelayMax', 0, 15000, 50).name('Next Max');

    const fWorld = gui.addFolder('World').close();
    fWorld
      .add(this.params, 'groundSize', 100, 700, 1)
      .name('Ground Size')
      .onChange(() => this.syncWorld());
    fWorld
      .add(this.params, 'gridSize', 50, 600, 1)
      .name('Grid Size')
      .onChange(() => this.syncWorld());
    fWorld
      .add(this.params, 'gridDivisions', 10, 120, 1)
      .name('Grid Divisions')
      .onChange(() => this.syncWorld());
    fWorld
      .addColor({ color: this.params.gridColor }, 'color')
      .name('Grid Color')
      .onChange((v) => {
        this.params.gridColor = v;
        this.syncWorld();
      });
    fWorld
      .addColor({ color: this.params.gridColorAlt }, 'color')
      .name('Grid Alt Color')
      .onChange((v) => {
        this.params.gridColorAlt = v;
        this.syncWorld();
      });
    fWorld
      .addColor(this.params, 'groundColor')
      .name('Ground Color')
      .onChange(() => this.syncWorld());
    fWorld
      .add(this.params, 'groundRoughness', 0.0, 2.0, 0.01)
      .name('Ground Roughness')
      .onChange(() => this.syncWorld());
    fWorld
      .add(this.params, 'groundMetalness', 0.0, 1.0, 0.01)
      .name('Ground Metalness')
      .onChange(() => this.syncWorld());
    fWorld
      .add(this.params, 'ringCount', 0, 8, 1)
      .name('Ring Count')
      .onChange(() => this.syncWorld());
    fWorld
      .add(this.params, 'ringBase', 1, 60, 1)
      .name('Ring Base')
      .onChange(() => this.syncWorld());
    fWorld
      .add(this.params, 'ringStep', 1, 30, 0.5)
      .name('Ring Step')
      .onChange(() => this.syncWorld());
    fWorld
      .add(this.params, 'ringThickness', 0.01, 0.3, 0.005)
      .name('Ring Thickness')
      .onChange(() => this.syncWorld());
    fWorld
      .add(this.params, 'ringOpacity', 0.0, 1.0, 0.01)
      .name('Ring Opacity')
      .onChange(() => this.syncWorld());
    fWorld
      .addColor(this.params, 'ringColor')
      .name('Ring Color')
      .onChange(() => this.syncWorld());
    fWorld
      .add(this.params, 'ambientIntensity', 0.0, 2.0, 0.01)
      .name('Ambient Intensity');
    fWorld
      .add(this.params, 'dirIntensity', 0.0, 2.0, 0.01)
      .name('Directional Intensity');
    fWorld
      .add(this.params, 'hemiIntensity', 0.0, 2.0, 0.01)
      .name('Hemisphere Intensity');
    fWorld.addColor(this.params, 'hemiSkyColor').name('Hemi Sky Color');
    fWorld.addColor(this.params, 'hemiGroundColor').name('Hemi Ground Color');
    fWorld
      .addColor(this.params, 'backgroundColor')
      .name('Background Color')
      .onChange(() => this.syncWorld());
    fWorld
      .add(this.params, 'fogNear', 1, 120, 1)
      .name('Fog Near')
      .onChange(() => this.syncWorld());
    fWorld
      .add(this.params, 'fogFar', 10, 400, 1)
      .name('Fog Far')
      .onChange(() => this.syncWorld());
  }

  syncEffectParams() {
    this.effect.setParams(this.params);
  }

  syncWorld() {
    // Update scene background/fog and rebuild terrain.
    this.worldScene.background = new THREE.Color(this.params.backgroundColor);
    this.worldScene.fog = new THREE.Fog(
      this.params.backgroundColor,
      this.params.fogNear,
      this.params.fogFar,
    );
    this.renderer.setClearColor(this.params.backgroundColor);
    this.world.updateParams(this.params);
    this.syncEffectParams();
  }

  getDefaultParams() {
    return {
      // Scene
      backgroundColor: '#111111',
      fogNear: 55,
      fogFar: 160,
      groundSize: 400,
      gridSize: 300,
      gridDivisions: 60,
      gridColor: '#383838',
      gridColorAlt: '#262626',

      groundColor: '#1c1c1c',
      groundRoughness: 1.0,
      groundMetalness: 0.0,

      ringCount: 4,
      ringBase: 8,
      ringStep: 8,
      ringThickness: 0.06,
      ringColor: '#3a3a3a',
      ringOpacity: 0.5,

      ambientIntensity: 0.28,
      dirIntensity: 0.22,
      hemiSkyColor: '#282828',
      hemiGroundColor: '#101010',
      hemiIntensity: 0.35,

      // Camera / shake
      cameraOrbitSpeed: 0,
      cameraRadius: 28,
      cameraHeight: 11,
      shakeOnStrike: 1.2,
      shakeXMult: 1.7,
      shakeYMult: 1.5,
      shakeDecay: 0.88,
      tooCloseRadius: 10,

      // Spawn
      spawnRadialMin: 8,
      spawnRadialMax: 38,
      spawnHeightMin: 15,
      spawnHeightMax: 24,
      spawnTopXZJitter: 1.5,
      roughnessMin: 0.42,
      roughnessMax: 0.58,

      mainFractalDepth: 6,
      altFractalDepth: 4,
      altRoughnessMult: 0.85,

      branchCountMin: 1,
      branchCountMax: 3,
      branchFFMin: 0.12,
      branchFFMax: 0.67,
      branchLengthFactorMin: 0.22,
      branchLengthFactorMax: 0.54,
      branchDropFactorMin: 0.55,
      branchDropFactorMax: 0.9,
      branchEndYJitter: 3,
      branchMinYClampOffset: 0.5,
      branchXZScaleX: 0.65,
      branchXZScaleZ: 0.45,

      // Bolt shape multipliers
      mainStrandThickMult: 1.5,
      mainStrandAlphaMult: 1.0,
      altStrandThickMult: 0.55,
      altStrandAlphaMult: 0.75,

      // Bolt shader controls
      strikeDur: 0.15,
      fadeDur: 1.0,
      tailExtra: 0.15,
      impactExtra: 0.5,
      boltSpread: 0.01,

      layers: [
        { color: '#4764e1', thick: 0.34, alpha: 0.18 },
        { color: '#1072bd', thick: 0.13, alpha: 0.55 },
        { color: '#aceeff', thick: 0.038, alpha: 1.0 },
      ],

      // Crack params
      crackReveal: 0.22,
      crackFade: 2.8,
      crackCoreColor: '#1086c1',
      crackMidColor: '#1088bc',
      crackEdgeColor: '#4791e1',
      crackCountMin: 4,
      crackCountMax: 7,
      crackBranchDepth: 2,
      crackBranchChance: 0.72,
      crackRoughness: 0.725,
      crackOriginYOffset: 0.025,
      crackAngleJitter: 0.8,
      crackLengthMin: 0.4,
      crackLengthMax: 3.9,
      crackBranchAngleOffsetMin: 0.55,
      crackBranchAngleOffsetMax: 1.45,
      crackBranchLengthScaleMin: 0.3,
      crackBranchLengthScaleMax: 0.7,
      crackBranchStepsMin: 5,
      crackBranchStepsMax: 9,
      crackThinHW: 0.025,
      crackThinAlpha: 0.55,
      crackThickHW: 0.08,
      crackThickAlpha: 1.0,
      crackThickFadeMult: 0.6,

      // Sparks params
      sparkCountMin: 30,
      sparkCountMax: 40,
      sparkSize: 2.5,
      sparkGravity: 9.5,
      sparkDepthScale: 160,
      sparkPosJitter: 0.3,
      sparkPosYOffset: 0.1,
      sparkVelocitySpdMin: 1,
      sparkVelocitySpdMax: 6,
      sparkVelocityUpMin: 1,
      sparkVelocityUpMax: 7,
      sparkLifeMin: 0.3,
      sparkLifeMax: 1.3,

      // Shockwave params
      shockwaveDur: 0.55,
      shockwaveAlphaMult: 0.4,
      shockwaveColorA: '#ffb060',
      shockwaveColorB: '#66b3ff',

      // Debris params
      debrisCountMin: 3,
      debrisCountMax: 8,
      debrisBaseYOffset: 0.15,
      debrisLifetimeMin: 1,
      debrisLifetimeMax: 2.2,
      debrisGravity: 18,
      debrisFadePower: 2,
      debrisFadeMult: 0.85,
      debrisVelocitySpdMin: 1,
      debrisVelocitySpdMax: 3.5,
      debrisVelocityUpMin: 1,
      debrisVelocityUpMax: 4,
      debrisRotationScale: 8,
      debrisWMin: 0.08,
      debrisWMax: 0.33,
      debrisHMin: 0.04,
      debrisHMax: 0.16,

      // Debris color params
      debrisBlueChance: 0.65,
      debrisBlueHueMin: 0.6,
      debrisBlueHueMax: 0.68,
      debrisBlueSat: 0.6,
      debrisBlueLightMin: 0.55,
      debrisBlueLightMax: 0.8,

      // Warm RGB range for else-branch (tweakable)
      debrisWarmRMin: 0.3,
      debrisWarmRMax: 0.6,
      debrisWarmGMin: 0.3,
      debrisWarmGMax: 0.5,
      debrisWarmBMin: 0.3,
      debrisWarmBMax: 0.5,

      // Flash overlay (screen)
      overlayTint: '#6496ff',
      overlayMaxAlpha: 0.6,
      overlayDecay: 8,

      // Ground flash shader
      groundFlashDur: 0.45,
      groundFlashIntensity: 0.35,
      groundFlashRadialPow: 1.2,
      groundFlashFadePow: 1.5,
      groundFlashSize: 5,
      groundFlashColor: '#4db2ff',

      // Auto storm
      autoInitialDelayMin: 3000,
      autoInitialDelayMax: 7000,
      autoNextDelayMin: 3000,
      autoNextDelayMax: 8000,
    };
  }
}

new LightningApp();
