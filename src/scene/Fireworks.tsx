import { useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { isTall, mobile } from './config'
import { POINT_SIZE, U, gauss, pointsMaterial, rng } from './uniforms'
import { store } from '../store'

/**
 * Far-away fireworks: small, soft and slow, low on the night behind the tree.
 * At most one blooms every several seconds, champagne gold and now and then rose.
 * They are atmosphere, never the subject: they pause whenever something else is happening.
 */
const SLOTS = 2
const SPARKS = mobile ? 90 : 160
const TRAIL = mobile ? 3 : 4
const LIFE = 2.8

function build() {
  const r = rng(1225)
  const n = SLOTS * SPARKS * TRAIL
  const a = new Float32Array(n * 4)
  const b = new Float32Array(n * 4)
  let i = 0
  for (let s = 0; s < SLOTS; s++)
    for (let k = 0; k < SPARKS; k++) {
      const d = new THREE.Vector3(gauss(r), gauss(r), gauss(r)).normalize()
      const speed = 0.75 + r() * 0.3 // a shell: sparks fly at nearly the same speed
      const seed = r()
      const size = 0.11 + r() * 0.08
      for (let j = 0; j < TRAIL; j++, i++) {
        a.set([d.x, d.y, d.z, speed], i * 4)
        b.set([s, j, seed, size], i * 4)
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
  uniform vec3 uC0;
  uniform vec3 uC1;
  uniform float uS0;
  uniform float uS1;
  uniform vec3 uK0;
  uniform vec3 uK1;
  uniform float uR0;
  uniform float uR1;
  attribute vec4 aA; // direction, speed
  attribute vec4 aB; // slot, trail index, seed, size
  varying vec3 vColor;
  varying float vAlpha;
  ${POINT_SIZE}
  const float LIFE = ${LIFE.toFixed(2)};
  void main() {
    bool one = aB.x > 0.5;
    vec3 c = one ? uC1 : uC0;
    vec3 col = one ? uK1 : uK0;
    float rad = one ? uR1 : uR0;
    float age = uTime - (one ? uS1 : uS0) - aB.y * 0.05 - fract(aB.z * 7.7) * 0.14;
    if (age < 0.0 || age > LIFE) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vAlpha = 0.0;
      vColor = vec3(0.0);
      vCoc = 0.0;
      return;
    }
    // fast out, then drifting, then sinking under its own weight
    float k = 2.2;
    vec3 p = c + aA.xyz * aA.w * rad * (1.0 - exp(-k * age)) + vec3(sin(aB.z * 91.0), cos(aB.z * 57.0), 0.0) * 0.08 * rad * smoothstep(0.6, 2.0, age);
    p.y -= 0.32 * rad * age * age;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float life = age / LIFE;
    float fade = smoothstep(0.0, 0.04, age) * (1.0 - smoothstep(0.35, 1.0, life));
    // the last moments crackle softly
    float crackle = mix(1.0, step(0.45, fract(aB.z * 17.0 + age * 9.0)), smoothstep(0.55, 0.8, life));
    float trail = 1.0 - aB.y / ${TRAIL.toFixed(1)};
    vAlpha = pointSize(mv, aB.w * (0.6 + 0.4 * trail)) * fade * crackle * trail * uFade;
    vColor = col * (0.5 + 1.0 * exp(-age * 2.4));
  }
`

const GOLD = new THREE.Color('#ffd49a')
const PALE = new THREE.Color('#fbe6c6')
const ROSE = new THREE.Color('#f2a29a')

export default function Fireworks() {
  const size = useThree((s) => s.size)
  const tall = isTall(size.width / size.height)
  const geometry = useMemo(build, [])
  const state = useMemo(() => ({ next: 6, slot: 0, rand: rng(77) }), [])
  const own = useMemo(
    () => ({
      uDof: { value: 0.004 },
      uC0: { value: new THREE.Vector3() },
      uC1: { value: new THREE.Vector3() },
      uS0: { value: -99 },
      uS1: { value: -99 },
      uK0: { value: new THREE.Color() },
      uK1: { value: new THREE.Color() },
      uR0: { value: 3 },
      uR1: { value: 3 },
    }),
    [],
  )
  const material = useMemo(() => pointsMaterial(VERT, own), [own])

  useFrame(() => {
    const t = U.uTime.value
    const s = store.get()
    const calm = s.view === 'main' && !s.trans && !s.ritual && !s.review && s.introDone
    if (!calm) {
      state.next = Math.max(state.next, t + 3)
      return
    }
    if (t < state.next) return
    const r = state.rand
    const slot = state.slot
    state.slot = (slot + 1) % SLOTS
    state.next = t + 6 + r() * 4
    // far behind the tree, to either side of it, so they never sit on the tree itself
    const side = r() < 0.5 ? -1 : 1
    const c = tall
      ? new THREE.Vector3(side * (5.5 + r() * 3), 9 + r() * 6, -48 - r() * 10)
      : new THREE.Vector3(side * (13 + r() * 16), 7 + r() * 9, -52 - r() * 14)
    const col = r() < 0.25 ? ROSE : r() < 0.5 ? PALE : GOLD
    if (slot === 0) {
      own.uC0.value.copy(c)
      own.uS0.value = t
      own.uK0.value.copy(col)
      own.uR0.value = (tall ? 0.6 : 1) * (4.6 + r() * 2.2)
    } else {
      own.uC1.value.copy(c)
      own.uS1.value = t
      own.uK1.value.copy(col)
      own.uR1.value = (tall ? 0.6 : 1) * (4.6 + r() * 2.2)
    }
  })

  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={0} />
}
