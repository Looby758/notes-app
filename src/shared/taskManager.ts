/**
 * The task manager (main/taskManager.ts reads the computer, components/TaskManager shows it): what's
 * running, how much CPU, memory and disk each thing uses, the whole computer's use over time, and
 * ending something that's stuck. Everything here is plain logic so it can be tested without a real
 * computer's processes.
 */

/** One process as the system reports it: CPU time and disk I/O are totals since it started. */
export interface RawProc {
  pid: number
  ppid: number
  /** What the system calls it: "chrome.exe", or the last part of the path on a Mac. */
  name: string
  /** Its program file, when the system says (Windows hides it for some system processes). */
  path?: string
  /** CPU time used since it started, in milliseconds. */
  cpuMs: number
  /** Memory in use, in bytes. */
  mem: number
  /** Bytes read and written since it started (Windows only). */
  read?: number
  write?: number
  /** Its main window's title, if it has one (Windows only). */
  window?: string
  /** The program's own description, like "Google Chrome" (Windows only). */
  desc?: string
}

/** The whole computer's counters at one moment; the network and disk ones are totals. */
export interface RawTotals {
  /** When this was read (ms). */
  at: number
  /** Each core's busy and total time so far (os.cpus()). */
  cpus: CpuTimes[]
  memUsed: number
  memTotal: number
  netDown?: number
  netUp?: number
  diskRead?: number
  diskWrite?: number
}

export interface CpuTimes {
  user: number
  nice: number
  sys: number
  idle: number
  irq: number
}

/** One process with its use now, worked out from two readings. */
export interface TaskProc {
  pid: number
  ppid: number
  name: string
  path?: string
  window?: string
  /** Percent of the whole computer's CPU (all cores together, so 0 to 100). */
  cpu: number
  mem: number
  /** Bytes a second read plus written; missing where the system doesn't say (a Mac). */
  disk?: number
}

export type TaskKind = 'app' | 'background' | 'system'

/** A program, with all its processes (Chrome has dozens), like Windows Task Manager's rows. */
export interface TaskGroup {
  /** Stable between readings: the program's path, or its name. */
  id: string
  name: string
  kind: TaskKind
  path?: string
  icon?: string
  /** True for Orbit itself. */
  self?: boolean
  procs: TaskProc[]
  cpu: number
  mem: number
  disk?: number
}

export interface TaskPerf {
  /** Percent of all cores, 0 to 100. */
  cpu: number
  /** Each core's percent. */
  cores: number[]
  cpuName?: string
  memUsed: number
  memTotal: number
  /** Bytes a second. */
  diskRead?: number
  diskWrite?: number
  netDown?: number
  netUp?: number
  /** Seconds since the computer started. */
  uptime: number
  processes: number
}

export interface TaskSnapshot {
  at: number
  groups: TaskGroup[]
  perf: TaskPerf
  /** Whether processes have a disk column (Windows). */
  hasDisk: boolean
  /** Why it couldn't read the processes, said plainly. */
  problem?: string
}

/** What the page asks to end: the name is checked again so a reused process ID isn't ended by mistake. */
export interface EndTarget {
  pid: number
  name: string
}

export interface EndResult {
  ended: number
  /** Plain reasons for the ones that didn't end. */
  failed: string[]
}

// ---------------------------------------------------------------------------------------------
// Reading what the system says

/**
 * CPU time as `ps` writes it, in milliseconds: "0:01.23" (minutes:seconds on a Mac),
 * "01:02:03" (hours:minutes:seconds) or "2-01:02:03" (with days). NaN if it isn't one.
 */
export function parseCpuTime(text: string): number {
  const m = /^(?:(\d+)-)?([\d:.]+)$/.exec(text.trim())
  if (!m) return NaN
  const parts = m[2].split(':')
  if (parts.length > 3 || parts.some((p) => p === '' || isNaN(Number(p)))) return NaN
  const seconds = parts.reduce((total, p) => total * 60 + Number(p), 0)
  return Math.round((Number(m[1] ?? 0) * 86400 + seconds) * 1000)
}

/**
 * `ps -axo pid=,ppid=,rss=,time=,comm=` (a Mac; Linux's ps understands it too). The command is
 * last because a Mac app's path has spaces in it ("/Applications/Google Chrome.app/...").
 */
export function parsePs(text: string): RawProc[] {
  const out: RawProc[] = []
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line)
    if (!m) continue
    const cpuMs = parseCpuTime(m[4])
    if (isNaN(cpuMs)) continue
    const command = m[5]
    const isPath = command.startsWith('/')
    out.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      name: isPath ? command.slice(command.lastIndexOf('/') + 1) : command,
      path: isPath ? command : undefined,
      cpuMs,
      mem: Number(m[3]) * 1024
    })
  }
  return out
}

/** One process from the Windows helper (main/taskManager.ts), with short keys to keep it small. */
export interface WinRawProc {
  i: number
  p: number
  n: string
  x?: string | null
  /** CPU time in 100-nanosecond ticks. */
  c: number
  m: number
  r?: number
  w?: number
  t?: string | null
  d?: string | null
}

export function fromWindows(list: WinRawProc[]): RawProc[] {
  return list
    .filter((p) => p && typeof p.i === 'number' && typeof p.n === 'string')
    .map((p) => ({
      pid: p.i,
      ppid: Number(p.p) || 0,
      name: p.n,
      path: p.x || undefined,
      cpuMs: (Number(p.c) || 0) / 10_000,
      mem: Number(p.m) || 0,
      read: typeof p.r === 'number' ? p.r : undefined,
      write: typeof p.w === 'number' ? p.w : undefined,
      window: p.t || undefined,
      desc: p.d?.trim() || undefined
    }))
}

/**
 * `vm_stat` on a Mac: memory used the way Activity Monitor counts it (in use by apps, wired and
 * compressed; files it's only keeping in case aren't counted). Null if it isn't vm_stat's output.
 */
export function parseVmStat(text: string): number | null {
  const size = /page size of (\d+) bytes/.exec(text)
  if (!size) return null
  const pages = (label: string): number => {
    const m = new RegExp(`^${label}:\\s+(\\d+)`, 'm').exec(text)
    return m ? Number(m[1]) : 0
  }
  const anonymous = pages('Anonymous pages')
  const purgeable = pages('Pages purgeable')
  // "App memory" is anonymous pages that can't just be thrown away; older macOS lacks the count, so fall back to active.
  const app = anonymous ? Math.max(0, anonymous - purgeable) : pages('Pages active')
  const used = app + pages('Pages wired down') + pages('Pages occupied by compressor')
  return used * Number(size[1])
}

/** `netstat -ib` on a Mac: bytes in and out since start, over every interface but the loopback. */
export function parseNetstat(text: string): { down: number; up: number } | null {
  const lines = text.split('\n').filter((l) => l.trim())
  if (!lines.length) return null
  const head = lines[0].trim().split(/\s+/)
  const ibytes = head.indexOf('Ibytes')
  const obytes = head.indexOf('Obytes')
  if (ibytes < 0 || obytes < 0) return null
  let down = 0
  let up = 0
  const seen = new Set<string>()
  for (const line of lines.slice(1)) {
    const cols = line.trim().split(/\s+/)
    // Each interface is listed once per address; the "<Link#n>" row has the full counts and every
    // column. Address rows can be missing a column, so only the link rows are counted.
    if (!cols[2]?.startsWith('<Link#')) continue
    const name = cols[0].replace(/\*$/, '')
    if (name.startsWith('lo') || seen.has(name)) continue
    seen.add(name)
    // The link row has an address column (a MAC address) only for interfaces that have one.
    const shift = cols.length === head.length ? 0 : cols.length - head.length
    down += Number(cols[ibytes + shift]) || 0
    up += Number(cols[obytes + shift]) || 0
  }
  return { down, up }
}

/** `ioreg -c IOBlockStorageDriver -r -k Statistics` on a Mac: bytes read and written since start. */
export function parseIoreg(text: string): { read: number; write: number } | null {
  let read = 0
  let write = 0
  let found = false
  for (const m of text.matchAll(/"Bytes \(Read\)"=(\d+)/g)) {
    read += Number(m[1])
    found = true
  }
  for (const m of text.matchAll(/"Bytes \(Write\)"=(\d+)/g)) {
    write += Number(m[1])
    found = true
  }
  return found ? { read, write } : null
}

// ---------------------------------------------------------------------------------------------
// From two readings to use now

/** Percent busy for each core and all of them, between two os.cpus() readings. */
export function cpuUse(before: CpuTimes[], after: CpuTimes[]): { total: number; cores: number[] } {
  let busyAll = 0
  let totalAll = 0
  const cores = after.map((now, i) => {
    const was = before[i]
    if (!was) return 0
    const busy = now.user + now.nice + now.sys + now.irq - (was.user + was.nice + was.sys + was.irq)
    const total = busy + now.idle - was.idle
    busyAll += Math.max(0, busy)
    totalAll += Math.max(0, total)
    return total > 0 ? clampPercent((busy / total) * 100) : 0
  })
  return { total: totalAll > 0 ? clampPercent((busyAll / totalAll) * 100) : 0, cores }
}

export function clampPercent(n: number): number {
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0
}

/** How fast a total went up, per second; undefined without both readings, 0 if it went down (a counter reset). */
export function rate(before: number | undefined, after: number | undefined, ms: number): number | undefined {
  if (before === undefined || after === undefined || ms <= 0) return undefined
  return Math.max(0, ((after - before) * 1000) / ms)
}

/**
 * Each process's use between two readings. A process that's new (or whose ID was reused by a
 * different program) shows 0% until the next reading. CPU is a share of all cores together, as
 * Windows Task Manager shows it, so everything adds up to 100% at most.
 */
export function procUse(before: Map<number, RawProc>, now: RawProc[], ms: number, cores: number, withDisk: boolean): TaskProc[] {
  const capacity = ms * Math.max(1, cores)
  return now.map((p) => {
    const was = before.get(p.pid)
    const same = !!was && was.name === p.name
    const cpu = same && capacity > 0 ? clampPercent(((p.cpuMs - was!.cpuMs) / capacity) * 100) : 0
    const proc: TaskProc = { pid: p.pid, ppid: p.ppid, name: p.name, path: p.path, window: p.window, cpu, mem: p.mem }
    if (withDisk) {
      const r = same ? rate(was!.read, p.read, ms) : undefined
      const w = same ? rate(was!.write, p.write, ms) : undefined
      proc.disk = (r ?? 0) + (w ?? 0)
    }
    return proc
  })
}

// ---------------------------------------------------------------------------------------------
// Programs, not processes

/** Windows' own processes: shown under "Windows processes" and never ended from Orbit. */
const WINDOWS_SYSTEM = new Set([
  'system',
  'system idle process',
  'idle',
  'registry',
  'memory compression',
  'secure system',
  'smss.exe',
  'csrss.exe',
  'wininit.exe',
  'winlogon.exe',
  'services.exe',
  'lsass.exe',
  'lsaiso.exe',
  'svchost.exe',
  'dwm.exe',
  'fontdrvhost.exe',
  'sihost.exe',
  'ctfmon.exe',
  'spoolsv.exe',
  'explorer.exe',
  'searchhost.exe',
  'startmenuexperiencehost.exe',
  'runtimebroker.exe',
  'taskhostw.exe',
  'conhost.exe',
  'wudfhost.exe',
  'dllhost.exe',
  'audiodg.exe',
  'msmpeng.exe',
  'securityhealthservice.exe'
])

/** Ending these crashes or logs out the computer, so Orbit won't. (Explorer and Finder come back on their own, so they're allowed.) */
const NEVER_END = new Set([
  'system',
  'system idle process',
  'idle',
  'registry',
  'memory compression',
  'secure system',
  'smss.exe',
  'csrss.exe',
  'wininit.exe',
  'winlogon.exe',
  'services.exe',
  'lsass.exe',
  'lsaiso.exe',
  'svchost.exe',
  'dwm.exe',
  'fontdrvhost.exe',
  'kernel_task',
  'launchd',
  'windowserver',
  'loginwindow',
  'kextd',
  'logd',
  'opendirectoryd',
  'systemd',
  'init'
])

/** The outermost app bundle in a Mac path: "/Applications/Google Chrome.app/.../Helper" → that .app. */
export function macBundle(path: string | undefined): { name: string; path: string } | null {
  if (!path) return null
  const m = /^(.*?\/([^/]+)\.app)(?:\/|$)/.exec(path)
  return m ? { name: m[2], path: m[1] } : null
}

const MAC_SYSTEM_DIRS = ['/System/', '/usr/libexec/', '/usr/sbin/', '/sbin/', '/usr/bin/', '/bin/', '/Library/Apple/']

/** Which program a process belongs to, what to call it, and which section it goes under. */
export function programOf(p: RawProc, isMac: boolean): { id: string; name: string; kind: TaskKind; path?: string } {
  const lower = p.name.toLowerCase()
  if (isMac) {
    const bundle = macBundle(p.path)
    if (bundle) {
      // Apple's own apps (Safari, Finder) are apps; the rest of /System is macOS's own.
      const appleApp = bundle.path.startsWith('/System/Applications/') || bundle.path === '/System/Library/CoreServices/Finder.app'
      const system = !appleApp && (bundle.path.startsWith('/System/') || bundle.path.startsWith('/Library/Apple/'))
      return { id: bundle.path, name: bundle.name, kind: system ? 'system' : 'app', path: bundle.path }
    }
    const system = p.pid <= 1 || lower === 'kernel_task' || MAC_SYSTEM_DIRS.some((d) => p.path?.startsWith(d))
    return { id: p.path ?? p.name, name: p.name, kind: system ? 'system' : 'background', path: p.path }
  }
  const kind: TaskKind = WINDOWS_SYSTEM.has(lower) || p.pid <= 4 ? 'system' : p.window ? 'app' : 'background'
  const name = p.desc || p.name.replace(/\.exe$/i, '')
  return { id: (p.path ?? p.name).toLowerCase(), name, kind, path: p.path }
}

const KIND_RANK: Record<TaskKind, number> = { app: 0, background: 1, system: 2 }

/**
 * Processes grouped into programs. A program with any window is an app (so Chrome's helpers sit
 * with Chrome); Orbit's own processes are marked so the page can say so.
 */
export function groupProcs(raw: RawProc[], use: TaskProc[], isMac: boolean, selfPids: ReadonlySet<number>): TaskGroup[] {
  const byPid = new Map(use.map((u) => [u.pid, u]))
  const groups = new Map<string, TaskGroup>()
  for (const p of raw) {
    const u = byPid.get(p.pid)
    if (!u) continue
    const prog = programOf(p, isMac)
    let g = groups.get(prog.id)
    if (!g) {
      g = { id: prog.id, name: prog.name, kind: prog.kind, path: prog.path, procs: [], cpu: 0, mem: 0 }
      groups.set(prog.id, g)
    }
    // The description of the program's first process can be missing; take any that has one.
    if (!isMac && p.desc && g.name === p.name.replace(/\.exe$/i, '')) g.name = p.desc
    if (KIND_RANK[prog.kind] < KIND_RANK[g.kind]) g.kind = prog.kind
    if (selfPids.has(p.pid)) g.self = true
    g.procs.push(u)
    g.cpu += u.cpu
    g.mem += u.mem
    if (u.disk !== undefined) g.disk = (g.disk ?? 0) + u.disk
  }
  for (const g of groups.values()) {
    g.cpu = clampPercent(g.cpu)
    g.procs.sort((a, b) => b.cpu - a.cpu || b.mem - a.mem || a.pid - b.pid)
  }
  return [...groups.values()]
}

/** Whether Orbit lets you end this, and if not, why (in words for the page). */
export function canEnd(name: string, pid: number, isSelf: boolean): { ok: boolean; why?: string } {
  if (isSelf) return { ok: false, why: 'That’s Orbit. Quit it from its menu instead.' }
  if (pid <= 4 || NEVER_END.has(name.toLowerCase())) return { ok: false, why: 'The computer needs this to keep running, so Orbit won’t end it.' }
  return { ok: true }
}

// ---------------------------------------------------------------------------------------------
// Sorting and searching

export type SortKey = 'name' | 'cpu' | 'mem' | 'disk' | 'pid'
export interface SortBy {
  key: SortKey
  /** Biggest first (names: Z to A). */
  desc: boolean
}

/** The usual way round for each column: names A to Z, numbers biggest first. */
export function nextSort(current: SortBy, key: SortKey): SortBy {
  if (current.key === key) return { key, desc: !current.desc }
  return { key, desc: key !== 'name' && key !== 'pid' }
}

function groupValue(g: TaskGroup, key: SortKey): number {
  if (key === 'cpu') return g.cpu
  if (key === 'mem') return g.mem
  if (key === 'disk') return g.disk ?? 0
  if (key === 'pid') return Math.min(...g.procs.map((p) => p.pid))
  return 0
}

export function sortGroups(groups: TaskGroup[], by: SortBy): TaskGroup[] {
  const dir = by.desc ? -1 : 1
  return [...groups].sort((a, b) => {
    const diff = by.key === 'name' ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) : groupValue(a, by.key) - groupValue(b, by.key)
    // Ties keep a steady order by name, so rows don't swap places every second.
    return diff * dir || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  })
}

/**
 * Programs matching a search: every word must be in the program's name, a process's name, its
 * window title or its path, or be a process ID. A program whose processes only partly match keeps
 * just the matching processes when the search was for an ID.
 */
export function searchGroups(groups: TaskGroup[], query: string): TaskGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return groups
  const out: TaskGroup[] = []
  for (const g of groups) {
    const text = [g.name, g.path ?? '', ...g.procs.flatMap((p) => [p.name, p.window ?? ''])].join('\n').toLowerCase()
    if (words.every((w) => text.includes(w))) {
      out.push(g)
      continue
    }
    if (words.length === 1 && /^\d+$/.test(words[0])) {
      const procs = g.procs.filter((p) => String(p.pid) === words[0])
      if (procs.length) out.push({ ...g, procs })
    }
  }
  return out
}

export const KIND_TITLES: Record<TaskKind, string> = { app: 'Apps', background: 'Background', system: 'System' }

/** The programs in Task Manager's sections, each sorted; empty sections are left out. */
export function sections(groups: TaskGroup[], by: SortBy): { kind: TaskKind; groups: TaskGroup[] }[] {
  return (['app', 'background', 'system'] as TaskKind[])
    .map((kind) => ({
      kind,
      groups: sortGroups(
        groups.filter((g) => g.kind === kind),
        by
      )
    }))
    .filter((s) => s.groups.length > 0)
}

// ---------------------------------------------------------------------------------------------
// Showing numbers

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

export function formatRate(bytesPerSecond: number | undefined): string {
  if (bytesPerSecond === undefined) return '—'
  if (bytesPerSecond < 0.05 * 1024 * 1024) return bytesPerSecond < 1024 ? '0 MB/s' : `${formatBytes(bytesPerSecond)}/s`
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`
}

/** Network speed in bits, like a speed test: "12.4 Mbps". */
export function formatBits(bytesPerSecond: number | undefined): string {
  if (bytesPerSecond === undefined) return '—'
  const bits = bytesPerSecond * 8
  if (bits < 1000) return `${Math.round(bits)} bps`
  if (bits < 1_000_000) return `${(bits / 1000).toFixed(bits < 10_000 ? 1 : 0)} Kbps`
  if (bits < 1_000_000_000) return `${(bits / 1_000_000).toFixed(1)} Mbps`
  return `${(bits / 1_000_000_000).toFixed(2)} Gbps`
}

export function formatPercent(n: number): string {
  return n > 0 && n < 0.1 ? '0.1%' : `${n.toFixed(1)}%`
}

export function formatUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d) return `${d} day${d === 1 ? '' : 's'}, ${h} hr`
  if (h) return `${h} hr ${m} min`
  return `${m} min`
}

/**
 * How strongly to tint a cell, 0 to 1, like Task Manager's yellow-to-orange: CPU by percent,
 * memory by share of the computer's, disk against 20 MB/s.
 */
export function heat(key: 'cpu' | 'mem' | 'disk', value: number, memTotal: number): number {
  const share = key === 'cpu' ? value / 100 : key === 'mem' ? (memTotal > 0 ? (value / memTotal) * 4 : 0) : value / (20 * 1024 * 1024)
  return Math.min(1, Math.max(0, share))
}

// ---------------------------------------------------------------------------------------------
// History for the graphs

/** How many readings the graphs keep (a minute at Orbit's pace). */
export const HISTORY = 60

export interface PerfHistory {
  cpu: number[]
  mem: number[]
  disk: number[]
  net: number[]
}

export const emptyHistory = (): PerfHistory => ({ cpu: [], mem: [], disk: [], net: [] })

/** Adds a reading to the graphs, dropping the oldest past `HISTORY`. */
export function pushHistory(h: PerfHistory, perf: TaskPerf, keep = HISTORY): PerfHistory {
  const add = (list: number[], v: number): number[] => [...list, v].slice(-keep)
  return {
    cpu: add(h.cpu, perf.cpu),
    mem: add(h.mem, perf.memTotal > 0 ? (perf.memUsed / perf.memTotal) * 100 : 0),
    disk: add(h.disk, (perf.diskRead ?? 0) + (perf.diskWrite ?? 0)),
    net: add(h.net, (perf.netDown ?? 0) + (perf.netUp ?? 0))
  }
}

/**
 * The points of a line graph, oldest on the left, in a `width` × `height` box. `max` is the top
 * (100 for percents); without one, the top is the biggest value (so a quiet network still shows).
 * The newest reading sits at the right edge, so the line fills in from the right as it starts.
 */
export function graphPoints(values: number[], width: number, height: number, max?: number, slots = HISTORY): string {
  if (!values.length) return ''
  const top = max ?? Math.max(1, ...values)
  const step = width / Math.max(1, slots - 1)
  const start = width - (values.length - 1) * step
  return values
    .map((v, i) => {
      const x = start + i * step
      const y = height - (Math.min(top, Math.max(0, v)) / top) * height
      return `${round1(x)},${round1(y)}`
    })
    .join(' ')
}

const round1 = (n: number): number => Math.round(n * 10) / 10
