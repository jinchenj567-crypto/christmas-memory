import { useMemo, useRef } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { UNIVERSE, clock, isTall, mobile } from './config'
import { POINT_SIZE, U, pointsMaterial, rng } from './uniforms'
import { memories, type Memory } from '../memories'
import { store, useStore } from '../store'

/*
 * The Memory Within — a still, kept place inside the globe.
 * Midnight sky, low mist on quiet water, one soft golden light far away.
 * The memories are not hung on a wall: they gather around the viewer on a
 * gentle curve. The one you are looking at comes close and clear; the others
 * wait further back, smaller and dimmer, slowly going into the mist.
 * Reflections are simulated (blurred mirrored copies + an analytic sky), no extra pass.
 */

export const ORIGIN = new THREE.Vector3(...UNIVERSE) // the viewer's place, at water level
const FOV = 32
const LIFT = 0.16 // a breath of air between a photo and the water
const VIEW_D = 7.2 // camera distance to the photo in focus

/** Live, eased state inside (fractional focus, zoom 0..1, light colour). */
export const inside = { f: 0, z: 0, tint: new THREE.Color('#e9d3a6'), warm: 0 }
export const universe = { in: 0 }

/** Height of the photo in focus, so it frames well for this aspect. */
export function photoHeight(m: Memory | undefined, aspect: number) {
  const visH = 2 * VIEW_D * Math.tan(THREE.MathUtils.degToRad(FOV) / 2)
  const visW = visH * aspect
  const a = m ? m.aspect : 0.8
  return Math.min(visH * (isTall(aspect) ? 0.44 : 0.5), (visW * 0.76) / a)
}

/** Where a photo sits, d = its distance (in photos) from the one in focus. */
function slot(d: number, tall: boolean, i: number) {
  const ad = Math.min(Math.abs(d), 4)
  const sd = Math.sign(d)
  const x = tall ? sd * (1.3 * ad + 0.15 * ad * ad) : sd * (4.05 * ad - 0.45 * ad * ad)
  const z = -(2.7 * ad + 0.55 * ad * ad)
  const s = 1 / (1 + 0.62 * ad)
  // a quiet unevenness so the memories never line up like frames on a wall
  const jitter = (Math.sin(i * 12.9898) * 43758.5453) % 1
  const y = (jitter - 0.25) * 0.42 * Math.min(ad, 1) + 0.1 * ad
  return { ad, x, y, z, s }
}

/** The point the camera looks at (centre of the photo in focus). */
export function focusPoint(out = new THREE.Vector3(), h = 2.4) {
  return out.copy(ORIGIN).add(new THREE.Vector3(0, LIFT + h / 2, 0))
}
// kept for the director's depth-of-field focus
export const photoPos = (_i: number, out = new THREE.Vector3()) => focusPoint(out)

/** Camera pose: the viewer stays; a small lean follows the photos as they move. */
export function focusPose(f: number, z: number, aspect: number, pos: THREE.Vector3, look: THREE.Vector3) {
  const tall = isTall(aspect)
  const list = memories()
  const s = store.get()
  const m = list[Math.max(0, Math.min(list.length - 1, s.focus))]
  const h = photoHeight(m, aspect)
  focusPoint(look, h)
  const lean = THREE.MathUtils.clamp(s.focus - f, -1.5, 1.5) * 0.35
  const t = clock.now()
  const dist = THREE.MathUtils.lerp(VIEW_D, tall ? 5.4 : 4.5, z)
  pos.set(look.x + lean + Math.sin(t * 0.11) * 0.12, look.y + THREE.MathUtils.lerp(tall ? 0.6 : 0.5, 0.05, z) + Math.sin(t * 0.08) * 0.04, look.z + dist)
  look.x += lean * 0.4
  look.y -= THREE.MathUtils.lerp(tall ? 0.62 : 0.34, 0.0, z)
}

/** Where the camera arrives from: high and far, gliding down to the water. */
export function entryPose(pos: THREE.Vector3, look: THREE.Vector3) {
  focusPoint(look)
  pos.copy(look).add(new THREE.Vector3(0, 5.5, 32))
}

// ---------------------------------------------------------------------------
// Sky + water share one analytic sky so the water can reflect it.
// ---------------------------------------------------------------------------
const SKY_FN = /* glsl */ `
  uniform vec3 uGlowDir;
  uniform vec3 uGlowCol;
  uniform float uWarm;
  vec3 mistCol() { return vec3(0.03, 0.042, 0.092) + vec3(0.01, 0.005, -0.007) * uWarm; }
  vec3 sky(vec3 d) {
    float y = max(d.y, 0.0);
    vec3 zenith = vec3(0.004, 0.008, 0.03);
    vec3 mid = vec3(0.012, 0.022, 0.066) + vec3(0.002, 0.0, -0.004) * uWarm;
    vec3 c = mix(mistCol(), mid, smoothstep(0.0, 0.14, y));
    c = mix(c, zenith, smoothstep(0.12, 0.7, y));
    vec2 hd = normalize(d.xz);
    float a = acos(clamp(dot(hd, normalize(uGlowDir.xz)), -1.0, 1.0));
    float glow = exp(-a * a * 10.0) * exp(-y * 16.0);
    float core = exp(-a * a * 50.0) * exp(-y * 40.0);
    float haze = exp(-a * a * 1.4) * exp(-y * 8.0);
    c += uGlowCol * (glow * 0.2 + core * 0.36 + haze * 0.03);
    return c;
  }
`

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vDir = wp.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`
const SKY_FRAG = /* glsl */ `
  uniform float uIn;
  varying vec3 vDir;
  ${SKY_FN}
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    vec3 c = sky(normalize(vDir));
    c += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
    gl_FragColor = vec4(c * uIn, 1.0);
  }
`

const WATER_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`
const WATER_FRAG = /* glsl */ `
  uniform float uIn;
  uniform float uTime;
  varying vec3 vWorld;
  ${SKY_FN}
  float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
  }
  void main() {
    vec3 v = normalize(cameraPosition - vWorld);
    float dist = length(vWorld.xz - cameraPosition.xz);
    // soft, irregular ripples (noise, not stripes), stilling towards the horizon
    vec2 q = vWorld.xz * 0.6 + vec2(uTime * 0.05, -uTime * 0.035);
    vec2 w = (vec2(vnoise(q), vnoise(q + 17.3)) - 0.5) * 0.06 * exp(-dist / 26.0);
    vec3 n = normalize(vec3(w.x, 1.0, w.y));
    vec3 r = reflect(-v, n);
    r.y = abs(r.y);
    // a quiet, half-reflective surface: water, not polished stone
    float fres = 0.08 + 0.5 * pow(1.0 - max(v.y, 0.0), 5.0);
    vec3 deep = vec3(0.004, 0.007, 0.018);
    vec3 c = mix(deep, sky(r), fres);
    // low mist lying on the water, thickening with distance
    float mist = 1.0 - exp(-max(dist - 4.0, 0.0) / 30.0);
    c = mix(c, mistCol() * 0.9 + uGlowCol * 0.012, mist * 0.75);
    c = mix(c, sky(normalize(vec3(vWorld.x - cameraPosition.x, 0.0, vWorld.z - cameraPosition.z))), smoothstep(55.0, 120.0, dist));
    gl_FragColor = vec4(c * uIn, 1.0);
  }
`

// slow banks of mist drifting low over the water, behind the memories
const MIST_FRAG = /* glsl */ `
  uniform float uIn;
  uniform float uTime;
  uniform float uSeed;
  uniform vec3 uGlowCol;
  uniform float uWarm;
  varying vec2 vUv;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int k = 0; k < 4; k++) { s += a * vnoise(p); p *= 2.1; a *= 0.5; } return s; }
  void main() {
    vec2 p = vUv;
    float band = smoothstep(0.0, 0.25, p.y) * smoothstep(1.0, 0.35, p.y) * smoothstep(0.0, 0.18, p.x) * smoothstep(1.0, 0.82, p.x);
    float n = fbm(vec2(p.x * 5.0 + uTime * 0.02 + uSeed, p.y * 2.2 - uTime * 0.01));
    float m = smoothstep(0.35, 0.85, n) * band;
    vec3 col = vec3(0.32, 0.38, 0.6) * 0.07 + uGlowCol * 0.02;
    gl_FragColor = vec4(col * m * uIn, 1.0);
  }
`

// ---------------------------------------------------------------------------
// Fine stardust, never between the viewer and the memories
// ---------------------------------------------------------------------------
function buildDust(n: number) {
  const r = rng(808)
  const a = new Float32Array(n * 4)
  const b = new Float32Array(n * 4)
  const col = new Float32Array(n * 3)
  const c = new THREE.Color()
  for (let i = 0; i < n; i++) {
    const u = r()
    let x: number, y: number, z: number, size: number
    if (u < 0.55) {
      // far behind, over the misty water and up into the sky
      x = (r() - 0.5) * 70
      z = -14 - r() * 50
      y = 0.3 + Math.pow(r(), 1.4) * 14
      size = 0.04 + r() * 0.08
    } else if (u < 0.85) {
      // high above the memories
      x = (r() - 0.5) * 26
      z = -12 + r() * 16
      y = 4.6 + r() * 7
      size = 0.015 + Math.pow(r(), 3) * 0.035
    } else {
      // a few motes rising slowly behind the photo in focus
      x = (r() - 0.5) * 7
      z = -3.5 - r() * 6
      y = 0.2 + r() * 4
      size = 0.012 + r() * 0.02
    }
    a.set([x, y, z, u < 0.85 ? 1 : 0], i * 4)
    b.set([r(), size, 0.03 + r() * 0.06, r() * 6.28], i * 4)
    c.set(r() < 0.72 ? '#f3dfb8' : '#dfe6ff').multiplyScalar(0.35 + r() * 0.75)
    col.set([c.r, c.g, c.b], i * 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
  g.setAttribute('aA', new THREE.BufferAttribute(a, 4))
  g.setAttribute('aB', new THREE.BufferAttribute(b, 4))
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
  return g
}

const DUST_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uIn;
  attribute vec4 aA;
  attribute vec4 aB;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;
  ${POINT_SIZE}
  void main() {
    float seed = aB.x, size = aB.y, spd = aB.z, ph = aB.w;
    vec3 p = aA.xyz;
    float rise = aA.w > 0.5 ? 0.15 : 0.35;
    float top = aA.w > 0.5 ? 14.0 : 4.4;
    p.y = mod(p.y + uTime * spd * rise, top);
    p.x += sin(uTime * 0.09 + ph) * 0.35;
    p.z += cos(uTime * 0.07 + ph * 1.3) * 0.3;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = 0.5 + 0.5 * sin(uTime * (0.5 + seed) + ph * 4.0);
    float edge = smoothstep(0.1, 0.8, p.y) * smoothstep(top, top - 1.5, p.y);
    vAlpha = pointSize(mv, size) * uIn * tw * edge;
    vColor = aColor;
  }
`

// ---------------------------------------------------------------------------
// A photograph and its reflection
// ---------------------------------------------------------------------------
const PHOTO_VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
const PHOTO_FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform float uLit;
  uniform float uFog;
  uniform float uOpacity;
  uniform float uWarm;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(map, vUv).rgb * mix(0.34, 0.94, uLit);
    // further memories sink into the night mist rather than turning grey
    vec3 fogCol = vec3(0.03, 0.042, 0.085) + vec3(0.008, 0.004, -0.006) * uWarm;
    c = mix(c, fogCol, uFog * 0.72);
    vec2 e = min(vUv, 1.0 - vUv);
    vec2 w = fwidth(vUv) * 1.2;
    float a = smoothstep(0.0, w.x, e.x) * smoothstep(0.0, w.y, e.y);
    gl_FragColor = vec4(c, a * uOpacity);
  }
`
const MIRROR_FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform float uLit;
  uniform float uFog;
  uniform float uOpacity;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    // the photo seen in still water: blurred, gently broken by ripples, fading fast
    float depth = vUv.y; // 0 at the water line
    vec2 uv = vUv;
    uv.x += sin(uv.y * 26.0 + uTime * 1.1) * 0.012 * (0.25 + depth) + sin(uv.y * 7.0 - uTime * 0.5) * 0.006;
    uv.y += sin(uv.x * 14.0 + uTime * 0.8) * 0.01 * depth;
    vec3 c = texture2D(map, uv, 4.0).rgb * 0.4;
    c += texture2D(map, uv + vec2(0.0, 0.035), 4.5).rgb * 0.3;
    c += texture2D(map, uv + vec2(0.0, 0.075), 5.0).rgb * 0.3;
    float fade = pow(1.0 - depth, 2.4) * 0.3;
    float sides = smoothstep(0.0, 0.12, uv.x) * smoothstep(1.0, 0.88, uv.x);
    c = mix(c * vec3(0.78, 0.84, 1.0) * mix(0.35, 0.7, uLit), vec3(0.02, 0.03, 0.06), depth * 0.5 + uFog * 0.5);
    gl_FragColor = vec4(c, fade * sides * uOpacity);
  }
`

function Photo({ m, i, warm }: { m: Memory; i: number; warm: THREE.IUniform }) {
  const mesh = useRef<THREE.Mesh>(null)
  const mirror = useRef<THREE.Mesh>(null)
  const size = useThree((s) => s.size)
  const camera = useThree((s) => s.camera)
  const mats = useMemo(() => {
    const uniforms = { map: { value: m.texture }, uLit: { value: 0 }, uFog: { value: 0 }, uOpacity: { value: 0 }, uTime: U.uTime, uWarm: warm }
    return {
      photo: new THREE.ShaderMaterial({ uniforms, vertexShader: PHOTO_VERT, fragmentShader: PHOTO_FRAG, transparent: true }),
      mirror: new THREE.ShaderMaterial({ uniforms, vertexShader: PHOTO_VERT, fragmentShader: MIRROR_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    }
  }, [m, warm])
  const st = useRef({ op: 0 })
  useFrame((_, dt) => {
    const me = mesh.current
    const mi = mirror.current
    if (!me || !mi) return
    const aspect = size.width / size.height
    const sl = slot(i - inside.f, isTall(aspect), i)
    const visible = sl.ad <= 3.4
    const show = visible || st.current.op > 0.01
    me.visible = mi.visible = show
    if (!show) return
    const t = clock.now()
    const h = photoHeight(m, aspect) * sl.s
    const w = h * m.aspect
    const bob = Math.sin(t * 0.42 + i * 1.3) * 0.025 * (1 + sl.ad * 0.5)
    me.position.set(ORIGIN.x + sl.x, ORIGIN.y + LIFT + h / 2 + sl.y + bob, ORIGIN.z + sl.z)
    // each memory turns a little towards the viewer: a space that gathers round you
    const yaw = Math.atan2(camera.position.x - me.position.x, camera.position.z - me.position.z) * 0.85
    me.rotation.set(0, yaw, Math.sin(t * 0.3 + i) * 0.006 * sl.ad)
    me.scale.set(w, h, 1)
    mi.position.set(me.position.x, ORIGIN.y - (me.position.y - ORIGIN.y), me.position.z)
    mi.rotation.set(0, yaw, 0)
    mi.scale.set(w, -h, 1)
    mi.visible = show && sl.ad < 2.6
    const k = 1 - Math.exp(-dt * 3)
    st.current.op += ((visible ? 1 : 0) * (1 - THREE.MathUtils.smoothstep(sl.ad, 2.6, 3.4)) - st.current.op) * k
    mats.photo.uniforms.uLit.value = 1 - THREE.MathUtils.smoothstep(sl.ad, 0.05, 1.0)
    mats.photo.uniforms.uFog.value = THREE.MathUtils.smoothstep(sl.ad, 0.3, 3.0)
    mats.photo.uniforms.uOpacity.value = st.current.op * universe.in
    mats.photo.depthWrite = mats.photo.uniforms.uOpacity.value > 0.98
    me.renderOrder = 10 - Math.round(sl.ad * 2) // nearer memories draw last
  })
  const click = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 8) return
    e.stopPropagation()
    const s = store.get()
    if (s.view !== 'inside' || s.trans) return
    if (s.focus === i) store.set({ zoom: !s.zoom, emptyMonth: null })
    else store.set({ focus: i, zoom: false, emptyMonth: null })
  }
  return (
    <>
      <mesh ref={mirror} material={mats.mirror} renderOrder={1} raycast={() => null}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <mesh ref={mesh} material={mats.photo} onClick={click}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </>
  )
}

/** A faint warm breath of light behind the memory in focus. */
const HALO_FRAG = /* glsl */ `
  uniform float uIn;
  uniform vec3 uGlowCol;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float g = exp(-dot(p * vec2(1.0, 1.5), p * vec2(1.0, 1.5)) * 2.4);
    gl_FragColor = vec4(uGlowCol * g * 0.045 * uIn, 1.0);
  }
`

const WARM_GLOW = new THREE.Color('#f4d39c')
const COOL_GLOW = new THREE.Color('#cfd8f2')
const NEUTRAL_GLOW = new THREE.Color('#f1dcb4')

export default function Universe() {
  const group = useRef<THREE.Group>(null)
  const sky = useRef<THREE.Mesh>(null)
  useStore((s) => s.memVersion)
  const list = memories()
  const shared = useMemo(
    () => ({
      uIn: { value: 0 },
      uGlowDir: { value: new THREE.Vector3(-0.32, 0, -1).normalize() },
      uGlowCol: { value: NEUTRAL_GLOW.clone() },
      uWarm: { value: 0 },
    }),
    [],
  )
  const skyMat = useMemo(() => new THREE.ShaderMaterial({ uniforms: shared, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false }), [shared])
  const waterMat = useMemo(() => new THREE.ShaderMaterial({ uniforms: { ...shared, uTime: U.uTime }, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, depthWrite: false }), [shared])
  const dust = useMemo(() => buildDust(mobile ? 320 : 640), [])
  const dustMat = useMemo(() => pointsMaterial(DUST_VERT, { uIn: shared.uIn }), [shared])
  const haloMat = useMemo(
    () => new THREE.ShaderMaterial({ uniforms: shared, vertexShader: PHOTO_VERT, fragmentShader: HALO_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    [shared],
  )
  const mists = useMemo(
    () =>
      [
        { z: -9, y: 1.1, w: 46, h: 3.2, seed: 1.3 },
        { z: -20, y: 1.6, w: 80, h: 5, seed: 7.1 },
        { z: -36, y: 2.4, w: 120, h: 8, seed: 3.7 },
      ].map((d) => ({
        ...d,
        mat: new THREE.ShaderMaterial({
          uniforms: { ...shared, uTime: U.uTime, uSeed: { value: d.seed } },
          vertexShader: PHOTO_VERT,
          fragmentShader: MIST_FRAG,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      })),
    [shared],
  )

  useFrame(({ camera }, dt) => {
    const s = store.get()
    const entering = s.trans?.dir === 'in'
    if (s.view !== 'inside' && !entering) {
      inside.f = s.focus
      inside.z = 0
    } else {
      inside.f += (s.focus - inside.f) * (1 - Math.exp(-dt * 2.0))
      inside.z += ((s.zoom ? 1 : 0) - inside.z) * (1 - Math.exp(-dt * 2.6))
    }
    shared.uIn.value = universe.in
    if (group.current) group.current.visible = universe.in > 0.001
    // restrained: warm photos warm the light a little, night photos cool it a little
    const m = list[Math.max(0, Math.min(list.length - 1, s.focus))]
    if (m) {
      inside.tint.lerp(m.tint, 1 - Math.exp(-dt * 1.0))
      const target = THREE.MathUtils.clamp((inside.tint.r - inside.tint.b) * 2.2, -1, 1)
      inside.warm += (target - inside.warm) * (1 - Math.exp(-dt * 1.0))
      shared.uWarm.value = inside.warm
      const g = shared.uGlowCol.value.copy(NEUTRAL_GLOW)
      if (inside.warm > 0) g.lerp(WARM_GLOW, inside.warm * 0.6)
      else g.lerp(COOL_GLOW, -inside.warm * 0.6)
    }
    if (sky.current) sky.current.position.copy(camera.position)
  })

  return (
    <group ref={group} visible={false}>
      <mesh ref={sky} material={skyMat} renderOrder={-5} frustumCulled={false}>
        <sphereGeometry args={[200, 32, 16]} />
      </mesh>
      <mesh material={waterMat} rotation-x={-Math.PI / 2} position={ORIGIN} renderOrder={-4}>
        <circleGeometry args={[220, 64]} />
      </mesh>
      {mists.map((d, k) => (
        <mesh key={k} material={d.mat} position={[ORIGIN.x, ORIGIN.y + d.y, ORIGIN.z + d.z]} renderOrder={-3} raycast={() => null}>
          <planeGeometry args={[d.w, d.h]} />
        </mesh>
      ))}
      <mesh material={haloMat} position={[ORIGIN.x - 0.2, ORIGIN.y + 1.5, ORIGIN.z - 1.2]} renderOrder={0} raycast={() => null}>
        <planeGeometry args={[9, 5.5]} />
      </mesh>
      <points geometry={dust} material={dustMat} position={ORIGIN} frustumCulled={false} renderOrder={2} />
      {list.map((m, i) => (
        <Photo key={m.id} m={m} i={i} warm={shared.uWarm} />
      ))}
    </group>
  )
}
