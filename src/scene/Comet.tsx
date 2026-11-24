import { useMemo } from 'react'
import * as THREE from 'three'
import { T, TREE_H, mobile } from './config'
import { POINT_SIZE, gauss, pointsMaterial, rng } from './uniforms'

/**
 * The opening's shooting star: a light falls out of the night sky in a long golden arc
 * and comes to rest on the top of the tree, just as its star ignites.
 */
const N = mobile ? 360 : 760
const DUR = 2.1
const T0 = T.star - DUR + 0.05

function build() {
  const r = rng(2412)
  const a = new Float32Array(N * 4)
  for (let i = 0; i < N; i++) {
    const head = i < N * 0.12
    // lag along the path, sideways scatter, size, seed
    a.set([head ? r() * 0.012 : Math.pow(r(), 1.5) * 0.42, head ? gauss(r) * 0.02 : gauss(r) * 0.1, head ? 0.05 + r() * 0.04 : 0.02 + r() * 0.035, r()], i * 4)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3))
  g.setAttribute('aA', new THREE.BufferAttribute(a, 4))
  return g
}

const VERT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uFrom;
  uniform vec3 uCtrl;
  uniform vec3 uTo;
  attribute vec4 aA; // lag, scatter, size, seed
  varying vec3 vColor;
  varying float vAlpha;
  ${POINT_SIZE}
  vec3 bez(float t) { float k = 1.0 - t; return k * k * uFrom + 2.0 * k * t * uCtrl + t * t * uTo; }
  void main() {
    float age = uTime - ${T0.toFixed(3)};
    float u = clamp(age / ${DUR.toFixed(3)}, 0.0, 1.0);
    u = 1.0 - pow(1.0 - u, 1.6); // quick at first, settling as it arrives
    float s = u - aA.x;
    if (age < 0.0 || age > ${(DUR + 0.6).toFixed(3)} || s < 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vAlpha = 0.0;
      vColor = vec3(0.0);
      vCoc = 0.0;
      return;
    }
    vec3 p = bez(s);
    vec3 tang = normalize(bez(min(s + 0.01, 1.0)) - bez(max(s - 0.01, 0.0)) + 1e-4);
    vec3 side = normalize(cross(tang, vec3(0.0, 0.0, 1.0)) + 1e-4);
    // the tail loosens and sinks a little behind the head
    p += side * aA.y * (0.3 + aA.x * 6.0) + vec3(0.0, -aA.x * aA.x * 6.0, 0.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float tail = 1.0 - aA.x / 0.42;
    float done = 1.0 - smoothstep(${DUR.toFixed(3)}, ${(DUR + 0.5).toFixed(3)}, age);
    vAlpha = pointSize(mv, aA.z * (0.4 + 0.6 * tail)) * tail * tail * done;
    vColor = mix(vec3(1.0, 0.72, 0.4), vec3(1.0, 0.97, 0.88), tail) * (1.5 + 3.0 * step(aA.x, 0.012));
  }
`

export default function Comet({ tree }: { tree: readonly [number, number, number] }) {
  const geometry = useMemo(build, [])
  const material = useMemo(() => {
    const to = new THREE.Vector3(tree[0], tree[1] + TREE_H + 0.16, tree[2])
    return pointsMaterial(VERT, {
      uDof: { value: 0.01 },
      uFrom: { value: to.clone().add(new THREE.Vector3(15, 5.5, -9)) },
      uCtrl: { value: to.clone().add(new THREE.Vector3(5.5, 4.2, -1.5)) },
      uTo: { value: to },
    })
  }, [tree])
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={6} />
}
