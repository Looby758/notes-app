import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, Copy, Crop, Droplets, Redo2, Type, Undo2, X } from 'lucide-react'
import { useUI } from '../../store/ui'
import { notify } from '../../store/notify'
import { recordUndo } from '../../lib/undo'
import { bumpSketch } from '../../lib/sketch'
import { errorMessage } from '../../lib/paths'
import { refreshLinkDecorations } from '../../lib/editorController'
import {
  arrowHead,
  blurCell,
  clampRect,
  clampWidth,
  cropOf,
  editedName,
  folderOf,
  isChanged,
  markSizes,
  newEdit,
  outputSize,
  rectFrom,
  saveType,
  shaftEnd,
  tooSmall,
  widthForHeight,
  type Mark,
  type PicEdit,
  type Rect
} from '../../lib/picEdit'
import { showKeys } from '@shared/platform'

type Tool = 'crop' | 'arrow' | 'blur' | 'text'

const COLOURS = ['#e5484d', '#f08c00', '#ffd43b', '#2f9e5b', '#2f6fdf', '#ffffff', '#1f2328']
const SIZE_NAMES = ['Thin', 'Medium', 'Thick']
const TEXT_SIZE_NAMES = ['Small', 'Medium', 'Big']

/** A drag in progress, in the picture's pixels. */
interface Drag {
  x1: number
  y1: number
  x2: number
  y2: number
}

/**
 * The quick picture editor: crop, resize, arrows, blur and text on a picture in the notes folder.
 * Save puts the edited picture over the original (Ctrl+Z puts the old one back), or "Save a copy"
 * keeps the original and saves "… (edited)" next to it.
 */
export default function PictureEditor() {
  const open = useUI((s) => s.picEdit)
  const close = useCallback(() => useUI.setState({ picEdit: null }), [])
  return open ? <Editor key={open.path} path={open.path} close={close} /> : null
}

function Editor({ path, close }: { path: string; close: () => void }) {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [edit, setEdit] = useState<PicEdit | null>(null)
  const [history, setHistory] = useState<{ undo: PicEdit[]; redo: PicEdit[] }>({ undo: [], redo: [] })
  const [tool, setToolState] = useState<Tool>('arrow')
  const [colour, setColour] = useState(COLOURS[0])
  const [sizeIndex, setSizeIndex] = useState(1)
  const [drag, setDrag] = useState<Drag | null>(null)
  /** The crop box being chosen (before Apply). */
  const [cropBox, setCropBox] = useState<Rect | null>(null)
  /** Text being typed, where it'll go. */
  const [typing, setTyping] = useState<{ x: number; y: number; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLInputElement>(null)

  // Open the picture from its bytes (as a data: address, which the page's security rules allow and
  // which keeps the canvas saveable).
  useEffect(() => {
    let cancelled = false
    window.api
      .readImage(path)
      .then(
        (bytes) =>
          new Promise<string>((resolve, reject) => {
            const type = /\.svg$/i.test(path) ? 'image/svg+xml' : ''
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result))
            reader.onerror = () => reject(reader.error)
            reader.readAsDataURL(new Blob([bytes as BlobPart], type ? { type } : {}))
          })
      )
      .then((url) => {
        if (cancelled) return
        const image = new Image()
        image.onload = () => {
          if (cancelled) return
          setImg(image)
          setEdit(newEdit(image.naturalWidth || 1200, image.naturalHeight || 800))
        }
        image.onerror = () => !cancelled && setFailed('This picture can’t be opened for editing.')
        image.src = url
      })
      .catch((err) => !cancelled && setFailed(errorMessage(err)))
    return () => {
      cancelled = true
    }
  }, [path])

  const sizes = edit ? markSizes(edit) : { arrow: [3, 6, 10], text: [24, 40, 64] }
  /** What the canvas shows: the whole picture while cropping, otherwise the part that's kept. */
  const view: Rect | null = edit ? (tool === 'crop' ? { x: 0, y: 0, w: edit.width, h: edit.height } : cropOf(edit)) : null

  const commit = (next: PicEdit): void => {
    if (!edit) return
    setHistory((h) => ({ undo: [...h.undo, edit], redo: [] }))
    setEdit(next)
  }
  const undo = (): void => {
    if (!edit || history.undo.length === 0) return
    setEdit(history.undo[history.undo.length - 1])
    setHistory((h) => ({ undo: h.undo.slice(0, -1), redo: [...h.redo, edit] }))
    setCropBox(null)
  }
  const redo = (): void => {
    if (!edit || history.redo.length === 0) return
    setEdit(history.redo[history.redo.length - 1])
    setHistory((h) => ({ undo: [...h.undo, edit], redo: h.redo.slice(0, -1) }))
    setCropBox(null)
  }

  const finishTyping = (): void => {
    if (typing && edit && typing.text.trim()) {
      commit({ ...edit, marks: [...edit.marks, { kind: 'text', x: typing.x, y: typing.y, text: typing.text, color: colour, size: sizes.text[sizeIndex] }] })
    }
    setTyping(null)
  }

  const setTool = (next: Tool): void => {
    finishTyping()
    if (next === 'crop' && edit) setCropBox(edit.crop)
    else setCropBox(null)
    setToolState(next)
  }

  const applyCrop = (): void => {
    if (!edit) return
    const box = cropBox ? clampRect(cropBox, edit.width, edit.height) : null
    const whole = !box || tooSmall(box) || (box.w === edit.width && box.h === edit.height)
    const crop = whole ? null : box
    if (JSON.stringify(crop) !== JSON.stringify(edit.crop)) commit({ ...edit, crop, outWidth: null })
    setCropBox(null)
    setToolState('arrow')
  }

  // ---------- drawing ----------

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !img || !edit || !view) return
    if (canvas.width !== view.w) canvas.width = view.w
    if (canvas.height !== view.h) canvas.height = view.h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const live = liveMark(tool, drag, colour, sizes.arrow[sizeIndex])
    draw(ctx, img, edit, view, live ? [...edit.marks, live] : edit.marks)
    if (tool === 'crop') {
      const box = drag ? rectFrom(drag.x1, drag.y1, drag.x2, drag.y2) : cropBox
      if (box) drawCropBox(ctx, box, edit)
    }
  })

  /** Where the pointer is, in the picture's pixels. */
  const at = (e: React.PointerEvent): { x: number; y: number } => {
    const canvas = canvasRef.current
    if (!canvas || !view) return { x: 0, y: 0 }
    const r = canvas.getBoundingClientRect()
    return { x: view.x + ((e.clientX - r.left) / r.width) * view.w, y: view.y + ((e.clientY - r.top) / r.height) * view.h }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0 || !edit) return
    const p = at(e)
    if (tool === 'text') {
      e.preventDefault()
      finishTyping()
      setTyping({ x: p.x, y: p.y, text: '' })
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ x1: p.x, y1: p.y, x2: p.x, y2: p.y })
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!drag) return
    const p = at(e)
    setDrag({ ...drag, x2: p.x, y2: p.y })
  }
  const onPointerUp = (): void => {
    if (!drag || !edit) return
    setDrag(null)
    const box = rectFrom(drag.x1, drag.y1, drag.x2, drag.y2)
    if (tool === 'crop') {
      if (!tooSmall(box)) setCropBox(clampRect(box, edit.width, edit.height))
      return
    }
    const mark = liveMark(tool, drag, colour, sizes.arrow[sizeIndex])
    if (mark && !(mark.kind === 'blur' ? tooSmall(box) : Math.hypot(drag.x2 - drag.x1, drag.y2 - drag.y1) < 6)) {
      commit({ ...edit, marks: [...edit.marks, mark] })
    }
  }

  useEffect(() => {
    if (typing) textRef.current?.focus()
  }, [typing !== null])

  // ---------- saving and closing ----------

  const changed = !!edit && isChanged(edit)

  const cancel = async (): Promise<void> => {
    if (
      (changed || typing?.text.trim()) &&
      !(await window.api.confirm({ message: 'Close without saving your changes?', ok: 'Close without saving', cancel: 'Keep editing', type: 'warning' }))
    )
      return
    close()
  }

  /** The finished picture, at its saved size. */
  const render = async (type: string): Promise<Blob> => {
    if (!img || !edit) throw new Error('The picture isn’t open yet.')
    const final = withTyping(edit, typing, colour, sizes.text[sizeIndex])
    const crop = cropOf(final)
    const out = outputSize(final)
    const canvas = document.createElement('canvas')
    canvas.width = out.width
    canvas.height = out.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('The picture couldn’t be drawn.')
    if (type === 'image/jpeg') {
      // JPEG has no see-through parts; make them white rather than black.
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, out.width, out.height)
    }
    ctx.imageSmoothingQuality = 'high'
    ctx.scale(out.width / crop.w, out.height / crop.h)
    draw(ctx, img, final, crop, final.marks, false)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92))
    if (!blob) throw new Error('The picture couldn’t be saved.')
    return blob
  }

  const bytesOf = async (blob: Blob): Promise<Uint8Array> => new Uint8Array(await blob.arrayBuffer())

  const save = async (): Promise<void> => {
    const type = saveType(path)
    if (!type) return saveCopy()
    if (saving) return
    setSaving(true)
    try {
      const before = await window.api.readImage(path)
      const after = await bytesOf(await render(type))
      const put = async (data: Uint8Array): Promise<void> => {
        await window.api.writePicture(path, data)
        bumpSketch(path)
        refreshLinkDecorations()
      }
      await put(after)
      recordUndo({ label: `Edited “${name}”`, undo: () => put(before), redo: () => put(after) })
      notify(`Saved. ${showKeys('Ctrl+Z')} puts the old picture back.`, 'info')
      close()
    } catch (err) {
      notify(err)
      setSaving(false)
    }
  }

  const saveCopy = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    try {
      const type = saveType(path) ?? 'image/png'
      const saved = await window.api.saveAttachment(folderOf(path), editedName(path), await bytesOf(await render(type)))
      notify(`Saved as “${saved.slice(saved.lastIndexOf('/') + 1)}”, next to the original.`, 'info')
      close()
    } catch (err) {
      notify(err)
      setSaving(false)
    }
  }

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': await render('image/png') })])
      notify('Copied the picture.', 'info')
    } catch (err) {
      notify(err)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Typing the text is just typing (Enter puts it on, Esc drops it).
      if (e.target instanceof HTMLInputElement) {
        if (e.target === textRef.current && (e.key === 'Enter' || e.key === 'Escape')) {
          e.preventDefault()
          e.stopPropagation()
          if (e.key === 'Enter') finishTyping()
          else setTyping(null)
        }
        return
      }
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      let handled = true
      if (e.key === 'Escape') {
        if (tool === 'crop') {
          setCropBox(null)
          setToolState('arrow')
        } else void cancel()
      } else if (e.key === 'Enter' && tool === 'crop') applyCrop()
      else if (mod && key === 'z' && e.shiftKey) redo()
      else if (mod && key === 'z') undo()
      else if (mod && key === 'y') redo()
      else if (mod && key === 's' && e.shiftKey) void saveCopy()
      else if (mod && key === 's') void save()
      else if (!mod && !e.altKey && key === 'c') setTool('crop')
      else if (!mod && !e.altKey && key === 'a') setTool('arrow')
      else if (!mod && !e.altKey && key === 'b') setTool('blur')
      else if (!mod && !e.altKey && key === 't') setTool('text')
      else handled = false
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const out = edit ? outputSize(edit) : null
  const canReplace = saveType(path) !== null

  return (
    <div className="modal-backdrop sketch-backdrop" onMouseDown={(e) => e.target === e.currentTarget && void cancel()}>
      <div className="modal sketch-pad pic-editor" role="dialog" aria-label={`Editing ${name}`} data-pic-editor>
        <div className="sketch-toolbar">
          <div className="sketch-group">
            <ToolButton active={tool === 'crop'} onClick={() => setTool('crop')} title="Crop: drag a box round the part to keep (C)" data="crop">
              <Crop size={15} />
            </ToolButton>
            <ToolButton active={tool === 'arrow'} onClick={() => setTool('arrow')} title="Arrow: drag from the tail to the point (A)" data="arrow">
              <ArrowUpRight size={15} />
            </ToolButton>
            <ToolButton active={tool === 'blur'} onClick={() => setTool('blur')} title="Blur: drag a box over anything private (B)" data="blur">
              <Droplets size={15} />
            </ToolButton>
            <ToolButton active={tool === 'text'} onClick={() => setTool('text')} title="Text: click where it goes and type (T)" data="text">
              <Type size={15} />
            </ToolButton>
          </div>
          {tool === 'crop' ? (
            <div className="sketch-group">
              <span className="pic-hint">Drag a box round the part to keep</span>
              <button className="btn btn-primary" onClick={applyCrop} data-pic-crop-apply>
                <Check size={14} /> Apply crop
              </button>
              <button className="btn" onClick={() => setCropBox(null)} disabled={!cropBox} title="Keep the whole picture">
                Keep it all
              </button>
            </div>
          ) : tool === 'blur' ? (
            <div className="sketch-group">
              <span className="pic-hint">Drag a box over anything private</span>
            </div>
          ) : (
            <>
              <div className="sketch-group">
                {COLOURS.map((c) => (
                  <button
                    key={c}
                    className={`sketch-colour ${c === colour ? 'active' : ''}`}
                    style={{ background: c }}
                    onClick={() => setColour(c)}
                    title="Colour"
                    aria-label={`Colour ${c}`}
                    data-pic-colour={c}
                  />
                ))}
              </div>
              <div className="sketch-group">
                {[0, 1, 2].map((i) => (
                  <button
                    key={i}
                    className={`icon-btn sketch-size ${i === sizeIndex ? 'active' : ''}`}
                    onClick={() => setSizeIndex(i)}
                    title={(tool === 'text' ? TEXT_SIZE_NAMES : SIZE_NAMES)[i]}
                  >
                    <i style={{ width: 4 + i * 4, height: 4 + i * 4 }} />
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="sketch-group">
            <button className="icon-btn" onClick={undo} disabled={history.undo.length === 0} title={`Undo (${showKeys('Ctrl+Z')})`} data-pic-undo>
              <Undo2 size={15} />
            </button>
            <button className="icon-btn" onClick={redo} disabled={history.redo.length === 0} title={`Redo (${showKeys('Ctrl+Y')})`}>
              <Redo2 size={15} />
            </button>
          </div>
          {edit && out && tool !== 'crop' && <SizeBox edit={edit} out={out} onChange={(outWidth) => commit({ ...edit, outWidth })} />}
          <span className="sketch-spacer" />
          <button className="icon-btn" onClick={() => void copy()} disabled={!edit} title="Copy the edited picture" data-pic-copy>
            <Copy size={15} />
          </button>
          <button className="btn" onClick={() => void saveCopy()} disabled={!edit || saving} title={`Keep the original and save “${editedName(path)}” next to it (${showKeys('Ctrl+Shift+S')})`} data-pic-save-copy>
            Save a copy
          </button>
          {canReplace && (
            <button className="btn btn-primary" onClick={() => void save()} disabled={!edit || saving || !(changed || typing?.text.trim())} title={`Save over the picture (${showKeys('Ctrl+S')}). ${showKeys('Ctrl+Z')} afterwards puts the old one back.`} data-pic-save>
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
          <button className="icon-btn" onClick={() => void cancel()} title="Close (Esc)" data-pic-close>
            <X size={15} />
          </button>
        </div>
        <div className="sketch-body">
          <div className="sketch-board">
            {failed ? (
              <p className="sketch-loading">{failed}</p>
            ) : edit && view ? (
              <div className="pic-stage">
                <canvas
                  ref={canvasRef}
                  className={`sketch-canvas pic-canvas tool-${tool}`}
                  style={{ aspectRatio: `${view.w} / ${view.h}` }}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  data-pic-canvas
                />
                {typing && (
                  <input
                    ref={textRef}
                    className="pic-text-input"
                    value={typing.text}
                    placeholder="Type, then Enter"
                    onChange={(e) => setTyping({ ...typing, text: e.target.value })}
                    onBlur={finishTyping}
                    style={{
                      left: `${((typing.x - view.x) / view.w) * 100}%`,
                      top: `${((typing.y - view.y) / view.h) * 100}%`,
                      color: colour
                    }}
                    data-pic-text
                  />
                )}
              </div>
            ) : (
              <p className="sketch-loading">Opening the picture…</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** The saved size: width × height (they stay in proportion). */
function SizeBox({ edit, out, onChange }: { edit: PicEdit; out: { width: number; height: number }; onChange: (outWidth: number | null) => void }) {
  const [w, setW] = useState(String(out.width))
  const [h, setH] = useState(String(out.height))
  useEffect(() => {
    setW(String(out.width))
    setH(String(out.height))
  }, [out.width, out.height])
  const apply = (width: number): void => {
    if (!Number.isFinite(width) || width <= 0) {
      setW(String(out.width))
      setH(String(out.height))
      return
    }
    const next = clampWidth(edit, width)
    if (next !== edit.outWidth) onChange(next)
    else {
      setW(String(out.width))
      setH(String(out.height))
    }
  }
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, fromHeight: boolean): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      apply(fromHeight ? widthForHeight(edit, Number(h)) : Number(w))
    }
  }
  return (
    <div className="sketch-group pic-size" title="The size it’s saved at (stays in proportion)">
      <input
        type="number"
        min={1}
        value={w}
        onChange={(e) => {
          setW(e.target.value)
          const n = Number(e.target.value)
          if (n > 0) setH(String(Math.round((n * out.height) / out.width)))
        }}
        onBlur={() => apply(Number(w))}
        onKeyDown={(e) => onKey(e, false)}
        aria-label="Width"
        data-pic-width
      />
      <span>×</span>
      <input
        type="number"
        min={1}
        value={h}
        onChange={(e) => {
          setH(e.target.value)
          const n = Number(e.target.value)
          if (n > 0) setW(String(widthForHeight(edit, n)))
        }}
        onBlur={() => apply(widthForHeight(edit, Number(h)))}
        onKeyDown={(e) => onKey(e, true)}
        aria-label="Height"
        data-pic-height
      />
      <button className="link-btn" onClick={() => apply(cropOf(edit).w / 2)} title="Half the size">
        ½
      </button>
      {edit.outWidth !== null && (
        <button className="link-btn" onClick={() => onChange(null)} title="Back to the full size">
          Full size
        </button>
      )}
    </div>
  )
}

function ToolButton(props: { active: boolean; onClick: () => void; title: string; data: string; children: React.ReactNode }) {
  return (
    <button className={`icon-btn ${props.active ? 'active' : ''}`} onClick={props.onClick} title={props.title} aria-pressed={props.active} data-pic-tool={props.data}>
      {props.children}
    </button>
  )
}

/** The mark being dragged out, if the tool makes one. */
function liveMark(tool: Tool, drag: Drag | null, colour: string, size: number): Mark | null {
  if (!drag) return null
  if (tool === 'arrow') return { kind: 'arrow', x1: drag.x1, y1: drag.y1, x2: drag.x2, y2: drag.y2, color: colour, size }
  if (tool === 'blur') return { kind: 'blur', ...rectFrom(drag.x1, drag.y1, drag.x2, drag.y2) }
  return null
}

/** The edit with half-typed text put on, so saving doesn't lose it. */
function withTyping(edit: PicEdit, typing: { x: number; y: number; text: string } | null, colour: string, size: number): PicEdit {
  if (!typing?.text.trim()) return edit
  return { ...edit, marks: [...edit.marks, { kind: 'text', x: typing.x, y: typing.y, text: typing.text, color: colour, size }] }
}

/**
 * Draws the picture and its marks, with `view` (in the picture's pixels) filling the canvas at its
 * current scale. Blurs go first so arrows and text on top stay sharp.
 */
function draw(ctx: CanvasRenderingContext2D, img: HTMLImageElement, edit: PicEdit, view: Rect, marks: Mark[], clear = true): void {
  ctx.save()
  if (clear) {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    ctx.restore()
    ctx.save()
  }
  ctx.translate(-view.x, -view.y)
  ctx.drawImage(img, 0, 0, edit.width, edit.height)
  for (const m of marks) {
    if (m.kind !== 'blur') continue
    const box = clampRect(m, edit.width, edit.height)
    if (box.w < 1 || box.h < 1) continue
    const cell = blurCell(box)
    const small = document.createElement('canvas')
    small.width = Math.max(1, Math.ceil(box.w / cell))
    small.height = Math.max(1, Math.ceil(box.h / cell))
    const sctx = small.getContext('2d')
    if (!sctx) continue
    sctx.imageSmoothingQuality = 'high'
    sctx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, small.width, small.height)
    ctx.save()
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(small, box.x, box.y, box.w, box.h)
    ctx.restore()
  }
  for (const m of marks) {
    if (m.kind === 'arrow') {
      const [ex, ey] = shaftEnd(m.x1, m.y1, m.x2, m.y2, m.size)
      ctx.strokeStyle = m.color
      ctx.fillStyle = m.color
      ctx.lineWidth = m.size
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(m.x1, m.y1)
      ctx.lineTo(ex, ey)
      ctx.stroke()
      const head = arrowHead(m.x1, m.y1, m.x2, m.y2, m.size)
      ctx.beginPath()
      ctx.moveTo(head[0][0], head[0][1])
      ctx.lineTo(head[1][0], head[1][1])
      ctx.lineTo(head[2][0], head[2][1])
      ctx.closePath()
      ctx.fill()
    } else if (m.kind === 'text') {
      ctx.font = `600 ${m.size}px system-ui, -apple-system, "Segoe UI", sans-serif`
      ctx.textBaseline = 'top'
      // A thin outline in the opposite shade keeps it readable on any background.
      ctx.lineJoin = 'round'
      ctx.lineWidth = Math.max(2, m.size / 8)
      ctx.strokeStyle = isLight(m.color) ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.85)'
      ctx.strokeText(m.text, m.x, m.y)
      ctx.fillStyle = m.color
      ctx.fillText(m.text, m.x, m.y)
    }
  }
  ctx.restore()
}

/** The crop box: everything outside it dimmed, with a border and the size. */
function drawCropBox(ctx: CanvasRenderingContext2D, box: Rect, edit: PicEdit): void {
  const line = Math.max(1, Math.round(Math.max(edit.width, edit.height) / 600))
  ctx.save()
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.beginPath()
  ctx.rect(0, 0, edit.width, edit.height)
  ctx.rect(box.x, box.y, box.w, box.h)
  ctx.fill('evenodd')
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = line
  ctx.setLineDash([line * 6, line * 4])
  ctx.strokeRect(box.x, box.y, box.w, box.h)
  ctx.restore()
}

function isLight(hex: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return false
  const n = parseInt(m[1], 16)
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 > 150
}
