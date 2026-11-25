import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ClipboardCopy, Check, Download, EyeOff, Eye, Undo2, GitBranch, ArrowDownToLine, ExternalLink, Hammer, Loader2, RefreshCw, Rocket, Sparkles, Tag, Upload, Wand2 } from 'lucide-react'
import { boardKey, bumpVersion, rollbackVersion, countText, describeChange, downloadsByPlatform, downloadsSince, isTokenPermissionError, changelogSource, notesTarget, plainChangelog, timeAgo, VERSION_BUMPS, type Release, type VersionBump } from '@shared/appStudio'
import { useTerminals, type TerminalProject } from '../../store/terminals'
import { refreshApps, setSection, useAppStudio } from '../../store/appStudio'
import { downloadDay, lastRelease, loadReleases, putRelease, setNotes, setReleasesApp, totalDownloads, useAppReleases } from '../../store/appReleases'
import { commitChanges, rollBack, runProjectCommand, stashChanges } from '../../lib/terminal'
import { notify } from '../../store/notify'
import TokenProblem from './TokenProblem'
import { BuildCard, mainChanged, ReleaseFlow, useFixTick } from './ReleaseHelper'
import { mainStatusText, type MainStatus } from '@shared/releaseCheck'
import { errorMessage } from '../../lib/paths'

/** Releases are read from GitHub again when you come back after this long. */
const FRESH_MS = 2 * 60_000

/**
 * App Studio's Releases tab, for one app at a time: the release builder (bump the version, tag it
 * and push, or build the installers here), the "What's new" writer (notes from the pull requests
 * merged since the last release, put on the GitHub release), and the list of past releases.
 */
export default function Releases() {
  const projects = useTerminals((s) => s.projects)
  const info = useAppStudio((s) => s.info)
  const selected = useAppReleases((s) => s.app)
  const apps = useMemo(
    () =>
      projects.map((p) => {
        const repo = info[p.folder]?.repo
        return { project: p, repo, key: boardKey({ name: p.name, repo }) }
      }),
    [projects, info]
  )
  const app = apps.find((a) => a.key === selected || a.project.id === selected) ?? apps[0]

  if (!apps.length) return <p className="appstudio-empty">Add an app in My apps first, then you can release it from here.</p>
  if (!app) return null
  return (
    <div className="releases">
      <div className="board-toolbar">
        <div className="board-apps">
          {apps.map((a) => (
            <button key={a.project.id} className={a === app ? 'active' : ''} onClick={() => setReleasesApp(a.key)}>
              {a.project.name}
              {info[a.project.folder]?.version && <span className="appstudio-count">v{info[a.project.folder]?.version}</span>}
            </button>
          ))}
        </div>
      </div>
      <AppReleases key={app.project.id} project={app.project} repo={app.repo} />
    </div>
  )
}

function AppReleases({ project, repo }: { project: TerminalProject; repo?: string }) {
  const data = useAppReleases((s) => (repo ? s.byRepo[repo] : undefined))
  const loading = useAppReleases((s) => (repo ? !!s.loading[repo] : false))
  const releaseWorkflow = useAppStudio((s) => !!s.info[project.folder]?.releaseWorkflow)
  const appKey = boardKey({ name: project.name, repo })

  useEffect(() => {
    if (repo && (!data || Date.now() - data.at > FRESH_MS)) void loadReleases(repo)
    // Only when the app changes; the refresh button reads them again.
  }, [repo])

  return (
    <div className="releases-grid">
      <div className="releases-main">
        <NextRelease project={project} releases={data?.releases ?? []} appKey={appKey} repo={repo} />
        {repo && releaseWorkflow && <BuildCard project={project} appKey={appKey} repo={repo} />}
        {repo ? (
          <WhatsNew project={project} repo={repo} />
        ) : (
          <section className="appstudio-card">
            <h3>What’s new</h3>
            <p className="muted">This app’s folder isn’t on GitHub, so there are no merged pull requests to write the notes from.</p>
          </section>
        )}
      </div>
      <div className="releases-side">
        {repo && data && !data.error && <Downloads repo={repo} releases={data.releases} />}
        <section className="appstudio-card releases-list">
          <div className="appstudio-card-top">
            <h3>Releases</h3>
            <span className="board-spacer" />
            {repo && (
              <button className="icon-btn" title="Check GitHub again" onClick={() => void loadReleases(repo)} disabled={loading}>
                {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
              </button>
            )}
          </div>
          {!repo && <p className="muted">Releases are read from GitHub, and this app’s folder isn’t on GitHub.</p>}
          {data?.error && <div className="appstudio-error">{data.error}</div>}
          {repo && data && !data.error && !data.releases.length && <p className="muted">No releases on GitHub yet.</p>}
          {repo && !data && loading && (
            <p className="muted">
              <Loader2 size={13} className="spin" /> Checking GitHub…
            </p>
          )}
          {data?.releases.map((r) => <ReleaseRow key={r.tag} release={r} project={project} repo={repo} releases={data.releases} />)}
        </section>
      </div>
    </div>
  )
}

function ReleaseRow({ release, project, repo, releases }: { release: Release; project: TerminalProject; repo?: string; releases: Release[] }) {
  return (
    <details className="release-row">
      <summary>
        <Tag size={13} />
        <strong>{release.name}</strong>
        {release.draft && <span className="appstudio-chip muted">Draft</span>}
        {release.prerelease && <span className="appstudio-chip muted">Pre-release</span>}
        <span className="muted">{timeAgo(release.date)}</span>
        {!release.draft && !!release.files?.length && (
          <span className="release-downloads" title={`Downloaded ${(release.downloads ?? 0).toLocaleString('en-GB')} times`}>
            <Download size={11} /> {countText(release.downloads ?? 0)}
          </span>
        )}
        <a className="link-button" href={release.url} target="_blank" rel="noreferrer" title="Open on GitHub" onClick={(e) => e.stopPropagation()}>
          <ExternalLink size={12} />
        </a>
      </summary>
      {!release.draft && !!release.files?.length && (
        <div className="release-platforms">
          {downloadsByPlatform(release.files).map((p) => (
            <span key={p.platform} className="appstudio-chip muted">
              {p.platform} {countText(p.downloads)}
            </span>
          ))}
        </div>
      )}
      <div className="release-notes">{release.body.trim() || 'No notes.'}</div>
      {repo && !release.draft && <RollBack release={release} project={project} repo={repo} releases={releases} />}
    </details>
  )
}

/**
 * How many times the app has been downloaded: the total, the last week and month (from the totals
 * Orbit notes each day you look), and a bar for each recent release. GitHub counts every download
 * of an installer, so updates the app installs by itself count too.
 */
function Downloads({ repo, releases }: { repo: string; releases: Release[] }) {
  const history = useAppReleases((s) => s.history[repo])
  const published = releases.filter((r) => !r.draft && r.files?.length)
  if (!published.length) return null
  const day = downloadDay()
  const week = downloadsSince(history ?? [], 7, day)
  const month = downloadsSince(history ?? [], 30, day)
  const bars = published.slice(0, 12).reverse()
  const most = Math.max(1, ...bars.map((r) => r.downloads ?? 0))
  const latest = published[0]
  const waiting = 'Orbit notes the total each day you open Releases, so this fills in after a while'
  return (
    <section className="appstudio-card release-stats">
      <div className="appstudio-card-top">
        <Download size={16} />
        <h3>Downloads</h3>
      </div>
      <div className="release-stat-row">
        <div>
          <strong>{countText(totalDownloads(published))}</strong>
          <span className="muted">in all</span>
        </div>
        <div>
          <strong>{countText(latest.downloads ?? 0)}</strong>
          <span className="muted">of {latest.name}</span>
        </div>
        <div title={week === null ? waiting : undefined}>
          <strong>{week === null ? '–' : countText(week)}</strong>
          <span className="muted">this week</span>
        </div>
        <div title={month === null ? waiting : undefined}>
          <strong>{month === null ? '–' : countText(month)}</strong>
          <span className="muted">this month</span>
        </div>
      </div>
      <div className="release-bars" role="img" aria-label="Downloads of each release">
        {bars.map((r) => (
          <div key={r.tag} className="release-bar" title={`${r.name}: ${(r.downloads ?? 0).toLocaleString('en-GB')} downloads`}>
            <span className="release-bar-count">{countText(r.downloads ?? 0)}</span>
            <span className="release-bar-fill" style={{ height: `${Math.max(2, ((r.downloads ?? 0) / most) * 75)}%` }} />
            <span className="release-bar-tag">{r.tag.replace(/^v/, '')}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * Going back from a bad release. The newest one can be hidden from new downloads (marked as a
 * pre-release, so GitHub's "latest" and apps that update themselves skip it). An earlier one can
 * be released again as a new version, so everyone's app updates to it.
 */
function RollBack({ release, project, repo, releases }: { release: Release; project: TerminalProject; repo: string; releases: Release[] }) {
  const info = useAppStudio((s) => s.info[project.folder])
  const github = useAppStudio((s) => s.github)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tokenProblem, setTokenProblem] = useState('')
  const published = releases.filter((r) => !r.draft && !r.prerelease)
  const latest = published[0]
  const isLatest = latest?.tag === release.tag
  const newer = published.findIndex((r) => r.tag === release.tag) > 0
  const next = rollbackVersion(info?.version, releases)
  const dirty = (info?.changedFiles ?? 0) > 0
  const main = info?.mainBranch ?? 'main'
  const offMain = !!info?.branch && info.branch !== main

  const hide = async (prerelease: boolean): Promise<void> => {
    setBusy(true)
    try {
      putRelease(repo, await window.api.appsSetPrerelease(repo, release.tag, prerelease))
      notify(prerelease ? `${release.name} is hidden. New downloads and updates get the release before it.` : `${release.name} is the latest release again.`, 'info')
      setTokenProblem('')
    } catch (err) {
      const message = errorMessage(err)
      if (isTokenPermissionError(message)) setTokenProblem(message)
      else notify(err)
    } finally {
      setBusy(false)
    }
  }

  const goBack = (): void => {
    if (!next) return
    if (!confirm) {
      setConfirm(true)
      return
    }
    setConfirm(false)
    rollBack(project, release.tag, next)
    notify(`Releasing v${next} with ${release.name}’s code. GitHub builds it like any other release.`, 'info')
    window.setTimeout(() => void refreshApps(), 8000)
  }

  if (release.prerelease) {
    return (
      <div className="release-rollback">
        <span className="muted">A pre-release: new downloads and updates skip it.</span>
        {github?.connected && (
          <button className="btn" disabled={busy} onClick={() => void hide(false)}>
            {busy ? <Loader2 size={13} className="spin" /> : <Eye size={13} />} Make it the latest again
          </button>
        )}
      </div>
    )
  }
  return (
    <div className="release-rollback">
      {isLatest && (
        <>
          <span className="muted">Something wrong with this release? Hide it so new downloads and updates get the one before it, then go back to an earlier release below.</span>
          {github?.connected ? (
            <button className="btn" disabled={busy || published.length < 2} title={published.length < 2 ? 'There’s no earlier release to fall back on' : 'Marks it as a pre-release on GitHub. You can undo this.'} onClick={() => void hide(true)}>
              {busy ? <Loader2 size={13} className="spin" /> : <EyeOff size={13} />} Hide from new downloads
            </button>
          ) : (
            <span className="muted">
              <button className="link-button" onClick={() => setSection('pulls')}>
                Connect GitHub
              </button>{' '}
              to hide it from here.
            </span>
          )}
        </>
      )}
      {newer && next && (
        <>
          <span className="muted">
            Go back to this version: Orbit puts {release.name}’s code back and releases it as v{next}, so everyone’s app updates to it. Nothing is lost; the newer work stays in git’s history.
          </span>
          {(dirty || offMain) && (
            <span className="release-rollback-warn">
              <AlertTriangle size={12} /> {dirty ? 'Commit or put away the changed files first (in Next release).' : `Switch to ${main} first (in Next release).`}
            </span>
          )}
          <button className={`btn${confirm ? ' appstudio-confirm' : ''}`} disabled={dirty || offMain} onClick={goBack} onBlur={() => setConfirm(false)}>
            <Undo2 size={13} /> {confirm ? `Release v${next} with ${release.name}’s code?` : `Go back to ${release.name}`}
          </button>
        </>
      )}
      {tokenProblem && <TokenProblem message={tokenProblem} owner={repo.split('/')[0]} onDone={() => setTokenProblem('')} />}
    </div>
  )
}

function NextRelease({ project, releases, appKey, repo }: { project: TerminalProject; releases: Release[]; appKey: string; repo?: string }) {
  const info = useAppStudio((s) => s.info[project.folder])
  const [bump, setBump] = useState<VersionBump>('minor')
  const version = info?.version
  const next = version ? bumpVersion(version, bump) : null
  const last = lastRelease(releases)
  const dirty = (info?.changedFiles ?? 0) > 0

  return (
    <section className="appstudio-card">
      <div className="appstudio-card-top">
        <Rocket size={16} />
        <h3>Next release</h3>
      </div>
      <div className="appstudio-card-line muted">
        {version ? <>Now v{version}</> : <>No version in package.json</>}
        {last && (
          <>
            {' '}
            · last release {last.name} {timeAgo(last.date)}
          </>
        )}
      </div>
      {!version ? (
        <p className="muted">Orbit bumps the version in package.json, so it can only release apps that have one.</p>
      ) : (
        <>
          <div className="release-bumps">
            {VERSION_BUMPS.map((b) => (
              <button key={b.id} className={b.id === bump ? 'active' : ''} onClick={() => setBump(b.id)} title={b.hint}>
                <strong>{b.label}</strong>
                <span>v{bumpVersion(version, b.id)}</span>
              </button>
            ))}
          </div>
          {dirty && <Uncommitted project={project} />}
          {repo && <LatestMain project={project} />}
          <ReleaseFlow project={project} appKey={appKey} repo={repo} bump={bump} />
          <p className="muted release-explain">
            {info?.hasTests && 'Runs the tests first. Then it '}
            {info?.releaseWorkflow
              ? `${info?.hasTests ? 's' : 'S'}ets the version to ${next}, commits it, tags it v${next} and pushes. GitHub then builds the installers and publishes the release, which takes a few minutes; Orbit watches it below.`
              : `${info?.hasTests ? 's' : 'S'}ets the version to ${next}, commits it, tags it v${next} and pushes. This app has no release workflow on GitHub, so build the installers here.`}
          </p>
        </>
      )}
      {!!info?.buildScripts?.length && (
        <div className="release-builds">
          <span className="muted">Build here:</span>
          {info.buildScripts.map((s) => (
            <button key={s} className="btn" title={`Runs npm run ${s} in ${project.name}’s terminal`} onClick={() => runProjectCommand(project, `npm run ${s}`)}>
              <Hammer size={13} /> {s}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * "Latest main": how far this folder is behind GitHub's main, and one button that gets it (switching
 * to main first when it's on another branch), so a release is made from what's really on GitHub
 * and not an old copy. It looks again when you open the app, after a fix, and when the branch or
 * the changed files change.
 */
function LatestMain({ project }: { project: TerminalProject }) {
  const info = useAppStudio((s) => s.info[project.folder])
  const fixTick = useFixTick()
  const [status, setStatus] = useState<MainStatus | null>(null)
  const [looking, setLooking] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string; output?: string } | null>(null)
  const ask = useRef(0)
  const main = info?.mainBranch ?? 'main'
  const offMain = !!info?.branch && info.branch !== main
  const dirty = info?.changedFiles ?? 0

  const look = useCallback(async (): Promise<void> => {
    const id = ++ask.current
    setLooking(true)
    try {
      const s = await window.api.appsMainStatus(project.folder)
      if (id === ask.current) setStatus(s)
    } catch (err) {
      // "busy": a release job is using git right now; the next look catches up.
      const message = errorMessage(err)
      if (id === ask.current && !/busy/.test(message)) setStatus((s) => ({ ...(s ?? { main, onMain: !offMain, dirty, linked: true, behind: 0, ahead: 0 }), problem: message }))
    } finally {
      if (id === ask.current) setLooking(false)
    }
  }, [project.folder])

  useEffect(() => {
    void look()
  }, [look, fixTick, info?.branch, info?.lastChange?.date])

  const getLatest = async (): Promise<void> => {
    setPulling(true)
    setResult(null)
    try {
      const r = await window.api.appsGetLatestMain(project.folder)
      setResult({ ok: r.ok, text: r.message, output: r.output })
      notify(r.message, r.ok ? 'info' : 'error')
      if (r.ok) mainChanged()
    } catch (err) {
      setResult({ ok: false, text: errorMessage(err) })
    } finally {
      setPulling(false)
      await refreshApps()
      void look()
    }
  }

  if (status && !status.linked) return null
  const behind = status?.behind ?? 0
  const upToDate = !!status && !status.problem && !behind && !offMain
  const blocked = offMain && dirty > 0
  const label = offMain ? `Switch to ${main} and get the latest` : `Get latest ${main}`
  const title = blocked
    ? `Commit or put away the ${dirty === 1 ? 'changed file' : `${dirty} changed files`} first, so ${dirty === 1 ? 'it stays' : 'they stay'} on ${info?.branch}`
    : offMain
      ? `Runs git checkout ${main}, then gets everything on GitHub’s ${main}. Nothing is thrown away.`
      : `Gets everything on GitHub’s ${main} (git pull). Changed files are kept; if the new commits touch them, git stops and nothing changes.`

  return (
    <div className={`release-latest${upToDate ? ' release-latest-ok' : ''}${status?.problem ? ' release-latest-problem' : ''}`}>
      <div className="release-latest-line">
        {!status ? <Loader2 size={13} className="spin" /> : upToDate ? <Check size={13} /> : offMain ? <GitBranch size={13} /> : <AlertTriangle size={13} />}
        <span>
          {!status ? (
            `Checking GitHub’s ${main}…`
          ) : (
            <>
              {offMain && (
                <>
                  It’s on the branch <code>{info?.branch}</code>, and releases are made from {main}.{' '}
                </>
              )}
              {mainStatusText(status)}
              {behind > 0 && !status.problem && ' Get it first so the release has everything that’s been merged.'}
            </>
          )}
        </span>
        <button className="icon-btn" title={`Check GitHub’s ${main} again`} disabled={looking || pulling} onClick={() => void look()}>
          {looking && status ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
        </button>
        <button className={`btn release-warning-btn${!upToDate && !blocked ? ' btn-primary' : ''}`} disabled={pulling || blocked} title={title} onClick={() => void getLatest()}>
          {pulling ? <Loader2 size={13} className="spin" /> : <ArrowDownToLine size={13} />} {pulling ? 'Getting it…' : label}
        </button>
      </div>
      {result && !result.ok && (
        <div className="release-latest-result">
          <span>{result.text}</span>
          {result.output?.trim() && (
            <details className="release-details">
              <summary>Show what git said</summary>
              <pre>{result.output}</pre>
            </details>
          )}
        </div>
      )}
      {status?.problem && status.output && (
        <details className="release-details">
          <summary>Show what git said</summary>
          <pre>{status.output}</pre>
        </details>
      )}
    </div>
  )
}

function WhatsNew({ project, repo }: { project: TerminalProject; repo: string }) {
  const data = useAppReleases((s) => s.byRepo[repo])
  const notes = useAppReleases((s) => s.notes[repo] ?? '')
  const github = useAppStudio((s) => s.github)
  const version = useAppStudio((s) => s.info[project.folder]?.version)
  const [aiReady, setAiReady] = useState(false)
  const [writing, setWriting] = useState(false)
  const [sending, setSending] = useState(false)
  const [tokenProblem, setTokenProblem] = useState('')
  const merged = data?.merged ?? []
  const releases = data?.releases ?? []
  const last = lastRelease(releases)
  const target = notesTarget(version, releases)
  const [tag, setTag] = useState<string | null>(null)
  const chosen = tag ?? target

  useEffect(() => {
    window.api.aiStatus().then(
      (s) => setAiReady(s.ready),
      () => setAiReady(false)
    )
  }, [])
  // The notes start as the plain list, once the pull requests are known.
  useEffect(() => {
    if (data && !useAppReleases.getState().notes[repo] && data.merged.length) setNotes(repo, plainChangelog(data.merged))
  }, [data, repo])

  const writeWithAi = async (): Promise<void> => {
    setWriting(true)
    try {
      setNotes(repo, await window.api.aiWhatsNew(changelogSource(project.name, merged)))
    } catch (err) {
      notify(err)
    } finally {
      setWriting(false)
    }
  }

  const putOnGitHub = async (): Promise<void> => {
    if (!chosen) return
    setSending(true)
    try {
      const r = await window.api.appsSetReleaseNotes(repo, chosen, notes, `${project.name} ${chosen.replace(/^v/, '')}`)
      putRelease(repo, r)
      notify(r.draft ? `Put the notes on the ${r.tag} draft release.` : `Updated the notes on release ${r.tag}.`, 'info')
      setTokenProblem('')
    } catch (err) {
      const message = errorMessage(err)
      if (isTokenPermissionError(message)) setTokenProblem(message)
      else notify(err)
    } finally {
      setSending(false)
    }
  }

  const tags = [...new Set([target, ...releases.slice(0, 6).map((r) => r.tag)].filter((t): t is string => !!t))]

  return (
    <section className="appstudio-card">
      <div className="appstudio-card-top">
        <Sparkles size={16} />
        <h3>What’s new</h3>
      </div>
      <div className="appstudio-card-line muted">
        {!data ? 'Checking GitHub…' : `${merged.length} pull request${merged.length === 1 ? '' : 's'} merged ${last ? `since ${last.name}` : 'recently'}`}
      </div>
      {merged.length > 0 && (
        <ul className="release-merged">
          {merged.map((p) => (
            <li key={p.number}>
              <a href={p.url} target="_blank" rel="noreferrer">
                {p.title}
              </a>
              <span className="muted">
                {' '}
                #{p.number} · {timeAgo(p.mergedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="appstudio-pull-actions">
        <button className="btn" disabled={!merged.length} onClick={() => setNotes(repo, plainChangelog(merged))} title="A list made from the pull request titles">
          <Wand2 size={14} /> From the titles
        </button>
        <button
          className="btn"
          disabled={!merged.length || !aiReady || writing}
          onClick={() => void writeWithAi()}
          title={aiReady ? 'The AI helper reads the pull requests and writes notes for the people using the app' : 'Set up the AI helper in Settings to use this'}
        >
          {writing ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Write with the AI helper
        </button>
      </div>
      <textarea
        className="release-textarea"
        value={notes}
        placeholder={merged.length ? 'The notes for the next release.' : 'Nothing merged since the last release yet. You can still write notes here.'}
        onChange={(e) => setNotes(repo, e.target.value)}
        rows={Math.min(16, Math.max(6, notes.split('\n').length + 1))}
      />
      <div className="appstudio-pull-actions">
        <button className="btn" disabled={!notes.trim()} onClick={() => void navigator.clipboard.writeText(notes).then(() => notify('Copied the notes.', 'info'), notify)}>
          <ClipboardCopy size={14} /> Copy
        </button>
        {github?.connected ? (
          <>
            <button className="btn btn-primary" disabled={!notes.trim() || !chosen || sending} onClick={() => void putOnGitHub()}>
              {sending ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} Put on release
            </button>
            <select className="release-tag" value={chosen ?? ''} onChange={(e) => setTag(e.target.value)} title="Which release the notes go on">
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                  {t === target ? ' (next)' : ''}
                </option>
              ))}
            </select>
          </>
        ) : (
          <span className="muted">
            <button className="link-button" onClick={() => setSection('pulls')}>
              Connect GitHub
            </button>{' '}
            to put the notes on the release from here.
          </span>
        )}
      </div>
      {tokenProblem && <TokenProblem message={tokenProblem} owner={repo.split('/')[0]} onDone={() => setTokenProblem('')} />}
    </section>
  )
}


/**
 * Files changed but not committed, which would be left out of the release: which ones, and buttons
 * to put them away (a git stash, brought back with `git stash pop`) or commit them.
 */
function Uncommitted({ project }: { project: TerminalProject }) {
  const info = useAppStudio((s) => s.info[project.folder])
  const [committing, setCommitting] = useState(false)
  const [message, setMessage] = useState('')
  const count = info?.changedFiles ?? 0
  const list = info?.changes ?? []
  const lockOnly = list.length === 1 && /package-lock\.json/.test(list[0])
  const after = (): void => {
    window.setTimeout(() => void refreshApps(), 3000)
    window.setTimeout(() => void refreshApps(), 8000)
  }
  return (
    <div className="release-warning release-uncommitted">
      <div className="release-uncommitted-text">
        <AlertTriangle size={13} />
        <span>
          {count === 1 ? '1 file has' : `${count} files have`} changed since the last commit, so {count === 1 ? 'it' : 'they'} wouldn’t be in the release:{' '}
          <strong>{list.map(describeChange).join(', ')}</strong>
          {count > list.length && ` and ${count - list.length} more`}.
          {lockOnly && ' npm often changes this file by itself, so putting it away is usually right.'}
        </span>
      </div>
      {committing ? (
        <form
          className="release-commit"
          onSubmit={(e) => {
            e.preventDefault()
            commitChanges(project, message)
            setCommitting(false)
            after()
          }}
        >
          <input className="text-input" autoFocus placeholder="What changed? e.g. Small fixes" value={message} onChange={(e) => setMessage(e.target.value)} />
          <button className="btn btn-primary" type="submit" disabled={!message.trim()}>
            Commit
          </button>
          <button className="btn" type="button" onClick={() => setCommitting(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <div className="release-uncommitted-actions">
          <button
            className="btn"
            title="Sets the changes aside (git stash), so the release is made from what’s committed. Bring them back later with git stash pop."
            onClick={() => {
              stashChanges(project)
              after()
            }}
          >
            {count === 1 ? 'Put it away' : 'Put them away'}
          </button>
          <button className="btn" title="Commits the changes so they’re in the release" onClick={() => setCommitting(true)}>
            {count === 1 ? 'Commit it' : 'Commit them'}
          </button>
          <button className="btn" title="Show the changes in the terminal (git status)" onClick={() => runProjectCommand(project, 'git status')}>
            Show in terminal
          </button>
        </div>
      )}
    </div>
  )
}
