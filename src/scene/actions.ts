import { busy, store } from '../store'
import { hasOwn, memories } from '../memories'
import { clock, T } from './config'

/** Fly into the globe, looking at memory `focus`. */
export function enterGlobe(focus?: number, emptyMonth: number | null = null) {
  const s = store.get()
  if (busy() || s.view !== 'main' || s.sheet || clock.now() < T.globe[1] - 1) return
  const list = memories()
  const f = focus ?? (hasOwn() ? list.length - 1 : 0)
  store.set({ trans: { dir: 'in', t0: clock.now() }, focus: Math.max(0, Math.min(list.length - 1, f)), zoom: false, emptyMonth })
}

export function leaveGlobe() {
  const s = store.get()
  if (s.trans || s.sheet || s.view !== 'inside') return
  store.set({ trans: { dir: 'out', t0: clock.now() }, zoom: false, emptyMonth: null })
}

export function focusStep(d: number) {
  const s = store.get()
  if (s.view !== 'inside' || s.trans || s.sheet) return
  const n = memories().length
  const f = Math.max(0, Math.min(n - 1, s.focus + d))
  if (f !== s.focus || s.emptyMonth !== null) store.set({ focus: f, zoom: false, emptyMonth: null })
}

export function focusMonth(month: number) {
  const list = memories()
  const idx = list.findIndex((m) => m.month === month)
  if (idx >= 0) store.set({ focus: idx, zoom: false, emptyMonth: null })
  else store.set({ emptyMonth: month, zoom: false })
}

export function startReview() {
  const s = store.get()
  if (busy() || s.view !== 'main' || s.sheet || !s.introDone || !hasOwn()) return
  store.set({ review: { t0: clock.now() } })
}

export function endReview() {
  const r = store.get().review
  if (r && r.skipAt === undefined) store.set({ review: { ...r, skipAt: clock.now() } })
}
