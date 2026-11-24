import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { TREE_H, mobile } from './config'
import { POINT_SIZE, gauss, pointsMaterial, rng } from './uniforms'
import { fx } from '../store'

/**
 * A wish: a small light rises from the front of the tree, circles it once and a quarter
 * as it climbs, and melts into the star at the top.
 */
export const WISH_TIME = 4.2
const N = mobile ? 220 : 420

function build() {
  const r = rng(1231)
  const a = new Float32Array(N * 4)
  for (let i = 0; i < N; i++) {
    const head = i < N * 0.15
    a.set([head ? r() * 0.01 : Math.pow(r(), 1.5) * 0.16, gauss(r) * (head ? 0.02 : 0.08), head ? 0.06 + r() * 0.04 : 0.02 + r() * 0.03, r()], i * 4)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3))
  g.setAttribute('aA', new THREE.BufferAttribute(a, 4))
  return g
}

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uT0;
  uniform vec3 uBase;
  attribute vec4 aA; // lag, scatter, size, seed
  varying vec3 vColor;
  varying float vAlpha;
  ${POINT_SIZE}
  const float TOP = ${(TREE_H + 0.16).toFixed(3)};
  vec3 path(float u) {
    float a = 1.5708 + u * 6.2832 * 1.25;
    float rad = mix(2.3, 0.0, pow(u, 0.85));
    return uBase + vec3(cos(a) * rad, 0.35 + (TOP - 0.35) * u * u * (3.0 - 2.0 * u), sin(a) * rad);
  }
  void main() {
    float age = uTime - uT0;
    float u = clamp(age / ${WISH_TIME.toFixed(2)}, 0.0, 1.0) - aA.x;
    if (age < 0.0 || age > ${(WISH_TIME + 0.4).toFixed(2)} || u < 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vAlpha = 0.0; vColor = vec3(0.0); vCoc = 0.0;
      return;
    }
    vec3 p = path(u) + vec3(sin(aA.w * 40.0 + age * 3.0), cos(aA.w * 30.0 + age * 2.0), sin(aA.w * 20.0)) * aA.y * (0.2 + aA.x * 4.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float tail = 1.0 - aA.x / 0.16;
    float arrive = 1.0 - smoothstep(${WISH_TIME.toFixed(2)} - 0.1, ${(WISH_TIME + 0.4).toFixed(2)}, age);
    float appear = smoothstep(0.0, 0.4, age);
    vAlpha = pointSize(mv, aA.z * (0.4 + 0.6 * tail)) * tail * appear * arrive;
    vColor = mix(vec3(1.0, 0.7, 0.45), vec3(1.0, 0.97, 0.9), tail) * (1.0 + 2.0 * step(aA.x, 0.01));
  }
`

export default function Wish({ tree }: { tree: readonly [number, number, number] }) {
  const geometry = useMemo(build, [])
  const own = useMemo(() => ({ uDof: { value: 0.02 }, uT0: { value: -99 }, uBase: { value: new THREE.Vector3(...tree) } }), [tree])
  const material = useMemo(() => pointsMaterial(VERT, own), [own])
  useFrame(() => {
    own.uT0.value = fx.wish
  })
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={6} />
}
