// A quiet, original music-box lullaby synthesised with Web Audio.
// No audio files, nothing fetched: everything is generated in the browser.

let ctx: AudioContext | null = null
let master: GainNode | null = null
let timer: number | null = null
let nextTime = 0
let step = 0

const BPM = 64
const EIGHTH = 60 / BPM / 2

// four warm chords, two bars each (MIDI notes)
const CHORDS = [
  [48, 55, 60, 64, 67, 71], // Cmaj7
  [45, 52, 57, 60, 64, 67], // Am7
  [41, 48, 53, 57, 60, 64], // Fmaj7
  [43, 50, 55, 59, 62, 67], // G6/9-ish
]
// a gentle melody over the arpeggio, 16 eighths per chord (0 = rest)
const MELODY = [
  [76, 0, 0, 74, 72, 0, 0, 0, 79, 0, 0, 76, 74, 0, 0, 0],
  [72, 0, 0, 71, 69, 0, 0, 0, 76, 0, 74, 0, 72, 0, 0, 0],
  [69, 0, 0, 72, 77, 0, 0, 76, 74, 0, 0, 0, 72, 0, 0, 0],
  [71, 0, 0, 74, 79, 0, 0, 0, 78, 0, 76, 0, 74, 0, 0, 0],
]
const ARP = [0, 2, 3, 4, 5, 4, 3, 2]

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

function impulse(ac: AudioContext, seconds: number) {
  const len = Math.floor(ac.sampleRate * seconds)
  const buf = ac.createBuffer(2, len, ac.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2)
  }
  return buf
}

function bell(ac: AudioContext, out: AudioNode, t: number, freq: number, vel: number, decay: number) {
  const g = ac.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(vel, t + 0.006)
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
  g.connect(out)
  // fundamental plus a soft inharmonic partial: a music-box / celesta colour
  for (const [mul, amp] of [
    [1, 1],
    [2.76, 0.18],
    [5.4, 0.05],
  ] as const) {
    const o = ac.createOscillator()
    const og = ac.createGain()
    o.type = 'sine'
    o.frequency.value = freq * mul
    og.gain.value = amp
    o.connect(og).connect(g)
    o.start(t)
    o.stop(t + decay + 0.05)
  }
}

function pad(ac: AudioContext, out: AudioNode, t: number, notes: number[], dur: number) {
  const g = ac.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.linearRampToValueAtTime(0.05, t + dur * 0.35)
  g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.05)
  const lp = ac.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 900
  g.connect(lp).connect(out)
  for (const n of notes.slice(0, 3)) {
    const o = ac.createOscillator()
    o.type = 'triangle'
    o.frequency.value = hz(n)
    o.detune.value = (Math.random() - 0.5) * 8
    o.connect(g)
    o.start(t)
    o.stop(t + dur * 1.1)
  }
}

function schedule() {
  if (!ctx || !master) return
  while (nextTime < ctx.currentTime + 0.4) {
    const bar = Math.floor(step / 16) % CHORDS.length
    const i = step % 16
    const chord = CHORDS[bar]
    if (i === 0) pad(ctx, master, nextTime, chord, EIGHTH * 16)
    const arp = chord[ARP[i % 8]] + 12
    bell(ctx, master, nextTime, hz(arp), 0.05 + (i % 4 === 0 ? 0.025 : 0), 1.8)
    const mel = MELODY[bar][i]
    if (mel && Math.floor(step / 64) % 2 === 1) bell(ctx, master, nextTime + 0.01, hz(mel), 0.11, 2.6)
    nextTime += EIGHTH * (i % 2 ? 0.94 : 1.06) // a little swing, like a hand-wound box
    step++
  }
}

export function setMusic(on: boolean) {
  if (on) {
    if (!ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext
      if (!AC) return
      ctx = new AC()
      master = ctx.createGain()
      master.gain.value = 0
      const dry = ctx.createGain()
      dry.gain.value = 0.7
      const wet = ctx.createConvolver()
      wet.buffer = impulse(ctx, 3.6)
      const wetGain = ctx.createGain()
      wetGain.gain.value = 0.55
      master.connect(dry).connect(ctx.destination)
      master.connect(wet).connect(wetGain).connect(ctx.destination)
    }
    ctx.resume()
    nextTime = ctx.currentTime + 0.1
    master!.gain.cancelScheduledValues(ctx.currentTime)
    master!.gain.setTargetAtTime(0.9, ctx.currentTime, 0.8)
    if (timer === null) timer = window.setInterval(schedule, 120)
    schedule()
  } else if (ctx && master) {
    master.gain.cancelScheduledValues(ctx.currentTime)
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.35)
    const c = ctx
    setTimeout(() => {
      if (timer !== null && master && master.gain.value < 0.02) {
        clearInterval(timer)
        timer = null
        c.suspend()
      }
    }, 1600)
  }
}
