import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ImagePlus, MoveVertical, Smile, Trash2 } from 'lucide-react'
import { setProperty, type Property } from '../../lib/properties'
import { BANNER_COLOURS, BANNER_GRADIENTS, bannerY, parseBanner } from '../../lib/banners'
import { EMOJI } from '../../lib/emoji'
import { usePrefs } from '../../store/prefs'
import { notify } from '../../store/notify'
import PropertiesPanel from './PropertiesPanel'

/** Properties that the header shows as pictures rather than as rows. */
export const HEADER_KEYS = new Set(['banner', 'banner_y', 'icon'])

interface Props {
  properties: Property[] | null
  apply: (change: (text: string) => string) => void
  showRaw: () => void
  readOnly?: boolean
}

const valueOf = (props: Property[] | null, key: string): string | undefined => {
  const p = props?.find((x) => x.key === key)
  return typeof p?.value === 'string' ? p.value : undefined
}

/** The top of a note: its banner and icon (if any), then its properties. */
export default function NoteHeader({ properties, apply, showRaw, readOnly }: Props) {
  const banner = valueOf(properties, 'banner')
  const icon = valueOf(properties, 'icon')
  const rows = properties?.filter((p) => !HEADER_KEYS.has(p.key)) ?? null
  const set = (key: string, value: string | undefined): void => apply((text) => setProperty(text, key, value))
  const [picker, setPicker] = useState<'icon' | 'banner' | null>(null)

  return (
    <div className={`note-header ${banner ? 'has-banner' : ''} ${icon ? 'has-icon' : ''}`} data-note-header>
      {banner && <BannerView value={banner} y={valueOf(properties, 'banner_y')} readOnly={readOnly} onChange={() => setPicker('banner')} onRemove={() => apply((t) => setProperty(setProperty(t, 'banner', undefined), 'banner_y', undefined))} onMove={(y) => set('banner_y', String(y))} />}
      {icon && (
        <button className="note-icon" disabled={readOnly} onClick={() => setPicker('icon')} title={readOnly ? undefined : 'Change icon'} data-note-icon>
          {icon}
        </button>
      )}
      {!readOnly && (
        <div className="note-header-adds">
          {!icon && (
            <button onClick={() => setPicker('icon')} data-add-icon>
              <Smile size={13} /> Add icon
            </button>
          )}
          {!banner && (
            <button onClick={() => setPicker('banner')} data-add-banner>
              <ImagePlus size={13} /> Add banner
            </button>
          )}
        </div>
      )}
      {picker === 'icon' && (
        <Popover close={() => setPicker(null)} className="icon-picker">
          <IconPicker
            current={icon}
            pick={(e) => {
              set('icon', e)
              setPicker(null)
            }}
          />
        </Popover>
      )}
      {picker === 'banner' && (
        <Popover close={() => setPicker(null)} className="banner-picker">
          <BannerPicker
            pick={(v) => {
              apply((t) => setProperty(setProperty(t, 'banner', v), 'banner_y', undefined))
              setPicker(null)
            }}
          />
        </Popover>
      )}
      {/* With only a banner or icon, the properties area is just its quiet "Add property". */}
      {readOnly ? (
        rows?.length ? <PropertiesPanel properties={rows} apply={apply} showRaw={showRaw} readOnly /> : null
      ) : (
        <PropertiesPanel properties={rows?.length ? rows : null} apply={apply} showRaw={showRaw} />
      )}
    </div>
  )
}

function BannerView({ value, y, readOnly, onChange, onRemove, onMove }: { value: string; y?: string; readOnly?: boolean; onChange: () => void; onRemove: () => void; onMove: (y: number) => void }) {
  const b = parseBanner(value)
  const [pos, setPos] = useState(bannerY(y))
  const [moving, setMoving] = useState(false)
  useEffect(() => setPos(bannerY(y)), [y])
  if (!b) return null
  const startMove = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startY = e.clientY
    const start = pos
    let last = start
    setMoving(true)
    const move = (ev: MouseEvent): void => {
      last = Math.max(0, Math.min(100, Math.round(start - (ev.clientY - startY) / 2)))
      setPos(last)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setMoving(false)
      if (last !== start) onMove(last)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const style = b.kind === 'image' ? { backgroundImage: `url("${b.src}")`, backgroundPosition: `center ${pos}%` } : { background: b.css }
  return (
    <div className={`note-banner ${moving ? 'moving' : ''}`} style={style} data-note-banner>
      {!readOnly && (
        <div className="note-banner-tools">
          <button onClick={onChange}>Change</button>
          {b.kind === 'image' && (
            <button onMouseDown={startMove} title="Drag up or down to choose which part shows">
              <MoveVertical size={12} /> Reposition
            </button>
          )}
          <button onClick={onRemove} title="Remove banner">
            <Trash2 size={12} />
          </button>
        </div>
      )}
    </div>
  )
}

function Popover({ children, close, className }: { children: ReactNode; close: () => void; className: string }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [close])
  return (
    <div ref={box} className={`menu header-popover ${className}`}>
      {children}
    </div>
  )
}

function IconPicker({ current, pick }: { current?: string; pick: (emoji: string | undefined) => void }) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const words = q.toLowerCase().trim()
    return words ? EMOJI.filter(([e, k]) => k.includes(words) || e === words) : EMOJI
  }, [q])
  return (
    <>
      <div className="icon-picker-top">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search, or type any emoji"
          onKeyDown={(e) => {
            // Typing an emoji that isn't in the list uses it directly.
            if (e.key === 'Enter' && q.trim() && !shown.length) pick(q.trim())
            else if (e.key === 'Enter' && shown[0]) pick(shown[0][0])
          }}
        />
        {current && (
          <button className="btn" onClick={() => pick(undefined)}>
            Remove
          </button>
        )}
      </div>
      <div className="icon-grid">
        {shown.map(([e, k]) => (
          <button key={e} title={k} onClick={() => pick(e)} data-emoji={e}>
            {e}
          </button>
        ))}
        {shown.length === 0 && /\p{Extended_Pictographic}/u.test(q) && (
          <button onClick={() => pick(q.trim())} title="Use this">
            {q.trim()}
          </button>
        )}
      </div>
    </>
  )
}

function BannerPicker({ pick }: { pick: (value: string) => void }) {
  const folder = usePrefs((s) => s.prefs.attachmentFolder)
  const chooseImage = async (): Promise<void> => {
    try {
      const [path] = await window.api.pickAttachment(folder, true)
      if (path) pick(path)
    } catch (err) {
      notify(err)
    }
  }
  return (
    <>
      <div className="banner-picker-section">Gradients</div>
      <div className="banner-swatches">
        {Object.entries(BANNER_GRADIENTS).map(([name, css]) => (
          <button key={name} style={{ background: css }} title={name} onClick={() => pick(name)} data-banner={name} />
        ))}
      </div>
      <div className="banner-picker-section">Colours</div>
      <div className="banner-swatches">
        {BANNER_COLOURS.map((c) => (
          <button key={c} style={{ background: c }} title={c} onClick={() => pick(c)} />
        ))}
      </div>
      <button className="btn banner-image-btn" onClick={chooseImage}>
        <ImagePlus size={14} /> Choose an image…
      </button>
    </>
  )
}
