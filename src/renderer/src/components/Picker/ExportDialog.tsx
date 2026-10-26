import { useEffect, useMemo, useState } from 'react'
import { FileDown, FileText, FileType2, Globe, Loader2 } from 'lucide-react'
import { useUI } from '../../store/ui'
import { notify } from '../../store/notify'
import { noteTitle } from '../../lib/paths'
import { notesFor, runExport, type ExportFormat } from '../../lib/export'

const FORMATS: { id: ExportFormat; label: string; detail: string; icon: typeof FileText }[] = [
  { id: 'pdf', label: 'PDF', detail: 'To print or send. Looks the same everywhere.', icon: FileText },
  { id: 'docx', label: 'Word', detail: 'A .docx you (or anyone) can keep editing.', icon: FileType2 },
  { id: 'html', label: 'Web page', detail: 'A single .html file that opens in any browser.', icon: Globe }
]

/** Remembered between exports. */
let lastFormat: ExportFormat = 'pdf'

/** "Export…": pick a format (and for folders, one file or one per note), then where to save. */
export default function ExportDialog({ close }: { close: () => void }) {
  const target = useUI((s) => s.exportTarget)
  const [format, setFormat] = useState<ExportFormat>(lastFormat)
  const [combine, setCombine] = useState(true)
  const [subfolders, setSubfolders] = useState(true)
  const [includeProperties, setIncludeProperties] = useState(true)
  const [busy, setBusy] = useState(false)

  // Several selected notes and folders behave like a folder (one file, or a file each).
  const isFolder = (target?.isFolder ?? false) || !!target?.paths
  const count = useMemo(
    () => (target ? notesFor({ target: target.path, isFolder, subfolders, paths: target.paths }).length : 0),
    [target, isFolder, subfolders]
  )
  const name = !target ? '' : !isFolder ? noteTitle(target.path) : target.path ? target.path.split('/').pop()! : 'All notes'

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, close])

  if (!target) return null

  const go = async (): Promise<void> => {
    lastFormat = format
    setBusy(true)
    try {
      const where = await runExport({ target: target.path, isFolder, format, combine, subfolders, includeProperties, paths: target.paths })
      if (where) {
        close()
        notify(`Exported to ${where}`, 'info')
        window.api.showExported(where)
      }
    } catch (err) {
      notify(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="export-dialog" data-export-dialog>
      <div className="export-head">
        <FileDown size={16} />
        <div>
          <h2>{target.paths ? 'Export the selected notes' : `Export “${name}”`}</h2>
          <p>{isFolder ? `${count} ${count === 1 ? 'note' : 'notes'}` : 'One note'}</p>
        </div>
      </div>

      <div className="export-formats" role="radiogroup" aria-label="Format">
        {FORMATS.map((f) => (
          <button key={f.id} role="radio" aria-checked={format === f.id} className={`export-format ${format === f.id ? 'on' : ''}`} data-format={f.id} onClick={() => setFormat(f.id)}>
            <f.icon size={18} />
            <strong>{f.label}</strong>
            <span>{f.detail}</span>
          </button>
        ))}
      </div>

      <div className="export-options">
        {isFolder && (
          <>
            <div className="segmented" role="radiogroup" aria-label="Files">
              <button className={combine ? 'selected' : ''} onClick={() => setCombine(true)} data-combine="one">
                One file
              </button>
              <button className={!combine ? 'selected' : ''} onClick={() => setCombine(false)} data-combine="each">
                A file for each note
              </button>
            </div>
            <p className="export-note">
              {combine
                ? 'Every note in one file, each starting on a new page, with links between them working.'
                : `A new folder with one ${format === 'docx' ? 'Word file' : format === 'pdf' ? 'PDF' : 'page'} per note.${format === 'html' ? ' Links between the pages work.' : ''}`}
            </p>
            <label className="export-check">
              <input type="checkbox" checked={subfolders} onChange={(e) => setSubfolders(e.target.checked)} /> Include notes in subfolders
            </label>
          </>
        )}
        <label className="export-check">
          <input type="checkbox" checked={includeProperties} onChange={(e) => setIncludeProperties(e.target.checked)} /> Include properties (date, tags, status…)
        </label>
      </div>

      <div className="export-foot">
        <button className="btn" onClick={close} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={go} disabled={busy || count === 0} data-export-go>
          {busy ? <Loader2 size={14} className="spin" /> : null}
          {busy ? 'Exporting…' : 'Export…'}
        </button>
      </div>
    </div>
  )
}
