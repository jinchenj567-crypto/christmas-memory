import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { BUDGET, TREE_H, clamp01, clock, easeOut, radiusAt } from './config'
import { POINT_SIZE, U, pointsMaterial, rng } from './uniforms'
import { globe } from './Globe'
import { memories } from '../memories'
import { store } from '../store'

/** Ritual timeline, seconds after it starts. */
export const RT = { appear: 0.9, dissolve: 1.5, toGlobe: 2.5, pulse: 3.9, beam: 4.1, light: 5.5, end: 7.2 }

// same noise in both shaders so a pixel and its dust leave together
const NOISE = /* glsl */ `
  float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
  }
  // 0..1: when this part of the photo turns to dust (edges first, then inward, broken up by noise)
  float release(vec2 uv) {
    // fine-grained, gently drifting from the top down: the photo comes apart like sand
    return clamp(0.2 * (1.0 - uv.y) + 0.45 * vnoise(uv * 9.0) + 0.35 * h21(floor(uv * 160.0)), 0.0, 1.0);
  }
`

const PHOTO_FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform float uT;
  uniform float uOpacity;
  varying vec2 vUv;
  ${NOISE}
  void main() {
    float front = (uT - ${RT.dissolve.toFixed(2)}) / 1.3;
    float r = release(vUv);
    if (r < front) discard;
    vec3 c = texture2D(map, vUv).rgb;
    float edge = smoothstep(0.03, 0.0, r - front) * step(0.0, front);
    c += vec3(1.0, 0.8, 0.52) * edge * 0.6;
    gl_FragColor = vec4(c, uOpacity);
  }
`

const DUST_VERT = /* glsl */ `
  uniform float uT;
  uniform vec3 uCenter;
  uniform vec3 uRight;
  uniform vec3 uUp;
  uniform vec3 uGlobe;
  uniform vec3 uTree;
  uniform float uGR;
  uniform sampler2D uMap;
  attribute vec2 aUV;
  attribute vec4 aS; // seed, role, -, size
  varying vec3 vColor;
  varying float vAlpha;
  ${POINT_SIZE}
  ${NOISE}
  vec3 bez(vec3 a, vec3 b, vec3 c, float t) { float k = 1.0 - t; return k * k * a + 2.0 * k * t * b + t * t * c; }
  vec3 h3(float s) { return vec3(fract(s * 3.17), fract(s * 5.71), fract(s * 9.33)) - 0.5; }
  void main() {
    float seed = aS.x, role = aS.y, size = aS.w;
    vec3 p;
    float alpha;
    vec3 col;
    if (role < 0.5) {
      float rel = release(aUV);
      vec3 photo = uCenter + uRight * (aUV.x * 2.0 - 1.0) + uUp * (aUV.y * 2.0 - 1.0);
      float t1 = clamp((uT - (${RT.dissolve.toFixed(2)} + rel * 1.3)) / 1.0, 0.0, 1.0);
      vec3 drift = (h3(seed) * vec3(0.5, 0.3, 0.5) + vec3(0.0, 0.25, 0.0)) * t1;
      vec3 p1 = photo + drift;
      float t2 = clamp((uT - (${RT.toGlobe.toFixed(2)} + rel * 0.8 + seed * 0.35)) / 1.35, 0.0, 1.0);
      float e2 = t2 * t2 * (3.0 - 2.0 * t2);
      vec3 ctrl = mix(p1, uGlobe, 0.55) + vec3(0.0, 0.6 + seed * 0.8, 0.0) + h3(seed * 7.0) * 0.8;
      vec3 target = uGlobe + h3(seed * 13.0) * uGR * 0.9;
      p = bez(p1, ctrl, target, e2);
      alpha = step(0.0001, t1) * (1.0 - smoothstep(0.82, 1.0, t2));
      vec3 tex = texture2D(uMap, aUV).rgb;
      col = mix(tex * 1.5 + 0.12, vec3(1.0, 0.8, 0.5) * 1.8, smoothstep(0.05, 0.6, t2));
    } else {
      float t3 = clamp((uT - (${RT.beam.toFixed(2)} + fract(seed * 13.7) * 1.1)) / (1.1 + fract(seed * 7.7) * 0.7), 0.0, 1.0);
      float e3 = t3 * t3 * (3.0 - 2.0 * t3);
      vec3 ctrl = mix(uGlobe, uTree, 0.5) + vec3(0.0, 1.0 + seed * 0.6, 0.0);
      p = bez(uGlobe, ctrl, uTree, e3) + h3(seed * 3.0) * (0.12 + 0.32 * sin(3.14159 * t3)) + vec3(0.0, sin(uT * 2.0 + seed * 40.0) * 0.04, 0.0);
      alpha = step(0.0001, t3) * smoothstep(0.0, 0.1, t3) * smoothstep(1.0, 0.85, t3);
      col = vec3(1.0, 0.8, 0.5) * 2.2;
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vAlpha = pointSize(mv, size) * alpha;
    vColor = col;
  }
`

function buildDust(n: number) {
  const r = rng(515)
  const uv = new Float32Array(n * 2)
  const s = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    const beam = i % 10 >= 6 // 40% form the golden stream to the tree
    uv.set([r(), r()], i * 2)
    s.set([r(), beam ? 1 : 0, 0, beam ? 0.012 + r() * 0.016 : 0.012 + r() * 0.02], i * 4)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
  g.setAttribute('aUV', new THREE.BufferAttribute(uv, 2))
  g.setAttribute('aS', new THREE.BufferAttribute(s, 4))
  return g
}

const _fwd = new THREE.Vector3()
const _up = new THREE.Vector3()
const _right = new THREE.Vector3()

export default function Ritual({ treePos }: { treePos: readonly [number, number, number] }) {
  const photo = useRef<THREE.Mesh>(null)
  const dustRef = useRef<THREE.Points>(null)
  const size = useThree((s) => s.size)
  const geometry = useMemo(() => buildDust(BUDGET.ritual), [])
  const own = useMemo(
    () => ({
      uT: { value: -1 },
      uCenter: { value: new THREE.Vector3() },
      uRight: { value: new THREE.Vector3() },
      uUp: { value: new THREE.Vector3() },
      uGlobe: { value: new THREE.Vector3() },
      uTree: { value: new THREE.Vector3() },
      uGR: { value: 0.6 },
      uMap: { value: null as THREE.Texture | null },
      // keep the stardust sharp: no depth-of-field blur on this layer
      uDof: { value: 0.012 },
    }),
    [],
  )
  const dustMat = useMemo(() => pointsMaterial(DUST_VERT, own), [own])
  const photoMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { map: own.uMap, uT: own.uT, uOpacity: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: PHOTO_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    [own],
  )
  const fired = useRef({ pulse: false, light: false })

  useFrame(({ camera }) => {
    const rit = store.get().ritual
    const p = photo.current
    const d = dustRef.current
    if (!p || !d) return
    if (!rit) {
      p.visible = d.visible = false
      fired.current = { pulse: false, light: false }
      return
    }
    const m = memories().find((x) => x.id === rit.id)
    const t = clock.now() - rit.t0
    own.uT.value = t
    if (m) own.uMap.value = m.texture
    p.visible = t < RT.dissolve + 1.6
    d.visible = t > RT.dissolve - 0.1

    // photo floats just in front of the viewer, a little above centre
    const cam = camera as THREE.PerspectiveCamera
    const D = 4
    const vh = 2 * D * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)
    const aspect = size.width / size.height
    const ph = Math.min(vh * 0.4, (vh * aspect * 0.7) / (m?.aspect ?? 1))
    const pw = ph * (m?.aspect ?? 1)
    camera.getWorldDirection(_fwd)
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion)
    _right.set(1, 0, 0).applyQuaternion(camera.quaternion)
    const a = easeOut(clamp01(t / RT.appear))
    own.uCenter.value.copy(camera.position).addScaledVector(_fwd, D).addScaledVector(_up, vh * 0.04)
    own.uRight.value.copy(_right).multiplyScalar(pw / 2)
    own.uUp.value.copy(_up).multiplyScalar(ph / 2)
    p.position.copy(own.uCenter.value)
    p.quaternion.copy(camera.quaternion)
    p.scale.set(pw * (0.94 + 0.06 * a), ph * (0.94 + 0.06 * a), 1)
    ;(photoMat.uniforms.uOpacity as THREE.IUniform).value = a

    own.uGlobe.value.copy(globe.world)
    own.uGR.value = globe.radius
    // the tree point for this month, on the side facing the viewer
    const h = (rit.month + 0.5) / 12
    const rad = radiusAt(h) * 0.85
    const dx = camera.position.x - treePos[0]
    const dz = camera.position.z - treePos[2]
    const l = Math.hypot(dx, dz) || 1
    own.uTree.value.set(treePos[0] + (dx / l) * rad, treePos[1] + h * TREE_H, treePos[2] + (dz / l) * rad)

    if (!fired.current.pulse && t > RT.pulse) {
      fired.current.pulse = true
      globe.pulse = 1
    }
    if (!fired.current.light && t > RT.light) {
      fired.current.light = true
      U.uFlash.value[rit.month] = 2.4
    }
    if (t > RT.end) store.set({ ritual: null })
  })

  return (
    <>
      <mesh ref={photo} material={photoMat} renderOrder={30} visible={false} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <points ref={dustRef} geometry={geometry} material={dustMat} renderOrder={31} visible={false} frustumCulled={false} />
    </>
  )
}
