import { useMemo } from 'react'
import * as THREE from 'three'
import { SPIRAL_TURNS, T, TREE_H, TREE_R, mobile } from './config'
import { POINT_SIZE, gauss, pointsMaterial, rng } from './uniforms'

/**
 * The opening's crescendo, three moments in one set of particles:
 *  - two ribbons of golden light wind up round the tree from the ground, drawing its spiral,
 *    and meet at the top just as the star catches fire;
 *  - the star's ignition sends out a shockwave: a shell of light and a wide ring across the night;
 *  - then golden dust is flung high and drifts down over everything like slow, glittering snow.
 */
const RIBBON = mobile ? 700 : 1400
const SHOCK = mobile ? 420 : 900
const DUST = mobile ? 520 : 1100
const CLIMB: [number, number] = [3.3, T.star]
const TOP = TREE_H + 0.16

function build() {
  const r = rng(1225)
  const n = RIBBON * 2 + SHOCK + DUST
  const a = new Float32Array(n * 4)
  const b = new Float32Array(n * 4)
  let i = 0
  // ribbons: kind 0, which ribbon, lag behind the head, jitter
  for (let k = 0; k < 2; k++)
    for (let j = 0; j < RIBBON; j++, i++) {
      const lag = Math.pow(r(), 1.25)
      a.set([k, lag, gauss(r) * 0.05, gauss(r) * 0.05], i * 4)
      b.set([0, r(), lag < 0.01 ? 0.07 : 0.03 + r() * 0.04, r() < 0.4 ? 1 : 0], i * 4)
    }
  // shockwave: kind 1, a direction, how far, and whether it rides the flat ring
  for (let j = 0; j < SHOCK; j++, i++) {
    const ring = j < SHOCK * 0.45
    const th = r() * 6.2832
    const d = ring ? new THREE.Vector3(Math.cos(th), gauss(r) * 0.03, Math.sin(th)) : new THREE.Vector3(gauss(r), gauss(r) * 0.85, gauss(r)).normalize()
    a.set([d.x, d.y, d.z, ring ? 1 : 0], i * 4)
    b.set([1, r(), 0.03 + r() * 0.04, r() < 0.5 ? 1 : 0], i * 4)
  }
  // golden dust: kind 2, flung out and up, then drifting down
  for (let j = 0; j < DUST; j++, i++) {
    const ang = r() * 6.2832
    const out = 0.6 + Math.pow(r(), 0.7) * 6.5
    a.set([Math.cos(ang) * out, 1.2 + r() * 3.2, Math.sin(ang) * out, r()], i * 4)
    b.set([2, r(), 0.022 + Math.pow(r(), 3) * 0.06, r() < 0.3 ? 1 : 0], i * 4)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
  g.setAttribute('aA', new THREE.BufferAttribute(a, 4))
  g.setAttribute('aB', new THREE.BufferAttribute(b, 4))
  return g
}

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uFade;
  attribute vec4 aA;
  attribute vec4 aB; // kind, seed, size, white
  varying vec3 vColor;
  varying float vAlpha;
  ${POINT_SIZE}
  const float TREE_H = ${TREE_H.toFixed(3)};
  const float TREE_R = ${TREE_R.toFixed(3)};
  const float TOP = ${TOP.toFixed(3)};
  void hide() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vAlpha = 0.0; vColor = vec3(0.0); vCoc = 0.0; }
  void main() {
    vec3 gold = vec3(1.0, 0.76, 0.42);
    vec3 col = mix(gold, vec3(1.0, 0.96, 0.86), aB.w);
    vec3 p;
    float alpha;
    float size = aB.z;
    if (aB.x < 0.5) {
      // a ribbon winding up the tree; its head leads, the rest trails behind and thins out
      float k = clamp((uTime - ${CLIMB[0].toFixed(2)}) / ${(CLIMB[1] - CLIMB[0]).toFixed(2)}, 0.0, 1.0);
      float head = k * k * (3.0 - 2.0 * k);
      float u = head - aA.y * 0.55;
      if (uTime < ${CLIMB[0].toFixed(2)} || u < 0.0) { hide(); return; }
      float after = uTime - ${CLIMB[1].toFixed(2)};
      // once at the top, the light pours into the star
      u = mix(u, 1.0, smoothstep(0.0, 0.45, after));
      float ang = u * ${SPIRAL_TURNS.toFixed(2)} * 6.2832 + aA.x * 3.14159 + uTime * 0.6;
      float rad = (TREE_R * (1.0 - u) + 0.08) * 1.12 + 0.12;
      p = vec3(cos(ang) * rad, u * TOP, sin(ang) * rad) + vec3(aA.z, aA.w, aA.z * 0.7) * (0.3 + aA.y * 1.2);
      float trail = 1.0 - aA.y;
      alpha = pow(trail, 1.5) * smoothstep(0.0, 0.1, k) * (1.0 - smoothstep(0.15, 0.6, after));
      float tw = 0.65 + 0.35 * sin(uTime * 18.0 + aB.y * 60.0);
      col *= (2.4 + 1.6 * step(aA.y, 0.01)) * tw;
    } else if (aB.x < 1.5) {
      // the shockwave from the star: a shell, and a ring flying wide across the night
      float age = uTime - ${T.star.toFixed(2)} - 0.05;
      if (age < 0.0 || age > 2.0) { hide(); return; }
      bool ring = aA.w > 0.5;
      float reach = ring ? 11.0 : 6.5;
      float r = reach * (1.0 - exp(-2.4 * age)) * (0.94 + aB.y * 0.12);
      p = vec3(0.0, TOP, 0.0) + aA.xyz * r;
      alpha = smoothstep(0.0, 0.04, age) * (1.0 - smoothstep(0.25, ring ? 2.0 : 1.4, age));
      col *= 2.0 + 4.0 * exp(-age * 4.0);
      size *= ring ? 1.2 : 1.0;
    } else {
      // golden dust flung from the star, drifting down like glittering snow
      float age = uTime - ${T.star.toFixed(2)} - 0.15 - aA.w * 0.4;
      if (age < 0.0 || age > 9.0) { hide(); return; }
      float rise = 1.0 - exp(-2.2 * age);
      p = vec3(0.0, TOP, 0.0) + vec3(aA.x, aA.y, aA.z) * rise;
      p.y -= max(0.0, age - 0.6) * (0.55 + aB.y * 0.35);
      p.x += sin(age * 1.3 + aB.y * 20.0) * 0.25;
      p.z += cos(age * 1.1 + aB.y * 17.0) * 0.25;
      if (p.y < 0.02) { hide(); return; }
      float tw = 0.5 + 0.5 * sin(age * (4.0 + aB.y * 6.0) + aB.y * 40.0);
      alpha = smoothstep(0.0, 0.1, age) * (1.0 - smoothstep(5.5, 9.0, age)) * (0.45 + 0.55 * tw);
      col *= 1.4 + 1.6 * exp(-age * 1.5);
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vAlpha = pointSize(mv, size) * max(alpha, 0.0) * uFade;
    vColor = col;
  }
`

export default function Ascent({ tree }: { tree: readonly [number, number, number] }) {
  const geometry = useMemo(build, [])
  const material = useMemo(() => pointsMaterial(VERT, { uDof: { value: 0.02 } }), [])
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={6} position={tree as unknown as THREE.Vector3Tuple} />
}
