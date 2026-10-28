import { useMemo } from 'react'
import { CalendarDays, Link2, ListTree } from 'lucide-react'
import { showRightView, useUI, type RightView } from '../../store/ui'
import { useEditor } from '../../store/editor'
import { backlinksTo, useNoteIndex } from '../../store/noteIndex'
import { isNoteTab } from '../../lib/editorController'
import Backlinks from './Backlinks'
import Outline from './Outline'
import MiniCalendar from '../Calendar/MiniCalendar'
import { useNoteHidden } from '../../store/streamer'

const VIEWS: { id: RightView; label: string; icon: typeof Link2 }[] = [
  { id: 'backlinks', label: 'Backlinks', icon: Link2 },
  { id: 'outline', label: 'Outline', icon: ListTree },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays }
]

export default function RightPanel() {
  const view = useUI((s) => s.rightView)
  const active = useEditor((s) => (isNoteTab(s.active) ? s.active : null))
  const version = useNoteIndex((s) => s.version)
  const headings = useEditor((s) => s.outline.length)
  // Streamer mode: a hidden note's headings and links would give it away.
  const hidden = useNoteHidden(active)
  // `version` changes whenever any note's links change.
  const backlinkCount = useMemo(
    () => (active ? backlinksTo(active).reduce((n, g) => n + g.links.length, 0) : 0),
    [active, version]
  )
  const counts: Record<RightView, number> = { backlinks: hidden ? 0 : backlinkCount, outline: active && !hidden ? headings : 0, calendar: 0 }

  return (
    <div className="sidebar-inner">
      <div className="panel-header panel-tabs">
        {/* Only the selected tab shows its name, so three fit in a narrow panel. */}
        {VIEWS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`panel-tab ${view === id ? 'selected' : ''}`}
            onClick={() => showRightView(id)}
            title={label}
            aria-label={label}
          >
            <Icon size={13} /> {view === id && label}
            {counts[id] > 0 && <span className="panel-count">{counts[id]}</span>}
          </button>
        ))}
      </div>
      {hidden && view !== 'calendar' && <div className="panel-empty">Show the note to see its {view === 'outline' ? 'outline' : 'links'}.</div>}
      {!hidden && view === 'backlinks' && <Backlinks />}
      {!hidden && view === 'outline' && <Outline />}
      {view === 'calendar' && <MiniCalendar />}
    </div>
  )
}
