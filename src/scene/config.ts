// Shared constants, device profile and the intro timeline.

const hasWindow = typeof window !== 'undefined'
export const params = new URLSearchParams(hasWindow ? location.search : '')
const ua = hasWindow ? navigator.userAgent : ''
const isTouch = hasWindow && matchMedia('(pointer: coarse)').matches
export const isIOS = /iP(hone|ad|od)/.test(ua) || (hasWindow && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const isWeChat = /MicroMessenger/i.test(ua)
export const capture = import.meta.env.DEV && params.has('capture')
export const mobile = params.has('low') || isTouch
export const forcedLevel = params.has('level') ? Math.max(0, Math.min(2, Number(params.get('level')) || 0)) : null

// ---- tree shape (world units) ------------------------------------------------
export const TREE_H = 5.0
export const TREE_R = 1.9
export const SPIRAL_TURNS = 4.25

/** Silhouette radius at normalised height h (0 = base, 1 = tip). Mirrored in GLSL. */
export const radiusAt = (h: number) => TREE_R * Math.pow(Math.max(0, 1 - h), 1.08)

export const GLSL_SHAPE = /* glsl */ `
  const float TREE_H = ${TREE_H.toFixed(3)};
  const float TREE_R = ${TREE_R.toFixed(3)};
  float radiusAt(float h) { return TREE_R * pow(max(1.0 - h, 0.0), 1.08); }
`

// ---- particle budgets per profile --------------------------------------------
export const BUDGET = mobile
  ? { tree: 9000, dust: 520, snow: 260, star: 420, globe: 2600, stars: 1800, drift: 900, tunnel: 700, nebula: 5, ritual: 1400 }
  : { tree: 20000, dust: 1100, snow: 560, star: 700, globe: 5200, stars: 3600, drift: 1800, tunnel: 1400, nebula: 8, ritual: 2600 }

// pixel-ratio ladder per quality level (0 = best)
export const DPR_STEPS = mobile ? [isIOS ? 1.75 : 1.6, 1.35, 1] : [2, 1.5, 1]
export const dprFor = (level: number) => Math.min(hasWindow ? window.devicePixelRatio || 1 : 1, DPR_STEPS[level])
/** share of tree particles drawn per level */
export const DRAW_SHARE = [1, 1, 0.68]

// ---- intro timeline (seconds) ------------------------------------------------
export const T = {
  gather: [0.2, 5.6], // particles converge
  globe: [4.4, 7.4], // the memory globe condenses
  star: 5.9, // star ignites
  reveal: [6.3, 9.2], // glow climbs base -> tip
  ui: 9.2,
}

/** Clock for the intro; `?t=12` starts the scene already settled (for captures). */
export const clock = {
  start: -1,
  offset: params.has('t') ? Number(params.get('t')) || 0 : 0,
  now() {
    if (this.start < 0) return this.offset
    return (performance.now() - this.start) / 1000 + this.offset
  },
}

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
export const span = (t: number, [a, b]: number[]) => clamp01((t - a) / (b - a))
export const easeOut = (x: number) => 1 - Math.pow(1 - x, 3)
export const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

// ---- composition ---------------------------------------------------------------
export const GLOBE_R = 0.66
/** where the tree and the globe stand, per layout */
export const LAYOUT = {
  wide: { tree: [-0.55, 0, -0.2] as const, globe: [1.72, 0.55, 1.6] as const, globeScale: 0.62 },
  tall: { tree: [-0.18, 0, -0.35] as const, globe: [0.95, 0.49, 3.65] as const, globeScale: 0.55 },
}
export const isTall = (aspect: number) => aspect < 0.8

/** the memory universe lives far away from the tree; the camera jumps there inside the globe */
export const UNIVERSE = [0, 0, -600] as const
