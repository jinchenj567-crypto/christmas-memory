import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { clamp01, clock, easeInOut } from './config'
import { memories } from '../memories'
import { store } from '../store'

/** Year review timeline (seconds after start). */
export const RV = { scatter: 2.6, first: 2.4, each: 4.4, fade: 1.0, regather: 3.6, tail: 1.6, max: 24 }

export function reviewPlan(t0: number, skipAt?: number) {
  const n = Math.min(RV.max, memories().length)
  const naturalEnd = RV.first + n * RV.each
  const end = skipAt !== undefined ? Math.min(naturalEnd, skipAt - t0) : naturalEnd
  return { n, end, done: end + RV.regather + RV.tail }
}

/** Which photo is on screen at review time t, and how visible it is. */
export function reviewFrame(t: number, end: number) {
  const k = Math.floor((t - RV.first) / RV.each)
  const local = t - RV.first - k * RV.each
  const vis = t < RV.first || t > end ? 0 : clamp01(local / RV.fade) * clamp01((RV.each - local) / RV.fade)
  return { k, local, vis }
}

const _fwd = new THREE.Vector3()
const _up = new THREE.Vector3()
const _right = new THREE.Vector3()

/** Two planes alternate so one photo can dissolve into the next. */
export default function Review() {
  const a = useRef<THREE.Mesh>(null)
  const b = useRef<THREE.Mesh>(null)
  const size = useThree((s) => s.size)
  const mats = useMemo(() => [0, 1].map(() => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false })), [])

  useFrame(({ camera }) => {
    const rv = store.get().review
    const planes = [a.current, b.current]
    if (!rv) {
      planes.forEach((p) => p && (p.visible = false))
      return
    }
    const t = clock.now() - rv.t0
    const plan = reviewPlan(rv.t0, rv.skipAt)
    const list = memories()
    const cam = camera as THREE.PerspectiveCamera
    const D = 5
    const vh = 2 * D * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)
    const aspect = size.width / size.height
    camera.getWorldDirection(_fwd)
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion)
    _right.set(1, 0, 0).applyQuaternion(camera.quaternion)
    for (let slot = 0; slot < 2; slot++) {
      const p = planes[slot]
      if (!p) continue
      // each plane shows every other photo; check the current and previous index for this slot
      let shown = false
      for (const k of [Math.floor((t - RV.first) / RV.each), Math.floor((t - RV.first) / RV.each) - 1]) {
        if (k < 0 || k >= plan.n || k % 2 !== slot) continue
        const local = t - RV.first - k * RV.each
        if (local < 0 || local > RV.each + RV.fade || RV.first + k * RV.each > plan.end) continue
        const m = list[k]
        const fadeIn = clamp01(local / RV.fade)
        const fadeOut = clamp01((RV.each + RV.fade * 0.6 - local) / RV.fade)
        const cut = clamp01((plan.end - (RV.first + k * RV.each + local) + RV.fade) / RV.fade)
        const vis = easeInOut(Math.min(fadeIn, fadeOut, cut))
        const h = Math.min(vh * 0.56, (vh * aspect * 0.8) / m.aspect)
        const drift = (local / (RV.each + RV.fade)) * 2 - 1
        const zoom = 1 + 0.045 * (local / RV.each)
        p.position
          .copy(camera.position)
          .addScaledVector(_fwd, D)
          .addScaledVector(_up, vh * 0.05)
          .addScaledVector(_right, (k % 2 ? 1 : -1) * drift * 0.06)
        p.quaternion.copy(camera.quaternion)
        p.scale.set(h * m.aspect * zoom, h * zoom, 1)
        mats[slot].map = m.texture
        mats[slot].opacity = vis
        mats[slot].needsUpdate = mats[slot].userData.map !== m.texture
        mats[slot].userData.map = m.texture
        shown = vis > 0.001
        break
      }
      p.visible = shown
    }
    if (t > plan.done) store.set({ review: null })
  })

  return (
    <>
      <mesh ref={a} material={mats[0]} renderOrder={40} visible={false} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <mesh ref={b} material={mats[1]} renderOrder={41} visible={false} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </>
  )
}
