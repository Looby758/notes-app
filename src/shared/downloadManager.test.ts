import { describe, expect, it } from 'vitest'
import {
  cleanSettings,
  fileNameFor,
  isNight,
  isVideoPage,
  moveItem,
  nameFromDisposition,
  nextNightChange,
  nextTime,
  parseLinks,
  pauseForMorning,
  pickNext,
  progressOf,
  timeLeft,
  totalFromRange,
  DEFAULT_DM_SETTINGS,
  type DmItem
} from './downloadManager'

const item = (over: Partial<DmItem>): DmItem => ({
  id: 'a',
  kind: 'file',
  url: 'https://example.com/a.zip',
  name: 'a.zip',
  folder: '/dl',
  status: 'queued',
  overnight: false,
  received: 0,
  total: 0,
  added: 0,
  ...over
})

const at = (h: number, m = 0): Date => new Date(2026, 10, 21, h, m)

describe('isNight', () => {
  it('handles hours that cross midnight', () => {
    expect(isNight(at(23, 30), '23:00', '07:00')).toBe(true)
    expect(isNight(at(3), '23:00', '07:00')).toBe(true)
    expect(isNight(at(7), '23:00', '07:00')).toBe(false)
    expect(isNight(at(12), '23:00', '07:00')).toBe(false)
  })
  it('handles hours inside one day', () => {
    expect(isNight(at(0, 59), '01:00', '07:00')).toBe(false)
    expect(isNight(at(1), '01:00', '07:00')).toBe(true)
    expect(isNight(at(6, 59), '01:00', '07:00')).toBe(true)
  })
  it('treats the same start and end as all day', () => {
    expect(isNight(at(14), '02:00', '02:00')).toBe(true)
  })
})

describe('nextTime / nextNightChange', () => {
  it('finds the next start, today or tomorrow', () => {
    expect(nextTime(at(20), '23:00')).toBe(at(23).getTime())
    expect(nextTime(at(23, 30), '23:00')).toBe(new Date(2026, 10, 22, 23, 0).getTime())
  })
  it('gives the end during the night', () => {
    const s = { ...DEFAULT_DM_SETTINGS, nightStart: '01:00', nightEnd: '07:00' }
    expect(nextNightChange(at(3), s)).toBe(at(7).getTime())
    expect(nextNightChange(at(9), s)).toBe(new Date(2026, 10, 22, 1, 0).getTime())
  })
})

describe('cleanSettings', () => {
  it('puts odd values back to normal', () => {
    expect(cleanSettings({ atOnce: 40, nightStart: '25:00', speedLimitKb: -5 })).toEqual(DEFAULT_DM_SETTINGS)
    expect(cleanSettings({ atOnce: 3, nightStart: '22:30', pauseAtNightEnd: false, speedLimitKb: 1024 })).toMatchObject({ atOnce: 3, nightStart: '22:30', pauseAtNightEnd: false, speedLimitKb: 1024 })
  })
})

describe('parseLinks', () => {
  it('takes several links, skipping words and repeats', () => {
    expect(parseLinks('https://a.com/x.zip\nhello  example.org/b.iso <https://a.com/x.zip>')).toEqual(['https://a.com/x.zip', 'https://example.org/b.iso'])
  })
})

describe('isVideoPage', () => {
  it('spots video pages but not files on those sites', () => {
    expect(isVideoPage('https://www.youtube.com/watch?v=abc')).toBe(true)
    expect(isVideoPage('https://youtu.be/abc')).toBe(true)
    expect(isVideoPage('https://example.com/film.mp4')).toBe(false)
    expect(isVideoPage('https://v.redd.it/abc/DASH_720.mp4')).toBe(false)
  })
})

describe('file names', () => {
  it('reads Content-Disposition, filename* first', () => {
    expect(nameFromDisposition('attachment; filename="report.pdf"')).toBe('report.pdf')
    expect(nameFromDisposition("attachment; filename=x.bin; filename*=UTF-8''caf%C3%A9.txt")).toBe('café.txt')
    expect(nameFromDisposition(null)).toBeNull()
  })
  it('falls back to the link, made safe', () => {
    expect(fileNameFor('https://example.com/files/My%20Game%3A%20Setup.exe?x=1')).toBe('My Game_ Setup.exe')
    expect(fileNameFor('https://example.com/')).toBe('example.com download')
    expect(fileNameFor('https://example.com/dl', 'attachment; filename="../../evil.sh"')).toBe('evil.sh')
  })
  it('reads the whole size from Content-Range', () => {
    expect(totalFromRange('bytes 100-199/5000')).toBe(5000)
    expect(totalFromRange('bytes 0-1/*')).toBeNull()
  })
})

describe('pickNext', () => {
  const list = [
    item({ id: '1', status: 'downloading' }),
    item({ id: '2', overnight: true }),
    item({ id: '3' }),
    item({ id: '4', status: 'paused' }),
    item({ id: '5' })
  ]
  it('starts queued ones in order, up to the limit, overnight ones only at night', () => {
    expect(pickNext(list, 2, false)).toEqual(['3'])
    expect(pickNext(list, 3, false)).toEqual(['3', '5'])
    expect(pickNext(list, 3, true)).toEqual(['2', '3'])
    expect(pickNext(list, 1, true)).toEqual([])
  })
  it('pauses overnight ones in the morning only when asked', () => {
    const running = [item({ id: '1', status: 'downloading', overnight: true }), item({ id: '2', status: 'downloading' })]
    expect(pauseForMorning(running, false, true)).toEqual(['1'])
    expect(pauseForMorning(running, false, false)).toEqual([])
    expect(pauseForMorning(running, true, true)).toEqual([])
  })
})

describe('moveItem', () => {
  const list = ['a', 'b', 'c'].map((id) => item({ id }))
  it('moves up, down and to the top', () => {
    expect(moveItem(list, 'b', -1).map((i) => i.id)).toEqual(['b', 'a', 'c'])
    expect(moveItem(list, 'b', 1).map((i) => i.id)).toEqual(['a', 'c', 'b'])
    expect(moveItem(list, 'c', 'top').map((i) => i.id)).toEqual(['c', 'a', 'b'])
    expect(moveItem(list, 'a', -1).map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('progress words', () => {
  it('knows how far it is', () => {
    expect(progressOf(item({ received: 50, total: 200 }))).toBe(0.25)
    expect(progressOf(item({ received: 50 }))).toBeNull()
    expect(progressOf(item({ kind: 'video', progress: 0.5 }))).toBe(0.5)
  })
  it('says the time left', () => {
    expect(timeLeft(1000, 100)).toBe('10 sec left')
    expect(timeLeft(60 * 1000 * 5, 1000)).toBe('5 min left')
    expect(timeLeft(4800 * 1000, 1000)).toBe('1 hr 20 min left')
    expect(timeLeft(100, 0)).toBe('')
  })
})
