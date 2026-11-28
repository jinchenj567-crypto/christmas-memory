import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import { Bloom, EffectComposer, Noise, ToneMapping, Vignette } from '@react-three/postprocessing'
import { BlendFunction, ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import { fx, orbit, spin, store } from '../store'
import { restartClock } from './effects'
import { stage } from '../poster'
import { monthCounts } from '../memories'
import { DRAW_SHARE, LAYOUT, T, TREE_H, capture, clamp01, clock, dprFor, easeInOut, easeOut, forcedLevel, isTall, mobile, span } from './config'
import { POINT_SIZE, U, pointsMaterial } from './uniforms'
import TreeParticles from './TreeParticles'
import TreeTap from './TreeTap'
import Star from './Star'
import Globe, { globe } from './Globe'
import Fireworks from './Fireworks'
import Gifts from './Gifts'
import Snowflakes from './Snowflakes'
import Comet from './Comet'
import Ignite from './Ignite'
import Ascent from './Ascent'
import Wish, { WISH_TIME } from './Wish'
import FireworksShow from './FireworksShow'
import Universe, { entryPose, focusPose, inside, photoPos, universe } from './Universe'
import Ritual, { RT } from './Ritual'
import Review, { RV, reviewPlan } from './Review'
import { Air, Backdrop, FloorGlow } from './Atmosphere'
import { focusStep } from './actions'

const FOV = 32
const IN_TIME = 3.2
const OUT_TIME = 2.8

/** 0 = outside, 1 = inside the globe; follows the flight in progress. */
/** 0..1 while a replay sends the lights back out (the camera rises with it). */
let replayRise = 0
let prevT = 0
const FINALE = 8.4

export function enterProgress() {
  const s = store.get()
  if (s.trans) {
    const k = (clock.now() - s.trans.t0) / (s.trans.dir === 'in' ? IN_TIME : OUT_TIME)
    return s.trans.dir === 'in' ? clamp01(k) : 1 - clamp01(k)
  }
  return s.view === 'inside' ? 1 : 0
}

const _tmp = new THREE.Vector3()
const _center = new THREE.Vector3(0, 2.6, 0)

// ---------------------------------------------------------------------------
// Director: timeline, shared uniforms, month glow, the flight state machine.
// ---------------------------------------------------------------------------
function Director() {
  const state = useThree()
  stage.canvas = state.gl.domElement
  stage.advance = state.advance
  if (import.meta.env.DEV) (window as any).__r3f = state
  const target = useRef(new Array(12).fill(0))

  useFrame(({ gl, size, camera }, dt) => {
    if (clock.start < 0) clock.start = performance.now()
    const t = clock.now()
    const s = store.get()
    U.uTime.value = t

    if (s.trans) {
      const k = (t - s.trans.t0) / (s.trans.dir === 'in' ? IN_TIME : OUT_TIME)
      if (k >= 1) {
        if (s.trans.dir === 'in') {
          store.set({ trans: null, view: 'inside' })
        } else {
          for (const { month } of s.pendingTreeLights) U.uFlash.value[month] = Math.max(U.uFlash.value[month], 0.95)
          store.set({ trans: null, view: 'main', pendingTreeLights: [] })
        }
      }
    }
    const e = enterProgress()
    globe.enter = clamp01(e / 0.5)
    U.uFade.value = 1 - THREE.MathUtils.smoothstep(e, 0.08, 0.4)
    universe.in = THREE.MathUtils.smoothstep(e, 0.46, 0.75)

    // intro gather, and the year review dissolving / regathering the tree
    let gather = span(t, T.gather)
    let star = easeOut(span(t, [T.star, T.star + 1.2])) + Math.exp(-Math.pow((t - T.star - 0.35) / 0.3, 2)) * 0.7
    let scatterVis = 0
    if (s.review) {
      const rt = t - s.review.t0
      const plan = reviewPlan(s.review.t0, s.review.skipAt)
      const out = 1 - easeInOut(span(rt, [0, RV.scatter]))
      const back = easeInOut(span(rt, [plan.end, plan.end + RV.regather]))
      gather *= rt < plan.end ? out : back
      scatterVis = rt < plan.end ? 1 : 1 - back
      const relight = plan.end + RV.regather - 0.6
      star =
        rt < relight
          ? THREE.MathUtils.lerp(star, 0.18, clamp01(rt / 1.5))
          : 0.18 + easeOut(clamp01((rt - relight) / 1.2)) * 0.82 + Math.exp(-Math.pow((rt - relight - 0.35) / 0.3, 2)) * 0.9
    }
    // replaying the opening: the lights fly back out into the night first, then it all begins again
    // the opening seed of light; a replay draws every light back into it first
    let bang = easeOut(span(t, [0.15, 1.55]))
    replayRise = 0
    if (fx.replay > 0) {
      const k = (performance.now() - fx.replay) / 1000
      const out = easeInOut(clamp01(k / 1.6))
      gather *= 1 - out
      star *= 1 - out
      bang = Math.min(bang, 1 - out)
      replayRise = out
      if (k >= 1.7) restartClock()
    }
    U.uBang.value = bang
    // the opening ends with fireworks
    if (prevT < FINALE && t >= FINALE && t < FINALE + 1) fx.fireworks = t
    prevT = t
    // the light show: the star pulses with it
    const sk = t - fx.show
    const show = sk > 0 ? THREE.MathUtils.smoothstep(sk, 0, 0.6) * (1 - THREE.MathUtils.smoothstep(sk, 8.6, 10)) : 0
    U.uShow.value = show
    star += show * (0.25 + 0.35 * Math.pow(0.5 + 0.5 * Math.sin(t * 5.2), 3))
    // a wish arriving at the top
    star += Math.exp(-Math.pow((t - fx.wish - WISH_TIME) / 0.35, 2)) * 1.3
    // a soft flash of the star when held light arrives, or a run of taps peaks
    star += Math.exp(-Math.pow((t - fx.star) / 0.3, 2)) * 1.0
    U.uIntro.value = gather
    U.uScatterVis.value = scatterVis
    U.uStar.value = star
    U.uReveal.value = -0.15 + 1.35 * easeInOut(span(t, T.reveal))

    // memory strength per month; the ritual holds its month back until the light arrives
    const counts = monthCounts()
    for (const { month } of s.pendingTreeLights) counts[month]--
    const rit = s.ritual
    for (let m = 0; m < 12; m++) {
      let c = counts[m]
      if (rit && rit.month === m && t - rit.t0 < RT.light) c = Math.max(0, c - 1)
      target.current[m] = 1 - Math.exp(-c * 0.6)
      U.uMonth.value[m] += (target.current[m] - U.uMonth.value[m]) * (1 - Math.exp(-dt * 1.3))
      U.uFlash.value[m] *= Math.exp(-dt * 1.2)
    }

    // depth of field and dimming
    U.uDim.value += ((s.sheet !== null ? 1 : 0) - U.uDim.value) * (1 - Math.exp(-dt * 3))
    if (e > 0.5) {
      U.uFocus.value = camera.position.distanceTo(photoPos(inside.f, _tmp))
      U.uDof.value = 0.09
    } else {
      U.uFocus.value = THREE.MathUtils.lerp(camera.position.distanceTo(_center) - 0.4, 3.6, U.uDim.value)
      U.uDof.value = (mobile ? 0.06 : 0.16) + U.uDim.value * 0.12
      if (s.review) U.uDof.value = 0.06 // keep the scattered stardust fine, not big bokeh discs
    }
    U.uPixelRatio.value = gl.getPixelRatio()
    U.uScale.value = size.height / (2 * Math.tan(THREE.MathUtils.degToRad(FOV) / 2))

    if (!s.introDone && t > T.ui) store.set({ introDone: true })
  }, -2)
  return null
}

// ---------------------------------------------------------------------------
// Camera: frames tree + globe, dives into the globe, glides between memories.
// ---------------------------------------------------------------------------
function Rig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  const pointer = useThree((s) => s.pointer)
  const par = useRef(new THREE.Vector2())
  const cur = useRef({ pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false })
  const v = useMemo(
    () => ({ mp: new THREE.Vector3(), ml: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), pos: new THREE.Vector3(), look: new THREE.Vector3() }),
    [],
  )

  useFrame((_, dt) => {
    const aspect = size.width / size.height
    const tall = isTall(aspect)
    const t = clock.now()
    const s = store.get()

    // the main composition
    const L = tall ? LAYOUT.tall : LAYOUT.wide
    const cx = tall ? -0.12 : -0.45
    // portrait: the tree and its ring of presents must sit between the tagline and the dock,
    // whatever the phone's shape (WeChat's bars make the view shorter and relatively wider)
    const compactPhone = tall && size.height <= 700
    const fitH = tall ? (compactPhone ? (size.height < 610 ? 13.2 : 12.2) : 10.6) : 7.0
    const fitW = tall ? 5.9 : 6.2
    let dist = Math.max(fitH, fitW / aspect) / (2 * Math.tan(THREE.MathUtils.degToRad(FOV) / 2))
    dist *= 1 + 0.45 * (1 - easeInOut(span(t, [0, 9])))
    const calm = !mobile && s.view === 'main' && !s.trans && !spin.dragging && !s.sheet
    if (calm) par.current.lerp(pointer, 1 - Math.exp(-dt * 2))
    else par.current.multiplyScalar(Math.exp(-dt * 2))
    // the opening: from high in the starry sky, spiralling down to the tree
    const land = Math.min(easeInOut(span(t, [0.2, 8.8])), 1 - replayRise)
    const introYaw = -0.95 * (1 - land)
    const introLift = 4.2 * Math.pow(1 - land, 1.6)
    const yaw = par.current.x * 0.06 + Math.sin(t * 0.07) * 0.025 + orbit.yaw + introYaw
    const ty = tall ? (compactPhone ? 2.3 : 2.75) : 2.55
    // turn about the tree itself, so the tree stays the centre of every view
    // portrait: turn about the middle of the scene (tree and the presents in front), so nothing swings away
    const px = tall ? cx : L.tree[0]
    const pz = L.tree[2] + (tall ? 2.4 : 0.4)
    const ox = cx - px
    const oz = L.tree[2] + 0.4 - pz
    v.ml.set(px + ox * Math.cos(yaw) + oz * Math.sin(yaw), ty + introLift * 0.55, pz - ox * Math.sin(yaw) + oz * Math.cos(yaw))
    const d = dist * orbit.zoom * (1 + orbit.pitch * 0.25)
    const lift = 0.5 + par.current.y * 0.22 + orbit.pitch * d + introLift
    v.mp.set(v.ml.x + Math.sin(yaw) * d * Math.cos(orbit.pitch), ty + lift, v.ml.z + Math.cos(yaw) * d * Math.cos(orbit.pitch))
    _center.copy(v.ml)

    const e = enterProgress()
    if (e <= 0.0001) {
      v.pos.copy(v.mp)
      v.look.copy(v.ml)
    } else if (e < 0.5) {
      // glide towards the globe, accelerating, until we are inside its glow
      const u = e / 0.5
      const uu = u * u * (3 - 2 * u)
      const g = globe.world
      v.a.copy(v.mp).sub(g).normalize()
      v.b.copy(g).addScaledVector(v.a, globe.radius * 0.12)
      v.c.copy(g).addScaledVector(v.a, v.mp.distanceTo(g) * 0.42).add(v.d.set(0, 0.35, 0))
      const k = 1 - uu
      v.pos.set(0, 0, 0).addScaledVector(v.mp, k * k).addScaledVector(v.c, 2 * k * uu).addScaledVector(v.b, uu * uu)
      v.look.copy(v.ml).lerp(g, THREE.MathUtils.smoothstep(u, 0, 0.55))
    } else {
      // inside: arrive from the swirl and settle in front of the memory
      const u = easeOut((e - 0.5) / 0.5)
      entryPose(v.a, v.b)
      focusPose(inside.f, inside.z, aspect, v.c, v.d)
      v.pos.copy(v.a).lerp(v.c, u)
      v.look.copy(v.b).lerp(v.d, u)
    }

    // everything above is already eased (intro dolly, flights, the arc position inside)
    const c = cur.current
    c.pos.copy(v.pos)
    c.look.copy(v.look)
    camera.position.copy(c.pos)
    camera.lookAt(c.look)
    // the star's ignition shakes the view, just for a moment
    const sk = t - T.star
    if (sk > 0 && sk < 0.9 && !s.review) {
      const amp = 0.075 * Math.exp(-sk * 5.5)
      camera.position.x += Math.sin(sk * 61) * amp
      camera.position.y += Math.sin(sk * 47 + 1.3) * amp * 0.8
    }
  }, -1)
  return null
}

/**
 * Passing through the globe's surface: not a flash, but a moment of deep night
 * filled with golden stardust that drifts past and wraps around the viewer,
 * with only a faint warm light ahead.
 */
const PASS_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uPass;
  attribute vec4 aA; // angle, radius, depth phase, speed
  attribute vec4 aB; // size, brightness, seed, -
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;
  ${POINT_SIZE}
  void main() {
    float t = uTime;
    float ph = fract(aA.z + t * aA.w);
    float z = -0.6 - (1.0 - ph) * 16.0;          // flows towards the viewer
    float ang = aA.x + t * 0.32 + z * 0.045;      // a slow spiral, like being wrapped
    float rad = aA.y * (0.7 + 0.3 * ph);
    vec3 p = vec3(cos(ang) * rad, sin(ang) * rad * 0.8, z);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float fade = smoothstep(-16.6, -12.0, z) * smoothstep(-0.6, -2.2, z);
    float tw = 0.65 + 0.35 * sin(t * (1.0 + aB.z * 2.0) + aB.z * 40.0);
    vAlpha = pointSize(mv, aB.x) * uPass * fade;
    vColor = aColor * aB.y * tw;
  }
`

function buildPassDust(n: number) {
  const a = new Float32Array(n * 4)
  const b = new Float32Array(n * 4)
  const col = new Float32Array(n * 3)
  const c = new THREE.Color()
  let s = 99
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < n; i++) {
    a.set([r() * Math.PI * 2, 0.35 + Math.pow(r(), 0.6) * 2.6, r(), 0.18 + r() * 0.25], i * 4)
    b.set([0.008 + Math.pow(r(), 3) * 0.03, 0.6 + r() * 1.2, r(), 0], i * 4)
    c.set(r() < 0.7 ? '#ffd796' : r() < 0.6 ? '#f6e7c9' : '#dfe6ff')
    col.set([c.r, c.g, c.b], i * 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
  g.setAttribute('aA', new THREE.BufferAttribute(a, 4))
  g.setAttribute('aB', new THREE.BufferAttribute(b, 4))
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
  return g
}

function Passage() {
  const veil = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uA: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        // deep midnight, a faint warm light ahead: hides the step between worlds without glare
        fragmentShader: `uniform float uA; varying vec2 vUv; void main(){ vec2 p = vUv - 0.5; float r = length(p); vec3 c = mix(vec3(0.11, 0.085, 0.06), vec3(0.006, 0.01, 0.026), smoothstep(0.0, 0.45, r)); gl_FragColor = vec4(c, uA); }`,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  )
  const geometry = useMemo(() => buildPassDust(mobile ? 700 : 1400), [])
  const own = useMemo(() => ({ uPass: { value: 0 }, uDof: { value: 0.03 }, uFocus: { value: 6 } }), [])
  const dust = useMemo(() => {
    const m = pointsMaterial(PASS_VERT, own)
    m.depthTest = false
    return m
  }, [own])
  const mesh = useRef<THREE.Mesh>(null)
  const pts = useRef<THREE.Points>(null)
  useFrame(({ camera }) => {
    const e = enterProgress()
    const on = store.get().trans ? 1 : 0
    const a = Math.exp(-Math.pow((e - 0.5) / 0.075, 2)) * on
    veil.uniforms.uA.value = a * 0.94
    own.uPass.value = Math.exp(-Math.pow((e - 0.5) / 0.17, 2)) * on
    if (mesh.current) mesh.current.visible = a > 0.002
    if (pts.current) {
      pts.current.visible = own.uPass.value > 0.003
      pts.current.position.copy(camera.position)
      pts.current.quaternion.copy(camera.quaternion)
    }
  })
  return (
    <>
      <mesh ref={mesh} material={veil} renderOrder={100} frustumCulled={false}>
        <planeGeometry args={[2, 2]} />
      </mesh>
      <points ref={pts} geometry={geometry} material={dust} renderOrder={101} frustumCulled={false} />
    </>
  )
}

/** Drag to turn the view around the tree outside (wheel / pinch to zoom); swipe / wheel between memories inside. */
function Gestures({ tree, tapAllowed }: { tree: React.RefObject<THREE.Group | null>; tapAllowed: React.RefObject<boolean> }) {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    const el = gl.domElement
    const pts = new Map<number, { x: number; y: number }>()
    let id = -1
    let x0 = 0
    let y0 = 0
    let lastX = 0
    let lastY = 0
    let lastT = 0
    let pinch0 = 0
    let zoom0 = 1
    let wheel = 0
    let wheelT = 0
    const pinchDist = () => {
      const [a, b] = [...pts.values()]
      return Math.hypot(a.x - b.x, a.y - b.y)
    }
    const down = (e: PointerEvent) => {
      const s = store.get()
      if (s.sheet || s.ritual || s.review || s.trans) return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pts.size === 2 && s.view === 'main') {
        tapAllowed.current = false
        pinch0 = pinchDist()
        zoom0 = orbit.zoom
        spin.dragging = false
        return
      }
      if (id !== -1) return
      tapAllowed.current = e.isPrimary && e.button === 0 && pts.size === 1
      id = e.pointerId
      x0 = lastX = e.clientX
      y0 = lastY = e.clientY
      lastT = performance.now()
      if (s.view === 'main') {
        spin.dragging = true
        orbit.vYaw = orbit.vPitch = 0
      }
    }
    const move = (e: PointerEvent) => {
      if (e.pointerId === id && Math.hypot(e.clientX - x0, e.clientY - y0) > 8) tapAllowed.current = false
      if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pts.size === 2 && pinch0 > 0) {
        orbit.zoom = THREE.MathUtils.clamp(zoom0 * (pinch0 / Math.max(20, pinchDist())), 0.74, 1.35)
        orbit.last = performance.now()
        return
      }
      if (e.pointerId !== id || !spin.dragging) return
      const now = performance.now()
      // portrait screens keep the presents and the globe in view: gentler, narrower turns
      const tall = el.clientWidth / el.clientHeight < 0.8
      const k = tall ? 2.2 / Math.max(560, el.clientWidth) : 4.2 / Math.max(320, el.clientWidth)
      const dx = (e.clientX - lastX) * k
      const dy = (e.clientY - lastY) * k
      orbit.max = tall ? 0.5 : 1.05
      orbit.yaw = THREE.MathUtils.clamp(orbit.yaw - dx, -orbit.max, orbit.max)
      orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + dy * 0.6, -0.12, 0.42)
      const dts = Math.max(0.008, (now - lastT) / 1000)
      orbit.vYaw = THREE.MathUtils.lerp(orbit.vYaw, -dx / dts, 0.4)
      orbit.vPitch = THREE.MathUtils.lerp(orbit.vPitch, (dy * 0.6) / dts, 0.4)
      orbit.last = now
      lastX = e.clientX
      lastY = e.clientY
      lastT = now
    }
    const up = (e: PointerEvent) => {
      if (e.type === 'pointercancel') tapAllowed.current = false
      pts.delete(e.pointerId)
      if (pts.size < 2) pinch0 = 0
      if (e.pointerId !== id) return
      id = -1
      if (spin.dragging) {
        spin.dragging = false
        orbit.vYaw = THREE.MathUtils.clamp(orbit.vYaw, -2.5, 2.5)
        orbit.vPitch = THREE.MathUtils.clamp(orbit.vPitch, -1.5, 1.5)
      } else if (store.get().view === 'inside') {
        const dx = e.clientX - x0
        const dy = e.clientY - y0
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) focusStep(dx < 0 ? 1 : -1)
      }
    }
    const onWheel = (e: WheelEvent) => {
      const s = store.get()
      if (s.view === 'main' && !s.trans && !s.sheet && !s.ritual && !s.review) {
        orbit.zoom = THREE.MathUtils.clamp(orbit.zoom * Math.exp(e.deltaY * 0.0012), 0.74, 1.35)
        orbit.last = performance.now()
        return
      }
      if (s.view !== 'inside') return
      const now = performance.now()
      if (now < wheelT) return
      wheel += e.deltaY + e.deltaX
      if (Math.abs(wheel) > 80) {
        focusStep(wheel > 0 ? 1 : -1)
        wheel = 0
        wheelT = now + 650
      }
    }
    el.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    el.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      el.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', onWheel)
    }
  }, [gl, tapAllowed])

  useFrame((_, dt) => {
    const s = store.get()
    // the tree keeps turning slowly on its own
    const idle = s.view === 'main' && !s.trans ? 0.1 : 0.03
    spin.vel += (idle - spin.vel) * (1 - Math.exp(-dt * 0.7))
    spin.angle += spin.vel * dt
    if (tree.current) tree.current.rotation.y = spin.angle
    // the view glides on after a drag, and after a while settles back to the composed framing
    if (!spin.dragging) {
      orbit.yaw = THREE.MathUtils.clamp(orbit.yaw + orbit.vYaw * dt, -orbit.max, orbit.max)
      orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + orbit.vPitch * dt, -0.12, 0.42)
      orbit.vYaw *= Math.exp(-dt * 2.6)
      orbit.vPitch *= Math.exp(-dt * 2.6)
      const away = (performance.now() - orbit.last) / 1000
      if (away > 10 || s.view !== 'main' || s.review || s.ritual) {
        const k = 1 - Math.exp(-dt * 0.6)
        orbit.yaw -= orbit.yaw * k
        orbit.pitch -= orbit.pitch * k
        orbit.zoom += (1 - orbit.zoom) * k
      }
    }
  }, -1)
  return null
}

function Stats({ level }: { level: number }) {
  const gl = useThree((s) => s.gl)
  const acc = useRef({ frames: 0, t: 0, worst: 0 })
  const readyFrames = useRef(0)
  useEffect(() => {
    gl.info.autoReset = false
  }, [gl])
  useFrame((_, dt) => {
    const a = acc.current
    const calls = gl.info.render.calls
    const points = gl.info.render.points
    const triangles = gl.info.render.triangles
    gl.info.reset()
    a.frames++
    a.t += dt
    a.worst = Math.max(a.worst, dt)
    if (++readyFrames.current === 3) document.getElementById('loader')?.classList.add('done')
    if (a.t >= 1) {
      const fps = Math.round(a.frames / a.t)
      ;(window as any).__stats = { fps, worstFrameMs: Math.round(a.worst * 1000), calls, points, triangles, dpr: gl.getPixelRatio(), size: [gl.domElement.width, gl.domElement.height], profile: mobile ? 'mobile' : 'desktop', level, view: store.get().view }
      a.frames = 0
      a.t = 0
      a.worst = 0
    }
  })
  return null
}

function World() {
  const size = useThree((s) => s.size)
  const setDpr = useThree((s) => s.setDpr)
  const [level, setLevel] = useState(forcedLevel ?? 0)
  const [locked, setLocked] = useState(forcedLevel !== null || capture)
  const tree = useRef<THREE.Group>(null)
  const tapAllowed = useRef(false)
  const outer = useRef<THREE.Group>(null)
  const L = isTall(size.width / size.height) ? LAYOUT.tall : LAYOUT.wide

  useEffect(() => {
    setDpr(dprFor(level))
  }, [level, setDpr])

  useFrame(() => {
    // the outer world is not drawn at all while we are inside the globe
    if (outer.current) outer.current.visible = enterProgress() < 0.56
  })

  return (
    <>
      {!locked && (
        <PerformanceMonitor
          ms={250}
          iterations={8}
          bounds={(refresh) => (refresh > 90 ? [50, 100] : [42, 58])}
          flipflops={2}
          onDecline={() => setLevel((l) => Math.min(2, l + 1))}
          onIncline={() => setLevel((l) => Math.max(0, l - 1))}
          onFallback={() => {
            setLevel((l) => Math.min(2, l + 1))
            setLocked(true)
          }}
        />
      )}
      <Director />
      <Rig />
      <Gestures tree={tree} tapAllowed={tapAllowed} />
      <Backdrop aspect={size.width / size.height} />
      <group ref={outer}>
        <group position={L.tree as unknown as THREE.Vector3Tuple}>
          <FloorGlow />
          <group ref={tree}>
            <TreeParticles share={DRAW_SHARE[level]} />
            <TreeTap tapAllowed={tapAllowed} />
          </group>
          <Gifts />
          <Star y={TREE_H + 0.16} />
        </group>
        <Fireworks />
        <Comet tree={L.tree} />
        <Ignite tree={L.tree} />
        <Ascent tree={L.tree} />
        <Wish tree={L.tree} />
        <FireworksShow />
        <Snowflakes />
        <Globe position={L.globe} scale={L.globeScale} tree={L.tree} />
        <Air />
        <Ritual treePos={L.tree} />
        <Review />
      </group>
      <Universe />
      <Passage />

      <EffectComposer multisampling={0}>
        <Bloom mipmapBlur levels={mobile ? (level === 2 ? 4 : 5) : 7} intensity={mobile ? 0.82 : 0.95} luminanceThreshold={0.88} luminanceSmoothing={0.35} radius={0.78} />
        <ToneMapping mode={ToneMappingMode.NEUTRAL} />
        <Vignette offset={0.3} darkness={0.62} />
        <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={mobile ? 0.035 : 0.16} />
      </EffectComposer>
      <Stats level={level} />
    </>
  )
}

export default function Scene() {
  return (
    <Canvas
      dpr={dprFor(forcedLevel ?? 0)}
      gl={{ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: capture, alpha: false }}
      camera={{ fov: FOV, near: 0.2, far: 320, position: [0, 3, 14] }}
      onPointerMissed={() => store.get().view === 'inside' && store.get().zoom && store.set({ zoom: false })}
    >
      <World />
    </Canvas>
  )
}
