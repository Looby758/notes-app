import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ClipboardCopy, ExternalLink, Hammer, Loader2, RefreshCw, Rocket, Sparkles, Tag, Upload, Wand2 } from 'lucide-react'
import { boardKey, bumpVersion, changelogSource, notesTarget, plainChangelog, timeAgo, VERSION_BUMPS, type Release, type VersionBump } from '@shared/appStudio'
import { useTerminals, type TerminalProject } from '../../store/terminals'
import { refreshApps, setSection, useAppStudio } from '../../store/appStudio'
import { lastRelease, loadReleases, putRelease, setNotes, setReleasesApp, useAppReleases } from '../../store/appReleases'
import { releaseApp, runProjectCommand } from '../../lib/terminal'
import { notify } from '../../store/notify'

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

  useEffect(() => {
    if (repo && (!data || Date.now() - data.at > FRESH_MS)) void loadReleases(repo)
    // Only when the app changes; the refresh button reads them again.
  }, [repo])

  return (
    <div className="releases-grid">
      <div className="releases-main">
        <NextRelease project={project} releases={data?.releases ?? []} />
        {repo ? (
          <WhatsNew project={project} repo={repo} />
        ) : (
          <section className="appstudio-card">
            <h3>What’s new</h3>
            <p className="muted">This app’s folder isn’t on GitHub, so there are no merged pull requests to write the notes from.</p>
          </section>
        )}
      </div>
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
        {data?.releases.map((r) => <ReleaseRow key={r.tag} release={r} />)}
      </section>
    </div>
  )
}

function ReleaseRow({ release }: { release: Release }) {
  return (
    <details className="release-row">
      <summary>
        <Tag size={13} />
        <strong>{release.name}</strong>
        {release.draft && <span className="appstudio-chip muted">Draft</span>}
        {release.prerelease && <span className="appstudio-chip muted">Pre-release</span>}
        <span className="muted">{timeAgo(release.date)}</span>
        <a className="link-button" href={release.url} target="_blank" rel="noreferrer" title="Open on GitHub" onClick={(e) => e.stopPropagation()}>
          <ExternalLink size={12} />
        </a>
      </summary>
      <div className="release-notes">{release.body.trim() || 'No notes.'}</div>
    </details>
  )
}

function NextRelease({ project, releases }: { project: TerminalProject; releases: Release[] }) {
  const info = useAppStudio((s) => s.info[project.folder])
  const [bump, setBump] = useState<VersionBump>('minor')
  const [confirm, setConfirm] = useState(false)
  const version = info?.version
  const next = version ? bumpVersion(version, bump) : null
  const last = lastRelease(releases)
  const dirty = (info?.changedFiles ?? 0) > 0
  const offMain = !!info?.branch && !/^(main|master)$/.test(info.branch)

  const release = (): void => {
    if (!confirm) {
      setConfirm(true)
      return
    }
    setConfirm(false)
    releaseApp(project, bump)
    notify(info?.releaseWorkflow ? `Releasing v${next}. GitHub builds the installers next.` : `Releasing v${next} in the terminal.`, 'info')
    // The version changes once npm has run.
    window.setTimeout(() => void refreshApps(), 8000)
  }

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
              <button key={b.id} className={b.id === bump ? 'active' : ''} onClick={() => (setBump(b.id), setConfirm(false))} title={b.hint}>
                <strong>{b.label}</strong>
                <span>v{bumpVersion(version, b.id)}</span>
              </button>
            ))}
          </div>
          {dirty && (
            <div className="release-warning">
              <AlertTriangle size={13} /> {info?.changedFiles} file{info?.changedFiles === 1 ? ' isn’t' : 's aren’t'} committed yet. Commit them (or put them away) first.
            </div>
          )}
          {offMain && !dirty && (
            <div className="release-warning">
              <AlertTriangle size={13} /> It’s on the branch <code>{info?.branch}</code>. Releases are usually made from main.
            </div>
          )}
          <div className="appstudio-pull-actions">
            <button className={`btn btn-primary${confirm ? ' appstudio-confirm' : ''}`} disabled={dirty || !next} onClick={release} onBlur={() => setConfirm(false)}>
              <Rocket size={14} /> {confirm ? `Release v${next}?` : `Release v${next}`}
            </button>
          </div>
          <p className="muted release-explain">
            {info?.releaseWorkflow
              ? `Sets the version to ${next}, commits it, tags it v${next} and pushes. GitHub then builds the installers and publishes the release, which takes a few minutes.`
              : `Sets the version to ${next}, commits it, tags it v${next} and pushes. This app has no release workflow on GitHub, so build the installers here.`}
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

function WhatsNew({ project, repo }: { project: TerminalProject; repo: string }) {
  const data = useAppReleases((s) => s.byRepo[repo])
  const notes = useAppReleases((s) => s.notes[repo] ?? '')
  const github = useAppStudio((s) => s.github)
  const version = useAppStudio((s) => s.info[project.folder]?.version)
  const [aiReady, setAiReady] = useState(false)
  const [writing, setWriting] = useState(false)
  const [sending, setSending] = useState(false)
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
    } catch (err) {
      notify(err)
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
    </section>
  )
}

