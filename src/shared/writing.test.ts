import { describe, expect, it } from 'vitest'
import {
  addRevision,
  answerLinks,
  buildBrain,
  calendarClashes,
  calendarOrder,
  chapterHtml,
  chapterPlain,
  checkContinuity,
  dateLabel,
  isJustMention,
  countWords,
  diffText,
  epubFiles,
  findMentions,
  findQuote,
  flashbacks,
  inlineHtml,
  namesOf,
  neverMet,
  newChapter,
  newEntity,
  newScene,
  newStory,
  pacing,
  pairKey,
  parseGhost,
  parseHows,
  rankScenesFor,
  readNumber,
  readStory,
  relationshipAt,
  sceneLabels,
  splitForAi,
  storyDateKey,
  textAt,
  trackDay,
  writingStreak,
  type Entity,
  type Scene,
  type Story
} from './writing'

function scene(title: string, text: string, extra: Partial<Scene> = {}): Scene {
  const s = newScene(title)
  s.takes[0].text = text
  return { ...s, ...extra }
}

function person(name: string, extra: Partial<Entity> = {}): Entity {
  return { ...newEntity('character', name), ...extra }
}

function place(name: string): Entity {
  return newEntity('location', name)
}

/** Mara, Theo and Jun; the market and the docks; three chapters. */
function sample(): { story: Story; mara: Entity; theo: Entity; jun: Entity; market: Entity; docks: Entity } {
  const story = newStory('The Silver Ring')
  const mara = person('Mara Quinn', { aliases: ['Quinn'] })
  const theo = person('Theo')
  const jun = person('Jun')
  const market = place('the market')
  const docks = place('the docks')
  story.entities = [mara, theo, jun, market, docks]
  story.chapters = [
    { ...newChapter('Chapter 1'), scenes: [scene('Arrival', 'Mara walked through the market. Theo sold her an apple.', { date: 'Day 1' })] },
    { ...newChapter('Chapter 2'), scenes: [scene('The docks', 'At the docks, Jun waited. Theo ran.', { date: 'Day 1' })] },
    { ...newChapter('Chapter 3'), scenes: [scene('Night', 'Quinn and Jun finally spoke at the market.', { date: 'Day 2' })] }
  ]
  return { story, mara, theo, jun, market, docks }
}

describe('counting', () => {
  it('counts words, including contractions and numbers', () => {
    expect(countWords("Mara didn't open the 2 letters — ever.")).toBe(7)
    expect(countWords('')).toBe(0)
  })

  it('tracks words written today from the first change of the day', () => {
    const story = newStory('x')
    const now = new Date(2026, 10, 28, 10)
    Object.assign(story, trackDay(story, 1000, 1050, now))
    expect(story.days['2026-11-28']).toBe(50)
    Object.assign(story, trackDay(story, 1050, 1200, now))
    expect(story.days['2026-11-28']).toBe(200)
    Object.assign(story, trackDay(story, 1200, 900, now))
    expect(story.days['2026-11-28']).toBe(0)
    const tomorrow = new Date(2026, 10, 29, 9)
    Object.assign(story, trackDay(story, 900, 930, tomorrow))
    expect(story.days['2026-11-29']).toBe(30)
  })

  it('counts a streak of days, not breaking it before you write today', () => {
    const story = newStory('x')
    story.days = { '2026-11-25': 10, '2026-11-26': 300, '2026-11-27': 5 }
    expect(writingStreak(story, new Date(2026, 10, 28))).toBe(3)
    story.days['2026-11-28'] = 1
    expect(writingStreak(story, new Date(2026, 10, 28))).toBe(4)
    expect(writingStreak(story, new Date(2026, 10, 30))).toBe(0)
  })
})

describe('names', () => {
  it('finds a character by their first name too, unless someone shares it', () => {
    const a = person('Mara Quinn')
    const b = person('Theo Vance')
    expect(namesOf(a, [a, b])).toEqual(['Mara Quinn', 'Mara'])
    const c = person('Mara Bell')
    expect(namesOf(a, [a, c])).toEqual(['Mara Quinn'])
  })

  it('matches whole names with their capitals, longest first', () => {
    const will = person('Will')
    const mara = person('Mara Quinn')
    const ms = findMentions('Will said he will help Mara Quinn. Mara’s sister agreed, and Willow laughed.', [will, mara])
    expect(ms.map((m) => m.entity)).toEqual([will.id, mara.id, mara.id])
    expect(ms[1]).toMatchObject({ start: 23, end: 33 })
  })
})

describe('the brain', () => {
  it('works out who is in each scene and where it is', () => {
    const { story, mara, theo, jun, market, docks } = sample()
    const brain = buildBrain(story)
    expect(brain.scenes[0].cast.sort()).toEqual([mara.id, theo.id].sort())
    expect(brain.scenes[0].place).toBe(market.id)
    expect(brain.scenes[1].place).toBe(docks.id)
    expect(brain.scenes[2].cast.sort()).toEqual([mara.id, jun.id].sort())
    expect(brain.pairs.get(pairKey(mara.id, theo.id))).toEqual([story.chapters[0].scenes[0].id])
    expect(brain.pairs.get(pairKey(theo.id, mara.id))).toBeDefined()
  })

  it('lists who has never met, and rewinds to a chapter', () => {
    const { story, mara, theo, jun } = sample()
    const all = neverMet(story, buildBrain(story)).map(([a, b]) => pairKey(a, b))
    expect(all).toEqual([])
    expect(theo && jun).toBeTruthy()
    const early = neverMet(story, buildBrain(story, 1)).map(([a, b]) => pairKey(a, b))
    expect(early).toContain(pairKey(mara.id, jun.id))
  })

  it('tells someone in the scene from someone only mentioned', () => {
    const rick = person('Rick Grimes')
    const daryl = person('Daryl Dixon')
    const story = newStory('x')
    story.entities = [rick, daryl]
    const text = 'The story starts with Rick Grimes entering the CDC. He is thinking about how Daryl went out hunting last week and didn’t come back.'
    story.chapters = [{ ...newChapter('One'), scenes: [scene('Opening', text)] }]
    const s = buildBrain(story).scenes[0]
    expect(s.cast).toEqual([rick.id])
    expect(s.mentioned).toEqual([daryl.id])
    expect(buildBrain(story).pairs.size).toBe(0)
  })

  it('counts speech about someone as a mention, and speech to someone as them being there', () => {
    const daryl = person('Daryl')
    const at = (text: string): boolean => isJustMention(text, findMentions(text, [daryl])[0])
    expect(at('“Where’s Daryl?” Rick asked.')).toBe(true)
    expect(at('“Daryl, get down!” Rick shouted.')).toBe(false)
    expect(at('“Get down, Daryl!” Rick shouted.')).toBe(false)
    expect(at('Rick missed Daryl.')).toBe(true)
    expect(at('Daryl raised the crossbow.')).toBe(false)
    expect(at('He thought about it. Daryl came back at dawn.')).toBe(false)
    expect(at('Rick leaves the Sanctuary with Carol to find Daryl.')).toBe(true)
    expect(at('They went out looking for Daryl.')).toBe(true)
    expect(at('Rick went after Daryl.')).toBe(true)
    expect(at('Rick found Daryl by the fence.')).toBe(false)
    expect(at('Rick waited with Daryl.')).toBe(false)
  })

  it('lets you add and take out characters by hand', () => {
    const { story, mara, theo, jun } = sample()
    story.chapters[0].scenes[0].castRemove = [theo.id]
    story.chapters[0].scenes[0].castAdd = [jun.id]
    const brain = buildBrain(story)
    expect(brain.scenes[0].cast.sort()).toEqual([mara.id, jun.id].sort())
  })

  it('knows where a relationship stands at each point', () => {
    const { story, mara, theo } = sample()
    const [s1, s2, s3] = story.chapters.map((c) => c.scenes[0].id)
    const rel = { id: 'r', a: mara.id, b: theo.id, steps: [{ id: 'b', scene: s3, label: 'Enemies', note: '' }, { id: 'a', scene: s1, label: 'Friends', note: '' }] }
    expect(relationshipAt(story, rel, 0)?.label).toBe('Friends')
    expect(relationshipAt(story, rel, 1)?.label).toBe('Friends')
    expect(relationshipAt(story, rel)?.label).toBe('Enemies')
    expect(relationshipAt(story, { ...rel, steps: [{ id: 'x', scene: s2, label: 'Rivals', note: '' }] }, 0)).toBeNull()
  })
})

describe('the story calendar', () => {
  it('reads dates and day numbers', () => {
    expect(storyDateKey('Day 12')).toBe(12)
    expect(storyDateKey('day 3')).toBe(3)
    expect(storyDateKey('2026-03-14')! - storyDateKey('2026-03-13')!).toBe(1)
    expect(storyDateKey('next Tuesday')).toBeNull()
    expect(storyDateKey('1')).toBe(1)
    expect(dateLabel('1')).toBe('Day 1')
    expect(dateLabel('1888-10-31')).toBe('1888-10-31')
  })

  it('warns when a character is in two places on the same day', () => {
    const { story, theo, market, docks } = sample()
    const clashes = calendarClashes(buildBrain(story))
    expect(clashes).toHaveLength(1)
    expect(clashes[0]).toMatchObject({ character: theo.id, date: 'Day 1', places: [market.id, docks.id] })
  })

  it('lets different times on the same day pass', () => {
    const { story } = sample()
    story.chapters[0].scenes[0].time = '09:00'
    story.chapters[1].scenes[0].time = '18:00'
    expect(calendarClashes(buildBrain(story))).toHaveLength(0)
  })

  it('puts scenes in story-time order and spots flashbacks', () => {
    const { story } = sample()
    story.chapters[2].scenes[0].date = 'Day 0'
    const brain = buildBrain(story)
    expect(calendarOrder(brain).map((s) => s.title)).toEqual(['Night', 'Arrival', 'The docks'])
    expect(flashbacks(brain)).toEqual([story.chapters[2].scenes[0].id])
  })
})

describe('continuity', () => {
  it('flags an eye colour that goes against the page', () => {
    const { story, mara } = sample()
    mara.facts = [{ id: 'f', label: 'Eye colour', value: 'brown' }]
    const id = story.chapters[0].scenes[0].id
    const text = 'Mara looked up, her green eyes wide. Theo’s eyes were blue.'
    const issues = checkContinuity(story, id, text)
    expect(issues).toHaveLength(1)
    expect(text.slice(issues[0].start, issues[0].end)).toBe('green')
    expect(checkContinuity(story, id, 'Mara’s brown eyes narrowed.')).toHaveLength(0)
  })

  it('flags an age that goes against the page, in words or numbers', () => {
    const { story, theo } = sample()
    theo.facts = [{ id: 'f', label: 'Age', value: '17' }]
    const id = story.chapters[0].scenes[0].id
    expect(checkContinuity(story, id, 'Theo was sixteen years old that summer.')).toHaveLength(1)
    expect(checkContinuity(story, id, 'Theo, a 17-year-old thief, ran.')).toHaveLength(0)
    expect(readNumber('forty-two')).toBe(42)
  })

  it('flags a character who turns up after they died', () => {
    const { story, theo } = sample()
    theo.diesIn = story.chapters[0].scenes[0].id
    const later = story.chapters[1].scenes[0].id
    const issues = checkContinuity(story, later, 'Theo ran.')
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain('died')
    expect(checkContinuity(story, story.chapters[0].scenes[0].id, 'Theo ran.')).toHaveLength(0)
  })
})

describe('pacing', () => {
  it('splits dialogue, action and description', () => {
    const p = pacing('“Run,” she said.\nHe grabbed the rope and jumped. The sky was a pale, quiet grey over the hills.')
    expect(p.dialogue).toBeGreaterThan(0)
    expect(p.action).toBeGreaterThan(0)
    expect(p.description).toBeGreaterThan(0)
    expect(p.dialogue + p.action + p.description).toBeCloseTo(1)
    expect(pacing('').dialogue).toBe(0)
  })

  it('sees a chapter that is all talking', () => {
    const p = pacing('"Hi." "Hello." "How are you?" "Fine, thanks, and you?"')
    expect(p.dialogue).toBeGreaterThan(0.9)
  })
})

describe('time-lapse', () => {
  it('keeps each change and replays the text at any point', () => {
    let h = addRevision(undefined, '', 'Hello', 1)
    h = addRevision(h, 'Hello', 'Hello world', 2)
    h = addRevision(h, 'Hello world', 'Hi world', 3)
    expect(h.revs).toHaveLength(3)
    expect(textAt(h, 0)).toBe('')
    expect(textAt(h, 1)).toBe('Hello')
    expect(textAt(h, 2)).toBe('Hello world')
    expect(textAt(h, 3)).toBe('Hi world')
    expect(diffText('abc', 'abc', 1)).toBeNull()
  })

  it('folds the oldest changes into the start once there are too many', () => {
    let h = addRevision(undefined, '', 'a', 0)
    let text = 'a'
    for (let i = 0; i < 4100; i++) {
      const next = text + 'b'
      h = addRevision(h, text, next, i)
      text = next
    }
    expect(h.revs.length).toBe(4000)
    expect(textAt(h, h.revs.length)).toBe(text)
  })
})

describe('the offline AI', () => {
  it('keeps ghost reactions whose words are really in the chapter', () => {
    const text = 'A stranger with a silver ring stood by the door. She never opened the letter.'
    const reply = [
      '"a stranger with a silver ring" | wait, who is this?',
      '“she never opened the letter” – ooh, that’ll matter',
      '"a dragon appeared" | whoa',
      'Some chatter'
    ].join('\n')
    const got = parseGhost(reply, text)
    expect(got.map((g) => g.reaction)).toEqual(['wait, who is this?', 'ooh, that’ll matter'])
    const at = findQuote(text, got[1].quote)!
    expect(text.slice(at.start, at.end)).toBe('She never opened the letter')
  })

  it('reads one "how" line per pair', () => {
    expect(parseHows('1. first meet at the market\n2. Mara and Jun: argue about the letter\n3. nonsense', 2)).toEqual(['first meet at the market', 'argue about the letter'])
    expect(parseHows('nothing useful', 1)).toEqual([null])
  })

  it('splits a long chapter at paragraph ends', () => {
    const text = Array.from({ length: 50 }, (_, i) => `Paragraph ${i} ${'x'.repeat(100)}\n`).join('')
    const parts = splitForAi(text, 1000)
    expect(parts.join('')).toBe(text)
    expect(parts.every((p) => p.length <= 1000)).toBe(true)
  })

  it('finds the scenes a question is about, and links [S2] in answers', () => {
    const { story, mara, jun } = sample()
    const brain = buildBrain(story)
    const ranked = rankScenesFor('When did Mara and Jun talk?', story, brain)
    expect(ranked[0]).toBe(story.chapters[2].scenes[0].id)
    expect(mara && jun).toBeTruthy()
    const labels = sceneLabels(story)
    const parts = answerLinks('They speak at the market [S3]. Also [S9].', labels)
    expect(parts).toEqual([{ text: 'They speak at the market ' }, { scene: story.chapters[2].scenes[0].id, label: '[S3]' }, { text: '. Also [S9].' }])
  })
})

describe('export', () => {
  it('turns italics and bold into HTML, safely', () => {
    expect(inlineHtml('She *really* meant it, **always** <3')).toBe('She <em>really</em> meant it, <strong>always</strong> &lt;3')
    expect(inlineHtml('2*3*4')).toBe('2*3*4')
  })

  it('writes a chapter for AO3 and for Wattpad', () => {
    const ch = { ...newChapter('One'), scenes: [scene('a', 'First *line*.\n\nSecond.'), scene('b', 'Third.\n***\nFourth.'), scene('c', '   ')] }
    expect(chapterHtml(ch)).toBe('<p>First <em>line</em>.</p>\n<p>Second.</p>\n<p align="center">* * *</p>\n<p>Third.</p>\n<p align="center">* * *</p>\n<p>Fourth.</p>')
    expect(chapterPlain(ch)).toBe('First line.\n\nSecond.\n\n* * *\n\nThird.\n\n* * *\n\nFourth.')
  })

  it('makes the files of an e-book', () => {
    const { story } = sample()
    const files = epubFiles(story, 'Looby', new Date('2026-11-28T12:00:00Z'))
    expect(files[0]).toEqual({ path: 'mimetype', text: 'application/epub+zip' })
    const opf = files.find((f) => f.path === 'OEBPS/content.opf')!.text
    expect(opf).toContain('<dc:title>The Silver Ring</dc:title>')
    expect(opf).toContain('2026-11-28T12:00:00Z')
    expect(files.filter((f) => /chapter-\d+\.xhtml$/.test(f.path))).toHaveLength(3)
  })
})

describe('reading a story file', () => {
  it('fills in anything missing so a broken file still opens', () => {
    const s = readStory({ title: 'Half synced', chapters: [{ title: 'One', scenes: [{ takes: [] }] }], entities: [{ name: 'X', kind: 'nonsense' }], relationships: [{ a: 'x', b: 'x' }] })
    expect(s.title).toBe('Half synced')
    expect(s.chapters[0].scenes[0].takes).toHaveLength(1)
    expect(s.entities[0].kind).toBe('character')
    expect(s.relationships).toHaveLength(0)
    expect(readStory(null).chapters).toHaveLength(1)
  })

  it('keeps everything through a save and load', () => {
    const { story } = sample()
    expect(readStory(JSON.parse(JSON.stringify(story)))).toEqual(story)
  })
})
