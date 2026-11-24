import { useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { isTall, mobile } from './config'
import { POINT_SIZE, gauss, pointsMaterial, rng } from './uniforms'

/**
 * Under the tree: a Santa hat and a few plump presents, drawn in soft light.
 * Everything is filled and rounded (wrapping paper, puffy bows, a fluffy brim), lit gently from above.
 * Sweet, warm, and still quieter than the tree.
 */
const K = mobile ? 0.9 : 1.7

type Out = { p: number[]; n: number[]; c: number[]; s: number[] }
const push = (o: Out, p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color, size: number, bright: number, seed: number) => {
  o.p.push(p.x, p.y, p.z)
  o.n.push(n.x, n.y, n.z)
  o.c.push(c.r, c.g, c.b)
  o.s.push(size, bright, seed, 1)
}
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const UP = V(0, 1, 0)
const _v = new THREE.Vector3()
const _n = new THREE.Vector3()

/** Move everything added since `start`: scale, turn about Y, then place. */
function settle(o: Out, start: number, at: [number, number], rot: number, scale: number) {
  const q = new THREE.Quaternion().setFromAxisAngle(UP, rot)
  for (let i = start; i < o.p.length / 3; i++) {
    _v.fromArray(o.p, i * 3).multiplyScalar(scale).applyQuaternion(q)
    _v.x += at[0]
    _v.z += at[1]
    _v.toArray(o.p, i * 3)
    _n.fromArray(o.n, i * 3).applyQuaternion(q).toArray(o.n, i * 3)
  }
}

/** Points on an ellipsoid's surface; `paint` may recolour a point by where it lies. */
function blob(o: Out, r: () => number, c: THREE.Vector3, rad: THREE.Vector3, n: number, col: THREE.Color, bright: number, paint?: (u: THREE.Vector3) => THREE.Color | null) {
  for (let i = 0; i < Math.round(n * K); i++) {
    const u = V(gauss(r), gauss(r), gauss(r)).normalize()
    const p = V(u.x * rad.x, u.y * rad.y, u.z * rad.z).multiplyScalar(1 + gauss(r) * 0.006).add(c)
    const nn = V(u.x / rad.x, u.y / rad.y, u.z / rad.z).normalize()
    push(o, p, nn, paint?.(u) ?? col, 0.019 + Math.pow(r(), 3) * 0.01, bright * (0.9 + r() * 0.2), r())
  }
}

// ---------------------------------------------------------------------------
// A Santa hat in light, dropped by the presents: red cone, fluffy white brim, pompom
// ---------------------------------------------------------------------------
function santaHat(o: Out, r: () => number, at: [number, number], rot: number, scale: number, lean: number) {
  const start = o.p.length / 3
  const scarf = new THREE.Color('#e0574a')
  const white = new THREE.Color('#fbf3e8')
  const tilt = new THREE.Matrix4().makeRotationZ(lean)
  const put = (p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color, size: number, b: number) => {
    p.applyMatrix4(tilt)
    n.transformDirection(tilt)
    push(o, p, n, c, size, b, r())
  }
  for (let i = 0; i < Math.round(700 * K); i++) {
    const t = Math.pow(r(), 0.8) // up the cone
    const a = r() * Math.PI * 2
    const rad = 0.125 * (1 - t)
    put(V(Math.cos(a) * rad, 0.02 + t * 0.22, Math.sin(a) * rad), V(Math.cos(a), 0.5, Math.sin(a)).normalize(), scarf, 0.018, 0.95)
  }
  for (let i = 0; i < Math.round(420 * K); i++) {
    const a = r() * Math.PI * 2
    const v = r() * Math.PI * 2
    const tube = 0.032
    const n = V(Math.cos(a) * Math.cos(v), Math.sin(v), Math.sin(a) * Math.cos(v))
    put(V(Math.cos(a) * (0.13 + Math.cos(v) * tube), 0.015 + Math.sin(v) * tube, Math.sin(a) * (0.13 + Math.cos(v) * tube)), n, white, 0.02, 1.05)
  }
  for (let i = 0; i < Math.round(160 * K); i++) {
    const u = V(gauss(r), gauss(r), gauss(r)).normalize()
    put(u.clone().multiplyScalar(0.038).add(V(0, 0.255, 0)), u, white, 0.02, 1.1)
  }

  // the cone flops over a little toward its tip
  settle(o, start, at, rot, scale)
}

/** Move everything added since `start` by a full transform. */
function xform(o: Out, start: number, m: THREE.Matrix4) {
  const nm = new THREE.Matrix3().getNormalMatrix(m)
  for (let i = start; i < o.p.length / 3; i++) {
    _v.fromArray(o.p, i * 3).applyMatrix4(m).toArray(o.p, i * 3)
    _n.fromArray(o.n, i * 3).applyMatrix3(nm).normalize().toArray(o.n, i * 3)
  }
}
const place = (x: number, y: number, z: number, rot: number, lean: number, scale: number) =>
  new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, lean, 'YXZ')), V(scale, scale, scale))

// ---------------------------------------------------------------------------
// A candy cane: a shaft and a hook, striped red and white round and round
// ---------------------------------------------------------------------------
function candyCane(o: Out, r: () => number, m: THREE.Matrix4, count: number) {
  const start = o.p.length / 3
  const red = new THREE.Color('#e2463d')
  const white = new THREE.Color('#fbf2ea')
  const L = 0.42
  const hr = 0.075
  const tr = 0.022
  const hook = Math.PI * hr
  for (let i = 0; i < Math.round(count * K); i++) {
    const len = r() * (L + hook)
    let c: THREE.Vector3
    let t: THREE.Vector3
    if (len < L) {
      c = V(0, len, 0)
      t = V(0, 1, 0)
    } else {
      const th = (len - L) / hr
      c = V(hr - hr * Math.cos(th), L + hr * Math.sin(th), 0)
      t = V(Math.sin(th), Math.cos(th), 0)
    }
    const b1 = V(0, 0, 1)
    const b2 = t.clone().cross(b1)
    const phi = r() * Math.PI * 2
    const n = b2.multiplyScalar(Math.cos(phi)).add(b1.clone().multiplyScalar(Math.sin(phi)))
    const stripe = (len / 0.075 + phi / (Math.PI * 2)) % 1 < 0.45
    push(o, c.add(n.clone().multiplyScalar(tr)), n, stripe ? red : white, 0.016, stripe ? 1.0 : 1.05, r())
  }
  xform(o, start, m)
}

// ---------------------------------------------------------------------------
// Two gold bells tied with a little red bow
// ---------------------------------------------------------------------------
function bells(o: Out, r: () => number, m: THREE.Matrix4, count: number) {
  const start = o.p.length / 3
  const gold = new THREE.Color('#f3c66c')
  const pale = new THREE.Color('#fff0c8')
  const red = new THREE.Color('#e2463d')
  for (const side of [-1, 1]) {
    const bs = o.p.length / 3
    for (let i = 0; i < Math.round(count * K); i++) {
      const t = Math.pow(r(), 0.8) // 0 crown .. 1 mouth
      const a = r() * Math.PI * 2
      const rad = 0.06 * (0.42 + 0.58 * Math.pow(t, 0.75)) + (t > 0.82 ? (t - 0.82) * 0.13 : 0)
      const y = 0.12 * (1 - t)
      const n = V(Math.cos(a), 0.55 - t * 0.6, Math.sin(a)).normalize()
      const lip = t > 0.93
      push(o, V(Math.cos(a) * rad, y, Math.sin(a) * rad), n, lip ? pale : gold, 0.014, lip ? 1.25 : 1.0, r())
    }
    for (let i = 0; i < Math.round(50 * K); i++) {
      const u = V(gauss(r), gauss(r), gauss(r)).normalize()
      push(o, u.clone().multiplyScalar(0.016).add(V(0, -0.006, 0.01)), u, pale, 0.012, 1.1, r()) // clapper
    }
    // tops lean together, mouths open outward
    xform(o, bs, new THREE.Matrix4().compose(V(side * 0.062, 0, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, side * 0.38)), V(1, 1, 1)))
  }
  // one bow where they meet: two puffy loops, a knot and two tails
  for (let i = 0; i < Math.round(320 * K); i++) {
    const u = r()
    let p: THREE.Vector3
    if (u < 0.7) {
      const side = r() < 0.5 ? -1 : 1
      const th = r() * Math.PI * 2
      const k = 0.55 + 0.45 * Math.sqrt(r())
      p = V(side * (0.03 + Math.cos(th) * 0.028 * k), 0.15 + Math.sin(th) * 0.017 * k, 0.012)
    } else if (u < 0.85) {
      const q = V(gauss(r), gauss(r), gauss(r)).normalize()
      p = q.multiplyScalar(0.012).add(V(0, 0.15, 0.014))
    } else {
      const side = r() < 0.5 ? -1 : 1
      const k = r()
      p = V(side * (0.008 + k * 0.025), 0.145 - k * 0.05, 0.016)
    }
    push(o, p, V(0, 0.2, 1).normalize(), red, 0.013, 1.0, r())
  }
  xform(o, start, m)
}

// ---------------------------------------------------------------------------
// A sprig of holly: three spiky leaves and three red berries
// ---------------------------------------------------------------------------
function holly(o: Out, r: () => number, m: THREE.Matrix4, count: number) {
  const start = o.p.length / 3
  const leaf = new THREE.Color('#2f9a5a')
  const vein = new THREE.Color('#7fd39a')
  const berry = new THREE.Color('#ec3b3b')
  const L = 0.17
  const width = (x: number) => 0.048 * Math.sin((Math.PI * x) / L) * (1 + 0.28 * Math.abs(Math.cos((x * 5 * Math.PI) / L)))
  for (const ang of [-0.55, 0.65, 2.6]) {
    const ls = o.p.length / 3
    for (let i = 0; i < Math.round(count * K); i++) {
      const x = r() * L
      const w = width(x)
      const edge = r() < 0.4
      const y = edge ? (r() < 0.5 ? -w : w) : (r() * 2 - 1) * w
      const onVein = !edge && Math.abs(y) < 0.004
      push(o, V(x, 0.012 * Math.sin((Math.PI * x) / L), y), V(0, 1, 0), onVein ? vein : leaf, 0.014, edge ? 1.0 : 0.7, r())
    }
    xform(o, ls, new THREE.Matrix4().compose(V(0, 0, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25, ang, 0.18)), V(1, 1, 1)))
  }
  for (const [bx, bz] of [[0.0, 0.0], [0.03, 0.025], [-0.025, 0.03]]) {
    for (let i = 0; i < Math.round(90 * K); i++) {
      const u = V(gauss(r), gauss(r), gauss(r)).normalize()
      push(o, u.clone().multiplyScalar(0.022).add(V(bx, 0.03, bz)), u, berry, 0.014, 1.15, r())
    }
  }
  xform(o, start, m)
}

// ---------------------------------------------------------------------------
// Presents: soft rounded boxes in sweet paper, a ribbon each way and a puffy bow
// ---------------------------------------------------------------------------
type Paper = { base: string; accent: string; ribbon: string; pattern: 'dots' | 'stripes' | 'plain' }
function present(o: Out, r: () => number, at: [number, number], w: number, h: number, d: number, rot: number, paper: Paper, count: number, lift = 0) {
  const start = o.p.length / 3
  const base = new THREE.Color(paper.base)
  const accent = new THREE.Color(paper.accent)
  const ribbon = new THREE.Color(paper.ribbon)
  const half = V(w / 2, h / 2, d / 2)
  const round = Math.min(w, h, d) * 0.16
  const inner = V(half.x - round, half.y - round, half.z - round)
  const lo = inner.clone().negate()
  const rb = Math.min(w, d) * 0.075 // half width of the ribbon
  for (let i = 0; i < Math.round(count * K); i++) {
    // a point on the box, pushed onto the rounded shell
    const f = Math.floor(r() * 5)
    const a = r() * 2 - 1
    const b = r() * 2 - 1
    const c = f === 0 ? V(a, 1, b) : f === 1 ? V(a, b, 1) : f === 2 ? V(a, b, -1) : f === 3 ? V(1, b, a) : V(-1, b, a)
    c.multiply(half)
    const p = c.clone().clamp(lo, inner)
    const n = c.clone().sub(p)
    if (n.lengthSq() < 1e-10) n.set(0, 1, 0)
    n.normalize()
    p.add(n.clone().multiplyScalar(round))
    let col = base
    let bright = 0.75
    if (Math.abs(p.x) < rb || Math.abs(p.z) < rb) {
      col = ribbon
      bright = 1.0
    } else if (paper.pattern === 'dots') {
      const u = n.y > 0.5 ? [p.x, p.z] : Math.abs(n.x) > 0.5 ? [p.z, p.y] : [p.x, p.y]
      const cell = 0.085
      const gx = u[0] / cell
      const gy = u[1] / cell + (Math.abs(Math.floor(gx)) % 2) * 0.5
      if (Math.hypot(gx - Math.floor(gx) - 0.5, gy - Math.floor(gy) - 0.5) < 0.24) {
        col = accent
        bright = 0.95
      }
    } else if (paper.pattern === 'stripes') {
      const t = (p.x + p.y + p.z) / 0.07
      if (t - Math.floor(t) < 0.35) {
        col = accent
        bright = 0.9
      }
    }
    p.y += half.y
    push(o, p, n, col, 0.022 + Math.pow(r(), 3) * 0.012, bright * (0.88 + r() * 0.24), r())
  }
  // the bow: two puffy loops, two little tails and a round knot
  const s = Math.min(w, d) * 0.3
  const top = h
  for (let i = 0; i < Math.round(420 * K * (s / 0.12)); i++) {
    const kind = r()
    if (kind < 0.72) {
      const side = r() < 0.5 ? -1 : 1
      const t = r() * Math.PI * 2 // around the loop
      const v = r() * Math.PI * 2 // around the tube
      const R = s * 0.5
      const tube = s * 0.2 * (0.8 + 0.2 * Math.cos(t))
      const cx = side * (R + Math.cos(t) * R)
      const cy = top + s * 0.25 + Math.sin(t) * R * 0.8
      const p = V(cx + Math.cos(v) * Math.cos(t) * tube, cy + Math.cos(v) * Math.sin(t) * tube, Math.sin(v) * tube)
      const n = V(Math.cos(v) * Math.cos(t), Math.cos(v) * Math.sin(t), Math.sin(v))
      push(o, p, n, ribbon, 0.02, 1.0, r())
    } else if (kind < 0.85) {
      const side = r() < 0.5 ? -1 : 1
      const k = r()
      push(o, V(side * (0.02 + k * s * 0.6), top + 0.01, s * (0.3 + k * 0.7) * (r() - 0.2)), UP, ribbon, 0.02, 0.95, r())
    } else {
      const u = V(gauss(r), gauss(r), gauss(r)).normalize()
      push(o, V(u.x * s * 0.22, top + s * 0.22 + u.y * s * 0.2, u.z * s * 0.2), u, ribbon, 0.02, 1.05, r())
    }
  }
  settle(o, start, at, rot, 1)
  if (lift) for (let i = start; i < o.p.length / 3; i++) o.p[i * 3 + 1] += lift
}

const PINK: Paper = { base: '#f3a3ad', accent: '#fff2e2', ribbon: '#f6e0b0', pattern: 'dots' }
const CREAM: Paper = { base: '#f6e2c2', accent: '#e8705e', ribbon: '#e0574a', pattern: 'stripes' }
const BERRY: Paper = { base: '#d9574c', accent: '#f7d9a8', ribbon: '#f7e3b6', pattern: 'dots' }
const PEACH: Paper = { base: '#f5c39a', accent: '#fff1de', ribbon: '#e98f8f', pattern: 'plain' }
const GOLD: Paper = { base: '#f0c879', accent: '#fff3d6', ribbon: '#d9503e', pattern: 'stripes' }
const ROSE: Paper = { base: '#e7838c', accent: '#f9d9a0', ribbon: '#fff1de', pattern: 'stripes' }
const IVORY: Paper = { base: '#f8ecd9', accent: '#e46b5c', ribbon: '#f0c879', pattern: 'dots' }
const PAPERS = [PINK, CREAM, BERRY, GOLD, ROSE, IVORY, PEACH]

/**
 * A full ring of presents and little things all the way round the trunk, so the tree
 * looks generously surrounded from any side. `skip` keeps arcs (degrees) clear.
 */
function ring(o: Out, r: () => number, radius: number, skip: [number, number][], dens: number) {
  const step = 21
  let k = 0
  for (let deg = 0; deg < 360; deg += step + (r() - 0.5) * 6) {
    if (skip.some(([a, b]) => deg >= a && deg <= b)) continue
    const th = (deg * Math.PI) / 180
    const rad = radius + (r() - 0.5) * 0.5
    const x = Math.cos(th) * rad
    const z = Math.sin(th) * rad
    const face = -th + Math.PI / 2 + (r() - 0.5) * 0.8
    const kind = k++ % 6
    const paper = PAPERS[Math.floor(r() * PAPERS.length)]
    const w = 0.28 + r() * 0.26
    const h = 0.22 + r() * 0.3
    const area = (w * h + w * w + h * w) * 2
    if (kind === 0 || kind === 3) {
      present(o, r, [x, z], w, h, w * (0.85 + r() * 0.2), face, paper, area * 1700 * dens)
      if (kind === 3) holly(o, r, place(x, h, z, face, 0, 0.8), 150 * dens)
    } else if (kind === 1) {
      // two presents stacked, the top one a little turned
      present(o, r, [x, z], w + 0.06, h, w + 0.04, face, paper, area * 1700 * dens)
      const w2 = w * 0.62
      const p2 = PAPERS[Math.floor(r() * PAPERS.length)]
      present(o, r, [x, z], w2, h * 0.7, w2, face + 0.5, p2, area * 700 * dens, h)
    } else if (kind === 2) {
      present(o, r, [x, z], w * 0.8, h * 0.8, w * 0.8, face, paper, area * 1200 * dens)
      candyCane(o, r, place(x + Math.cos(th) * 0.32, 0, z + Math.sin(th) * 0.32, face, (r() - 0.5) * 0.5, 0.8 + r() * 0.3), 380 * dens)
    } else if (kind === 4) {
      present(o, r, [x, z], w, h * 1.3, w, face, paper, area * 1900 * dens)
      bells(o, r, place(x + Math.cos(th) * 0.38, 0, z + Math.sin(th) * 0.38, face, 0, 0.95), 260 * dens)
    } else {
      // a low wide box with a sprig of holly
      present(o, r, [x, z], w * 1.4, h * 0.6, w, face, paper, area * 1700 * dens)
      holly(o, r, place(x, h * 0.6, z, face, 0, 0.9), 150 * dens)
    }
  }
}

function build(tall: boolean) {
  const r = rng(1224)
  const o: Out = { p: [], n: [], c: [], s: [] }
  if (tall) {
    // portrait: gathered in front of the tree, in the open space under it
    santaHat(o, r, [-1.05, 3.95], 0.5, 1.9, -0.5)
    present(o, r, [-0.5, 3.9], 0.44, 0.36, 0.4, 0.35, PINK, 1500)
    present(o, r, [-0.02, 4.22], 0.28, 0.24, 0.28, -0.45, CREAM, 900)
    present(o, r, [0.5, 4.02], 0.32, 0.42, 0.32, 0.25, BERRY, 1300)
    candyCane(o, r, place(-0.82, 0, 4.3, 0.4, 0.22, 0.85), 420)
    bells(o, r, place(0.18, 0, 4.45, -0.2, 0, 0.95), 300)
    holly(o, r, place(-0.5, 0.36, 3.9, 0.3, 0, 0.9), 200)
    holly(o, r, place(0.5, 0.42, 4.02, -0.6, 0, 0.8), 160)
    ring(o, r, 2.25, [[62, 118]], 0.75)
  } else {
    // left of the trunk: a Santa hat by two presents; right: presents beside the globe
    santaHat(o, r, [-2.45, 1.75], 0.6, 2.3, -0.5)
    present(o, r, [-1.9, 1.98], 0.52, 0.42, 0.46, 0.35, PINK, 2000)
    present(o, r, [-1.35, 2.38], 0.32, 0.27, 0.32, -0.45, CREAM, 1100)
    present(o, r, [1.7, 2.4], 0.36, 0.46, 0.36, 0.25, BERRY, 1500)
    present(o, r, [1.25, 2.75], 0.24, 0.2, 0.24, -0.6, PEACH, 650)
    candyCane(o, r, place(-2.2, 0, 2.2, 0.5, 0.2, 1.1), 520)
    candyCane(o, r, place(-1.05, 0, 2.62, -0.3, -0.25, 0.85), 420)
    bells(o, r, place(0.82, 0, 2.78, -0.15, 0, 1.15), 380)
    holly(o, r, place(-1.9, 0.42, 1.98, 0.3, 0, 1.0), 240)
    holly(o, r, place(1.7, 0.46, 2.4, -0.6, 0, 0.85), 180)
    holly(o, r, place(2.05, 0, 2.3, 0.9, 0, 0.9), 180)
    // the rest of the way round (the front is already dressed; the globe keeps its place)
    ring(o, r, 2.3, [[22, 158]], 1)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(o.p, 3))
  g.setAttribute('aN', new THREE.Float32BufferAttribute(o.n, 3))
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(o.c, 3))
  g.setAttribute('aS', new THREE.Float32BufferAttribute(o.s, 4))
  return g
}

const APPEAR = /* glsl */ `smoothstep(0.75, 1.0, uIntro) * smoothstep(-0.15, 0.15, uReveal) * uFade`

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uIntro;
  uniform float uReveal;
  uniform float uDim;
  uniform float uFade;
  attribute vec3 aN;
  attribute vec3 aColor;
  attribute vec4 aS; // size, bright, seed, -
  varying vec3 vColor;
  varying float vAlpha;
  ${POINT_SIZE}
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // soft and rounded: lit from above (the tree's glow), with a gentle bright outline
    vec3 n = normalize(normalMatrix * aN);
    // only the side facing us, evened out so a shape reads as solid rather than as an outline
    float facing = dot(n, normalize(-mv.xyz));
    float front = smoothstep(-0.05, 0.15, facing);
    float top = clamp(aN.y * 0.5 + 0.5, 0.0, 1.0);
    float shade = front * (0.55 + 0.45 * top) * (0.3 + 0.9 * clamp(facing, 0.0, 1.0)) + front * 0.18 * pow(1.0 - facing, 4.0);
    float tw = 0.9 + 0.1 * sin(uTime * (0.6 + aS.z * 1.4) + aS.z * 70.0);
    vAlpha = pointSize(mv, aS.x * ${mobile ? '0.7' : '1.0'}) * ${APPEAR} * (1.0 - uDim * 0.55);
    vColor = aColor * aS.y * shade * tw * ${mobile ? '1.7' : '1.15'};
  }
`

export default function Gifts() {
  const size = useThree((s) => s.size)
  const tall = isTall(size.width / size.height)
  const g = useMemo(() => build(tall), [tall])
  const material = useMemo(() => pointsMaterial(VERT), [])
  return <points geometry={g} material={material} frustumCulled={false} renderOrder={2} />
}
