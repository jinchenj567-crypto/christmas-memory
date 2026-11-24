import { useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { isTall, mobile } from './config'
import { POINT_SIZE, U, gauss, pointsMaterial, rng } from './uniforms'
import { fx } from '../store'

/**
 * The fireworks button: four shells go up one after another, each a rising spark with a tail,
 * then a full bloom that drifts and sinks. Nearer, larger and more colourful than the quiet
 * far-away fireworks in the background, and over in about five seconds.
 */
const SLOTS = 4
const SPARKS = mobile ? 110 : 200
const TRAIL = mobile ? 3 : 4
const ROCKET = 26
const LIFE = 3.0
const RISE = 0.85

function build() {
  const r = rng(1226)
  const n = SLOTS * (SPARKS * TRAIL + ROCKET)
  const a = new Float32Array(n * 4)
  const b = new Float32Array(n * 4)
  let i = 0
  for (let s = 0; s < SLOTS; s++) {
    for (let k = 0; k < SPARKS; k++) {
      const d = new THREE.Vector3(gauss(r), gauss(r), gauss(r)).normalize()
      const speed = 0.8 + r() * 0.25
      const seed = r()
      const size = 0.12 + r() * 0.08
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
  uniform float uR[${SLOTS}];
  attribute vec4 aA; // direction, speed
  attribute vec4 aB; // slot, trail index (< 0: rocket), seed, size
  varying vec3 vColor;
  varying float vAlpha;
  ${POINT_SIZE}
  void hide() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vAlpha = 0.0; vColor = vec3(0.0); vCoc = 0.0; }
  void main() {
    int s = int(aB.x + 0.5);
    vec3 c = uC[s];
    vec3 col = uK[s];
    float rad = uR[s];
    float age = uTime - uS[s];
    if (aB.y < 0.0) {
      // the rocket: a bright spark climbing to where it will burst, a short tail behind
      float lag = (-aB.y - 1.0) * 0.18;
      float u = (age + ${RISE.toFixed(2)}) / ${RISE.toFixed(2)} - lag;
      if (u < 0.0 || u > 1.0 || age > 0.05) { hide(); return; }
      float e = 1.0 - pow(1.0 - u, 2.0);
      vec3 p = c + vec3(sin(u * 9.0 + aB.z * 6.0) * 0.06, -(1.0 - e) * 7.0, 0.0);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      float head = 1.0 - lag / 0.18;
      vAlpha = pointSize(mv, 0.09 * (0.4 + 0.6 * head)) * head * uFade;
      vColor = vec3(1.0, 0.86, 0.62) * (0.8 + 1.6 * head);
      return;
    }
    age -= aB.y * 0.05 + fract(aB.z * 7.7) * 0.12;
    if (age < 0.0 || age > ${LIFE.toFixed(2)}) { hide(); return; }
    vec3 p = c + aA.xyz * aA.w * rad * (1.0 - exp(-2.3 * age)) + vec3(sin(aB.z * 91.0), cos(aB.z * 57.0), 0.0) * 0.07 * rad * smoothstep(0.6, 2.0, age);
    p.y -= 0.3 * rad * age * age;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float life = age / ${LIFE.toFixed(2)};
    float fade = smoothstep(0.0, 0.03, age) * (1.0 - smoothstep(0.35, 1.0, life));
    float crackle = mix(1.0, step(0.45, fract(aB.z * 17.0 + age * 9.0)), smoothstep(0.55, 0.8, life));
    float trail = 1.0 - aB.y / ${TRAIL.toFixed(1)};
    vAlpha = pointSize(mv, aB.w * (0.6 + 0.4 * trail)) * fade * crackle * trail * uFade;
    // a white flash at the burst, then the shell's own colour
    vColor = mix(col, vec3(1.0, 0.97, 0.9), exp(-age * 7.0)) * (0.7 + 1.3 * exp(-age * 2.2));
  }
`

const COLORS = ['#ffd49a', '#f2a29a', '#fbe6c6', '#e86a5a', '#bcd9ff', '#ffc46e'].map((c) => new THREE.Color(c))

export default function FireworksShow() {
  const size = useThree((s) => s.size)
  const tall = isTall(size.width / size.height)
  const geometry = useMemo(build, [])
  const state = useMemo(() => ({ seen: -99, queue: [] as number[], slot: 0, rand: rng(91) }), [])
  const own = useMemo(
    () => ({
      uDof: { value: 0.005 },
      uC: { value: Array.from({ length: SLOTS }, () => new THREE.Vector3()) },
      uS: { value: new Array(SLOTS).fill(-99) },
      uK: { value: Array.from({ length: SLOTS }, () => new THREE.Color()) },
      uR: { value: new Array(SLOTS).fill(4) },
    }),
    [],
  )
  const material = useMemo(() => pointsMaterial(VERT, own), [own])

  useFrame(() => {
    const t = U.uTime.value
    if (fx.fireworks !== state.seen) {
      state.seen = fx.fireworks
      state.queue = fx.fireworks > 0 ? [0.9, 1.55, 2.25, 3.05].map((d) => fx.fireworks + d) : []
    }
    // a shell is launched RISE seconds before it bursts
    while (state.queue.length && t >= state.queue[0] - RISE) {
      const at = state.queue.shift()!
      const r = state.rand
      const s = state.slot
      state.slot = (s + 1) % SLOTS
      const side = s % 2 === 0 ? -1 : 1
      own.uC.value[s].set(tall ? side * (1.2 + r() * 2.2) : side * (3 + r() * 6), tall ? 10.5 + r() * 3 : 7.5 + r() * 4, -22 - r() * 8)
      own.uS.value[s] = at
      own.uK.value[s].copy(COLORS[Math.floor(r() * COLORS.length)])
      own.uR.value[s] = (tall ? 0.6 : 1) * (3.6 + r() * 1.8)
    }
  })

  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={0} />
}
