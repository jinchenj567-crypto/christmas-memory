import * as THREE from 'three'
import { db, type StoredMemory } from './db'
import { mobile } from './scene/config'
import { store } from './store'

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const MONTHS_CN = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']

export interface Memory {
  id: string
  date: string // YYYY-MM-DD
  month: number // 0..11
  title: string
  note: string
  canvas: HTMLCanvasElement
  texture: THREE.CanvasTexture
  aspect: number // width / height
  tint: THREE.Color // average colour, used to tint the world around the photo
}

/** Average colour of a canvas, gently desaturated so it can tint light, not paint it. */
function tintOf(canvas: HTMLCanvasElement) {
  const c = document.createElement('canvas')
  c.width = c.height = 6
  const x = c.getContext('2d')!
  x.drawImage(canvas, 0, 0, 6, 6)
  const d = x.getImageData(0, 0, 6, 6).data
  let r = 0
  let g = 0
  let b = 0
  for (let i = 0; i < d.length; i += 4) {
    r += d[i]
    g += d[i + 1]
    b += d[i + 2]
  }
  const n = d.length / 4
  const col = new THREE.Color(r / n / 255, g / n / 255, b / n / 255)
  const hsl = { h: 0, s: 0, l: 0 }
  col.getHSL(hsl)
  return col.setHSL(hsl.h, Math.min(0.55, hsl.s), 0.55)
}

const TEX = mobile ? 900 : 1280 // longest side kept on the GPU
const STORE_MAX = 1800 // longest side kept in IndexedDB

const monthOf = (date: string) => Math.max(0, Math.min(11, Number(date.slice(5, 7)) - 1))
export const formatDate = (date: string) => date.replace(/-/g, '.')

function makeTexture(canvas: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.generateMipmaps = true
  return t
}

let mine: Memory[] = []

const byDate = (a: Memory, b: Memory) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date))

/** The user's locally saved memories. */
export function memories(): Memory[] {
  return mine
}
export const hasOwn = () => mine.length > 0

/** Saved memories per month. */
export function monthCounts(): number[] {
  const c = Array(12).fill(0)
  mine.forEach((m) => c[m.month]++)
  return c
}

async function decode(src: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  try {
    return await createImageBitmap(src, { imageOrientation: 'from-image' } as ImageBitmapOptions)
  } catch {
    const url = URL.createObjectURL(src)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return img
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }
}

function fit(img: CanvasImageSource & { width: number; height: number }, max: number) {
  const iw = (img as HTMLImageElement).naturalWidth || img.width
  const ih = (img as HTMLImageElement).naturalHeight || img.height
  const k = Math.min(1, max / Math.max(iw, ih))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(iw * k))
  c.height = Math.max(1, Math.round(ih * k))
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, c.width, c.height)
  return c
}

function toMemory(s: Omit<StoredMemory, 'blob'>, canvas: HTMLCanvasElement): Memory {
  return { id: s.id, date: s.date, title: s.title, note: s.note, month: monthOf(s.date), canvas, texture: makeTexture(canvas), aspect: canvas.width / canvas.height, tint: tintOf(canvas) }
}

export async function loadMemories() {
  const rows = await db.all()
  const out: Memory[] = []
  for (const row of rows) {
    try {
      const img = await decode(row.blob)
      out.push(toMemory(row, fit(img, TEX)))
      if ('close' in img) (img as ImageBitmap).close()
    } catch (err) {
      console.warn('memory skipped', row.id, err)
    }
  }
  mine = out.sort(byDate)
  store.set({ memVersion: store.get().memVersion + 1, loaded: true })
}

/** Read a picked file into a preview canvas (not saved yet). */
export async function readPhoto(file: File) {
  const img = await decode(file)
  const canvas = fit(img, STORE_MAX)
  if ('close' in img) (img as ImageBitmap).close()
  const d = new Date(file.lastModified || Date.now())
  const guess = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { canvas, dateGuess: guess }
}

export async function addMemory(full: HTMLCanvasElement, date: string, title: string, note: string): Promise<Memory> {
  const id = `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const blob = await new Promise<Blob>((res, rej) => full.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', 0.9))
  const row: StoredMemory = { id, date, title, note, blob, created: Date.now() }
  await db.put(row)
  const m = toMemory(row, fit(full, TEX))
  mine = [...mine, m].sort(byDate)
  store.set({ memVersion: store.get().memVersion + 1 })
  return m
}

export async function deleteMemory(id: string) {
  const m = mine.find((x) => x.id === id)
  if (!m) return
  await db.remove(id)
  m.texture.dispose()
  mine = mine.filter((x) => x.id !== id)
  const state = store.get()
  store.set({ memVersion: state.memVersion + 1, pendingTreeLights: state.pendingTreeLights.filter((light) => light.id !== id) })
}
