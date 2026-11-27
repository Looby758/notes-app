import { useEffect, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { AlertTriangle, Check as CheckIcon, ChevronDown, ChevronRight, Circle, ClipboardCopy, CircleSlash, Clock, ExternalLink, Hammer, Loader2, RefreshCw, Rocket, ShieldCheck, Sparkles, X } from 'lucide-react'
import { changelogSource, newTokenUrl, plainChangelog, type VersionBump } from '@shared/appStudio'
import {
  buildPhase,
  clockTime,
  jobProgress,
  jobsLine,
  notesItems,
  problemCard,
  readyToRelease,
  recoveryActions,
  runTimeText,
  type BuildJob,
  type BuildStatus,
  type BuildStep,
  type JobState,
  type Check,
  type FixId,
  type Preflight,
  type Problem,
  type RecoveryId,
  type TestProgress,
  testProgressText
} from '@shared/releaseCheck'
import type { TerminalProject } from '../../store/terminals'
import { refreshApps, setSection, useAppStudio } from '../../store/appStudio'
import { loadReleases, setNotes, useAppReleases } from '../../store/appReleases'
import { addItem } from '../../store/appBoard'
import { runProjectCommand } from '../../lib/terminal'
import { notify } from '../../store/notify'
import { errorMessage } from '../../lib/paths'

/**
 * The release helper in App Studio's Releases tab: checks everything before a release (and says
 * what to do about anything that isn't right, with a button for it), makes the release, then
 * watches GitHub build it and offers a way back when the build fails. Instead of a terminal full
 * of git and npm, you get a plain sentence and a button.
 */

/** Bumped after a release or a fix, so the build card looks again. */
const useBuildTick = create<{ tick: number }>(() => ({ tick: 0 }))
const bumpBuild = (): void => useBuildTick.setState((s) => ({ tick: s.tick + 1 }))

/** Bumped when "Get latest main" changed the folder, so checks made before it are cleared. */
export const useMainTick = create<{ tick: number }>(() => ({ tick: 0 }))
export const mainChanged = (): void => useMainTick.setState((s) => ({ tick: s.tick + 1 }))
/** Read by the "Latest main" strip, which looks again after any fix. */
export const useFixTick = (): number => useBuildTick((s) => s.tick)

const FIX_LABELS: Record<FixId, string> = {
  'put-away': 'Put the changes away',
  'switch-main': 'Switch to main',
  pull: 'Get the latest',
  'finish-push': 'Push it',
  'delete-tag': 'Delete the leftover tag',
  'write-notes': 'Write the notes',
  'drop-notes': 'Take out the leftover notes',
  'sign-in': 'Sign in (in the terminal)',
  'connect-github': 'Connect GitHub',
  'new-token': 'Make a new token',
  'developer-mode': 'Open Developer Mode settings',
  'npm-install': 'Install the packages',
  'ask-claude': 'Add to Ideas & bugs for Claude'
}

/** Fixes that can't be undone with a click wait for a second click. */
const CONFIRM: FixId[] = ['delete-tag']

interface FixContext {
  project: TerminalProject
  appKey: string
  repo?: string
  /** The version the problem is about (for the board card and the notes). */
  version: string
  /** The tag a tag fix acts on. */
  tag?: string
  problem: Problem
  output?: string
  /** Opens the notes writer. */
  writeNotes: (version: string) => void
  /** After a fix that changed something: check again. */
  after: () => void
}

async function runFix(fix: FixId, c: FixContext): Promise<void> {
  const folder = c.project.folder
  const server = async (id: string, tag?: string): Promise<void> => {
    const r = await window.api.appsReleaseFix(folder, id, tag)
    notify(r.message, r.ok ? 'info' : 'error')
    void refreshApps()
    if (c.repo) void loadReleases(c.repo)
    bumpBuild()
    if (r.ok) c.after()
  }
  switch (fix) {
    case 'put-away':
    case 'switch-main':
    case 'pull':
    case 'finish-push':
      return server(fix)
    case 'delete-tag':
      return server(fix, c.tag)
    case 'write-notes':
      return c.writeNotes(c.version)
    case 'drop-notes':
      return server(fix, c.version)
    case 'sign-in':
      // In the terminal, git can ask (or Git Credential Manager pops up its sign-in window).
      runProjectCommand(c.project, 'git push --dry-run')
      notify('Sign in when the terminal (or a GitHub window) asks, then check again.', 'info')
      return
    case 'connect-github':
      setSection('pulls')
      return
    case 'new-token':
      window.open(newTokenUrl(c.repo?.split('/')[0]), '_blank')
      return
    case 'developer-mode':
      await window.api.appsOpenDeveloperSettings()
      notify('Turn on Developer Mode, then check again.', 'info')
      return
    case 'npm-install':
      runProjectCommand(c.project, 'npm install')
      notify('Installing in the terminal. Check again once it’s done.', 'info')
      return
    case 'ask-claude': {
      const card = problemCard(c.project.name, c.version, c.problem, c.output)
      addItem(c.appKey, 'bug', card.title, card.details)
      notify('Put it on Ideas & bugs. Send it to Claude from there.', 'info')
      return
    }
  }
}

function FixButtons({ fixes, context, main }: { fixes: FixId[]; context: FixContext; main?: string }) {
  const [busy, setBusy] = useState<FixId | null>(null)
  const [confirm, setConfirm] = useState<FixId | null>(null)
  if (!fixes.length) return null
  const label = (f: FixId): string => {
    if (f === 'switch-main' && main) return `Switch to ${main}`
    if (f === 'delete-tag' && context.tag) return confirm === f ? `Delete ${context.tag}? It can’t be brought back` : `Delete the ${context.tag} tag`
    if (f === 'developer-mode' && !/win/i.test(navigator.platform)) return ''
    return FIX_LABELS[f]
  }
  const click = (f: FixId): void => {
    if (CONFIRM.includes(f) && confirm !== f) {
      setConfirm(f)
      return
    }
    setConfirm(null)
    setBusy(f)
    runFix(f, context)
      .catch((err) => notify(errorMessage(err), 'error'))
      .finally(() => setBusy(null))
  }
  return (
    <div className="release-fixes">
      {fixes
        .filter((f) => label(f))
        .map((f, i) => (
          <button key={f} className={`btn${i === 0 ? ' btn-primary' : ''}${confirm === f ? ' appstudio-confirm' : ''}`} disabled={!!busy} onClick={() => click(f)} onBlur={() => confirm === f && setConfirm(null)}>
            {busy === f && <Loader2 size={13} className="spin" />} {label(f)}
          </button>
        ))}
    </div>
  )
}

function Details({ output, label = 'Show what it said' }: { output?: string; label?: string }) {
  if (!output?.trim()) return null
  return (
    <details className="release-details">
      <summary>{label}</summary>
      <pre>{output}</pre>
      <button className="btn" onClick={() => void navigator.clipboard.writeText(output).then(() => notify('Copied. Paste it to Claude to ask about it.', 'info'), notify)}>
        <ClipboardCopy size={13} /> Copy
      </button>
    </details>
  )
}

const STATE_ICON = {
  pass: <CheckIcon size={14} />,
  warn: <AlertTriangle size={14} />,
  fail: <X size={14} />,
  skip: <CircleSlash size={13} />,
  running: <Loader2 size={14} className="spin" />
}

/**
 * The "What's new" notes for a version, written here and added to the app's own list in its code
 * (committed), so the update pop-up has them and the test that checks for them passes.
 */
export function NotesWriter({ project, repo, version, onDone, onCancel }: { project: TerminalProject; repo?: string; version: string; onDone: () => void; onCancel: () => void }) {
  const cardNotes = useAppReleases((s) => (repo ? (s.notes[repo] ?? '') : ''))
  const merged = useAppReleases((s) => (repo ? (s.byRepo[repo]?.merged ?? []) : []))
  const start = cardNotes.trim() || plainChangelog(merged)
  const [text, setText] = useState(() => notesItems(start).map((l) => `- ${l}`).join('\n'))
  const [saving, setSaving] = useState(false)
  const [writing, setWriting] = useState(false)
  const [aiReady, setAiReady] = useState(false)
  useEffect(() => {
    window.api.aiStatus().then(
      (s) => setAiReady(s.ready),
      () => setAiReady(false)
    )
  }, [])
  const items = notesItems(text)

  const withAi = async (): Promise<void> => {
    setWriting(true)
    try {
      const written = await window.api.aiWhatsNew(changelogSource(project.name, merged))
      if (repo) setNotes(repo, written)
      setText(notesItems(written).map((l) => `- ${l}`).join('\n'))
    } catch (err) {
      notify(err)
    } finally {
      setWriting(false)
    }
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const r = await window.api.appsWriteNotes(project.folder, version, items)
      notify(r.message, r.ok ? 'info' : 'error')
      if (r.ok) {
        void refreshApps()
        onDone()
      }
    } catch (err) {
      notify(errorMessage(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="release-notes-writer">
      <strong>What’s new in {version}</strong>
      <span className="muted">One line each, for the people using the app. They show in the pop-up after it updates.</span>
      <textarea className="release-textarea" value={text} rows={Math.min(12, Math.max(4, text.split('\n').length + 1))} placeholder="- Something you can do now" onChange={(e) => setText(e.target.value)} />
      <div className="release-fixes">
        <button className="btn btn-primary" disabled={!items.length || saving} onClick={() => void save()}>
          {saving && <Loader2 size={13} className="spin" />} Add {items.length === 1 ? 'it' : `these ${items.length}`} and commit
        </button>
        {!!merged.length && (
          <button className="btn" onClick={() => setText(notesItems(plainChangelog(merged)).map((l) => `- ${l}`).join('\n'))} title="A line for each pull request merged since the last release">
            From the pull requests
          </button>
        )}
        {!!merged.length && aiReady && (
          <button className="btn" disabled={writing} onClick={() => void withAi()}>
            {writing ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />} Write with the AI helper
          </button>
        )}
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/**
 * The checks, then the release. "Check and release" runs them; anything wrong says why, with a
 * button to fix it; once they all pass, Release does it (no terminal), and says plainly what
 * happened if it doesn't work.
 */
export function ReleaseFlow({ project, appKey, repo, bump }: { project: TerminalProject; appKey: string; repo?: string; bump: VersionBump }) {
  const info = useAppStudio((s) => s.info[project.folder])
  const [pre, setPre] = useState<Preflight | null>(null)
  const [tests, setTests] = useState<Check | null>(null)
  const [progress, setProgress] = useState<TestProgress | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [releasing, setReleasing] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string; problem?: Problem; output?: string; tag?: string } | null>(null)
  const [notesFor, setNotesFor] = useState<string | null>(null)
  const run = useRef(0)
  // The tests have their own count: re-checking after a fix (or writing the notes) mustn't throw
  // away a test run that's still going, or its row would say "Running…" forever.
  const testRun = useRef(0)
  const main = info?.mainBranch ?? 'main'

  const mainTick = useMainTick((s) => s.tick)
  // A different bump is a different release, and new commits from main mean checking again.
  useEffect(() => {
    run.current++
    testRun.current++
    setPre(null)
    setTests(null)
    setProgress(null)
    setResult(null)
    setConfirm(false)
    setChecking(false)
  }, [bump, mainTick])

  const check = async (withTests = true): Promise<void> => {
    const id = ++run.current
    setChecking(true)
    setError('')
    setResult(null)
    setConfirm(false)
    if (withTests) {
      const t = ++testRun.current
      setTests(null)
      setProgress(null)
      window.api.appsReleaseTests(project.folder).then(
        (c) => t === testRun.current && setTests(c),
        (err) => t === testRun.current && setTests({ id: 'tests', label: 'Tests pass', state: 'fail', text: errorMessage(err) })
      )
    }
    try {
      const p = await window.api.appsPreflight(project.folder, bump)
      if (id === run.current) setPre(p)
    } catch (err) {
      if (id === run.current) setError(errorMessage(err))
    } finally {
      if (id === run.current) setChecking(false)
    }
  }

  // Where the tests are up to, with the time ticking along while they run.
  useEffect(() => window.api.onReleaseTestsProgress((p) => p.folder === project.folder && setProgress(p)), [project.folder])
  const [now, setNow] = useState(Date.now())
  const testsRunning = !!pre && !tests && pre.checks.some((c) => c.id === 'tests' && c.state === 'running')
  useEffect(() => {
    if (!testsRunning) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [testsRunning])
  const runningTests = (c: Check): Check => (progress ? { ...c, text: testProgressText(progress, now) } : c)
  const checks = pre ? pre.checks.map((c) => (c.id === 'tests' ? (tests ?? runningTests(c)) : c)) : []
  const testShare = testsRunning && progress?.stage === 'tests' && progress.filesTotal ? progress.filesDone / progress.filesTotal : null
  const ready = !!pre && !checking && readyToRelease(checks)
  const problems = checks.filter((c) => c.state === 'fail').length

  const release = async (): Promise<void> => {
    if (!pre) return
    if (!confirm) {
      setConfirm(true)
      return
    }
    setConfirm(false)
    setReleasing(true)
    try {
      const r = await window.api.appsRelease(project.folder, bump, pre.next)
      if (r.ok) {
        setResult({ ok: true, tag: r.tag, output: r.output, text: info?.releaseWorkflow ? `${r.tag} is on GitHub. Orbit is watching GitHub build the installers below.` : `${r.tag} is made and pushed. This app has no release workflow, so build the installers here.` })
        setPre(null)
        setTests(null)
        setProgress(null)
        if (repo) window.setTimeout(() => void loadReleases(repo), 15_000)
      } else {
        setResult({ ok: false, tag: r.tag, problem: r.problem, output: r.output, text: r.step === 'push' ? 'The version was set, but it couldn’t be pushed to GitHub.' : 'The version couldn’t be set.' })
      }
    } catch (err) {
      setResult({ ok: false, text: errorMessage(err) })
    } finally {
      setReleasing(false)
      void refreshApps()
      bumpBuild()
    }
  }

  const context = (problem: Problem, extra: Partial<FixContext> = {}): FixContext => ({
    project,
    appKey,
    repo,
    version: pre?.next ?? info?.version ?? '',
    tag: pre?.tag,
    problem,
    writeNotes: setNotesFor,
    after: () => void check(false),
    ...extra
  })

  const next = pre?.next
  return (
    <div className="release-flow">
      {!pre && !checking && !releasing && (
        <div className="appstudio-pull-actions">
          <button className="btn btn-primary" disabled={!info?.version} onClick={() => void check()}>
            <ShieldCheck size={14} /> Check and release
          </button>
          <span className="muted">Checks everything GitHub’s build needs first, so a release doesn’t fail halfway.</span>
        </div>
      )}
      {error && <div className="appstudio-error">{error}</div>}
      {(pre || checking) && (
        <div className="release-checks">
          <div className="release-checks-top">
            <strong>{checking && !pre ? 'Checking…' : `Before releasing v${next}`}</strong>
            <span className="board-spacer" />
            <button className="icon-btn" title="Check again" disabled={checking} onClick={() => void check()}>
              {checking ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
            </button>
            {pre && (
              <button className="icon-btn" title="Close" onClick={() => (run.current++, testRun.current++, setPre(null), setTests(null), setProgress(null))}>
                <X size={14} />
              </button>
            )}
          </div>
          {checks.map((c) => (
            <div key={c.id} className={`release-check release-check-${c.state}`}>
              <span className="release-check-icon">{STATE_ICON[c.state]}</span>
              <div className="release-check-body">
                <strong>{c.label}</strong>
                <span>{c.text}</span>
                {(c.state === 'fail' || c.state === 'warn') && !!c.fixes?.length && (
                  <FixButtons fixes={c.fixes} main={main} context={context({ title: c.label, detail: c.text, fixes: c.fixes }, { output: c.output, tag: c.tag ?? pre?.tag })} />
                )}
                {c.id === 'notes' && notesFor && pre && <NotesWriter project={project} repo={repo} version={notesFor} onCancel={() => setNotesFor(null)} onDone={() => (setNotesFor(null), void check(false))} />}
                {c.id === 'tests' && testShare !== null && (
                  <div className="release-test-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(testShare * 100)}>
                    <div style={{ width: `${Math.min(100, testShare * 100)}%` }} />
                  </div>
                )}
                {c.state !== 'pass' && <Details output={c.output} />}
              </div>
            </div>
          ))}
          {pre && (
            <div className="release-checks-end">
              {ready ? (
                <button className={`btn btn-primary${confirm ? ' appstudio-confirm' : ''}`} disabled={releasing} onClick={() => void release()} onBlur={() => setConfirm(false)}>
                  {releasing ? <Loader2 size={14} className="spin" /> : <Rocket size={14} />} {releasing ? `Releasing v${next}…` : confirm ? `Release v${next}? It goes out to everyone` : `Everything’s ready. Release v${next}`}
                </button>
              ) : (
                <span className="muted">{tests?.state === 'running' || !tests ? (problems ? `${problems === 1 ? '1 thing needs' : `${problems} things need`} sorting first. The tests are still running.` : 'Waiting for the tests…') : `${problems === 1 ? '1 thing needs' : `${problems} things need`} sorting first.`}</span>
              )}
            </div>
          )}
        </div>
      )}
      {releasing && !pre && (
        <p className="muted">
          <Loader2 size={13} className="spin" /> Releasing…
        </p>
      )}
      {result && (
        <div className={`release-result${result.ok ? ' ok' : ''}`}>
          <strong>{result.ok ? result.text : result.problem ? result.problem.title : result.text}</strong>
          {!result.ok && result.problem && (
            <>
              <span>
                {result.text} {result.problem.detail}
              </span>
              <FixButtons fixes={result.problem.fixes} main={main} context={context(result.problem, { output: result.output, tag: result.tag })} />
            </>
          )}
          {notesFor && !pre && <NotesWriter project={project} repo={repo} version={notesFor} onCancel={() => setNotesFor(null)} onDone={() => setNotesFor(null)} />}
          <Details output={result.output} label={result.ok ? 'Show what git said' : 'Show what it said'} />
        </div>
      )}
      {result?.ok && result.tag && repo && info?.releaseWorkflow && <BuildCard project={project} appKey={appKey} repo={repo} tag={result.tag} inline />}
    </div>
  )
}

const RECOVERY_LABELS: Record<RecoveryId, string> = {
  'finish-push': 'Push it',
  'write-notes': 'Write the What’s new notes',
  rerun: 'Run the failed builds again',
  retag: 'Build again from the latest commit',
  'give-up': 'Give up on this version'
}

const RECOVERY_HINTS: Record<RecoveryId, string> = {
  'finish-push': 'Pushes the version commit and tag, and GitHub builds it',
  'write-notes': 'Adds the notes to the app’s code and commits them. Then build again.',
  rerun: 'For a failure by chance (a download that timed out). The same code is built again.',
  retag: 'Once the fix is committed: moves the tag to the latest commit and pushes it, so GitHub builds that instead',
  'give-up': 'Deletes the draft release and the tag. The next release can use this number again.'
}

/** Inline build cards showing now, by folder, so the one lower down the page steps aside for them. */
const useInlineBuild = create<Record<string, number>>(() => ({}))
const inlineBuild = (folder: string, by: number): void => useInlineBuild.setState((s) => ({ [folder]: Math.max(0, (s[folder] ?? 0) + by) }))

const JOB_ICON: Record<JobState, ReactNode> = {
  waiting: <Clock size={14} />,
  running: <Loader2 size={14} className="spin" />,
  done: <CheckIcon size={14} />,
  failed: <X size={14} />,
  skipped: <CircleSlash size={14} />,
  cancelled: <CircleSlash size={14} />
}

const stepIcon = (s: BuildStep): ReactNode =>
  s.status !== 'completed' ? (
    s.status === 'in_progress' ? <Loader2 size={12} className="spin" /> : <Circle size={12} />
  ) : s.conclusion === 'success' ? (
    <CheckIcon size={12} />
  ) : s.conclusion === 'skipped' ? (
    <CircleSlash size={12} />
  ) : (
    <X size={12} />
  )

/** GitHub's build, job by job (Windows, Mac…): where each is up to, its time so far and time left. */
function BuildJobs({ jobs, now }: { jobs: BuildJob[]; now: number }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  return (
    <ul className="build-jobs">
      {jobs.map((j) => {
        const p = jobProgress(j, now)
        // A failed job shows its steps until it's closed, so the one that failed is in view.
        const shown = open[j.name] ?? p.state === 'failed'
        const steps = j.steps?.filter((s) => s.conclusion !== 'skipped') ?? []
        return (
          <li key={j.name} className={`build-job build-job-${p.state}`}>
            <button className="build-job-top" onClick={() => setOpen((o) => ({ ...o, [j.name]: !shown }))} disabled={!steps.length} title={steps.length ? (shown ? 'Hide the steps' : 'Show the steps') : undefined}>
              <span className="build-job-icon">{JOB_ICON[p.state]}</span>
              <strong>{p.label}</strong>
              <span className="build-job-text">{p.text}</span>
              <span className="board-spacer" />
              <span className="build-job-time">
                {p.state === 'running' && p.elapsed ? `${p.elapsed}${p.left ? ` · ${p.left}` : ''}` : p.state !== 'done' ? p.elapsed : ''}
              </span>
              {!!steps.length && (shown ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
            </button>
            {p.state === 'running' && p.share !== undefined && (
              <div className="release-test-bar build-job-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p.share * 100)}>
                <div style={{ width: `${Math.max(3, p.share * 100)}%` }} />
              </div>
            )}
            {shown && (
              <ol className="build-steps">
                {steps.map((s, i) => (
                  <li key={i} className={`build-step build-step-${s.status === 'completed' ? (s.conclusion ?? 'done') : s.status}`}>
                    {stepIcon(s)} {s.name}
                  </li>
                ))}
              </ol>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * After a release: what GitHub's build is doing. While it builds, each job (Windows, Mac…) with the
 * step it's on, its time so far and time left; once it's done, a link to the release, or if it
 * fails, why (read from the build's log) and buttons to get it out anyway. `inline` is the one
 * shown straight after pressing release; `tag` is the version to watch (else the app's own).
 */
export function BuildCard({ project, appKey, repo, tag: forTag, inline }: { project: TerminalProject; appKey: string; repo: string; tag?: string; inline?: boolean }) {
  const info = useAppStudio((s) => s.info[project.folder])
  const tick = useBuildTick((s) => s.tick)
  const shownInline = useInlineBuild((s) => (s[project.folder] ?? 0) > 0)
  const [status, setStatus] = useState<BuildStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<RecoveryId | null>(null)
  const [confirm, setConfirm] = useState<RecoveryId | null>(null)
  const [writing, setWriting] = useState(false)
  const [now, setNow] = useState(Date.now())
  const tag = forTag ?? (info?.version ? `v${info.version}` : null)
  const shown = useRef(Date.now())
  const lastPhase = useRef<string | null>(null)

  useEffect(() => {
    if (!inline) return
    inlineBuild(project.folder, 1)
    return () => inlineBuild(project.folder, -1)
  }, [inline, project.folder])

  // The card lower down the page sits still while one shows straight after a release.
  const active = !!inline || !shownInline

  const load = async (): Promise<void> => {
    if (!active || !tag || !/^v\d+\.\d+\.\d+$/.test(tag)) return
    setLoading(true)
    try {
      setStatus(await window.api.appsBuildStatus(project.folder, repo, tag))
    } catch (err) {
      setStatus({ tag, tagHere: false, tagOnGitHub: false, tagIsHead: false, error: errorMessage(err) })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [tag, tick, active])

  const phase = status ? buildPhase(status) : 'unknown'
  const watching = active && (phase === 'building' || phase === 'waiting' || (inline && !status))
  // While GitHub builds, look again every 10 seconds, and keep the clocks ticking in between.
  useEffect(() => {
    if (!watching) return
    const look = window.setInterval(() => void load(), 10_000)
    const clock = window.setInterval(() => setNow(Date.now()), 1000)
    return () => (window.clearInterval(look), window.clearInterval(clock))
  }, [watching, tag])

  // Say so when a build that was being watched finishes, wherever you are in Orbit.
  useEffect(() => {
    if (!status || !active) return
    const before = lastPhase.current
    lastPhase.current = phase
    if (before !== 'building' && before !== 'waiting') return
    if (phase === 'published') {
      notify(`${tag} is out on GitHub.`, 'info')
      void loadReleases(repo)
    } else if (phase === 'failed') notify(`GitHub’s build of ${tag} failed. See App Studio’s Releases for why.`, 'error')
  }, [status])

  if (!inline && shownInline) return null
  if (!status || !tag) {
    return inline ? (
      <div className="release-build-live">
        <span className="muted">
          <Loader2 size={13} className="spin" /> Asking GitHub how the build’s going…
        </span>
      </div>
    ) : null
  }
  if (!status.tagHere && !status.tagOnGitHub && !status.release) return null
  if (phase === 'published' && !status.error && !inline) {
    return (
      <div className="release-build ok">
        <CheckIcon size={14} /> {tag} is out{status.run ? ` (${jobsLine(status.run.jobs)})` : ''}.
        {status.release && (
          <a className="link-button" href={status.release.url} target="_blank" rel="noreferrer">
            Open on GitHub
          </a>
        )}
      </div>
    )
  }

  const actions = recoveryActions(status)
  const act = async (a: RecoveryId): Promise<void> => {
    if (a === 'give-up' && confirm !== a) {
      setConfirm(a)
      return
    }
    setConfirm(null)
    if (a === 'write-notes') {
      setWriting(true)
      return
    }
    setBusy(a)
    try {
      if (a === 'rerun' && status.run) {
        await window.api.appsRerunBuild(repo, status.run.id)
        notify('GitHub is building it again.', 'info')
      } else {
        const r = await window.api.appsReleaseFix(project.folder, a === 'give-up' ? 'delete-tag' : a, tag)
        notify(r.message, r.ok ? 'info' : 'error')
      }
      void refreshApps()
      void loadReleases(repo)
      window.setTimeout(() => void load(), 4000)
    } catch (err) {
      notify(errorMessage(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  const jobs = status.run?.jobs ?? []
  const done = jobs.filter((j) => j.status === 'completed' && j.conclusion === 'success').length
  const headline: Record<string, string> = {
    'not-pushed': `${tag} was made on this computer but never reached GitHub.`,
    waiting: `${tag} is on GitHub. Waiting for the build to start (${clockTime(now - shown.current)})…`,
    building: `GitHub is building ${tag}${jobs.length ? `: ${done} of ${jobs.length} jobs done` : ''}.`,
    failed: `GitHub’s build of ${tag} failed, so it isn’t out yet.`,
    draft: `${tag} is still a draft on GitHub: its build didn’t finish.`,
    published: `${tag} is out! The installers are on GitHub for everyone.`,
    unknown: `Couldn’t tell what GitHub is doing with ${tag}.`
  }
  const time = status.run ? runTimeText(status.run, now) : ''
  const share = phase === 'building' && jobs.length ? jobs.reduce((sum, j) => sum + (jobProgress(j, now).share ?? 0), 0) / jobs.length : null

  return (
    <section className={`appstudio-card release-build-card release-build-${phase}${inline ? ' release-build-inline' : ''}`}>
      <div className="appstudio-card-top">
        {phase === 'building' || phase === 'waiting' ? <Loader2 size={16} className="spin" /> : phase === 'published' ? <CheckIcon size={16} /> : phase === 'failed' || phase === 'not-pushed' || phase === 'draft' ? <AlertTriangle size={16} /> : <Hammer size={16} />}
        <h3>{inline ? `GitHub’s build of ${tag}` : `${tag} on GitHub`}</h3>
        <span className="board-spacer" />
        {time && <span className="build-run-time">{time}</span>}
        <button className="icon-btn" title="Look again" disabled={loading} onClick={() => void load()}>
          {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
        </button>
      </div>
      <strong>{headline[phase]}</strong>
      {share !== null && (
        <div className="release-test-bar build-run-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
          <div style={{ width: `${Math.max(2, share * 100)}%` }} />
        </div>
      )}
      {!!jobs.length && <BuildJobs jobs={jobs} now={now} />}
      {phase === 'published' && status.release && (
        <div className="release-fixes">
          <a className="btn btn-primary" href={status.release.url} target="_blank" rel="noreferrer">
            <ExternalLink size={13} /> Open the release on GitHub
          </a>
        </div>
      )}
      {status.problem && (phase === 'failed' || phase === 'draft') && (
        <div className="release-result">
          <strong>{status.problem.title}</strong>
          <span>{status.problem.detail}</span>
          {status.problem.fixes.includes('ask-claude') && (
            <FixButtons
              fixes={['ask-claude']}
              context={{ project, appKey, repo, version: tag.slice(1), tag, problem: status.problem, output: status.log, writeNotes: () => setWriting(true), after: () => void load() }}
            />
          )}
          <Details output={status.log} label="Show the build’s log" />
        </div>
      )}
      {writing && (
        <NotesWriter
          project={project}
          repo={repo}
          version={tag.slice(1)}
          onCancel={() => setWriting(false)}
          onDone={() => {
            setWriting(false)
            notify(`Now press “${RECOVERY_LABELS.retag}” so GitHub builds it with the notes.`, 'info')
            void load()
          }}
        />
      )}
      {!!actions.length && (
        <div className="release-fixes">
          {actions.map((a) => {
            const blocked = a === 'retag' && status.tagIsHead ? 'The tag is already on the latest commit. Commit the fix first (Write the What’s new notes does that), then build again.' : ''
            return (
              <button
                key={a}
                className={`btn${a === actions[0] ? ' btn-primary' : ''}${confirm === a ? ' appstudio-confirm' : ''}`}
                disabled={!!busy || !!blocked}
                title={blocked || RECOVERY_HINTS[a]}
                onClick={() => void act(a)}
                onBlur={() => confirm === a && setConfirm(null)}
              >
                {busy === a && <Loader2 size={13} className="spin" />} {confirm === a ? `Delete the ${tag} draft and tag?` : RECOVERY_LABELS[a]}
              </button>
            )
          })}
        </div>
      )}
      {status.error && <span className="muted">{status.error}</span>}
      {status.run && (
        <a className="link-button" href={status.run.url} target="_blank" rel="noreferrer">
          <ExternalLink size={12} /> Open the build on GitHub
        </a>
      )}
    </section>
  )
}
