import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { Asterisk, Bug, Camera, Check, ClipboardCopy, Copy, ExternalLink, GitPullRequest, Image as ImageIcon, Lightbulb, Link2, PenLine, Plus, Send, Trash2, X } from 'lucide-react'
import { BOARD_COLUMNS, boardKey, claudePrompt, type BoardColumn, type BoardItem } from '@shared/appStudio'
import { isClaudeLink } from '@shared/chatSites'
import { openSiteTab } from '../ChatSite/ChatSite'
import { useChatSites } from '../../store/grok'
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
  sendToClaude,
  setBoardApp,
  setClaudeLink,
  startItem,
  togglePicked,
  useAppBoard
} from '../../store/appBoard'
import { usePrefs } from '../../store/prefs'
import { useUI } from '../../store/ui'
import { notify } from '../../store/notify'
import { vaultUrl } from '../../lib/fileKinds'
import { pictureAsPng } from '../../lib/boardPictures'

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
  const claudeLink = useAppBoard((s) => (app ? s.claude[app.key] : undefined))
  // Asking for the app's Claude project link (then sending these, if any).
  const [asking, setAsking] = useState<BoardItem[] | null>(null)

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

  const send = (list: BoardItem[]): void => {
    if (!list.length) return
    if (!claudeLink) {
      setAsking(list)
      return
    }
    void sendToClaude(app.key, app, list)
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
            <button className="btn btn-primary" onClick={() => send(pickedItems)} title="Opens Claude with these in one prompt">
              <Send size={14} /> Send {pickedItems.length} to Claude
            </button>
            <button className="btn" onClick={() => copyPrompt(pickedItems)}>
              <ClipboardCopy size={14} /> Copy {pickedItems.length} as Claude prompt
            </button>
            <button className="icon-btn" title="Unpick all" onClick={clearPicked}>
              <X size={14} />
            </button>
          </>
        ) : (
          <span className="board-hint">Tick cards to send several as one prompt</span>
        )}
        <button className={`btn${claudeLink ? '' : ' muted'}`} onClick={() => setAsking([])} title={claudeLink ? `${app.name}’s Claude project: ${claudeLink}` : `Set ${app.name}’s Claude project, where Send to Claude goes`}>
          <Asterisk size={14} /> {claudeLink ? 'Claude project' : 'Set Claude project'}
        </button>
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
            <Column key={c.id} column={c.id} label={c.label} items={mine.filter((i) => i.column === c.id)} picked={picked} onCopy={(i) => copyPrompt([i])} onSend={(i) => send([i])} />
          ))}
        </div>
      )}
      {editing && (
        <Editor
          item={editing}
          apps={apps}
          onCopy={(i) => copyPrompt([i])}
          onSend={(i) => {
            finishEditing()
            const saved = useAppBoard.getState().items.find((x) => x.id === i.id)
            if (saved) send([saved])
          }}
        />
      )}
      {asking && (
        <ClaudeLinkDialog
          app={app}
          link={claudeLink}
          sending={asking.length}
          onClose={() => setAsking(null)}
          onSave={(url) => {
            setClaudeLink(app.key, url)
            const list = asking
            setAsking(null)
            if (url && list.length) void sendToClaude(app.key, app, list)
          }}
        />
      )}
    </div>
  )
}

function Column({
  column,
  label,
  items,
  picked,
  onCopy,
  onSend
}: {
  column: BoardColumn
  label: string
  items: BoardItem[]
  picked: string[]
  onCopy: (i: BoardItem) => void
  onSend: (i: BoardItem) => void
}) {
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
          <Card key={i.id} item={i} picked={picked.includes(i.id)} onDrop={(e) => drop(e, i.id)} onCopy={() => onCopy(i)} onSend={() => onSend(i)} />
        ))}
        {!items.length && <p className="board-column-empty">{column === 'ideas' ? 'New ideas and bugs land here' : 'Drag cards here'}</p>}
      </div>
    </section>
  )
}

function Card({ item, picked, onDrop, onCopy, onSend }: { item: BoardItem; picked: boolean; onDrop: (e: DragEvent) => void; onCopy: () => void; onSend: () => void }) {
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
        <button
          className="icon-btn board-card-copy"
          title={item.sentAt ? 'Send to Claude again' : 'Send to Claude'}
          onClick={(e) => {
            e.stopPropagation()
            onSend()
          }}
        >
          <Send size={13} />
        </button>
      </div>
      {item.details && <p className="board-card-details">{item.details}</p>}
      {(item.pull || item.sentAt) && (
        <div className="board-card-status">
          {item.pull ? (
            <a href={`https://github.com/${item.pull.replace('#', '/pull/')}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Claude’s pull request for this">
              <GitPullRequest size={12} /> #{item.pull.split('#')[1]}
            </a>
          ) : (
            <span title={`Sent ${new Date(item.sentAt!).toLocaleString()}`}>
              <Send size={11} /> Sent to Claude
            </span>
          )}
        </div>
      )}
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

export async function copyPicture(path: string): Promise<void> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': await pictureAsPng(path) })])
    notify('Picture copied.', 'info')
  } catch (err) {
    notify(err)
  }
}

const pictureName = (kind: string, ext: string): string => `${kind}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`

function Editor({ item, apps, onCopy, onSend }: { item: BoardItem; apps: BoardApp[]; onCopy: (i: BoardItem) => void; onSend: (i: BoardItem) => void }) {
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
          <button className="btn btn-primary" disabled={!item.title.trim()} onClick={() => onSend(item)} title="Opens the app’s Claude project with this as the prompt">
            <Send size={14} /> Send to Claude
          </button>
          <button className="btn" disabled={!item.title.trim()} onClick={() => onCopy(item)}>
            <ClipboardCopy size={14} /> Copy prompt
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

/** Asks for an app's Claude project link: where Send to Claude opens. */
function ClaudeLinkDialog({ app, link, sending, onClose, onSave }: { app: BoardApp; link?: string; sending: number; onClose: () => void; onSave: (url: string) => void }) {
  const [url, setUrl] = useState(link ?? '')
  const current = useChatSites((s) => s.claude.url)
  const onProject = /^https:\/\/claude\.ai\/project\//.test(current)
  const ok = !url.trim() || isClaudeLink(url)
  return (
    <div
      className="board-editor-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="board-editor board-link-dialog" role="dialog" aria-label="Claude project">
        <div className="board-editor-top">
          <strong>
            <Asterisk size={14} /> {app.name}’s Claude project
          </strong>
          <span className="board-spacer" />
          <button className="icon-btn" title="Close" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <p className="muted">
          Send to Claude opens this inside Orbit with your ideas and bugs as the message. Open the project on claude.ai and copy its address (it starts with
          claude.ai/project/).
        </p>
        <input
          className="board-editor-title"
          placeholder="https://claude.ai/project/…"
          value={url}
          autoFocus
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && ok) onSave(url)
            if (e.key === 'Escape') onClose()
          }}
        />
        {!ok && <p className="appstudio-error">That isn’t a claude.ai link.</p>}
        <div className="board-editor-actions">
          <button className="btn" onClick={() => openSiteTab('claude')} title="Open Claude in Orbit to find the project">
            <ExternalLink size={14} /> Open Claude
          </button>
          {onProject && current !== url && (
            <button className="btn" onClick={() => setUrl(current)} title={current}>
              <Link2 size={14} /> Use the project Claude is on
            </button>
          )}
          <span className="board-spacer" />
          <button className="btn btn-primary" disabled={!ok} onClick={() => onSave(url)}>
            {sending ? (
              <>
                <Send size={14} /> Save and send
              </>
            ) : (
              <>
                <Check size={14} /> Save
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
