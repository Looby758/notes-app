import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { ExternalLink, LogIn, RefreshCw, Search, Settings } from 'lucide-react'
import { columnName, readSpreadsheet, type Sheet } from '../../lib/sheets'
import { SETTINGS_TAB, openSpecialTab } from '../../lib/editorController'
import { notify } from '../../store/notify'
import { IS_MAC } from '@shared/platform'
import { ENABLE_SHEETS_API_URL } from '@shared/sheet'
import type { GoogleSheetResult } from '@shared/types'

/** Rows drawn at once; more come in on request, so a huge sheet still opens quickly. */
const PAGE = 1000
const ROW_NUMBER_WIDTH = 48
const DEFAULT_WIDTH = 110

type Loaded = { sheets: Sheet[]; webUrl?: string } | (Extract<GoogleSheetResult, { error: string }> & { sheets?: undefined }) | null

/** Excel and CSV files are read from the notes folder; a .gsheet is only a link, so the sheet comes from Google. */
async function load(path: string, url: string, name: string): Promise<NonNullable<Loaded>> {
  if (/\.gsheet$/i.test(name)) return window.api.readGoogleSheet(path)
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error('This file can’t be read.')
  return { sheets: await readSpreadsheet(name, await r.arrayBuffer()) }
}

/** A spreadsheet laid out like Excel, read-only: one tab per sheet, a sticky header, and a filter. */
export default function SheetView({ path, url, name }: { path: string; url: string; name: string }) {
  const [loaded, setLoaded] = useState<Loaded>(null)
  const [reload, setReload] = useState(0)
  const [active, setActive] = useState(0)
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [picked, setPicked] = useState<{ row: number; col: number } | null>(null)

  useEffect(() => {
    let live = true
    load(path, url, name)
      .then((result) => live && setLoaded(result))
      .catch((err: unknown) => live && setLoaded({ error: `${err instanceof Error ? err.message : String(err)} Open it in its usual app instead.` }))
    return () => {
      live = false
    }
  }, [path, url, name, reload])

  // Show the new version when the file changes on disk (saved from Excel, or synced from another computer).
  useEffect(() => window.api.onVaultChanged((paths) => paths.includes(path) && setReload((n) => n + 1)), [path])

  const sheets = loaded?.sheets ?? []
  const isGoogle = /\.gsheet$/i.test(name)
  const sheet = sheets[Math.min(active, sheets.length - 1)] as Sheet | undefined

  const rowIndexes = useMemo(() => {
    if (!sheet) return []
    const all = sheet.rows.map((_, i) => i)
    const q = query.trim().toLowerCase()
    if (!q) return all
    // The first row is usually the headings, so it stays put while filtering.
    return all.filter((i) => i === 0 || sheet.rows[i].some((c) => c.text.toLowerCase().includes(q)))
  }, [sheet, query])

  if (!loaded) return <p className="file-viewer-failed">Opening…</p>
  if (!loaded.sheets) return <SheetProblem problem={loaded} retry={() => setReload((n) => n + 1)} />
  if (!sheet) return null

  const pickedCell = picked ? sheet.rows[picked.row]?.[picked.col] : undefined
  const copy = (): void => {
    if (pickedCell) navigator.clipboard.writeText(pickedCell.text).catch(notify)
  }
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!picked) return
    // Copy the picked cell, unless some text in the sheet is selected (then copy that, as usual).
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && !window.getSelection()?.toString()) {
      e.preventDefault()
      copy()
      return
    }
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    const move = moves[e.key]
    if (!move) return
    e.preventDefault()
    const at = rowIndexes.indexOf(picked.row)
    const row = rowIndexes[Math.max(0, Math.min(rowIndexes.length - 1, at + move[0]))] ?? picked.row
    const col = Math.max(0, Math.min(sheet.cols - 1, picked.col + move[1]))
    setPicked({ row, col })
    e.currentTarget.querySelector(`[data-cell="${row}:${col}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  const pickSheet = (i: number): void => {
    setActive(i)
    setPicked(null)
    setShown(PAGE)
  }

  const cols = Array.from({ length: Math.max(sheet.cols, 1) }, (_, i) => i)
  // Excel measures columns in characters; about 7.5px each, with room for padding.
  const widths = cols.map((c) => {
    const w = sheet.widths?.[c]
    return w ? Math.round(Math.min(w, 80) * 7.5 + 10) : DEFAULT_WIDTH
  })
  const visible = rowIndexes.slice(0, shown)

  return (
    <div className="sheet-view">
      <div className="sheet-bar">
        <span className="sheet-ref">{picked ? `${columnName(picked.col)}${picked.row + 1}` : ''}</span>
        <span className="sheet-value" title={pickedCell?.text}>
          {pickedCell?.text ?? <span className="sheet-hint">Click a cell to see all of it. {IS_MAC ? '⌘' : 'Ctrl+'}C copies it.</span>}
        </span>
        {isGoogle && (
          <button className="btn sheet-refresh" title="Get the latest version from Google" onClick={() => setReload((n) => n + 1)}>
            <RefreshCw size={13} /> Refresh
          </button>
        )}
        {loaded.webUrl && (
          <button className="btn sheet-refresh" onClick={() => window.open(loaded.webUrl)}>
            <ExternalLink size={13} /> Open in Google Sheets
          </button>
        )}
        <label className="sheet-filter">
          <Search size={13} />
          <input
            value={query}
            placeholder="Filter rows"
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value)
              setShown(PAGE)
            }}
          />
        </label>
      </div>
      <div className="sheet-scroll" tabIndex={0} onKeyDown={onKeyDown}>
        {sheet.rows.length === 0 ? (
          <p className="file-viewer-failed">This sheet is empty.</p>
        ) : (
          <table className="sheet-grid" style={{ width: widths.reduce((a, b) => a + b, ROW_NUMBER_WIDTH) }}>
            <colgroup>
              <col style={{ width: ROW_NUMBER_WIDTH }} />
              {widths.map((w, c) => (
                <col key={c} style={{ width: w }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="sheet-corner" />
                {cols.map((c) => (
                  <th key={c} className={picked?.col === c ? 'picked' : ''}>
                    {columnName(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r}>
                  <th className={picked?.row === r ? 'picked' : ''}>{r + 1}</th>
                  {cols.map((c) => {
                    const cell = sheet.rows[r][c]
                    const isPicked = picked?.row === r && picked.col === c
                    return (
                      <td
                        key={c}
                        data-cell={`${r}:${c}`}
                        className={`${cell?.num ? 'num' : ''}${isPicked ? ' picked' : ''}`}
                        onClick={() => setPicked({ row: r, col: c })}
                      >
                        {cell?.text}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rowIndexes.length > shown && (
          <button className="btn sheet-more" onClick={() => setShown(shown + PAGE)}>
            Show {Math.min(PAGE, rowIndexes.length - shown).toLocaleString()} more rows ({(rowIndexes.length - shown).toLocaleString()} left)
          </button>
        )}
        {query.trim() && rowIndexes.length <= 1 && <p className="sheet-none">No rows match “{query.trim()}”.</p>}
      </div>
      {sheets.length > 1 && (
        <div className="sheet-tabs">
          {sheets.map((s, i) => (
            <button key={i} className={`sheet-tab${s === sheet ? ' active' : ''}${s.hidden ? ' hidden-sheet' : ''}`} onClick={() => pickSheet(i)} title={s.hidden ? 'Hidden in Excel' : undefined}>
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Why a sheet can't be shown, with the button that fixes it where there is one. */
function SheetProblem({ problem, retry }: { problem: Extract<GoogleSheetResult, { error: string }>; retry: () => void }) {
  const [connecting, setConnecting] = useState(false)
  const connect = (): void => {
    setConnecting(true)
    window.api
      .googleConnect()
      .then(retry)
      .catch(notify)
      .finally(() => setConnecting(false))
  }
  return (
    <div className="sheet-problem">
      <p className="file-viewer-failed">{problem.error}</p>
      <div className="sheet-problem-actions">
        {problem.fix === 'setup' && (
          <button className="btn btn-primary" onClick={() => openSpecialTab(SETTINGS_TAB)}>
            <Settings size={13} /> Open Settings
          </button>
        )}
        {problem.fix === 'connect' && (
          <button className="btn btn-primary" disabled={connecting} onClick={connect}>
            <LogIn size={13} /> {connecting ? 'Waiting for you in your browser…' : 'Connect Google'}
          </button>
        )}
        {problem.fix === 'enable-api' && (
          <button className="btn btn-primary" onClick={() => window.open(ENABLE_SHEETS_API_URL)}>
            <ExternalLink size={13} /> Switch on the Sheets API
          </button>
        )}
        {(problem.fix === 'enable-api' || problem.fix === 'retry') && (
          <button className="btn" onClick={retry}>
            <RefreshCw size={13} /> Try again
          </button>
        )}
        {problem.webUrl && (
          <button className="btn" onClick={() => window.open(problem.webUrl)}>
            <ExternalLink size={13} /> Open in Google Sheets
          </button>
        )}
      </div>
    </div>
  )
}
