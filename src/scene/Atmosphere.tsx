import { useMemo } from 'react'
import * as THREE from 'three'
import { BUDGET, TREE_H } from './config'
import { POINT_SIZE, U, gauss, pointsMaterial, rng } from './uniforms'

// ---------------------------------------------------------------------------
// Background: midnight blue fading to black, a faint warm breath behind the tree,
// dithered so the gradient never bands.
// ---------------------------------------------------------------------------
const BG_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }
`
const BG_FRAG = /* glsl */ `
  uniform float uReveal;
  uniform vec2 uAspect;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    vec2 uv = vUv;
    vec3 top = vec3(0.009, 0.015, 0.042);
    vec3 mid = vec3(0.004, 0.007, 0.020);
    vec3 bot = vec3(0.001, 0.0015, 0.004);
    vec3 col = mix(bot, mid, smoothstep(0.0, 0.55, uv.y));
    col = mix(col, top, smoothstep(0.5, 1.0, uv.y));
    vec2 c = (uv - vec2(0.5, 0.52)) * uAspect;
    float glow = exp(-dot(c, c) * 3.2);
    col += vec3(0.018, 0.012, 0.007) * glow * clamp(uReveal + 0.2, 0.0, 1.0);
    col += vec3(0.004, 0.007, 0.018) * exp(-dot(c, c) * 0.9);
    col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
    gl_FragColor = vec4(col, 1.0);
  }
`

export function Backdrop({ aspect }: { aspect: number }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uReveal: U.uReveal, uAspect: { value: new THREE.Vector2(1, 1) } },
        vertexShader: BG_VERT,
        fragmentShader: BG_FRAG,
        depthWrite: false,
        depthTest: false,
      }),
    [],
  )
  material.uniforms.uAspect.value.set(Math.max(1, aspect), Math.max(1, 1 / aspect))
  return (
    <mesh material={material} renderOrder={-10} frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  )
}

// ---------------------------------------------------------------------------
// Floor glow: a soft warm pool under the tree.
// ---------------------------------------------------------------------------
const FLOOR_FRAG = /* glsl */ `
  uniform float uReveal;
  uniform float uDim;
  uniform float uFade;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float g = (exp(-r * r * 7.0) * 0.5 + exp(-r * 3.5) * 0.12) * smoothstep(1.0, 0.55, r);
    vec3 col = vec3(1.0, 0.68, 0.34) * g * clamp(uReveal * 1.2, 0.0, 1.0) * (1.0 - uDim * 0.6) * uFade;
    gl_FragColor = vec4(col * 0.26, 1.0);
  }
`
export function FloorGlow() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uReveal: U.uReveal, uDim: U.uDim, uFade: U.uFade },
        vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: FLOOR_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  )
  return (
    <mesh material={material} rotation-x={-Math.PI / 2} position-y={-0.03} renderOrder={1}>
      <planeGeometry args={[8, 8]} />
    </mesh>
  )
}

// ---------------------------------------------------------------------------
// Stardust orbiting the tree + slow snow drifting through the whole frame.
// ---------------------------------------------------------------------------
function buildAir(dust: number, snow: number) {
  const n = dust + snow
  const r = rng(1225)
  const a = new Float32Array(n * 4) // x/radius, y, z/angle, kind
  const b = new Float32Array(n * 4) // seed, size, speed, phase
  const col = new Float32Array(n * 3)
  const gold = new THREE.Color('#ffcf8a')
  const champ = new THREE.Color('#f3e4c6')
  const silver = new THREE.Color('#d9e3ff')
  for (let i = 0; i < n; i++) {
    const isDust = i < dust
    if (isDust) {
      const rad = 1.0 + Math.pow(r(), 0.8) * 4.2
      a.set([rad, -0.3 + r() * (TREE_H + 1.8), r() * Math.PI * 2, 0], i * 4)
      b.set([r(), 0.008 + Math.pow(r(), 3) * 0.03, (0.02 + r() * 0.05) * (r() < 0.2 ? -1 : 1), r() * 6.28], i * 4)
      const c = r() < 0.7 ? gold : champ
      const k = 0.5 + r() * 1.1
      col.set([c.r * k, c.g * k, c.b * k], i * 3)
    } else {
      a.set([(r() - 0.5) * 16, r() * 10 - 1.5, -6 + r() * 15, 1], i * 4)
      b.set([r(), 0.012 + Math.abs(gauss(r)) * 0.008, 0.12 + r() * 0.16, r() * 6.28], i * 4)
      const k = 0.22 + r() * 0.35
      col.set([silver.r * k, silver.g * k, silver.b * k], i * 3)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
  g.setAttribute('aA', new THREE.BufferAttribute(a, 4))
  g.setAttribute('aB', new THREE.BufferAttribute(b, 4))
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
  return g
}

const AIR_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uIntro;
  uniform float uReveal;
  uniform float uDim;
  uniform float uFade;
  attribute vec4 aA;
  attribute vec4 aB;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;
  ${POINT_SIZE}
  void main() {
    float seed = aB.x, size = aB.y, spd = aB.z, ph = aB.w;
    vec3 p;
    float a = 1.0;
    if (aA.w < 0.5) {
      float ang = aA.z + uTime * spd;
      float y = aA.y + sin(uTime * 0.3 + ph) * 0.15;
      p = vec3(cos(ang) * aA.x, y, sin(ang) * aA.x);
      a = (0.55 + 0.45 * sin(uTime * (0.8 + seed * 1.5) + ph * 7.0)) * clamp(uReveal + 0.4, 0.15, 1.0);
    } else {
      float y = mod(aA.y - uTime * spd, 10.0) - 1.5;
      p = vec3(aA.x + sin(uTime * 0.25 + ph) * 0.35, y, aA.z + cos(uTime * 0.2 + ph * 1.3) * 0.25);
      a = smoothstep(-1.5, -0.6, y) * smoothstep(8.5, 7.0, y) * clamp(uIntro * 1.5, 0.0, 1.0);
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vAlpha = pointSize(mv, size) * a * (1.0 - uDim * 0.4) * uFade;
    vColor = aColor;
  }
`

export function Air() {
  const geometry = useMemo(() => buildAir(BUDGET.dust, BUDGET.snow), [])
  const material = useMemo(() => pointsMaterial(AIR_VERT), [])
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={5} />
}
