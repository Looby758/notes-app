import { useEffect, useRef } from 'react'
import { useEditor } from '../../store/editor'
import { isNoteTab, jumpTo } from '../../lib/editorController'
import EmptyArt from '../Motion/EmptyArt'

/** Headings of the open note; click one to jump there. The one you're in is highlighted. */
export default function Outline() {
  const active = useEditor((s) => (isNoteTab(s.active) ? s.active : null))
  const outline = useEditor((s) => s.outline)
  const current = useEditor((s) => s.currentHeading)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    list.current?.querySelector('.outline-item.current')?.scrollIntoView({ block: 'nearest' })
  }, [current])

  if (!active) return <div className="panel-empty">Open a note to see its outline.</div>
  if (outline.length === 0) {
    return (
      <div className="panel-empty">
        <EmptyArt kind="outline" size={44} />
        No headings yet. Start a line with <code>#</code>, <code>##</code> or <code>###</code> to add one.
      </div>
    )
  }

  // Indent relative to the biggest heading used, so a note that starts at ## isn't pushed right.
  const top = Math.min(...outline.map((h) => h.level))
  return (
    <div className="outline" ref={list}>
      {outline.map((h, i) => (
        <button
          key={`${h.from}-${i}`}
          className={`outline-item level-${h.level} ${i === current ? 'current' : ''}`}
          style={{ paddingLeft: 12 + (h.level - top) * 14 }}
          onClick={() => jumpTo(h.from)}
          title={h.text}
        >
          {h.text}
        </button>
      ))}
    </div>
  )
}
