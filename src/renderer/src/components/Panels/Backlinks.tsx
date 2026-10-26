import { useMemo } from 'react'
import { FileText } from 'lucide-react'
import { useEditor } from '../../store/editor'
import { backlinksTo, useNoteIndex, type IndexedLink } from '../../store/noteIndex'
import { isNoteTab, openNote } from '../../lib/editorController'
import { noteTitle, parentOf } from '../../lib/paths'

const CONTEXT = 60

/** The linking line, trimmed to a window around the link, with the link itself highlighted. */
function Snippet({ link }: { link: IndexedLink }) {
  const { snippet, snipFrom, snipTo } = link
  const start = Math.max(0, snipFrom - CONTEXT)
  const end = Math.min(snippet.length, snipTo + CONTEXT)
  return (
    <>
      {start > 0 && '…'}
      {snippet.slice(start, snipFrom).trimStart()}
      <mark>{snippet.slice(snipFrom, snipTo)}</mark>
      {snippet.slice(snipTo, end).trimEnd()}
      {end < snippet.length && '…'}
    </>
  )
}

export default function Backlinks() {
  const active = useEditor((s) => (isNoteTab(s.active) ? s.active : null))
  const version = useNoteIndex((s) => s.version)
  // `version` changes whenever any note's links change.
  const groups = useMemo(() => (active ? backlinksTo(active) : []), [active, version])
  return (
    <div className="backlinks">
      <div className="backlinks-list">
        {!active && <div className="panel-empty">Open a note to see what links to it.</div>}
        {active && groups.length === 0 && (
          <div className="panel-empty">
            No notes link here yet. Link to this note from another one with <code>[[{noteTitle(active)}]]</code>.
          </div>
        )}
        {groups.map(({ source, links }) => (
          <div key={source} className="backlink-group">
            <button className="backlink-source" onClick={() => openNote(source)} title={source}>
              <FileText size={14} />
              <span className="backlink-title">{noteTitle(source)}</span>
              {parentOf(source) && <span className="backlink-folder">{parentOf(source)}</span>}
            </button>
            {links.map((link) => (
              <button
                key={link.from}
                className="backlink-snippet"
                onClick={() => openNote(source, { line: link.line })}
                title="Go to this line"
              >
                <Snippet link={link} />
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
