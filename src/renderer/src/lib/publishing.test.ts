import { describe, expect, it } from 'vitest'
import {
  chapterProblems,
  chaptersText,
  chosenTitleText,
  descriptionCheck,
  formatTime,
  fullDescription,
  newDraft,
  parseChapters,
  parseTags,
  parseTime,
  readPublishing,
  sortChapters,
  tagsLength,
  titleCheck,
  thumbnailProblems,
  frameFileName,
  remapThumbnails,
  checklist,
  readyToUpload,
  draftProgress,
  type Chapter
} from './publishing'

const ch = (time: string, name = 'Part'): Chapter => ({ id: `${time}-${name}`, time, name })

describe('times', () => {
  it('reads m:ss and h:mm:ss', () => {
    expect(parseTime('0:00')).toBe(0)
    expect(parseTime('2:14')).toBe(134)
    expect(parseTime(' 12:05 ')).toBe(725)
    expect(parseTime('1:02:03')).toBe(3723)
    expect(parseTime('75:00')).toBe(4500)
  })
  it('rejects what isn’t a time', () => {
    expect(parseTime('')).toBeNull()
    expect(parseTime('2:61')).toBeNull()
    expect(parseTime('1:75:00')).toBeNull()
    expect(parseTime('abc')).toBeNull()
    expect(parseTime('214')).toBeNull()
  })
  it('writes times the way YouTube shows them', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(134)).toBe('2:14')
    expect(formatTime(3723)).toBe('1:02:03')
  })
})

describe('chapters', () => {
  it('is happy with a good list', () => {
    expect(chapterProblems([ch('0:00', 'Intro'), ch('1:30', 'Early life'), ch('6:45', 'The prison')])).toEqual([])
  })
  it('needs the first at 0:00, three of them, in order, 10 seconds apart', () => {
    const list = [ch('0:05', 'Intro'), ch('0:10', 'B')]
    const messages = chapterProblems(list).map((p) => p.message)
    expect(messages).toContain('The first chapter has to start at 0:00')
    expect(messages).toContain('Shorter than 10 seconds')
    expect(messages).toContain('YouTube needs at least 3 chapters')
    expect(chapterProblems([ch('0:00'), ch('2:00'), ch('1:00')]).map((p) => p.message)).toContain('Comes before the chapter above it')
  })
  it('flags bad times and missing names', () => {
    const problems = chapterProblems([ch('0:00', ''), ch('x'), ch('3:00')])
    expect(problems.map((p) => p.message)).toEqual(['Needs a name', '“x” isn’t a time (use 2:14 or 1:02:03)'])
  })
  it('has no problems while empty', () => {
    expect(chapterProblems([])).toEqual([])
  })
  it('reads a pasted list', () => {
    let n = 0
    const list = parseChapters('0:00 Intro\n1:30 - Before the outbreak\n(1:02:03) Negan\nnot a chapter\n6:45: The prison', () => String(n++))
    expect(list.map((c) => [c.time, c.name])).toEqual([
      ['0:00', 'Intro'],
      ['1:30', 'Before the outbreak'],
      ['1:02:03', 'Negan'],
      ['6:45', 'The prison']
    ])
  })
  it('writes the list for the description and sorts by time', () => {
    const list = [ch('0:00', 'Intro'), ch('10:00', 'End'), ch('01:30', 'Middle'), ch('', 'No time')]
    expect(sortChapters(list).map((c) => c.name)).toEqual(['Intro', 'Middle', 'End', 'No time'])
    expect(chaptersText(sortChapters(list))).toBe('0:00 Intro\n1:30 Middle\n10:00 End')
  })
})

describe('tags', () => {
  it('splits, tidies and drops repeats', () => {
    expect(parseTags('walking dead, Rick Grimes;  #twd\nwalking dead, ,')).toEqual(['walking dead', 'Rick Grimes', 'twd'])
  })
  it('counts like YouTube: commas between, quotes round tags with spaces', () => {
    expect(tagsLength([])).toBe(0)
    expect(tagsLength(['twd'])).toBe(3)
    expect(tagsLength(['twd', 'walking dead'])).toBe(3 + 1 + 12 + 2)
  })
})

describe('titles and description', () => {
  it('uses the starred title, or the first one written', () => {
    const d = newDraft('Maggie')
    expect(chosenTitleText(d)).toBe('')
    d.titles = [
      { id: 'a', text: '  ' },
      { id: 'b', text: 'Life of Maggie' },
      { id: 'c', text: 'Maggie Rhee, explained' }
    ]
    expect(chosenTitleText(d)).toBe('Life of Maggie')
    d.chosenTitle = 'c'
    expect(chosenTitleText(d)).toBe('Maggie Rhee, explained')
  })
  it('checks title length', () => {
    expect(titleCheck('Short').level).toBe('ok')
    expect(titleCheck('x'.repeat(80)).level).toBe('warn')
    expect(titleCheck('x'.repeat(101)).level).toBe('error')
    expect(titleCheck('a <b>').level).toBe('error')
  })
  it('puts chapters on the end of the description', () => {
    const d = newDraft('Maggie')
    d.description = 'The whole story.\n'
    d.chapters = [ch('0:00', 'Intro'), ch('1:00', 'Then')]
    expect(fullDescription(d)).toBe('The whole story.\n\n0:00 Intro\n1:00 Then')
    d.chaptersInDescription = false
    expect(fullDescription(d)).toBe('The whole story.')
  })
  it('counts the description in bytes, as YouTube does', () => {
    const d = newDraft('x')
    d.description = '🧟'.repeat(1300)
    expect(descriptionCheck(d).level).toBe('error')
    d.description = 'fine'
    expect(descriptionCheck(d).level).toBe('ok')
  })
})

describe('reading publishing.json', () => {
  it('starts empty from nothing or junk', () => {
    expect(readPublishing(null)).toEqual({ videos: [] })
    expect(readPublishing('{nope')).toEqual({ videos: [] })
  })
  it('keeps what it can from a damaged file', () => {
    const data = readPublishing(
      JSON.stringify({
        videos: [
          { id: 'v1', name: 'Maggie', titles: [{ id: 't1', text: 'A' }, { text: 'no id' }], chosenTitle: 'gone', tags: ['twd', 3], chapters: [{ id: 'c', time: '0:00', name: 'Intro' }] },
          { id: 'v1', name: 'duplicate' },
          { name: 'no id' }
        ]
      })
    )
    expect(data.videos).toHaveLength(1)
    const v = data.videos[0]
    expect(v.titles).toEqual([{ id: 't1', text: 'A' }])
    expect(v.chosenTitle).toBeNull()
    expect(v.tags).toEqual(['twd'])
    expect(v.description).toBe('')
    expect(v.chaptersInDescription).toBe(true)
  })
})

describe('thumbnails', () => {
  it('is happy with a 1280×720 PNG under 2 MB', () => {
    expect(thumbnailProblems('attachments/a.png', { width: 1280, height: 720 }, 900_000)).toEqual([])
  })
  it('flags what YouTube would refuse or show badly', () => {
    expect(thumbnailProblems('a.webp').map((p) => p.level)).toEqual(['error'])
    expect(thumbnailProblems('a.jpg', undefined, 3 * 1024 * 1024)[0].message).toMatch(/2 MB/)
    expect(thumbnailProblems('a.jpg', { width: 500, height: 281 })[0].level).toBe('error')
    expect(thumbnailProblems('a.jpg', { width: 960, height: 540 }).map((p) => p.level)).toEqual(['warn'])
    expect(thumbnailProblems('a.jpg', { width: 1280, height: 1024 }).map((p) => p.message)).toEqual([expect.stringMatching(/16:9/)])
  })
  it('names grabbed frames after the video and the time', () => {
    expect(frameFileName('C:\\Videos\\Maggie take 2.mp4', 134.6)).toBe('Maggie take 2 2m14s.png')
    expect(frameFileName('/v/ep.mkv', 3723)).toBe('ep 1h2m03s.png')
  })
  it('follows pictures that were renamed or moved', () => {
    const d = newDraft('x')
    d.thumbnails = [
      { id: '1', kind: 'picture', text: '', file: 'attachments/a.png', created: 0 },
      { id: '2', kind: 'idea', text: 'idea', created: 0 }
    ]
    expect(remapThumbnails([d], 'other', 'elsewhere')).toBeNull()
    expect(remapThumbnails([d], 'attachments', 'pics')![0].thumbnails[0].file).toBe('pics/a.png')
    expect(remapThumbnails([d], 'attachments/a.png', 'attachments/b.png')![0].thumbnails[0].file).toBe('attachments/b.png')
  })
  it('reads boards back, dropping broken cards and a pick that isn’t a picture', () => {
    const v = readPublishing(
      JSON.stringify({
        videos: [
          {
            id: 'v',
            thumbnails: [
              { id: 'a', kind: 'picture', file: 'attachments/a.png' },
              { id: 'b', kind: 'picture' },
              { id: 'c', kind: 'idea', text: 'big red text' },
              { id: 'd', kind: 'sticker' }
            ],
            chosenThumbnail: 'c'
          }
        ]
      })
    ).videos[0]
    expect(v.thumbnails.map((t) => t.id)).toEqual(['a', 'c'])
    expect(v.chosenThumbnail).toBeNull()
  })
})

describe('upload checklist', () => {
  const ready = () => {
    const d = newDraft('Maggie')
    d.titles = [{ id: 't', text: 'The Entire Life of Maggie Rhee' }]
    d.chosenTitle = 't'
    d.thumbnails = [{ id: 'p', kind: 'picture', text: '', file: 'attachments/thumb.png', created: 0 }]
    d.chosenThumbnail = 'p'
    d.description = 'Her whole story.'
    d.tags = ['twd']
    d.chapters = [ch('0:00', 'Intro'), ch('1:00', 'Farm'), ch('5:00', 'Prison')]
    return d
  }
  const step = (d: ReturnType<typeof newDraft>, id: string) => checklist(d).find((s) => s.id === id)!

  it('ticks the draft steps itself and says what is missing', () => {
    const d = newDraft('Maggie')
    expect(step(d, 'thumbnail').missing).toMatch(/Add a picture/)
    expect(step(d, 'title').missing).toBe('Write a title option')
    expect(step(d, 'chapters').missing).toMatch(/not needed/)
    const r = ready()
    for (const id of ['thumbnail', 'title', 'description', 'tags', 'chapters']) expect(step(r, id).done).toBe(true)
    r.chaptersInDescription = false
    expect(step(r, 'chapters').missing).toMatch(/put the chapters at the end/)
  })
  it('won’t count a thumbnail YouTube would refuse', () => {
    const d = ready()
    d.thumbnails[0].file = 'attachments/thumb.webp'
    expect(step(d, 'thumbnail').done).toBe(false)
  })
  it('is ready once every step is ticked or not needed', () => {
    const d = ready()
    expect(readyToUpload(d)).toBe(false)
    for (const s of checklist(d)) if (!s.auto) d.ticked[s.id] = 1
    expect(readyToUpload(d)).toBe(true)
    d.chapters = []
    expect(readyToUpload(d)).toBe(false)
    d.skipped = ['chapters']
    expect(readyToUpload(d)).toBe(true)
    expect(draftProgress(d).total).toBe(checklist(d).length - 1)
  })
  it('puts your own steps at the end of getting the video ready', () => {
    const d = ready()
    d.extraSteps = [{ id: 'own-1', text: 'Sources double-checked' }]
    const ids = checklist(d).map((s) => s.id)
    expect(ids.indexOf('own-1')).toBe(ids.indexOf('watched') + 1)
    expect(step(d, 'own-1').done).toBe(false)
    expect(readyToUpload(d)).toBe(false)
  })
})
