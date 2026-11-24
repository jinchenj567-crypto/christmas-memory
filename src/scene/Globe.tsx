import { useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { GLOBE_R, T, TREE_H, clock, easeOut, mobile, radiusAt, span } from './config'
import { POINT_SIZE, gauss, pointsMaterial, rng } from './uniforms'
import { enterGlobe } from './actions'
import { store } from '../store'
import { memories } from '../memories'

/**
 * The memory globe: a small lantern of clear crystal. A warm light lives inside it,
 * and through the glass you can already see the world it keeps — a thin horizon,
 * a far golden light and its reflection on still water. A few soft fireflies drift
 * inside; now and then a thread of gold dust leaves the tree and drifts into it.
 * The tree dazzles; the globe is gentle.
 */
export const globe = {
  world: new THREE.Vector3(2.4, 1.0, 0.9),
  radius: GLOBE_R,
  hover: 0,
  pulse: 0, // the ritual sets this when stardust arrives
  enter: 0, // 0..1 while the camera dives in
}

const R = GLOBE_R
const FIREFLIES = mobile ? 40 : 66
const GLINTS = mobile ? 16 : 24
const THREADS = mobile ? 26 : 46

// ---------------------------------------------------------------------------
// A few large, soft fireflies inside + a handful of glints on the glass
// ---------------------------------------------------------------------------
function buildMotes() {
  const r = rng(2412)
  const n = FIREFLIES + GLINTS
  const a = new Float32Array(n * 4)
  const b = new Float32Array(n * 4)
  const col = new Float32Array(n * 3)
  const warm = [new THREE.Color('#ffd796'), new THREE.Color('#ffc979'), new THREE.Color('#f6e7c9'), new THREE.Color('#e9eeff')]
  const c = new THREE.Color()
  const v = new THREE.Vector3()
  for (let i = 0; i < n; i++) {
    const glint = i >= FIREFLIES
    v.set(gauss(r), gauss(r), gauss(r)).normalize()
    if (glint) {
      v.lerp(new THREE.Vector3(-0.55, 0.65, 0.5), Math.pow(r(), 2) * 0.6).normalize().multiplyScalar(R * 0.995)
      c.copy(r() < 0.6 ? warm[3] : warm[2])
      b.set([0.0025 + r() * 0.0035, 0.45 + r() * 0.6, r(), 0], i * 4)
    } else {
      v.multiplyScalar(R * (0.2 + 0.55 * Math.pow(r(), 0.7)))
      c.copy(warm[r() < 0.55 ? 0 : r() < 0.7 ? 1 : 2])
      // fewer, larger and softer than the tree's glitter: lights kept, not sparkle
      b.set([0.022 + Math.pow(r(), 2) * 0.045, 0.3 + r() * 0.55, r(), 0.2 + r() * 0.35], i * 4)
    }
    // some of the inside lights are snow: small, pale, drifting down
    const snow = !glint && i % 5 < 2
    if (snow) {
      c.set('#f4f1ea')
      b.set([0.008 + r() * 0.008, 0.35 + r() * 0.3, r(), 0.5 + r() * 0.6], i * 4)
    }
    a.set([v.x, v.y, v.z, glint ? 1 : snow ? 2 : 0], i * 4)
    col.set([c.r, c.g, c.b], i * 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
  g.setAttribute('aA', new THREE.BufferAttribute(a, 4))
  g.setAttribute('aB', new THREE.BufferAttribute(b, 4))
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
  return g
}

const MOTE_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uGather;
  uniform float uEnter;
  uniform float uPulse;
  uniform float uAppear;
  attribute vec4 aA;
  attribute vec4 aB;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;
  ${POINT_SIZE}
  const float R = ${R.toFixed(3)};
  void main() {
    float glint = aA.w;
    float size = aB.x, bright = aB.y, seed = aB.z, spd = aB.w;
    vec3 p = aA.xyz;
    float ph = seed * 6.2831;
    if (glint > 1.5) {
      // snow: falls slowly through the globe and starts again at the top
      float fall = fract(seed * 7.13 + uTime * 0.018 * spd);
      float y = mix(0.72, -0.5, fall) * R;
      float rr = sqrt(max(R * R * 0.6 - y * y, 0.0));
      vec2 xz = normalize(p.xz + 1e-4) * rr * fract(seed * 3.7 + 0.2);
      p = vec3(xz.x + sin(uTime * 0.4 + ph) * 0.04 * R, y, xz.y);
      p *= 1.0 + uEnter * uEnter * 5.0;
    } else if (glint < 0.5) {
      p += vec3(sin(uTime * spd * 0.7 + ph), sin(uTime * spd * 0.55 + ph * 1.7), sin(uTime * spd * 0.63 + ph * 2.3)) * R * 0.08;
      float l = length(p);
      if (l > R * 0.8) p *= R * 0.8 / l;
      float g = clamp(uGather * (0.55 + seed * 0.6), 0.0, 1.0);
      p = mix(p, p * 0.35, g * g * (3.0 - 2.0 * g));
      p *= 1.0 + uEnter * uEnter * 5.0;
    } else {
      p *= 1.0 + uEnter * 0.4;
    }
    p *= mix(1.5, 1.0, uAppear);
    float tw = 0.7 + 0.3 * sin(uTime * (0.5 + seed * 1.1) + ph * 3.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float edgeFade = glint > 1.5 ? sin(3.14159 * fract(seed * 7.13 + uTime * 0.018 * spd)) : 1.0;
    vAlpha = pointSize(mv, size) * uAppear * edgeFade * (glint > 0.5 && glint < 1.5 ? (0.45 + uGather * 0.5) * (1.0 - uEnter) : 1.0);
    vColor = aColor * bright * tw * (1.0 + uPulse * 1.2 + uGather * 0.3);
  }
`

// ---------------------------------------------------------------------------
// Crystal: clear, lit from within. Soft silver/champagne edges, one tiny highlight.
// ---------------------------------------------------------------------------
const CRYSTAL_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`
const CRYSTAL_FRAG = /* glsl */ `
  uniform float uRim;
  uniform float uAppear;
  uniform float uEnter;
  uniform float uPower;
  varying vec3 vN;
  varying vec3 vV;
  vec3 safeHalf(vec3 a, vec3 b) { vec3 h = a + b; return h * inversesqrt(max(dot(h, h), 1e-6)); }
  void main() {
    vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
    vec3 v = normalize(vV);
    float facing = abs(dot(n, v));
    float f = 1.0 - facing;
    vec3 silver = vec3(0.86, 0.9, 1.0);
    vec3 champagne = vec3(1.0, 0.84, 0.6);
    float warm = clamp(0.55 - n.y * 0.4 + n.x * 0.3, 0.0, 1.0);
    vec3 edgeCol = mix(silver, champagne, warm);
    // a thin, crisp edge instead of a wide grey band: glass, not a bubble
    float rim = pow(f, 12.0) * 0.26 + pow(f, 32.0) * 0.42;
    // the edge catches light on the lit (upper-left) and caustic (lower-right) sides, less in between
    vec2 nd = n.xy * inversesqrt(max(dot(n.xy, n.xy), 1e-6));
    rim *= 0.4 + 0.9 * abs(dot(nd, vec2(-0.6, 0.8)));
    vec3 col = edgeCol * rim;
    if (gl_FrontFacing) {
      // the body is never darker than the night around it
      // a clear, deep blue (not grey): like looking into still night water
      col += vec3(0.011, 0.02, 0.048) * (0.55 + 0.45 * pow(facing, 2.0));
      // thick crystal: the inner wall of the glass shows as a second, inset edge
      col += edgeCol * exp(-pow((f - 0.6) / 0.045, 2.0)) * 0.06 * (0.5 + 0.5 * abs(dot(nd, vec2(-0.6, 0.8))));
      // a faint spectral fringe right at the edge, the way cut crystal splits light
      vec3 prism = 0.5 + 0.5 * cos(6.2831 * (f * 2.2 + atan(nd.y, nd.x) * 0.16 + vec3(0.0, 0.33, 0.67)));
      col += prism * smoothstep(0.82, 0.95, f) * smoothstep(1.0, 0.96, f) * 0.06;
      vec3 L = normalize(vec3(-0.5, 0.62, 0.6));
      col += vec3(1.0, 0.98, 0.94) * pow(max(dot(n, safeHalf(L, v)), 0.0), 5000.0) * 1.1;
      // the same light again, reflected off the inside of the far wall: small and warm, lower right
      vec3 L2 = normalize(vec3(0.42, -0.5, 0.75));
      col += vec3(1.0, 0.86, 0.66) * pow(max(dot(n, safeHalf(L2, v)), 0.0), 2500.0) * 0.35;
    } else {
      // the far wall of the glass, seen through the front: a faint second edge
      col = mix(silver, champagne, 0.5) * rim * 0.18;
    }
    col *= uRim * uAppear * (1.0 - uEnter * 0.85);
    if (any(isnan(col))) col = vec3(0.0);
    gl_FragColor = vec4(col, 1.0);
  }
`

// ---------------------------------------------------------------------------
// The world inside, seen through the glass: horizon, far light, still water.
// Additive light only, so the crystal stays clear wherever there is no light.
// ---------------------------------------------------------------------------
const WORLD_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uAppear;
  uniform float uEnter;
  uniform float uHover;
  uniform float uPower;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    vec2 p = (vUv * 2.0 - 1.0) * 1.5; // 1.0 = the crystal's edge (the plane is 1.5x wider for the halo)
    float r = length(p);
    float mask = smoothstep(0.93, 0.84, r);
    vec3 champagne = vec3(1.0, 0.82, 0.56);
    vec3 ivory = vec3(1.0, 0.95, 0.86);

    // --- a little snowy hill in the bottom of the globe ---
    float back = -0.42 + 0.08 * cos(p.x * 2.4) + 0.025 * sin(p.x * 7.0 + 1.0);
    float snow = smoothstep(back + 0.012, back - 0.012, p.y);
    float deep = clamp((back - p.y) / 0.45, 0.0, 1.0);
    vec3 snowCol = mix(vec3(0.96, 0.95, 1.0), vec3(0.55, 0.62, 0.82), deep);
    float crest = exp(-pow((p.y - back) / 0.018, 2.0));
    vec2 sc = (p + 3.0) * 34.0;
    float sg = step(0.9, hash(floor(sc))) * smoothstep(0.18, 0.0, length(fract(sc) - 0.5)) * (0.5 + 0.5 * sin(uTime * 2.0 + hash(floor(sc) + 2.0) * 40.0));
    vec3 col = snowCol * snow * (0.11 + 0.1 * (1.0 - deep)) + vec3(1.0, 0.97, 0.92) * (crest * 0.1 + sg * snow * 0.35);
    col += vec3(1.0, 0.8, 0.55) * snow * exp(-(p.x * p.x * 6.0 + pow(p.y - back, 2.0) * 40.0)) * 0.12;
    vec2 dir0 = p / max(r, 1e-4);
    float caustic = smoothstep(0.66, 0.8, r) * smoothstep(0.9, 0.82, r) * pow(max(dot(dir0, normalize(vec2(0.45, -0.9))), 0.0), 3.0);
    col += vec3(1.0, 0.8, 0.54) * caustic * 0.12;

    // the lantern's own light around the heart
    col += vec3(1.0, 0.78, 0.5) * (exp(-r * r * 5.0) * 0.1 + exp(-r * r * 26.0) * 0.08);
    // a few tiny round stars in its sky
    vec2 cp = (p + 2.0) * 20.0;
    vec2 cell = floor(cp);
    vec2 off = vec2(hash(cell + 1.7), hash(cell + 9.1)) * 0.6 + 0.2;
    float dd = length(fract(cp) - off);
    float st = step(0.93, hash(cell)) * step(back + 0.12, p.y) * smoothstep(0.11, 0.0, dd);
    col += ivory * st * (0.3 + 0.3 * sin(uTime * 1.5 + hash(cell + 3.0) * 30.0));
    col *= mask * (0.9 + uHover * 0.35) * mix(1.0, min(uPower, 1.8), 0.4);

    // --- the glass itself: a soft window reflection, curved along the upper left ---
    vec2 dir = p / max(r, 1e-4);
    float arc = smoothstep(0.74, 0.83, r) * smoothstep(0.95, 0.87, r) * smoothstep(0.35, 0.92, dot(dir, normalize(vec2(-0.62, 0.78))));
    float spot = exp(-dot(p - vec2(-0.42, 0.52), p - vec2(-0.42, 0.52)) * 160.0);
    col += vec3(0.9, 0.93, 1.0) * (arc * 0.07 + spot * 0.035);
    // a warm halo just outside, so the globe sits in the night instead of cut out of it
    float halo = smoothstep(0.92, 1.02, r) * exp(-max(r - 1.0, 0.0) * 5.0) * smoothstep(1.5, 1.2, r);
    col += vec3(1.0, 0.82, 0.58) * halo * 0.026 * (1.0 + uHover * 0.9);

    col *= uAppear * (1.0 - smoothstep(0.5, 0.85, uEnter));
    gl_FragColor = vec4(col, 1.0);
  }
`

// ---------------------------------------------------------------------------
// The small four-point star at the heart (the light of the lantern)
// ---------------------------------------------------------------------------
const STAR_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uPower;
  uniform float uAppear;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv * 2.0 - 1.0) * 1.7;
    float r = length(p);
    vec2 q = abs(p);
    float body = smoothstep(0.34, 0.0, pow(q.x, 0.5) + pow(q.y, 0.5) - 0.06);
    float rays = exp(-q.y * 80.0) * exp(-q.x * 4.2) + exp(-q.x * 80.0) * exp(-q.y * 3.6);
    float core = exp(-r * r * 320.0);
    float halo = exp(-r * r * 10.0) * 0.18;
    float breath = 0.86 + 0.14 * sin(uTime * 1.3);
    vec3 col = vec3(1.0, 0.8, 0.5) * (body * 0.75 + rays * 0.42 + halo) * breath * smoothstep(1.0, 0.7, r) + vec3(1.0, 0.95, 0.86) * core * 1.2;
    col *= uPower * uAppear;
    gl_FragColor = vec4(col, 1.0);
  }
`

const POOL_FRAG = /* glsl */ `
  uniform float uAppear;
  uniform float uPower;
  uniform float uTime;
  varying vec2 vUv;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }
  float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float d = dot(p, p);
    // a faint misty glow the globe floats above
    float mist = 0.6 + 0.4 * vnoise(p * 3.0 + vec2(uTime * 0.05, -uTime * 0.03));
    float g = (exp(-d * 4.0) * 0.8 + exp(-d * 14.0) * 0.6) * smoothstep(1.0, 0.55, sqrt(d)) * mist;
    gl_FragColor = vec4(vec3(1.0, 0.8, 0.55) * g * 0.07 * uAppear * min(uPower, 1.6), 1.0);
  }
`

// ---------------------------------------------------------------------------
// Now and then a thread of gold dust drifts from the tree into the globe.
// ---------------------------------------------------------------------------
function buildThreads(n: number) {
  const r = rng(5150)
  const a = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) a.set([r(), r(), r(), 0.006 + Math.pow(r(), 2) * 0.012], i * 4)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
  g.setAttribute('aA', new THREE.BufferAttribute(a, 4))
  return g
}
const THREAD_VERT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uFrom;
  uniform vec3 uTo;
  uniform float uShow;
  attribute vec4 aA; // seed, lane, phase, size
  varying vec3 vColor;
  varying float vAlpha;
  ${POINT_SIZE}
  vec3 bez(vec3 a, vec3 b, vec3 c, float t) { float k = 1.0 - t; return k * k * a + 2.0 * k * t * b + t * t * c; }
  void main() {
    // particles travel in small groups (threads), one thread every few seconds
    float group = floor(aA.y * 4.0);
    float t = fract(aA.z * 0.08 + uTime * 0.045 + group * 0.25);
    vec3 from = uFrom + vec3((aA.x - 0.5) * 0.4, (fract(aA.x * 7.1) - 0.5) * 1.4, (fract(aA.x * 3.7) - 0.5) * 0.4);
    vec3 ctrl = mix(from, uTo, 0.5) + vec3(0.0, 0.7 + group * 0.12, 0.25);
    vec3 p = bez(from, ctrl, uTo, t * t * (3.0 - 2.0 * t));
    p += vec3(sin(uTime * 0.7 + aA.x * 30.0), cos(uTime * 0.6 + aA.x * 20.0), 0.0) * 0.03;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float life = sin(3.14159 * t);
    vAlpha = pointSize(mv, aA.w) * life * life * smoothstep(1.0, 0.82, t) * uShow * 0.6;
    vColor = vec3(1.0, 0.82, 0.52) * 1.3;
  }
`

// ---------------------------------------------------------------------------
// The stand: a small pedestal drawn in the tree's own gold particles
// ---------------------------------------------------------------------------
const PEDESTAL = mobile ? 1800 : 3600
// profile of the stand (radius, height) in units of R, from the cup that holds the ball to the foot
const PROFILE: [number, number][] = [[0.6, -0.84], [0.5, -0.97], [0.47, -1.06], [0.56, -1.16], [0.76, -1.26], [0.8, -1.33]]
function profileAt(t: number): [number, number] {
  const f = t * (PROFILE.length - 1)
  const i = Math.min(PROFILE.length - 2, Math.floor(f))
  const k = f - i
  return [PROFILE[i][0] + (PROFILE[i + 1][0] - PROFILE[i][0]) * k, PROFILE[i][1] + (PROFILE[i + 1][1] - PROFILE[i][1]) * k]
}
function buildPedestal() {
  const r = rng(7781)
  const n = PEDESTAL
  const pos = new Float32Array(n * 3)
  const b = new Float32Array(n * 4)
  const col = new Float32Array(n * 3)
  const red = new THREE.Color('#dc4a3e')
  const gold = new THREE.Color('#f3c66c')
  const snow = new THREE.Color('#f4f6fb')
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2
    let rad: number
    let y: number
    let c: THREE.Color
    let bright: number
    if (r() < 0.16) {
      // the snow heaped in the cup
      const d = Math.sqrt(r())
      rad = d * 0.6
      y = -0.78 - d * d * 0.06
      c = snow
      bright = 0.5
    } else {
      const t = r()
      ;[rad, y] = profileAt(t)
      const band = Math.min(Math.abs(t - 0.02), Math.abs(t - 0.4), Math.abs(t - 0.97))
      c = band < 0.06 ? gold : red
      bright = band < 0.06 ? 1.45 : 0.95
    }
    pos.set([Math.cos(a) * rad * R, y * R, Math.sin(a) * rad * R], i * 3)
    b.set([0.008 + r() * 0.006, bright * (0.9 + r() * 0.2), r(), c === snow ? 0.8 : Math.sin(a)], i * 4) // snow on top always faces us
    col.set([c.r, c.g, c.b], i * 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aB', new THREE.BufferAttribute(b, 4))
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
  return g
}
const PED_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uAppear;
  uniform float uEnter;
  uniform float uPulse;
  uniform float uHover;
  attribute vec4 aB; // size, bright, seed, facing (sin of angle: + toward the viewer)
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;
  ${POINT_SIZE}
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = 0.65 + 0.35 * sin(uTime * (0.8 + aB.z * 2.2) + aB.z * 40.0);
    // only the side facing us, so the stand reads as solid; brighter at the front, softer to the sides
    float front = smoothstep(-0.25, 0.1, aB.w) * (0.45 + 0.55 * clamp(aB.w, 0.0, 1.0));
    vAlpha = pointSize(mv, aB.x) * uAppear * (1.0 - smoothstep(0.1, 0.5, uEnter));
    vColor = aColor * aB.y * (0.85 + 0.15 * tw) * front * (1.0 + uPulse * 1.0 + uHover * 0.35);
  }
`

// ---------------------------------------------------------------------------
// Inside: a little golden tree on the snowy hill, crowned by the globe's heart star
// ---------------------------------------------------------------------------
const MINI = mobile ? 420 : 760
function buildMiniTree() {
  const r = rng(1225)
  const a = new Float32Array(MINI * 4)
  const col = new Float32Array(MINI * 3)
  const gold = [new THREE.Color('#ffd27a'), new THREE.Color('#ffe2a8'), new THREE.Color('#f4a24a')]
  const warm = [new THREE.Color('#f2785e'), new THREE.Color('#fff1da')]
  for (let i = 0; i < MINI; i++) {
    const garland = r() < 0.32
    const h = garland ? r() : 1 - Math.sqrt(r()) // more lights low, like the big tree
    const th = garland ? h * 4.2 * Math.PI * 2 + (r() < 0.5 ? 0 : Math.PI) : r() * Math.PI * 2
    const rf = garland ? 1.04 : 0.55 + 0.45 * Math.sqrt(r())
    const ornament = !garland && r() < 0.06
    const c = ornament ? warm[Math.floor(r() * 2)] : gold[r() < 0.6 ? 0 : r() < 0.6 ? 1 : 2]
    a.set([h, th, rf, ornament ? 1.6 : garland ? 1.25 : 0.55 + r() * 0.4], i * 4)
    col.set([c.r, c.g, c.b], i * 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MINI * 3), 3))
  g.setAttribute('aA', new THREE.BufferAttribute(a, 4))
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
  return g
}
const MINI_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uAppear;
  uniform float uEnter;
  uniform float uHover;
  uniform float uPulse;
  attribute vec4 aA; // height, angle, radial fraction, brightness
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;
  ${POINT_SIZE}
  const float R = ${R.toFixed(3)};
  void main() {
    float h = aA.x;
    float th = aA.y + uTime * 0.25;
    float rad = R * 0.2 * pow(1.0 - h, 1.05) * aA.z;
    vec3 p = vec3(cos(th) * rad, R * (-0.335 + h * 0.325), sin(th) * rad);
    p *= 1.0 + uEnter * uEnter * 4.0;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = 0.7 + 0.3 * sin(uTime * (1.2 + aA.w) + aA.y * 7.0);
    float front = 0.55 + 0.45 * smoothstep(-0.5, 0.5, sin(th));
    vAlpha = pointSize(mv, 0.0075) * uAppear * (1.0 - smoothstep(0.2, 0.6, uEnter));
    vColor = aColor * aA.w * tw * front * (1.0 + uHover * 0.4 + uPulse);
  }
`

// ---------------------------------------------------------------------------
// Inside: the year's photos as tiny polaroids, slowly circling the heart light
// ---------------------------------------------------------------------------
const CARDS = 8
const ATLAS_W = 96
const ATLAS_H = 120
function buildCards() {
  const a = new Float32Array(CARDS * 4)
  for (let i = 0; i < CARDS; i++) a.set([i, (i / CARDS) * Math.PI * 2, ((i * 37) % 7) / 7 - 0.5, 0], i * 4)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CARDS * 3), 3))
  g.setAttribute('aA', new THREE.BufferAttribute(a, 4))
  return g
}
function fillAtlas(ctx: CanvasRenderingContext2D, geo: THREE.BufferGeometry) {
  const list = memories()
  const on = geo.getAttribute('aA') as THREE.BufferAttribute
  const n = Math.min(CARDS, list.length)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, ATLAS_W * 4, ATLAS_H * 3)
  for (let i = 0; i < CARDS; i++) {
    const m = n ? list[Math.floor((i * list.length) / n)] : null
    on.setW(i, i < n ? 1 : 0)
    if (!m || i >= n) continue
    const src = m.canvas
    const want = ATLAS_W / ATLAS_H
    const have = src.width / src.height
    const sw = have > want ? src.height * want : src.width
    const sh = have > want ? src.height : src.width / want
    ctx.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, (i % 4) * ATLAS_W, Math.floor(i / 4) * ATLAS_H, ATLAS_W, ATLAS_H)
  }
  on.needsUpdate = true
}
const CARD_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uGather;
  uniform float uEnter;
  uniform float uAppear;
  uniform float uPulse;
  uniform float uGScale;
  attribute vec4 aA; // index, angle, height, on
  varying vec2 vCell;
  varying float vAlpha;
  varying float vBright;
  ${POINT_SIZE}
  const float R = ${R.toFixed(3)};
  void main() {
    float a = aA.y + uTime * (0.07 + uGather * 0.05);
    vec3 p = vec3(cos(a) * 0.56 * R, (aA.z * 0.1 + 0.02) * R + sin(uTime * 0.5 + aA.y * 3.0) * 0.02 * R, sin(a) * 0.56 * R);
    // the ring leans toward us so it reads as an orbit, not a row
    p = vec3(p.x, p.y * 0.97 - p.z * 0.24, p.y * 0.24 + p.z * 0.97);
    p *= 1.0 + uEnter * uEnter * 5.0;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float front = smoothstep(-0.7, 0.7, sin(a));
    vAlpha = pointSize(mv, R * uGScale * ${mobile ? '0.13' : '0.17'}) * aA.w * uAppear * (1.0 - smoothstep(0.2, 0.6, uEnter));
    vBright = (0.25 + 0.55 * front) * (1.0 + uGather * 0.35 + uPulse * 0.8);
    vCell = vec2(mod(aA.x, 4.0), floor(aA.x / 4.0));
  }
`
const CARD_FRAG = /* glsl */ `
  uniform sampler2D uAtlas;
  varying vec2 vCell;
  varying float vAlpha;
  varying float vBright;
  void main() {
    vec2 c = gl_PointCoord; // 0..1, y down
    vec2 q = vec2((c.x - 0.1) / 0.8, c.y); // a 4:5 card inside the square sprite
    float card = smoothstep(0.0, 0.03, q.x) * smoothstep(1.0, 0.97, q.x) * smoothstep(0.0, 0.03, q.y) * smoothstep(1.0, 0.97, q.y);
    if (card <= 0.0) discard;
    vec2 uv = (q - vec2(0.08, 0.07)) / vec2(0.84, 0.7);
    float photo = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    vec3 img = texture2D(uAtlas, vec2((vCell.x + clamp(uv.x, 0.0, 1.0)) / 4.0, 1.0 - (vCell.y + clamp(uv.y, 0.0, 1.0)) / 3.0)).rgb;
    vec3 frame = vec3(1.0, 0.9, 0.74) * 0.3;
    vec3 col = mix(frame, img * 0.95 + vec3(0.04, 0.03, 0.02), photo);
    gl_FragColor = vec4(col * card * vAlpha * vBright, 1.0);
  }
`

// thick crystal swallows part of what lies behind it, so the world inside stays legible
const BODY_FRAG = /* glsl */ `
  uniform float uAppear;
  uniform float uEnter;
  varying vec2 vUv;
  void main() {
    float r = length(vUv * 2.0 - 1.0);
    float a = smoothstep(1.0, 0.95, r) * (${mobile ? '0.6' : '0.34'} + 0.1 * smoothstep(0.9, 0.3, r)) * uAppear * (1.0 - smoothstep(0.3, 0.6, uEnter));
    gl_FragColor = vec4(vec3(0.02, 0.03, 0.07), a);
  }
`
const BASIC_VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }
const _p = new THREE.Vector3()
const _down = new THREE.Vector3()

export default function Globe({ position, scale, tree }: { position: readonly [number, number, number]; scale: number; tree: readonly [number, number, number] }) {
  const float = useRef<THREE.Group>(null)
  const star = useRef<THREE.Mesh>(null)
  const world = useRef<THREE.Mesh>(null)
  const geometry = useMemo(buildMotes, [])
  const threads = useMemo(() => buildThreads(THREADS), [])
  const own = useMemo(
    () => ({ uDof: { value: 0.06 }, uGather: { value: 0 }, uEnter: { value: 0 }, uPulse: { value: 0 }, uAppear: { value: 0 }, uRim: { value: 0.75 }, uPower: { value: 1 }, uHover: { value: 0 } }),
    [],
  )
  const motes = useMemo(() => pointsMaterial(MOTE_VERT, own), [own])
  const threadUni = useMemo(() => ({ uFrom: { value: new THREE.Vector3() }, uTo: { value: new THREE.Vector3() }, uShow: { value: 0 } }), [])
  const threadMat = useMemo(() => pointsMaterial(THREAD_VERT, threadUni), [threadUni])
  const crystal = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uRim: own.uRim, uAppear: own.uAppear, uEnter: own.uEnter, uPower: own.uPower },
        vertexShader: CRYSTAL_VERT,
        fragmentShader: CRYSTAL_FRAG,
        side: THREE.DoubleSide,
        ...additive,
      }),
    [own],
  )
  const worldMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: motes.uniforms.uTime, uAppear: own.uAppear, uEnter: own.uEnter, uHover: own.uHover, uPower: own.uPower },
        vertexShader: BASIC_VERT,
        fragmentShader: WORLD_FRAG,
        ...additive,
      }),
    [own, motes],
  )
  const starMat = useMemo(
    () => new THREE.ShaderMaterial({ uniforms: { uTime: motes.uniforms.uTime, uPower: own.uPower, uAppear: own.uAppear }, vertexShader: BASIC_VERT, fragmentShader: STAR_FRAG, ...additive }),
    [own, motes],
  )
  const pool = useMemo(
    () => new THREE.ShaderMaterial({ uniforms: { uAppear: own.uAppear, uPower: own.uPower, uTime: motes.uniforms.uTime }, vertexShader: BASIC_VERT, fragmentShader: POOL_FRAG, ...additive }),
    [own, motes],
  )
  const pedestal = useMemo(buildPedestal, [])
  const pedMat = useMemo(() => pointsMaterial(PED_VERT, { uDof: own.uDof, uAppear: own.uAppear, uEnter: own.uEnter, uPulse: own.uPulse, uHover: own.uHover }), [own])
  const mini = useMemo(buildMiniTree, [])
  const miniMat = useMemo(() => pointsMaterial(MINI_VERT, { uDof: own.uDof, uAppear: own.uAppear, uEnter: own.uEnter, uHover: own.uHover, uPulse: own.uPulse }), [own])
  const cards = useMemo(buildCards, [])
  const atlas = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = ATLAS_W * 4
    c.height = ATLAS_H * 3
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.minFilter = THREE.LinearMipmapLinearFilter
    return { ctx: c.getContext('2d')!, tex, version: -1 }
  }, [])
  const cardMat = useMemo(() => {
    const m = pointsMaterial(CARD_VERT, { ...own, uAtlas: { value: atlas.tex }, uGScale: { value: scale } })
    m.fragmentShader = CARD_FRAG
    return m
  }, [own, atlas, scale])
  const bodyMat = useMemo(
    () => new THREE.ShaderMaterial({ uniforms: { uAppear: own.uAppear, uEnter: own.uEnter }, vertexShader: BASIC_VERT, fragmentShader: BODY_FRAG, transparent: true, depthWrite: false }),
    [own],
  )
  const body = useRef<THREE.Mesh>(null)
  const hoverTarget = useRef(0)
  const focusTarget = useRef<HTMLElement | null>(null)

  useFrame(({ camera, size }, dt) => {
    const t = clock.now()
    const s = store.get()
    const calm = s.view === 'main' && !s.trans && !s.sheet && !s.ritual && !s.review && s.introDone
    const want = calm ? hoverTarget.current : 0
    globe.hover += (want - globe.hover) * (1 - Math.exp(-dt * 1.6))
    globe.pulse *= Math.exp(-dt * 1.8)
    const e = globe.enter
    own.uGather.value = globe.hover
    own.uHover.value = globe.hover
    own.uEnter.value = e
    own.uPulse.value = globe.pulse
    own.uAppear.value = easeOut(span(t, T.globe))
    const breathe = mobile && calm ? 0.16 + Math.sin(t * 1.7) * 0.09 : 0
    own.uRim.value = 0.75 + breathe + globe.hover * 0.6 + globe.pulse * 1.3
    // warms as we approach, then gives way to the stardust passage instead of flooding the frame
    own.uPower.value = (1 + globe.hover * 0.3 + globe.pulse * 1.5 + e * 0.6) * (1 - THREE.MathUtils.smoothstep(e, 0.45, 0.8))
    // the photos inside follow the memories
    const v = s.memVersion
    if (v !== atlas.version) {
      atlas.version = v
      fillAtlas(atlas.ctx, cards)
      atlas.tex.needsUpdate = true
    }
    if (float.current) float.current.getWorldPosition(globe.world)
    globe.radius = R * scale
    for (const m of [star.current, world.current, body.current]) if (m) m.quaternion.copy(camera.quaternion)
    if (star.current) star.current.scale.setScalar(1 + e * 0.5)

    // gold threads from the tree's right side into the globe (main view only)
    const h = 0.42
    threadUni.uFrom.value.set(tree[0] + radiusAt(h) * 0.75, tree[1] + h * TREE_H, tree[2] + 0.35)
    threadUni.uTo.value.copy(globe.world).add(_down.set(-0.55, 0.62, 0.3).multiplyScalar(globe.radius * 0.95)) // they melt into the glass at its upper left
    threadUni.uShow.value += ((calm ? 1 : 0) * own.uAppear.value - threadUni.uShow.value) * (1 - Math.exp(-dt * 1.5))

    focusTarget.current ??= document.getElementById('globe-focus')
    if (calm && focusTarget.current) {
      _p.copy(globe.world).project(camera)
      focusTarget.current.style.transform = `translate(${((_p.x + 1) / 2) * size.width}px, ${((1 - _p.y) / 2) * size.height}px) translate(-50%, -50%)`
    }
  })

  const enter = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 8) return
    e.stopPropagation()
    enterGlobe()
  }

  return (
    <>
      <group position={position as unknown as THREE.Vector3Tuple} scale={scale}>
        <mesh material={pool} rotation-x={-Math.PI / 2} position-y={-R * 1.34} renderOrder={1}>
          <planeGeometry args={[R * 4.6, R * 4.6]} />
        </mesh>
        <points geometry={pedestal} material={pedMat} frustumCulled={false} renderOrder={3} />
        <group ref={float}>
          <mesh ref={body} material={bodyMat} renderOrder={2}>
            <planeGeometry args={[R * 2, R * 2]} />
          </mesh>
          <mesh ref={world} material={worldMat} renderOrder={3}>
            <planeGeometry args={[R * 3, R * 3]} />
          </mesh>
          <mesh material={crystal} renderOrder={4}>
            <sphereGeometry args={[R, 96, 64]} />
          </mesh>
          <mesh ref={star} material={starMat} renderOrder={5}>
            <planeGeometry args={[R * 1.35, R * 1.35]} />
          </mesh>
          <points geometry={mini} material={miniMat} frustumCulled={false} renderOrder={6} />
          <points geometry={cards} material={cardMat} frustumCulled={false} renderOrder={6} />
          <points geometry={geometry} material={motes} frustumCulled={false} renderOrder={6} />
          <mesh
            onClick={enter}
            onPointerOver={(e) => {
              e.stopPropagation()
              hoverTarget.current = 1
              document.body.style.cursor = 'pointer'
            }}
            onPointerOut={() => {
              hoverTarget.current = 0
              document.body.style.cursor = ''
            }}
            onPointerDown={(e) => {
              hoverTarget.current = 1
              if (e.pointerType !== 'mouse') setTimeout(() => (hoverTarget.current = 0), 1600)
            }}
          >
            <sphereGeometry args={[R * (mobile ? 1.30 : 1.12), 16, 12]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
          </mesh>
        </group>
      </group>
      <points geometry={threads} material={threadMat} frustumCulled={false} renderOrder={7} />
    </>
  )
}
