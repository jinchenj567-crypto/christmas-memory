import { useMemo } from 'react'
import * as THREE from 'three'
import { BUDGET, GLSL_SHAPE, SPIRAL_TURNS, TREE_H, mobile, radiusAt } from './config'
import { POINT_SIZE, gauss, pointsMaterial, rng } from './uniforms'

// kinds: 0 shell, 1 inner volume, 2 spiral garland, 3 ground orbit, 4 outer haze
const PALETTE: [THREE.Color, number][] = [
  [new THREE.Color('#ffc46e'), 0.545], // warm gold
  [new THREE.Color('#ffd796'), 0.16], // pale gold
  [new THREE.Color('#e8973f'), 0.1], // amber
  [new THREE.Color('#f5e6c8'), 0.09], // champagne
  [new THREE.Color('#dfe7ff'), 0.045], // silver white
  [new THREE.Color('#1f6b52'), 0.06], // deep green
]

// warm only, softened so gold stays the tree's voice
const ORNAMENTS = ['#e9826c', '#d9503e', '#d9503e', '#ee8a3e', '#f4b3a0'].map((c) => new THREE.Color(c))
const ORNAMENT = mobile ? 0.035 : 0.045 // of the shell, about 2.5% of all the tree's lights

function pick(r: () => number) {
  let u = r()
  for (const [c, w] of PALETTE) {
    if ((u -= w) <= 0) return c
  }
  return PALETTE[0][0]
}

export function buildTree(count: number) {
  const r = rng(20261224)
  const param = new Float32Array(count * 4)
  const start = new Float32Array(count * 3)
  const rand = new Float32Array(count * 4)
  const color = new Float32Array(count * 3)
  const TAU = Math.PI * 2

  // light clusters scattered over the surface give the shell its uneven, organic density
  const clusters = Array.from({ length: 90 }, () => {
    const h = 1 - Math.sqrt(0.04 + 0.92 * r())
    return { h, th: r() * TAU, s: 0.04 + r() * 0.07 }
  })

  const c = new THREE.Color()
  for (let i = 0; i < count; i++) {
    const u = r()
    const kind = u < 0.56 ? 0 : u < 0.68 ? 1 : u < 0.85 ? 2 : u < 0.93 ? 3 : 4
    let h = 0
    let th = 0
    let rf = 1
    let size = 0.03
    let speed = 0
    let bright = 1
    c.copy(pick(r))

    if (kind === 0) {
      if (r() < 0.3) {
        const cl = clusters[Math.floor(r() * clusters.length)]
        h = cl.h + gauss(r) * cl.s * 0.6
        th = cl.th + (gauss(r) * cl.s) / Math.max(0.15, radiusAt(cl.h) / 1.9)
        bright = 1.25
      } else {
        // area weighted over the cone, thinned between the spiral bands
        for (let k = 0; k < 12; k++) {
          h = 1 - Math.sqrt(r())
          th = r() * TAU
          const band = 0.5 + 0.5 * Math.cos(th - h * SPIRAL_TURNS * TAU)
          if (r() < 0.1 + 0.9 * Math.pow(band, 3.2)) break
        }
      }
      h = Math.min(0.995, Math.max(0, h))
      rf = 1 - Math.pow(r(), 2.2) * 0.26
      size = 0.016 + Math.pow(r(), 3) * 0.05
      speed = 0.012 + r() * 0.035
      bright *= 0.7 + r() * 0.65
    } else if (kind === 1) {
      h = 1 - Math.sqrt(r())
      rf = Math.sqrt(r()) * 0.78
      size = 0.018 + r() * 0.025
      speed = 0.01 + r() * 0.02
      bright = 0.45 + r() * 0.4
      c.lerp(new THREE.Color('#d98a3a'), 0.4)
    } else if (kind === 2) {
      // two ribbons climbing the tree, slightly loose so they read as flowing light
      const ribbon = r() < 0.5 ? 0 : Math.PI
      h = r()
      th = ribbon + gauss(r) * 0.07
      rf = 0.05 + gauss(r) * 0.035
      size = 0.02 + r() * 0.028
      speed = 0.006 + r() * 0.006
      bright = 1.1 + r() * 0.9
      c.set(r() < 0.6 ? '#f7e3bb' : '#ffd38a')
    } else if (kind === 3) {
      // orbit lines on the floor, denser near the trunk
      const ringR = 0.25 + Math.pow(r(), 1.5) * 3.1
      const snapped = r() < 0.55 ? Math.round(ringR / 0.42) * 0.42 + gauss(r) * 0.025 : ringR
      rf = Math.max(0.2, snapped)
      h = -0.02 + gauss(r) * 0.012 // y position for this kind
      th = r() * TAU
      size = 0.012 + r() * 0.02
      speed = (0.05 + r() * 0.04) / Math.sqrt(rf)
      bright = (0.55 + r() * 0.5) * (1.1 - rf / 4)
      if (r() < 0.25) c.set('#dfe7ff')
    } else {
      h = 1 - Math.sqrt(r())
      rf = 1.06 + Math.pow(r(), 1.5) * 0.4
      size = 0.01 + r() * 0.018
      speed = 0.008 + r() * 0.02
      bright = 0.7 + r() * 0.8
    }

    // a few warm ornament lights hung along the garlands: rose gold, ember, amber, warm white.
    // they hold still on the spiral and breathe slowly, each on its own beat
    let orn = false
    if (kind === 0 && r() < ORNAMENT) {
      orn = true
      h = 0.04 + r() * 0.9
      th = (r() < 0.5 ? 0 : Math.PI) + h * SPIRAL_TURNS * TAU + gauss(r) * 0.16
      rf = 1.0 + r() * 0.05
      size = 0.065 + r() * 0.03
      speed = 0
      bright = 0.78 + r() * 0.3
      c.copy(ORNAMENTS[Math.floor(r() * ORNAMENTS.length)])
    }

    // green and silver accents sit a little dimmer so they read as depth, not as confetti
    const isGreen = c.g > c.r
    if (isGreen) {
      bright *= 0.85
      size *= 1.35
    }

    param.set([h, th, rf, orn ? 0.25 : kind], i * 4)
    color.set([c.r * bright, c.g * bright, c.b * bright], i * 3)

    // start somewhere in a wide shell around the tree, biased to the sides
    const a = r() * TAU
    const rad = 6 + r() * 6
    start.set([Math.cos(a) * rad, 2.5 + gauss(r) * 2.6, Math.sin(a) * rad * 0.8 - 1.0], i * 3)

    const hh = kind === 3 ? 0 : kind === 2 ? r() * 0.4 : h
    const delay = Math.min(0.55, r() * 0.3 + hh * 0.26 + (kind === 3 ? 0 : 0.03))
    rand.set([r(), size, speed, delay], i * 4)
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
  g.setAttribute('aParam', new THREE.BufferAttribute(param, 4))
  g.setAttribute('aStart', new THREE.BufferAttribute(start, 3))
  g.setAttribute('aRand', new THREE.BufferAttribute(rand, 4))
  g.setAttribute('aColor', new THREE.BufferAttribute(color, 3))
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, TREE_H / 2, 0), 12)
  return g
}

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uIntro;
  uniform float uReveal;
  uniform float uDim;
  uniform float uFade;
  uniform float uScatterVis;
  uniform float uShow;
  uniform float uBang;
  uniform float uMonth[12];
  uniform float uFlash[12];
  uniform vec3 uTapPoint;
  uniform float uTapAge;
  uniform float uHold;
  uniform vec3 uHoldPoint;
  uniform float uRelease;
  uniform float uRings[4];
  uniform float uCombo;
  attribute vec4 aParam;
  attribute vec3 aStart;
  attribute vec4 aRand;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;
  ${GLSL_SHAPE}
  ${POINT_SIZE}
  const float TURNS = ${SPIRAL_TURNS.toFixed(3)};
  vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }

  void main() {
    float h = aParam.x, th = aParam.y, rf = aParam.z, kind = aParam.w;
    float seed = aRand.x, size = aRand.y, spd = aRand.z, delay = aRand.w;
    float fade = 1.0;
    vec3 p;
    if (kind < 1.5) {
      th += uTime * spd;
      float r = radiusAt(h) * rf * (1.0 + 0.02 * sin(uTime * 0.7 + seed * 50.0));
      p = vec3(cos(th) * r, h * TREE_H + 0.025 * sin(uTime * 0.55 + seed * 31.0), sin(th) * r);
    } else if (kind < 2.5) {
      float hh = fract(h + uTime * spd);
      float a = th + hh * TURNS * 6.2831853;
      float r = radiusAt(hh) * 1.02 + rf;
      p = vec3(cos(a) * r, hh * TREE_H, sin(a) * r);
      fade = smoothstep(0.0, 0.06, hh) * smoothstep(0.98, 0.84, hh);
      h = hh;
    } else if (kind < 3.5) {
      float a = th + uTime * spd;
      p = vec3(cos(a) * rf, h, sin(a) * rf);
      h = 0.0;
      fade = smoothstep(3.5, 2.2, rf);
    } else {
      th += uTime * spd;
      float r = radiusAt(h) * rf;
      p = vec3(cos(th) * r, h * TREE_H + 0.08 * sin(uTime * 0.4 + seed * 20.0), sin(th) * r);
    }

    // the opening: one seed of light blooms into a turning nebula...
    vec3 core = vec3(0.0, TREE_H * 0.46, 0.0);
    vec3 born = mix(core + (aStart - core) * 0.03, aStart, uBang);
    born = rotY(born, (1.0 - uBang) * (2.6 + seed * 1.5));
    // ...then a golden whirlwind spirals it into the tree
    float t = clamp((uIntro - delay) / 0.45, 0.0, 1.0);
    float e = 1.0 - pow(1.0 - t, 3.0);
    vec3 q = mix(born, p, e);
    q = rotY(q, (1.0 - e) * (3.4 + seed * 3.0));
    q.y += (1.0 - e) * e * 2.2 * (seed - 0.3);
    float fly = 4.0 * e * (1.0 - e); // brightest mid-flight, like sparks with a tail
    // pressed and held: nearby lights are drawn gently toward the finger, the reach growing as it charges
    float holdNear = 0.0;
    if (uHold > 0.0 && kind < 2.5) {
      float hd = length(q - uHoldPoint);
      holdNear = 1.0 - smoothstep(0.0, 0.45 + uHold * 1.9, hd);
      q = mix(q, uHoldPoint, holdNear * uHold * 0.22);
    }

    // glow front climbing from the base to the tip
    float lit = 1.0 - smoothstep(uReveal - 0.12, uReveal, h);
    float band = exp(-pow((h - uReveal) / 0.035, 2.0)) * step(uReveal, 1.05);
    float bright = mix(0.26, 1.0, lit) + band * 1.5;

    // months: January at the base, December under the star. Memories make a month richer.
    int m = int(clamp(floor(h * 12.0), 0.0, 11.0));
    float strength = kind < 2.5 ? uMonth[m] : 0.0;
    float flash = kind < 2.5 ? uFlash[m] : 0.0;
    // about a fifth of the shell only appears once its month holds memories
    float orn = step(0.2, kind) * step(kind, 0.3);
    float memo = step(fract(seed * 7.31), 0.2) * step(kind, 0.5) * (1.0 - orn);
    float memVis = mix(1.0, strength, memo);
    bright *= 1.0 + strength * 0.55;
    bright += flash * (1.2 + 1.2 * memo);
    // held light: glowing where pressed; once let go it climbs the tree to the star
    bright += holdNear * uHold * 2.6 + holdNear * holdNear * uHold * 2.0;
    float ra = uTime - uRelease;
    if (ra > 0.0 && ra < 1.7 && kind < 2.5) {
      float h0 = clamp(uHoldPoint.y / TREE_H, 0.0, 1.0);
      float hf = mix(h0, 1.02, smoothstep(0.0, 1.2, ra));
      bright += exp(-pow((h - hf) / 0.07, 2.0)) * (1.0 - smoothstep(1.2, 1.7, ra)) * 3.0;
    }
    // quick taps: each sends a ring of light from the base to the top; the ornaments join in
    for (int i = 0; i < 4; i++) {
      float rt = uTime - uRings[i];
      if (rt > 0.0 && rt < 1.3 && kind < 1.5) bright += exp(-pow((h - rt / 1.05) / 0.06, 2.0)) * (1.0 - smoothstep(1.0, 1.3, rt)) * 3.2;
    }
    if (uCombo > 0.01) bright += uCombo * orn * step(0.5, fract(uTime * 2.2 + seed * 5.0)) * 1.8;
    if (uTapAge < 1.9 && kind < 2.5) {
      // the touched branches flare, and a wave of light spreads through the tree from there
      vec3 offset = p - uTapPoint;
      float d = length(offset);
      // nearby lights catch it one after another, nearest first, each a quick twinkle
      float near = 1.0 - smoothstep(0.0, 1.0, d);
      float when = d * 0.5 + fract(seed * 17.0) * 0.12;
      float catchLight = exp(-pow((uTapAge - when) / 0.1, 2.0)) * near;
      // and one fine ripple runs out through the branches
      float wave = exp(-pow((d - uTapAge * 2.2) / 0.09, 2.0)) * (1.0 - smoothstep(0.35, 1.2, uTapAge));
      bright += catchLight * 4.4 + wave * 1.2 + near * near * 0.9 * (1.0 - smoothstep(0.0, 0.8, uTapAge));
    }

    // the light show: light runs up the garlands, rings sweep up the tree, ornaments blink in turn
    if (uShow > 0.0) {
      float chase = (kind > 1.5 && kind < 2.5) ? pow(0.5 + 0.5 * sin(h * 40.0 - uTime * 7.0), 5.0) : 0.0;
      // two rings of light sweeping up the tree, one after the other
      float r1 = exp(-pow((h - fract(uTime * 0.34)) / 0.06, 2.0));
      float r2 = exp(-pow((h - fract(uTime * 0.34 + 0.5)) / 0.06, 2.0));
      float ring = kind < 1.5 ? r1 + r2 : 0.0;
      float blink = orn * step(0.5, fract(uTime * 1.4 + seed * 5.0));
      bright *= 1.0 - uShow * 0.35; // the rest dims a little so the moving light reads
      bright += uShow * (chase * 3.6 + ring * 3.0 + blink * 2.4);
    }
    float tw = 0.74 + 0.26 * sin(uTime * (0.9 + seed * 2.4) + seed * 90.0);
    tw = mix(tw, 0.6 + 0.4 * sin(uTime * (0.45 + seed * 0.5) + seed * 60.0), orn);
    float sparkle = (1.0 - orn) * step(0.86, fract(seed * 13.7)) * pow(max(0.0, sin(uTime * (0.35 + seed * 0.6) + seed * 200.0)), 30.0) * 2.4;

    vec4 mv = modelViewMatrix * vec4(q, 1.0);
    gl_Position = projectionMatrix * mv;
    float a = pointSize(mv, size * (1.0 + sparkle * 0.25 + fly * 0.7));
    float seedGlow = smoothstep(0.0, 0.06, uBang) * (0.55 + 0.45 * (1.0 - uBang));
    float arrive = max(max(smoothstep(0.0, 0.35, t), seedGlow * (1.0 - t)), uScatterVis * 0.55);
    vAlpha = a * fade * arrive * (1.0 - uDim * 0.55) * uFade * max(memVis, flash);
    // the young nebula burns bright, then cools as it spreads
    float young = (1.0 - uBang) * (1.0 - t) * step(0.001, uBang);
    vec3 col = aColor * (bright * tw + sparkle) * (1.0 + fly * 1.3 + young * 3.0);
    vColor = mix(col, col * vec3(1.15, 0.95, 0.7), clamp(flash, 0.0, 1.0) * 0.5);
  }
`

export default function TreeParticles({ share }: { share: number }) {
  const geometry = useMemo(() => buildTree(BUDGET.tree), [])
  const material = useMemo(() => pointsMaterial(VERT), [])
  geometry.setDrawRange(0, Math.floor(BUDGET.tree * share))
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={2} />
}
