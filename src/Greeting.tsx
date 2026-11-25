import { useEffect, useRef } from 'react'
import { rng } from './scene/uniforms'

/**
 * "Merry Christmas" in a flowing script, cast in warm metallic gold:
 * it writes itself in from left to right, then a slow sheen of light passes over it
 * and small four-point stars twinkle on the letters. Drawn on a canvas only while visible.
 */
const greeting = 'Merry Christmas'

type Spark = { x: number; y: number; r: number; phase: number; speed: number }

export default function Greeting({ visible }: { visible: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const shown = useRef(visible)
  shown.current = visible

  useEffect(() => {
    const title = heading.current
    const surface = canvas.current
    if (!title || !surface) return
    const ctx = surface.getContext('2d')
    if (!ctx) return
    const ink = document.createElement('canvas') // the gold lettering, prepared once per size
    const shape = document.createElement('canvas') // the bare letter shape, for the sheen
    const sheenLayer = document.createElement('canvas')
    let sparks: Spark[] = []
    let raf = 0
    let born = -1
    let alive = true

    const prepare = () => {
      const box = title.getBoundingClientRect()
      if (!box.width || !box.height) return false
      const style = getComputedStyle(title)
      const size = parseFloat(style.fontSize)
      // room for the swashes and the glow around them
      const padX = size * 0.35
      const padY = size * 0.45
      const W = box.width + padX * 2
      const H = box.height + padY * 2
      const scale = Math.min(window.devicePixelRatio || 1, 2)
      surface.width = Math.ceil(W * scale)
      surface.height = Math.ceil(H * scale)
      surface.style.left = `${-padX}px`
      surface.style.top = `${-padY}px`
      surface.style.width = `${W}px`
      surface.style.height = `${H}px`
      for (const c of [ink, shape, sheenLayer]) {
        c.width = surface.width
        c.height = surface.height
      }
      const px = size * scale
      const font = `${style.fontWeight} ${px}px ${style.fontFamily}`
      const cx = surface.width / 2
      const cy = surface.height / 2 + px * 0.06

      const s = shape.getContext('2d')!
      s.clearRect(0, 0, shape.width, shape.height)
      s.font = font
      s.textAlign = 'center'
      s.textBaseline = 'middle'
      s.fillStyle = '#fff'
      s.fillText(greeting, cx, cy)

      const g = ink.getContext('2d')!
      g.clearRect(0, 0, ink.width, ink.height)
      g.font = font
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      // a warm halo first, then the metal on top of it
      g.shadowColor = 'rgba(255, 190, 100, 0.6)'
      g.shadowBlur = px * 0.3
      const metal = g.createLinearGradient(0, cy - px * 0.55, 0, cy + px * 0.45)
      metal.addColorStop(0, '#fff6dc')
      metal.addColorStop(0.36, '#f5d28a')
      metal.addColorStop(0.6, '#c98d42')
      metal.addColorStop(1, '#f7da9c')
      g.fillStyle = metal
      g.fillText(greeting, cx, cy)
      g.shadowBlur = 0
      g.fillText(greeting, cx, cy) // a second pass keeps the strokes crisp over the halo
      // a fine bright edge along the tops of the strokes
      g.globalCompositeOperation = 'source-atop'
      g.fillStyle = 'rgba(255, 250, 235, 0.4)'
      g.fillText(greeting, cx, cy - Math.max(1, px * 0.014))
      g.globalCompositeOperation = 'source-over'

      // stars live on the letters themselves
      const data = s.getImageData(0, 0, shape.width, shape.height).data
      const r = rng(1224)
      sparks = []
      for (let tries = 0; tries < 8000 && sparks.length < 24; tries++) {
        const x = Math.floor(r() * shape.width)
        const y = Math.floor(r() * shape.height)
        if (data[(y * shape.width + x) * 4 + 3] > 200) {
          sparks.push({ x, y, r: px * (0.06 + r() * 0.09), phase: r() * 10, speed: 0.6 + r() * 1.1 })
        }
      }
      return true
    }

    const star = (x: number, y: number, r: number, a: number) => {
      ctx.save()
      ctx.translate(x, y)
      ctx.globalAlpha = a
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
      glow.addColorStop(0, 'rgba(255, 250, 230, 0.95)')
      glow.addColorStop(1, 'rgba(255, 210, 140, 0)')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#fffaf0'
      ctx.beginPath()
      for (let k = 0; k < 8; k++) {
        const ang = (k * Math.PI) / 4
        const len = k % 2 === 0 ? r * 1.7 : r * 0.15
        ctx.lineTo(Math.cos(ang) * len, Math.sin(ang) * len)
      }
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }

    const frame = (now: number) => {
      raf = 0
      if (!alive) return
      if (!shown.current) {
        born = -1
        return
      }
      if (born < 0) born = now
      const t = (now - born) / 1000
      ctx.clearRect(0, 0, surface.width, surface.height)

      // written in from left to right, with a soft leading edge
      const reveal = Math.min(1, t / 1.8)
      const ease = 1 - Math.pow(1 - reveal, 2)
      const soft = surface.width * 0.1
      const edge = (surface.width + soft) * ease
      ctx.drawImage(ink, 0, 0)
      if (reveal < 1) {
        const fade = ctx.createLinearGradient(edge - soft, 0, edge, 0)
        fade.addColorStop(0, 'rgba(0,0,0,1)')
        fade.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.globalCompositeOperation = 'destination-in'
        ctx.fillStyle = fade
        ctx.fillRect(0, 0, surface.width, surface.height)
        ctx.globalCompositeOperation = 'source-over'
      }

      // a slow sheen of light passing over the gold every few seconds
      const cycle = 5.5
      const k = (((t - 1.4) % cycle) + cycle) % cycle / cycle
      if (t > 1.4 && k < 0.32) {
        const x = (k / 0.32) * surface.width * 1.4 - surface.width * 0.2
        const band = surface.width * 0.1
        const o = sheenLayer.getContext('2d')!
        o.globalCompositeOperation = 'source-over'
        o.clearRect(0, 0, sheenLayer.width, sheenLayer.height)
        o.drawImage(shape, 0, 0)
        o.globalCompositeOperation = 'source-in'
        const sheen = o.createLinearGradient(x - band, 0, x + band, 0)
        sheen.addColorStop(0, 'rgba(255,255,255,0)')
        sheen.addColorStop(0.5, 'rgba(255,252,240,0.9)')
        sheen.addColorStop(1, 'rgba(255,255,255,0)')
        o.fillStyle = sheen
        o.fillRect(0, 0, sheenLayer.width, sheenLayer.height)
        ctx.drawImage(sheenLayer, 0, 0)
      }

      // twinkling stars on the letters, only where the writing has already reached
      for (const s of sparks) {
        if (s.x > edge - soft) continue
        const tw = Math.pow(Math.max(0, Math.sin(t * s.speed * 2.2 + s.phase)), 14)
        if (tw > 0.02) star(s.x, s.y, s.r * (0.6 + tw * 0.6), tw)
      }
      raf = requestAnimationFrame(frame)
    }

    const start = () => {
      if (!raf && alive && shown.current) raf = requestAnimationFrame(frame)
    }
    const observer = new ResizeObserver(() => {
      if (prepare()) start()
    })
    observer.observe(title)
    void document.fonts
      .load('64px "Great Vibes"')
      .then(() => document.fonts.ready)
      .then(() => {
        if (prepare()) start()
      })
    const poll = window.setInterval(start, 400)
    return () => {
      alive = false
      observer.disconnect()
      window.clearInterval(poll)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <header className={`tagline greeting${visible ? ' on' : ''}`}>
      <h1 ref={heading}>{greeting}</h1>
      <canvas ref={canvas} aria-hidden="true" />
    </header>
  )
}
