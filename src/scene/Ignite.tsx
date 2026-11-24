import { useMemo } from 'react'
import * as THREE from 'three'
import { T, TREE_H, mobile } from './config'
import { POINT_SIZE, gauss, pointsMaterial, rng } from './uniforms'

/**
 * Two moments of the opening:
 *  - the star catches fire: a burst of sparks flies out from the top of the tree;
 *  - the glow begins to climb: a ring of light rolls out across the ground, through the presents.
 */
const SPARKS = mobile ? 260 : 520
const FLASH = mobile ? 260 : 480
const RING = mobile ? 420 : 900
const BURST = T.star + 0.05
const WAVE = T.reveal[0] - 0.1

function build() {
  const r = rng(1208)
  const n = SPARKS + RING + FLASH
  const a = new Float32Array(n * 4)
  const b = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    if (i < SPARKS) {
      const d = new THREE.Vector3(gauss(r), gauss(r) * 0.8 + 0.25, gauss(r)).normalize()
      a.set([d.x, d.y, d.z, 1.6 + r() * 2.6], i * 4)
      b.set([0, r(), 0.03 + r() * 0.04, r() < 0.3 ? 1 : 0], i * 4) // kind 0 = spark; seed; size; white
    } else if (i >= SPARKS + RING) {
      // the opening flash: a hot core and long rays shooting out of it
      const d = new THREE.Vector3(gauss(r), gauss(r) * 0.7, gauss(r)).normalize()
      const core = i < SPARKS + RING + 40
      a.set([d.x, d.y, d.z, core ? r() * 0.25 : 2 + r() * 7], i * 4)
      b.set([2, r(), core ? 0.18 + r() * 0.2 : 0.06 + r() * 0.06, core ? 1 : r() < 0.4 ? 1 : 0], i * 4)
    } else {
      a.set([r() * Math.PI * 2, gauss(r) * 0.12, r(), 0], i * 4)
      b.set([1, r(), 0.022 + r() * 0.03, r() < 0.25 ? 1 : 0], i * 4) // kind 1 = ground ring
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
  attribute vec4 aA;
  attribute vec4 aB; // kind, seed, size, white
  varying vec3 vColor;
  varying float vAlpha;
  ${POINT_SIZE}
  void hide() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vAlpha = 0.0; vColor = vec3(0.0); vCoc = 0.0; }
  void main() {
    vec3 gold = vec3(1.0, 0.78, 0.45);
    vec3 col = mix(gold, vec3(1.0, 0.97, 0.9), aB.w);
    vec3 p;
    float alpha;
    if (aB.x > 1.5) {
      float age = uTime - 0.12 - aB.y * 0.05;
      if (age < 0.0 || age > 1.6) { hide(); return; }
      // rays streak outward from the seed of light, the core swells and fades
      p = vec3(0.0, ${(TREE_H * 0.46).toFixed(3)}, 0.0) + aA.xyz * aA.w * (1.0 - exp(-3.2 * age));
      alpha = smoothstep(0.0, 0.05, age) * (1.0 - smoothstep(0.25, 1.6, age));
      col *= 2.2 + 5.0 * exp(-age * 3.0);
    } else if (aB.x < 0.5) {
      float age = uTime - ${BURST.toFixed(3)} - aB.y * 0.12;
      if (age < 0.0 || age > 2.2) { hide(); return; }
      // sparks fly out fast, slow down, and drift down as they fade
      p = vec3(0.0, ${(TREE_H + 0.16).toFixed(3)}, 0.0) + aA.xyz * aA.w * (1.0 - exp(-2.6 * age)) * 0.9;
      p.y -= 0.35 * age * age;
      alpha = smoothstep(0.0, 0.04, age) * (1.0 - smoothstep(0.5, 2.2, age)) * mix(1.0, step(0.4, fract(aB.y * 19.0 + age * 8.0)), smoothstep(0.9, 1.6, age));
      col *= 1.0 + 2.5 * exp(-age * 3.0);
    } else {
      float age = uTime - ${WAVE.toFixed(3)};
      if (age < 0.0 || age > 2.8) { hide(); return; }
      // a ring rolling out over the floor, a soft band of light that thins as it goes
      float rad = 0.4 + 7.5 * (1.0 - exp(-1.1 * age)) + aA.y * (0.4 + age * 0.3);
      p = vec3(cos(aA.x) * rad, 0.04 + aA.z * 0.08, sin(aA.x) * rad);
      alpha = smoothstep(0.0, 0.15, age) * (1.0 - smoothstep(0.8, 2.8, age)) * (1.0 - abs(aA.y) * 3.0);
      col *= 1.3;
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vAlpha = pointSize(mv, aB.z) * max(alpha, 0.0) * uFade;
    vColor = col;
  }
`

export default function Ignite({ tree }: { tree: readonly [number, number, number] }) {
  const geometry = useMemo(build, [])
  const material = useMemo(() => pointsMaterial(VERT, { uDof: { value: 0.02 } }), [])
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={6} position={tree as unknown as THREE.Vector3Tuple} />
}
