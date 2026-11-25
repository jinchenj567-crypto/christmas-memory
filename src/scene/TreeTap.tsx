import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { fx, store } from '../store'
import { clock, radiusAt, TREE_H } from './config'
import { POINT_SIZE, U, pointsMaterial, rng } from './uniforms'

const LIFE = 1.9
const BURST = 34 // small lights drifting up
const RING = 0
const STARS = 0
const SPARKS = BURST + RING + STARS
// one tap: sparks burst out of the tree and fall, a ring of light runs round the tree
// at that height, and a few four-point stars flash among the branches
const SPARK_VERT = /* glsl */ `
  uniform float uTapAge;
  uniform vec3 uTapPoint;
  uniform float uFade;
  attribute vec4 aSeed; // kind, a, b, c
  varying vec3 vColor;
  varying float vAlpha;
  ${POINT_SIZE}
  const float TREE_H = ${TREE_H.toFixed(3)};
  const float TREE_R = 1.9;
  void hide() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vAlpha = 0.0; vColor = vec3(0.0); vCoc = 0.0; }
  void main() {
    float kind = aSeed.x;
    vec3 p;
    float size;
    float alpha;
    vec3 col;
    if (kind < 0.5) {
      // a few small lights drift up from where the tree was touched
      float age = max(0.0, uTapAge - aSeed.w * 0.25);
      float turn = aSeed.y * 6.2832 + age * 1.6;
      float spread = 0.06 + age * (0.12 + aSeed.z * 0.14);
      p = uTapPoint + vec3(cos(turn) * spread, age * (0.35 + aSeed.z * 0.4), sin(turn) * spread);
      size = 0.018 + aSeed.z * 0.016;
      float twinkle = 0.55 + 0.45 * sin(age * 14.0 + aSeed.y * 30.0);
      alpha = smoothstep(0.0, 0.15, age) * (1.0 - smoothstep(0.5, 1.5, age)) * twinkle;
      col = mix(vec3(2.4, 1.7, 0.9), vec3(2.6, 2.4, 2.1), aSeed.z);
    } else if (kind < 1.5) {
      // a ripple of light at the touch: two fine circles of dots opening out, always facing us
      bool second = aSeed.w > 0.55;
      float age = max(0.0, uTapAge - (second ? 0.18 : 0.0));
      float grow = 1.0 - exp(-3.2 * age);
      float r = (second ? 0.05 + 0.32 * grow : 0.06 + 0.55 * grow);
      float a = aSeed.y * 6.2832;
      vec4 c = modelViewMatrix * vec4(uTapPoint, 1.0);
      vec4 mv = c + vec4(cos(a) * r, sin(a) * r, 0.04, 0.0);
      gl_Position = projectionMatrix * mv;
      float fade = smoothstep(0.0, 0.06, age) * (1.0 - smoothstep(0.35, 1.05, age));
      vAlpha = pointSize(mv, second ? 0.02 : 0.026) * fade * (second ? 0.85 : 1.0) * uFade;
      vColor = mix(vec3(3.6, 2.8, 1.6), vec3(4.0, 3.8, 3.4), aSeed.z) * (1.2 + 1.5 * exp(-age * 5.0));
      return;
    } else {
      // stars flashing among the branches near the touch
      float age = max(0.0, uTapAge - aSeed.w * 0.5);
      p = uTapPoint + (vec3(aSeed.y, aSeed.z, fract(aSeed.y * 7.0 + aSeed.z * 3.0)) - 0.5) * vec3(1.4, 1.2, 1.4);
      size = 0.16 + aSeed.w * 0.12;
      alpha = sin(clamp(age / 0.7, 0.0, 1.0) * 3.14159);
      col = vec3(3.6, 3.4, 3.0);
      // the first of them is the flash right where the finger touched
      if (aSeed.w < 0.12) { p = uTapPoint; size = 0.5; alpha = exp(-uTapAge * 7.0); col = vec3(4.0, 3.4, 2.4); }
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vAlpha = pointSize(mv, size) * max(alpha, 0.0) * uFade;
    vColor = col;
  }
`

function canTapTree() {
  const s = store.get()
  return s.introDone && s.view === 'main' && !s.trans && !s.sheet && !s.ritual && !s.review
}

export default function TreeTap({ tapAllowed }: { tapAllowed: RefObject<boolean> }) {
  const hitArea = useRef<THREE.Mesh>(null)
  const sparks = useRef<THREE.Points>(null)
  const started = useRef(-Infinity)
  const material = useMemo(() => pointsMaterial(SPARK_VERT, { uDof: { value: 0.025 } }), [])
  const seeds = useMemo(() => {
    const random = rng(718)
    const a = new Float32Array(SPARKS * 4)
    for (let i = 0; i < SPARKS; i++) a.set([i < BURST ? 0 : i < BURST + RING ? 1 : 2, random(), random(), random()], i * 4)
    return a
  }, [])

  useEffect(() => () => { material.dispose(); U.uTapAge.value = LIFE }, [material])
  // dev only: fire a tap at a fixed spot on the front of the tree, for recordings
  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as any).__tap = (h = 0.42, camera?: THREE.Camera) => {
      const parent = hitArea.current?.parent
      if (!parent || !camera) return
      // the point on the tree's surface that faces the camera
      const c = parent.worldToLocal(camera.position.clone())
      const a = Math.atan2(c.z, c.x)
      const r = radiusAt(h) + 0.06
      U.uTapPoint.value.set(Math.cos(a) * r, h * TREE_H, Math.sin(a) * r)
      started.current = clock.now()
    }
    ;(window as any).__hold = (h = 0.42, camera?: THREE.Camera) => {
      ;(window as any).__tap(h, camera)
      started.current = -Infinity
      U.uHoldPoint.value.copy(U.uTapPoint.value)
      hold.current = { active: true, t0: clock.now(), fired: false, suppressClick: false }
      tapAllowed.current = true
    }
    ;(window as any).__release = release
    ;(window as any).__U = U
    ;(window as any).__combo = (n = 5, gap = 0.25) => {
      for (let i = 0; i < n; i++) setTimeout(() => {
        const now = clock.now()
        const c = combo.current
        c.n = now - c.last < 0.5 ? c.n + 1 : 1
        c.last = now
        if (c.n >= 2) {
          U.uRings.value[c.ring] = now
          c.ring = (c.ring + 1) % 4
          U.uCombo.value = Math.min(1, 0.35 + c.n * 0.15)
          if (c.n === 5) fx.star = now + 0.9
        }
      }, i * gap * 1000)
    }
  }, [])
  // press and hold, and runs of quick taps
  const hold = useRef({ active: false, t0: 0, fired: false, suppressClick: false })
  const combo = useRef({ n: 0, last: -99, ring: 0 })

  const surfacePoint = (world: THREE.Vector3, out: THREE.Vector3) => {
    const point = hitArea.current!.parent!.worldToLocal(out.copy(world))
    // just in front of the visible garland
    const radius = Math.hypot(point.x, point.z)
    if (radius > 0) {
      const scale = (radiusAt(point.y / TREE_H) + 0.06) / radius
      point.x *= scale
      point.z *= scale
    }
    return point
  }

  const release = () => {
    const h = hold.current
    if (!h.active) return
    h.active = false
    // a long enough press sends its light up to the star, and swallows the click that follows
    if (h.fired) {
      h.suppressClick = true
      if (U.uHold.value > 0.25) {
        const now = clock.now()
        U.uRelease.value = now
        fx.star = now + 1.2
      }
    }
  }

  useEffect(() => {
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    return () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
    }
  }, [])

  useFrame((_, dt) => {
    const now = clock.now()
    const age = Math.min(LIFE, now - started.current)
    U.uTapAge.value = canTapTree() && age >= 0 ? age : LIFE
    if (sparks.current) sparks.current.visible = U.uTapAge.value < LIFE

    const h = hold.current
    // a drag turns the view instead, so it is not a press
    if (h.active && (!tapAllowed.current || !canTapTree())) {
      h.active = false
      h.fired = false
    }
    if (h.active) {
      const held = now - h.t0
      if (!h.fired && held > 0.4) {
        h.fired = true
        if (navigator.vibrate) navigator.vibrate(12)
      }
      const target = h.fired ? Math.min(1, (held - 0.4) / 1.6) : 0
      U.uHold.value += (target - U.uHold.value) * (1 - Math.exp(-dt * 8))
    } else {
      U.uHold.value *= Math.exp(-dt * 5)
      if (U.uHold.value < 0.002) U.uHold.value = 0
    }
    U.uCombo.value *= Math.exp(-dt * 1.4)
  })

  return <>
    <mesh ref={hitArea} position-y={TREE_H / 2}
      onPointerDown={(event) => {
        if (event.button !== 0 || !canTapTree() || !hitArea.current?.parent) return
        surfacePoint(event.point, U.uHoldPoint.value)
        hold.current = { active: true, t0: clock.now(), fired: false, suppressClick: false }
      }}
      onClick={(event) => {
      if (hold.current.suppressClick) {
        hold.current.suppressClick = false
        return
      }
      if (!tapAllowed.current || event.delta > 8 || !canTapTree() || !hitArea.current?.parent) return
      event.stopPropagation()
      surfacePoint(event.point, U.uTapPoint.value)
      const now = clock.now()
      started.current = now
      // quick taps in a row: from the second on, each sends a ring of light up the tree
      const c = combo.current
      c.n = now - c.last < 0.5 ? c.n + 1 : 1
      c.last = now
      if (c.n >= 2) {
        U.uRings.value[c.ring] = now
        c.ring = (c.ring + 1) % 4
        U.uCombo.value = Math.min(1, 0.35 + c.n * 0.15)
        if (c.n === 5 || (c.n > 5 && c.n % 4 === 1)) fx.star = now + 0.9
      }
    }}>
      <coneGeometry args={[1.92, TREE_H, 24, 1, true]} />
      <meshBasicMaterial visible={false} />
    </mesh>
    <points ref={sparks} material={material} visible={false} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[new Float32Array(SPARKS * 3), 3]} />
        <bufferAttribute attach="attributes-aSeed" args={[seeds, 4]} />
      </bufferGeometry>
    </points>
  </>
}
