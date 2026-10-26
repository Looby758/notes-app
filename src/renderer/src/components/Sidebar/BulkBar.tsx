import { FileDown, FolderInput, Hash, ListPlus, Star, Trash2, X } from 'lucide-react'
import { clearSelection, useSelection } from '../../store/selection'
import { openExport, useUI } from '../../store/ui'
import { starMany, trashMany } from '../../lib/bulk'
import { showKeys } from '@shared/platform'

/** What to do with several selected notes at once (shown while more than one is selected). */
export default function BulkBar() {
  const paths = useSelection((s) => s.paths)
  if (paths.length === 0) return null
  const open = (bulkAction: 'move' | 'tag' | 'property'): void => useUI.setState({ modal: 'bulk', bulkAction })
  return (
    <div className="bulk-bar" data-bulk-bar>
      <div className="bulk-count">
        {paths.length} selected
        <button className="icon-btn" title="Clear the selection (Esc)" onClick={clearSelection}>
          <X size={13} />
        </button>
      </div>
      <div className="bulk-actions">
        <button className="icon-btn" title="Move to a folder…" onClick={() => open('move')} data-bulk="move">
          <FolderInput size={15} />
        </button>
        <button className="icon-btn" title="Star / unstar" onClick={() => starMany(paths)} data-bulk="star">
          <Star size={15} />
        </button>
        <button className="icon-btn" title="Add or remove a tag…" onClick={() => open('tag')} data-bulk="tag">
          <Hash size={15} />
        </button>
        <button className="icon-btn" title="Set a property…" onClick={() => open('property')} data-bulk="property">
          <ListPlus size={15} />
        </button>
        <button className="icon-btn" title="Export…" onClick={() => openExport('', true, paths)} data-bulk="export">
          <FileDown size={15} />
        </button>
        <button className="icon-btn danger" title="Delete…" onClick={() => trashMany(paths)} data-bulk="delete">
          <Trash2 size={15} />
        </button>
      </div>
      <div className="bulk-hint">{showKeys('Ctrl')}-click or Shift-click to pick notes</div>
    </div>
  )
}
