import { describe, expect, it } from 'vitest'
import { chaptersText, exportPlan, markersEdl, numberedPictures, safeName, shotCsv, shotSrt, transcriptSrt } from './editExport'
import type { Shot } from './shotList'

const shot = (kind: Shot['kind'], value: string, time: number | null, length: number | null = null, n = 1): Shot => ({
  key: `${kind}:${value}#${n}`,
  kind,
  value,
  from: 0,
  time,
  source: time === null ? null : 'transcript',
  length
})

const shots: Shot[] = [
  shot('SECTION', 'Intro', 0.4),
  shot('IMAGE', 'rick.png', 7.6, 16.4),
  shot('CLIP', 'corridor, "long"', 24, 6),
  shot('SECTION', 'The prison', 30),
  shot('IMAGE', 'rick.png', 30, 5, 2),
  shot('IMAGE', 'missing.png', null)
]
const picture = (s: Shot): string | null => (s.value === 'rick.png' ? 'attachments/rick.png' : null)

describe('export for editing', () => {
  it('numbers the pictures in order, with their times in the name', () => {
    expect(numberedPictures(shots, picture)).toEqual([
      { path: 'attachments/rick.png', name: '01 0-07.6 rick.png' },
      { path: 'attachments/rick.png', name: '02 0-30.0 rick.png' }
    ])
    expect(safeName('What: a "video"?')).toBe('What a video')
  })

  it('writes a spreadsheet of the shots', () => {
    const csv = shotCsv(shots, numberedPictures(shots, picture), picture).split('\r\n')
    expect(csv[0]).toBe('#,Start,End,Seconds on screen,Start (seconds),Type,Name,Section,File')
    expect(csv[1]).toBe('1,0:07,0:24,16.4,7.60,Picture,rick.png,Intro,Pictures/01 0-07.6 rick.png')
    expect(csv[2]).toBe('2,0:24,0:30,6.0,24.00,Clip,"corridor, ""long""",Intro,')
    expect(csv[3]).toBe('3,0:30,0:35,5.0,30.00,Picture,rick.png,The prison,Pictures/02 0-30.0 rick.png')
    expect(csv[4]).toBe('4,,,,,Picture,missing.png,The prison,not found')
  })

  it('writes subtitles for the shots and the transcript', () => {
    expect(shotSrt(shots, 60).split('\r\n').slice(0, 3)).toEqual(['1', '00:00:07,600 --> 00:00:24,000', 'rick.png'])
    const words = 'Hello there. This is a much longer sentence that goes on and on for quite a while longer than two lines'.split(' ').map((w, i) => ({ w, s: i * 0.3, e: i * 0.3 + 0.25 }))
    const out = transcriptSrt(words)
    expect(out.startsWith('1\r\n00:00:00,000 --> 00:00:00,550\r\nHello there.\r\n')).toBe(true)
    for (const block of out.split('\r\n\r\n')) for (const line of block.split('\r\n').slice(2)) expect(line.length).toBeLessThanOrEqual(50)
  })

  it('writes DaVinci Resolve markers and YouTube chapters', () => {
    const edl = markersEdl(shots, 'My video').split('\r\n')
    expect(edl[0]).toBe('TITLE: My video')
    expect(edl[3]).toBe('001  001      V     C        01:00:00:12 01:00:00:13 01:00:00:12 01:00:00:13  ')
    expect(edl[4]).toBe(' |C:ResolveColorGreen |M:§ Intro |D:1')
    expect(edl[7]).toBe(' |C:ResolveColorBlue |M:rick.png |D:492')
    expect(chaptersText(shots)).toBe('0:00 Intro\n0:30 The prison\n')
  })

  it('puts it all together', () => {
    const plan = exportPlan({ title: 'Life of Rick', recordingName: 'Take 1.m4a', shots, shotListText: 'list', picture, words: null, length: 60 })
    expect(plan.folder).toBe('Life of Rick – for editing')
    expect(plan.files.map((f) => f.name)).toEqual(['Shot list.txt', 'Shot list.csv', 'Markers (DaVinci Resolve).edl', 'Shots.srt', 'Chapters.txt'])
  })
})
