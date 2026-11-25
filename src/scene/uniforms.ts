import * as THREE from 'three'

/** Uniforms shared by every particle material, written once per frame by the Director. */
export const U = {
  uTime: { value: 0 },
  uIntro: { value: 0 }, // 0..1 particles converge
  uReveal: { value: -0.2 }, // glow front height, -0.2 .. 1.2 (normalised tree height)
  uStar: { value: 0 }, // star ignition 0..1 (+ flash overshoot)
  uDim: { value: 0 }, // 0..1 while a photo is open
  uPixelRatio: { value: 1 },
  uScale: { value: 600 }, // css px per world unit at distance 1
  uFocus: { value: 12 },
  uDof: { value: 0.2 },
  uCocMax: { value: 2.4 },
  uSizeMul: { value: 1 },
  uFade: { value: 1 }, // the outer world (tree, star, air) fades while entering the globe
  uScatterVis: { value: 0 }, // keep scattered particles visible (year review)
  uShow: { value: 0 }, // 0..1 while the light show runs
  uBang: { value: 1 }, // 0..1: the opening seed of light blooming into a nebula
  uMonth: { value: new Array(12).fill(0) as number[] }, // memory strength per month 0..1
  uFlash: { value: new Array(12).fill(0) as number[] }, // momentary glow per month
  uTapPoint: { value: new THREE.Vector3() },
  uTapAge: { value: 1.9 },
  uHold: { value: 0 }, // 0..1 while the tree is being pressed and held
  uHoldPoint: { value: new THREE.Vector3() },
  uRelease: { value: -99 }, // clock time the held light was let go
  uRings: { value: [-99, -99, -99, -99] }, // clock times of rings sent up by quick taps
  uCombo: { value: 0 }, // 0..1 while taps keep coming
}

export type Uniforms = typeof U

export const rng = (seed: number) => {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const gauss = (r: () => number) => {
  const u = Math.max(1e-6, r())
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r())
}

/** Soft round sprite + defocus bokeh, shared by all point clouds. */
export const POINT_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vCoc;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float d2 = dot(c, c);
    if (d2 > 1.0) discard;
    float glow = exp(-d2 * 5.0);
    float core = exp(-d2 * 26.0);
    float sharp = glow * 0.5 + core * 0.95;
    // out of focus: a flat disc with a faint bright rim, like a lens bokeh
    float disc = smoothstep(1.0, 0.82, sqrt(d2)) * (0.42 + 0.22 * smoothstep(0.55, 0.95, sqrt(d2)));
    float a = mix(sharp, disc, smoothstep(0.25, 1.4, vCoc));
    gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
  }
`

/** Point size / depth-of-field helper shared by the vertex shaders. */
export const POINT_SIZE = /* glsl */ `
  uniform float uPixelRatio;
  uniform float uScale;
  uniform float uFocus;
  uniform float uDof;
  uniform float uCocMax;
  uniform float uSizeMul;
  varying float vCoc;
  // returns alpha multiplier; writes gl_PointSize
  float pointSize(vec4 mv, float size) {
    float depth = max(-mv.z, 0.1);
    float coc = min(abs(depth - uFocus) * uDof, uCocMax);
    vCoc = coc;
    float px = size * uSizeMul * (1.0 + coc * 1.5) * uScale * uPixelRatio / depth;
    float a = 1.0 / (1.0 + coc * coc * 0.9);
    float minPx = 1.6 * uPixelRatio;
    if (px < minPx) { a *= (px * px) / (minPx * minPx); px = minPx; }
    gl_PointSize = min(px, 72.0 * uPixelRatio);
    return a;
  }
`

export function pointsMaterial(vertexShader: string, extra: Record<string, THREE.IUniform> = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, ...extra },
    vertexShader,
    fragmentShader: POINT_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
}
