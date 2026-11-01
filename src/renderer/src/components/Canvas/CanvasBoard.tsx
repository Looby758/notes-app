import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeftRight,
  BringToFront,
  Copy,
  ExternalLink,
  FileText,
  Globe,
  Group,
  ImagePlus,
  Lock,
  Maximize,
  Pencil,
  Redo2,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import {
  arrowCurve,
  bringToFront,
  boardToText,
  boundsOf,
  cardsInGroup,
  colourOf,
  curvePath,
  curvePoint,
  duplicateCards,
  endAngle,
  fitView,
  MIN_SIZE,
  newId,
  notePreview,
  overlaps,
  parseBoard,
  PRESET_COLOURS,
  removeCards,
  sideFacing,
  sidePoint,
  startAngle,
  zoomAt,
  type Arrow,
  type Board,
  type Card,
  type FileCard,
  type Point,
  type Rect,
  type Side,
  type View
} from '../../lib/canvas'
import { setPendingSave } from '../../lib/boards'
import { fileKind, openAttachment, openExternally, vaultUrl } from '../../lib/fileKinds'
import { openNote, splitPane } from '../../lib/editorController'
import { findNode, noteTitle } from '../../lib/paths'
import { looksLikeSketch, useSketchVersions } from '../../lib/sketch'
import { fuzzyFilter } from '../../lib/fuzzy'
import { getDrag, setDrag } from '../../lib/dnd'
import { useLock } from '../../lib/lock/session'
import { getNoteText, useNoteIndex } from '../../store/noteIndex'
import { useVault } from '../../store/vault'
import { usePrefs } from '../../store/prefs'
import { useUI } from '../../store/ui'
import { notify } from '../../store/notify'
import ContextMenu, { type MenuItem } from '../ContextMenu'
import FileIcon from '../FileIcon'
import Picker, { type PickerItem } from '../Picker/Picker'
import { showKeys } from '@shared/platform'
import EmptyArt from '../Motion/EmptyArt'

const SAVE_DELAY = 500
const MAX_UNDO = 100
const GRID = 24
const SIDES: Side[] = ['top', 'right', 'bottom', 'left']

/** Where each board was last looked at, so coming back to its tab shows the same spot. */
const savedViews = new Map<string, View>()

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; view: View }
  | { kind: 'move'; start: Point; origins: Map<string, Point>; before: Board; moved: boolean; clicked: string; toggle: boolean }
  | { kind: 'resize'; id: string; start: Point; rect: Rect; before: Board }
  | { kind: 'connect'; from: string; side: Side; at: Point }
  | { kind: 'select'; start: Point; at: Point; base: Set<string> }

type Menu = { x: number; y: number; items: MenuItem[] }

/** A canvas board: an endless space of notes, pictures, sketches and sticky notes, joined by arrows. */
export default function CanvasBoard({ path }: { path: string }) {
  const [board, setBoard] = useState<Board | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [view, setView] = useState<View>(() => savedViews.get(path) ?? { x: 0, y: 0, zoom: 1 })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<string | null>(null)
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [picking, setPicking] = useState<{ at: Point; free: boolean } | null>(null)
  const [dropping, setDropping] = useState(false)
  const [, setHistoryVersion] = useState(0)
  const host = useRef<HTMLDivElement>(null)
  const boardRef = useRef<Board | null>(null)
  const viewRef = useRef(view)
  const history = useRef<{ undo: Board[]; redo: Board[] }>({ undo: [], redo: [] })
  /** The file's text as last read or written, to tell our own saves from changes made elsewhere. */
  const onDisk = useRef<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** A sticky note just added: removed again if you leave it empty. */
  const fresh = useRef<string | null>(null)
  const attachmentFolder = usePrefs((s) => s.prefs.attachmentFolder)
  boardRef.current = board
  viewRef.current = view

  // ---------- loading and saving ----------

  const saveNow = useCallback(async () => {
    clearTimeout(saveTimer.current)
    setPendingSave(path, null)
    const b = boardRef.current
    if (!b) return
    const text = boardToText(b)
    if (text === onDisk.current) return
    onDisk.current = text
    await window.api.writeNote(path, text)
  }, [path])

  const load = useCallback(
    async (first: boolean) => {
      try {
        const text = await window.api.readNote(path)
        if (!first && text === onDisk.current) return
        const b = parseBoard(text)
        onDisk.current = text
        setBoard(b)
        setFailed(null)
        if (first && !savedViews.has(path)) {
          const r = host.current?.getBoundingClientRect()
          setView(fitView(boundsOf(b.nodes), r?.width ?? 800, r?.height ?? 600))
        }
      } catch (err) {
        if (first) setFailed(err instanceof Error ? err.message : String(err))
      }
    },
    [path]
  )

  useEffect(() => {
    void load(true)
    // Changed elsewhere (another device, Obsidian): show the new version unless there are unsaved changes here.
    const off = window.api.onVaultChanged((paths) => {
      if (paths.includes(path) && !saveTimer.current) void load(false)
    })
    return () => {
      off()
      if (saveTimer.current) void saveNow().catch(notify)
    }
  }, [path, load, saveNow])

  useEffect(() => {
    // (Not before the board has loaded, which decides where to start.)
    if (boardRef.current) savedViews.set(path, view)
  }, [path, view])

  /** Shows a change, and saves it shortly. `before` (the board before the change) makes it undoable. */
  const apply = useCallback(
    (next: Board, before: Board | null = boardRef.current) => {
      if (before && before !== next) {
        history.current.undo.push(before)
        if (history.current.undo.length > MAX_UNDO) history.current.undo.shift()
        history.current.redo = []
        setHistoryVersion((v) => v + 1)
      }
      boardRef.current = next
      setBoard(next)
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        saveTimer.current = undefined
        void saveNow().catch(notify)
      }, SAVE_DELAY)
      setPendingSave(path, saveNow)
    },
    [path, saveNow]
  )

  const undo = (redo = false): void => {
    const h = history.current
    const from = redo ? h.redo : h.undo
    const to = redo ? h.undo : h.redo
    const prev = from.pop()
    if (!prev || !boardRef.current) return
    to.push(boardRef.current)
    setHistoryVersion((v) => v + 1)
    setEditing(null)
    apply(prev, null)
  }

  // ---------- positions ----------

  /** The board point under a point on screen. */
  const toBoard = (clientX: number, clientY: number): Point => {
    const r = host.current!.getBoundingClientRect()
    const v = viewRef.current
    return { x: v.x + (clientX - r.left) / v.zoom, y: v.y + (clientY - r.top) / v.zoom }
  }

  /** The middle of what's on screen. */
  const middle = (): Point => {
    const r = host.current!.getBoundingClientRect()
    return toBoard(r.left + r.width / 2, r.top + r.height / 2)
  }

  /**
   * A spot for a new card centred on `p`. With `free`, the nearest spot that doesn't cover another
   * card (for things added from the toolbar); otherwise just nudged if a card already starts there.
   */
  const placeAt = (p: Point, width: number, height: number, free = false): Rect => {
    const cards = boardRef.current?.nodes.filter((n) => n.type !== 'group') ?? []
    const at = (x: number, y: number): Rect => ({ x: Math.round(x - width / 2), y: Math.round(y - height / 2), width, height })
    if (free) {
      const gap = 30
      const padded = (r: Rect): Rect => ({ x: r.x - gap, y: r.y - gap, width: r.width + gap * 2, height: r.height + gap * 2 })
      const step = 60
      // Rings of spots further and further out from `p`.
      for (let ring = 0; ring < 25; ring++) {
        for (let i = -ring; i <= ring; i++) {
          for (const [dx, dy] of [[i, -ring], [i, ring], [-ring, i], [ring, i]]) {
            const r = at(p.x + dx * step, p.y + dy * step)
            if (!cards.some((c) => overlaps(padded(r), c))) return r
          }
        }
      }
    }
    const r = at(p.x, p.y)
    while (cards.some((n) => Math.abs(n.x - r.x) < 8 && Math.abs(n.y - r.y) < 8)) {
      r.x += 30
      r.y += 30
    }
    return r
  }

  const cardById = (id: string): Card | undefined => boardRef.current?.nodes.find((n) => n.id === id)

  // ---------- adding things ----------

  const addCards = (cards: Card[], select = true): void => {
    const b = boardRef.current
    if (!b || cards.length === 0) return
    apply({ ...b, nodes: [...b.nodes, ...cards] })
    if (select) setSelected(new Set(cards.map((c) => c.id)))
  }

  const addSticky = (at: Point, text = '', free = false): string => {
    const id = newId()
    addCards([{ id, type: 'text', text, ...placeAt(at, 260, 140, free) }])
    if (!text) {
      fresh.current = id
      setEditing(id)
    }
    return id
  }

  const addGroup = (at: Point, free = false): void => {
    const id = newId()
    addCards([{ id, type: 'group', label: 'Group', ...placeAt(at, 520, 360, free) }])
  }

  /** Cards for files from the notes folder (notes, pictures, anything), side by side from `at`. */
  const addFiles = async (files: string[], at: Point, free = false): Promise<void> => {
    const cards: FileCard[] = []
    let x = at.x
    for (const file of files) {
      let width = 320
      let height = 240
      const kind = file.toLowerCase().endsWith('.md') ? 'note' : fileKind(file)
      if (kind === 'image') {
        const size = await imageSize(vaultUrl(file)).catch(() => null)
        if (size) {
          width = Math.min(400, Math.max(120, size.width))
          height = Math.max(MIN_SIZE, Math.round((width * size.height) / Math.max(1, size.width)))
        }
      } else if (kind !== 'note') {
        width = 280
        height = 72
      }
      const rect = placeAt({ x: x + width / 2, y: at.y }, width, height, free)
      cards.push({ id: newId(), type: 'file', file, ...rect })
      x += width + 30
    }
    addCards(cards)
  }

  /** Files from outside the notes folder (dropped or pasted): copied into the attachments folder first. */
  const addOutsideFiles = async (list: File[], at: Point, free = false): Promise<void> => {
    const saved: string[] = []
    for (const f of list) {
      try {
        saved.push(await window.api.saveAttachment(attachmentFolder, f.name || 'Pasted image.png', new Uint8Array(await f.arrayBuffer())))
      } catch (err) {
        notify(err)
      }
    }
    if (saved.length) {
      void useVault.getState().refresh()
      await addFiles(saved, at, free)
    }
  }

  const addPicture = async (at: Point, free = false): Promise<void> => {
    try {
      const files = await window.api.pickAttachment(attachmentFolder, true)
      if (files.length) {
        void useVault.getState().refresh()
        await addFiles(files, at, free)
      }
    } catch (err) {
      notify(err)
    }
  }

  const addFilesRef = useRef(addFiles)
  addFilesRef.current = addFiles
  const drawSketch = (at: Point, free = false): void => {
    useUI.setState({ sketch: { path: null, onSaved: (file) => void addFilesRef.current([file], at, free) } })
  }

  // ---------- changing things ----------

  const updateCard = (id: string, patch: Partial<Card>, before?: Board | null): void => {
    const b = boardRef.current
    if (!b) return
    apply({ ...b, nodes: b.nodes.map((n) => (n.id === id ? ({ ...n, ...patch } as Card) : n)) }, before)
  }

  const updateArrow = (id: string, patch: Partial<Arrow>): void => {
    const b = boardRef.current
    if (!b) return
    apply({ ...b, edges: b.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) })
  }

  const deleteSelected = (ids = selected): void => {
    const b = boardRef.current
    if (!b || ids.size === 0) return
    apply(removeCards(b, ids))
    setSelected(new Set())
    setEditing(null)
  }

  const setColour = (color: string | undefined): void => {
    const b = boardRef.current
    if (!b) return
    const paint = <T extends { id: string; color?: string }>(x: T): T => {
      if (!selected.has(x.id)) return x
      const { color: _old, ...rest } = x
      return (color ? { ...rest, color } : rest) as T
    }
    apply({ nodes: b.nodes.map(paint), edges: b.edges.map(paint) })
  }

  const duplicate = (): void => {
    const b = boardRef.current
    if (!b) return
    const { board: next, added } = duplicateCards(b, selected)
    if (added.length === 0) return
    apply(next)
    setSelected(new Set(added))
  }

  const finishEditing = (id: string, text: string): void => {
    setEditing(null)
    const card = cardById(id)
    if (card?.type === 'text') {
      // A sticky note added and left empty isn't wanted after all.
      if (fresh.current === id && !text.trim()) {
        // Back to just before it was added (so Undo doesn't bring back an empty note).
        const before = history.current.undo.pop()
        history.current.redo = []
        setHistoryVersion((v) => v + 1)
        apply(before ?? removeCards(boardRef.current!, new Set([id])), null)
        setSelected(new Set())
      } else if (card.text !== text) updateCard(id, { text })
    } else if (card?.type === 'group') {
      if ((card.label ?? '') !== text) updateCard(id, { label: text.trim() || undefined })
    } else {
      const arrow = boardRef.current?.edges.find((e) => e.id === id)
      if (arrow && (arrow.label ?? '') !== text.trim()) updateArrow(id, { label: text.trim() || undefined })
    }
    fresh.current = null
    host.current?.focus()
  }

  const openCard = (card: Card, side = false): void => {
    if (card.type === 'text' || card.type === 'group') {
      setSelected(new Set([card.id]))
      setEditing(card.id)
    } else if (card.type === 'link') {
      window.open(card.url)
    } else if (!findNode(useVault.getState().tree, card.file)) {
      notify(`“${card.file}” isn’t in your notes folder any more.`)
    } else if (card.file.toLowerCase().endsWith('.md')) {
      if (side) splitPane('right', { tab: card.file })
      else openNote(card.file, { newTab: true })
    } else {
      openAttachment(card.file, { newTab: true })
    }
  }

  // ---------- mouse, pen and touch ----------

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement
    if (target.closest('textarea, input, button')) return
    setMenu(null)
    if (e.button === 2) return
    host.current?.focus({ preventScroll: true })
    const p = toBoard(e.clientX, e.clientY)
    const capture = (): void => e.currentTarget.setPointerCapture(e.pointerId)
    // Middle button: always move around.
    if (e.button === 1) {
      e.preventDefault()
      capture()
      setGesture({ kind: 'pan', sx: e.clientX, sy: e.clientY, view: viewRef.current })
      return
    }
    if (e.button !== 0) return
    const b = boardRef.current
    if (!b) return
    const dot = target.closest<HTMLElement>('[data-dot]')
    const resize = target.closest<HTMLElement>('[data-resize]')
    const cardEl = target.closest<HTMLElement>('[data-card]')
    const arrowEl = target.closest<SVGElement>('[data-arrow]')
    capture()
    if (dot) {
      setGesture({ kind: 'connect', from: dot.dataset.card!, side: dot.dataset.dot as Side, at: p })
    } else if (resize) {
      const card = cardById(resize.dataset.resize!)
      if (card) setGesture({ kind: 'resize', id: card.id, start: p, rect: { x: card.x, y: card.y, width: card.width, height: card.height }, before: b })
    } else if (cardEl) {
      const id = cardEl.dataset.card!
      const toggle = e.shiftKey || e.ctrlKey || e.metaKey
      let sel = selected
      if (toggle) {
        sel = new Set(selected)
        if (sel.has(id)) sel.delete(id)
        else sel.add(id)
      } else if (!selected.has(id)) sel = new Set([id])
      setSelected(sel)
      if (editing && editing !== id) setEditing(null)
      // Groups bring the cards inside them along.
      const moving = new Map<string, Point>()
      for (const n of b.nodes) {
        if (!sel.has(n.id)) continue
        moving.set(n.id, { x: n.x, y: n.y })
        if (n.type === 'group') for (const inner of cardsInGroup(b, n)) moving.set(inner.id, { x: inner.x, y: inner.y })
      }
      setGesture({ kind: 'move', start: p, origins: moving, before: b, moved: false, clicked: id, toggle })
    } else if (arrowEl) {
      const id = arrowEl.dataset.arrow!
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        const sel = new Set(selected)
        if (sel.has(id)) sel.delete(id)
        else sel.add(id)
        setSelected(sel)
      } else setSelected(new Set([id]))
      setEditing(null)
    } else if (e.shiftKey) {
      setGesture({ kind: 'select', start: p, at: p, base: selected })
    } else {
      setSelected(new Set())
      setEditing(null)
      setGesture({ kind: 'pan', sx: e.clientX, sy: e.clientY, view: viewRef.current })
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const g = gesture
    if (!g) return
    if (g.kind === 'pan') {
      const z = g.view.zoom
      setView({ ...g.view, x: g.view.x - (e.clientX - g.sx) / z, y: g.view.y - (e.clientY - g.sy) / z })
      return
    }
    const p = toBoard(e.clientX, e.clientY)
    const b = boardRef.current
    if (!b) return
    if (g.kind === 'move') {
      const dx = p.x - g.start.x
      const dy = p.y - g.start.y
      // A tiny wobble while clicking isn't a move.
      if (!g.moved && Math.hypot(dx, dy) * viewRef.current.zoom < 3) return
      if (!g.moved) setGesture({ ...g, moved: true })
      const nodes = b.nodes.map((n) => {
        const o = g.origins.get(n.id)
        return o ? { ...n, x: o.x + dx, y: o.y + dy } : n
      })
      boardRef.current = { ...b, nodes }
      setBoard(boardRef.current)
    } else if (g.kind === 'resize') {
      const width = Math.max(MIN_SIZE, g.rect.width + p.x - g.start.x)
      const height = Math.max(MIN_SIZE, g.rect.height + p.y - g.start.y)
      boardRef.current = { ...b, nodes: b.nodes.map((n) => (n.id === g.id ? { ...n, width, height } : n)) }
      setBoard(boardRef.current)
    } else if (g.kind === 'connect' || g.kind === 'select') {
      setGesture({ ...g, at: p })
      if (g.kind === 'select') {
        const box = rectBetween(g.start, p)
        const sel = new Set(g.base)
        for (const n of b.nodes) if (overlaps(box, n)) sel.add(n.id)
        setSelected(sel)
      }
    }
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const g = gesture
    setGesture(null)
    if (!g) return
    const b = boardRef.current
    if (!b) return
    if (g.kind === 'move') {
      if (g.moved) apply(b, g.before)
      // Clicking one of several selected cards (without moving it) picks just that one.
      else if (!g.toggle && selected.size > 1) setSelected(new Set([g.clicked]))
    } else if (g.kind === 'resize') {
      apply(b, g.before)
    } else if (g.kind === 'connect') {
      const from = cardById(g.from)
      if (!from) return
      const p = toBoard(e.clientX, e.clientY)
      const under = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-card]')?.dataset.card
      const fromPoint = sidePoint(from, g.side)
      // A short drag that ends where it started isn't meant as an arrow.
      if (Math.hypot(p.x - fromPoint.x, p.y - fromPoint.y) * viewRef.current.zoom < 12 && (!under || under === g.from)) return
      const target = under && under !== g.from ? cardById(under) : undefined
      if (target) {
        const arrow: Arrow = { id: newId(), fromNode: from.id, fromSide: g.side, toNode: target.id, toSide: sideFacing(target, fromPoint) }
        apply({ ...b, edges: [...b.edges, arrow] })
        setSelected(new Set([arrow.id]))
      } else {
        // Let go on empty space: a new sticky note there, already joined up.
        const id = newId()
        const rect = placeAt(p, 260, 140)
        const card: Card = { id, type: 'text', text: '', ...rect }
        const arrow: Arrow = { id: newId(), fromNode: from.id, fromSide: g.side, toNode: id, toSide: sideFacing(rect, fromPoint) }
        apply({ nodes: [...b.nodes, card], edges: [...b.edges, arrow] })
        setSelected(new Set([id]))
        fresh.current = id
        setEditing(id)
      }
    }
  }

  // The wheel zooms around the pointer. (Added by hand: React's wheel listener can't stop the page scrolling.)
  useEffect(() => {
    const el = host.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if ((e.target as HTMLElement).closest('textarea')) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const step = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      setView((v) => zoomAt(v, Math.exp(-step * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const zoomBy = (factor: number): void => {
    const r = host.current!.getBoundingClientRect()
    setView((v) => zoomAt(v, factor, r.width / 2, r.height / 2))
  }

  const fit = (): void => {
    const r = host.current!.getBoundingClientRect()
    setView(fitView(boundsOf(boardRef.current?.nodes ?? []), r.width, r.height))
  }

  // ---------- keyboard ----------

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if ((e.target as HTMLElement).closest('textarea, input')) return
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    let handled = true
    if (key === 'delete' || key === 'backspace') deleteSelected()
    else if (mod && key === 'z') undo(e.shiftKey)
    else if (mod && key === 'y') undo(true)
    else if (mod && key === 'a') setSelected(new Set([...(board?.nodes ?? []).map((n) => n.id), ...(board?.edges ?? []).map((a) => a.id)]))
    else if (mod && key === 'd') duplicate()
    else if (key === 'escape') setSelected(new Set())
    else if (key === 'enter' && selected.size === 1) {
      const card = cardById([...selected][0])
      if (card) openCard(card)
    } else if (!mod && (key === '+' || key === '=')) zoomBy(1.2)
    else if (!mod && key === '-') zoomBy(1 / 1.2)
    else if (!mod && e.shiftKey && key === '!') fit()
    else if (!mod && ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key) && selected.size) {
      const step = e.shiftKey ? 50 : 10
      const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0
      const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0
      const b = boardRef.current!
      apply({ ...b, nodes: b.nodes.map((n) => (selected.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)) })
    } else handled = false
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>): void => {
    if ((e.target as HTMLElement).closest('textarea, input')) return
    const files = [...e.clipboardData.files]
    const at = middle()
    e.preventDefault()
    if (files.length) {
      void addOutsideFiles(files, at, true)
      return
    }
    const text = e.clipboardData.getData('text/plain').trim()
    if (!text) return
    if (/^https?:\/\/\S+$/i.test(text)) addCards([{ id: newId(), type: 'link', url: text, ...placeAt(at, 320, 72, true) }])
    else addSticky(at, text, true)
  }

  // ---------- dragging in from the sidebar or from outside ----------

  const onDragOver = (e: DragEvent<HTMLDivElement>): void => {
    const drag = getDrag()
    const outside = !drag && [...e.dataTransfer.types].includes('Files')
    if (!(drag && (drag.kind === 'note' || drag.kind === 'file')) && !outside) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setDropping(true)
  }

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    setDropping(false)
    const drag = getDrag()
    const at = toBoard(e.clientX, e.clientY)
    if (drag && (drag.kind === 'note' || drag.kind === 'file')) {
      e.preventDefault()
      e.stopPropagation()
      setDrag(null)
      void addFiles([drag.path], at)
    } else if (!drag && e.dataTransfer.files.length) {
      e.preventDefault()
      e.stopPropagation()
      void addOutsideFiles([...e.dataTransfer.files], at)
    }
  }

  // ---------- right-click menus ----------

  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement
    if (target.closest('textarea, input')) return
    e.preventDefault()
    const at = toBoard(e.clientX, e.clientY)
    const cardId = target.closest<HTMLElement>('[data-card]')?.dataset.card
    const arrowId = target.closest<SVGElement>('[data-arrow]')?.dataset.arrow
    const card = cardId ? cardById(cardId) : undefined
    const arrow = arrowId ? boardRef.current?.edges.find((a) => a.id === arrowId) : undefined
    let items: MenuItem[]
    if (card) {
      const ids = selected.has(card.id) ? selected : new Set([card.id])
      setSelected(ids)
      const isNote = card.type === 'file' && card.file.toLowerCase().endsWith('.md')
      items = [
        ...(card.type === 'text' ? [{ label: 'Edit text', icon: <Type size={15} />, onClick: () => openCard(card) }] : []),
        ...(card.type === 'group' ? [{ label: 'Rename group', icon: <Type size={15} />, onClick: () => openCard(card) }] : []),
        ...(card.type === 'file' || card.type === 'link' ? [{ label: 'Open', icon: <FileText size={15} />, onClick: () => openCard(card) }] : []),
        ...(isNote ? [{ label: 'Open to the right', icon: <FileText size={15} />, onClick: () => openCard(card, true) }] : []),
        ...(card.type === 'file' && looksLikeSketch(card.file)
          ? [{ label: 'Edit sketch', icon: <Pencil size={15} />, onClick: () => useUI.setState({ sketch: { path: card.file } }) }]
          : []),
        ...(card.type === 'file' && !isNote
          ? [{ label: 'Open in its usual app', icon: <ExternalLink size={15} />, onClick: () => openExternally(card.file) }]
          : []),
        'separator',
        {
          label: 'Duplicate',
          icon: <Copy size={15} />,
          onClick: () => {
            const { board: next, added } = duplicateCards(boardRef.current!, ids)
            apply(next)
            setSelected(new Set(added))
          }
        },
        { label: 'Bring to front', icon: <BringToFront size={15} />, onClick: () => apply(bringToFront(boardRef.current!, ids)) },
        'separator',
        { label: ids.size > 1 ? `Remove ${ids.size} from board` : 'Remove from board', icon: <Trash2 size={15} />, danger: true, onClick: () => deleteSelected(ids) }
      ]
    } else if (arrow) {
      setSelected(new Set([arrow.id]))
      items = [
        { label: arrow.label ? 'Edit label' : 'Add a label', icon: <Type size={15} />, onClick: () => setEditing(arrow.id) },
        {
          label: 'Turn around',
          icon: <ArrowLeftRight size={15} />,
          onClick: () =>
            updateArrow(arrow.id, {
              fromNode: arrow.toNode,
              fromSide: arrow.toSide,
              fromEnd: arrow.toEnd,
              toNode: arrow.fromNode,
              toSide: arrow.fromSide,
              toEnd: arrow.fromEnd
            })
        },
        {
          label: (arrow.fromEnd ?? 'none') === 'arrow' ? 'Point one way' : 'Point both ways',
          icon: <ArrowLeftRight size={15} />,
          onClick: () => updateArrow(arrow.id, { fromEnd: (arrow.fromEnd ?? 'none') === 'arrow' ? undefined : 'arrow' })
        },
        'separator',
        { label: 'Delete arrow', icon: <Trash2 size={15} />, danger: true, onClick: () => deleteSelected(new Set([arrow.id])) }
      ]
    } else {
      items = [
        { label: 'Add a sticky note here', icon: <StickyNote size={15} />, onClick: () => addSticky(at) },
        { label: 'Add a note…', icon: <FileText size={15} />, onClick: () => setPicking({ at, free: false }) },
        { label: 'Add a picture…', icon: <ImagePlus size={15} />, onClick: () => void addPicture(at) },
        { label: 'Draw a sketch…', icon: <Pencil size={15} />, onClick: () => drawSketch(at) },
        { label: 'Add a group here', icon: <Group size={15} />, onClick: () => addGroup(at) }
      ]
    }
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  // ---------- drawing ----------

  if (failed) {
    return (
      <div className="canvas-board">
        <p className="canvas-failed">{failed}</p>
      </div>
    )
  }

  const nodes = board?.nodes ?? []
  const byId = new Map(board?.nodes.map((n) => [n.id, n]) ?? [])
  const selectedCards = board?.nodes.filter((n) => selected.has(n.id)) ?? []
  const selectedArrows = board?.edges.filter((a) => selected.has(a.id)) ?? []
  const single = selectedCards.length === 1 && selectedArrows.length === 0 ? selectedCards[0] : null
  const z = view.zoom
  const h = history.current
  const cardView = (card: Card): React.ReactNode => (
    <CardView
      key={card.id}
      card={card}
      selected={selected.has(card.id)}
      editing={editing === card.id}
      linking={gesture?.kind === 'connect'}
      onDone={(text) => finishEditing(card.id, text)}
    />
  )

  return (
    <div className="canvas-board" data-board={path}>
      <div
        ref={host}
        className={`canvas-viewport ${gesture?.kind === 'pan' ? 'panning' : ''} ${dropping ? 'dropping' : ''}`}
        tabIndex={0}
        style={{
          backgroundSize: `${GRID * z}px ${GRID * z}px`,
          backgroundPosition: `${-view.x * z}px ${-view.y * z}px`
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setGesture(null)}
        onDoubleClick={(e) => {
          // What's really under the pointer (the click itself goes to the board, which held on to the pointer).
          const target = (document.elementFromPoint(e.clientX, e.clientY) ?? e.target) as HTMLElement
          if (target.closest('textarea, input, button')) return
          const cardId = target.closest<HTMLElement>('[data-card]')?.dataset.card
          const arrowId = target.closest<SVGElement>('[data-arrow]')?.dataset.arrow
          if (cardId) {
            const card = cardById(cardId)
            if (card) openCard(card)
          } else if (arrowId) setEditing(arrowId)
          else addSticky(toBoard(e.clientX, e.clientY))
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onContextMenu={onContextMenu}
        onDragOver={onDragOver}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropping(false)}
        onDrop={onDrop}
      >
        <div className="canvas-world" style={{ transform: `translate(${-view.x * z}px, ${-view.y * z}px) scale(${z})` }}>
          {/* Groups underneath, then arrows, then the cards on top. */}
          {nodes.filter((c) => c.type === 'group').map(cardView)}
          <svg className="canvas-arrows" width="1" height="1">
            {board?.edges.map((a) => {
              const from = byId.get(a.fromNode)
              const to = byId.get(a.toNode)
              if (!from || !to) return null
              return <ArrowView key={a.id} arrow={a} curve={arrowCurve(from, to, a.fromSide, a.toSide)} selected={selected.has(a.id)} zoom={z} />
            })}
            {gesture?.kind === 'connect' && byId.get(gesture.from) && (
              <ArrowView
                arrow={{ id: '', fromNode: '', toNode: '' }}
                curve={arrowCurve(byId.get(gesture.from)!, gesture.at, gesture.side)}
                selected
                zoom={z}
              />
            )}
          </svg>
          {nodes.filter((c) => c.type !== 'group').map(cardView)}
          {board?.edges.map((a) => {
            const from = byId.get(a.fromNode)
            const to = byId.get(a.toNode)
            if (!from || !to || (!a.label && editing !== a.id)) return null
            const mid = curvePoint(arrowCurve(from, to, a.fromSide, a.toSide), 0.5)
            return (
              <div key={a.id} className={`canvas-arrow-label ${selected.has(a.id) ? 'selected' : ''}`} data-arrow={a.id} style={{ left: mid.x, top: mid.y }}>
                {editing === a.id ? <LabelInput initial={a.label ?? ''} onDone={(t) => finishEditing(a.id, t)} /> : a.label}
              </div>
            )
          })}
          {gesture?.kind === 'select' && <div className="canvas-select-box" style={rectStyle(rectBetween(gesture.start, gesture.at))} />}
        </div>
        {board && board.nodes.length === 0 && (
          <div className="canvas-empty">
            <EmptyArt kind="board" size={64} />
            <p>Your board is empty</p>
            <span>Double-click anywhere to add a sticky note, or drag notes and pictures in from the sidebar.</span>
            <span>Drag from the dot on a card’s edge to another card to draw an arrow.</span>
          </div>
        )}
      </div>

      {(selectedCards.length > 0 || selectedArrows.length > 0) && !editing && (
        <div className="canvas-selection-bar" onPointerDown={(e) => e.stopPropagation()}>
          <button className="canvas-swatch none" title="No colour" onClick={() => setColour(undefined)} />
          {Object.entries(PRESET_COLOURS).map(([id, c]) => (
            <button key={id} className="canvas-swatch" style={{ background: c }} title="Colour" onClick={() => setColour(id)} />
          ))}
          <span className="canvas-bar-gap" />
          {single?.type === 'file' && looksLikeSketch(single.file) && (
            <button className="icon-btn" title="Edit sketch" onClick={() => useUI.setState({ sketch: { path: single.file } })}>
              <Pencil size={15} />
            </button>
          )}
          {selectedCards.length > 0 && (
            <button className="icon-btn" title={`Duplicate (${showKeys('Ctrl+D')})`} onClick={duplicate}>
              <Copy size={15} />
            </button>
          )}
          <button className="icon-btn" title="Remove from board (Delete)" onClick={() => deleteSelected()}>
            <Trash2 size={15} />
          </button>
        </div>
      )}

      <div className="canvas-toolbar" onPointerDown={(e) => e.stopPropagation()}>
        <button className="icon-btn" title="Add a sticky note (or double-click the board)" onClick={() => addSticky(middle(), '', true)}>
          <StickyNote size={16} />
        </button>
        <button className="icon-btn" title="Add a note" onClick={() => setPicking({ at: middle(), free: true })}>
          <FileText size={16} />
        </button>
        <button className="icon-btn" title="Add a picture" onClick={() => void addPicture(middle(), true)}>
          <ImagePlus size={16} />
        </button>
        <button className="icon-btn" title="Draw a sketch" onClick={() => drawSketch(middle(), true)}>
          <Pencil size={16} />
        </button>
        <button className="icon-btn" title="Add a group (a box to keep cards together)" onClick={() => addGroup(middle(), true)}>
          <Group size={16} />
        </button>
        <span className="canvas-bar-sep" />
        <button className="icon-btn" title="Zoom out (-)" onClick={() => zoomBy(1 / 1.2)}>
          <ZoomOut size={16} />
        </button>
        <button className="canvas-zoom" title="Back to 100%" onClick={() => zoomBy(1 / view.zoom)}>
          {Math.round(view.zoom * 100)}%
        </button>
        <button className="icon-btn" title="Zoom in (+)" onClick={() => zoomBy(1.2)}>
          <ZoomIn size={16} />
        </button>
        <button className="icon-btn" title="Show everything (Shift+1)" onClick={fit}>
          <Maximize size={16} />
        </button>
        <span className="canvas-bar-sep" />
        <button className="icon-btn" title={`Undo (${showKeys('Ctrl+Z')})`} disabled={h.undo.length === 0} onClick={() => undo()}>
          <Undo2 size={16} />
        </button>
        <button className="icon-btn" title={`Redo (${showKeys('Ctrl+Y')})`} disabled={h.redo.length === 0} onClick={() => undo(true)}>
          <Redo2 size={16} />
        </button>
      </div>

      {picking && <NotePicker onPick={(file) => void addFiles([file], picking.at, picking.free)} onClose={() => setPicking(null)} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  )
}

// ---------- cards ----------

function CardView({ card, selected, editing, linking, onDone }: { card: Card; selected: boolean; editing: boolean; linking: boolean; onDone: (text: string) => void }) {
  const colour = colourOf(card.color)
  const style = { ...rectStyle(card), ...(colour ? { '--card-colour': colour } : {}) } as React.CSSProperties
  const kind = card.type === 'file' ? (card.file.toLowerCase().endsWith('.md') ? 'note' : fileKind(card.file)) : card.type
  return (
    <div
      className={`canvas-card ${card.type} ${kind} ${colour ? 'coloured' : ''} ${selected ? 'selected' : ''} ${linking ? 'linking' : ''}`}
      data-card={card.id}
      style={style}
    >
      {card.type === 'text' &&
        (editing ? <TextEditor initial={card.text} onDone={onDone} /> : <div className="canvas-text">{card.text || <span className="canvas-placeholder">Empty note</span>}</div>)}
      {card.type === 'group' && (
        <div className="canvas-group-label">{editing ? <LabelInput initial={card.label ?? ''} onDone={onDone} /> : card.label || 'Group'}</div>
      )}
      {card.type === 'link' && (
        <div className="canvas-file">
          <Globe size={16} />
          <span className="canvas-file-name">{card.url}</span>
        </div>
      )}
      {card.type === 'file' && <FileCardBody card={card} />}
      {!editing &&
        SIDES.map((side) => <span key={side} className={`canvas-dot ${side}`} data-dot={side} data-card={card.id} title="Drag to another card to draw an arrow" />)}
      {selected && !editing && <span className="canvas-resize" data-resize={card.id} title="Drag to resize" />}
    </div>
  )
}

function FileCardBody({ card }: { card: FileCard }) {
  const exists = useVault((s) => !!findNode(s.tree, card.file))
  const name = card.file.slice(card.file.lastIndexOf('/') + 1)
  if (!exists) {
    return (
      <div className="canvas-file missing">
        <FileIcon path={card.file} size={16} />
        <span className="canvas-file-name">{name}</span>
        <span className="canvas-file-note">Not in your notes folder any more</span>
      </div>
    )
  }
  if (card.file.toLowerCase().endsWith('.md')) return <NoteCardBody path={card.file} />
  if (fileKind(card.file) === 'image') return <ImageCardBody path={card.file} />
  return (
    <div className="canvas-file">
      <FileIcon path={card.file} size={16} />
      <span className="canvas-file-name">{name}</span>
    </div>
  )
}

function NoteCardBody({ path }: { path: string }) {
  // Re-read when any note changes.
  useNoteIndex((s) => s.version)
  const locked = useLock((s) => path in s.locked)
  const icon = useNoteIndex((s) => s.notes.get(path)?.icon)
  const text = locked ? null : getNoteText(path)
  const preview = useMemo(() => (text ? notePreview(text, 400, noteTitle(path)) : ''), [text, path])
  return (
    <>
      <div className="canvas-note-title">
        {icon ? <span className="canvas-note-icon">{icon}</span> : <FileText size={14} />}
        <span>{noteTitle(path)}</span>
      </div>
      <div className="canvas-note-body">
        {locked ? (
          <span className="canvas-placeholder">
            <Lock size={12} /> Locked note
          </span>
        ) : (
          preview || <span className="canvas-placeholder">Empty note</span>
        )}
      </div>
    </>
  )
}

function ImageCardBody({ path }: { path: string }) {
  const version = useSketchVersions((s) => s[path] ?? 0)
  const [failed, setFailed] = useState(false)
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (failed) {
    return (
      <div className="canvas-file">
        <FileIcon path={path} size={16} />
        <span className="canvas-file-name">{name}</span>
      </div>
    )
  }
  return <img className="canvas-image" src={vaultUrl(path) + (version ? `?v=${version}` : '')} alt={name} draggable={false} onError={() => setFailed(true)} />
}

function TextEditor({ initial, onDone }: { initial: string; onDone: (text: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)
  const finish = (): void => {
    if (done.current) return
    done.current = true
    onDone(ref.current?.value ?? initial)
  }
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  return (
    <textarea
      ref={ref}
      className="canvas-text-edit"
      defaultValue={initial}
      placeholder="Type something…"
      onBlur={finish}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault()
          finish()
        }
      }}
    />
  )
}

function LabelInput({ initial, onDone }: { initial: string; onDone: (text: string) => void }) {
  const done = useRef(false)
  const finish = (value: string): void => {
    if (done.current) return
    done.current = true
    onDone(value)
  }
  return (
    <input
      className="canvas-label-edit"
      autoFocus
      defaultValue={initial}
      placeholder="Label"
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' || e.key === 'Escape') finish(e.currentTarget.value)
      }}
    />
  )
}

// ---------- arrows ----------

function ArrowView({ arrow, curve, selected, zoom }: { arrow: Arrow; curve: ReturnType<typeof arrowCurve>; selected: boolean; zoom: number }) {
  const colour = colourOf(arrow.color) ?? undefined
  const d = curvePath(curve)
  // Arrowheads keep a readable size when zoomed far out.
  const size = Math.max(10, 7 / zoom)
  const head = (p: Point, angle: number): string => {
    const a1 = angle + Math.PI * 0.85
    const a2 = angle - Math.PI * 0.85
    return `M${p.x} ${p.y}L${p.x + Math.cos(a1) * size} ${p.y + Math.sin(a1) * size}L${p.x + Math.cos(a2) * size} ${p.y + Math.sin(a2) * size}Z`
  }
  return (
    <g className={`canvas-arrow ${selected ? 'selected' : ''}`} style={colour ? { color: colour } : undefined} data-arrow={arrow.id || undefined}>
      {arrow.id && <path className="canvas-arrow-hit" d={d} />}
      <path className="canvas-arrow-line" d={d} style={{ strokeWidth: Math.max(2, 1.5 / zoom) }} />
      {(arrow.toEnd ?? 'arrow') === 'arrow' && <path className="canvas-arrow-head" d={head(curve[3], endAngle(curve))} />}
      {arrow.fromEnd === 'arrow' && <path className="canvas-arrow-head" d={head(curve[0], startAngle(curve))} />}
    </g>
  )
}

// ---------- adding a note ----------

function NotePicker({ onPick, onClose }: { onPick: (path: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const paths = useNoteIndex((s) => s.lookup.paths)
  const items: PickerItem[] = fuzzyFilter(paths, query, noteTitle)
    .slice(0, 50)
    .map(({ item }) => ({
      id: item,
      label: noteTitle(item),
      detail: item.includes('/') ? item.slice(0, item.lastIndexOf('/')) : undefined,
      icon: <FileText size={14} />,
      run: () => {
        onPick(item)
        onClose()
      }
    }))
  // Over the whole window, not just this pane (a pane beside it in split view used to cover it).
  return createPortal(
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <Picker query={query} onQuery={setQuery} items={items} placeholder="Find a note to put on the board…" empty="No notes match" onEscape={onClose} />
      </div>
    </div>,
    document.body
  )
}

// ---------- helpers ----------

const rectStyle = (r: Rect): React.CSSProperties => ({ left: r.x, top: r.y, width: r.width, height: r.height })

const rectBetween = (a: Point, b: Point): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) })

function imageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = reject
    img.src = url
  })
}
