import { describe, expect, it } from 'vitest'
import { clocksText, tasksText, wallTimeIn, artistSeeds, pickSong, calendarText, cleanFolder, cleanNoteName, countdownsText, drivesText, findNotePath, flashcardLines, flashcardsText, isInside, isStruggling, matchSongs, taggedText, type CardWithProgress } from './claudeFormat'
import type { LocalSong } from './localMusic'

describe('notes', () => {
  const paths = ['Ideas.md', 'School/History/Romans.md', 'School/History/Tudors.md', 'Shopping.md', 'Old/Shopping.md']

  it('finds the note Claude means', () => {
    expect(findNotePath(paths, 'School/History/Romans.md')).toBe('School/History/Romans.md')
    expect(findNotePath(paths, 'school/history/romans')).toBe('School/History/Romans.md')
    expect(findNotePath(paths, 'Tudors')).toBe('School/History/Tudors.md')
    // Two notes are called Shopping: the top one is meant only when the path says so.
    expect(findNotePath(paths, 'Shopping')).toBe('Shopping.md')
    expect(findNotePath(paths, 'Nope')).toBeNull()
  })

  it('makes names and folders safe', () => {
    expect(cleanNoteName('What: is/this?')).toBe('What is this')
    expect(cleanNoteName('  ..  ')).toBe('Untitled')
    expect(cleanFolder('../../Windows\\System32/')).toBe('Windows/System32')
    expect(cleanFolder(undefined)).toBe('')
  })

  it('knows what is inside a folder', () => {
    expect(isInside('School/History/Romans.md', 'School')).toBe(true)
    expect(isInside('School/History/Romans.md', 'school/history/romans')).toBe(true)
    expect(isInside('Schoolwork.md', 'School')).toBe(false)
    expect(isInside('Anything.md', '')).toBe(true)
  })
})

describe('calendarText', () => {
  it('groups by day, all-day first, in the range only', () => {
    const text = calendarText(
      [
        { date: '2026-11-28', start: '10:00', title: 'Football', from: 'Orbit (2026-11-28)' },
        { date: '2026-11-28', title: 'Holiday', from: 'Family' },
        { date: '2026-12-25', title: 'Christmas', from: 'Holidays' }
      ],
      '2026-11-25',
      '2026-12-02'
    )
    expect(text).toBe('Sat 2026-11-28\n  all day  Holiday  [Family]\n  10:00  Football  [Orbit (2026-11-28)]')
    expect(calendarText([], '2026-11-25', '2026-11-26')).toContain('Nothing on')
  })
})

describe('countdowns', () => {
  it('says how long is left, soonest first', () => {
    const now = new Date('2026-11-25T12:00:00')
    const text = countdownsText(
      [
        { id: 'a', title: 'Holiday', kind: 'trip', date: '2026-12-20', time: '', yearly: false, created: 0 },
        { id: 'b', title: 'Birthday', kind: 'birthday', date: '2026-11-26', time: '', yearly: true, created: 0 }
      ],
      now
    )
    expect(text.split('\n')[0]).toMatch(/^Birthday: Tomorrow/)
    expect(text.split('\n')[1]).toMatch(/^Holiday: In \d+ (days|weeks)/)
  })
})

describe('flashcards', () => {
  const cards: CardWithProgress[] = [
    { path: 'French.md', question: 'chat', answer: 'cat' },
    { path: 'French.md', question: 'chien', answer: 'dog', progress: { due: '2026-11-25', interval: 1, ease: 1.7, streak: 0 } },
    { path: 'French.md', question: 'maison', answer: 'house', progress: { due: '2026-12-20', interval: 20, ease: 2.6, streak: 4 } }
  ]

  it('spots the ones they keep getting wrong', () => {
    expect(cards.map(isStruggling)).toEqual([false, true, false])
    const text = flashcardsText(cards, '2026-11-25', { struggling: true })
    expect(text).toContain('chien :: dog')
    expect(text).not.toContain('maison')
    expect(text).toMatch(/^3 card\(s\), 2 due today, 1 they keep getting wrong/)
  })

  it('writes new cards the way the Flashcards page reads them', () => {
    expect(flashcardLines([{ question: 'What is 2 :: 2?', answer: ' 4 ' }, { question: '', answer: 'x' }, { question: 'Capital of\nFrance', answer: 'Paris' }])).toEqual(['- What is 2: 2? :: 4', '- Capital of France :: Paris'])
  })
})

describe('files', () => {
  it('lists tagged files changed lately, newest first', () => {
    const now = Date.parse('2026-11-25T12:00:00Z')
    const day = 86_400_000
    const e = (path: string, ago: number) => ({ name: path, path, isDir: false, size: 2048, modified: now - ago * day, hidden: false, vaultPath: null })
    expect(taggedText([e('C:/a.txt', 10), e('C:/b.txt', 2), e('C:/c.txt', 5)], 'red', 7, now)).toBe('C:/b.txt, 2 KB, changed 2026-11-23\nC:/c.txt, 2 KB, changed 2026-11-20')
    expect(taggedText([], 'red', undefined, now)).toBe('Nothing is tagged red.')
  })

  it('says which drive is nearly full', () => {
    const gb = 1024 ** 3
    const text = drivesText({ 'C:\\': { total: 500 * gb, free: 20 * gb }, 'D:\\': { total: 1000 * gb, free: 600 * gb }, 'E:\\': null })
    expect(text.split('\n')).toEqual(['C:\\: 20.0 GB free of 500.0 GB (96% full, nearly full)', 'D:\\: 600.0 GB free of 1000.0 GB (40% full)'])
  })
})

describe('matchSongs', () => {
  const song = (title: string, artist: string, genre?: string): LocalSong => ({ path: `${title}.mp3`, title, artist, album: 'A', track: 0, durationMs: 1, art: false, genre })
  const songs = [song('Do I Wanna Know', 'Arctic Monkeys', 'Rock'), song('Sunset', 'Lofi Girl', 'Chill'), song('Rain', 'Chill Beats', 'Lofi')]

  it('matches every word first, then any', () => {
    expect(matchSongs(songs, 'arctic monkeys').map((s) => s.title)).toEqual(['Do I Wanna Know'])
    expect(matchSongs(songs, 'chill').map((s) => s.title)).toEqual(['Sunset', 'Rain'])
    expect(matchSongs(songs, 'chill jazz').map((s) => s.title)).toEqual(['Sunset', 'Rain'])
    expect(matchSongs(songs, '')).toEqual([])
  })
})

describe('pickSong', () => {
  const song = (title: string, artist: string): LocalSong => ({ path: `${title}.mp3`, title, artist, album: '', track: 0, durationMs: 1, art: false })
  const songs = [song('No One Left To Love', 'Alan Wake & ROOS + BERG'), song('Lost Boys', 'Phoebe Bridgers'), song('Lost', 'Frank Ocean'), song('Invincible', 'Ruelle')]

  it('finds the song however it’s written', () => {
    expect(pickSong(songs, 'no one left to love')?.artist).toBe('Alan Wake & ROOS + BERG')
    expect(pickSong(songs, 'Lost Boys by Phoebe Bridgers')?.title).toBe('Lost Boys')
    expect(pickSong(songs, 'Phoebe Bridgers - Lost Boys')?.title).toBe('Lost Boys')
    // "Lost" is a title of its own, even though "Lost Boys" has it too.
    expect(pickSong(songs, 'Lost')?.artist).toBe('Frank Ocean')
    expect(pickSong(songs, 'ruelle')?.title).toBe('Invincible')
    expect(pickSong(songs, 'Bohemian Rhapsody')).toBeNull()
  })

  it('never settles for a different song that only shares a word', () => {
    const lib = [...songs, song('FUNK ESTRELAS – Super Slowed', 'MXZI'), song('Coming Home', 'Skylar Grey')]
    expect(pickSong(lib, 'I’ll Keep Coming by Low Roar')).toBeNull()
    expect(pickSong(lib, 'I’ll Keep Coming')).toBeNull()
    // Same title, different artist: not the one they meant.
    expect(pickSong(lib, 'Lost Boys by Ruelle')).toBeNull()
  })

  it('makes suggestions from the artists a playlist has most', () => {
    expect(artistSeeds([song('a', 'Ruelle'), song('b', 'Ruelle'), song('c', 'Phoebe Bridgers, Ruelle')])).toEqual([
      { name: 'Ruelle', weight: 3 },
      { name: 'Phoebe Bridgers', weight: 1 }
    ])
  })
})

describe('world clocks', () => {
  it('turns a time in one place into the moment it is', () => {
    expect(wallTimeIn('America/New_York', '2026-11-25', '19:00').toISOString()).toBe('2026-11-26T00:00:00.000Z')
    expect(wallTimeIn('Europe/London', '2026-07-01', '09:30').toISOString()).toBe('2026-07-01T08:30:00.000Z')
  })

  it('says the time on each clock and whether to message a friend', () => {
    const now = new Date('2026-11-25T12:00:00Z')
    const text = clocksText([{ id: 'a', label: 'Sydney', zone: 'Australia/Sydney', person: 'Sam' }], 'Europe/London', now, false)
    expect(text.split('\n')[0]).toBe('Here [Europe/London]: Wed 12:00')
    expect(text).toContain('Sam (Sydney) [Australia/Sydney]: Wed 23:00 (Today), 11 hours ahead')
  })
})

describe('tasksText', () => {
  it('lists the busiest programs first', () => {
    const g = (name: string, cpu: number, mem: number) => ({ id: name, name, kind: 'app' as const, procs: [], cpu, mem })
    const text = tasksText([g('Chrome', 5, 2e9), g('Game', 40, 1e9)], 'cpu', 10)
    expect(text.split('\n')[0]).toMatch(/^Game \(app\): CPU 40\.0%/)
    expect(tasksText([g('Chrome', 5, 2e9), g('Game', 40, 1e9)], 'memory', 10).split('\n')[0]).toMatch(/^Chrome/)
    expect(tasksText([], 'cpu', 10, 'zoom')).toContain('Nothing running matches')
  })
})
