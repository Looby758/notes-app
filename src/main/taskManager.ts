import { app, ipcMain, shell } from 'electron'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { cpus, totalmem, freemem, uptime } from 'os'
import { promisify } from 'util'
import {
  canEnd,
  cpuUse,
  fromWindows,
  groupProcs,
  parseIoreg,
  parseNetstat,
  parsePs,
  parseVmStat,
  procUse,
  rate,
  type EndResult,
  type EndTarget,
  type RawProc,
  type RawTotals,
  type TaskGroup,
  type TaskSnapshot,
  type WinRawProc
} from '@shared/taskManager'
import { logError } from './log'

/**
 * The task manager: what's running and how much it uses, read every couple of seconds while its
 * page is open, and ending something that's stuck.
 *
 * - Windows: a PowerShell helper (nothing installed) stays running while the page is open and
 *   answers one line per look: every process from WMI (CPU time, memory, disk I/O, its window's
 *   title and the program's description), plus the network and disk totals.
 * - Mac: `ps` for the processes, `vm_stat` for memory as Activity Monitor counts it, `netstat` and
 *   `ioreg` for the network and disk totals. macOS doesn't say each process's disk use without
 *   admin rights, so there's no disk column there.
 *
 * Use now comes from the difference between two looks (shared/taskManager.ts), so the first look
 * after opening shows 0% until the next one.
 */

const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'
const run = promisify(execFile)

// ---------------------------------------------------------------------------------------------
// Windows

const WIN_HELPER = String.raw`
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$descs = @{}
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $req = $line.Trim()
  try {
    $wins = @{}
    foreach ($q in [Diagnostics.Process]::GetProcesses()) {
      try { if ($q.MainWindowHandle -ne [IntPtr]::Zero -and $q.MainWindowTitle) { $wins[[int]$q.Id] = $q.MainWindowTitle } } catch { }
    }
    $list = foreach ($q in Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,ExecutablePath,KernelModeTime,UserModeTime,WorkingSetSize,ReadTransferCount,WriteTransferCount) {
      $x = $q.ExecutablePath
      $d = $null
      if ($x) {
        if (-not $descs.ContainsKey($x)) { try { $descs[$x] = [Diagnostics.FileVersionInfo]::GetVersionInfo($x).FileDescription } catch { $descs[$x] = $null } }
        $d = $descs[$x]
      }
      @{ i = [int]$q.ProcessId; p = [int]$q.ParentProcessId; n = $q.Name; x = $x; c = [double]$q.KernelModeTime + [double]$q.UserModeTime; m = [double]$q.WorkingSetSize; r = [double]$q.ReadTransferCount; w = [double]$q.WriteTransferCount; t = $wins[[int]$q.ProcessId]; d = $d }
    }
    $rx = 0.0; $tx = 0.0
    foreach ($n in [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
      if ($n.NetworkInterfaceType -ne 'Loopback' -and $n.OperationalStatus -eq 'Up') { try { $s = $n.GetIPStatistics(); $rx += $s.BytesReceived; $tx += $s.BytesSent } catch { } }
    }
    $dr = $null; $dw = $null
    try {
      $dk = Get-CimInstance Win32_PerfRawData_PerfDisk_PhysicalDisk -Filter "Name='_Total'" -Property DiskReadBytesPersec,DiskWriteBytesPersec
      if ($dk) { $dr = [double]$dk.DiskReadBytesPersec; $dw = [double]$dk.DiskWriteBytesPersec }
    } catch { }
    $out = ConvertTo-Json -Compress -Depth 3 @{ ok = $true; procs = @($list); rx = $rx; tx = $tx; dr = $dr; dw = $dw }
  } catch {
    $out = ConvertTo-Json -Compress @{ ok = $false; err = $_.Exception.Message }
  }
  [Console]::Out.WriteLine($req + ' ' + $out)
  [Console]::Out.Flush()
}
`

interface WinAnswer {
  ok: boolean
  err?: string
  procs?: WinRawProc[]
  rx?: number
  tx?: number
  dr?: number | null
  dw?: number | null
}

let helper: ChildProcessWithoutNullStreams | null = null
let nextRequest = 1
const waiting = new Map<number, (text: string | null) => void>()

function startHelper(): ChildProcessWithoutNullStreams {
  const child = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(WIN_HELPER, 'utf16le').toString('base64')], {
    windowsHide: true
  })
  let buffer = ''
  child.stdout.on('data', (d: Buffer) => {
    buffer += d.toString('utf8')
    let nl
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      const space = line.indexOf(' ')
      const done = waiting.get(Number(line.slice(0, space)))
      if (done) {
        waiting.delete(Number(line.slice(0, space)))
        done(line.slice(space + 1))
      }
    }
  })
  // PowerShell reports its own progress on stderr as '#< CLIXML ...'; that isn't an error.
  child.stderr.on('data', (d: Buffer) => {
    const text = d.toString().trim()
    if (text && !text.startsWith('#< CLIXML')) logError('task manager', new Error(text))
  })
  child.on('error', (err) => logError('task manager', err))
  child.on('exit', () => {
    if (helper === child) helper = null
    for (const done of waiting.values()) done(null)
    waiting.clear()
  })
  return child
}

function askWindows(timeout: number): Promise<WinAnswer | null> {
  helper ??= startHelper()
  const id = nextRequest++
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(id)
      resolve(null)
    }, timeout)
    waiting.set(id, (text) => {
      clearTimeout(timer)
      try {
        resolve(text ? (JSON.parse(text) as WinAnswer) : null)
      } catch {
        resolve(null)
      }
    })
    helper!.stdin.write(`${id}\n`)
  })
}

// ---------------------------------------------------------------------------------------------
// One look

interface Reading {
  procs: RawProc[]
  totals: RawTotals
  problem?: string
}

async function quiet(cmd: string, args: string[]): Promise<string> {
  try {
    return (await run(cmd, args, { timeout: 8000, maxBuffer: 16 * 1024 * 1024 })).stdout
  } catch {
    return ''
  }
}

async function readNow(): Promise<Reading> {
  const at = Date.now()
  const base: RawTotals = { at, cpus: cpus().map((c) => c.times), memTotal: totalmem(), memUsed: totalmem() - freemem() }
  if (IS_WIN) {
    // The first look starts PowerShell, which takes a few seconds.
    const answer = await askWindows(helper ? 10_000 : 30_000)
    if (!answer?.ok) {
      if (answer?.err) logError('task manager', new Error(answer.err))
      return { procs: [], totals: base, problem: 'Windows didn’t say what’s running. It tries again in a moment.' }
    }
    return {
      procs: fromWindows(answer.procs ?? []),
      totals: { ...base, netDown: answer.rx, netUp: answer.tx, diskRead: answer.dr ?? undefined, diskWrite: answer.dw ?? undefined }
    }
  }
  const [ps, vm, net, io] = await Promise.all([
    quiet('ps', ['-axo', 'pid=,ppid=,rss=,time=,comm=']),
    IS_MAC ? quiet('vm_stat', []) : Promise.resolve(''),
    IS_MAC ? quiet('netstat', ['-ib']) : Promise.resolve(''),
    IS_MAC ? quiet('ioreg', ['-c', 'IOBlockStorageDriver', '-r', '-k', 'Statistics']) : Promise.resolve('')
  ])
  const procs = parsePs(ps)
  const used = parseVmStat(vm)
  const network = parseNetstat(net)
  const disk = parseIoreg(io)
  return {
    procs,
    totals: { ...base, memUsed: used ?? base.memUsed, netDown: network?.down, netUp: network?.up, diskRead: disk?.read, diskWrite: disk?.write },
    problem: procs.length ? undefined : 'Couldn’t read what’s running. It tries again in a moment.'
  }
}

// ---------------------------------------------------------------------------------------------
// Use now, from this look and the last

let last: Reading | null = null
let lastSnapshot: TaskSnapshot | null = null
let looking: Promise<TaskSnapshot> | null = null
/** Each process's name in the last look, to check what's being ended is still the same program. */
let names = new Map<number, string>()
/** Each program's path, for "Open file location". */
let paths = new Map<number, string>()
const icons = new Map<string, string | null>()
let stopTimer: ReturnType<typeof setTimeout> | null = null

async function iconFor(path: string): Promise<string | undefined> {
  if (!icons.has(path)) {
    const img = await app.getFileIcon(path, { size: 'small' }).catch(() => null)
    icons.set(path, img && !img.isEmpty() ? img.toDataURL() : null)
  }
  return icons.get(path) ?? undefined
}

function orbitPids(): Set<number> {
  const pids = new Set<number>([process.pid])
  try {
    for (const m of app.getAppMetrics()) pids.add(m.pid)
  } catch {
    // Only Orbit's main process then.
  }
  return pids
}

async function lookNow(): Promise<TaskSnapshot> {
  const now = await readNow()
  const before = last
  const ms = before ? now.totals.at - before.totals.at : 0
  const cores = now.totals.cpus.length || 1
  const prev = new Map((before?.procs ?? []).map((p) => [p.pid, p]))
  const use = procUse(prev, now.procs, ms, cores, IS_WIN)
  const groups: TaskGroup[] = groupProcs(now.procs, use, IS_MAC, orbitPids())
  await Promise.all(
    groups.map(async (g) => {
      if (g.path && (IS_WIN || IS_MAC)) g.icon = await iconFor(g.path)
    })
  )
  const cpu = before ? cpuUse(before.totals.cpus, now.totals.cpus) : { total: 0, cores: now.totals.cpus.map(() => 0) }
  const t = now.totals
  const b = before?.totals
  const snapshot: TaskSnapshot = {
    at: t.at,
    groups,
    hasDisk: IS_WIN,
    problem: now.problem,
    perf: {
      cpu: cpu.total,
      cores: cpu.cores,
      cpuName: cpus()[0]?.model?.trim(),
      memUsed: t.memUsed,
      memTotal: t.memTotal,
      diskRead: rate(b?.diskRead, t.diskRead, ms),
      diskWrite: rate(b?.diskWrite, t.diskWrite, ms),
      netDown: rate(b?.netDown, t.netDown, ms),
      netUp: rate(b?.netUp, t.netUp, ms),
      uptime: uptime(),
      processes: now.procs.length
    }
  }
  // A failed look keeps the last good one to measure the next against.
  if (now.procs.length) {
    last = now
    names = new Map(now.procs.map((p) => [p.pid, p.name]))
    paths = new Map(now.procs.filter((p) => p.path).map((p) => [p.pid, p.path!]))
  }
  lastSnapshot = snapshot
  return snapshot
}

/** What's running now (looks are shared if two ask at once, and one less than a second old is reused). */
export function taskSnapshot(): Promise<TaskSnapshot> {
  // Nobody's asked for a while (the page closed): stop the Windows helper.
  if (stopTimer) clearTimeout(stopTimer)
  stopTimer = setTimeout(stopHelper, 30_000)
  if (lastSnapshot && Date.now() - lastSnapshot.at < 900) return Promise.resolve(lastSnapshot)
  looking ??= lookNow()
    .catch((err): TaskSnapshot => {
      logError('task manager', err)
      return { at: Date.now(), groups: [], hasDisk: IS_WIN, problem: 'Couldn’t read what’s running.', perf: { cpu: 0, cores: [], memUsed: 0, memTotal: totalmem(), uptime: uptime(), processes: 0 } }
    })
    .finally(() => {
      looking = null
    })
  return looking
}

// ---------------------------------------------------------------------------------------------
// Ending

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM: it's there, it just isn't ours to signal.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Ends one process. On Windows that's straight away (as Task Manager does); a Mac is asked to quit first, then made to. */
async function endOne(pid: number): Promise<string | null> {
  try {
    process.kill(pid, IS_WIN ? 'SIGKILL' : 'SIGTERM')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return null // Already gone.
    if (code === 'EPERM')
      return IS_WIN ? 'Windows didn’t let Orbit end it (it may belong to another user or need administrator rights).' : 'macOS didn’t let Orbit end it (it belongs to another user or the system).'
    return String((err as Error).message ?? err)
  }
  if (IS_WIN) return null
  for (let i = 0; i < 15 && alive(pid); i++) await wait(200)
  if (!alive(pid)) return null
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // Gone between the check and now.
  }
  return null
}

export async function endTasks(targets: EndTarget[]): Promise<EndResult> {
  const self = orbitPids()
  const result: EndResult = { ended: 0, failed: [] }
  for (const t of targets) {
    const pid = Number(t.pid)
    if (!Number.isInteger(pid) || pid <= 0) continue
    // Only what the page showed: if the ID now belongs to something else, leave it alone.
    const name = names.get(pid)
    if (name !== t.name) {
      result.failed.push(`${t.name} (${pid}) had already closed.`)
      continue
    }
    const allowed = canEnd(name, pid, self.has(pid))
    if (!allowed.ok) {
      result.failed.push(`${name}: ${allowed.why}`)
      continue
    }
    const problem = await endOne(pid)
    if (problem) result.failed.push(`${name} (${pid}): ${problem}`)
    else result.ended++
  }
  lastSnapshot = null
  return result
}

function stopHelper(): void {
  helper?.kill()
  helper = null
  last = null
  lastSnapshot = null
}

export function setupTaskManager(): void {
  ipcMain.handle('tasks:get', () => taskSnapshot())
  ipcMain.handle('tasks:end', (_e, targets: EndTarget[]) => endTasks(Array.isArray(targets) ? targets.slice(0, 500) : []))
  ipcMain.handle('tasks:reveal', (_e, pid: number) => {
    const path = paths.get(Number(pid))
    if (path) shell.showItemInFolder(path)
    return !!path
  })
}

export function teardownTaskManager(): void {
  if (stopTimer) clearTimeout(stopTimer)
  stopHelper()
}
