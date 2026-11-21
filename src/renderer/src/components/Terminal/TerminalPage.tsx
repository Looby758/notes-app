import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, FolderOpen, Pencil, Pin, Play, Plus, RotateCcw, Search, Square, PanelRight, Trash2, X } from 'lucide-react'
import { attachTerminal, closeTerminal, newTerminal, restartTerminal, runInActive, runProjectCommand, stopTerminal } from '../../lib/terminal'
import { addProject, forgetCommand, removeProject, setActiveTerminal, setPanel, updateProject, updateTerminal, useTerminals, type TerminalProject } from '../../store/terminals'
import { commandBlank, commandLabel, fillCommand } from '@shared/terminalTools'
import { notify } from '../../store/notify'

/**
 * The Terminal tab: command lines (several at once, in a strip along the top) and the Run panel
 * beside them, with each project's run buttons and the commands you've run before.
 */
export default function TerminalPage() {
  const host = useRef<HTMLDivElement>(null)
  const panel = useTerminals((s) => s.panel)
  useEffect(() => attachTerminal(host.current!), [])
  return (
    <div className="terminal-page">
      <TerminalBar />
      <div className="terminal-body">
        <div ref={host} className="terminal-host" />
        {panel && <RunPanel />}
      </div>
    </div>
  )
}

function TerminalBar() {
  const terminals = useTerminals((s) => s.terminals)
  const active = useTerminals((s) => s.active)
  const panel = useTerminals((s) => s.panel)
  const [renaming, setRenaming] = useState<string | null>(null)
  const current = terminals.find((t) => t.id === active)
  return (
    <div className="terminal-bar">
      <div className="terminal-chips">
        {terminals.map((t) => (
          <div
            key={t.id}
            className={`terminal-chip${t.id === active ? ' active' : ''}`}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                closeTerminal(t.id)
              }
            }}
            onClick={() => setActiveTerminal(t.id)}
            onDoubleClick={() => setRenaming(t.id)}
            title={`${t.running ? 'Running' : 'Ended'}${t.folder ? ` · ${t.folder}` : ' · notes folder'}${t.command ? ` · ${t.command}` : ''}\nDouble-click to rename`}
          >
            <span className={`terminal-dot${t.running ? ' on' : ''}`} />
            {renaming === t.id ? (
              <input
                className="terminal-chip-rename"
                autoFocus
                defaultValue={t.name}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  const name = e.currentTarget.value.trim()
                  if (name) updateTerminal(t.id, { name })
                  setRenaming(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    setRenaming(null)
                  }
                }}
              />
            ) : (
              <span className="terminal-chip-name">{t.name}</span>
            )}
            {t.errors > 0 && (
              <span className="terminal-chip-errors" title={`${t.errors} error line${t.errors === 1 ? '' : 's'} since you last looked`}>
                {t.errors > 99 ? '99+' : t.errors}
              </span>
            )}
            <button
              className="terminal-chip-close"
              title="Close (ends what's running in it)"
              onClick={(e) => {
                e.stopPropagation()
                closeTerminal(t.id)
              }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button className="icon-btn" title="New terminal (in the notes folder)" onClick={() => newTerminal()}>
          <Plus size={15} />
        </button>
      </div>
      {current && (
        <div className="terminal-actions">
          <button className="icon-btn" title="Stop (ends this command line and what's running in it)" disabled={!current.running} onClick={() => stopTerminal(current.id)}>
            <Square size={13} />
          </button>
          <button className="icon-btn" title={current.command ? `Restart (runs ${current.command} again)` : 'Restart (a fresh command line)'} onClick={() => restartTerminal(current.id)}>
            <RotateCcw size={14} />
          </button>
        </div>
      )}
      <button className={`icon-btn${panel ? ' active' : ''}`} title={panel ? 'Hide the Run panel' : 'Show the Run panel (projects and past commands)'} onClick={() => setPanel(!panel)}>
        <PanelRight size={15} />
      </button>
    </div>
  )
}

function RunPanel() {
  const projects = useTerminals((s) => s.projects)
  const add = async (): Promise<void> => {
    try {
      const folder = await window.api.terminalPickFolder()
      if (folder) addProject(folder)
    } catch (err) {
      notify(err)
    }
  }
  return (
    <aside className="terminal-panel">
      <div className="terminal-panel-head">
        <span>Projects</span>
        <button className="icon-btn" title="Add a project (pick its folder)" onClick={() => void add()}>
          <Plus size={15} />
        </button>
      </div>
      {projects.length === 0 && (
        <div className="terminal-panel-empty">
          <p>Add an app you’re working on, like Eclipse, to get one-click buttons for npm install, npm run dev, git pull and more, always run in its folder.</p>
          <button className="btn btn-primary" onClick={() => void add()}>
            <FolderOpen size={14} /> Pick its folder
          </button>
        </div>
      )}
      {projects.map((p) => (
        <ProjectCard key={p.id} project={p} />
      ))}
      <History />
    </aside>
  )
}

function ProjectCard({ project }: { project: TerminalProject }) {
  const [editing, setEditing] = useState(false)
  const [asking, setAsking] = useState<string | null>(null)
  const [newCommand, setNewCommand] = useState('')

  const run = (command: string): void => {
    if (commandBlank(command)) setAsking(asking === command ? null : command)
    else runProjectCommand(project, command)
  }

  const addCommand = (): void => {
    const c = newCommand.trim()
    if (!c) return
    if (!project.commands.includes(c)) updateProject(project.id, { commands: [...project.commands, c] })
    setNewCommand('')
  }

  const changeFolder = async (): Promise<void> => {
    try {
      const folder = await window.api.terminalPickFolder()
      if (folder) updateProject(project.id, { folder })
    } catch (err) {
      notify(err)
    }
  }

  return (
    <section className="terminal-project">
      <div className="terminal-project-head">
        {editing ? (
          <input
            className="text-input terminal-project-name-input"
            defaultValue={project.name}
            onBlur={(e) => {
              const name = e.currentTarget.value.trim()
              if (name) updateProject(project.id, { name })
            }}
          />
        ) : (
          <span className="terminal-project-name">{project.name}</span>
        )}
        <button className={`icon-btn${editing ? ' active' : ''}`} title={editing ? 'Done' : 'Edit this project'} onClick={() => setEditing(!editing)}>
          {editing ? <Check size={14} /> : <Pencil size={13} />}
        </button>
      </div>
      <div className="terminal-project-folder" title={project.folder}>
        {shortFolder(project.folder)}
      </div>
      {editing ? (
        <>
          <ul className="terminal-command-list">
            {project.commands.map((c) => (
              <li key={c}>
                <code>{c}</code>
                <button className="icon-btn" title="Remove this button" onClick={() => updateProject(project.id, { commands: project.commands.filter((x) => x !== c) })}>
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
          <form
            className="terminal-add-command"
            onSubmit={(e) => {
              e.preventDefault()
              addCommand()
            }}
          >
            <input className="text-input" placeholder="Add a command, e.g. npm test" value={newCommand} onChange={(e) => setNewCommand(e.target.value)} />
          </form>
          <p className="terminal-hint">Put a word in curly brackets, like {'{branch}'}, to fill it in each time.</p>
          <div className="terminal-project-edit-actions">
            <button className="link-button" onClick={() => void changeFolder()}>
              Change folder
            </button>
            <button
              className="link-button danger"
              onClick={() => {
                removeProject(project.id)
              }}
            >
              <Trash2 size={12} /> Remove project
            </button>
          </div>
        </>
      ) : (
        <div className="terminal-run-buttons">
          {project.commands.map((c) => (
            <button key={c} className={`terminal-run-btn${asking === c ? ' active' : ''}`} title={`Run ${c} in ${project.name}`} onClick={() => run(c)}>
              <Play size={11} />
              <span>{commandLabel(c)}</span>
            </button>
          ))}
        </div>
      )}
      {asking && !editing && (
        <form
          className="terminal-fill"
          onSubmit={(e) => {
            e.preventDefault()
            const value = new FormData(e.currentTarget).get('value')?.toString().trim()
            if (!value) return
            runProjectCommand(project, fillCommand(asking, value))
            setAsking(null)
          }}
        >
          <input
            name="value"
            className="text-input"
            autoFocus
            placeholder={/^git\s+checkout/.test(asking) ? 'Paste a branch name or GitHub link' : commandBlank(asking) ?? ''}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setAsking(null)
              }
            }}
          />
          <button className="btn btn-primary" type="submit">
            Run
          </button>
        </form>
      )}
    </section>
  )
}

function History() {
  const history = useTerminals((s) => s.history)
  const projects = useTerminals((s) => s.projects)
  const active = useTerminals((s) => s.terminals.find((t) => t.id === s.active))
  const [query, setQuery] = useState('')
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (q ? history.filter((h) => h.toLowerCase().includes(q)) : history).slice(0, 40)
  }, [history, query])
  // Pinning adds a run button to the project of the terminal you're in (or the first project).
  const pinTo = projects.find((p) => p.id === active?.projectId) ?? projects[0]
  if (!history.length) return null
  return (
    <section className="terminal-history">
      <div className="terminal-panel-head">
        <span>Past commands</span>
      </div>
      <label className="terminal-history-search">
        <Search size={13} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search past commands" />
      </label>
      <ul>
        {shown.map((h) => (
          <li key={h}>
            <button className="terminal-history-run" title={`Run in ${active?.name ?? 'this terminal'}`} onClick={() => runInActive(h)}>
              <code>{h}</code>
            </button>
            {pinTo && !pinTo.commands.includes(h) && (
              <button className="icon-btn" title={`Save as a button in ${pinTo.name}`} onClick={() => updateProject(pinTo.id, { commands: [...pinTo.commands, h] })}>
                <Pin size={12} />
              </button>
            )}
            <button className="icon-btn" title="Forget" onClick={() => forgetCommand(h)}>
              <X size={12} />
            </button>
          </li>
        ))}
        {!shown.length && <li className="terminal-hint">Nothing matches.</li>}
      </ul>
    </section>
  )
}

/** The end of a long folder path (the part that says which app it is). */
function shortFolder(folder: string): string {
  return folder.length > 36 ? `…${folder.slice(-35)}` : folder
}
