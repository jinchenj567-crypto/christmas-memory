import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { store } from '../store'
import { clock, radiusAt, TREE_H } from './config'
import { POINT_SIZE, U, pointsMaterial, rng } from './uniforms'

const LIFE = 1.1
const SPARKS = 14
const SPARK_VERT = /* glsl */ `
  uniform float uTapAge;
  uniform vec3 uTapPoint;
  uniform float uFade;
  attribute vec3 aSeed;
  varying vec3 vColor;
  varying float vAlpha;
  ${POINT_SIZE}
  void main() {
    float age = max(0.0, uTapAge - aSeed.x * 0.16);
    float turn = aSeed.y + age * 2.1;
    float spread = 0.055 + age * (0.16 + aSeed.z * 0.2);
    vec3 p = uTapPoint + vec3(cos(turn) * spread, age * (0.45 + aSeed.z * 0.56), sin(turn) * spread);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = pointSize(mv, 0.038 + aSeed.z * 0.032);
    vColor = mix(vec3(2.4, 1.22, 0.44), vec3(3.0, 2.2, 1.2), aSeed.z);
    vAlpha = size * smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.24, 0.94, age)) * uFade;
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
  const material = useMemo(() => pointsMaterial(SPARK_VERT), [])
  const seeds = useMemo(() => {
    const random = rng(718)
    return Float32Array.from({ length: SPARKS * 3 }, (_, i) => random() * (i % 3 === 1 ? Math.PI * 2 : 1))
  }, [])

  useEffect(() => () => { material.dispose(); U.uTapAge.value = LIFE }, [material])
  useFrame(() => {
    const age = Math.min(LIFE, clock.now() - started.current)
    U.uTapAge.value = canTapTree() && age >= 0 ? age : LIFE
    if (sparks.current) sparks.current.visible = U.uTapAge.value < LIFE
  })

  return <>
    <mesh ref={hitArea} position-y={TREE_H / 2} onClick={(event) => {
      if (!tapAllowed.current || event.delta > 8 || !canTapTree() || !hitArea.current?.parent) return
      event.stopPropagation()
      const point = hitArea.current.parent.worldToLocal(U.uTapPoint.value.copy(event.point))
      // Place the spark just in front of the visible garland.
      const radius = Math.hypot(point.x, point.z)
      if (radius > 0) {
        const scale = (radiusAt(point.y / TREE_H) + 0.06) / radius
        point.x *= scale
        point.z *= scale
      }
      started.current = clock.now()
    }}>
      <coneGeometry args={[1.92, TREE_H, 24, 1, true]} />
      <meshBasicMaterial visible={false} />
    </mesh>
    <points ref={sparks} material={material} visible={false} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[new Float32Array(SPARKS * 3), 3]} />
        <bufferAttribute attach="attributes-aSeed" args={[seeds, 3]} />
      </bufferGeometry>
    </points>
  </>
}
