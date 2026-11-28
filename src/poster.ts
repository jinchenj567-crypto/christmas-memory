import { isWeChat, mobile } from './scene/config'

/** Filled in by the scene so the overlay can grab a frame. */
export const stage: { canvas?: HTMLCanvasElement; advance?: (t: number) => void } = {}

/**
 * Render one fresh frame of the tree and compose a 3:4 keepsake for the phone:
 * the scene, a soft fade at the foot, "Merry Christmas" in gold script and the date.
 * Returns a JPEG data URL (a plain <img> that WeChat lets you long-press to save).
 */
export async function makePoster(): Promise<string | null> {
  const src = stage.canvas
  if (!src) return null
  await document.fonts?.load("120px 'Great Vibes'").catch(() => {})
  await document.fonts?.ready
  const W = 1080
  const H = 1440
  const out = document.createElement('canvas')
  out.width = W
  out.height = H
  const ctx = out.getContext('2d')!
  ctx.fillStyle = '#020308'
  ctx.fillRect(0, 0, W, H)

  // the drawing buffer is only valid right after a render, in the same task
  stage.advance?.(performance.now())
  const sw = src.width
  const sh = src.height
  const k = Math.max(W / sw, H / sh)
  const dw = sw * k
  const dh = sh * k
  ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh)

  // a soft fade at the foot for the lettering
  const g = ctx.createLinearGradient(0, H * 0.66, 0, H)
  g.addColorStop(0, 'rgba(2,3,8,0)')
  g.addColorStop(0.55, 'rgba(2,3,8,0.78)')
  g.addColorStop(1, 'rgba(2,3,8,0.96)')
  ctx.fillStyle = g
  ctx.fillRect(0, H * 0.66, W, H * 0.34)

  // "Merry Christmas" in warm metallic gold, with a glow
  const y = H * 0.875
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `400 132px 'Great Vibes', cursive`
  const metal = ctx.createLinearGradient(0, y - 70, 0, y + 55)
  metal.addColorStop(0, '#fff6dc')
  metal.addColorStop(0.36, '#f5d28a')
  metal.addColorStop(0.62, '#c98d42')
  metal.addColorStop(1, '#f7da9c')
  ctx.shadowColor = 'rgba(255, 190, 100, 0.6)'
  ctx.shadowBlur = 38
  ctx.fillStyle = metal
  ctx.fillText('Merry Christmas', W / 2, y)
  ctx.shadowBlur = 0
  ctx.fillText('Merry Christmas', W / 2, y)

  const d = new Date()
  ctx.fillStyle = 'rgba(244, 232, 210, 0.72)'
  ctx.font = `300 28px 'Noto Serif SC', 'PingFang SC', serif`
  ctx.fillText(`${d.getFullYear()} · ${d.getMonth() + 1}.${d.getDate()}`, W / 2, H * 0.948)

  // a fine gold frame
  ctx.strokeStyle = 'rgba(233, 196, 120, 0.45)'
  ctx.lineWidth = 2
  ctx.strokeRect(28, 28, W - 56, H - 56)
  return out.toDataURL('image/jpeg', 0.92)
}

/**
 * Put the picture on the phone: the system share sheet where it can take a file
 * ("Save Image" on iPhone), otherwise a download. WeChat allows neither: there the
 * picture is long-pressed instead, so this reports 'longpress'.
 */
export async function savePoster(url: string): Promise<'shared' | 'downloaded' | 'longpress' | 'cancelled'> {
  if (isWeChat) return 'longpress'
  const blob = await (await fetch(url)).blob()
  const name = `merry-christmas-${new Date().toISOString().slice(0, 10)}.jpg`
  const file = new File([blob], name, { type: 'image/jpeg' })
  if (mobile && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return 'shared'
    } catch {
      return 'cancelled'
    }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  return 'downloaded'
}
