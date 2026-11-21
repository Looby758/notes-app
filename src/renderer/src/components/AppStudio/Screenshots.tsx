import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Copy, Download, ImagePlus, Images, Loader2, Trash2, X } from 'lucide-react'
import { boardKey, imageUrls, plainTitle, shotsByFeature, timeAgo, type Shot } from '@shared/appStudio'
import { useTerminals } from '../../store/terminals'
import { useAppStudio } from '../../store/appStudio'
import { addShots, deleteShot, newShotId, updateShot, useAppBoard } from '../../store/appBoard'
import { usePrefs } from '../../store/prefs'
import { notify } from '../../store/notify'
import { vaultUrl } from '../../lib/fileKinds'
import { copyPicture } from './Board'

/** The app picked on this tab (kept while Orbit is open). */
let picked: string | null = null

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }
const shotName = (ext: string): string => `screenshot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${Math.random().toString(36).slice(2, 5)}.${ext}`

/**
 * App Studio's feature screenshots: a gallery for each app, grouped by feature and newest first.
 * Pictures come from pasting or dropping them here, picking files, or the images in the app's pull
 * requests. They're kept in your attachments, listed in the notes folder (.notesapp/app-studio.json).
 */
export default function Screenshots() {
  const projects = useTerminals((s) => s.projects)
  const info = useAppStudio((s) => s.info)
  const shots = useAppBoard((s) => s.shots)
  const folder = usePrefs((s) => s.prefs.attachmentFolder)
  const [selected, setSelected] = useState(picked)
  const apps = useMemo(
    () =>
      projects.map((p) => {
        const repo = info[p.folder]?.repo
        return { project: p, repo, key: boardKey({ name: p.name, repo }) }
      }),
    [projects, info]
  )
  const boardApp = useAppBoard((s) => s.app)
  const app = apps.find((a) => a.key === selected) ?? apps.find((a) => a.key === boardApp || a.project.name === boardApp) ?? apps[0]
  const [feature, setFeature] = useState('')
  const [importing, setImporting] = useState(false)
  const [over, setOver] = useState(false)
  const [open, setOpen] = useState<Shot | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const mine = app ? shots.filter((s) => s.app === app.key || s.app === app.project.name) : []
  const groups = shotsByFeature(mine)
  const pulls = useAppStudio((s) => s.pulls)
  const suggestions = [...new Set([...groups.map((g) => g.feature), ...pulls.filter((p) => p.repo === app?.repo).map((p) => plainTitle(p.title))])]

  const addFiles = async (files: File[]): Promise<void> => {
    if (!app) return
    const images = files.filter((f) => EXT[f.type])
    if (!images.length) return
    try {
      const saved: Shot[] = []
      for (const f of images) {
        const path = await window.api.saveAttachment(folder, shotName(EXT[f.type]), new Uint8Array(await f.arrayBuffer()))
        saved.push({ id: newShotId(), app: app.key, feature: feature.trim() || 'Other', picture: path, date: new Date().toISOString() })
      }
      addShots(saved)
    } catch (err) {
      notify(err)
    }
  }

  // Pasting a picture anywhere on the tab adds it (to the feature typed above).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => EXT[f.type])
      if (!files.length || !document.querySelector('.shots')) return
      e.preventDefault()
      void addFiles(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  const importFromPulls = async (): Promise<void> => {
    if (!app?.repo) return
    setImporting(true)
    try {
      const merged = await window.api.appsMerged(app.repo)
      const all = [
        ...merged.map((p) => ({ title: p.title, body: p.body, date: p.mergedAt })),
        ...pulls.filter((p) => p.repo === app.repo).map((p) => ({ title: p.title, body: p.body, date: p.updatedAt }))
      ]
      const known = new Set(useAppBoard.getState().shots.map((s) => s.source))
      const saved: Shot[] = []
      let failed = 0
      for (const p of all) {
        for (const url of imageUrls(p.body)) {
          if (known.has(url) || saved.length >= 40) continue
          known.add(url)
          try {
            const { bytes, type } = await window.api.appsFetchImage(url)
            const path = await window.api.saveAttachment(folder, shotName(EXT[type] ?? 'png'), bytes)
            saved.push({ id: newShotId(), app: app.key, feature: plainTitle(p.title), picture: path, date: p.date, source: url })
          } catch {
            failed++
          }
        }
      }
      addShots(saved)
      notify(
        saved.length
          ? `Added ${saved.length} screenshot${saved.length === 1 ? '' : 's'} from pull requests.${failed ? ` ${failed} couldn’t be downloaded.` : ''}`
          : failed
            ? `${failed} picture${failed === 1 ? '' : 's'} couldn’t be downloaded (a private repository needs GitHub connected).`
            : 'No new pictures in the pull requests.',
        'info'
      )
    } catch (err) {
      notify(err)
    } finally {
      setImporting(false)
    }
  }

  if (!app) return <p className="appstudio-empty">Add an app in My apps first, then its screenshots go here.</p>

  return (
    <div
      className={`shots${over ? ' over' : ''}`}
      onDragOver={(e: DragEvent) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false)
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        setOver(false)
        void addFiles([...e.dataTransfer.files])
      }}
    >
      <div className="board-toolbar">
        <div className="board-apps">
          {apps.map((a) => (
            <button
              key={a.project.id}
              className={a === app ? 'active' : ''}
              onClick={() => {
                picked = a.key
                setSelected(a.key)
              }}
            >
              {a.project.name}
              <span className="appstudio-count">{shots.filter((s) => s.app === a.key || s.app === a.project.name).length}</span>
            </button>
          ))}
        </div>
        <span className="board-spacer" />
        <input
          className="text-input shots-feature"
          list="shots-features"
          placeholder="Feature (for new screenshots)"
          value={feature}
          onChange={(e) => setFeature(e.target.value)}
        />
        <datalist id="shots-features">
          {suggestions.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <button className="btn" onClick={() => fileInput.current?.click()}>
          <ImagePlus size={14} /> Add pictures
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          hidden
          onChange={(e) => {
            void addFiles([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
        {app.repo && (
          <button className="btn" disabled={importing} onClick={() => void importFromPulls()} title="Adds the pictures in this app’s pull requests, under each one’s title">
            {importing ? <Loader2 size={14} className="spin" /> : <Download size={14} />} From pull requests
          </button>
        )}
      </div>
      {!groups.length ? (
        <div className="shots-empty">
          <Images size={28} />
          <p>No screenshots of {app.project.name} yet.</p>
          <span className="muted">Paste a screenshot here (Ctrl+V), drop pictures on this page, or add the ones in its pull requests. Type the feature first to file them under it.</span>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.feature} className="shots-group">
            <header>
              <h3>{g.feature}</h3>
              <span className="muted">
                {g.shots.length} · {timeAgo(g.latest)}
              </span>
            </header>
            <div className="shots-grid">
              {g.shots.map((s) => (
                <button key={s.id} className="shots-thumb" onClick={() => setOpen(s)} title={s.note || g.feature}>
                  <img src={vaultUrl(s.picture)} alt="" loading="lazy" draggable={false} />
                </button>
              ))}
            </div>
          </section>
        ))
      )}
      {open && <ShotViewer shot={useAppBoard.getState().shots.find((s) => s.id === open.id) ?? open} features={suggestions} onClose={() => setOpen(null)} />}
    </div>
  )
}

function ShotViewer({ shot, features, onClose }: { shot: Shot; features: string[]; onClose: () => void }) {
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      className="board-editor-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="board-editor shots-viewer" role="dialog" aria-label="Screenshot">
        <img src={vaultUrl(shot.picture)} alt="" />
        <div className="shots-viewer-fields">
          <input
            className="text-input"
            list="shots-viewer-features"
            defaultValue={shot.feature}
            title="Feature"
            onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== shot.feature && updateShot(shot.id, { feature: e.target.value.trim() })}
          />
          <datalist id="shots-viewer-features">
            {features.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
          <input className="text-input" placeholder="A note about it" defaultValue={shot.note ?? ''} onBlur={(e) => updateShot(shot.id, { note: e.target.value.trim() || undefined })} />
          <span className="muted">{new Date(shot.date).toLocaleDateString()}</span>
        </div>
        <div className="board-editor-actions">
          <button className="btn" onClick={() => void copyPicture(shot.picture)}>
            <Copy size={14} /> Copy picture
          </button>
          <span className="board-spacer" />
          <button
            className={`btn${confirm ? ' appstudio-confirm-danger' : ''}`}
            onClick={() => {
              if (!confirm) return setConfirm(true)
              deleteShot(shot.id)
              onClose()
            }}
            onBlur={() => setConfirm(false)}
          >
            <Trash2 size={14} /> {confirm ? 'Take it off?' : 'Take off'}
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            <X size={14} /> Close
          </button>
        </div>
      </div>
    </div>
  )
}
