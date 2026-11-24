import { monthCounts } from './memories'

/** Filled in by the scene so the overlay can grab a frame. */
export const stage: { canvas?: HTMLCanvasElement; advance?: (t: number) => void } = {}


/** Render one fresh frame and compose a 4:5 poster with the wish. Returns a JPEG data URL. */
export async function makePoster(): Promise<string | null> {
  const src = stage.canvas
  if (!src) return null
  await document.fonts?.ready
  const W = 1080
  const H = 1350
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
  const k = Math.max(W / sw, (H * 0.92) / sh)
  const dw = sw * k
  const dh = sh * k
  ctx.drawImage(src, (W - dw) / 2, Math.min(0, (H * 0.92 - dh) / 2), dw, dh)

  // soft fade at the foot for the text
  const g = ctx.createLinearGradient(0, H * 0.62, 0, H)
  g.addColorStop(0, 'rgba(2,3,8,0)')
  g.addColorStop(0.6, 'rgba(2,3,8,0.82)')
  g.addColorStop(1, 'rgba(2,3,8,1)')
  ctx.fillStyle = g
  ctx.fillRect(0, H * 0.62, W, H * 0.38)

  const count = monthCounts().reduce((a, b) => a + b, 0)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#e9d3a6'
  ctx.font = `italic 400 66px 'Cormorant Garamond', Georgia, serif`
  ctx.fillText('A Year in Light', W / 2, H * 0.835)
  ctx.fillStyle = 'rgba(244, 239, 230, 0.82)'
  ctx.font = `italic 400 30px 'Cormorant Garamond', Georgia, serif`
  ctx.fillText('Every light is a memory.', W / 2, H * 0.88)
  ctx.fillStyle = 'rgba(244, 239, 230, 0.6)'
  ctx.font = `300 24px 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif`
  ctx.fillText(count ? `${count} 段回忆被点亮` : '点亮回忆', W / 2, H * 0.925)
  return out.toDataURL('image/jpeg', 0.9)
}
