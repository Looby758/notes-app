import { useRef, useState, type DragEvent } from 'react'
import { ArrowRightLeft, AudioLines, Check, FileText, Film, FolderOpen, Image as ImageIcon, Loader2, Upload, X } from 'lucide-react'
import type { ExportData, SaveFormat } from '@shared/types'
import { FILE_MANAGER } from '@shared/platform'
import { getDrag } from '../../lib/dnd'
import { convertFile, describeSize, kindOf, outputName, targetsFor, whyNot, type ImageOptions, type Kind } from '../../lib/convert'

interface Item {
  id: number
  file: File
  /** What it's being turned into; null when it can't be converted. */
  format: SaveFormat | null
  status: 'ready' | 'working' | 'done' | 'failed'
  /** Audio: how far along (0…1). */
  progress?: number
  result?: ExportData
  message?: string
}

const SIZES: { label: string; side: number | null }[] = [
  { label: 'Keep the same size', side: null },
  { label: 'Large (2048 pixels)', side: 2048 },
  { label: 'Medium (1280 pixels)', side: 1280 },
  { label: 'Small (640 pixels)', side: 640 }
]

const VIDEO_SIZES: { label: string; height: number | null }[] = [
  { label: 'Keep the same size', height: null },
  { label: 'Full HD (1080p)', height: 1080 },
  { label: 'HD (720p)', height: 720 },
  { label: 'Small (480p)', height: 480 }
]

const KIND_ICONS: Record<Kind, typeof ImageIcon> = { image: ImageIcon, audio: AudioLines, video: Film, document: FileText }

const sizeOf = (data: ExportData): number => (typeof data === 'string' ? new Blob([data]).size : data instanceof Uint8Array ? data.byteLength : data.size)

let nextId = 1

/** The file converter: drop in pictures, videos, sound files and documents and turn them into other kinds. */
export default function ConvertPage() {
  const [items, setItems] = useState<Item[]>([])
  const [side, setSide] = useState<number | null>(null)
  const [videoHeight, setVideoHeight] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const update = (id: number, patch: Partial<Item>): void => setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)))

  const addFiles = (files: FileList | File[]): void => {
    const added: Item[] = [...files].map((file) => {
      const targets = targetsFor(file.name)
      return { id: nextId++, file, format: targets[0]?.format ?? null, status: 'ready', message: targets.length ? undefined : whyNot(file.name) }
    })
    setItems((list) => [...list, ...added])
    setSaved(null)
  }

  const convertAll = async (): Promise<void> => {
    setBusy(true)
    setSaved(null)
    const image: ImageOptions = { maxSide: side, quality: 0.9 }
    for (const it of items) {
      if (!it.format || it.status === 'done') continue
      update(it.id, { status: 'working', progress: undefined, message: undefined })
      try {
        const result = await convertFile(it.file, it.format, { id: it.id, image, videoHeight, onProgress: (progress) => update(it.id, { progress }) })
        update(it.id, { status: 'done', result })
      } catch (err) {
        update(it.id, { status: 'failed', message: err instanceof Error ? err.message : String(err) })
      }
    }
    setBusy(false)
  }

  const saveOne = async (it: Item): Promise<void> => {
    if (!it.result || !it.format) return
    const path = await window.api.exportFile(outputName(it.file.name, it.format, new Set()), it.format, it.result)
    if (path) setSaved(path)
  }

  const saveAll = async (): Promise<void> => {
    const taken = new Set<string>()
    const files = items.filter((it) => it.status === 'done' && it.result && it.format).map((it) => ({ name: outputName(it.file.name, it.format!, taken), data: it.result! }))
    const folder = await window.api.exportFiles('Converted files', files)
    if (folder) setSaved(folder)
  }

  const isFileDrag = (e: DragEvent): boolean => !getDrag() && e.dataTransfer.types.includes('Files')
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
    addFiles(e.dataTransfer.files)
  }

  const waiting = items.filter((it) => it.format && it.status !== 'done').length
  const done = items.filter((it) => it.status === 'done').length
  const hasImages = items.some((it) => it.format && kindOf(it.file.name) === 'image')
  const hasVideos = items.some((it) => it.format && kindOf(it.file.name) === 'video')

  /** Takes items off the list, stopping (and throwing away) any video conversions. */
  const remove = (gone: Item[]): void => {
    for (const it of gone) if (kindOf(it.file.name) === 'video') void window.api.cancelVideo(it.id)
    const ids = new Set(gone.map((it) => it.id))
    setItems((list) => list.filter((x) => !ids.has(x.id)))
  }

  return (
    <div
      className="convert-page"
      data-convert-page
      onDragOver={onDragOver}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragging(false)}
      onDrop={onDrop}
    >
      <div className="convert-inner">
        <h2>
          <ArrowRightLeft size={18} /> Convert files
        </h2>
        <p className="convert-intro">
          Turn iPhone photos into JPGs, videos into MP4s or GIFs, Word documents into PDFs, WAV recordings into MP3s and more. It all happens on this computer: nothing is
          uploaded, and your original files are left as they are.
        </p>

        <button className={`convert-drop ${dragging ? 'over' : ''}`} onClick={() => input.current?.click()} data-convert-drop>
          <Upload size={22} strokeWidth={1.5} />
          <strong>Drop files here, or click to choose them</strong>
          <span>Pictures (HEIC, JPG, PNG, WebP…), videos (MOV, MP4, MKV, AVI…), sound (WAV, MP3, M4A…) and documents (Word, Markdown, text, web pages)</span>
        </button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files)
            e.target.value = ''
          }}
        />

        {items.length > 0 && (
          <>
            <ul className="convert-list">
              {items.map((it) => {
                const kind = kindOf(it.file.name)
                const Icon = kind ? KIND_ICONS[kind] : FileText
                const targets = targetsFor(it.file.name)
                return (
                  <li key={it.id} className={`convert-item ${it.status}`} data-convert-item>
                    <Icon size={16} className="convert-kind" />
                    <div className="convert-name">
                      <span title={it.file.name}>{it.file.name}</span>
                      <small>
                        {it.status === 'done' && it.result
                          ? `${describeSize(it.file.size)} → ${describeSize(sizeOf(it.result))}`
                          : it.message ?? describeSize(it.file.size)}
                      </small>
                    </div>
                    {targets.length > 0 && (
                      <label className="convert-to">
                        <span>to</span>
                        <select
                          className="select"
                          value={it.format ?? ''}
                          disabled={it.status === 'working'}
                          onChange={(e) => update(it.id, { format: e.target.value as SaveFormat, status: 'ready', result: undefined, message: undefined })}
                        >
                          {targets.map((t) => (
                            <option key={t.format} value={t.format}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <div className="convert-status">
                      {it.status === 'working' && (
                        <span className="convert-working">
                          <Loader2 size={14} className="spin" />
                          {it.progress !== undefined ? `${Math.round(it.progress * 100)}%` : 'Working…'}
                        </span>
                      )}
                      {it.status === 'done' && (
                        <button className="btn" onClick={() => saveOne(it)} data-convert-save>
                          <Check size={13} /> Save
                        </button>
                      )}
                    </div>
                    <button
                      className="icon-btn"
                      title="Remove from the list"
                      disabled={it.status === 'working' && kindOf(it.file.name) !== 'video'}
                      onClick={() => remove([it])}
                    >
                      <X size={14} />
                    </button>
                  </li>
                )
              })}
            </ul>

            {hasImages && (
              <label className="convert-option">
                <span>Picture size</span>
                <select className="select" value={side ?? ''} disabled={busy} onChange={(e) => {
                    setSide(e.target.value ? Number(e.target.value) : null)
                    // Pictures already converted are made again at the new size.
                    setItems((list) => list.map((it) => (kindOf(it.file.name) === 'image' && it.status === 'done' ? { ...it, status: 'ready', result: undefined } : it)))
                  }}>
                  {SIZES.map((s) => (
                    <option key={s.label} value={s.side ?? ''}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {hasVideos && (
              <label className="convert-option">
                <span>Video size</span>
                <select className="select" value={videoHeight ?? ''} disabled={busy} onChange={(e) => {
                    setVideoHeight(e.target.value ? Number(e.target.value) : null)
                    setItems((list) => list.map((it) => (kindOf(it.file.name) === 'video' && it.status === 'done' ? { ...it, status: 'ready', result: undefined } : it)))
                  }}>
                  {VIDEO_SIZES.map((s) => (
                    <option key={s.label} value={s.height ?? ''}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="convert-actions">
              <button className="btn" disabled={busy} onClick={() => remove(items)}>
                Clear list
              </button>
              <div className="convert-spacer" />
              {done > 1 && (
                <button className="btn" disabled={busy} onClick={saveAll} data-convert-save-all>
                  Save all ({done})
                </button>
              )}
              <button className="btn btn-primary" disabled={busy || waiting === 0} onClick={convertAll} data-convert-start>
                {busy ? 'Converting…' : waiting > 1 ? `Convert ${waiting} files` : 'Convert'}
              </button>
            </div>

            {saved && (
              <p className="convert-saved">
                Saved.{' '}
                <button className="link-button" onClick={() => window.api.showExported(saved)}>
                  <FolderOpen size={13} /> Show in {FILE_MANAGER}
                </button>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
