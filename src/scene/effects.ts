import { clock } from './config'
import { fx, orbit, store } from '../store'

/**
 * The side buttons: replay the opening, a fireworks show, a light show on the tree, a wish.
 * Each only starts from the calm main view, and never on top of another flight.
 */
const calm = () => {
  const s = store.get()
  return s.view === 'main' && !s.trans && !s.ritual && !s.review && !s.sheet && s.introDone && fx.replay < 0
}

/** The particles fly back out into the night, the view rises, and the whole opening plays again. */
export function replayIntro() {
  if (!calm()) return
  fx.replay = performance.now()
  fx.show = fx.fireworks = fx.wish = -99
  orbit.vYaw = orbit.vPitch = 0
  orbit.last = -1e9
  store.set({ introDone: false, wishText: null })
}

/** Called by the director once the particles have scattered: restart the clock at zero. */
export function restartClock() {
  clock.start = performance.now()
  clock.offset = 0
  fx.replay = -1
}

export function fireworksShow() {
  if (calm()) fx.fireworks = clock.now()
}

export function lightShow() {
  if (calm()) fx.show = clock.now()
}

const WISHES = 'a-year-in-light-wishes'
/** A wish stays on this device only. */
export function makeWish(text: string) {
  try {
    const list = JSON.parse(localStorage.getItem(WISHES) || '[]') as { text: string; at: number }[]
    list.push({ text, at: Date.now() })
    localStorage.setItem(WISHES, JSON.stringify(list.slice(-100)))
  } catch {
    // private mode or storage off: the wish still rises, it just is not kept
  }
  fx.wish = clock.now() + 0.4
  store.set({ sheet: null, wishText: text || null })
}
