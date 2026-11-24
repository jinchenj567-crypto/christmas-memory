import { useSyncExternalStore } from 'react'

export type View = 'main' | 'inside' | 'review'

export interface AppState {
  view: View
  /** camera flight into / out of the globe, started at clock time t0 */
  trans: { dir: 'in' | 'out'; t0: number } | null
  focus: number // index into memories() while inside
  zoom: boolean // the focused photo is pulled close with its story
  emptyMonth: number | null // a month without memories was asked for
  sheet: null | 'add' | 'share' | 'wish'
  wishText: string | null
  ritual: { id: string; month: number; t0: number } | null
  pendingTreeLights: { id: string; month: number }[]
  review: { t0: number; skipAt?: number } | null
  introDone: boolean
  loaded: boolean
  memVersion: number
  music: boolean
}

let state: AppState = {
  view: 'main',
  trans: null,
  focus: 0,
  zoom: false,
  emptyMonth: null,
  sheet: null,
  wishText: null,
  ritual: null,
  pendingTreeLights: [],
  review: null,
  introDone: false,
  loaded: false,
  memVersion: 0,
  music: false,
}
const subs = new Set<() => void>()

export const store = {
  get: () => state,
  set(patch: Partial<AppState>) {
    state = { ...state, ...patch }
    subs.forEach((f) => f())
  },
  subscribe(f: () => void) {
    subs.add(f)
    return () => subs.delete(f)
  },
}

export function useStore<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => sel(state), () => sel(state))
}

/** Tree spin shared between the drag handler and the particles. */
export const spin = { angle: 0.35, vel: 0.1, dragging: false }

/** The viewer's own orbit around the scene: drag to turn, wheel / pinch to zoom. */
/** One-shot effects started from the side buttons, as clock times (seconds). */
export const fx = { replay: -1, fireworks: -99, show: -99, wish: -99 }

export const orbit = { yaw: 0, pitch: 0, zoom: 1, vYaw: 0, vPitch: 0, last: -1e9, max: 1.05 }

/** Busy = a flight, ritual or review is running: ignore new commands. */
export const busy = () => {
  const s = store.get()
  return !!(s.trans || s.ritual || s.review)
}
