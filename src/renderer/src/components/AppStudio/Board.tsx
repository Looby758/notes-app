import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { Bug, Camera, Check, ClipboardCopy, Copy, Image as ImageIcon, Lightbulb, PenLine, Plus, Trash2, X } from 'lucide-react'
import { BOARD_COLUMNS, boardKey, claudePrompt, type BoardColumn, type BoardItem } from '@shared/appStudio'
import { useTerminals, type TerminalProject } from '../../store/terminals'
import { useAppStudio } from '../../store/appStudio'
import {
  cancelEditing,
  changeEditing,
  clearPicked,
  deleteItem,
  editItem,
  finishEditing,
  moveItem,
  setBoardApp,
  startItem,
  togglePicked,
  useAppBoard
} from '../../store/appBoard'
import { usePrefs } from '../../store/prefs'
import { useUI } from '../../store/ui'
import { notify } from '../../store/notify'
import { vaultUrl } from '../../lib/fileKinds'

/** An app as the board sees it: its name, repository (if on GitHub) and the key its items are saved under. */
interface BoardApp {
  project: TerminalProject
  name: string
  repo?: string
  key: string
}

function useBoardApps(): BoardApp[] {
  const projects = useTerminals((s) => s.projects)
  const info = useAppStudio((s) => s.info)
  return useMemo(
    () =>
      projects.map((p) => {
        const repo = info[p.folder]?.repo
        return { project: p, name: p.name, repo, key: boardKey({ name: p.name, repo }) }
      }),
    [projects, info]
  )
}

/** Items belong to an app by its key, or by its name (saved before its repository was known). */
const belongsTo = (item: BoardItem, app: BoardApp): boolean => item.app === app.key || item.app === app.name

/**
 * App Studio's idea board: each app's ideas and bugs in columns (drag cards between them), and
 * "Copy as Claude prompt" to turn one or several into a request to paste into Claude Code.
 */
export default function Board() {
  const apps = useBoardApps()
  const selected = useAppBoard((s) => s.app)
  const items = useAppBoard((s) => s.items)
  const picked = useAppBoard((s) => s.picked)
  const editing = useAppBoard((s) => s.editing)
  const loaded = useAppBoard((s) => s.loaded)
  const app = apps.find((a) => a.key === selected || a.name === selected) ?? apps[0]

  if (!apps.length) return <p className="appstudio-empty">Add an app in My apps first, then its ideas and bugs go here.</p>
  if (!app) return null
  const mine = items.filter((i) => belongsTo(i, app))
  const pickedItems = mine.filter((i) => picked.includes(i.id))

  const copyPrompt = (list: BoardItem[]): void => {
    if (!list.length) return
    void navigator.clipboard
      .writeText(claudePrompt(app, list))
      .then(() => notify(list.some((i) => i.pictures.length) ? 'Copied. Paste it into Claude Code, then copy each picture across too.' : 'Copied. Paste it into Claude Code.', 'info'))
      .catch((err) => notify(err))
  }

  return (
    <div className="board">
      <div className="board-toolbar">
        <div className="board-apps">
          {apps.map((a) => (
            <button key={a.project.id} className={a === app ? 'active' : ''} onClick={() => setBoardApp(a.key)}>
              {a.name}
              <span className="appstudio-count">{items.filter((i) => belongsTo(i, a) && i.column !== 'done').length}</span>
            </button>
          ))}
        </div>
        <span className="board-spacer" />
        {pickedItems.length > 0 ? (
          <>
            <button className="btn btn-primary" onClick={() => copyPrompt(pickedItems)}>
              <ClipboardCopy size={14} /> Copy {pickedItems.length} as Claude prompt
            </button>
            <button className="icon-btn" title="Unpick all" onClick={clearPicked}>
              <X size={14} />
            </button>
          </>
        ) : (
          <span className="board-hint">Tick cards to copy several as one prompt</span>
        )}
        <button className="btn" onClick={() => startItem(app.key, 'idea')}>
          <Lightbulb size={14} /> Idea
        </button>
        <button className="btn" onClick={() => startItem(app.key, 'bug')}>
          <Bug size={14} /> Bug
        </button>
        <button className="btn" title="Snip part of the screen to report a bug (or press the snip shortcut from any app)" onClick={() => void window.api.startSnip()}>
          <Camera size={14} /> Snip a bug
        </button>
      </div>
      {!loaded ? (
        <p className="appstudio-empty">Loading…</p>
      ) : (
        <div className="board-columns">
          {BOARD_COLUMNS.map((c) => (
            <Column key={c.id} column={c.id} label={c.label} items={mine.filter((i) => i.column === c.id)} picked={picked} onCopy={(i) => copyPrompt([i])} />
          ))}
        </div>
      )}
      {editing && <Editor item={editing} apps={apps} onCopy={(i) => copyPrompt([i])} />}
    </div>
  )
}

function Column({ column, label, items, picked, onCopy }: { column: BoardColumn; label: string; items: BoardItem[]; picked: string[]; onCopy: (i: BoardItem) => void }) {
  const [over, setOver] = useState(false)
  const drop = (e: DragEvent, before?: string): void => {
    e.preventDefault()
    e.stopPropagation()
    setOver(false)
    const id = e.dataTransfer.getData('application/x-orbit-board')
    if (id && id !== before) moveItem(id, column, before)
  }
  return (
    <section
      className={`board-column${over ? ' over' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('application/x-orbit-board')) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false)
      }}
      onDrop={(e) => drop(e)}
    >
      <header>
        {label} <span className="appstudio-count">{items.length}</span>
      </header>
      <div className="board-cards">
        {items.map((i) => (
          <Card key={i.id} item={i} picked={picked.includes(i.id)} onDrop={(e) => drop(e, i.id)} onCopy={() => onCopy(i)} />
        ))}
        {!items.length && <p className="board-column-empty">{column === 'ideas' ? 'New ideas and bugs land here' : 'Drag cards here'}</p>}
      </div>
    </section>
  )
}

function Card({ item, picked, onDrop, onCopy }: { item: BoardItem; picked: boolean; onDrop: (e: DragEvent) => void; onCopy: () => void }) {
  return (
    <article
      className={`board-card ${item.kind}${picked ? ' picked' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-orbit-board', item.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-orbit-board')) e.preventDefault()
      }}
      onDrop={onDrop}
      onClick={() => editItem(item)}
    >
      <div className="board-card-top">
        <input
          type="checkbox"
          checked={picked}
          title="Pick for a prompt with several"
          onClick={(e) => e.stopPropagation()}
          onChange={() => togglePicked(item.id)}
        />
        {item.kind === 'bug' ? <Bug size={13} className="board-kind bug" /> : <Lightbulb size={13} className="board-kind idea" />}
        <span className="board-card-title">{item.title}</span>
        <button
          className="icon-btn board-card-copy"
          title="Copy as Claude prompt"
          onClick={(e) => {
            e.stopPropagation()
            onCopy()
          }}
        >
          <ClipboardCopy size={13} />
        </button>
      </div>
      {item.details && <p className="board-card-details">{item.details}</p>}
      {item.pictures.length > 0 && (
        <div className="board-card-pictures">
          {item.pictures.slice(0, 3).map((p) => (
            <img key={p} src={vaultUrl(p)} alt="" draggable={false} />
          ))}
          {item.pictures.length > 3 && <span>+{item.pictures.length - 3}</span>}
        </div>
      )}
    </article>
  )
}

/** Turns a picture from the notes folder (a screenshot, or a sketch's SVG) into a PNG for the clipboard. */
async function pictureAsPng(path: string): Promise<Blob> {
  const blob = await (await fetch(vaultUrl(path))).blob()
  if (blob.type === 'image/png') return blob
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || 1200
    canvas.height = img.naturalHeight || 800
    const ctx = canvas.getContext('2d')!
    // Sketches are drawn on a see-through page; Claude sees them better on white.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    if (!png) throw new Error('Couldn’t copy that picture.')
    return png
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function copyPicture(path: string): Promise<void> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': await pictureAsPng(path) })])
    notify('Picture copied. Paste it into Claude Code.', 'info')
  } catch (err) {
    notify(err)
  }
}

const pictureName = (kind: string, ext: string): string => `${kind}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`

function Editor({ item, apps, onCopy }: { item: BoardItem; apps: BoardApp[]; onCopy: (i: BoardItem) => void }) {
  const folder = usePrefs((s) => s.prefs.attachmentFolder)
  const isNew = !useAppBoard((s) => s.items.some((i) => i.id === item.id))
  const title = useRef<HTMLInputElement>(null)
  const details = useRef<HTMLTextAreaElement>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    // A new bug from the snip already has its picture: straight to saying what's wrong.
    ;(item.title ? details : title).current?.focus()
    // Only when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !useUI.getState().sketch) {
        e.preventDefault()
        finishEditing()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const addPicture = (path: string): void => {
    const now = useAppBoard.getState().editing
    if (now) changeEditing({ pictures: [...now.pictures, path] })
  }

  // Pasting a picture into the details adds it.
  const paste = async (e: ClipboardEvent): Promise<void> => {
    const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'))
    if (!file) return
    e.preventDefault()
    try {
      const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/gif' ? 'gif' : 'png'
      addPicture(await window.api.saveAttachment(folder, pictureName(item.kind, ext), new Uint8Array(await file.arrayBuffer())))
    } catch (err) {
      notify(err)
    }
  }

  const sketch = (): void => useUI.setState({ sketch: { path: null, onSaved: addPicture } })

  return (
    <div
      className="board-editor-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) finishEditing()
      }}
    >
      <div className="board-editor" role="dialog" aria-label={item.kind === 'bug' ? 'Bug' : 'Idea'}>
        <div className="board-editor-top">
          <div className="board-kind-toggle">
            <button className={item.kind === 'idea' ? 'active' : ''} onClick={() => changeEditing({ kind: 'idea' })}>
              <Lightbulb size={13} /> Idea
            </button>
            <button className={item.kind === 'bug' ? 'active bug' : ''} onClick={() => changeEditing({ kind: 'bug' })}>
              <Bug size={13} /> Bug
            </button>
          </div>
          <select className="board-select" value={apps.find((a) => a.key === item.app || a.name === item.app)?.key ?? item.app} onChange={(e) => changeEditing({ app: e.target.value })} title="Which app">
            {apps.map((a) => (
              <option key={a.project.id} value={a.key}>
                {a.name}
              </option>
            ))}
          </select>
          <select className="board-select" value={item.column} onChange={(e) => changeEditing({ column: e.target.value as BoardColumn })} title="Column">
            {BOARD_COLUMNS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <span className="board-spacer" />
          <button className="icon-btn" title="Close (Esc)" onClick={finishEditing}>
            <X size={15} />
          </button>
        </div>
        <input
          ref={title}
          className="board-editor-title"
          placeholder={item.kind === 'bug' ? 'What’s wrong? e.g. The save button does nothing' : 'What’s the idea? e.g. Dark mode'}
          value={item.title}
          onChange={(e) => changeEditing({ title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              details.current?.focus()
            }
          }}
        />
        <textarea
          ref={details}
          className="board-editor-details"
          placeholder={
            item.kind === 'bug'
              ? 'More detail for Claude: what you did, what happened, what should have happened. Paste screenshots here too.'
              : 'More detail for Claude: how it should work and look. Paste pictures here too.'
          }
          value={item.details}
          onChange={(e) => changeEditing({ details: e.target.value })}
          onPaste={(e) => void paste(e)}
          rows={6}
        />
        <div className="board-editor-pictures">
          {item.pictures.map((p) => (
            <figure key={p}>
              <img src={vaultUrl(p)} alt="" />
              <div className="board-picture-actions">
                <button className="icon-btn" title="Copy picture (to paste into Claude Code)" onClick={() => void copyPicture(p)}>
                  <Copy size={13} />
                </button>
                <button className="icon-btn" title="Take off (the file stays in your attachments)" onClick={() => changeEditing({ pictures: item.pictures.filter((x) => x !== p) })}>
                  <X size={13} />
                </button>
              </div>
            </figure>
          ))}
          <button className="board-add-picture" onClick={sketch} title="Draw a rough layout of a screen">
            <PenLine size={16} />
            Sketch a screen
          </button>
          <div className="board-add-picture muted" title="Copy a picture, then paste it into the details box">
            <ImageIcon size={16} />
            Paste a picture into the details
          </div>
        </div>
        <div className="board-editor-actions">
          <button className="btn btn-primary" disabled={!item.title.trim()} onClick={() => onCopy(item)}>
            <ClipboardCopy size={14} /> Copy as Claude prompt
          </button>
          <span className="board-spacer" />
          {!isNew && (
            <button
              className={`btn${confirmDelete ? ' appstudio-confirm-danger' : ''}`}
              onClick={() => (confirmDelete ? deleteItem(item.id) : setConfirmDelete(true))}
              onBlur={() => setConfirmDelete(false)}
            >
              <Trash2 size={14} /> {confirmDelete ? 'Delete it?' : 'Delete'}
            </button>
          )}
          {isNew && (
            <button className="btn" onClick={cancelEditing}>
              Cancel
            </button>
          )}
          <button className="btn btn-primary" disabled={!item.title.trim()} onClick={finishEditing}>
            {isNew ? (
              <>
                <Plus size={14} /> Add
              </>
            ) : (
              <>
                <Check size={14} /> Done
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
