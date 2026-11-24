import { useEffect, useRef, useState } from 'react'
import { rng } from './scene/uniforms'

const greeting = 'merry Christmas'
const colors = ['#c99456', '#e9bd80', '#f9dba7', '#fff1d5']

export default function Greeting({ visible }: { visible: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [drawn, setDrawn] = useState(false)

  useEffect(() => {
    const title = heading.current
    const surface = canvas.current
    if (!title || !surface) return
    const ctx = surface.getContext('2d')
    const mask = document.createElement('canvas')
    const ink = mask.getContext('2d', { willReadFrequently: true })
    if (!ctx || !ink) return
    let active = true

    const draw = () => {
      const { width, height } = title.getBoundingClientRect()
      if (!active || !width || !height) return
      const style = getComputedStyle(title)
      const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      const scale = Math.min(window.devicePixelRatio || 1, 2)
      mask.width = Math.ceil(width)
      mask.height = Math.ceil(height)
      ink.font = font
      ink.textAlign = 'center'
      const metric = ink.measureText(greeting)
      const baseline = (height + metric.actualBoundingBoxAscent - metric.actualBoundingBoxDescent) / 2
      ink.fillText(greeting, width / 2, baseline, width)
      const alpha = ink.getImageData(0, 0, mask.width, mask.height).data
      ink.globalCompositeOperation = 'source-in'
      ink.fillStyle = '#dcb77f'
      ink.fillRect(0, 0, mask.width, mask.height)

      surface.width = Math.ceil(width * scale)
      surface.height = Math.ceil(height * scale)
      ctx.scale(scale, scale)
      ctx.globalAlpha = 0.38
      ctx.drawImage(mask, 0, 0)
      const random = rng(2512)
      const spacing = parseFloat(style.fontSize) > 52 ? 2.4 : 1.55
      for (let y = 0; y < height; y += spacing) {
        for (let x = 0; x < width; x += spacing) {
          const px = x + random() * (spacing - 0.25)
          const py = y + random() * (spacing - 0.25)
          if (px >= width || py >= height) continue
          const coverage = alpha[(Math.floor(py) * mask.width + Math.floor(px)) * 4 + 3] / 255
          if (coverage < 0.16) continue
          const tone = random()
          ctx.fillStyle = colors[Math.floor(tone * colors.length)]
          ctx.globalAlpha = coverage * (0.65 + tone * 0.35)
          ctx.beginPath()
          ctx.arc(px, py, spacing * (0.22 + tone * 0.24), 0, Math.PI * 2)
          ctx.fill()
        }
      }
      setDrawn(true)
    }

    const observer = new ResizeObserver(draw)
    observer.observe(title)
    void document.fonts.ready.then(draw)
    return () => {
      active = false
      observer.disconnect()
    }
  }, [])

  return (
    <header className={`tagline${visible ? ' on' : ''}${drawn ? ' particle-title' : ''}`}>
      <h1 ref={heading}>{greeting}</h1>
      <canvas ref={canvas} aria-hidden="true" />
    </header>
  )
}
