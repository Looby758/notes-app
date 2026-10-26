import { useState, type ReactNode } from 'react'
import { Apple, Check, FileArchive, FileText, FolderOpen, Import, NotebookPen, StickyNote } from 'lucide-react'
import { IS_MAC } from '@shared/platform'
import { openSource, type Source } from '../../lib/import/source'
import { fromAppleNotes, fromEvernote, fromFiles, fromKeep, fromNotion } from '../../lib/import/converters'
import { writeImport, type ImportedNote, type ImportResult } from '../../lib/import/write'
import { useVault } from '../../store/vault'
import { showSidebarView } from '../../store/ui'

type SourceId = 'apple' | 'keep' | 'notion' | 'evernote' | 'files'

interface SourceInfo {
  id: SourceId
  name: string
  icon: ReactNode
  how: ReactNode
  /** What can be picked: a file (with these extensions) and/or a folder. */
  file?: string[]
  folder?: boolean
  convert?: (src: Source) => Promise<ImportedNote[]>
}

const SOURCES: SourceInfo[] = [
  {
    id: 'apple',
    name: 'Apple Notes',
    icon: <Apple size={18} />,
    how: IS_MAC ? (
      <>Notes reads them straight from the Notes app on this Mac. macOS asks once whether that’s OK. Locked notes are skipped.</>
    ) : (
      <>Apple Notes can only be imported on a Mac (it reads them from the Notes app there). Open Notes on your Mac and import from there.</>
    )
  },
  {
    id: 'keep',
    name: 'Google Keep',
    icon: <StickyNote size={18} />,
    how: (
      <>
        Go to <b>takeout.google.com</b>, choose only <b>Keep</b> and export. Then pick the .zip you download (or the folder after unzipping it). Labels become
        tags, checklists stay checklists, pictures come too. Notes in the bin are skipped.
      </>
    ),
    file: ['zip'],
    folder: true,
    convert: fromKeep
  },
  {
    id: 'notion',
    name: 'Notion',
    icon: <NotebookPen size={18} />,
    how: (
      <>
        In Notion: <b>Settings → Export all workspace content</b> (or ••• on a page → Export), with <b>Markdown &amp; CSV</b>. Pick the .zip. Pages keep
        their folders, links between them become [[links]], and databases become tables.
      </>
    ),
    file: ['zip'],
    folder: true,
    convert: fromNotion
  },
  {
    id: 'evernote',
    name: 'Evernote',
    icon: <FileArchive size={18} />,
    how: (
      <>
        In Evernote, select notes or a notebook and choose <b>Export</b> as <b>ENEX (.enex)</b>. Pick the .enex file (or a folder of them: each notebook
        becomes a folder). Tags, checkboxes, pictures and attachments come too.
      </>
    ),
    file: ['enex'],
    folder: true,
    convert: fromEvernote
  },
  {
    id: 'files',
    name: 'Markdown or text files',
    icon: <FileText size={18} />,
    how: <>A folder of .md, .txt or .html files, from Obsidian, Bear, Simplenote or anywhere else. Folders and pictures come along.</>,
    folder: true,
    file: ['zip'],
    convert: fromFiles
  }
]

type Step = { kind: 'choose' } | { kind: 'reading' } | { kind: 'ready'; notes: ImportedNote[]; note?: string } | { kind: 'writing'; done: number; total: number } | { kind: 'done'; result: ImportResult }

/** Import notes from Apple Notes, Google Keep, Notion, Evernote or a folder of files. */
export default function ImportDialog({ close }: { close: () => void }) {
  const [source, setSource] = useState<SourceInfo>(SOURCES[IS_MAC ? 0 : 1])
  const [step, setStep] = useState<Step>({ kind: 'choose' })
  const [error, setError] = useState('')

  const read = async (pick: 'file' | 'folder' | 'apple'): Promise<void> => {
    setError('')
    try {
      if (pick === 'apple') {
        setStep({ kind: 'reading' })
        const { notes, locked } = await fromAppleNotes()
        setStep({ kind: 'ready', notes, note: locked ? `${locked} locked ${locked === 1 ? 'note is' : 'notes are'} left out (unlock them in Apple Notes first).` : undefined })
        return
      }
      const path = await window.api.pickImport(pick, source.file ?? [])
      if (!path) return
      setStep({ kind: 'reading' })
      const src = await openSource(path, pick === 'folder', source.id === 'notion')
      const notes = await source.convert!(src)
      setStep({ kind: 'ready', notes })
    } catch (err) {
      setStep({ kind: 'choose' })
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const run = async (notes: ImportedNote[]): Promise<void> => {
    setStep({ kind: 'writing', done: 0, total: notes.length })
    try {
      const result = await writeImport(source.name, notes, (done, total) => setStep({ kind: 'writing', done, total }))
      setStep({ kind: 'done', result })
    } catch (err) {
      setStep({ kind: 'choose' })
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const busy = step.kind === 'reading' || step.kind === 'writing'
  return (
    <div className="import-dialog" data-import-dialog>
      <h3>
        <Import size={16} /> Import notes
      </h3>
      {step.kind === 'choose' && (
        <>
          <div className="import-sources">
            {SOURCES.map((s) => (
              <button key={s.id} className={`import-source ${s.id === source.id ? 'on' : ''}`} onClick={() => setSource(s)} data-import-source={s.id}>
                {s.icon}
                {s.name}
              </button>
            ))}
          </div>
          <p className="import-how">{source.how}</p>
          {error && <p className="lock-error">{error}</p>}
          <div className="lock-foot">
            <button className="btn" onClick={close}>
              Cancel
            </button>
            {source.id === 'apple' ? (
              <button className="btn btn-primary" disabled={!IS_MAC} onClick={() => read('apple')}>
                Read Apple Notes
              </button>
            ) : (
              <>
                {source.folder && (
                  <button className="btn" onClick={() => read('folder')} data-import-pick="folder">
                    <FolderOpen size={14} /> Choose a folder…
                  </button>
                )}
                {source.file && (
                  <button className="btn btn-primary" onClick={() => read('file')} data-import-pick="file">
                    Choose the .{source.file[0]} file…
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
      {step.kind === 'reading' && <p className="import-how">Reading your {source.name} export…</p>}
      {step.kind === 'ready' && (
        <>
          <p className="import-how" data-import-found={step.notes.length}>
            {step.notes.length === 0
              ? `No ${source.name} notes were found there. Is it the right file?`
              : `Found ${step.notes.length} ${step.notes.length === 1 ? 'note' : 'notes'}${
                  step.notes.some((n) => n.files?.length) ? ` with ${step.notes.reduce((s, n) => s + (n.files?.length ?? 0), 0)} pictures and files` : ''
                }. They’ll go in a new folder, Imported/${source.name}, so nothing you have is changed.`}
          </p>
          {step.note && <p className="import-how">{step.note}</p>}
          <div className="lock-foot">
            <button className="btn" onClick={() => setStep({ kind: 'choose' })}>
              Back
            </button>
            <button className="btn btn-primary" disabled={step.notes.length === 0} onClick={() => run(step.notes)} data-import-go>
              Import {step.notes.length} {step.notes.length === 1 ? 'note' : 'notes'}
            </button>
          </div>
        </>
      )}
      {step.kind === 'writing' && (
        <div className="import-progress">
          <p className="import-how">
            Importing… {step.done} of {step.total}
          </p>
          <div className="import-bar">
            <span style={{ width: `${step.total ? (step.done / step.total) * 100 : 0}%` }} />
          </div>
        </div>
      )}
      {step.kind === 'done' && (
        <>
          <p className="import-how" data-import-done>
            <Check size={14} /> Imported {step.result.notes} {step.result.notes === 1 ? 'note' : 'notes'}
            {step.result.files ? ` and ${step.result.files} ${step.result.files === 1 ? 'file' : 'files'}` : ''} into <b>{step.result.folder}</b>.
          </p>
          {step.result.skipped.length > 0 && (
            <details className="import-skipped">
              <summary>{step.result.skipped.length} couldn’t be imported</summary>
              {step.result.skipped.slice(0, 50).map((s) => (
                <div key={s}>{s}</div>
              ))}
            </details>
          )}
          <div className="lock-foot">
            <button
              className="btn btn-primary"
              onClick={() => {
                close()
                showSidebarView('files')
                useVault.getState().expandTo(step.result.folder)
                useVault.getState().select(step.result.folder)
              }}
            >
              Show them
            </button>
          </div>
        </>
      )}
      {busy && <p className="import-wait">This can take a minute for big exports.</p>}
    </div>
  )
}
