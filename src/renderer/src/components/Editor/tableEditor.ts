import { EditorView, WidgetType } from '@codemirror/view'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownAZ,
  ArrowUpAZ,
  Code2,
  Columns3,
  Rows3,
  Trash2,
  type LucideIcon
} from 'lucide-react'
import {
  addColumn,
  addRow,
  formatTable,
  parseTable,
  removeColumn,
  removeRow,
  setAlign,
  setCell,
  sortBy,
  tableTotals,
  type TableData
} from '../../lib/tables'

/**
 * Tables you edit in place: click a cell and type. Tab / Shift+Tab move between cells, Enter goes
 * down (adding a row at the bottom), Esc stops. A small toolbar adds and removes rows and columns,
 * aligns and sorts. Every change rewrites the table's markdown with its columns lined up.
 * A row labelled Total (or Average) fills its empty cells in with the column's total.
 */

const icon = (I: LucideIcon): string => renderToStaticMarkup(createElement(I, { size: 14 }))

/** The cell to focus once the table has been redrawn after a change (by the table's position). */
let refocus: { from: number; row: number; col: number } | null = null

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** A cell's markdown shown formatted (bold, italic, code, links), for when it isn't being edited. */
function renderCell(md: string): string {
  return esc(md.replace(/\\\|/g, '|'))
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '<strong>$1$2</strong>')
    .replace(/(^|[^*])\*([^*]+)\*(?!\*)|(^|[^_])_([^_]+)_(?!_)/g, '$1$3<em>$2$4</em>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/==([^=]+)==/g, '<mark class="cm-hl">$1</mark>')
    .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '<span class="cm-link">$2</span>')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '<span class="cm-link">$1</span>')
}

export class TableWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly from: number,
    readonly readOnly = false
  ) {
    super()
  }
  eq(other: TableWidget): boolean {
    return other.text === this.text && other.from === this.from && other.readOnly === this.readOnly
  }

  /** Replaces this table's markdown with `next` (found again by position, in case the note changed). */
  private write(view: EditorView, next: TableData, focus?: { row: number; col: number }): void {
    const from = this.findFrom(view)
    if (from === null) return
    const doc = view.state.doc
    let endLine = doc.lineAt(from)
    while (endLine.number < doc.lines && /^\s*\|/.test(doc.line(endLine.number + 1).text)) endLine = doc.line(endLine.number + 1)
    const text = formatTable(next)
    refocus = focus ? { from, ...focus } : null
    if (text !== doc.sliceString(from, endLine.to)) {
      view.dispatch({ changes: { from, to: endLine.to, insert: text }, userEvent: 'input.table' })
    } else if (focus) {
      // Nothing changed, but the cell to edit did: move there directly.
      const dom = view.dom.querySelector<HTMLElement>(`.cm-table-wrap[data-from="${from}"]`)
      if (dom) focusCell(dom, focus.row, focus.col)
    }
  }

  private findFrom(view: EditorView): number | null {
    try {
      return view.state.doc.lineAt(this.from).from
    } catch {
      return null
    }
  }

  toDOM(view: EditorView): HTMLElement {
    const t = parseTable(this.text)
    const editable = !this.readOnly
    const wrap = document.createElement('div')
    wrap.className = 'cm-table-wrap'
    wrap.dataset.from = String(this.from)
    const table = document.createElement('table')

    // Current state of the table, including what's being typed.
    let data = t
    const commit = (cell: HTMLElement, value: string): void => {
      const row = Number(cell.dataset.row)
      const col = Number(cell.dataset.col)
      data = setCell(data, row, col, value)
    }

    const move = (row: number, col: number, dir: 'next' | 'prev' | 'down'): void => {
      const cols = data.header.length
      let r = row
      let c = col
      if (dir === 'next') {
        c++
        if (c >= cols) {
          c = 0
          r++
        }
      } else if (dir === 'prev') {
        c--
        if (c < 0) {
          c = cols - 1
          r--
        }
        if (r < -1) r = -1
      } else r++
      // Past the last row: add one.
      if (r >= data.rows.length) data = addRow(data, data.rows.length - 1)
      this.write(view, data, { row: r, col: c })
    }

    const totals = tableTotals(t)

    const makeCell = (value: string, row: number, col: number): HTMLElement => {
      const cell = document.createElement(row < 0 ? 'th' : 'td')
      cell.dataset.row = String(row)
      cell.dataset.col = String(col)
      cell.style.textAlign = t.align[col] || 'left'
      // An empty cell in a Total row shows the column's total (it isn't written into the note).
      const total = totals.get(row)?.[col]
      const show = (): void => {
        cell.innerHTML = total ? `<span class="cm-table-total" title="Worked out from the numbers above">${esc(total)}</span>` : renderCell(value) || '&nbsp;'
      }
      show()
      if (!editable) return cell
      cell.tabIndex = 0
      // Clicking shows the cell's markdown in a text box.
      const edit = (): void => {
        if (cell.querySelector('input')) return
        const input = document.createElement('input') as HTMLInputElement & { commitNow?: () => void }
        input.className = 'cm-table-input'
        // Shown without the \| escapes; they're added back when saving.
        input.value = (row < 0 ? data.header[col] : (data.rows[row]?.[col] ?? '')).replace(/\\\|/g, '|')
        input.spellcheck = true
        cell.textContent = ''
        cell.appendChild(input)
        input.focus()
        input.select()
        let done = false
        const save = (): void => commit(cell, input.value.replace(/\|/g, '\\|'))
        // For the toolbar: take what's typed so far, then let the toolbar redraw the table.
        input.commitNow = () => {
          if (done) return
          done = true
          save()
        }
        const finish = (keep: boolean, then?: 'next' | 'prev' | 'down', focusTo?: { row: number; col: number }): void => {
          if (done) return
          done = true
          if (keep) save()
          if (then) move(row, col, then)
          else if (keep) this.write(view, data, focusTo)
          else show()
        }
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Tab') {
            e.preventDefault()
            finish(true, e.shiftKey ? 'prev' : 'next')
          } else if (e.key === 'Enter') {
            e.preventDefault()
            finish(true, 'down')
          } else if (e.key === 'Escape') {
            e.preventDefault()
            finish(false)
            view.focus()
          }
          e.stopPropagation()
        })
        input.addEventListener('blur', (e) => {
          // Clicked straight into another cell of this table: save, then carry on there.
          const next = (e.relatedTarget as HTMLElement | null)?.closest?.<HTMLElement>('td, th')
          if (next && wrap.contains(next)) finish(true, undefined, { row: Number(next.dataset.row), col: Number(next.dataset.col) })
          else finish(true)
        })
      }
      cell.addEventListener('mousedown', (e) => {
        if ((e.target as HTMLElement).tagName === 'INPUT') return
        e.preventDefault()
        edit()
      })
      cell.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !cell.querySelector('input')) {
          e.preventDefault()
          edit()
        }
      })
      ;(cell as HTMLElement & { startEdit?: () => void }).startEdit = edit
      return cell
    }

    const thead = document.createElement('thead')
    const headRow = document.createElement('tr')
    t.header.forEach((h, c) => headRow.appendChild(makeCell(h, -1, c)))
    thead.appendChild(headRow)
    const tbody = document.createElement('tbody')
    t.rows.forEach((r, ri) => {
      const tr = document.createElement('tr')
      r.forEach((v, c) => tr.appendChild(makeCell(v, ri, c)))
      tbody.appendChild(tr)
    })
    table.append(thead, tbody)
    wrap.appendChild(table)

    if (editable) {
      // The toolbar acts on the cell you're in (or were last in).
      let last = { row: 0, col: 0 }
      wrap.addEventListener('focusin', (e) => {
        const cell = (e.target as HTMLElement).closest<HTMLElement>('td, th')
        if (cell) last = { row: Number(cell.dataset.row), col: Number(cell.dataset.col) }
      })
      const bar = document.createElement('div')
      bar.className = 'cm-table-bar'
      const button = (title: string, svg: string, run: () => void): void => {
        const b = document.createElement('button')
        b.type = 'button'
        b.title = title
        b.innerHTML = svg
        b.addEventListener('mousedown', (e) => {
          e.preventDefault()
          e.stopPropagation()
          wrap.querySelector<HTMLInputElement & { commitNow?: () => void }>('input.cm-table-input')?.commitNow?.()
          run()
        })
        bar.appendChild(b)
      }
      const sep = (): void => {
        bar.appendChild(Object.assign(document.createElement('span'), { className: 'cm-table-sep' }))
      }
      button('Add a row below', icon(Rows3), () => this.write(view, addRow(data, Math.max(-1, last.row)), { row: Math.max(-1, last.row) + 1, col: last.col }))
      button('Add a column to the right', icon(Columns3), () => this.write(view, addColumn(data, last.col), { row: last.row, col: last.col + 1 }))
      button('Delete this row', icon(Trash2) + '<small>row</small>', () => last.row >= 0 && this.write(view, removeRow(data, last.row)))
      button('Delete this column', icon(Trash2) + '<small>col</small>', () => this.write(view, removeColumn(data, last.col)))
      sep()
      button('Align left', icon(AlignLeft), () => this.write(view, setAlign(data, last.col, 'left')))
      button('Align centre', icon(AlignCenter), () => this.write(view, setAlign(data, last.col, 'center')))
      button('Align right', icon(AlignRight), () => this.write(view, setAlign(data, last.col, 'right')))
      sep()
      button('Sort A → Z by this column', icon(ArrowDownAZ), () => this.write(view, sortBy(data, last.col)))
      button('Sort Z → A by this column', icon(ArrowUpAZ), () => this.write(view, sortBy(data, last.col, true)))
      sep()
      button('Edit as text', icon(Code2), () => {
        const from = this.findFrom(view)
        if (from === null) return
        view.dispatch({ selection: { anchor: from } })
        view.focus()
      })
      wrap.prepend(bar)
    }

    // After a change redraws the table, carry on in the right cell.
    if (refocus && refocus.from === this.from) {
      const { row, col } = refocus
      refocus = null
      requestAnimationFrame(() => focusCell(wrap, row, col))
    }
    return wrap
  }
  ignoreEvent(): boolean {
    return true
  }
}

function focusCell(wrap: HTMLElement, row: number, col: number): void {
  const cell = wrap.querySelector<HTMLElement & { startEdit?: () => void }>(`[data-row="${row}"][data-col="${col}"]`)
  cell?.startEdit?.()
}
