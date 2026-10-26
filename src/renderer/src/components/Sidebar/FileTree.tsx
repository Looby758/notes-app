import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import {
  ChevronRight,
  Columns2,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  Pencil,
  Star,
  StarOff,
  Trash2
} from 'lucide-react'
import { isStarred, toggleStar, useStarred } from '../../store/starred'
import type { FileNode } from '@shared/types'
import { useVault } from '../../store/vault'
import { displayName, isWithin, parentOf } from '../../lib/paths'
import ContextMenu, { type MenuItem } from '../ContextMenu'
import { focusEditor, openNote, splitPane } from '../../lib/editorController'
import { setDrag } from '../../lib/dnd'
import { useEditor } from '../../store/editor'
import { FILE_MANAGER } from '@shared/platform'

const INDENT = 14
const AUTO_EXPAND_MS = 600

// The item being dragged. dataTransfer contents can't be read during dragover, so it lives here.
let dragging: string | null = null

/** Rows currently visible in the tree, top to bottom (children of collapsed folders excluded). */
function visibleRows(nodes: FileNode[], expanded: Set<string>, out: FileNode[] = []): FileNode[] {
  for (const n of nodes) {
    out.push(n)
    if (n.type === 'folder' && expanded.has(n.path)) visibleRows(n.children ?? [], expanded, out)
  }
  return out
}

function canDrop(source: string | null, folder: string): boolean {
  return source !== null && !isWithin(folder, source) && parentOf(source) !== folder
}

interface MenuState {
  x: number
  y: number
  node: FileNode | null
}

export default function FileTree() {
  const tree = useVault((s) => s.tree)
  const selected = useVault((s) => s.selected)
  // Actions never change, so read them once instead of subscribing to the whole store.
  const { newNote, newFolder, startRename, trash, move } = useVault.getState()
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  const openMenu = (e: MouseEvent, node: FileNode | null): void => {
    e.preventDefault()
    e.stopPropagation()
    if (node) useVault.getState().select(node.path)
    setMenu({ x: e.clientX, y: e.clientY, node })
  }

  const menuItems = (node: FileNode | null): MenuItem[] => {
    const create: MenuItem[] = [
      { label: 'New note', icon: <FilePlus size={15} />, onClick: () => newNote(node?.path ?? '') },
      { label: 'New folder', icon: <FolderPlus size={15} />, onClick: () => newFolder(node?.path ?? '') }
    ]
    if (!node) return create
    const open: MenuItem[] =
      node.type === 'file'
        ? [
            { label: 'Open in new tab', icon: <FileText size={15} />, onClick: () => openNote(node.path) },
            { label: 'Open to the right', icon: <Columns2 size={15} />, onClick: () => splitPane('right', { tab: node.path }) },
            isStarred(node.path)
              ? { label: 'Unstar', icon: <StarOff size={15} />, onClick: () => toggleStar(node.path) }
              : { label: 'Star', icon: <Star size={15} />, onClick: () => toggleStar(node.path) },
            'separator'
          ]
        : []
    const edit: MenuItem[] = [
      ...open,
      { label: 'Rename', icon: <Pencil size={15} />, onClick: () => startRename(node.path) },
      { label: `Show in ${FILE_MANAGER}`, icon: <FolderSearch size={15} />, onClick: () => window.api.reveal(node.path) },
      'separator',
      { label: 'Delete', icon: <Trash2 size={15} />, danger: true, onClick: () => trash(node.path) }
    ]
    return node.type === 'folder' ? [...create, 'separator', ...edit] : edit
  }

  /** ↑ ↓ move, → opens a folder (or steps into it), ← closes it (or goes to its parent), Enter opens. */
  const onKeyDown = (e: KeyboardEvent): void => {
    const { renaming, expanded, select, toggle } = useVault.getState()
    if (renaming) return
    const rows = visibleRows(tree, expanded)
    if (rows.length === 0) return
    const index = rows.findIndex((n) => n.path === selected)
    const node = index === -1 ? null : rows[index]
    const go = (n: FileNode | undefined): void => {
      if (!n) return
      select(n.path)
      document.querySelector(`.tree-row[data-path="${CSS.escape(n.path)}"]`)?.scrollIntoView({ block: 'nearest' })
    }

    switch (e.key) {
      case 'ArrowDown':
        go(rows[Math.min(index + 1, rows.length - 1)])
        break
      case 'ArrowUp':
        go(rows[Math.max(index - 1, 0)])
        break
      case 'Home':
        go(rows[0])
        break
      case 'End':
        go(rows[rows.length - 1])
        break
      case 'ArrowRight':
        if (node?.type !== 'folder') return
        if (!expanded.has(node.path)) toggle(node.path)
        else if (node.children?.length) go(node.children[0])
        break
      case 'ArrowLeft':
        if (!node) return
        if (node.type === 'folder' && expanded.has(node.path)) toggle(node.path)
        else go(rows.find((n) => n.path === parentOf(node.path)))
        break
      case 'Enter':
        if (!node) return
        if (node.type === 'folder') toggle(node.path)
        else openNote(node.path)
        break
      case 'F2':
        if (!node) return
        startRename(node.path)
        break
      case 'Delete':
        if (!node) return
        trash(node.path)
        break
      default:
        return
    }
    e.preventDefault()
  }

  // Dropping on empty space moves the item to the vault root.
  const onRootDragOver = (e: DragEvent): void => {
    if (!canDrop(dragging, '')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTarget('')
  }

  const onDrop = (e: DragEvent, folder: string): void => {
    e.preventDefault()
    e.stopPropagation()
    const source = dragging
    dragging = null
    setDropTarget(null)
    if (source && canDrop(source, folder)) move(source, folder)
  }

  return (
    <div
      className={`tree ${dropTarget === '' ? 'drop-root' : ''}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => openMenu(e, null)}
      onClick={(e) => e.target === e.currentTarget && useVault.getState().select(null)}
      onDragOver={onRootDragOver}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropTarget(null)}
      onDrop={(e) => onDrop(e, '')}
    >
      {tree.length === 0 ? (
        <div className="tree-empty">
          <p>No notes yet</p>
          <button className="btn" onClick={() => newNote('')}>
            <FilePlus size={15} /> Create a note
          </button>
        </div>
      ) : (
        tree.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            depth={0}
            dropTarget={dropTarget}
            setDropTarget={setDropTarget}
            onDrop={onDrop}
            onContextMenu={openMenu}
          />
        ))
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.node)} onClose={closeMenu} />}
    </div>
  )
}

interface NodeProps {
  node: FileNode
  depth: number
  dropTarget: string | null
  setDropTarget: (folder: string | null) => void
  onDrop: (e: DragEvent, folder: string) => void
  onContextMenu: (e: MouseEvent, node: FileNode) => void
}

function TreeNode({ node, depth, dropTarget, setDropTarget, onDrop, onContextMenu }: NodeProps) {
  const isFolder = node.type === 'folder'
  const expanded = useVault((s) => s.expanded.has(node.path))
  const isSelected = useVault((s) => s.selected === node.path)
  const isRenaming = useVault((s) => s.renaming === node.path)
  const starred = useStarred((s) => s.paths.includes(node.path))
  const { toggle, expand, select, startRename } = useVault.getState()
  const expandTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Files accept drops on behalf of the folder they're in.
  const folder = isFolder ? node.path : parentOf(node.path)
  const isDropTarget = isFolder && dropTarget === node.path

  useEffect(() => () => clearTimeout(expandTimer.current), [])

  const onClick = (): void => {
    select(node.path)
    if (isFolder) toggle(node.path)
    else openNote(node.path)
  }

  const onDragStart = (e: DragEvent): void => {
    dragging = node.path
    // Notes can also be dropped onto a pane to open them there (or on its edge to split).
    setDrag(isFolder ? null : { kind: 'note', path: node.path })
    // Reveals drop targets that only matter while a note is being dragged (like "drop here to star").
    // Not straight away: Chromium cancels a drag if the page shifts under it during dragstart.
    const path = node.path
    if (!isFolder) setTimeout(() => dragging === path && document.body.classList.add('dragging-note'), 0)
    // Move into a folder or pane, or "link" when dropped on Starred (each target must be allowed here).
    e.dataTransfer.effectAllowed = 'linkMove'
    e.dataTransfer.setData('text/plain', node.path)
  }

  const onDragOver = (e: DragEvent): void => {
    e.stopPropagation()
    if (!canDrop(dragging, folder)) {
      setDropTarget(null)
      return
    }
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dropTarget !== folder) {
      setDropTarget(folder)
      // Hovering a closed folder while dragging opens it.
      clearTimeout(expandTimer.current)
      if (isFolder && !expanded) expandTimer.current = setTimeout(() => expand(node.path), AUTO_EXPAND_MS)
    }
  }

  return (
    <>
      <div
        data-path={node.path}
        className={`tree-row ${isSelected ? 'selected' : ''} ${isDropTarget ? 'drop' : ''}`}
        style={{ paddingLeft: 8 + depth * INDENT }}
        draggable={!isRenaming}
        onClick={onClick}
        onDoubleClick={() => !isFolder && startRename(node.path)}
        onContextMenu={(e) => onContextMenu(e, node)}
        onDragStart={onDragStart}
        onDragEnd={() => {
          dragging = null
          setDrag(null)
          document.body.classList.remove('dragging-note')
          setDropTarget(null)
        }}
        onDragOver={onDragOver}
        onDragLeave={() => clearTimeout(expandTimer.current)}
        onDrop={(e) => onDrop(e, folder)}
      >
        {isFolder ? (
          <ChevronRight size={14} className={`tree-chevron ${expanded ? 'open' : ''}`} />
        ) : (
          <span className="tree-chevron" />
        )}
        {isFolder ? (
          expanded ? (
            <FolderOpen size={15} className="tree-icon" />
          ) : (
            <Folder size={15} className="tree-icon" />
          )
        ) : (
          <FileText size={15} className="tree-icon" />
        )}
        {isRenaming ? <RenameInput node={node} /> : <span className="tree-label">{displayName(node)}</span>}
        {starred && !isRenaming && <Star size={11} className="tree-star" aria-label="Starred" />}
      </div>
      {isFolder && expanded && (
        <div className="tree-children" style={{ ['--guide-x' as string]: `${15 + depth * INDENT}px` }}>
          {node.children?.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              dropTarget={dropTarget}
              setDropTarget={setDropTarget}
              onDrop={onDrop}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </>
  )
}

function RenameInput({ node }: { node: FileNode }) {
  const { rename, startRename } = useVault.getState()
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const original = displayName(node)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const commit = async (viaEnter = false): Promise<void> => {
    if (done.current) return
    done.current = true
    const value = ref.current?.value.trim() ?? ''
    if (value && value !== original) await rename(node.path, value)
    else startRename(null)
    // After naming a new note with Enter, go straight to writing in it.
    if (viaEnter && node.type === 'file' && useEditor.getState().active) focusEditor()
  }

  return (
    <input
      ref={ref}
      className="tree-rename"
      defaultValue={original}
      spellCheck={false}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') commit(true)
        if (e.key === 'Escape') {
          done.current = true
          startRename(null)
        }
      }}
      onBlur={() => commit()}
    />
  )
}
