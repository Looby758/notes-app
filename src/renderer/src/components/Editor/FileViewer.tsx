import { useMemo, useState } from 'react'
import { ExternalLink, FileText, FolderSearch } from 'lucide-react'
import { fileKind, openExternally, vaultUrl } from '../../lib/fileKinds'
import { openNote } from '../../lib/editorController'
import { noteTitle } from '../../lib/paths'
import { getNoteText, useNoteIndex } from '../../store/noteIndex'
import { FILE_MANAGER } from '@shared/platform'
import SheetView from './SheetView'

/** Notes that show or link to `path` (by its file name, as embeds are written). */
function usedIn(path: string): string[] {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const needles = [name, encodeURIComponent(name), name.replace(/ /g, '%20')]
  return useNoteIndex
    .getState()
    .lookup.paths.filter((p) => {
      const text = getNoteText(p)
      return !!text && needles.some((n) => text.includes(n))
    })
    .sort((a, b) => noteTitle(a).localeCompare(noteTitle(b)))
}

/** A picture, recording, video, PDF or spreadsheet from the notes folder, in its own tab. */
export default function FileViewer({ path }: { path: string }) {
  const kind = fileKind(path)
  const url = vaultUrl(path)
  const name = path.slice(path.lastIndexOf('/') + 1)
  const version = useNoteIndex((s) => s.version)
  const notes = useMemo(() => usedIn(path), [path, version])
  const [actualSize, setActualSize] = useState(false)
  const [failed, setFailed] = useState(false)

  return (
    <div className="file-viewer" data-file-viewer={path}>
      <div className="file-viewer-bar">
        <span className="file-viewer-name" title={path}>
          {name}
        </span>
        <button className="btn" onClick={() => openExternally(path)}>
          <ExternalLink size={13} /> Open in its usual app
        </button>
        <button className="btn" onClick={() => window.api.reveal(path)}>
          <FolderSearch size={13} /> Show in {FILE_MANAGER}
        </button>
      </div>
      <div className={`file-viewer-body ${kind}`}>
        {failed ? (
          <p className="file-viewer-failed">This file can’t be shown here. Open it in its usual app instead.</p>
        ) : kind === 'image' ? (
          <img
            src={url}
            alt={name}
            className={actualSize ? 'actual' : ''}
            title={actualSize ? 'Click to fit' : 'Click for actual size'}
            onClick={() => setActualSize(!actualSize)}
            onError={() => setFailed(true)}
          />
        ) : kind === 'audio' ? (
          <audio src={url} controls onError={() => setFailed(true)} />
        ) : kind === 'sheet' ? (
          <SheetView path={path} url={url} name={name} />
        ) : kind === 'video' ? (
          <video src={url} controls onError={() => setFailed(true)} />
        ) : (
          <iframe src={url} title={name} />
        )}
      </div>
      {notes.length > 0 && (
        <div className="file-viewer-used">
          <span>Used in</span>
          {notes.map((n) => (
            <button key={n} className="props-chip" onClick={() => openNote(n)}>
              <FileText size={12} /> {noteTitle(n)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
