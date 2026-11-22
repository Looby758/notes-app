import { describe, expect, it } from 'vitest'
import {
  canEnd,
  cpuUse,
  emptyHistory,
  formatBits,
  formatBytes,
  formatPercent,
  formatRate,
  formatUptime,
  fromWindows,
  graphPoints,
  groupProcs,
  heat,
  macBundle,
  nextSort,
  parseCpuTime,
  parseIoreg,
  parseNetstat,
  parsePs,
  parseVmStat,
  procUse,
  programOf,
  pushHistory,
  rate,
  searchGroups,
  sections,
  sortGroups,
  type RawProc,
  type TaskGroup,
  type TaskPerf
} from './taskManager'

// All of this is made-up system output, shaped like the real thing (ps, vm_stat, netstat and ioreg
// on a Mac, and Orbit's own PowerShell helper on Windows).

const proc = (pid: number, name: string, extra: Partial<RawProc> = {}): RawProc => ({ pid, ppid: 1, name, cpuMs: 0, mem: 0, ...extra })

describe('parseCpuTime', () => {
  it('reads a Mac’s minutes:seconds', () => {
    expect(parseCpuTime('0:01.23')).toBe(1230)
    expect(parseCpuTime('125:00.50')).toBe(7_500_500)
  })
  it('reads hours and days', () => {
    expect(parseCpuTime('01:02:03')).toBe(3_723_000)
    expect(parseCpuTime('2-00:00:01')).toBe(172_801_000)
  })
  it('turns down anything else', () => {
    expect(parseCpuTime('')).toBeNaN()
    expect(parseCpuTime('abc')).toBeNaN()
    expect(parseCpuTime('1:2:3:4')).toBeNaN()
  })
})

describe('parsePs', () => {
  const ps = [
    '    1     0  12345   1:23.45 /sbin/launchd',
    '  412     1 204800   0:05.10 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '  415   412  51200   0:00.90 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/1/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)',
    '    0     0      0   9:59.00 kernel_task',
    'garbage line',
    ''
  ].join('\n')
  it('reads every process, with paths that have spaces', () => {
    const list = parsePs(ps)
    expect(list).toHaveLength(4)
    expect(list[1]).toEqual({
      pid: 412,
      ppid: 1,
      name: 'Google Chrome',
      path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      cpuMs: 5100,
      mem: 204800 * 1024
    })
    expect(list[2].name).toBe('Google Chrome Helper (Renderer)')
    expect(list[3]).toMatchObject({ pid: 0, name: 'kernel_task', path: undefined })
  })
})

describe('fromWindows', () => {
  it('turns the helper’s short keys into processes', () => {
    const list = fromWindows([
      { i: 4, p: 0, n: 'System', c: 10_000_000, m: 1000 },
      { i: 900, p: 800, n: 'chrome.exe', x: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', c: 25_000, m: 2048, r: 10, w: 20, t: 'New tab - Google Chrome', d: 'Google Chrome ' }
    ])
    expect(list[0]).toMatchObject({ pid: 4, name: 'System', cpuMs: 1000, path: undefined, window: undefined })
    expect(list[1]).toMatchObject({ pid: 900, ppid: 800, cpuMs: 2.5, mem: 2048, read: 10, write: 20, window: 'New tab - Google Chrome', desc: 'Google Chrome' })
  })
  it('skips broken entries', () => {
    expect(fromWindows([null as never, { i: 'x' } as never])).toEqual([])
  })
})

describe('parseVmStat', () => {
  const vm = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               10000.
Pages active:                            200000.
Pages inactive:                          150000.
Pages wired down:                         60000.
Pages purgeable:                           5000.
Anonymous pages:                         180000.
Pages occupied by compressor:             40000.`
  it('counts app memory, wired and compressed', () => {
    expect(parseVmStat(vm)).toBe((180000 - 5000 + 60000 + 40000) * 16384)
  })
  it('falls back to active pages on older macOS', () => {
    const old = vm.replace(/Anonymous pages:.*\n/, '')
    expect(parseVmStat(old)).toBe((200000 + 60000 + 40000) * 16384)
  })
  it('says null for something else', () => {
    expect(parseVmStat('')).toBeNull()
  })
})

describe('parseNetstat', () => {
  const out = `Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
lo0        16384 <Link#1>                        500     0      90000      500     0      90000     0
lo0        16384 127           localhost          500     -      90000      500     -      90000     -
en0        1500  <Link#6>    a4:83:e7:12:34:56  9000     0    8000000     4000     0     700000     0
en0        1500  192.168.1     192.168.1.20       8000     -    7900000     3900     -     690000     -
utun0      1380  <Link#15>                         0     0       1000       12     0       2000     0`
  it('adds up every interface but the loopback, once each', () => {
    expect(parseNetstat(out)).toEqual({ down: 8_001_000, up: 702_000 })
  })
  it('says null without its header', () => {
    expect(parseNetstat('nothing here')).toBeNull()
    expect(parseNetstat('')).toBeNull()
  })
})

describe('parseIoreg', () => {
  it('adds up every disk', () => {
    const out = `+-o IOBlockStorageDriver
    "Statistics" = {"Operations (Write)"=1,"Bytes (Read)"=1000,"Bytes (Write)"=300}
+-o IOBlockStorageDriver
    "Statistics" = {"Bytes (Read)"=24,"Bytes (Write)"=6}`
    expect(parseIoreg(out)).toEqual({ read: 1024, write: 306 })
    expect(parseIoreg('')).toBeNull()
  })
})

describe('cpuUse', () => {
  const t = (busy: number, idle: number) => ({ user: busy, nice: 0, sys: 0, irq: 0, idle })
  it('works out each core and the whole', () => {
    const use = cpuUse([t(100, 100), t(0, 0)], [t(150, 150), t(100, 100)])
    expect(use.cores).toEqual([50, 50])
    expect(use.total).toBe(50)
  })
  it('says 0 for a core with no time passed or no earlier reading', () => {
    expect(cpuUse([t(10, 10)], [t(10, 10), t(5, 5)]).cores).toEqual([0, 0])
  })
})

describe('rate', () => {
  it('is per second', () => {
    expect(rate(1000, 3000, 2000)).toBe(1000)
  })
  it('is 0 when a counter resets, and missing without both readings', () => {
    expect(rate(5000, 10, 1000)).toBe(0)
    expect(rate(undefined, 10, 1000)).toBeUndefined()
    expect(rate(1, 2, 0)).toBeUndefined()
  })
})

describe('procUse', () => {
  it('shares CPU over all cores', () => {
    const before = new Map([[10, proc(10, 'game.exe', { cpuMs: 1000 })]])
    // 2 seconds on a 4-core computer is 8 seconds of CPU; 2 of them used is 25%.
    const [p] = procUse(before, [proc(10, 'game.exe', { cpuMs: 3000 })], 2000, 4, false)
    expect(p.cpu).toBe(25)
    expect(p.disk).toBeUndefined()
  })
  it('shows a new process, or a reused ID, as 0% until the next look', () => {
    const before = new Map([[10, proc(10, 'old.exe', { cpuMs: 0 })]])
    const use = procUse(before, [proc(10, 'new.exe', { cpuMs: 5000 }), proc(11, 'fresh.exe', { cpuMs: 5000 })], 1000, 1, false)
    expect(use.map((u) => u.cpu)).toEqual([0, 0])
  })
  it('adds reading and writing for disk', () => {
    const before = new Map([[10, proc(10, 'copy.exe', { read: 0, write: 0 })]])
    const [p] = procUse(before, [proc(10, 'copy.exe', { read: 1000, write: 3000 })], 2000, 1, true)
    expect(p.disk).toBe(2000)
  })
  it('never goes over 100%', () => {
    const before = new Map([[10, proc(10, 'a', { cpuMs: 0 })]])
    expect(procUse(before, [proc(10, 'a', { cpuMs: 99999 })], 1000, 1, false)[0].cpu).toBe(100)
  })
})

describe('programOf', () => {
  it('groups a Mac app’s helpers under the app', () => {
    const helper = proc(415, 'Google Chrome Helper', { path: '/Applications/Google Chrome.app/Contents/Frameworks/X.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper' })
    expect(programOf(helper, true)).toMatchObject({ id: '/Applications/Google Chrome.app', name: 'Google Chrome', kind: 'app' })
  })
  it('sorts macOS’s own things into System, but keeps Apple’s apps as apps', () => {
    expect(programOf(proc(1, 'launchd', { path: '/sbin/launchd' }), true).kind).toBe('system')
    expect(programOf(proc(300, 'Dock', { path: '/System/Library/CoreServices/Dock.app/Contents/MacOS/Dock' }), true).kind).toBe('system')
    expect(programOf(proc(301, 'Safari', { path: '/System/Applications/Safari.app/Contents/MacOS/Safari' }), true).kind).toBe('app')
    expect(programOf(proc(302, 'Finder', { path: '/System/Library/CoreServices/Finder.app/Contents/MacOS/Finder' }), true).kind).toBe('app')
    expect(programOf(proc(500, 'node', { path: '/opt/homebrew/bin/node' }), true).kind).toBe('background')
  })
  it('on Windows, an app has a window and uses its description as its name', () => {
    expect(programOf(proc(900, 'chrome.exe', { path: 'C:\\Chrome\\chrome.exe', window: 'Tab', desc: 'Google Chrome' }), false)).toMatchObject({
      id: 'c:\\chrome\\chrome.exe',
      name: 'Google Chrome',
      kind: 'app'
    })
    expect(programOf(proc(901, 'Updater.exe'), false)).toMatchObject({ name: 'Updater', kind: 'background' })
    expect(programOf(proc(4, 'System'), false).kind).toBe('system')
    expect(programOf(proc(700, 'svchost.exe'), false).kind).toBe('system')
  })
})

describe('macBundle', () => {
  it('finds the outermost .app', () => {
    expect(macBundle('/Applications/Slack.app/Contents/Frameworks/Slack Helper.app/Contents/MacOS/Slack Helper')).toEqual({ name: 'Slack', path: '/Applications/Slack.app' })
    expect(macBundle('/usr/bin/top')).toBeNull()
    expect(macBundle(undefined)).toBeNull()
  })
})

describe('groupProcs', () => {
  const raw = [
    proc(900, 'chrome.exe', { path: 'C:\\Chrome\\chrome.exe', window: 'Tab', desc: 'Google Chrome' }),
    proc(901, 'chrome.exe', { path: 'C:\\Chrome\\chrome.exe' }),
    proc(950, 'Orbit.exe', { path: 'C:\\Orbit\\Orbit.exe', window: 'Orbit' }),
    proc(951, 'Orbit.exe', { path: 'C:\\Orbit\\Orbit.exe' })
  ]
  const use = raw.map((p, i) => ({ pid: p.pid, ppid: 1, name: p.name, cpu: [10, 5, 1, 2][i], mem: 100 * (i + 1), disk: 50 }))
  const groups = groupProcs(raw, use, false, new Set([950]))
  it('puts a program’s processes together and adds them up', () => {
    expect(groups).toHaveLength(2)
    const chrome = groups.find((g) => g.name === 'Google Chrome')!
    expect(chrome.procs.map((p) => p.pid)).toEqual([900, 901])
    expect(chrome).toMatchObject({ kind: 'app', cpu: 15, mem: 300, disk: 100 })
  })
  it('marks Orbit', () => {
    expect(groups.find((g) => g.name === 'Orbit')?.self).toBe(true)
    expect(groups.find((g) => g.name === 'Google Chrome')?.self).toBeUndefined()
  })
  it('takes the description from whichever process has it', () => {
    const g = groupProcs(
      [proc(1000, 'tool.exe', { path: 'C:\\t.exe' }), proc(1001, 'tool.exe', { path: 'C:\\t.exe', desc: 'Nice Tool' })],
      [
        { pid: 1000, ppid: 1, name: 'tool.exe', cpu: 0, mem: 0 },
        { pid: 1001, ppid: 1, name: 'tool.exe', cpu: 0, mem: 0 }
      ],
      false,
      new Set()
    )
    expect(g[0].name).toBe('Nice Tool')
  })
})

describe('canEnd', () => {
  it('won’t end Orbit or what keeps the computer running', () => {
    expect(canEnd('Orbit.exe', 950, true).ok).toBe(false)
    expect(canEnd('csrss.exe', 600, false).ok).toBe(false)
    expect(canEnd('WindowServer', 150, false).ok).toBe(false)
    expect(canEnd('System', 4, false).ok).toBe(false)
    expect(canEnd('anything', 0, false).ok).toBe(false)
  })
  it('ends everything else, Explorer and Finder too (they come back)', () => {
    expect(canEnd('game.exe', 1234, false)).toEqual({ ok: true })
    expect(canEnd('explorer.exe', 1234, false).ok).toBe(true)
    expect(canEnd('Finder', 1234, false).ok).toBe(true)
  })
})

const group = (name: string, cpu: number, mem: number, kind: TaskGroup['kind'] = 'app', pids = [1]): TaskGroup => ({
  id: name.toLowerCase(),
  name,
  kind,
  procs: pids.map((pid) => ({ pid, ppid: 0, name: `${name.toLowerCase()}.exe`, cpu, mem })),
  cpu,
  mem
})

describe('sorting', () => {
  const list = [group('beta', 5, 300), group('Alpha', 20, 100), group('gamma', 5, 200)]
  it('sorts by name without minding capitals', () => {
    expect(sortGroups(list, { key: 'name', desc: false }).map((g) => g.name)).toEqual(['Alpha', 'beta', 'gamma'])
  })
  it('sorts numbers, keeping ties in name order', () => {
    expect(sortGroups(list, { key: 'cpu', desc: true }).map((g) => g.name)).toEqual(['Alpha', 'beta', 'gamma'])
    expect(sortGroups(list, { key: 'mem', desc: true }).map((g) => g.name)).toEqual(['beta', 'gamma', 'Alpha'])
  })
  it('flips a column, and starts numbers biggest first', () => {
    expect(nextSort({ key: 'cpu', desc: true }, 'cpu')).toEqual({ key: 'cpu', desc: false })
    expect(nextSort({ key: 'cpu', desc: true }, 'mem')).toEqual({ key: 'mem', desc: true })
    expect(nextSort({ key: 'cpu', desc: true }, 'name')).toEqual({ key: 'name', desc: false })
  })
  it('splits into sections in Task Manager’s order, leaving out empty ones', () => {
    const s = sections([group('svc', 1, 1, 'system'), group('App', 1, 1, 'app')], { key: 'name', desc: false })
    expect(s.map((x) => x.kind)).toEqual(['app', 'system'])
  })
})

describe('searchGroups', () => {
  const list = [group('Google Chrome', 1, 1, 'app', [10, 11]), group('Discord', 1, 1, 'app', [20])]
  it('matches every word in names', () => {
    expect(searchGroups(list, 'chrome').map((g) => g.name)).toEqual(['Google Chrome'])
    expect(searchGroups(list, 'google chrome').map((g) => g.name)).toEqual(['Google Chrome'])
    expect(searchGroups(list, 'google discord')).toEqual([])
    expect(searchGroups(list, '  ')).toBe(list)
  })
  it('finds a process ID, keeping just that process', () => {
    const found = searchGroups(list, '11')
    expect(found).toHaveLength(1)
    expect(found[0].procs.map((p) => p.pid)).toEqual([11])
  })
})

describe('formatting', () => {
  it('shows sizes', () => {
    expect(formatBytes(500)).toBe('500 B')
    expect(formatBytes(1536)).toBe('2 KB')
    expect(formatBytes(250 * 1024 * 1024)).toBe('250 MB')
    expect(formatBytes(16 * 1024 ** 3)).toBe('16.0 GB')
    expect(formatBytes(-1)).toBe('—')
  })
  it('shows speeds', () => {
    expect(formatRate(undefined)).toBe('—')
    expect(formatRate(0)).toBe('0 MB/s')
    expect(formatRate(2048)).toBe('2 KB/s')
    expect(formatRate(5 * 1024 * 1024)).toBe('5.0 MB/s')
    expect(formatBits(125_000)).toBe('1.0 Mbps')
    expect(formatBits(100)).toBe('800 bps')
    expect(formatBits(undefined)).toBe('—')
  })
  it('shows percents, never a busy thing as 0', () => {
    expect(formatPercent(0)).toBe('0.0%')
    expect(formatPercent(0.01)).toBe('0.1%')
    expect(formatPercent(12.345)).toBe('12.3%')
  })
  it('shows how long the computer has been on', () => {
    expect(formatUptime(59)).toBe('0 min')
    expect(formatUptime(3 * 3600 + 120)).toBe('3 hr 2 min')
    expect(formatUptime(86400 + 3600)).toBe('1 day, 1 hr')
  })
  it('tints busier cells more', () => {
    expect(heat('cpu', 50, 0)).toBe(0.5)
    expect(heat('cpu', 500, 0)).toBe(1)
    expect(heat('mem', 1024, 8192)).toBe(0.5)
    expect(heat('disk', 0, 0)).toBe(0)
  })
})

describe('history and graphs', () => {
  const perf = (cpu: number): TaskPerf => ({ cpu, cores: [], memUsed: 4, memTotal: 8, diskRead: 1, diskWrite: 2, netDown: 3, uptime: 0, processes: 0 })
  it('keeps the last readings', () => {
    let h = emptyHistory()
    for (let i = 0; i < 5; i++) h = pushHistory(h, perf(i), 3)
    expect(h.cpu).toEqual([2, 3, 4])
    expect(h.mem).toEqual([50, 50, 50])
    expect(h.disk).toEqual([3, 3, 3])
    expect(h.net).toEqual([3, 3, 3])
  })
  it('draws from the right edge, scaled to the top', () => {
    expect(graphPoints([], 100, 50)).toBe('')
    // Three slots across 100 wide: 0, 50, 100. Two readings fill the right two.
    expect(graphPoints([0, 100], 100, 50, 100, 3)).toBe('50,50 100,0')
    // Without a top, the biggest value is the top.
    expect(graphPoints([2, 4], 100, 50, undefined, 2)).toBe('0,25 100,0')
  })
})
