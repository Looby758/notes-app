import { useEffect, useMemo, useRef, useState } from 'react'
import { Crosshair, Maximize, Orbit, Sparkles } from 'lucide-react'
import { useNoteIndex } from '../../store/noteIndex'
import { useEditor } from '../../store/editor'
import { useUI } from '../../store/ui'
import { setPrefs, usePrefs } from '../../store/prefs'
import { buildGraph } from '../../lib/graph'
import { openNote } from '../../lib/editorController'
import { GraphCanvas } from './graphCanvas'
import EmptyArt from '../Motion/EmptyArt'

/**
 * The graph tab. Two ways to look at how your notes connect:
 * - Neighbourhood: one note in the middle with the notes it links with around it; click one to
 *   move to it, click the middle one to open it.
 * - Constellation: every note as a glowing dot, pulled together by its links; click to open.
 */
export default function GraphPage() {
  const style = usePrefs((s) => s.prefs.graphStyle)
  const depth = useUI((s) => s.graphDepth)
  const orphans = useUI((s) => s.graphOrphans)
  const version = useNoteIndex((s) => s.version)
  const recent = useEditor((s) => s.recent)
  const graph = useMemo(() => {
    const { notes, lookup } = useNoteIndex.getState()
    return buildGraph(notes, lookup)
  }, [version])
  const [centre, setCentre] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [legend, setLegend] = useState<[string, string][]>([])
  const canvas = useRef<HTMLCanvasElement>(null)
  const engine = useRef<GraphCanvas | null>(null)
  /** The note in the middle, as the click handler (set up once) sees it. */
  const engineCentre = useRef<string | null>(null)

  // Start from the note you were last in (or the best-linked one).
  const fallbackCentre = useMemo(() => {
    const last = recent.find((p) => graph.byId.has(p))
    if (last) return last
    return [...graph.nodes].sort((a, b) => b.degree - a.degree)[0]?.id ?? null
  }, [graph, recent])
  const current = centre && graph.byId.has(centre) ? centre : fallbackCentre

  useEffect(() => {
    const e = new GraphCanvas(canvas.current!, {
      onClick: (id, { ctrl }) => {
        const s = usePrefs.getState().prefs.graphStyle
        if (s === 'neighbourhood' && id !== engineCentre.current && !ctrl) setCentre(id)
        else openNote(id, { newTab: ctrl })
      }
    })
    engine.current = e
    return () => e.dispose()
  }, [])

  useEffect(() => {
    engineCentre.current = current
    engine.current?.set({ graph, style, centre: current, depth, orphans, query })
    setLegend(engine.current?.groupColours() ?? [])
  }, [graph, style, current, depth, orphans, query])

  const titles = useMemo(() => graph.nodes.map((n) => n.title), [graph])
  const findNote = (text: string): string | null => {
    const q = text.trim().toLowerCase()
    if (!q) return null
    return (
      graph.nodes.find((n) => n.title.toLowerCase() === q)?.id ??
      graph.nodes.find((n) => n.title.toLowerCase().startsWith(q))?.id ??
      graph.nodes.find((n) => n.title.toLowerCase().includes(q))?.id ??
      null
    )
  }
  const linkCount = graph.edges.length

  return (
    <div className="graph-page" data-graph-style={style}>
      <div className="cal-toolbar graph-toolbar">
        <div className="segmented" role="radiogroup" aria-label="Graph style">
          <button className={style === 'neighbourhood' ? 'selected' : ''} onClick={() => setPrefs({ graphStyle: 'neighbourhood' })} title="One note and what it links with">
            <Orbit size={14} /> Neighbourhood
          </button>
          <button className={style === 'constellation' ? 'selected' : ''} onClick={() => setPrefs({ graphStyle: 'constellation' })} title="Every note at once">
            <Sparkles size={14} /> Constellation
          </button>
        </div>

        <input
          className="graph-search"
          value={query}
          list="graph-notes"
          placeholder={style === 'neighbourhood' ? 'Go to a note…' : 'Find a note…'}
          spellCheck={false}
          onChange={(e) => {
            const v = e.target.value
            setQuery(v)
            // Picking from the list goes straight there.
            if (style === 'neighbourhood' && titles.includes(v)) {
              const id = findNote(v)
              if (id) {
                setCentre(id)
                setQuery('')
              }
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('')
            if (e.key !== 'Enter') return
            const id = findNote(query)
            if (!id) return
            if (style === 'neighbourhood') {
              setCentre(id)
              setQuery('')
            } else engine.current?.focus(id)
          }}
          aria-label="Find a note"
        />
        <datalist id="graph-notes">
          {titles.slice(0, 500).map((t, i) => (
            <option key={`${t}-${i}`} value={t} />
          ))}
        </datalist>

        {style === 'neighbourhood' ? (
          <>
            <div className="segmented small" role="radiogroup" aria-label="How far out">
              <button className={depth === 1 ? 'selected' : ''} onClick={() => useUI.setState({ graphDepth: 1 })}>
                1 step
              </button>
              <button className={depth === 2 ? 'selected' : ''} onClick={() => useUI.setState({ graphDepth: 2 })}>
                2 steps
              </button>
            </div>
            {recent[0] && recent[0] !== current && graph.byId.has(recent[0]) && (
              <button className="btn" onClick={() => setCentre(recent[0])} title="Centre on the note you were last in">
                <Crosshair size={13} /> Current note
              </button>
            )}
          </>
        ) : (
          <label className="graph-check">
            <input type="checkbox" checked={orphans} onChange={(e) => useUI.setState({ graphOrphans: e.target.checked })} />
            Notes without links
          </label>
        )}
        <span className="graph-spacer" />
        <span className="graph-count">
          {graph.nodes.length} {graph.nodes.length === 1 ? 'note' : 'notes'} · {linkCount} {linkCount === 1 ? 'link' : 'links'}
        </span>
      </div>

      <div className="graph-stage">
        <canvas ref={canvas} aria-label="Graph of how your notes link" />
        <button className="icon-btn graph-fit" title="Show everything (or double-click the background)" onClick={() => engine.current?.fit()}>
          <Maximize size={14} />
        </button>
        {graph.nodes.length === 0 && (
          <div className="graph-empty">
            <EmptyArt kind="graph" size={64} />
            No notes yet. Notes and the links between them show up here.
          </div>
        )}
        {legend.length > 0 && (
          <div className="graph-legend">
            <span>
              <i className="graph-legend-root" /> Not in a folder
            </span>
            {legend.slice(0, 10).map(([group, colour]) => (
              <span key={group}>
                <i style={{ background: colour }} /> {group}
              </span>
            ))}
          </div>
        )}
        <div className="graph-hint">
          {style === 'neighbourhood' ? 'Click a note to move to it · scroll to zoom · drag to look around' : 'Click a note to open it · drag notes or the background · scroll to zoom'}
        </div>
      </div>
    </div>
  )
}
