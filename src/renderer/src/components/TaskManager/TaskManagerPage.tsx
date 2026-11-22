import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Activity, AppWindow, ChevronDown, ChevronRight, Copy, Cpu, FolderOpen, HardDrive, MemoryStick, Search, Wifi, X, XCircle } from 'lucide-react'
import { notify } from '../../store/notify'
import ContextMenu, { type MenuItem } from '../ContextMenu'
import { FILE_MANAGER, IS_MAC } from '@shared/platform'
import {
  canEnd,
  emptyHistory,
  formatBits,
  formatBytes,
  formatPercent,
  formatRate,
  formatUptime,
  graphPoints,
  heat,
  HISTORY,
  KIND_TITLES,
  nextSort,
  pushHistory,
  searchGroups,
  sections,
  type EndTarget,
  type PerfHistory,
  type SortBy,
  type SortKey,
  type TaskGroup,
  type TaskProc,
  type TaskSnapshot
} from '@shared/taskManager'

/** How often to look again while the page shows (a Mac runs a few small commands each time). */
const EVERY = IS_MAC ? 2000 : 1500

type View = 'processes' | 'performance'

/** What's selected: a whole program, or one of its processes. */
interface Selected {
  group: string
  pid?: number
}

/** The computer's use, looked at every couple of seconds while the page is open and the window is in view. */
function useTasks(): { snap: TaskSnapshot | null; history: PerfHistory; look: () => Promise<void> } {
  const [snap, setSnap] = useState<TaskSnapshot | null>(null)
  const [history, setHistory] = useState<PerfHistory>(emptyHistory)
  const live = useRef(true)
  const look = useCallback(async (): Promise<void> => {
    const s = await window.api.tasksGet().catch(() => null)
    if (!live.current || !s) return
    setSnap(s)
    if (!s.problem) setHistory((h) => pushHistory(h, s.perf))
  }, [])
  useEffect(() => {
    live.current = true
    let timer: ReturnType<typeof setTimeout>
    // One look at a time: the next waits for this one (a slow first look on Windows doesn't pile up).
    const tick = async (): Promise<void> => {
      if (!document.hidden) await look()
      if (live.current) timer = setTimeout(() => void tick(), EVERY)
    }
    void tick()
    return () => {
      live.current = false
      clearTimeout(timer)
    }
  }, [look])
  return { snap, history, look }
}

/** The processes a selection means, for ending: one process, or every one in the program. */
function targetsOf(group: TaskGroup, pid?: number): EndTarget[] {
  const procs = pid === undefined ? group.procs : group.procs.filter((p) => p.pid === pid)
  return procs.map((p) => ({ pid: p.pid, name: p.name }))
}

/** Why a selection can't be ended, or null if it can. */
function endBlocked(group: TaskGroup, pid?: number): string | null {
  const procs = pid === undefined ? group.procs : group.procs.filter((p) => p.pid === pid)
  for (const p of procs) {
    const check = canEnd(p.name, p.pid, !!group.self)
    if (!check.ok) return check.why ?? 'Orbit won’t end this.'
  }
  return procs.length ? null : 'It has already closed.'
}

export default function TaskManagerPage() {
  const { snap, history, look } = useTasks()
  const [view, setView] = useState<View>('processes')
  return (
    <div className="screens-page tm-page" data-task-manager>
      <div className="screens-inner tm-inner">
        <header className="screens-head">
          <h2>
            <Activity size={18} /> Task manager
          </h2>
          <div className="segmented" role="radiogroup" aria-label="View">
            <button className={view === 'processes' ? 'selected' : ''} role="radio" aria-checked={view === 'processes'} onClick={() => setView('processes')}>
              Processes
            </button>
            <button className={view === 'performance' ? 'selected' : ''} role="radio" aria-checked={view === 'performance'} onClick={() => setView('performance')}>
              Performance
            </button>
          </div>
        </header>
        {!snap && <p className="screens-note">Looking at what’s running…</p>}
        {snap?.problem && (
          <div className="screens-problem">
            <p>{snap.problem}</p>
          </div>
        )}
        {snap && view === 'processes' && <Processes snap={snap} onChanged={look} />}
        {snap && view === 'performance' && <Performance snap={snap} history={history} />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Processes

function Processes({ snap, onChanged }: { snap: TaskSnapshot; onChanged: () => Promise<void> }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortBy>({ key: 'cpu', desc: true })
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [selected, setSelected] = useState<Selected | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; group: TaskGroup; pid?: number } | null>(null)
  const [ending, setEnding] = useState(false)

  const found = useMemo(() => searchGroups(snap.groups, query), [snap.groups, query])
  const parts = useMemo(() => sections(found, sort), [found, sort])
  const selectedGroup = selected ? snap.groups.find((g) => g.id === selected.group) : undefined
  const { perf } = snap

  const end = async (group: TaskGroup, pid?: number): Promise<void> => {
    const blocked = endBlocked(group, pid)
    if (blocked) return notify(blocked)
    const targets = targetsOf(group, pid)
    const one = targets.length === 1
    const label = pid !== undefined ? `${targets[0].name} (${pid})` : group.name
    const ok = await window.api.confirm({
      type: 'warning',
      message: `End ${label}?`,
      detail: one ? 'Anything not saved in it will be lost.' : `This ends all ${targets.length} of its processes. Anything not saved in it will be lost.`,
      ok: 'End task'
    })
    if (!ok) return
    setEnding(true)
    try {
      const result = await window.api.tasksEnd(targets)
      if (result.failed.length) notify(result.failed[0] + (result.failed.length > 1 ? ` (and ${result.failed.length - 1} more)` : ''))
      else notify(`Ended ${label}.`, 'info')
      setSelected(null)
    } catch (err) {
      notify(err)
    } finally {
      setEnding(false)
      await onChanged()
    }
  }

  const menuItems = (group: TaskGroup, pid?: number): MenuItem[] => {
    const proc = pid === undefined ? group.procs[0] : group.procs.find((p) => p.pid === pid)
    const items: MenuItem[] = [{ label: 'End task', icon: <XCircle size={14} />, danger: true, onClick: () => void end(group, pid) }]
    if (proc?.path)
      items.push({
        label: `Show in ${FILE_MANAGER}`,
        icon: <FolderOpen size={14} />,
        onClick: () => void window.api.tasksReveal(proc.pid).then((ok) => !ok && notify('Couldn’t find where it is.'))
      })
    items.push('separator', { label: 'Copy name', icon: <Copy size={14} />, onClick: () => void navigator.clipboard.writeText(pid === undefined ? group.name : (proc?.name ?? group.name)) })
    if (proc && (pid !== undefined || group.procs.length === 1))
      items.push({ label: `Copy process ID (${proc.pid})`, icon: <Copy size={14} />, onClick: () => void navigator.clipboard.writeText(String(proc.pid)) })
    return items
  }

  const toggle = (id: string): void =>
    setOpen((o) => {
      const next = new Set(o)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const head = (key: SortKey, label: string, total?: string): ReactNode => (
    <th className={`tm-col-${key}${sort.key === key ? ' sorted' : ''}`} aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button onClick={() => setSort((s) => nextSort(s, key))}>
        {total !== undefined && <span className="tm-total">{total}</span>}
        <span className="tm-label">
          {label}
          {sort.key === key && <ChevronDown size={12} className={sort.desc ? '' : 'tm-up'} />}
        </span>
      </button>
    </th>
  )

  const cells = (cpu: number, mem: number, disk: number | undefined): ReactNode => (
    <>
      <td className="tm-num" style={heatStyle(heat('cpu', cpu, perf.memTotal))}>
        {formatPercent(cpu)}
      </td>
      <td className="tm-num" style={heatStyle(heat('mem', mem, perf.memTotal))}>
        {formatBytes(mem)}
      </td>
      {snap.hasDisk && (
        <td className="tm-num" style={heatStyle(heat('disk', disk ?? 0, perf.memTotal))}>
          {formatRate(disk ?? 0)}
        </td>
      )}
    </>
  )

  const blocked = selectedGroup ? endBlocked(selectedGroup, selected?.pid) : 'Pick something to end first.'
  const memShare = perf.memTotal > 0 ? (perf.memUsed / perf.memTotal) * 100 : 0
  const columns = snap.hasDisk ? 5 : 4

  return (
    <>
      <div className="tm-bar">
        <label className="tm-search">
          <Search size={14} />
          <input className="text-input" placeholder="Search by name or process ID" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search processes" />
          {query && (
            <button className="icon-btn" title="Clear" onClick={() => setQuery('')}>
              <X size={13} />
            </button>
          )}
        </label>
        <span className="tm-count">
          {snap.perf.processes} processes · {snap.groups.length} programs
        </span>
        <button className="btn tm-end" disabled={!!blocked || ending} title={blocked ?? 'End the selected app or process'} onClick={() => selectedGroup && void end(selectedGroup, selected?.pid)}>
          <XCircle size={13} /> End task
        </button>
      </div>
      <div className="tm-table-wrap">
        <table className="tm-table">
          <thead>
            <tr>
              {head('name', 'Name')}
              {head('pid', IS_MAC ? 'PID' : 'Process ID')}
              {head('cpu', 'CPU', formatPercent(perf.cpu))}
              {head('mem', 'Memory', `${Math.round(memShare)}%`)}
              {snap.hasDisk && head('disk', 'Disk', formatRate((perf.diskRead ?? 0) + (perf.diskWrite ?? 0)))}
            </tr>
          </thead>
          <tbody>
            {parts.map((part) => (
              <Fragment key={part.kind}>
                <tr className="tm-section">
                  <td colSpan={columns}>
                    {KIND_TITLES[part.kind]} ({part.groups.length})
                  </td>
                </tr>
                {part.groups.map((g) => {
                  const many = g.procs.length > 1
                  const isOpen = open.has(g.id) || (many && query.trim() !== '' && /^\d+$/.test(query.trim()))
                  const isSel = selected?.group === g.id && selected.pid === undefined
                  return (
                    <Fragment key={g.id}>
                      <tr
                        className={`tm-row${isSel ? ' selected' : ''}`}
                        data-task-group={g.id}
                        onClick={() => setSelected({ group: g.id })}
                        onDoubleClick={() => many && toggle(g.id)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          setSelected({ group: g.id })
                          setMenu({ x: e.clientX, y: e.clientY, group: g })
                        }}
                      >
                        <td className="tm-name">
                          <div className="tm-cell">
                            {many ? (
                              <button
                                className="icon-btn tm-twisty"
                                aria-label={isOpen ? 'Hide its processes' : 'Show its processes'}
                                aria-expanded={isOpen}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  toggle(g.id)
                                }}
                              >
                                {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                              </button>
                            ) : (
                              <span className="tm-twisty" />
                            )}
                            <ProgramIcon group={g} />
                            <span className="tm-title" title={g.path ?? g.name}>
                              {g.name}
                              {many && <span className="tm-many"> ({g.procs.length})</span>}
                              {g.self && <span className="tm-badge">Orbit</span>}
                            </span>
                          </div>
                        </td>
                        <td className="tm-num tm-pid">{many ? '' : g.procs[0]?.pid}</td>
                        {cells(g.cpu, g.mem, g.disk)}
                      </tr>
                      {many &&
                        isOpen &&
                        g.procs.map((p) => (
                          <ProcRow
                            key={p.pid}
                            proc={p}
                            selected={selected?.group === g.id && selected.pid === p.pid}
                            onSelect={() => setSelected({ group: g.id, pid: p.pid })}
                            onMenu={(x, y) => {
                              setSelected({ group: g.id, pid: p.pid })
                              setMenu({ x, y, group: g, pid: p.pid })
                            }}
                          >
                            {cells(p.cpu, p.mem, p.disk)}
                          </ProcRow>
                        ))}
                    </Fragment>
                  )
                })}
              </Fragment>
            ))}
            {parts.length === 0 && (
              <tr>
                <td colSpan={columns} className="tm-empty">
                  {query ? `Nothing running matches “${query}”.` : 'Nothing to show yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="screens-note">
        Right-click something to end it or find its file. CPU is a share of the whole computer, so everything adds up to 100% at most.
        {!snap.hasDisk && ' macOS doesn’t say how much each app uses the disk, so that’s on Performance as a total.'}
      </p>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.group, menu.pid)} onClose={() => setMenu(null)} />}
    </>
  )
}

function ProcRow({ proc, selected, onSelect, onMenu, children }: { proc: TaskProc; selected: boolean; onSelect: () => void; onMenu: (x: number, y: number) => void; children: ReactNode }) {
  return (
    <tr
      className={`tm-row tm-child${selected ? ' selected' : ''}`}
      data-task-pid={proc.pid}
      onClick={onSelect}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
    >
      <td className="tm-name">
        <div className="tm-cell">
          <span className="tm-twisty" />
          <span className="tm-title" title={proc.path ?? proc.name}>
            {proc.window || proc.name}
          </span>
        </div>
      </td>
      <td className="tm-num tm-pid">{proc.pid}</td>
      {children}
    </tr>
  )
}

function ProgramIcon({ group }: { group: TaskGroup }) {
  if (group.icon) return <img className="tm-icon" src={group.icon} alt="" />
  return (
    <span className="tm-icon">
      <AppWindow size={14} />
    </span>
  )
}

/** Task Manager's yellow-to-orange tint, stronger the busier it is. */
function heatStyle(level: number): CSSProperties | undefined {
  if (level < 0.02) return undefined
  return { background: `color-mix(in srgb, #f59e0b ${Math.round(6 + level * 40)}%, transparent)` }
}

// ---------------------------------------------------------------------------------------------
// Performance

function Performance({ snap, history }: { snap: TaskSnapshot; history: PerfHistory }) {
  const { perf } = snap
  const memShare = perf.memTotal > 0 ? (perf.memUsed / perf.memTotal) * 100 : 0
  const hasDisk = perf.diskRead !== undefined || perf.diskWrite !== undefined || history.disk.some((v) => v > 0)
  const hasNet = perf.netDown !== undefined || perf.netUp !== undefined
  return (
    <div className="tm-perf">
      <PerfCard icon={<Cpu size={15} />} title="CPU" value={formatPercent(perf.cpu)} values={history.cpu} max={100} colour="#5ea8ff">
        <Stat label="Cores" value={String(perf.cores.length)} />
        <Stat label="Processes" value={String(perf.processes)} />
        <Stat label="Up for" value={formatUptime(perf.uptime)} />
        {perf.cpuName && <p className="tm-perf-sub">{perf.cpuName}</p>}
        {perf.cores.length > 1 && (
          <div className="tm-cores" aria-label="Each core">
            {perf.cores.map((c, i) => (
              <span key={i} title={`Core ${i + 1}: ${formatPercent(c)}`}>
                <i style={{ height: `${Math.max(2, c)}%` }} />
              </span>
            ))}
          </div>
        )}
      </PerfCard>
      <PerfCard icon={<MemoryStick size={15} />} title="Memory" value={`${formatBytes(perf.memUsed)} / ${formatBytes(perf.memTotal)}`} values={history.mem} max={100} colour="#a78bfa">
        <Stat label="In use" value={`${Math.round(memShare)}%`} />
        <Stat label="Free" value={formatBytes(Math.max(0, perf.memTotal - perf.memUsed))} />
      </PerfCard>
      {hasDisk && (
        <PerfCard icon={<HardDrive size={15} />} title="Disk" value={formatRate((perf.diskRead ?? 0) + (perf.diskWrite ?? 0))} values={history.disk} colour="#4ade80">
          <Stat label="Reading" value={formatRate(perf.diskRead)} />
          <Stat label="Writing" value={formatRate(perf.diskWrite)} />
        </PerfCard>
      )}
      {hasNet && (
        <PerfCard icon={<Wifi size={15} />} title="Network" value={formatBits((perf.netDown ?? 0) + (perf.netUp ?? 0))} values={history.net} colour="#fb923c">
          <Stat label="Download" value={formatBits(perf.netDown)} />
          <Stat label="Upload" value={formatBits(perf.netUp)} />
        </PerfCard>
      )}
    </div>
  )
}

const GRAPH_W = 300
const GRAPH_H = 80

function PerfCard({ icon, title, value, values, max, colour, children }: { icon: ReactNode; title: string; value: string; values: number[]; max?: number; colour: string; children: ReactNode }) {
  const points = graphPoints(values, GRAPH_W, GRAPH_H, max, HISTORY)
  const first = points.split(' ')[0]?.split(',')[0]
  return (
    <section className="tm-perf-card" data-perf={title.toLowerCase()} style={{ '--tm-colour': colour } as CSSProperties}>
      <header>
        <h3>
          {icon} {title}
        </h3>
        <span className="tm-perf-value">{value}</span>
      </header>
      <svg className="tm-graph" viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`} preserveAspectRatio="none" aria-hidden>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={GRAPH_W} y1={GRAPH_H * f} y2={GRAPH_H * f} className="tm-grid" />
        ))}
        {points && (
          <>
            <polygon points={`${first},${GRAPH_H} ${points} ${GRAPH_W},${GRAPH_H}`} className="tm-fill" />
            <polyline points={points} className="tm-line" />
          </>
        )}
      </svg>
      <div className="tm-stats">{children}</div>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="tm-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
