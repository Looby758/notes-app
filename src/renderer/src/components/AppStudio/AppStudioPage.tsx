import { useEffect, useState } from 'react'
import {
  Code,
  ExternalLink,
  FolderOpen,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Loader2,
  Plus,
  RefreshCw,
  Rocket,
  SquareTerminal,
  Hammer,
  Pencil,
  Trash2,
  X,
  FlaskConical,
  Copy as CopyIcon,
  Play,
  ChevronDown
} from 'lucide-react'
import { boardKey, pullKey, prSummary, timeAgo, type PullRequest, type TestCopy } from '@shared/appStudio'
import { FILE_MANAGER } from '@shared/platform'
import { addProject, removeProject, updateProject, useTerminals, type TerminalProject } from '../../store/terminals'
import { appRepos, dropPull, makeCopy, refreshApps, refreshGithub, refreshPulls, removeCopy, setGithub, setSection, useAppStudio } from '../../store/appStudio'
import { closeCopyTerminals, getLatestAndRun, runTestCopy, tryBranch } from '../../lib/terminal'
import { openSpecialTab, TERMINAL_TAB } from '../../lib/editorController'
import { notify } from '../../store/notify'
import { linkPull, useAppBoard } from '../../store/appBoard'
import Board from './Board'
import Releases from './Releases'
import Screenshots from './Screenshots'

/** Pull requests are fetched again when you come back after this long. */
const PULLS_FRESH_MS = 2 * 60_000

/**
 * App Studio: the apps you make with Claude Code. "My apps" has a card for each (what branch it's
 * on, its last change, its open pull requests and its buttons); "Pull requests" lists what Claude
 * has opened on them, to try, merge or close.
 */
export default function AppStudioPage() {
  const section = useAppStudio((s) => s.section)
  const pulls = useAppStudio((s) => s.pulls)
  const projects = useTerminals((s) => s.projects)
  const openItems = useAppBoard((s) => s.items.filter((i) => i.column !== 'done').length)

  useEffect(() => {
    void refreshGithub()
  }, [])
  // The apps are read again whenever the list of them changes (and on opening the page).
  useEffect(() => {
    void refreshApps().then(() => {
      if (Date.now() - useAppStudio.getState().pullsAt > PULLS_FRESH_MS) void refreshPulls()
    })
  }, [projects])

  const refresh = (): void => {
    void refreshApps().then(refreshPulls)
  }
  const loading = useAppStudio((s) => s.loadingApps || s.loadingPulls)

  return (
    <div className="appstudio-page">
      <div className="appstudio-inner">
        <header className="appstudio-head">
          <div>
            <h2>
              <Hammer size={20} /> App Studio
            </h2>
            <p>The apps you make with Claude Code: try what Claude made, merge it, and run your apps.</p>
          </div>
          <button className="icon-btn" title="Check again" onClick={refresh} disabled={loading}>
            {loading ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
          </button>
        </header>
        <TestCopyNote />
        <nav className="appstudio-tabs">
          <button className={section === 'apps' ? 'active' : ''} onClick={() => setSection('apps')}>
            My apps <span className="appstudio-count">{projects.length}</span>
          </button>
          <button className={section === 'board' ? 'active' : ''} onClick={() => setSection('board')}>
            Ideas &amp; bugs {openItems > 0 && <span className="appstudio-count">{openItems}</span>}
          </button>
          <button className={section === 'pulls' ? 'active' : ''} onClick={() => setSection('pulls')}>
            Pull requests {pulls.length > 0 && <span className="appstudio-count accent">{pulls.length}</span>}
          </button>
          <button className={section === 'shots' ? 'active' : ''} onClick={() => setSection('shots')}>
            Screenshots
          </button>
          <button className={section === 'releases' ? 'active' : ''} onClick={() => setSection('releases')}>
            Releases
          </button>
        </nav>
        {section === 'apps' ? <MyApps /> : section === 'board' ? <Board /> : section === 'releases' ? <Releases /> : section === 'shots' ? <Screenshots /> : <PullInbox />}
      </div>
    </div>
  )
}

async function addApp(): Promise<void> {
  try {
    const folder = await window.api.terminalPickFolder()
    if (folder) addProject(folder)
  } catch (err) {
    notify(err)
  }
}

function MyApps() {
  const projects = useTerminals((s) => s.projects)
  return (
    <div className="appstudio-grid">
      {projects.map((p) => (
        <AppCard key={p.id} project={p} />
      ))}
      <button className="appstudio-add" onClick={() => void addApp()}>
        <Plus size={18} />
        <strong>Add an app</strong>
        <span>Pick the folder of an app you’re making, like Eclipse or Orbit.</span>
      </button>
    </div>
  )
}

function AppCard({ project }: { project: TerminalProject }) {
  const info = useAppStudio((s) => s.info[project.folder])
  const allPulls = useAppStudio((s) => s.pulls)
  const pulls = info?.repo ? allPulls.filter((p) => p.repo === info.repo) : []
  const open = (where: 'files' | 'vscode'): void => {
    window.api.terminalOpenIn(project.folder, where).catch((err) => notify(err))
  }
  const [renaming, setRenaming] = useState(false)
  const [removing, setRemoving] = useState(false)
  return (
    <section className="appstudio-card">
      <div className="appstudio-card-top">
        {renaming ? (
          <input
            className="text-input appstudio-rename"
            autoFocus
            defaultValue={project.name}
            onBlur={(e) => {
              const name = e.currentTarget.value.trim()
              if (name) updateProject(project.id, { name })
              setRenaming(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <h3 onDoubleClick={() => setRenaming(true)} title="Double-click to rename">
            {project.name}
          </h3>
        )}
        {info?.version && <span className="appstudio-chip">v{info.version}</span>}
        <span className="appstudio-card-spacer" />
        {!renaming && (
          <button className="icon-btn" title="Rename" onClick={() => setRenaming(true)}>
            <Pencil size={13} />
          </button>
        )}
        <button
          className={removing ? 'appstudio-remove confirm' : 'icon-btn'}
          title={removing ? undefined : 'Remove from App Studio (the app’s folder and files stay as they are)'}
          onClick={() => (removing ? removeProject(project.id) : setRemoving(true))}
          onBlur={() => setRemoving(false)}
        >
          {removing ? 'Remove?' : <Trash2 size={13} />}
        </button>
      </div>
      {info?.repo ? (
        <a className="appstudio-repo" href={`https://github.com/${info.repo}`} target="_blank" rel="noreferrer">
          {info.repo}
        </a>
      ) : (
        <span className="appstudio-repo muted" title={project.folder}>
          {project.folder}
        </span>
      )}
      {!info ? (
        <div className="appstudio-card-line muted">
          <Loader2 size={13} className="spin" /> Reading…
        </div>
      ) : info.error ? (
        <div className="appstudio-card-line muted">{info.error}</div>
      ) : (
        <>
          <div className="appstudio-card-line">
            <GitBranch size={13} />
            <span className="appstudio-branch">{info.branch}</span>
            {!!info.changedFiles && (
              <span className="appstudio-warn" title="Files changed in this folder that aren’t committed. Switching branch may refuse until they’re committed or put aside.">
                {info.changedFiles} changed file{info.changedFiles === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {info.lastChange && (
            <div className="appstudio-card-line appstudio-last" title={`${info.lastChange.subject}\n${info.lastChange.author}`}>
              <span className="appstudio-last-subject">{info.lastChange.subject}</span>
              <span className="muted">{timeAgo(info.lastChange.date)}</span>
            </div>
          )}
          {info.repo && (
            <button className="appstudio-card-line appstudio-pr-link" onClick={() => setSection('pulls')} disabled={!pulls.length}>
              <GitPullRequest size={13} />
              {pulls.length ? `${pulls.length} open pull request${pulls.length === 1 ? '' : 's'}` : 'No open pull requests'}
            </button>
          )}
        </>
      )}
      <CopyList project={project} />
      <div className="appstudio-card-actions">
        <button className="btn btn-primary" onClick={() => getLatestAndRun(project)} title="Pulls the latest code, runs npm install if the packages changed, then starts the app">
          <Rocket size={14} /> Get latest and run
        </button>
        <button className="icon-btn" title="Open its terminal and run buttons" onClick={() => openSpecialTab(TERMINAL_TAB)}>
          <SquareTerminal size={15} />
        </button>
        <button className="icon-btn" title={`Open the folder in ${FILE_MANAGER}`} onClick={() => open('files')}>
          <FolderOpen size={15} />
        </button>
        <button className="icon-btn" title="Open in VS Code" onClick={() => open('vscode')}>
          <Code size={15} />
        </button>
      </div>
    </section>
  )
}

/** An app's test copies: each pull request tried in a folder of its own, to run again or remove. */
function CopyList({ project }: { project: TerminalProject }) {
  const copies = useAppStudio((s) => s.copies[project.folder])
  if (!copies?.length) return null
  return (
    <div className="appstudio-copies">
      <div className="appstudio-copies-head muted">
        <CopyIcon size={12} /> Test copies
      </div>
      {copies.map((c) => (
        <CopyRow key={c.path} project={project} copy={c} />
      ))}
    </div>
  )
}

function CopyRow({ project, copy }: { project: TerminalProject; copy: TestCopy }) {
  const meta = useAppStudio((s) => s.copyInfo[copy.path])
  const [removing, setRemoving] = useState(false)
  const [busy, setBusy] = useState(false)
  const name = copy.path.split(/[\\/]/).pop() ?? copy.path
  const remove = async (): Promise<void> => {
    if (!removing) {
      setRemoving(true)
      return
    }
    setBusy(true)
    closeCopyTerminals(copy.path)
    try {
      // Give the app a moment to let go of its files.
      await new Promise((r) => setTimeout(r, 800))
      await removeCopy(project.folder, copy.path)
    } catch (err) {
      notify(err)
    } finally {
      setBusy(false)
      setRemoving(false)
    }
  }
  return (
    <div className="appstudio-copy">
      <span className="appstudio-copy-name" title={copy.path}>
        {meta?.label ?? name}
      </span>
      <button
        className="icon-btn"
        title={meta ? 'Get its latest and run it' : 'Orbit doesn’t know which branch this copy is for'}
        disabled={!meta}
        onClick={() => meta && runTestCopy(project, copy.path, meta.branch, meta.label)}
      >
        <Play size={13} />
      </button>
      <button className="icon-btn" title={`Open the folder in ${FILE_MANAGER}`} onClick={() => window.api.terminalOpenIn(copy.path, 'files').catch(notify)}>
        <FolderOpen size={13} />
      </button>
      <button
        className={removing ? 'appstudio-remove confirm' : 'icon-btn'}
        title={removing ? undefined : 'Remove this copy (closes it if it’s running)'}
        disabled={busy}
        onClick={() => void remove()}
        onBlur={() => !busy && setRemoving(false)}
      >
        {busy ? <Loader2 size={13} className="spin" /> : removing ? 'Remove?' : <Trash2 size={13} />}
      </button>
    </div>
  )
}

function PullInbox() {
  const pulls = useAppStudio((s) => s.pulls)
  const errors = useAppStudio((s) => s.pullErrors)
  const info = useAppStudio((s) => s.info)
  const loading = useAppStudio((s) => s.loadingPulls)
  const github = useAppStudio((s) => s.github)
  const repos = appRepos(info)
  return (
    <div className="appstudio-pulls">
      <GitHubConnect />
      {Object.entries(errors).map(([repo, error]) => (
        <div key={repo} className="appstudio-error">
          <strong>{repo}:</strong> {error}
        </div>
      ))}
      {!repos.length && <p className="appstudio-empty">Add an app whose folder is on GitHub (in My apps) and its pull requests show up here.</p>}
      {repos.length > 0 && !pulls.length && !loading && !Object.keys(errors).length && <p className="appstudio-empty">No open pull requests. When Claude opens one on {repos.length === 1 ? repos[0] : 'one of your apps'}, it shows up here.</p>}
      {loading && !pulls.length && (
        <p className="appstudio-empty">
          <Loader2 size={14} className="spin" /> Checking GitHub…
        </p>
      )}
      {pulls.map((p) => (
        <PullCard key={`${p.repo}#${p.number}`} pull={p} canAct={!!github?.connected} />
      ))}
    </div>
  )
}

function PullCard({ pull, canAct }: { pull: PullRequest; canAct: boolean }) {
  const projects = useTerminals((s) => s.projects)
  const info = useAppStudio((s) => s.info)
  const project = projects.find((p) => info[p.folder]?.repo === pull.repo)
  const [confirm, setConfirm] = useState<'merge' | 'close' | null>(null)
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState(false)
  const summary = prSummary(pull.body)
  const making = useAppStudio((s) => (project ? !!s.making[`${project.folder}|${pull.branch}`] : false))
  const hasCopy = useAppStudio((s) => (project ? !!s.copies[project.folder]?.some((c) => s.copyInfo[c.path]?.branch === pull.branch) : false))
  const label = `#${pull.number} ${pull.title}`.slice(0, 60)

  /** Try it: in a test copy of its own, so the app's folder isn't touched. */
  const tryInCopy = async (): Promise<void> => {
    if (!project) return
    try {
      const path = await makeCopy(project.folder, pull.branch, { label, repo: pull.repo, number: pull.number })
      runTestCopy(project, path, pull.branch, label)
    } catch (err) {
      notify(err)
    }
  }

  const act = async (what: 'merge' | 'close'): Promise<void> => {
    if (confirm !== what) {
      setConfirm(what)
      return
    }
    setBusy(true)
    try {
      if (what === 'merge') await window.api.appsMerge(pull.repo, pull.number)
      else await window.api.appsClose(pull.repo, pull.number)
      dropPull(pull.repo, pull.number)
      notify(what === 'merge' ? `Merged #${pull.number} into ${pull.base}.` : `Closed #${pull.number}.`, 'info')
      void refreshApps()
    } catch (err) {
      notify(err)
      setConfirm(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="appstudio-pull">
      <div className="appstudio-pull-top">
        <span className="appstudio-chip">{project?.name ?? pull.repo}</span>
        {pull.draft && <span className="appstudio-chip muted">Draft</span>}
        <span className="muted">
          #{pull.number} · by {pull.author} · updated {timeAgo(pull.updatedAt)}
        </span>
      </div>
      <h3>
        <a href={pull.url} target="_blank" rel="noreferrer">
          {pull.title}
        </a>
      </h3>
      <div className="appstudio-pull-meta">
        <GitBranch size={12} /> <code>{pull.branch}</code> → <code>{pull.base}</code>
        {pull.changedFiles !== undefined && (
          <span>
            <span className="appstudio-add-lines">+{pull.additions}</span> <span className="appstudio-del-lines">−{pull.deletions}</span> in {pull.changedFiles} file
            {pull.changedFiles === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {project && <ForCard pull={pull} appKeys={[pull.repo, project.name, boardKey({ name: project.name, repo: pull.repo })]} />}
      {summary.length > 0 && (
        <ul className="appstudio-pull-summary">
          {summary.map((line, i) => (
            <li key={i}>{line.replace(/^• /, '')}</li>
          ))}
        </ul>
      )}
      <div className="appstudio-pull-actions">
        <span className="appstudio-split">
          <button
            className="btn btn-primary"
            disabled={!project || making}
            title={project ? `Makes a test copy of ${project.name} with this pull request in it (beside its folder), and starts it. ${project.name}’s own folder isn’t touched.` : 'Add this app’s folder in My apps to try it'}
            onClick={() => void tryInCopy()}
          >
            {making ? <Loader2 size={14} className="spin" /> : <FlaskConical size={14} />} {making ? 'Making a copy…' : hasCopy ? 'Run its copy' : 'Try it'}
          </button>
          <button className="btn btn-primary appstudio-split-more" disabled={!project} title="More ways to try it" onClick={() => setMenu(!menu)} onBlur={() => setTimeout(() => setMenu(false), 150)}>
            <ChevronDown size={14} />
          </button>
          {menu && project && (
            <div className="appstudio-menu">
              <button onMouseDown={(e) => e.preventDefault()} onClick={() => (setMenu(false), void tryInCopy())}>
                Try it in a test copy
              </button>
              <button onMouseDown={(e) => e.preventDefault()} onClick={() => (setMenu(false), tryBranch(project, pull.branch))}>
                Try it in {project.name}’s own folder (switches its branch)
              </button>
            </div>
          )}
        </span>

        <button
          className={`btn${confirm === 'merge' ? ' btn-primary appstudio-confirm' : ''}`}
          disabled={busy || !canAct}
          title={canAct ? `Merge into ${pull.base}` : 'Connect GitHub (above) to merge from here'}
          onClick={() => void act('merge')}
          onBlur={() => confirm === 'merge' && !busy && setConfirm(null)}
        >
          {busy && confirm === 'merge' ? <Loader2 size={14} className="spin" /> : <GitMerge size={14} />}
          {confirm === 'merge' ? `Merge into ${pull.base}?` : 'Merge'}
        </button>
        <button
          className={`btn${confirm === 'close' ? ' appstudio-confirm-danger' : ''}`}
          disabled={busy || !canAct}
          title={canAct ? 'Close without merging' : 'Connect GitHub (above) to close from here'}
          onClick={() => void act('close')}
          onBlur={() => confirm === 'close' && !busy && setConfirm(null)}
        >
          <X size={14} />
          {confirm === 'close' ? 'Close it?' : 'Close'}
        </button>
        <a className="link-button appstudio-open" href={pull.url} target="_blank" rel="noreferrer">
          <ExternalLink size={13} /> On GitHub
        </a>
      </div>
    </article>
  )
}

function GitHubConnect() {
  const github = useAppStudio((s) => s.github)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  if (!github) return null
  if (github.connected)
    return (
      <div className="appstudio-github connected">
        <span>
          Connected to GitHub as <strong>{github.login}</strong>
        </span>
        <button
          className="link-button"
          onClick={() =>
            void window.api
              .appsClearToken()
              .then(setGithub)
              .catch((err) => notify(err))
          }
        >
          Disconnect
        </button>
      </div>
    )
  const connect = async (): Promise<void> => {
    setBusy(true)
    try {
      setGithub(await window.api.appsSetToken(token))
      setToken('')
      void refreshPulls()
    } catch (err) {
      notify(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="appstudio-github">
      <strong>Connect GitHub to merge and close from here</strong>
      <p>
        Public apps’ pull requests show without it. For private apps, and to merge or close, make a token on GitHub with access to your app repositories (Pull requests and
        Contents: read and write), then paste it here. It’s stored encrypted on this computer and only ever sent to GitHub.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void connect()
        }}
      >
        <input className="text-input" type="password" placeholder="github_pat_…" value={token} onChange={(e) => setToken(e.target.value)} />
        <button className="btn btn-primary" type="submit" disabled={busy || !token.trim()}>
          {busy ? <Loader2 size={14} className="spin" /> : null} Connect
        </button>
        <a className="link-button" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">
          <ExternalLink size={13} /> Make a token
        </a>
      </form>
    </div>
  )
}

/** In a test copy (started from Orbit's code), App Studio starts empty: its apps are set up in your normal Orbit. */
function TestCopyNote() {
  const [test, setTest] = useState(false)
  useEffect(() => {
    window.api
      .appsIsTestCopy()
      .then(setTest)
      .catch(() => undefined)
  }, [])
  const noApps = useTerminals((s) => s.projects.length === 0)
  if (!test || !noApps) return null
  return (
    <div className="appstudio-testcopy">
      This is Orbit’s <strong>test copy</strong>, with its own settings, so your apps aren’t here. Use App Studio in your normal Orbit to try and merge things, and use
      this copy to test them.
    </div>
  )
}

/** Which idea or bug a pull request is for (matched when Claude opened it; can be changed). */
function ForCard({ pull, appKeys }: { pull: PullRequest; appKeys: string[] }) {
  const key = pullKey(pull.repo, pull.number)
  const items = useAppBoard((s) => s.items)
  const loaded = useAppBoard((s) => s.loaded)
  const linked = items.find((i) => i.pull === key)
  const choices = items.filter((i) => appKeys.includes(i.app) && (i.column !== 'done' || i === linked))
  if (!loaded || !choices.length) return null
  return (
    <div className="appstudio-for">
      <span className="muted">For</span>
      <select
        className="board-select"
        value={linked?.id ?? ''}
        onChange={(e) => linkPull(pull.repo, pull.number, e.target.value || null)}
        title="Which idea or bug this is for. Its card moves to Testing now, and to Done when this is merged."
      >
        <option value="">No card</option>
        {choices.map((i) => (
          <option key={i.id} value={i.id}>
            {i.kind === 'bug' ? 'Bug: ' : 'Idea: '}
            {i.title}
          </option>
        ))}
      </select>
    </div>
  )
}
