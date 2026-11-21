import './pdfEditor.css'
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Copy,
  FilePen,
  FilePlus2,
  FolderOpen,
  Loader2,
  Lock,
  Maximize2,
  PenLine,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Scissors,
  Signature,
  Trash2,
  Type,
  Undo2,
  Upload,
  X
} from 'lucide-react'
import { FILE_MANAGER } from '@shared/platform'
import { computerPaths, getDrag } from '../../lib/dnd'
import { buildPdf, parsePageRanges, pdfName, splitEvery, type FormField, type PageItem } from '../../lib/pdfEdit'
import { pageSize, thumbnail } from '../../lib/pdfView'
import {
  addPdf,
  addStamp,
  closeAll,
  duplicatePage,
  fieldValue,
  movePages,
  redo,
  removePages,
  savedSignature,
  setFieldValue,
  turnPages,
  undo,
  usePdfEditor
} from '../../store/pdfEditor'
import { notify } from '../../store/notify'
import PageView, { textWidth } from './PageView'
import SignaturePad from './SignaturePad'

const PAGE_DRAG = 'application/x-orbit-pdf-pages'
const THUMB = 150

const isPdf = (f: File): boolean => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)

async function addFiles(files: File[]): Promise<void> {
  const pdfs = files.filter(isPdf)
  if (!pdfs.length && files.length) notify('Only PDF files can be opened here. The file converter can turn Word documents and pictures into PDFs.', 'info')
  for (const f of pdfs) {
    try {
      await addPdf(f.name, new Uint8Array(await f.arrayBuffer()))
      // A PDF with a password waits for it before the next one is added.
      while (usePdfEditor.getState().locked) await new Promise((r) => setTimeout(r, 200))
    } catch (err) {
      notify(err)
    }
  }
}

/** Sign, fill in, merge, split, reorder and turn the pages of PDFs. Nothing leaves this computer. */
export default function PdfEditorPage() {
  const pages = usePdfEditor((s) => s.pages)
  const sources = usePdfEditor((s) => s.sources)
  const locked = usePdfEditor((s) => s.locked)
  const selected = usePdfEditor((s) => s.selected)
  const open = usePdfEditor((s) => s.open)
  const canUndo = usePdfEditor((s) => s.past.length > 0)
  const canRedo = usePdfEditor((s) => s.future.length > 0)
  const flatten = usePdfEditor((s) => s.flatten)
  const version = usePdfEditor((s) => s.version)
  const fields = usePdfEditor((s) => s.fields)
  const [dragging, setDragging] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<{ path: string; version: number } | null>(null)
  const [signing, setSigning] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const root = useRef<HTMLDivElement>(null)

  const anyFields = Object.values(fields).some((f) => f.length > 0)
  const openIndex = open ? pages.findIndex((p) => p.key === open) : -1
  const openPage = openIndex >= 0 ? pages[openIndex] : null

  const baseName = useMemo(() => {
    const first = sources.find((s) => pages.some((p) => p.source === s.id)) ?? sources[0]
    return first?.name ?? 'Document.pdf'
  }, [sources, pages])

  const suffix = (): string => {
    if (pages.some((p) => p.stamps.some((s) => s.kind === 'image'))) return 'signed'
    if (new Set(pages.map((p) => p.source)).size > 1) return 'merged'
    if (sources.some((s) => Object.keys(s.values).length)) return 'filled in'
    return 'edited'
  }

  const make = (these: PageItem[]): Promise<Uint8Array> => buildPdf(usePdfEditor.getState().sources, these, { flatten: usePdfEditor.getState().flatten, title: baseName.replace(/\.pdf$/i, '') })

  const save = async (these = pages, name = pdfName(baseName, suffix())): Promise<void> => {
    setSaving(true)
    try {
      const bytes = await make(these)
      const path = await window.api.exportFile(name, 'pdf', bytes)
      if (path) setSaved({ path, version: usePdfEditor.getState().version })
    } catch (err) {
      notify(err)
    } finally {
      setSaving(false)
    }
  }

  const select = (key: string, e: MouseEvent): void => {
    const s = usePdfEditor.getState()
    if (e.shiftKey && s.selected.length) {
      const from = s.pages.findIndex((p) => p.key === s.selected[s.selected.length - 1])
      const to = s.pages.findIndex((p) => p.key === key)
      const [a, b] = from < to ? [from, to] : [to, from]
      const range = s.pages.slice(a, b + 1).map((p) => p.key)
      usePdfEditor.setState({ selected: [...new Set([...s.selected, ...range])] })
    } else if (e.ctrlKey || e.metaKey) {
      usePdfEditor.setState({ selected: s.selected.includes(key) ? s.selected.filter((k) => k !== key) : [...s.selected, key] })
    } else usePdfEditor.setState({ selected: [key] })
  }

  const openAt = (key: string | null): void => {
    setEditing(null)
    usePdfEditor.setState({ open: key, selected: key ? [key] : usePdfEditor.getState().selected })
  }

  /** Puts a signature (or text) in the middle of the open page, ready to drag where it goes. */
  const place = async (kind: 'image' | 'text', content: string): Promise<void> => {
    if (!openPage) return
    const shown = await pageSize(openPage.source, openPage.index, openPage.turn)
    if (kind === 'image') {
      const img = new Image()
      img.src = content
      await img.decode()
      const w = Math.min(0.32, 180 / shown.width)
      const h = (w * shown.width * (img.naturalHeight / img.naturalWidth)) / shown.height
      addStamp(openPage.key, { kind: 'image', image: content, x: 0.5 - w / 2, y: Math.min(0.8, 0.62), w, h })
    } else {
      const h = 16 / shown.height
      const w = textWidth(content, h, shown)
      const id = addStamp(openPage.key, { kind: 'text', text: content, x: 0.5 - w / 2, y: 0.45, w, h })
      if (content === 'Type here') setEditing(id)
    }
  }

  const sign = (): void => {
    const saved = savedSignature()
    if (saved) void place('image', saved)
    else setSigning(true)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement
    if (target.closest('input, textarea, select')) return
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault()
      undo()
    } else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
      e.preventDefault()
      redo()
    } else if (mod && e.key.toLowerCase() === 'a' && !openPage) {
      e.preventDefault()
      usePdfEditor.setState({ selected: pages.map((p) => p.key) })
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !openPage && selected.length) {
      e.preventDefault()
      removePages(selected)
    } else if (e.key === 'Escape') {
      if (openPage) openAt(null)
      else usePdfEditor.setState({ selected: [] })
    } else if (openPage && (e.key === 'ArrowRight' || e.key === 'PageDown') && openIndex < pages.length - 1) openAt(pages[openIndex + 1].key)
    else if (openPage && (e.key === 'ArrowLeft' || e.key === 'PageUp') && openIndex > 0) openAt(pages[openIndex - 1].key)
  }

  // PDFs dropped in from the computer or the Files tab are added (merged) at the end.
  const isFileDrag = (e: DragEvent): boolean =>
    !e.dataTransfer.types.includes(PAGE_DRAG) && (!getDrag() || computerPaths(getDrag()).length > 0) && e.dataTransfer.types.includes('Files')
  const onDragOver = (e: DragEvent<HTMLDivElement>): void => {
    if (!isFileDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setDragging(true)
  }
  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    setDragging(false)
    if (!isFileDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    void addFiles([...e.dataTransfer.files])
  }

  useEffect(() => {
    if (!closing) return
    const t = setTimeout(() => setClosing(false), 3000)
    return () => clearTimeout(t)
  }, [closing])

  const filePicker = (
    <input
      ref={picker}
      type="file"
      accept="application/pdf,.pdf"
      multiple
      hidden
      onChange={(e) => {
        if (e.target.files) void addFiles([...e.target.files])
        e.target.value = ''
      }}
    />
  )

  const lockedPrompt = locked && <PasswordPrompt key={locked.name} />

  if (!pages.length)
    return (
      <div className="pdfe-page" data-pdf-editor onDragOver={onDragOver} onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragging(false)} onDrop={onDrop}>
        <div className="pdfe-start">
          <h2>
            <FilePen size={18} /> PDF editor
          </h2>
          <p className="pdfe-intro">
            Sign a PDF, fill in a form, join PDFs together, split one up, or put its pages in a different order. It all happens on this computer: nothing is uploaded, and the PDFs you
            open are left as they are. You save a new copy when you're done.
          </p>
          <button className={`pdfe-drop ${dragging ? 'over' : ''}`} onClick={() => picker.current?.click()} data-pdf-drop>
            <Upload size={22} strokeWidth={1.5} />
            <strong>Drop PDFs here, or click to choose them</strong>
            <span>Pick more than one to join them together. PDFs with a password work too.</span>
          </button>
          <ul className="pdfe-tips">
            <li>
              <Signature size={14} /> <span><strong>Sign</strong> by drawing with your mouse or typing your name. Orbit can remember it for next time.</span>
            </li>
            <li>
              <FilePen size={14} /> <span><strong>Fill in forms</strong> by typing straight into the boxes on the page, or add text anywhere on a PDF that has no boxes.</span>
            </li>
            <li>
              <FilePlus2 size={14} /> <span><strong>Merge</strong> PDFs, then drag the pages into the order you want.</span>
            </li>
            <li>
              <Scissors size={14} /> <span><strong>Split</strong> into single pages, every few pages, or just the pages you pick.</span>
            </li>
          </ul>
          {filePicker}
          {lockedPrompt}
        </div>
      </div>
    )

  const isSaved = saved && saved.version === version

  return (
    <div
      className={`pdfe-page working ${dragging ? 'over' : ''}`}
      ref={root}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-pdf-editor
      onDragOver={onDragOver}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragging(false)}
      onDrop={onDrop}
    >
      <header className="pdfe-bar">
        {openPage ? (
          <>
            <button className="btn" onClick={() => openAt(null)} title="Back to all the pages (Esc)" data-pdf-back>
              <ArrowLeft size={13} /> All pages
            </button>
            <div className="pdfe-pager">
              <button className="icon-btn" disabled={openIndex <= 0} title="Page before" onClick={() => openAt(pages[openIndex - 1].key)}>
                <ChevronLeft size={15} />
              </button>
              <span>
                Page {openIndex + 1} of {pages.length}
              </span>
              <button className="icon-btn" disabled={openIndex >= pages.length - 1} title="Next page" onClick={() => openAt(pages[openIndex + 1].key)}>
                <ChevronRight size={15} />
              </button>
            </div>
            <span className="pdfe-sep" />
            <button className="btn btn-primary" onClick={sign} title="Put your signature on this page" data-pdf-sign>
              <Signature size={13} /> Sign
            </button>
            {savedSignature() && (
              <button className="icon-btn" onClick={() => setSigning(true)} title="Draw or type a different signature" data-pdf-new-signature>
                <PenLine size={15} />
              </button>
            )}
            <button className="btn" onClick={() => void place('text', 'Type here')} title="Write anywhere on the page" data-pdf-add-text>
              <Type size={13} /> Text
            </button>
            <button className="btn" onClick={() => void place('text', new Date().toLocaleDateString())} title="Put today's date on the page" data-pdf-add-date>
              <CalendarDays size={13} /> Date
            </button>
            <span className="pdfe-sep" />
            <button className="icon-btn" title="Turn anticlockwise" onClick={() => turnPages([openPage.key], -1)}>
              <RotateCcw size={15} />
            </button>
            <button className="icon-btn" title="Turn clockwise" onClick={() => turnPages([openPage.key], 1)}>
              <RotateCw size={15} />
            </button>
          </>
        ) : (
          <>
            <span className="pdfe-title" title={sources.map((s) => s.name).join(', ')}>
              <FilePen size={15} /> {sources.length > 1 ? `${sources.length} PDFs, ${pages.length} pages` : `${baseName} · ${pages.length} page${pages.length === 1 ? '' : 's'}`}
            </span>
            <button className="btn" onClick={() => picker.current?.click()} title="Join another PDF onto the end" data-pdf-add>
              <FilePlus2 size={13} /> Add a PDF
            </button>
            <button className="btn" onClick={() => setSplitting(true)} title="Make several PDFs from this one" data-pdf-split>
              <Scissors size={13} /> Split
            </button>
          </>
        )}
        <div className="pdfe-spacer" />
        <button className="icon-btn" disabled={!canUndo} title="Undo (Ctrl+Z)" onClick={undo} data-pdf-undo>
          <Undo2 size={15} />
        </button>
        <button className="icon-btn" disabled={!canRedo} title="Redo (Ctrl+Y)" onClick={redo}>
          <Redo2 size={15} />
        </button>
        <button className="btn btn-primary" disabled={saving} onClick={() => void save()} data-pdf-save>
          {saving ? <Loader2 size={13} className="spin" /> : <Save size={13} />} Save PDF
        </button>
        <button
          className={`icon-btn ${closing ? 'danger' : ''}`}
          title={closing ? 'Click again to close without saving' : 'Close (your original PDFs stay as they are)'}
          onClick={() => {
            if (!closing && usePdfEditor.getState().past.length && !isSaved) return setClosing(true)
            setSaved(null)
            setClosing(false)
            closeAll()
          }}
          data-pdf-close
        >
          <X size={15} />
        </button>
      </header>
      {closing && <div className="pdfe-note warn">Your changes aren't saved. Click × again to close anyway.</div>}
      {isSaved && (
        <div className="pdfe-note">
          Saved.{' '}
          <button className="link-button" onClick={() => window.api.showExported(saved.path)}>
            <FolderOpen size={13} /> Show in {FILE_MANAGER}
          </button>
        </div>
      )}

      <div className="pdfe-main">
        {openPage ? (
          <PageView pageKey={openPage.key} editing={editing} onEditing={setEditing} />
        ) : (
          <div className="pdfe-grid-wrap" onClick={(e) => e.target === e.currentTarget && usePdfEditor.setState({ selected: [] })}>
            {selected.length > 0 && <SelectionBar keys={selected} onSave={(these) => void save(these, pdfName(baseName, these.length === 1 ? `page ${pages.indexOf(these[0]) + 1}` : 'pages'))} onOpen={openAt} />}
            <PageGrid pages={pages} selected={selected} multi={sources.length > 1} onSelect={select} onOpen={openAt} />
            <p className="pdfe-hint">Drag pages to put them in order. Double-click one to sign it or fill it in. Ctrl+click or Shift+click picks more than one.</p>
          </div>
        )}
        {(anyFields || openPage) && (
          <aside className="pdfe-side">
            {anyFields && <FormPanel fields={fields} pages={pages} openPage={openPage} onOpen={openAt} />}
            {anyFields && (
              <label className="pdfe-check pdfe-flatten" title="The answers become part of the page, so nobody can change them later">
                <input type="checkbox" checked={flatten} onChange={(e) => usePdfEditor.setState({ flatten: e.target.checked })} data-pdf-flatten /> Lock the answers when saving
              </label>
            )}
            {openPage && !anyFields && (
              <div className="pdfe-side-help">
                <strong>No boxes to fill in</strong>
                <p>This PDF isn't a fillable form. Use <em>Add text</em> to write on it anywhere, and drag the text to where it goes.</p>
              </div>
            )}
          </aside>
        )}
      </div>

      {filePicker}
      {lockedPrompt}
      {signing && (
        <SignaturePad
          onClose={() => setSigning(false)}
          onDone={(png) => {
            setSigning(false)
            void place('image', png)
          }}
        />
      )}
      {splitting && <SplitDialog pages={pages} baseName={baseName} make={make} onClose={() => setSplitting(false)} />}
    </div>
  )
}

function SelectionBar({ keys, onSave, onOpen }: { keys: string[]; onSave: (pages: PageItem[]) => void; onOpen: (key: string) => void }) {
  const pages = usePdfEditor((s) => s.pages)
  const picked = pages.filter((p) => keys.includes(p.key))
  return (
    <div className="pdfe-selection" data-pdf-selection>
      <span>
        {picked.length} page{picked.length === 1 ? '' : 's'} picked
      </span>
      {picked.length === 1 && (
        <button className="btn" onClick={() => onOpen(picked[0].key)}>
          <Maximize2 size={13} /> Open
        </button>
      )}
      <button className="btn" onClick={() => turnPages(keys, -1)} title="Turn anticlockwise">
        <RotateCcw size={13} />
      </button>
      <button className="btn" onClick={() => turnPages(keys, 1)} title="Turn clockwise">
        <RotateCw size={13} />
      </button>
      {picked.length === 1 && (
        <button className="btn" onClick={() => duplicatePage(picked[0].key)} title="Add a copy of this page after it">
          <Copy size={13} /> Copy
        </button>
      )}
      <button className="btn" onClick={() => onSave(picked)} title="Save just these pages as a new PDF" data-pdf-save-picked>
        <Save size={13} /> Save as a PDF
      </button>
      <button className="btn danger" onClick={() => removePages(keys)} title="Take these pages out (Delete)" data-pdf-delete>
        <Trash2 size={13} /> Take out
      </button>
      <button className="link-button" onClick={() => usePdfEditor.setState({ selected: [] })}>
        Unpick
      </button>
    </div>
  )
}

function PageGrid({
  pages,
  selected,
  multi,
  onSelect,
  onOpen
}: {
  pages: PageItem[]
  selected: string[]
  multi: boolean
  onSelect: (key: string, e: MouseEvent) => void
  onOpen: (key: string) => void
}) {
  const sources = usePdfEditor((s) => s.sources)
  const [drop, setDrop] = useState<number | null>(null)

  const dragStart = (e: DragEvent, key: string): void => {
    const keys = selected.includes(key) ? pages.filter((p) => selected.includes(p.key)).map((p) => p.key) : [key]
    if (!selected.includes(key)) usePdfEditor.setState({ selected: [key] })
    e.dataTransfer.setData(PAGE_DRAG, JSON.stringify(keys))
    e.dataTransfer.effectAllowed = 'move'
  }
  const over = (e: DragEvent, i: number): void => {
    if (!e.dataTransfer.types.includes(PAGE_DRAG)) return
    e.preventDefault()
    e.stopPropagation()
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setDrop(e.clientX < r.left + r.width / 2 ? i : i + 1)
  }
  const dropped = (e: DragEvent): void => {
    if (!e.dataTransfer.types.includes(PAGE_DRAG)) return
    e.preventDefault()
    e.stopPropagation()
    const keys = JSON.parse(e.dataTransfer.getData(PAGE_DRAG) || '[]') as string[]
    if (drop !== null) movePages(keys, drop)
    setDrop(null)
  }

  return (
    <div className="pdfe-grid" onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDrop(null)} onDrop={dropped} onDragOver={(e) => e.dataTransfer.types.includes(PAGE_DRAG) && e.preventDefault()} data-pdf-grid>
      {pages.map((p, i) => {
        const fileNo = sources.findIndex((s) => s.id === p.source)
        return (
          <div
            key={p.key}
            className={`pdfe-thumb ${selected.includes(p.key) ? 'picked' : ''} ${drop === i ? 'drop-before' : ''} ${drop === i + 1 && i === pages.length - 1 ? 'drop-after' : ''}`}
            draggable
            onDragStart={(e) => dragStart(e, p.key)}
            onDragEnd={() => setDrop(null)}
            onDragOver={(e) => over(e, i)}
            onClick={(e) => {
              e.stopPropagation()
              onSelect(p.key, e)
            }}
            onDoubleClick={() => onOpen(p.key)}
            title={`${sources[fileNo]?.name ?? ''}, page ${p.index + 1}`}
            data-pdf-thumb={i + 1}
          >
            <Thumb page={p} />
            <span className="pdfe-thumb-no">
              {i + 1}
              {multi && <em className={`pdfe-file-tag f${fileNo % 6}`}>{String.fromCharCode(65 + (fileNo % 26))}</em>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function Thumb({ page }: { page: PageItem }) {
  const [url, setUrl] = useState<string | null>(null)
  const [ratio, setRatio] = useState(1.3)
  useEffect(() => {
    let cancelled = false
    void pageSize(page.source, page.index, page.turn).then((s) => !cancelled && setRatio(s.height / s.width))
    void thumbnail(page.source, page.index, page.turn, THUMB)
      .then((u) => !cancelled && setUrl(u))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [page.source, page.index, page.turn])
  const w = ratio > 1.4 ? THUMB / (ratio / 1.4) : THUMB
  return (
    <div className="pdfe-thumb-img" style={{ width: w, height: w * ratio }}>
      {url ? <img src={url} alt="" draggable={false} /> : <Loader2 size={16} className="spin" />}
      {page.stamps.map((s) =>
        s.kind === 'image' ? (
          <img key={s.id} className="pdfe-thumb-stamp" src={s.image} alt="" draggable={false} style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${s.w * 100}%`, height: `${s.h * 100}%` }} />
        ) : (
          <span key={s.id} className="pdfe-thumb-stamp text" style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${s.w * 100}%`, height: `${s.h * 100}%` }} />
        )
      )}
    </div>
  )
}

function FormPanel({ fields, pages, openPage, onOpen }: { fields: Record<string, FormField[]>; pages: PageItem[]; openPage: PageItem | null; onOpen: (key: string) => void }) {
  const sources = usePdfEditor((s) => s.sources)
  const state = usePdfEditor()
  // Each box, under the page it's on now (pages that were taken out don't show).
  const groups: { page: PageItem; at: number; fields: { source: string; field: FormField }[] }[] = []
  pages.forEach((p, at) => {
    const here = (fields[p.source] ?? []).filter((f) => f.pages[0] === p.index)
    if (here.length) groups.push({ page: p, at, fields: here.map((field) => ({ source: p.source, field })) })
  })
  const shown = openPage ? groups.filter((g) => g.page.key === openPage.key) : groups
  return (
    <div className="pdfe-form" data-pdf-form>
      <h3>{openPage ? 'Boxes on this page' : 'Fill in the form'}</h3>
      {!shown.length && <p className="pdfe-muted">{openPage ? 'Nothing to fill in on this page.' : 'The pages with boxes have been taken out.'}</p>}
      {shown.map((g) => (
        <section key={g.page.key}>
          {!openPage && (
            <button className="pdfe-form-page" onClick={() => onOpen(g.page.key)}>
              Page {g.at + 1}
              {sources.length > 1 ? ` · ${sources.find((s) => s.id === g.page.source)?.name}` : ''}
            </button>
          )}
          {g.fields.map(({ source, field }) => {
            const value = fieldValue(state, source, field.name)
            const set = (v: string | boolean): void => setFieldValue(source, field.name, v)
            const id = `pdf-field-${source}-${field.name}`
            if (field.kind === 'check')
              return (
                <label key={field.name} className="pdfe-check" title={field.name}>
                  <input type="checkbox" disabled={field.readOnly} checked={value === true} onChange={(e) => set(e.target.checked)} /> {field.label}
                </label>
              )
            return (
              <div key={field.name} className="pdfe-form-row">
                <label htmlFor={id} title={field.name}>
                  {field.label}
                </label>
                {field.kind === 'text' ? (
                  field.multiline ? (
                    <textarea id={id} className="text-input" disabled={field.readOnly} value={String(value)} onChange={(e) => set(e.target.value)} />
                  ) : (
                    <input id={id} className="text-input" disabled={field.readOnly} value={String(value)} onChange={(e) => set(e.target.value)} />
                  )
                ) : (
                  <select id={id} className="select" disabled={field.readOnly} value={String(value)} onChange={(e) => set(e.target.value)}>
                    <option value="">{field.kind === 'radio' ? 'None picked' : ''}</option>
                    {field.options?.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}

function PasswordPrompt() {
  const locked = usePdfEditor((s) => s.locked)!
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (): Promise<void> => {
    if (!password) return
    setBusy(true)
    try {
      await addPdf(locked.name, locked.bytes, password)
    } catch (err) {
      notify(err)
      usePdfEditor.setState({ locked: null })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="modal-backdrop" onMouseDown={() => usePdfEditor.setState({ locked: null })}>
      <div className="modal pdfe-password" onMouseDown={(e) => e.stopPropagation()} data-pdf-password>
        <h3>
          <Lock size={16} /> “{locked.name}” has a password
        </h3>
        <p className="pdfe-muted">Type it to open the PDF. The copy you save won't need it.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <input className="text-input" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" data-pdf-password-input />
          {locked.wrong && <p className="pdfe-error">That password is not right. Try again.</p>}
          <div className="pdfe-dialog-foot">
            <button type="button" className="btn" onClick={() => usePdfEditor.setState({ locked: null })}>
              Skip this PDF
            </button>
            <button type="submit" className="btn btn-primary" disabled={!password || busy}>
              {busy ? <Loader2 size={13} className="spin" /> : null} Open
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function SplitDialog({ pages, baseName, make, onClose }: { pages: PageItem[]; baseName: string; make: (pages: PageItem[]) => Promise<Uint8Array>; onClose: () => void }) {
  const [how, setHow] = useState<'each' | 'every' | 'pick'>('each')
  const [every, setEvery] = useState(2)
  const [picked, setPicked] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const plan = ((): number[][] | null => {
    if (how === 'each') return splitEvery(pages.length, 1)
    if (how === 'every') return every >= 1 ? splitEvery(pages.length, every) : null
    const one = parsePageRanges(picked, pages.length)
    return one && one.length ? [one] : null
  })()

  const base = baseName.replace(/\.pdf$/i, '')
  const go = async (): Promise<void> => {
    if (!plan) return
    setBusy(true)
    try {
      const files: { name: string; data: Uint8Array }[] = []
      for (const part of plan) {
        const first = part[0] + 1
        const last = part[part.length - 1] + 1
        const label = how === 'pick' ? 'picked pages' : part.length === 1 ? `page ${first}` : `pages ${first}-${last}`
        files.push({ name: pdfName(base, label), data: await make(part.map((i) => pages[i])) })
      }
      const path = files.length === 1 ? await window.api.exportFile(files[0].name, 'pdf', files[0].data) : await window.api.exportFiles(`${base} (split)`, files)
      if (path) setDone(path)
    } catch (err) {
      notify(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal pdfe-split" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()} data-pdf-split-dialog>
        <h3>
          <Scissors size={16} /> Split into separate PDFs
        </h3>
        <label className="pdfe-radio">
          <input type="radio" checked={how === 'each'} onChange={() => setHow('each')} /> Every page on its own ({pages.length} PDFs)
        </label>
        <label className="pdfe-radio">
          <input type="radio" checked={how === 'every'} onChange={() => setHow('every')} /> A new PDF every
          <input type="number" className="text-input pdfe-num" min={1} max={pages.length} value={every} onFocus={() => setHow('every')} onChange={(e) => setEvery(Math.max(1, Number(e.target.value) || 1))} />
          pages{how === 'every' && plan ? ` (${plan.length} PDFs)` : ''}
        </label>
        <label className="pdfe-radio">
          <input type="radio" checked={how === 'pick'} onChange={() => setHow('pick')} /> Just these pages:
          <input className="text-input pdfe-ranges" placeholder={`e.g. 1-3, 5`} value={picked} onFocus={() => setHow('pick')} onChange={(e) => setPicked(e.target.value)} data-pdf-split-pages />
        </label>
        {how === 'pick' && picked && !plan && <p className="pdfe-error">Use page numbers from 1 to {pages.length}, like 1-3, 5.</p>}
        {done && (
          <p className="pdfe-note">
            Saved.{' '}
            <button className="link-button" onClick={() => window.api.showExported(done)}>
              <FolderOpen size={13} /> Show in {FILE_MANAGER}
            </button>
          </p>
        )}
        <div className="pdfe-dialog-foot">
          <button className="btn" onClick={onClose}>
            {done ? 'Done' : 'Cancel'}
          </button>
          <button className="btn btn-primary" disabled={!plan || busy} onClick={() => void go()} data-pdf-split-go>
            {busy ? <Loader2 size={13} className="spin" /> : <Scissors size={13} />} {plan && plan.length > 1 ? `Make ${plan.length} PDFs` : 'Make the PDF'}
          </button>
        </div>
      </div>
    </div>
  )
}
