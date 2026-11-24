import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { BUDGET } from './config'
import { POINT_SIZE, U, gauss, pointsMaterial, rng } from './uniforms'

/** Five-point star drawn with dense particles along its outline plus a soft fill. */
function buildStar(count: number) {
  const r = rng(77)
  const outer = 0.3
  const inner = 0.125
  const verts: THREE.Vector2[] = []
  for (let k = 0; k < 10; k++) {
    const a = Math.PI / 2 + (k * Math.PI) / 5
    const rad = k % 2 ? inner : outer
    verts.push(new THREE.Vector2(Math.cos(a) * rad, Math.sin(a) * rad))
  }
  const pos = new Float32Array(count * 3)
  const rand = new Float32Array(count * 4)
  const col = new Float32Array(count * 3)
  const p = new THREE.Vector2()
  for (let i = 0; i < count; i++) {
    const edge = r() < 0.62
    if (edge) {
      const k = Math.floor(r() * 10)
      p.lerpVectors(verts[k], verts[(k + 1) % 10], r())
      p.multiplyScalar(1 + gauss(r) * 0.02)
    } else {
      // fill: pick a triangle (centre + edge), sample inside it
      const k = Math.floor(r() * 10)
      let a = r()
      let b = r()
      if (a + b > 1) {
        a = 1 - a
        b = 1 - b
      }
      p.set(0, 0).addScaledVector(verts[k], a).addScaledVector(verts[(k + 1) % 10], b)
    }
    pos.set([p.x, p.y, gauss(r) * 0.025], i * 3)
    const bright = edge ? 1.0 + r() * 0.9 : 0.55 + r() * 0.5
    const c = new THREE.Color(r() < 0.75 ? '#ffd27e' : '#fff0d0')
    col.set([c.r * bright, c.g * bright, c.b * bright], i * 3)
    rand.set([r(), 0.012 + r() * 0.02, 0, 0], i * 4)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aRand', new THREE.BufferAttribute(rand, 4))
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
  return g
}

const STAR_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uStar;
  uniform float uFade;
  attribute vec4 aRand;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;
  ${POINT_SIZE}
  void main() {
    float seed = aRand.x;
    float on = clamp((uStar - seed * 0.35) / 0.65, 0.0, 1.0);
    vec3 p = position * mix(2.4, 1.0, 1.0 - pow(1.0 - on, 3.0));
    p += 0.006 * vec3(sin(uTime * 1.3 + seed * 40.0), cos(uTime * 1.1 + seed * 31.0), 0.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = 0.8 + 0.2 * sin(uTime * (2.0 + seed * 3.0) + seed * 60.0);
    vAlpha = pointSize(mv, aRand.y) * on * uFade;
    vColor = aColor * tw * (1.0 + max(0.0, uStar - 1.0) * 1.8);
  }
`

const GLOW_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`
const GLOW_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uStar;
  uniform float uDim;
  uniform float uFade;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float on = clamp(uStar, 0.0, 1.0);
    float flash = max(0.0, uStar - 1.0);
    float core = exp(-r * r * 110.0) * 1.25;
    float halo = exp(-r * r * 9.0) * 0.2 + exp(-r * 3.2) * 0.07;
    // fine diffraction rays: long thin cross plus a fainter, slowly turning diagonal pair
    float ca = cos(uTime * 0.05), sa = sin(uTime * 0.05);
    vec2 q = mat2(ca, -sa, sa, ca) * p;
    float cross = exp(-abs(q.y) * 170.0) * exp(-abs(q.x) * 5.5) + exp(-abs(q.x) * 170.0) * exp(-abs(q.y) * 5.5);
    vec2 d = mat2(0.7071, -0.7071, 0.7071, 0.7071) * q;
    float diag = (exp(-abs(d.y) * 180.0) * exp(-abs(d.x) * 6.0) + exp(-abs(d.x) * 180.0) * exp(-abs(d.y) * 6.0)) * 0.45;
    float pulse = 0.9 + 0.1 * sin(uTime * 1.6);
    vec3 col = vec3(1.0, 0.8, 0.5) * (halo + (cross * 0.42 + diag * 0.5) * pulse) + vec3(1.0, 0.93, 0.8) * core;
    col *= on * (1.0 + flash * 1.5) * (1.0 - uDim * 0.5) * uFade;
    gl_FragColor = vec4(col, 1.0);
  }
`

export default function Star({ y }: { y: number }) {
  const group = useRef<THREE.Group>(null)
  const geometry = useMemo(() => buildStar(BUDGET.star), [])
  const material = useMemo(() => pointsMaterial(STAR_VERT), [])
  const glow = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: U.uTime, uStar: U.uStar, uDim: U.uDim, uFade: U.uFade },
        vertexShader: GLOW_VERT,
        fragmentShader: GLOW_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  )
  useFrame(({ camera }) => {
    const g = group.current
    if (!g) return
    // face the camera, with a slow sway so the outline catches the light
    g.quaternion.copy(camera.quaternion)
    g.rotateZ(Math.sin(U.uTime.value * 0.4) * 0.05)
  })
  return (
    <group ref={group} position={[0, y, 0]}>
      <mesh material={glow} renderOrder={3} frustumCulled={false}>
        <planeGeometry args={[2.6, 2.6]} />
      </mesh>
      <points geometry={geometry} material={material} renderOrder={4} frustumCulled={false} />
    </group>
  )
}
