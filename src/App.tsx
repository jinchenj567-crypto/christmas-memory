import { useEffect, useRef, useState } from 'react'
import Scene from './scene/Scene'
import Greeting from './Greeting'
import { MONTHS, MONTHS_CN, addMemory, deleteMemory, formatDate, hasOwn, memories, monthCounts, readPhoto } from './memories'
import { store, useStore, busy } from './store'
import { setMusic } from './audio'
import { makePoster } from './poster'
import { clock, isWeChat } from './scene/config'
import { endReview, enterGlobe, focusMonth, focusStep, leaveGlobe, startReview } from './scene/actions'
import { RV, reviewFrame, reviewPlan } from './scene/Review'
import { fireworksShow, lightShow, makeWish, replayIntro } from './scene/effects'

const query = new URLSearchParams(typeof location !== 'undefined' ? location.search : '')
// dev-only: `?size=1440x900` pins the stage size so recordings keep one resolution
const pinned = import.meta.env.DEV && /^\d+x\d+$/.test(query.get('size') || '') ? (query.get('size') as string).split('x').map(Number) : null

const on = (b: boolean) => (b ? ' on' : '')
let posterUrl: string | null = null

/** Re-render on every animation frame while `active` (for timeline-driven captions). */
function useTicker(active: boolean) {
  const [, set] = useState(0)
  useEffect(() => {
    if (!active) return
    let id = 0
    const loop = () => {
      set((n) => n + 1)
      id = requestAnimationFrame(loop)
    }
    id = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(id)
  }, [active])
}

export default function App() {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const root = document.documentElement.style
    const fitEditor = () => {
      root.setProperty('--editor-height', `${viewport.height}px`)
      root.setProperty('--editor-top', `${viewport.offsetTop}px`)
    }
    fitEditor()
    viewport.addEventListener('resize', fitEditor)
    viewport.addEventListener('scroll', fitEditor)
    return () => {
      viewport.removeEventListener('resize', fitEditor)
      viewport.removeEventListener('scroll', fitEditor)
      root.removeProperty('--editor-height')
      root.removeProperty('--editor-top')
    }
  }, [])
  const view = useStore((s) => s.view)
  const trans = useStore((s) => s.trans)
  const sheet = useStore((s) => s.sheet)
  const ritual = useStore((s) => s.ritual)
  const review = useStore((s) => s.review)
  const introDone = useStore((s) => s.introDone)

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const s = store.get()
      if ((e.target as HTMLElement)?.closest?.('input, textarea')) return
      if (e.key === 'Enter' && (e.target as HTMLElement)?.closest?.('button')) return
      if (e.key === 'Escape') {
        if (s.sheet) store.set({ sheet: null })
        else if (s.review) endReview()
        else if (s.view === 'inside') {
          if (s.zoom) store.set({ zoom: false })
          else leaveGlobe()
        }
      }
      if (s.view === 'inside' && !s.trans && !s.sheet) {
        if (e.key === 'ArrowRight') focusStep(1)
        if (e.key === 'ArrowLeft') focusStep(-1)
        if (e.key === 'Enter' && hasOwn()) store.set({ zoom: !s.zoom })
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  const mainCalm = introDone && view === 'main' && !trans && !ritual && !review && !sheet
  const insideCalm = view === 'inside' && !trans && !sheet

  return (
    <div className="app" style={pinned ? { width: pinned[0], height: pinned[1], right: 'auto', bottom: 'auto' } : undefined}>
      <Scene />
      <div className={`shade${on(!review)}`} />
      <button id="globe-focus" className="globe-focus" aria-label="打开回忆" hidden={!mainCalm} onClick={() => enterGlobe()} />

      <Main visible={mainCalm} />
      <Inside visible={insideCalm} />
      <ReviewCaption />
      <AddSheet visible={sheet === 'add'} />
      <ShareSheet visible={sheet === 'share'} />
      <WishSheet visible={sheet === 'wish'} />
      <WishNote />

    </div>
  )
}

// ---------------------------------------------------------------------------
// Main scene: greeting, actions and music.
// ---------------------------------------------------------------------------
function Main({ visible }: { visible: boolean }) {
  useStore((s) => s.memVersion)
  const music = useStore((s) => s.music)
  const count = monthCounts().reduce((a, b) => a + b, 0)
  return (
    <>
      <Greeting visible={visible} />
      <nav className={`dock${on(visible)}`}>
        <span className="whisper">{count ? `${count} 段回忆已点亮` : '轻触水晶球'}</span>
        <div className="actions">
          <button onClick={() => store.set({ sheet: 'add' })}>添加回忆</button>
          <i />
          <button onClick={startReview} disabled={!count} title={count ? undefined : '添加回忆后可播放'}>年度回顾</button>
          <i />
          <button
            onClick={async () => {
              posterUrl = await makePoster()
              store.set({ sheet: 'share' })
            }}
          >
            分享
          </button>
        </div>
      </nav>
      <FxBar visible={visible} />
      <button
        className={`icon music${music ? ' playing' : ''}${on(visible)}`}
        aria-label={music ? '关闭音乐' : '打开音乐'}
        onClick={() => {
          store.set({ music: !music })
          setMusic(!music)
        }}
      >
        <span />
        <span />
        <span />
        <span />
      </button>
    </>
  )
}

// ---------------------------------------------------------------------------
// The side buttons: four small things to play with, quiet until you look for them.
// ---------------------------------------------------------------------------
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
const FX = [
  {
    label: '重播开场',
    run: replayIntro,
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" {...stroke}>
        <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
        <path d="M19.8 4.2v3.4h-3.4" />
        <path d="M12 9.2l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
      </svg>
    ),
  },
  {
    label: '放烟花',
    run: fireworksShow,
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" {...stroke}>
        <path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M6 6l2.1 2.1M15.9 15.9L18 18M18 6l-2.1 2.1M8.1 15.9L6 18" />
        <circle cx="12" cy="12" r="1.2" />
      </svg>
    ),
  },
  {
    label: '灯光秀',
    run: lightShow,
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" {...stroke}>
        <path d="M12 3.2l1 2.1 2.2.3-1.6 1.6.4 2.2-2-1.1-2 1.1.4-2.2-1.6-1.6 2.2-.3z" />
        <path d="M7.5 12.5c2.5 1.4 6.5 1.4 9 0M6 16.5c3.4 1.8 8.6 1.8 12 0M4.5 20.5c4.3 1.6 10.7 1.6 15 0" />
      </svg>
    ),
  },
  {
    label: '许个愿',
    run: () => store.set({ sheet: 'wish' }),
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" {...stroke}>
        <path d="M16.5 4.5l.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z" />
        <path d="M13 11.5c-3.2 3-6 5.8-9 8.5M10.5 9.8c-2 2-3.6 3.4-5.2 4.6M14.8 13.4c-1.6 2-3 3.6-4.6 5.2" />
      </svg>
    ),
  },
]

function FxBar({ visible }: { visible: boolean }) {
  return (
    <div className={`fxbar${on(visible)}`} role="toolbar" aria-label="动效">
      {FX.map((f) => (
        <button key={f.label} className="icon fx" aria-label={f.label} onClick={f.run}>
          {f.icon}
          <span className="tip">{f.label}</span>
        </button>
      ))}
    </div>
  )
}

function WishSheet({ visible }: { visible: boolean }) {
  const [text, setText] = useState('')
  useEffect(() => {
    if (!visible) {
      const id = setTimeout(() => setText(''), 900)
      return () => clearTimeout(id)
    }
  }, [visible])
  return (
    <div className={`veil${on(visible)}`} role="dialog" aria-label="许愿" aria-hidden={!visible}>
      <button className="scrim" onClick={() => store.set({ sheet: null })} tabIndex={-1} aria-label="关闭" />
      <div className="veil-body">
        <h2>许一个愿</h2>
        <p className="lead">写给明年。</p>
        <input className="field" value={text} maxLength={30} placeholder="我希望…" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && makeWish(text.trim())} />
        <div className="veil-actions">
          <button className="cta" onClick={() => makeWish(text.trim())}>
            许愿
          </button>
        </div>
        <p className="fine">仅存本机</p>
      </div>
    </div>
  )
}

/** The wish, written softly under the star once its light arrives. */
function WishNote() {
  const text = useStore((s) => s.wishText)
  const [shown, setShown] = useState<string | null>(null)
  useEffect(() => {
    if (!text) return
    const a = setTimeout(() => setShown(text), 4300)
    const b = setTimeout(() => setShown(null), 9500)
    const c = setTimeout(() => store.set({ wishText: null }), 10500)
    return () => [a, b, c].forEach(clearTimeout)
  }, [text])
  return <p className={`wish-note${on(!!shown)}`}>{shown ?? ''}</p>
}

// ---------------------------------------------------------------------------
// Inside the globe: back, the month and date, a hairline timeline, photo actions.
// ---------------------------------------------------------------------------
function Inside({ visible }: { visible: boolean }) {
  useStore((s) => s.memVersion)
  const loaded = useStore((s) => s.loaded)
  const focus = useStore((s) => s.focus)
  const zoom = useStore((s) => s.zoom)
  const empty = useStore((s) => s.emptyMonth)
  const [confirm, setConfirm] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [hint, setHint] = useState(true)
  const list = memories()
  const m = list[Math.min(focus, list.length - 1)]
  const months = new Set(list.map((x) => x.month))
  useEffect(() => { setConfirm(false); setDeleteError('') }, [focus, zoom])
  useEffect(() => {
    if (!visible) return
    const id = setTimeout(() => setHint(false), 5200)
    return () => clearTimeout(id)
  }, [visible])
  const month = empty ?? m?.month
  return (
    <>
      <button className={`back${on(visible)}`} onClick={() => leaveGlobe()}>
        ‹ 返回
      </button>
      <button
        className={`add-inside${on(visible && !!m)}`}
        onClick={() => store.set({ sheet: 'add' })}
      >
        添加回忆
      </button>
      <header className={`realm${on(visible && !zoom)}`}>The Memory Within</header>

      <div className={`caption${!m ? ' memories-empty' : ''}${on(visible && !zoom)}`} key={empty === null ? m?.id ?? 'empty' : `empty-${empty}`}>
        {!m ? (
          loaded ? <>
            <h2>这里还没有回忆</h2>
            <p>上传一张照片，写下想留住的话。</p>
            <button className="cta" onClick={() => store.set({ sheet: 'add' })}>添加第一段回忆</button>
          </> : <p role="status">正在读取回忆…</p>
        ) : empty !== null ? (
          <>
            <span className="script">{MONTHS[empty]}</span>
            <p>{MONTHS_CN[empty]}还暗着</p>
          </>
        ) : (
          <>
            <span className="when-line">
              <em>{MONTHS[m.month]}</em>
              <i />
              {formatDate(m.date)}
            </span>
            {m.title && <h2>{m.title}</h2>}
            {m.note && <p>{m.note}</p>}
            <button
              className={`link danger${confirm ? ' armed' : ''}`}
              onClick={async () => {
                if (!confirm) return setConfirm(true)
                try {
                  await deleteMemory(m.id)
                  const n = memories().length
                  store.set({ focus: Math.max(0, Math.min(n - 1, focus)), zoom: false })
                } catch {
                  setDeleteError('删除失败，请重试')
                }
              }}
            >
              {confirm ? '确认删除' : '删除'}
            </button>
            {deleteError && <p role="alert">{deleteError}</p>}
          </>
        )}
      </div>

      <p className={`inside-hint${on(visible && !!m && hint && !zoom)}`}>滑动切换 · 轻点放大</p>
      <p className={`immerse-hint${on(visible && zoom)}`}>轻点返回</p>

      <nav className={`timeline${on(visible && !!m && !zoom)}`} aria-label="月份">
        {MONTHS.map((name, i) => (
          <button key={i} className={`tick${months.has(i) ? ' has' : ''}${i === month ? ' now' : ''}`} onClick={() => focusMonth(i)} aria-label={MONTHS_CN[i]}>
            <i />
            <span>{name.slice(0, 3)}</span>
          </button>
        ))}
      </nav>
    </>
  )
}

// ---------------------------------------------------------------------------
// Year review captions, timed by the same clock as the scene.
// ---------------------------------------------------------------------------
function ReviewCaption() {
  const review = useStore((s) => s.review)
  useTicker(!!review)
  if (!review) return null
  const t = clock.now() - review.t0
  const plan = reviewPlan(review.t0, review.skipAt)
  const f = reviewFrame(t, plan.end)
  const m = memories()[f.k]
  const showTitle = t < RV.first - 0.2 && t > 0.6
  const ending = t > plan.end + 0.8 && t < plan.done - 0.4
  return (
    <>
      <div className="review-cap" style={{ opacity: m && f.k < plan.n ? f.vis : 0 }}>
        {m && (
          <>
            <span className="script">{formatDate(m.date)}</span>
            <h2>{m.title}</h2>
            {m.note && <p>{m.note}</p>}
          </>
        )}
      </div>
      <div className="review-title" style={{ opacity: showTitle ? 1 : 0 }}>
        A Year in Light
      </div>
      <div className="review-title end" style={{ opacity: ending ? 1 : 0 }}>
        Every light is a memory.
      </div>
      <button className={`skip${on(t < plan.end)}`} onClick={endReview}>
        结束
      </button>
    </>
  )
}

// ---------------------------------------------------------------------------
// Add a memory: choose, write a few words, then let it go into the globe.
// ---------------------------------------------------------------------------
function AddSheet({ visible }: { visible: boolean }) {
  const loaded = useStore((s) => s.loaded)
  const file = useRef<HTMLInputElement>(null)
  const [photo, setPhoto] = useState<{ canvas: HTMLCanvasElement; url: string } | null>(null)
  const [date, setDate] = useState('')
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (visible) return
    const id = setTimeout(() => {
      setPhoto(null)
      setTitle('')
      setNote('')
      setError('')
    }, 900)
    return () => clearTimeout(id)
  }, [visible])

  const pick = async (f: File) => {
    setError('')
    try {
      const r = await readPhoto(f)
      setPhoto({ canvas: r.canvas, url: r.canvas.toDataURL('image/jpeg', 0.85) })
      setDate(r.dateGuess)
    } catch {
      setError('读取失败，换一张')
    }
  }

  const submit = async () => {
    if (!photo || !loaded || working || busy()) return
    setWorking(true)
    setError('')
    try {
      const d = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10)
      const m = await addMemory(photo.canvas, d, title.trim(), note.trim())
      const state = store.get()
      if (state.view === 'inside' && !state.trans) {
        store.set({
          sheet: null,
          focus: memories().indexOf(m),
          zoom: false,
          emptyMonth: null,
          pendingTreeLights: [...state.pendingTreeLights, { id: m.id, month: m.month }],
        })
      } else {
        store.set({ sheet: null, ritual: { id: m.id, month: m.month, t0: clock.now() + 0.5 } })
      }
    } catch {
      setError('保存失败，请重试')
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className={`veil${on(visible)}`} role="dialog" aria-label="添加回忆" aria-hidden={!visible}>
      <button className="scrim" onClick={() => store.set({ sheet: null })} tabIndex={-1} aria-label="关闭" />
      <div className="veil-body">
        {!photo ? (
          <>
            <h2>添加回忆</h2>
            <p className="lead">一张照片，一句话。</p>
            <button className="cta" onClick={() => file.current?.click()}>
              选择照片
            </button>
            {error && <p className="fine">{error}</p>}
            <p className="fine">仅存本机，不上传</p>
          </>
        ) : (
          <>
            <img className="preview" src={photo.url} alt="" />
            <input className="field date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <input className="field" value={title} maxLength={24} placeholder="标题" onChange={(e) => setTitle(e.target.value)} />
            <textarea className="field" value={note} maxLength={80} rows={2} placeholder="一句话" onChange={(e) => setNote(e.target.value)} />
            {error && <p className="fine" role="alert">{error}</p>}
            <div className="veil-actions">
              <button className="cta" onClick={submit} disabled={working || !loaded}>
                收进去
              </button>
              <button className="link" onClick={() => file.current?.click()}>
                换一张
              </button>
            </div>
          </>
        )}
      </div>
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) pick(f)
        }}
      />
    </div>
  )
}

function ShareSheet({ visible }: { visible: boolean }) {
  const [note, setNote] = useState('')
  useEffect(() => {
    if (visible) setNote('')
  }, [visible])
  const canShare = typeof navigator !== 'undefined' && !!navigator.share && !isWeChat
  const link = () => {
    const url = location.origin + location.pathname
    if (canShare) {
      navigator.share({ title: 'A Year in Light', url }).catch(() => {})
      return
    }
    if (!navigator.clipboard?.writeText) {
      setNote(`长按复制：${url}`)
      return
    }
    navigator.clipboard.writeText(url).then(
      () => setNote('链接已复制'),
      () => setNote(url),
    )
  }
  return (
    <div className={`veil${on(visible)}`} role="dialog" aria-label="分享" aria-hidden={!visible}>
      <button className="scrim" onClick={() => store.set({ sheet: null })} tabIndex={-1} aria-label="关闭" />
      <div className="veil-body">
        <div className="poster">{visible && posterUrl && <img src={posterUrl} alt="回忆树海报" />}</div>
        <p className="lead">{isWeChat ? '长按保存，或点右上角转发' : '长按或右键保存'}</p>
        <div className="veil-actions">
          <button className="link" onClick={link}>
            {canShare ? '分享链接' : '复制链接'}
          </button>
          <button className="link" onClick={() => store.set({ sheet: null })}>
            关闭
          </button>
        </div>
        <p className="fine share-note">{note || '链接打开的是一棵新树'}</p>
      </div>
    </div>
  )
}
