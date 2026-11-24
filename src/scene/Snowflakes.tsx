import { useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { isTall, mobile } from './config'
import { POINT_SIZE, pointsMaterial, rng } from './uniforms'

/**
 * A few real six-pointed snowflakes, each drawn in fine points of light,
 * turning slowly as they drift down through the night in front of and around the tree.
 */
const FLAKES = mobile ? 8 : 14

function build() {
  const r = rng(612)
  const pos: number[] = []
  const a: number[] = [] // flake id, local x, local y, brightness
  const b: number[] = [] // distance from the centre (for the glint running along the arms)
  for (let f = 0; f < FLAKES; f++) {
    const pts: [number, number, number][] = []
    const style = f % 3 // 0 fern-like dendrite, 1 plate with a hexagon, 2 star with V branches
    const line = (x0: number, y0: number, x1: number, y1: number, n: number, br: number) => {
      for (let i = 0; i <= n; i++) {
        const t = i / n
        pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, br])
      }
    }
    for (let k = 0; k < 6; k++) {
      const th = (k * Math.PI) / 3
      const c = Math.cos(th)
      const s = Math.sin(th)
      // the main arm: a continuous line, a bright bead at its tip
      line(0, 0, c, s, 30, 0.95)
      pts.push([c * 1.04, s * 1.04, 1.6])
      const branch = (at: number, len: number, spread: number, br: number) => {
        for (const side of [-1, 1]) {
          const bt = th + side * spread
          line(c * at, s * at, c * at + Math.cos(bt) * len, s * at + Math.sin(bt) * len, Math.max(4, Math.round(len * 26)), br)
        }
      }
      if (style === 0) {
        branch(0.3, 0.2, 0.95, 0.85)
        branch(0.52, 0.28, 0.85, 0.85)
        branch(0.74, 0.2, 0.8, 0.85)
        branch(0.88, 0.1, 0.75, 0.8)
      } else if (style === 1) {
        // a small hexagonal plate round the centre, then short barbs
        const h0 = 0.32
        const nx = Math.cos(th + Math.PI / 3)
        const ny = Math.sin(th + Math.PI / 3)
        line(c * h0, s * h0, nx * h0, ny * h0, 10, 1.05)
        branch(0.62, 0.16, 1.05, 0.85)
        branch(0.82, 0.12, 1.05, 0.85)
      } else {
        branch(0.45, 0.34, 0.6, 0.9)
        branch(0.7, 0.2, 0.6, 0.85)
      }
    }
    // a bright little heart
    for (let i = 0; i < 10; i++) {
      const t = (i / 10) * Math.PI * 2
      pts.push([Math.cos(t) * 0.06, Math.sin(t) * 0.06, 1.5])
    }
    pts.push([0, 0, 1.8])
    for (const [x, y, br] of pts) {
      pos.push(0, 0, 0)
      a.push(f, x, y, br * (0.92 + r() * 0.16))
      b.push(Math.hypot(x, y))
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aA', new THREE.Float32BufferAttribute(a, 4))
  g.setAttribute('aD', new THREE.Float32BufferAttribute(b, 1))
  return g
}

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uFade;
  uniform float uIntro;
  uniform float uWide;
  attribute vec4 aA; // flake, local x, local y, brightness
  attribute float aD; // distance from the flake's centre
  varying vec3 vColor;
  varying float vAlpha;
  ${POINT_SIZE}
  float h(float n) { return fract(sin(n * 91.7) * 43758.5453); }
  void main() {
    float f = aA.x;
    // each flake has its own lane, depth, speed and size; it falls, sways and turns
    float speed = 0.16 + h(f + 1.0) * 0.12;
    float fall = fract(h(f + 2.0) + uTime * speed / 11.0);
    vec3 c = vec3((h(f + 3.0) * 2.0 - 1.0) * uWide, 10.0 - fall * 11.0, -1.5 + h(f + 4.0) * 5.5);
    c.x += sin(uTime * 0.35 + f * 1.7) * 0.35;
    float size = 0.11 + h(f + 5.0) * 0.1;
    float ang = uTime * (0.15 + h(f + 6.0) * 0.25) * (h(f + 7.0) < 0.5 ? -1.0 : 1.0);
    float tilt = 0.6 + 0.4 * sin(uTime * 0.4 + f); // turning in depth, like a coin
    vec2 l = aA.yz * size;
    l = vec2(cos(ang) * l.x - sin(ang) * l.y, sin(ang) * l.x + cos(ang) * l.y);
    l.x *= tilt;
    vec4 mv = modelViewMatrix * vec4(c, 1.0);
    mv.xy += l; // always facing us
    gl_Position = projectionMatrix * mv;
    float edge = smoothstep(0.0, 0.08, fall) * smoothstep(1.0, 0.85, fall);
    // now and then a glint runs out along the arms, like light catching ice
    float glint = pow(max(0.0, sin(uTime * 1.6 + f * 2.3 - aD * 7.0)), 18.0) * step(0.5, h(f + 9.0 + floor(uTime * 0.2)));
    vAlpha = pointSize(mv, 0.0105 + glint * 0.006) * edge * uFade * smoothstep(0.8, 1.0, uIntro);
    // ice blue at the arms, white at the tips and the heart
    vec3 ice = mix(vec3(0.62, 0.8, 1.0), vec3(1.0, 0.99, 0.96), smoothstep(0.9, 1.5, aA.w));
    vColor = ice * aA.w * (0.6 + glint * 1.6);
  }
`

export default function Snowflakes() {
  const size = useThree((s) => s.size)
  const tall = isTall(size.width / size.height)
  const geometry = useMemo(build, [])
  const material = useMemo(() => pointsMaterial(VERT, { uWide: { value: 6 }, uDof: { value: 0.03 } }), [])
  material.uniforms.uWide.value = tall ? 2.6 : 7.5
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={5} />
}
