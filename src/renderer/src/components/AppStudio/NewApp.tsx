import { useState, type FormEvent } from 'react'
import { AppWindow, FolderOpen, Gamepad2, Globe, Loader2, Sparkles, FileText, X } from 'lucide-react'
import { appNameProblem, appSlug, firstCard, firstRunCommand, STARTERS, type StarterId } from '@shared/appStarters'
import { boardKey } from '@shared/appStudio'
import { isClaudeLink } from '@shared/chatSites'
import { IS_MAC } from '@shared/platform'
import { addProject, updateProject } from '../../store/terminals'
import { refreshApps, setSection, useAppStudio } from '../../store/appStudio'
import { addItem, setBoardApp, setClaudeLink } from '../../store/appBoard'
import { runProjectCommand } from '../../lib/terminal'
import { notify } from '../../store/notify'
import { errorMessage } from '../../lib/paths'

const ICONS: Record<StarterId, typeof Globe> = { desktop: AppWindow, website: Globe, game: Gamepad2, blank: FileText }
const PARENT_KEY = 'appstudio:newAppFolder'
const IS_WINDOWS = !IS_MAC && /win/i.test(navigator.platform)

/**
 * "Start a new app": pick a starter, name it and say what it's for. App Studio makes the folder
 * with the starter's files, saves the first version in git, makes its GitHub repository (if GitHub
 * is connected), adds it to My apps, and puts "Build the first version" on its board, ready to
 * send to Claude.
 */
export default function NewApp({ close }: { close: () => void }) {
  const github = useAppStudio((s) => s.github)
  const [starter, setStarter] = useState<StarterId>('desktop')
  const [name, setName] = useState('')
  const [what, setWhat] = useState('')
  const [parent, setParent] = useState<string>(() => {
    try {
      return localStorage.getItem(PARENT_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [repo, setRepo] = useState<'private' | 'public' | null>(github?.connected ? 'private' : null)
  const [claude, setClaude] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const slug = appSlug(name)
  const nameProblem = name ? appNameProblem(name) : null
  const claudeProblem = claude.trim() && !isClaudeLink(claude) ? 'That isn’t a claude.ai link.' : null

  const pickParent = async (): Promise<void> => {
    const folder = await window.api.terminalPickFolder().catch(() => null)
    if (folder) setParent(folder)
  }

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (busy || appNameProblem(name) || !parent || claudeProblem) return
    setBusy(true)
    setError('')
    try {
      const made = await window.api.appsCreateApp({ parent, name: name.trim(), starter, what, github: repo })
      try {
        localStorage.setItem(PARENT_KEY, parent)
      } catch {
        // Asked again next time.
      }
      const project = addProject(made.folder)
      updateProject(project.id, { name: name.trim() })
      const key = boardKey({ name: name.trim(), repo: made.repo })
      if (claude.trim()) setClaudeLink(key, claude)
      const card = firstCard(name, what, starter)
      addItem(key, 'idea', card.title, card.details)
      setBoardApp(key)
      const first = firstRunCommand(IS_WINDOWS, !!made.repo, starter !== 'blank')
      if (first) runProjectCommand({ ...project, name: name.trim() }, first)
      void refreshApps()
      setSection('board')
      notify(
        made.githubError
          ? `Made ${name.trim()}, but not its GitHub repository: ${made.githubError}`
          : `Made ${name.trim()}${made.repo ? ` and ${made.repo} on GitHub` : ''}. Its first card is on the board, ready to send to Claude.`,
        made.githubError ? 'error' : 'info'
      )
      close()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && close()}>
      <form className="modal newapp" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !busy && close()} onSubmit={(e) => void submit(e)}>
        <div className="newapp-head">
          <h3>
            <Sparkles size={16} /> Start a new app
          </h3>
          <button type="button" className="icon-btn" title="Close" onClick={close} disabled={busy}>
            <X size={15} />
          </button>
        </div>
        <div className="newapp-starters" role="radiogroup" aria-label="Starter">
          {STARTERS.map((s) => {
            const Icon = ICONS[s.id]
            return (
              <button key={s.id} type="button" role="radio" aria-checked={s.id === starter} className={s.id === starter ? 'active' : ''} onClick={() => setStarter(s.id)} title={s.hint}>
                <Icon size={18} />
                <strong>{s.label}</strong>
                <span>{s.hint}</span>
              </button>
            )
          })}
        </div>
        <label className="newapp-field">
          <span>Name</span>
          <input className="text-input" autoFocus value={name} placeholder="e.g. Star Hopper" onChange={(e) => setName(e.target.value)} maxLength={60} />
          {nameProblem ? <em className="newapp-problem">{nameProblem}</em> : slug && <em className="muted">Folder and repository: {slug}</em>}
        </label>
        <label className="newapp-field">
          <span>What’s it for?</span>
          <textarea className="text-input" rows={3} value={what} placeholder="A sentence or two. It goes in its README, in CLAUDE.md for Claude, and on its first card." onChange={(e) => setWhat(e.target.value)} />
        </label>
        <div className="newapp-field">
          <span>Put it in</span>
          <div className="newapp-folder">
            <span className={parent ? 'newapp-path' : 'newapp-path muted'} title={parent}>
              {parent ? `${parent}${parent.includes('\\') ? '\\' : '/'}${slug || '…'}` : 'No folder picked'}
            </span>
            <button type="button" className="btn" onClick={() => void pickParent()}>
              <FolderOpen size={13} /> {parent ? 'Change' : 'Pick a folder'}
            </button>
          </div>
        </div>
        <div className="newapp-field">
          <span>GitHub</span>
          {github?.connected ? (
            <div className="newapp-choice">
              {(['private', 'public', null] as const).map((v) => (
                <button key={String(v)} type="button" className={repo === v ? 'active' : ''} onClick={() => setRepo(v)}>
                  {v === 'private' ? 'Private repository' : v === 'public' ? 'Public repository' : 'Not now'}
                </button>
              ))}
            </div>
          ) : (
            <em className="muted">Connect GitHub (in Pull requests) and App Studio makes its repository too. You can still start it now.</em>
          )}
        </div>
        <label className="newapp-field">
          <span>Claude project (optional)</span>
          <input className="text-input" value={claude} placeholder="https://claude.ai/project/…" onChange={(e) => setClaude(e.target.value)} />
          {claudeProblem && <em className="newapp-problem">{claudeProblem}</em>}
        </label>
        {error && <div className="appstudio-error">{error}</div>}
        <div className="newapp-actions">
          <span className="muted">Then it runs {repo && github?.connected ? 'the first push and ' : ''}npm install in its terminal.</span>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || !!appNameProblem(name) || !parent || !!claudeProblem}>
            {busy ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Start {name.trim() || 'it'}
          </button>
        </div>
      </form>
    </div>
  )
}
