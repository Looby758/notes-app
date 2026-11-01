import { useEffect, useRef, useState, type DragEvent } from 'react'
import { ArrowRightLeft, AudioLines, Check, Download, FileText, Film, FolderOpen, Image as ImageIcon, Loader2, Sparkles, Upload, X } from 'lucide-react'
import type { ExportData, FfmpegState, GifSettings, SaveFormat } from '@shared/types'
import GifMaker from './GifMaker'
import { FILE_MANAGER } from '@shared/platform'
import { computerPaths, getDrag } from '../../lib/dnd'
import { convertFile, preferredConvertFormat, describeSize, kindOf, outputName, targetsFor, whyNot, type ImageOptions, type Kind } from '../../lib/convert'

interface Item {
  id: number
  file: File
  /** What it's being turned into; null when it can't be converted. */
  format: SaveFormat | null
  status: 'ready' | 'working' | 'done' | 'failed'
  /** Audio: how far along (0…1). */
  progress?: number
  result?: ExportData
  /** Videos: what the GIF maker was set to (clip, crop, speed, caption). */
  gif?: GifSettings
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
  /** Videos need ffmpeg, which is downloaded only when asked for. */
  const [ffmpeg, setFfmpeg] = useState<FfmpegState | null>(null)
  /** The video open in the GIF maker. */
  const [gifFor, setGifFor] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const update = (id: number, patch: Partial<Item>): void => setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)))

  const addFiles = (files: FileList | File[]): void => {
    const added: Item[] = [...files].map((file) => {
      const targets = targetsFor(file.name)
      const wanted = preferredConvertFormat()
      return { id: nextId++, file, format: (targets.find((t) => t.format === wanted) ?? targets[0])?.format ?? null, status: 'ready', message: targets.length ? undefined : whyNot(file.name) }
    })
    setItems((list) => [...list, ...added])
    setSaved(null)
  }

  const convertOne = async (it: Item): Promise<void> => {
    if (!it.format) return
    update(it.id, { status: 'working', progress: undefined, message: undefined })
    try {
      const image: ImageOptions = { maxSide: side, quality: 0.9 }
      const result = await convertFile(it.file, it.format, { id: it.id, image, videoHeight, gif: it.gif, onProgress: (progress) => update(it.id, { progress }) })
      update(it.id, { status: 'done', result })
    } catch (err) {
      update(it.id, { status: 'failed', message: err instanceof Error ? err.message : String(err) })
    }
  }

  const convertAll = async (): Promise<void> => {
    setBusy(true)
    setSaved(null)
    for (const it of items) {
      if (!it.format || it.status === 'done') continue
      if (kindOf(it.file.name) === 'video' && !videoReady) continue
      await convertOne(it)
    }
    setBusy(false)
  }

  /** The GIF maker's "Make GIF": keeps its settings on the video and makes the GIF now (if ffmpeg is ready). */
  const makeGif = async (id: number, gif: GifSettings): Promise<void> => {
    setGifFor(null)
    const it = items.find((x) => x.id === id)
    if (!it) return
    const next: Item = { ...it, gif, format: 'gif', status: 'ready', result: undefined, message: undefined }
    setItems((list) => list.map((x) => (x.id === id ? next : x)))
    if (!videoReady) return
    setBusy(true)
    setSaved(null)
    await convertOne(next)
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

  // Files from your computer, including ones dragged over from the Files tab (in a pane beside this
  // one, say): those come as real files too, so they're taken the same way.
  const isFileDrag = (e: DragEvent): boolean => (!getDrag() || computerPaths(getDrag()).length > 0) && e.dataTransfer.types.includes('Files')
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

  const hasImages = items.some((it) => it.format && kindOf(it.file.name) === 'image')
  const hasVideos = items.some((it) => it.format && kindOf(it.file.name) === 'video')
  const videoReady = ffmpeg?.state === 'ready'
  const waiting = items.filter((it) => it.format && it.status !== 'done' && (videoReady || kindOf(it.file.name) !== 'video')).length
  const done = items.filter((it) => it.status === 'done').length

  useEffect(() => {
    if (!hasVideos) return
    void window.api.videoConverterStatus().then(setFfmpeg)
    return window.api.onVideoConverterStatus(setFfmpeg)
  }, [hasVideos])

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
                          : it.message ?? (it.format === 'gif' && it.gif ? gifSummary(it.gif) : describeSize(it.file.size))}
                      </small>
                    </div>
                    {targets.length > 0 && (
                      <label className="convert-to">
                        <span>to</span>
                        <select
                          className="select"
                          value={it.format ?? ''}
                          disabled={it.status === 'working'}
                          onChange={(e) => update(it.id, { format: e.target.value as SaveFormat, status: 'ready', result: undefined, message: undefined, gif: undefined })}
                        >
                          {targets.map((t) => (
                            <option key={t.format} value={t.format}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {kind === 'video' && (
                      <button
                        className="btn convert-gif-btn"
                        title="Pick a few seconds, crop, change the speed and add a caption"
                        disabled={it.status === 'working' || busy}
                        onClick={() => setGifFor(it.id)}
                        data-convert-make-gif
                      >
                        <Sparkles size={13} /> {it.gif ? 'Edit GIF' : 'Make a GIF'}
                      </button>
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

            {hasVideos && ffmpeg && ffmpeg.state !== 'ready' && (
              <div className="convert-ffmpeg" data-convert-ffmpeg>
                {ffmpeg.state === 'unsupported' ? (
                  <span>Converting videos isn’t available on this kind of computer yet.</span>
                ) : ffmpeg.state === 'downloading' ? (
                  <span className="convert-working">
                    <Loader2 size={14} className="spin" /> Downloading the video converter… {Math.round((ffmpeg.progress ?? 0) * 100)}%
                  </span>
                ) : (
                  <>
                    <span>
                      Videos need ffmpeg, a free video tool. It’s a one-time download of about 25 MB, and the Studio uses it too.
                      {ffmpeg.error && <small className="convert-ffmpeg-error">{ffmpeg.error}</small>}
                    </span>
                    <button className="btn btn-primary" onClick={() => void window.api.getVideoConverter().then(setFfmpeg)} data-convert-get-ffmpeg>
                      <Download size={13} /> Download
                    </button>
                  </>
                )}
              </div>
            )}

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
      {gifFor !== null && items.some((it) => it.id === gifFor) && (
        <GifMaker
          file={items.find((it) => it.id === gifFor)!.file}
          initial={items.find((it) => it.id === gifFor)!.gif}
          onClose={() => setGifFor(null)}
          onMake={(gif) => void makeGif(gifFor, gif)}
        />
      )}
    </div>
  )
}

/** "GIF: 5.0 seconds from 1:02, cropped, 1.5× speed, with a caption" */
function gifSummary(g: GifSettings): string {
  const from = `${Math.floor(g.start / 60)}:${String(Math.floor(g.start % 60)).padStart(2, '0')}`
  const parts = [`GIF: ${((g.end - g.start) / g.speed).toFixed(1)} seconds from ${from}`]
  if (g.crop) parts.push('cropped')
  if (g.speed !== 1) parts.push(`${g.speed}× speed`)
  if (g.caption) parts.push('with a caption')
  return parts.join(', ')
}
