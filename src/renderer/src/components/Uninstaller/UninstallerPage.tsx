import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppWindow, Check, File, Folder, FolderOpen, KeyRound, Link2, Loader2, PackageX, RefreshCw, Search, X } from 'lucide-react'
import { notify } from '../../store/notify'
import { FILE_MANAGER, IS_MAC, TRASH_NAME } from '@shared/platform'
import {
  formatSize,
  searchApps,
  sortApps,
  totalSize,
  type AppSort,
  type InstalledApp,
  type Leftover,
  type LeftoverKind,
  type LeftoverScan,
  type RemoveResult
} from '@shared/uninstaller'

/**
 * The clean uninstaller (main/uninstaller.ts): pick an app, remove it, then see what it left
 * behind and choose what goes to the Recycle Bin / Bin. Nothing is removed without a confirmation.
 */

type Stage =
  | { kind: 'running'; app: InstalledApp }
  | { kind: 'failed'; app: InstalledApp; problem: string }
  | { kind: 'scanning'; app: InstalledApp }
  | { kind: 'review'; scan: LeftoverScan }
  | { kind: 'removing'; scan: LeftoverScan }
  | { kind: 'done'; app: InstalledApp; result: RemoveResult; freed: number }

const KIND_ICON: Record<LeftoverKind, typeof File> = { app: AppWindow, folder: Folder, file: File, shortcut: Link2, registry: KeyRound }

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

function AppIcon({ app }: { app: InstalledApp }) {
  return app.icon ? <img className="un-icon" src={app.icon} alt="" /> : <AppWindow className="un-icon" size={22} />
}

export default function UninstallerPage() {
  const [apps, setApps] = useState<InstalledApp[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<AppSort>('name')
  const [stage, setStage] = useState<Stage | null>(null)
  const live = useRef(true)

  const load = useCallback(async (): Promise<void> => {
    setApps(null)
    const list = await window.api.uninstallList().catch((err) => ({ apps: [], problem: String((err as Error).message ?? err) }))
    if (!live.current) return
    setApps(list.apps)
    setProblem(list.problem ?? null)
  }, [])

  useEffect(() => {
    live.current = true
    void load()
    return () => {
      live.current = false
    }
  }, [load])

  const shown = useMemo(() => sortApps(searchApps(apps ?? [], query), sort), [apps, query, sort])

  const scan = useCallback(async (app: InstalledApp): Promise<void> => {
    setStage({ kind: 'scanning', app })
    try {
      const result = await window.api.uninstallScan(app.id)
      if (live.current) setStage({ kind: 'review', scan: result })
    } catch (err) {
      if (live.current) setStage({ kind: 'failed', app, problem: String((err as Error).message ?? err) })
    }
  }, [])

  const start = async (app: InstalledApp): Promise<void> => {
    if (IS_MAC) return scan(app)
    const ok = await window.api.confirm({
      type: 'warning',
      message: `Uninstall ${app.name}?`,
      detail: `Orbit runs ${app.name}’s own uninstaller first${app.forEveryone ? ' (Windows may ask for permission)' : ''}. Then it shows you what was left behind, and nothing more is removed until you choose.`,
      ok: 'Uninstall'
    })
    if (!ok) return
    setStage({ kind: 'running', app })
    const result = await window.api.uninstallRun(app.id).catch((err) => ({ started: false, gone: false, problem: String((err as Error).message ?? err) }))
    if (!live.current) return
    if (result.gone) return scan(app)
    if (!result.started) return setStage({ kind: 'failed', app, problem: result.problem ?? 'The uninstaller didn’t run.' })
    // Still listed: it's probably still going (many hand over to a copy of themselves). Keep checking below.
  }

  // While an uninstaller runs, look every couple of seconds for the app to be gone.
  const runningId = stage?.kind === 'running' ? stage.app.id : null
  useEffect(() => {
    if (!runningId || stage?.kind !== 'running') return
    const app = stage.app
    const timer = setInterval(() => {
      void window.api.uninstallGone(runningId).then((gone) => {
        if (gone && live.current) {
          clearInterval(timer)
          void scan(app)
        }
      })
    }, 2000)
    return () => clearInterval(timer)
  }, [runningId, scan])

  const back = (): void => {
    setStage(null)
    void load()
  }

  return (
    <div className="screens-page un-page" data-uninstaller>
      <div className="screens-inner">
        <header className="screens-head">
          <h2>
            <PackageX size={18} /> Uninstaller
          </h2>
          {!stage && (
            <button className="btn" onClick={() => void load()} disabled={!apps}>
              <RefreshCw size={14} /> Look again
            </button>
          )}
        </header>
        <p className="screens-intro">
          Removes an app and the settings, caches, logs and shortcuts it leaves behind. You see everything before it goes, and files go to the {TRASH_NAME}, so you can get them back.
        </p>
        {stage ? (
          <StageView stage={stage} setStage={setStage} scan={scan} back={back} />
        ) : (
          <>
            {problem && (
              <div className="screens-problem">
                <p>{problem}</p>
              </div>
            )}
            <div className="un-bar">
              <label className="tm-search">
                <Search size={14} />
                <input className="text-input" placeholder="Search apps" value={query} onChange={(e) => setQuery(e.target.value)} />
                {query && (
                  <button className="icon-btn" title="Clear" onClick={() => setQuery('')}>
                    <X size={13} />
                  </button>
                )}
              </label>
              <div className="segmented" role="radiogroup" aria-label="Sort by">
                {(['name', 'size', 'date'] as AppSort[]).map((s) => (
                  <button key={s} className={sort === s ? 'selected' : ''} role="radio" aria-checked={sort === s} onClick={() => setSort(s)}>
                    {s === 'name' ? 'Name' : s === 'size' ? 'Size' : 'Newest'}
                  </button>
                ))}
              </div>
              {apps && <span className="tm-count">{plural(shown.length, 'app')}</span>}
            </div>
            {!apps && <p className="screens-note">Looking at what’s installed…</p>}
            {apps && !shown.length && !problem && <p className="screens-note">{query ? 'No apps match that.' : 'No apps found.'}</p>}
            <ul className="un-list">
              {shown.map((a) => (
                <li key={a.id} className="un-row">
                  <AppIcon app={a} />
                  <div className="un-name">
                    <strong>{a.name}</strong>
                    <span>{[a.publisher, a.version].filter(Boolean).join(' · ')}</span>
                  </div>
                  <span className="un-size">{formatSize(a.size)}</span>
                  <span className="un-date">{a.installedAt ?? ''}</span>
                  <button className="btn un-go" onClick={() => void start(a)}>
                    Uninstall
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

function StageView({
  stage,
  setStage,
  scan,
  back
}: {
  stage: Stage
  setStage: (s: Stage) => void
  scan: (app: InstalledApp) => Promise<void>
  back: () => void
}) {
  if (stage.kind === 'running')
    return (
      <div className="un-card">
        <div className="un-card-head">
          <AppIcon app={stage.app} />
          <h3>Uninstalling {stage.app.name}</h3>
        </div>
        <p>
          <Loader2 size={14} className="spin" /> {stage.app.name}’s uninstaller is open. Follow its steps; when it’s finished, Orbit looks for what it left behind.
        </p>
        <div className="un-actions">
          <button className="btn btn-primary" onClick={() => void scan(stage.app)}>
            It’s finished
          </button>
          <button className="btn" onClick={back}>
            Stop waiting
          </button>
        </div>
      </div>
    )
  if (stage.kind === 'failed')
    return (
      <div className="un-card">
        <div className="un-card-head">
          <AppIcon app={stage.app} />
          <h3>{stage.app.name}</h3>
        </div>
        <p>{stage.problem}</p>
        <div className="un-actions">
          <button className="btn" onClick={back}>
            Back to apps
          </button>
          {!IS_MAC && (
            <button className="btn" onClick={() => void scan(stage.app)} title="Only if you’ve removed it some other way: its files may still be in use otherwise">
              Look for leftovers anyway
            </button>
          )}
        </div>
      </div>
    )
  if (stage.kind === 'scanning')
    return (
      <div className="un-card">
        <div className="un-card-head">
          <AppIcon app={stage.app} />
          <h3>{stage.app.name}</h3>
        </div>
        <p>
          <Loader2 size={14} className="spin" /> Looking for what {stage.app.name} {IS_MAC ? 'keeps on this Mac' : 'left behind'}…
        </p>
      </div>
    )
  if (stage.kind === 'done') return <DoneView stage={stage} back={back} />
  return <ReviewView scan={stage.scan} busy={stage.kind === 'removing'} setStage={setStage} back={back} />
}

function ReviewView({ scan, busy, setStage, back }: { scan: LeftoverScan; busy: boolean; setStage: (s: Stage) => void; back: () => void }) {
  const { app, items } = scan
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(items.map((i) => i.id)))
  const [running, setRunning] = useState(!!scan.running)
  const appItem = items.find((i) => i.kind === 'app')
  const appTicked = !!appItem && ticked.has(appItem.id)
  const count = ticked.size
  const size = totalSize(items, ticked)

  const groups = useMemo(() => {
    const by = new Map<string, Leftover[]>()
    for (const i of items) by.set(i.where, [...(by.get(i.where) ?? []), i])
    return [...by.entries()]
  }, [items])

  const toggle = (id: string): void =>
    setTicked((t) => {
      const next = new Set(t)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      // On a Mac the app's files only go with the app (it would still use them otherwise).
      if (appItem && id === appItem.id && !next.has(id)) return new Set()
      if (appItem && id !== appItem.id && next.has(id)) next.add(appItem.id)
      return next
    })

  const quit = async (): Promise<void> => {
    const ok = await window.api.uninstallQuit(app.id)
    setRunning(!ok)
    if (!ok) notify(`${app.name} is still open. Quit it yourself (it may be asking to save something), then try again.`)
  }

  const remove = async (): Promise<void> => {
    if (!count) return
    const registry = items.filter((i) => ticked.has(i.id) && i.kind === 'registry').length
    const files = count - registry
    const parts = [files && `${plural(files, 'item')} go${files === 1 ? 'es' : ''} to the ${TRASH_NAME}`, registry && `${plural(registry, 'registry setting')} ${registry === 1 ? 'is' : 'are'} saved to a backup file, then removed`].filter(Boolean)
    const ok = await window.api.confirm({
      type: 'warning',
      message: appTicked ? `Remove ${app.name} and its files?` : `Remove ${plural(count, 'leftover')} from ${app.name}?`,
      detail: `${parts.join('; ')}.${size ? ` That frees about ${formatSize(size)} once the ${TRASH_NAME} is emptied.` : ''}`,
      ok: appTicked ? 'Remove' : `Move to ${TRASH_NAME}`
    })
    if (!ok) return
    setStage({ kind: 'removing', scan })
    try {
      const result = await window.api.uninstallRemove(scan.scanId, [...ticked])
      setStage({ kind: 'done', app, result, freed: result.failed.length ? 0 : size })
    } catch (err) {
      notify(err)
      setStage({ kind: 'review', scan })
    }
  }

  if (!items.length)
    return (
      <div className="un-card">
        <div className="un-card-head">
          <AppIcon app={app} />
          <h3>{app.name} is gone</h3>
        </div>
        <p>
          <Check size={14} /> Nothing was left behind.
        </p>
        <div className="un-actions">
          <button className="btn btn-primary" onClick={back}>
            Back to apps
          </button>
        </div>
      </div>
    )

  return (
    <div className="un-card">
      <div className="un-card-head">
        <AppIcon app={app} />
        <h3>{appItem ? `Remove ${app.name}` : `What ${app.name} left behind`}</h3>
      </div>
      {running && appItem && (
        <div className="screens-problem">
          <p>{app.name} is open. It has to be quit before it can go in the Bin.</p>
          <button className="btn" onClick={() => void quit()}>
            Quit {app.name}
          </button>
        </div>
      )}
      <p className="screens-note">Untick anything you want to keep. Only things named after {app.name} are listed; Orbit never touches system folders.</p>
      {groups.map(([where, list]) => (
        <section key={where} className="un-group">
          <h4>{where}</h4>
          <ul>
            {list.map((i) => {
              const Icon = KIND_ICON[i.kind]
              return (
                <li key={i.id} className="un-item">
                  <label>
                    <input type="checkbox" checked={ticked.has(i.id)} disabled={busy} onChange={() => toggle(i.id)} />
                    <Icon size={14} />
                    <span className="un-path" title={i.path}>
                      {i.path}
                    </span>
                  </label>
                  <span className="un-size">{formatSize(i.size)}</span>
                  {i.kind !== 'registry' && (
                    <button className="icon-btn" title={`Show in ${FILE_MANAGER}`} onClick={() => void window.api.uninstallReveal(i.path)}>
                      <FolderOpen size={13} />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
      <div className="un-actions">
        <button className="btn btn-primary" disabled={busy || !count || (running && appTicked)} onClick={() => void remove()}>
          {busy ? <Loader2 size={14} className="spin" /> : <PackageX size={14} />}
          {appTicked ? `Remove ${app.name}` : `Move ${plural(count, 'item')} to the ${TRASH_NAME}`}
          {size ? ` (${formatSize(size)})` : ''}
        </button>
        <button className="btn" disabled={busy} onClick={back}>
          {appItem ? 'Cancel' : 'Keep them'}
        </button>
      </div>
    </div>
  )
}

function DoneView({ stage, back }: { stage: Extract<Stage, { kind: 'done' }>; back: () => void }) {
  const { app, result, freed } = stage
  return (
    <div className="un-card">
      <div className="un-card-head">
        <AppIcon app={app} />
        <h3>{result.failed.length ? `${app.name}: mostly done` : `${app.name} is gone`}</h3>
      </div>
      <p>
        <Check size={14} /> Removed {plural(result.removed, 'item')}
        {freed ? `, about ${formatSize(freed)}` : ''}. Files are in the {TRASH_NAME} until you empty it.
      </p>
      {result.backup && <p className="screens-note">Its registry settings were saved first, in {result.backup}. Double-click a .reg file there to put them back.</p>}
      {result.failed.length > 0 && (
        <div className="screens-problem">
          <p>These were left where they are:</p>
          <ul className="un-failed">
            {result.failed.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="un-actions">
        <button className="btn btn-primary" onClick={back}>
          Back to apps
        </button>
      </div>
    </div>
  )
}
