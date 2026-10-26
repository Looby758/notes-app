import { useMemo, useState } from 'react'
import { ChevronRight, Hash, Search, X } from 'lucide-react'
import { removeSavedSearch, useSavedSearches } from '../../store/savedSearches'
import { searchNotes, useNoteIndex } from '../../store/noteIndex'
import { showSearch, useUI } from '../../store/ui'

/** Saved searches at the top of the Files view (and the Search view): one click runs one again. */
export default function SavedSearches({ compact = false }: { compact?: boolean }) {
  const queries = useSavedSearches((s) => s.queries)
  const version = useNoteIndex((s) => s.version)
  const current = useUI((s) => (s.sidebarView === 'search' ? s.searchQuery.trim().toLowerCase() : null))
  const [open, setOpen] = useState(true)
  // How many notes each finds right now (a hundred or more shows as 100+).
  const counts = useMemo(() => new Map(queries.map((q) => [q, searchNotes(q).length])), [queries, version])
  if (queries.length === 0) return null

  return (
    <div className={`saved-searches ${compact ? 'compact' : ''}`} data-saved-searches>
      <button className="starred-header" onClick={() => setOpen(!open)}>
        <ChevronRight size={13} className={`tree-chevron ${open ? 'open' : ''}`} />
        Saved searches
        <span className="panel-count">{queries.length}</span>
      </button>
      {open &&
        queries.map((q) => {
          const Icon = /^#\S+$/.test(q) ? Hash : Search
          return (
            <div
              key={q}
              className={`tree-row saved-search-row ${current === q.toLowerCase() ? 'selected' : ''}`}
              onClick={() => showSearch(q)}
              title={`Search for “${q}”`}
              data-saved-search={q}
            >
              <Icon size={13} className="tree-icon saved-search-icon" />
              <span className="tree-label">{/^#\S+$/.test(q) ? q.slice(1) : q}</span>
              <span className="saved-search-count">{(counts.get(q) ?? 0) >= 100 ? '100+' : counts.get(q)}</span>
              <button
                className="icon-btn saved-search-remove"
                title="Remove this saved search"
                onClick={(e) => {
                  e.stopPropagation()
                  removeSavedSearch(q)
                }}
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
    </div>
  )
}
