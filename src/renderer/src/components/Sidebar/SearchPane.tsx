import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FileText, Search, X } from 'lucide-react'
import { useUI } from '../../store/ui'
import { searchNotes, useNoteIndex, type SearchHit } from '../../store/noteIndex'
import { openNote } from '../../lib/editorController'
import { noteTitle, parentOf } from '../../lib/paths'
import { clearSelection, selectRange, setSelection, toggleSelected, useSelection } from '../../store/selection'

function Snippet({ hit }: { hit: SearchHit }) {
  const parts: ReactNode[] = []
  let last = 0
  hit.highlights.forEach(([from, to], i) => {
    parts.push(hit.snippet.slice(last, from), <mark key={i}>{hit.snippet.slice(from, to)}</mark>)
    last = to
  })
  parts.push(hit.snippet.slice(last))
  return <>{parts}</>
}

export default function SearchPane() {
  const query = useUI((s) => s.searchQuery)
  const focusRequest = useUI((s) => s.searchFocus)
  const version = useNoteIndex((s) => s.version)
  const input = useRef<HTMLInputElement>(null)
  const [hits, setHits] = useState<SearchHit[]>([])
  const picked = useSelection((s) => s.paths)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [focusRequest])

  // Debounced so typing stays smooth in big vaults; re-runs when notes change.
  useEffect(() => {
    const t = setTimeout(() => setHits(searchNotes(query)), 120)
    return () => clearTimeout(t)
  }, [query, version])

  const setQuery = (q: string): void => useUI.setState({ searchQuery: q })

  return (
    <div className="search-pane">
      <div className="search-box">
        <Search size={14} />
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('')
            if (e.key === 'Enter' && hits[0]) openNote(hits[0].path, { line: hits[0].line, match: hits[0].match })
          }}
          placeholder="Search notes…  (#tag to filter)"
          spellCheck={false}
        />
        {query && (
          <button className="icon-btn" title="Clear" onClick={() => setQuery('')}>
            <X size={13} />
          </button>
        )}
      </div>
      <div className="search-results">
        {query.trim() && (
          <div className="search-count">
            {hits.length === 0 ? 'No matches' : `${hits.length}${hits.length >= 100 ? '+' : ''} ${hits.length === 1 ? 'note' : 'notes'}`}
            {hits.length > 1 && (
              <button className="search-select-all" onClick={() => setSelection(hits.map((h) => h.path))} title="Select every result, for bulk actions">
                Select all
              </button>
            )}
          </div>
        )}
        {!query.trim() && (
          <div className="panel-empty">
            Search the text of every note. Use <code>#tag</code> to filter by tag, e.g. <code>#work meeting</code>.
          </div>
        )}
        {hits.map((hit) => (
          <button
            key={hit.path}
            className={`search-hit ${picked.includes(hit.path) ? 'multi' : ''}`}
            onClick={(e) => {
              // Ctrl/⌘-click and Shift-click pick results for bulk actions; a plain click opens.
              if (e.ctrlKey || e.metaKey) return toggleSelected(hit.path)
              if (e.shiftKey)
                return selectRange(
                  hit.path,
                  hits.map((h) => h.path)
                )
              clearSelection()
              openNote(hit.path, { line: hit.line, match: hit.match || undefined })
            }}
            title={hit.path}
          >
            <span className="search-hit-title">
              <FileText size={13} />
              {noteTitle(hit.path)}
              {parentOf(hit.path) && <span className="search-hit-folder">{parentOf(hit.path)}</span>}
            </span>
            {hit.snippet && (
              <span className="search-hit-snippet">
                <Snippet hit={hit} />
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
