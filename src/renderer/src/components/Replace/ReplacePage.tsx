import { useEffect, useMemo, useRef, useState } from 'react'
import { CaseSensitive, ChevronRight, FileText, Regex, Replace, Undo2, WholeWord } from 'lucide-react'
import type { FileNode } from '@shared/types'
import { useNoteIndex, getNoteText } from '../../store/noteIndex'
import { useVault } from '../../store/vault'
import { notify } from '../../store/notify'
import { getOpenText, openNote } from '../../lib/editorController'
import { isLocked } from '../../lib/lock/session'
import { editNote } from '../../lib/daily'
import { isWithin, noteTitle, parentOf } from '../../lib/paths'
import { applyMatches, buildPattern, findMatches, type FindOptions, type Match } from '../../lib/replace'

/**
 * Find and replace in every note (or one folder). Shows each match first; untick the ones to
 * leave alone, then replace. The last replace can be undone, even after restarting.
 */

interface NoteMatches {
  path: string
  text: string
  matches: Match[]
}

interface UndoEntry {
  path: string
  before: string
  after: string
}

const UNDO_FILE = 'replace-undo.json'
const MAX_NOTES = 300

function folderPaths(nodes: FileNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.type === 'folder') {
      out.push(n.path)
      folderPaths(n.children ?? [], out)
    }
  }
  return out
}

const key = (path: string, m: Match): string => `${path}:${m.from}`

export default function ReplacePage() {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [opts, setOpts] = useState<FindOptions>({ matchCase: false, wholeWord: false, regex: false })
  const [folder, setFolder] = useState('')
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [undo, setUndo] = useState<UndoEntry[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [debounced, setDebounced] = useState({ query, replacement })
  const version = useNoteIndex((s) => s.version)
  const tree = useVault((s) => s.tree)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => input.current?.focus(), [])
  useEffect(() => {
    const t = setTimeout(() => setDebounced({ query, replacement }), 150)
    return () => clearTimeout(t)
  }, [query, replacement])
  // The last replace (kept in the notes folder, so Undo survives a restart).
  useEffect(() => {
    window.api.readAppData(UNDO_FILE).then((raw) => {
      try {
        const saved = raw ? (JSON.parse(raw) as UndoEntry[]) : null
        setUndo(saved?.length ? saved : null)
      } catch {
        setUndo(null)
      }
    })
  }, [])

  const pattern = useMemo(() => buildPattern(debounced.query, opts), [debounced.query, opts])
  const results = useMemo((): NoteMatches[] => {
    if (typeof pattern === 'string') return []
    const { lookup } = useNoteIndex.getState()
    const out: NoteMatches[] = []
    for (const path of lookup.paths) {
      if ((folder && !isWithin(path, folder)) || isLocked(path)) continue
      const text = getOpenText(path) ?? getNoteText(path)
      if (!text) continue
      const matches = findMatches(text, pattern, debounced.replacement, opts)
      if (matches.length) out.push({ path, text, matches })
      if (out.length >= MAX_NOTES) break
    }
    return out.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }))
  }, [pattern, debounced.replacement, opts, folder, version])

  // A new search starts with everything ticked.
  useEffect(() => setSkipped(new Set()), [debounced.query, opts, folder])

  const total = results.reduce((n, r) => n + r.matches.length, 0)
  const chosen = results.reduce((n, r) => n + r.matches.filter((m) => !skipped.has(key(r.path, m))).length, 0)
  const toggle = (k: string): void => setSkipped((s) => (s.has(k) ? (s.delete(k), new Set(s)) : new Set(s.add(k))))
  const toggleNote = (r: NoteMatches): void => {
    const keys = r.matches.map((m) => key(r.path, m))
    const allOn = keys.every((k) => !skipped.has(k))
    setSkipped((s) => {
      const next = new Set(s)
      for (const k of keys) {
        if (allOn) next.add(k)
        else next.delete(k)
      }
      return next
    })
  }

  const replaceAll = async (): Promise<void> => {
    if (!chosen) return
    const notes = results.filter((r) => r.matches.some((m) => !skipped.has(key(r.path, m))))
    const ok = await window.api.confirm({
      message: `Replace ${chosen} ${chosen === 1 ? 'match' : 'matches'} in ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}?`,
      detail: 'You can undo this afterwards.',
      ok: 'Replace'
    })
    if (!ok) return
    setBusy(true)
    const done: UndoEntry[] = []
    try {
      for (const r of notes) {
        const picked = r.matches.filter((m) => !skipped.has(key(r.path, m)))
        let before = ''
        let after = ''
        await editNote(r.path, (current) => {
          // The note changed since the search: find the matches again in what's there now.
          const matches = current === r.text ? picked : findMatches(current, pattern as RegExp, debounced.replacement, opts).filter((m) => picked.some((p) => p.line === m.line))
          before = current
          after = applyMatches(current, matches)
          return after
        })
        if (after && after !== before) done.push({ path: r.path, before, after })
      }
      if (done.length) {
        setUndo(done)
        await window.api.writeAppData(UNDO_FILE, JSON.stringify(done))
      }
      await useVault.getState().refresh(done.map((d) => d.path))
      notify(`Replaced in ${done.length} ${done.length === 1 ? 'note' : 'notes'}.`, 'info')
    } catch (err) {
      notify(err)
    } finally {
      setBusy(false)
    }
  }

  const undoLast = async (): Promise<void> => {
    if (!undo) return
    setBusy(true)
    let restored = 0
    let changedSince = 0
    try {
      for (const u of undo) {
        await editNote(u.path, (current) => {
          // Only put a note back if nobody has changed it since.
          if (current !== u.after) {
            changedSince++
            return null
          }
          restored++
          return u.before
        }).catch(() => changedSince++)
      }
      setUndo(null)
      await window.api.writeAppData(UNDO_FILE, '[]')
      await useVault.getState().refresh(undo.map((u) => u.path))
      notify(
        changedSince ? `Undid ${restored}; ${changedSince} ${changedSince === 1 ? 'note was' : 'notes were'} edited since and left as they are.` : `Undid the replace in ${restored} ${restored === 1 ? 'note' : 'notes'}.`,
        'info'
      )
    } finally {
      setBusy(false)
    }
  }

  const folders = useMemo(() => folderPaths(tree), [tree])
  const error = debounced.query && typeof pattern === 'string' ? pattern : null

  return (
    <div className="replace-page" data-replace-page>
      <div className="replace-form">
        <div className="replace-row">
          <input ref={input} className="replace-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find" spellCheck={false} aria-label="Find" />
          <div className="replace-opts">
            <button className={`icon-btn ${opts.matchCase ? 'active' : ''}`} title="Match case" aria-pressed={opts.matchCase} onClick={() => setOpts({ ...opts, matchCase: !opts.matchCase })}>
              <CaseSensitive size={16} />
            </button>
            <button className={`icon-btn ${opts.wholeWord ? 'active' : ''}`} title="Whole words only" aria-pressed={opts.wholeWord} onClick={() => setOpts({ ...opts, wholeWord: !opts.wholeWord })}>
              <WholeWord size={16} />
            </button>
            <button className={`icon-btn ${opts.regex ? 'active' : ''}`} title="Regular expression ($1, $2… in the replacement)" aria-pressed={opts.regex} onClick={() => setOpts({ ...opts, regex: !opts.regex })}>
              <Regex size={16} />
            </button>
          </div>
        </div>
        <div className="replace-row">
          <input className="replace-input" value={replacement} onChange={(e) => setReplacement(e.target.value)} placeholder="Replace with" spellCheck={false} aria-label="Replace with" />
          <select className="select replace-folder" value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="Where">
            <option value="">All notes</option>
            {folders.map((f) => (
              <option key={f} value={f}>
                In {f}
              </option>
            ))}
          </select>
        </div>
        <div className="replace-actions">
          <span className="replace-count">
            {error ?? (debounced.query && total === 0 ? 'No matches.' : debounced.query ? `${total}${results.length >= MAX_NOTES ? '+' : ''} ${total === 1 ? 'match' : 'matches'} in ${results.length} ${results.length === 1 ? 'note' : 'notes'}` : 'Find text in every note, then replace it.')}
          </span>
          {undo && (
            <button className="btn" onClick={undoLast} disabled={busy} title={`Put back the ${undo.length} ${undo.length === 1 ? 'note' : 'notes'} changed by the last replace`}>
              <Undo2 size={14} /> Undo last replace
            </button>
          )}
          <button className="btn btn-primary" onClick={replaceAll} disabled={busy || !chosen} data-replace-go>
            <Replace size={14} /> Replace {chosen || ''}
          </button>
        </div>
      </div>

      <div className="replace-results">
        {results.map((r) => {
          const keys = r.matches.map((m) => key(r.path, m))
          const on = keys.filter((k) => !skipped.has(k)).length
          const open = !collapsed.has(r.path)
          return (
            <div key={r.path} className="replace-note" data-replace-note={r.path}>
              <div className="replace-note-head">
                <button className="icon-btn" onClick={() => setCollapsed((s) => (s.has(r.path) ? (s.delete(r.path), new Set(s)) : new Set(s.add(r.path))))}>
                  <ChevronRight size={13} className={`tree-chevron ${open ? 'open' : ''}`} />
                </button>
                <input type="checkbox" checked={on === keys.length} ref={(el) => {
                    if (el) el.indeterminate = on > 0 && on < keys.length
                  }} onChange={() => toggleNote(r)} aria-label={`All matches in ${noteTitle(r.path)}`} />
                <button className="replace-note-title" onClick={() => openNote(r.path)} title={r.path}>
                  <FileText size={13} /> {noteTitle(r.path)}
                  {parentOf(r.path) && <span className="search-hit-folder">{parentOf(r.path)}</span>}
                </button>
                <span className="panel-count">{r.matches.length}</span>
              </div>
              {open &&
                r.matches.map((m) => {
                  const k = key(r.path, m)
                  const start = Math.max(0, m.snipFrom - 50)
                  return (
                    <label key={k} className={`replace-match ${skipped.has(k) ? 'off' : ''}`}>
                      <input type="checkbox" checked={!skipped.has(k)} onChange={() => toggle(k)} />
                      <span className="replace-snippet" onDoubleClick={() => openNote(r.path, { line: m.line })}>
                        {start > 0 && '…'}
                        {m.snippet.slice(start, m.snipFrom)}
                        <del>{m.snippet.slice(m.snipFrom, m.snipTo)}</del>
                        <ins>{m.replacement}</ins>
                        {m.snippet.slice(m.snipTo, m.snipTo + 60)}
                      </span>
                    </label>
                  )
                })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
