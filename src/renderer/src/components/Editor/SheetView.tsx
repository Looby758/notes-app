import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { ExternalLink, LogIn, Plus, RefreshCw, Search, Settings } from 'lucide-react'
import { cellInput, columnName, formatNumber, readSpreadsheet, writeDelimited, writeWorkbook, type Cell, type Sheet } from '../../lib/sheets'
import { Calculator, FUNCTION_NAMES, formatValue, isError, numberFrom, type Value } from '../../lib/formulas'
import { SETTINGS_TAB, openSpecialTab } from '../../lib/editorController'
import { setPendingSave } from '../../lib/boards'
import { notify } from '../../store/notify'
import { IS_MAC } from '@shared/platform'
import { ENABLE_SHEETS_API_URL, finishSheet } from '@shared/sheet'
import type { GoogleSheetResult } from '@shared/types'

/** Rows drawn at once; more come in on request, so a huge sheet still opens quickly. */
const PAGE = 1000
const ROW_NUMBER_WIDTH = 48
const DEFAULT_WIDTH = 110
/** Empty rows and columns past the data, to type into. */
const SPARE_ROWS = 30
const SPARE_COLS = 6
const SAVE_DELAY = 800

type Loaded = { sheets: Sheet[]; webUrl?: string } | (Extract<GoogleSheetResult, { error: string }> & { sheets?: undefined }) | null
type Pos = { row: number; col: number }
/** One undoable change: the cells it touched, as they were before. */
type Change = { sheet: number; cells: { row: number; col: number; before: Cell | undefined }[] }

/** Workbooks whose owner has agreed, this session, that saving drops colours and fonts. */
const agreedToRewrite = new Set<string>()

/** Excel and CSV files are read from the notes folder; a .gsheet is only a link, so the sheet comes from Google. */
async function load(path: string, url: string, name: string): Promise<NonNullable<Loaded>> {
  if (/\.gsheet$/i.test(name)) return window.api.readGoogleSheet(path)
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error('This file can’t be read.')
  return { sheets: await readSpreadsheet(name, await r.arrayBuffer()) }
}

/** The cell a typed entry makes: a formula when it starts with "=", otherwise text (numbers line up right). */
function typedCell(input: string, before: Cell | undefined): Cell | undefined {
  if (!input) return undefined
  if (input.startsWith('=') && input.length > 1) return { text: '', formula: input.slice(1), format: before?.format, num: true }
  return { text: input, num: numberFrom(input) !== null }
}

/** What a cell holds for formulas to use: the stored number, or its text read as a number where it is one. */
function plainValue(cell: Cell | undefined): Value {
  if (!cell?.text) return ''
  if (cell.value !== undefined) return cell.value
  const n = numberFrom(cell.text)
  if (n !== null) return n
  if (/^(true|false)$/i.test(cell.text)) return /^t/i.test(cell.text)
  return cell.text
}

/**
 * A spreadsheet laid out like Excel, with one tab per sheet, a sticky header and a filter. Local files can be
 * edited: type into a cell (start with "=" for a formula, like =SUM(A1:A5)), and the changes save themselves.
 */
export default function SheetView({ path, url, name }: { path: string; url: string; name: string }) {
  const [loaded, setLoaded] = useState<Loaded>(null)
  const [reload, setReload] = useState(0)
  const [active, setActive] = useState(0)
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [picked, setPicked] = useState<Pos | null>(null)
  const [sheets, setSheets] = useState<Sheet[]>([])
  /** What's being typed into the picked cell, and whether it's being typed in the bar above rather than the cell. */
  const [editing, setEditing] = useState<string | null>(null)
  const [inBar, setInBar] = useState(false)
  const undo = useRef<Change[]>([])
  const scroller = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const savedAt = useRef(0)
  const latest = useRef({ sheets, calc: null as Calculator | null })

  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  const isGoogle = ext === 'gsheet'
  const isWorkbook = ext === 'xlsx' || ext === 'xlsm'
  const editable = !isGoogle

  useEffect(() => {
    let live = true
    load(path, url, name)
      .then((result) => {
        if (!live) return
        setLoaded(result)
        if (result.sheets) setSheets(result.sheets)
        undo.current = []
      })
      .catch((err: unknown) => live && setLoaded({ error: `${err instanceof Error ? err.message : String(err)} Open it in its usual app instead.` }))
    return () => {
      live = false
    }
  }, [path, url, name, reload])

  // Show the new version when the file changes on disk (saved from Excel, or synced from another computer),
  // but not for our own saves, nor while there are edits still to save.
  useEffect(
    () =>
      window.api.onVaultChanged((paths) => {
        if (paths.includes(path) && !timer.current && Date.now() - savedAt.current > 2000) setReload((n) => n + 1)
      }),
    [path]
  )

  const calc = useMemo(
    () =>
      new Calculator(
        () => sheets.map((s) => s.name),
        (s, r, c) => cellInput(sheets[s]?.rows[r]?.[c]),
        (s, r, c) => plainValue(sheets[s]?.rows[r]?.[c]),
        (s) => ({ rows: sheets[s]?.rows.length ?? 0, cols: sheets[s]?.cols ?? 0 })
      ),
    [sheets]
  )
  latest.current = { sheets, calc }

  const save = async (): Promise<void> => {
    clearTimeout(timer.current)
    timer.current = undefined
    setPendingSave(path, null)
    const { sheets: now, calc: c } = latest.current
    const data = isWorkbook
      ? await writeWorkbook(now.map(finishSheet), (s, r, col) => c!.value(s, r, col))
      : new TextEncoder().encode('﻿' + writeDelimited(now[0], ext === 'tsv' ? '\t' : ','))
    savedAt.current = Date.now()
    await window.api.writeSheet(path, data)
    savedAt.current = Date.now()
  }
  const saveRef = useRef(save)
  saveRef.current = save
  // Write anything still unsaved when the tab closes.
  useEffect(() => () => void (timer.current && saveRef.current().catch(notify)), [path])

  const sheetIndex = Math.max(0, Math.min(active, sheets.length - 1))
  const sheet = sheets[sheetIndex] as Sheet | undefined

  const rowIndexes = useMemo(() => {
    if (!sheet) return []
    const all = sheet.rows.map((_, i) => i)
    const q = query.trim().toLowerCase()
    if (!q) return editable ? [...all, ...Array.from({ length: SPARE_ROWS }, (_, i) => sheet.rows.length + i)] : all
    // The first row is usually the headings, so it stays put while filtering.
    return all.filter((i) => i === 0 || sheet.rows[i].some((c) => c.text.toLowerCase().includes(q)))
  }, [sheet, query, editable])

  if (!loaded) return <p className="file-viewer-failed">Opening…</p>
  if (!loaded.sheets) return <SheetProblem problem={loaded} retry={() => setReload((n) => n + 1)} />
  if (!sheet) return null

  /** What a cell shows: a formula's answer (in the cell's number format), or its text. */
  const display = (r: number, c: number): { text: string; num: boolean } => {
    const cell = sheet.rows[r]?.[c]
    if (cell?.formula === undefined) return { text: cell?.text ?? '', num: !!cell?.num }
    const v = calc.value(sheetIndex, r, c)
    if (typeof v === 'number') return { text: isFinite(v) ? formatNumber(v, cell.format) : '#NUM!', num: true }
    return { text: formatValue(v), num: isError(v) || typeof v === 'boolean' }
  }

  const okToChange = (): boolean => {
    if (!isWorkbook || agreedToRewrite.has(path)) return true
    const ok = window.confirm(
      `Notes saves your changes as a plain workbook: values, formulas, number formats and sheets are kept, but colours, fonts, borders${ext === 'xlsm' ? ', macros' : ''} and charts are not. Edit “${name}” anyway?`
    )
    if (ok) agreedToRewrite.add(path)
    return ok
  }

  /** Puts typed entries into cells of the shown sheet (one undo step), and saves shortly after. */
  const change = (entries: { row: number; col: number; input: string }[], record = true): void => {
    if (!entries.length || !okToChange()) return
    const next = { ...sheet, rows: [...sheet.rows] }
    const step: Change = { sheet: sheetIndex, cells: [] }
    for (const { row, col, input } of entries) {
      while (next.rows.length <= row) next.rows.push([])
      const cells = (next.rows[row] = [...next.rows[row]])
      const before = cells[col]
      if (cellInput(before) === input) continue
      step.cells.push({ row, col, before })
      while (cells.length < col) cells.push({ text: '' })
      cells[col] = typedCell(input, before) ?? { text: '' }
      next.cols = Math.max(next.cols, col + 1)
    }
    if (!step.cells.length) return
    if (record) undo.current = [...undo.current.slice(-199), step]
    setSheets(sheets.map((s, i) => (i === sheetIndex ? next : s)))
    clearTimeout(timer.current)
    timer.current = setTimeout(() => saveRef.current().catch(notify), SAVE_DELAY)
    setPendingSave(path, () => saveRef.current())
  }

  const undoLast = (): void => {
    const step = undo.current.pop()
    if (!step) return
    setActive(step.sheet)
    const target = sheets[step.sheet]
    const rows = [...target.rows]
    for (const { row, col, before } of [...step.cells].reverse()) {
      rows[row] = [...rows[row]]
      rows[row][col] = before ?? { text: '' }
    }
    setSheets(sheets.map((s, i) => (i === step.sheet ? { ...target, rows } : s)))
    setPicked({ row: step.cells[0].row, col: step.cells[0].col })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => saveRef.current().catch(notify), SAVE_DELAY)
    setPendingSave(path, () => saveRef.current())
  }

  const colCount = Math.max(sheet.cols, 1) + (editable ? SPARE_COLS : 0)
  const pickedInput = picked ? cellInput(sheet.rows[picked.row]?.[picked.col]) : ''

  const moveTo = (row: number, col: number): void => {
    const at = rowIndexes.indexOf(picked?.row ?? 0)
    const r = rowIndexes[Math.max(0, Math.min(rowIndexes.length - 1, at + row))] ?? 0
    const c = Math.max(0, Math.min(colCount - 1, (picked?.col ?? 0) + col))
    setPicked({ row: r, col: c })
    scroller.current?.querySelector(`[data-cell="${r}:${c}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  const startEditing = (text: string): void => {
    if (!editable || !picked) return
    setInBar(false)
    setEditing(text)
  }
  /** Saves what's being typed into the picked cell, then moves (down for Enter, right for Tab). */
  const commit = (move?: [number, number]): void => {
    if (editing !== null && picked) change([{ ...picked, input: editing }])
    setEditing(null)
    if (move) moveTo(...move)
    scroller.current?.focus()
  }
  const onEditKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') commit([e.shiftKey ? -1 : 1, 0])
    else if (e.key === 'Tab') commit([0, e.shiftKey ? -1 : 1])
    else if (e.key === 'Escape') {
      setEditing(null)
      scroller.current?.focus()
    } else return
    e.preventDefault()
  }

  const copy = (): void => {
    if (picked) navigator.clipboard.writeText(display(picked.row, picked.col).text).catch(notify)
  }
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!picked || editing !== null) return
    const mod = e.metaKey || e.ctrlKey
    // Copy the picked cell, unless some text in the sheet is selected (then copy that, as usual).
    if (mod && e.key.toLowerCase() === 'c' && !window.getSelection()?.toString()) {
      e.preventDefault()
      copy()
      return
    }
    if (mod && e.key.toLowerCase() === 'z' && editable) {
      e.preventDefault()
      undoLast()
      return
    }
    if (editable && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault()
      change([{ ...picked, input: '' }])
      return
    }
    if (editable && (e.key === 'Enter' || e.key === 'F2')) {
      e.preventDefault()
      startEditing(pickedInput)
      return
    }
    // Typing over a cell replaces what's in it, as in Excel.
    if (editable && e.key.length === 1 && !mod && !e.altKey) {
      e.preventDefault()
      startEditing(e.key)
      return
    }
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Tab: [0, e.shiftKey ? -1 : 1] }
    const move = moves[e.key]
    if (!move) return
    e.preventDefault()
    moveTo(...move)
  }
  // Pasting rows copied from Excel (tab-separated) fills cells from the picked one.
  const onPaste = (e: ClipboardEvent): void => {
    if (!editable || !picked || editing !== null) return
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    e.preventDefault()
    const lines = text.replace(/\r?\n$/, '').split(/\r?\n/)
    change(lines.flatMap((line, r) => line.split('\t').map((input, c) => ({ row: picked.row + r, col: picked.col + c, input }))))
  }
  const onCellClick = (row: number, col: number): void => {
    // While typing a formula, clicking another cell puts its reference in, as in Excel.
    if (editing?.startsWith('=') && picked && (row !== picked.row || col !== picked.col)) {
      setEditing(editing + `${columnName(col)}${row + 1}`)
      return
    }
    if (editing !== null) commit()
    setPicked({ row, col })
  }

  const pickSheet = (i: number): void => {
    if (editing !== null) commit()
    setActive(i)
    setPicked(null)
    setShown(PAGE)
  }
  const addSheet = (): void => {
    if (!okToChange()) return
    let n = sheets.length + 1
    while (sheets.some((s) => s.name.toLowerCase() === `sheet${n}`)) n++
    setSheets([...sheets, { name: `Sheet${n}`, rows: [], cols: 0 }])
    setActive(sheets.length)
    setPicked({ row: 0, col: 0 })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => saveRef.current().catch(notify), SAVE_DELAY)
    setPendingSave(path, () => saveRef.current())
  }

  const cols = Array.from({ length: colCount }, (_, i) => i)
  // Excel measures columns in characters; about 7.5px each, with room for padding.
  const widths = cols.map((c) => {
    const w = sheet.widths?.[c]
    return w ? Math.round(Math.min(w, 80) * 7.5 + 10) : DEFAULT_WIDTH
  })
  const visible = rowIndexes.slice(0, shown)
  const hint = editable
    ? `Click a cell and type. Start with = for a formula, like =SUM(A1:A5). ${IS_MAC ? '⌘' : 'Ctrl+'}Z undoes.`
    : `Click a cell to see all of it. ${IS_MAC ? '⌘' : 'Ctrl+'}C copies it.`

  return (
    <div className="sheet-view">
      <div className="sheet-bar">
        <span className="sheet-ref">{picked ? `${columnName(picked.col)}${picked.row + 1}` : ''}</span>
        {editable && picked ? (
          <input
            className="sheet-value sheet-input"
            value={editing ?? pickedInput}
            spellCheck={false}
            title={`Functions: ${FUNCTION_NAMES.join(', ')}`}
            placeholder="Type a value, or = for a formula"
            onFocus={() => {
              setInBar(true)
              if (editing === null) setEditing(pickedInput)
            }}
            onChange={(e) => setEditing(e.target.value)}
            onKeyDown={onEditKey}
            onBlur={() => editing !== null && commit()}
          />
        ) : (
          <span className="sheet-value" title={pickedInput}>
            {picked ? pickedInput : <span className="sheet-hint">{hint}</span>}
          </span>
        )}
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
      <div className="sheet-scroll" tabIndex={0} ref={scroller} onKeyDown={onKeyDown} onPaste={onPaste}>
        {sheet.rows.length === 0 && !editable ? (
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
                    const isPicked = picked?.row === r && picked.col === c
                    if (isPicked && editing !== null && !inBar)
                      return (
                        <td key={c} data-cell={`${r}:${c}`} className="picked editing">
                          <input autoFocus value={editing} spellCheck={false} onChange={(e) => setEditing(e.target.value)} onKeyDown={onEditKey} onBlur={() => commit()} />
                        </td>
                      )
                    const shownCell = isPicked && editing !== null ? { text: editing, num: false } : display(r, c)
                    return (
                      <td
                        key={c}
                        data-cell={`${r}:${c}`}
                        className={`${shownCell.num ? 'num' : ''}${isPicked ? ' picked' : ''}`}
                        onMouseDown={(e) => editing?.startsWith('=') && e.preventDefault()}
                        onClick={() => onCellClick(r, c)}
                        onDoubleClick={() => editing === null && startEditing(cellInput(sheet.rows[r]?.[c]))}
                      >
                        {shownCell.text}
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
      {(sheets.length > 1 || (editable && isWorkbook)) && (
        <div className="sheet-tabs">
          {sheets.map((s, i) => (
            <button key={i} className={`sheet-tab${s === sheet ? ' active' : ''}${s.hidden ? ' hidden-sheet' : ''}`} onClick={() => pickSheet(i)} title={s.hidden ? 'Hidden in Excel' : undefined}>
              {s.name}
            </button>
          ))}
          {editable && isWorkbook && (
            <button className="sheet-tab" title="Add a sheet" onClick={addSheet}>
              <Plus size={13} />
            </button>
          )}
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
