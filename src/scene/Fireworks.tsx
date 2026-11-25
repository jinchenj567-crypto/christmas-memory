import { useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { isTall, mobile } from './config'
import { POINT_SIZE, U, gauss, pointsMaterial, rng } from './uniforms'
import { store } from '../store'

/**
 * Fireworks in the night behind the tree, to either side of it.
 * Every shell first rises on a little trail, then opens as one of four kinds:
 * a full peony, a flat ring, a golden willow whose long trails droop and glitter,
 * or a two-colour peony. Never on top of the tree; they pause when something else is happening.
 */
const SLOTS = 3
const SPARKS = mobile ? 110 : 190
const TRAIL = mobile ? 3 : 5
const ROCKET = 22
const RISE = 0.9

function build() {
  const r = rng(1225)
  const n = SLOTS * (SPARKS * TRAIL + ROCKET)
  const a = new Float32Array(n * 4)
  const b = new Float32Array(n * 4)
  let i = 0
  for (let s = 0; s < SLOTS; s++) {
    for (let k = 0; k < SPARKS; k++) {
      const d = new THREE.Vector3(gauss(r), gauss(r), gauss(r)).normalize()
      const speed = 0.82 + r() * 0.22
      const seed = r()
      const size = 0.1 + r() * 0.08
      for (let j = 0; j < TRAIL; j++, i++) {
        a.set([d.x, d.y, d.z, speed], i * 4)
        b.set([s, j, seed, size], i * 4)
      }
    }
    for (let k = 0; k < ROCKET; k++, i++) {
      a.set([0, 0, 0, 0], i * 4)
      b.set([s, -1 - k / ROCKET, r(), 0.1], i * 4) // trail index < 0 marks the rising rocket
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
  g.setAttribute('aA', new THREE.BufferAttribute(a, 4))
  g.setAttribute('aB', new THREE.BufferAttribute(b, 4))
  return g
}

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uFade;
  uniform vec3 uC[${SLOTS}];
  uniform float uS[${SLOTS}];
  uniform vec3 uK[${SLOTS}];
  uniform vec3 uK2[${SLOTS}];
  uniform float uR[${SLOTS}];
  uniform float uType[${SLOTS}];
  uniform vec3 uN[${SLOTS}];
  attribute vec4 aA; // direction, speed
  attribute vec4 aB; // slot, trail index (< 0: rocket), seed, size
  varying vec3 vColor;
  varying float vAlpha;
  ${POINT_SIZE}
  void hide() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vAlpha = 0.0; vColor = vec3(0.0); vCoc = 0.0; }
  void main() {
    int s = int(aB.x + 0.5);
    vec3 c = uC[s];
    float rad = uR[s];
    float type = uType[s];
    bool willow = type > 1.5 && type < 2.5;
    float age = uTime - uS[s];
    if (aB.y < 0.0) {
      // the rising shell: a bright head with a short wavering tail
      float lag = (-aB.y - 1.0) * 0.2;
      float u = (age + ${RISE.toFixed(2)}) / ${RISE.toFixed(2)} - lag;
      if (u < 0.0 || u > 1.0 || age > 0.02) { hide(); return; }
      float e = 1.0 - pow(1.0 - u, 2.2);
      vec3 p = c + vec3(sin(u * 10.0 + aB.z * 6.0) * 0.08, -(1.0 - e) * rad * 1.9, 0.0);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      float head = 1.0 - lag / 0.2;
      vAlpha = pointSize(mv, 0.1 * (0.4 + 0.6 * head)) * head * 0.9 * uFade;
      vColor = vec3(1.0, 0.85, 0.6) * (0.7 + 1.5 * head);
      return;
    }
    float life = willow ? 4.2 : 3.0; // willows hang longer
    age -= aB.y * (willow ? 0.09 : 0.05) + fract(aB.z * 7.7) * 0.1;
    if (age < 0.0 || age > life) { hide(); return; }
    vec3 dir = aA.xyz;
    if (type > 0.5 && type < 1.5) {
      // a ring: flatten every direction onto one tilted plane
      vec3 n = uN[s];
      dir = normalize(dir - n * dot(dir, n) + 1e-4);
    }
    float drag = willow ? 1.6 : 2.3;
    float gravity = willow ? 0.55 : 0.3;
    vec3 p = c + dir * aA.w * rad * (1.0 - exp(-drag * age));
    p += vec3(sin(aB.z * 91.0), cos(aB.z * 57.0), 0.0) * 0.06 * rad * smoothstep(0.6, 2.0, age);
    p.y -= gravity * rad * age * age;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float k = age / life;
    float fade = smoothstep(0.0, 0.03, age) * (1.0 - smoothstep(0.4, 1.0, k));
    // glitter: the last part of each spark's life crackles
    float crackle = mix(1.0, step(0.45, fract(aB.z * 17.0 + age * 10.0)), smoothstep(0.5, 0.75, k));
    float trail = 1.0 - aB.y / ${TRAIL.toFixed(1)};
    vec3 col = type > 2.5 && aB.z >= 0.5 ? uK2[s] : uK[s];
    // a white-hot flash as it opens, then its own colour; willows cool to deep gold
    col = mix(col, vec3(1.0, 0.97, 0.9), exp(-age * 7.0));
    if (willow) col = mix(col, vec3(1.0, 0.55, 0.18), smoothstep(0.3, 0.9, k));
    vAlpha = pointSize(mv, aB.w * (0.55 + 0.45 * trail)) * fade * crackle * trail * uFade;
    vColor = col * (1.1 + 2.0 * exp(-age * 2.0));
  }
`

const PALETTE = ['#ffd49a', '#f2a29a', '#fbe6c6', '#e86a5a', '#bcd9ff', '#ffc46e', '#f7b0d0'].map((c) => new THREE.Color(c))

export default function Fireworks() {
  const size = useThree((s) => s.size)
  const tall = isTall(size.width / size.height)
  const geometry = useMemo(build, [])
  const state = useMemo(() => ({ next: 5, slot: 0, side: 1, rand: rng(77) }), [])
  const own = useMemo(
    () => ({
      uDof: { value: 0.004 },
      uC: { value: Array.from({ length: SLOTS }, () => new THREE.Vector3()) },
      uS: { value: new Array(SLOTS).fill(-99) },
      uK: { value: Array.from({ length: SLOTS }, () => new THREE.Color()) },
      uK2: { value: Array.from({ length: SLOTS }, () => new THREE.Color()) },
      uR: { value: new Array(SLOTS).fill(4) },
      uType: { value: new Array(SLOTS).fill(0) },
      uN: { value: Array.from({ length: SLOTS }, () => new THREE.Vector3(0, 0, 1)) },
    }),
    [],
  )
  const material = useMemo(() => pointsMaterial(VERT, own), [own])

  const launch = (t: number) => {
    const r = state.rand
    const s = state.slot
    state.slot = (s + 1) % SLOTS
    state.side = -state.side
    const side = state.side
    // far behind the tree, to either side of it, so they never sit on the tree itself
    own.uC.value[s].set(tall ? side * (3.6 + r() * 2.6) : side * (8.5 + r() * 8), tall ? 7.2 + r() * 3.2 : 7 + r() * 5, tall ? -26 - r() * 6 : -28 - r() * 8)
    own.uS.value[s] = t + RISE // bursts once the rocket has risen
    const type = Math.floor(r() * 4)
    own.uType.value[s] = type
    own.uK.value[s].copy(type === 2 ? PALETTE[0] : PALETTE[Math.floor(r() * PALETTE.length)])
    own.uK2.value[s].copy(PALETTE[Math.floor(r() * PALETTE.length)])
    own.uN.value[s].set(gauss(r) * 0.5, gauss(r) * 0.5 + 0.4, 1).normalize()
    own.uR.value[s] = (tall ? 0.6 : 1) * (type === 2 ? 4.6 + r() * 1.4 : 3.8 + r() * 1.6)
  }

  useFrame(() => {
    const t = U.uTime.value
    const s = store.get()
    const calm = s.view === 'main' && !s.trans && !s.ritual && !s.review && s.introDone
    if (!calm) {
      state.next = Math.max(state.next, t + 2.5)
      return
    }
    if (t < state.next) return
    launch(t)
    // now and then two go up together
    if (state.rand() < 0.45) launch(t + 0.35 + state.rand() * 0.4)
    state.next = t + 2.6 + state.rand() * 2.0
  })

  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={0} />
}
