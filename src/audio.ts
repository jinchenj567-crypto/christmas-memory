// Background music: the instrumental of 圣诞结, looping.
// Browsers (and WeChat) only let a page make sound after the visitor touches it,
// so it starts on the first tap anywhere; the note button turns it off and on again.
import trackUrl from '../assets/audio/christmas-knot-instrumental.mp3'
import { store } from './store'

const VOLUME = 0.7
let el: HTMLAudioElement | null = null
let fade = 0
let decided = false // the visitor has heard it start, or chose with the button

function audio() {
  if (!el) {
    el = new Audio()
    el.src = trackUrl
    el.loop = true
    el.preload = 'auto'
    el.setAttribute('playsinline', '')
    el.volume = 0
  }
  return el
}

// iOS keeps the volume fixed, so there the fade simply does nothing
function fadeTo(target: number, ms: number, done?: () => void) {
  const a = audio()
  cancelAnimationFrame(fade)
  const from = a.volume
  const t0 = performance.now()
  const tick = (now: number) => {
    const k = Math.min(1, (now - t0) / ms)
    a.volume = from + (target - from) * k
    if (k < 1) fade = requestAnimationFrame(tick)
    else done?.()
  }
  fade = requestAnimationFrame(tick)
}

function play() {
  return audio().play().then(() => fadeTo(VOLUME, 1200))
}

export function setMusic(on: boolean) {
  decided = true
  const a = audio()
  if (on) {
    play().catch(() => store.set({ music: false }))
  } else {
    fadeTo(0, 500, () => {
      if (!store.get().music) a.pause()
    })
  }
}

/** Start the music on the first touch, click or key press, unless the button was used first. */
export function startMusicOnFirstTouch() {
  const events = ['pointerup', 'touchend', 'keydown'] as const
  const stop = () => events.forEach((e) => window.removeEventListener(e, first, true))
  const first = (e?: Event) => {
    if (decided) return stop()
    // a first tap on the note button itself is left to the button
    if ((e?.target as Element | null)?.closest?.('.music')) return
    play().then(
      () => {
        decided = true
        store.set({ music: true })
        stop()
      },
      () => {}, // not counted as a real touch by this browser: try again on the next one
    )
  }
  events.forEach((e) => window.addEventListener(e, first, true))
  // WeChat lets a page play as soon as its bridge is ready
  if ((window as any).WeixinJSBridge) first()
  else document.addEventListener('WeixinJSBridgeReady', () => first())
  // quiet while the page is in the background
  document.addEventListener('visibilitychange', () => {
    if (!el || !store.get().music) return
    if (document.hidden) el.pause()
    else void el.play().catch(() => {})
  })
}
