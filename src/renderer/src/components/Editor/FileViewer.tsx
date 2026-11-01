import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, FileText, Film, FolderSearch, Pencil, SquarePen } from 'lucide-react'
import { fileKind, openExternally, vaultUrl } from '../../lib/fileKinds'
import { openNote } from '../../lib/editorController'
import { noteTitle } from '../../lib/paths'
import { getNoteText, useNoteIndex } from '../../store/noteIndex'
import { FILE_MANAGER } from '@shared/platform'
import { loadSketch, useSketchVersions } from '../../lib/sketch'
import { useUI } from '../../store/ui'
import SheetView from './SheetView'
import { openVaultVideo } from '../../store/videoPlayer'

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

/** True once `path` turns out to be a sketch drawn in Notes (so it can be edited). */
function useIsSketch(path: string): boolean {
  const [isSketch, setIsSketch] = useState(false)
  useEffect(() => {
    let cancelled = false
    setIsSketch(false)
    loadSketch(path)
      .then((s) => !cancelled && setIsSketch(!!s))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [path])
  return isSketch
}

/** A picture, recording, video, PDF or spreadsheet from the notes folder, in its own tab. */
export default function FileViewer({ path }: { path: string }) {
  const kind = fileKind(path)
  // Bumped when a sketch is saved, so the new drawing shows instead of the old one.
  const sketchVersion = useSketchVersions((s) => s[path] ?? 0)
  const url = vaultUrl(path) + (sketchVersion ? `?v=${sketchVersion}` : '')
  const name = path.slice(path.lastIndexOf('/') + 1)
  const version = useNoteIndex((s) => s.version)
  const notes = useMemo(() => usedIn(path), [path, version])
  const [actualSize, setActualSize] = useState(false)
  const [failed, setFailed] = useState(false)
  const isSketch = useIsSketch(path)

  return (
    <div className="file-viewer" data-file-viewer={path}>
      <div className="file-viewer-bar">
        <span className="file-viewer-name" title={path}>
          {name}
        </span>
        {isSketch && (
          <button className="btn btn-primary" onClick={() => useUI.setState({ sketch: { path } })} data-edit-sketch>
            <Pencil size={13} /> Edit sketch
          </button>
        )}
        {kind === 'image' && !isSketch && (
          <button className="btn btn-primary" onClick={() => useUI.setState({ picEdit: { path } })} title="Crop, resize, add arrows, blur or text" data-edit-picture>
            <SquarePen size={13} /> Edit picture
          </button>
        )}
        {kind === 'video' && (
          <button className="btn btn-primary" onClick={() => openVaultVideo(path)}>
            <Film size={13} /> Play in the video player
          </button>
        )}
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
