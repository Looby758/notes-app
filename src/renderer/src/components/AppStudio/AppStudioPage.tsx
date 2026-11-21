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
  X,
  FlaskConical
} from 'lucide-react'
import { prSummary, timeAgo, type PullRequest } from '@shared/appStudio'
import { FILE_MANAGER } from '@shared/platform'
import { addProject, useTerminals, type TerminalProject } from '../../store/terminals'
import { appRepos, dropPull, refreshApps, refreshGithub, refreshPulls, setGithub, setSection, useAppStudio } from '../../store/appStudio'
import { getLatestAndRun, tryBranch } from '../../lib/terminal'
import { openSpecialTab, TERMINAL_TAB } from '../../lib/editorController'
import { notify } from '../../store/notify'

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
        <nav className="appstudio-tabs">
          <button className={section === 'apps' ? 'active' : ''} onClick={() => setSection('apps')}>
            My apps <span className="appstudio-count">{projects.length}</span>
          </button>
          <button className={section === 'pulls' ? 'active' : ''} onClick={() => setSection('pulls')}>
            Pull requests {pulls.length > 0 && <span className="appstudio-count accent">{pulls.length}</span>}
          </button>
        </nav>
        {section === 'apps' ? <MyApps /> : <PullInbox />}
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
  return (
    <section className="appstudio-card">
      <div className="appstudio-card-top">
        <h3>{project.name}</h3>
        {info?.version && <span className="appstudio-chip">v{info.version}</span>}
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
  const summary = prSummary(pull.body)

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
      {summary.length > 0 && (
        <ul className="appstudio-pull-summary">
          {summary.map((line, i) => (
            <li key={i}>{line.replace(/^• /, '')}</li>
          ))}
        </ul>
      )}
      <div className="appstudio-pull-actions">
        <button
          className="btn btn-primary"
          disabled={!project}
          title={project ? `Switches ${project.name} to this branch, gets its latest, and starts it` : 'Add this app’s folder in My apps to try it'}
          onClick={() => project && tryBranch(project, pull.branch)}
        >
          <FlaskConical size={14} /> Try it
        </button>
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
