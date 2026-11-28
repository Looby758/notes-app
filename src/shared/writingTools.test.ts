import { describe, expect, it } from 'vitest'
import { brainSummary, buildBrain, newChapter, newEntity, newId, newScene, newStory, READER, readStory, sceneLabels, type Story } from './writing'
import {
  ao3Suggest,
  canonDifferences,
  canonIssues,
  commentHeat,
  cutFrom,
  dialogueLines,
  knows,
  mapSteps,
  openThreads,
  presetShape,
  sceneContext,
  secretGaps,
  secretSlips,
  shapeAt,
  shapeDrift,
  speechChunks,
  storyShape,
  tension,
  threadMarks,
  voiceFlags,
  voices,
  SHAPE_POINTS
} from './writingTools'

function walkers(): { story: Story; rick: string; daryl: string; carol: string; cdc: string; prison: string; s: string[] } {
  const story = newStory('Walkers')
  const rick = newEntity('character', 'Rick Grimes')
  const daryl = newEntity('character', 'Daryl Dixon')
  const carol = newEntity('character', 'Carol')
  const cdc = newEntity('location', 'CDC')
  const prison = newEntity('location', 'the prison')
  story.entities = [rick, daryl, carol, cdc, prison]
  const scene = (title: string, text: string, date = ''): ReturnType<typeof newScene> => {
    const s = newScene(title)
    s.takes[0].text = text
    s.date = date
    return s
  }
  const c1 = newChapter('Chapter 1')
  c1.scenes = [scene('Opening', 'Rick walked into the CDC. The bite on his arm burned.', '1'), scene('Supper', 'Carol cooked at the CDC while Rick watched.', '1')]
  const c2 = newChapter('Chapter 2')
  c2.scenes = [scene('Tracks', 'Daryl knelt in the mud at the prison and read the tracks.', '2'), scene('The truth', 'Rick showed Carol the bite. Carol gasped.', '3')]
  story.chapters = [c1, c2]
  return { story, rick: rick.id, daryl: daryl.id, carol: carol.id, cdc: cdc.id, prison: prison.id, s: [...c1.scenes, ...c2.scenes].map((x) => x.id) }
}

describe('who knows what', () => {
  it('flags a character acting on a secret before they find out, and not after', () => {
    const w = walkers()
    w.story.secrets = [
      {
        id: newId(),
        text: 'Rick was bitten',
        cues: ['bite', 'bitten'],
        learns: [
          { id: newId(), who: w.rick, scene: '' },
          { id: newId(), who: w.carol, scene: w.s[3] },
          { id: newId(), who: READER, scene: w.s[0] }
        ]
      }
    ]
    expect(secretSlips(w.story, w.s[0], 'Rick hid the bite.')).toEqual([])
    const early = secretSlips(w.story, w.s[1], 'Carol asked about the bite.')
    expect(early).toHaveLength(1)
    expect(early[0].message).toContain('Carol doesn’t find out until “Chapter 2 – The truth”')
    expect(secretSlips(w.story, w.s[3], 'Carol stared at the bite.')).toEqual([])
    expect(secretSlips(w.story, w.s[1], 'Daryl saw the bite.')[0].message).toContain('never finds out')
    expect(knows(w.story, w.story.secrets[0], w.carol, 3)).toBe(true)
    const gaps = secretGaps(w.story, w.story.secrets[0])
    expect(gaps).toEqual([
      { who: w.rick, ahead: 'character', from: -1, to: 0 },
      { who: w.carol, ahead: 'reader', from: 0, to: 3 }
    ])
  })
})

describe('setups and payoffs', () => {
  it('lists open setups and finds them in the text', () => {
    const w = walkers()
    w.story.threads = [
      { id: 'a', label: 'The bite', setup: { scene: w.s[0], quote: 'The bite on his arm' }, payoffs: [], dropped: false },
      { id: 'b', label: 'Done', setup: { scene: w.s[0], quote: 'Rick walked' }, payoffs: [{ scene: w.s[3], quote: 'Carol gasped' }], dropped: false },
      { id: 'c', label: 'Let go', setup: { scene: w.s[1], quote: 'Carol cooked' }, payoffs: [], dropped: true }
    ]
    expect(openThreads(w.story).map((t) => t.id)).toEqual(['a'])
    const marks = threadMarks(w.story, w.s[0], 'Rick walked into the CDC. The bite on his arm burned.')
    expect(marks.map((m) => m.kind).sort()).toEqual(['setup', 'setup'])
    expect(threadMarks(w.story, w.s[3], 'Rick showed Carol the bite. Carol gasped.')[0]).toMatchObject({ kind: 'payoff', from: 28 })
  })
})

describe('voice check', () => {
  it('works out who says each line', () => {
    const ents = walkers().story.entities
    const lines = dialogueLines('“Get down,” Daryl said.\n“Where?” Carol asked, looking at Rick.\n“Nobody” said it.', ents)
    expect(lines.map((l) => [l.text, ents.find((e) => e.id === l.who)?.name])).toEqual([
      ['Get down,', 'Daryl Dixon'],
      ['Where?', 'Carol']
    ])
  })

  it('flags a line that doesn’t sound like the character', () => {
    const w = walkers()
    const sc = w.story.chapters[0].scenes[0]
    sc.takes[0].text = Array.from({ length: 10 }, () => '“Don’t. Can’t stay,” Daryl said.').join('\n')
    expect(voices(w.story).get(w.daryl)?.lines).toBe(10)
    const flags = voiceFlags(w.story, w.s[2], '“Damn it, I do not know,” Daryl said.')
    expect(flags).toHaveLength(1)
    expect(flags[0].message).toContain('doesn’t swear')
    const formal = voiceFlags(w.story, w.s[2], '“I do not know,” Daryl said.')
    expect(formal[0].message).toContain('usually says “don’t”')
    const long = voiceFlags(w.story, w.s[2], '“Been thinking for a very long time now about everything that happened at the farm and the prison and the road,” Daryl said.')
    expect(long[0].message).toContain('Long for Daryl Dixon')
  })
})

describe('canon drawer', () => {
  it('checks scenes against canon facts unless changed on purpose, and spots the dead', () => {
    const w = walkers()
    w.story.canon.facts = [
      { id: 'f1', entity: w.carol, label: 'Eye colour', value: 'blue', changed: false },
      { id: 'f2', entity: w.daryl, label: 'Status', value: 'dead in season 3', changed: false },
      { id: 'f3', entity: w.rick, label: 'Hair', value: 'brown', changed: true }
    ]
    const issues = canonIssues(w.story, w.s[2], 'Carol’s green eyes watched Daryl kneel. Rick’s blond hair dripped.')
    expect(issues.map((i) => i.message)).toEqual(['In canon, Carol’s eye colour is blue.', 'In canon, Daryl Dixon is dead in season 3. If that’s on purpose, tick “Changed on purpose” in the canon drawer.'])
    // A page fact that differs wins in the text, and shows up as a difference instead.
    w.story.entities.find((e) => e.id === w.carol)!.facts = [{ id: 'p', label: 'Eye colour', value: 'green' }]
    expect(canonIssues(w.story, w.s[2], 'Carol’s green eyes.').length).toBe(0)
    expect(canonDifferences(w.story)).toEqual([{ fact: 'f1', entity: w.carol, page: 'green', canon: 'blue' }])
  })
})

describe('AO3 tags', () => {
  it('suggests characters, relationships, warnings and a rating', () => {
    const w = walkers()
    w.story.relationships = [
      { id: 'r1', a: w.rick, b: w.carol, steps: [{ id: 's', scene: w.s[1], label: 'Friends', note: '' }] },
      { id: 'r2', a: w.daryl, b: w.carol, steps: [{ id: 's2', scene: w.s[2], label: 'Dating', note: '' }] }
    ]
    w.story.entities.find((e) => e.id === w.daryl)!.diesIn = w.s[3]
    w.story.canon.source = 'The Walking Dead (TV)'
    w.story.canon.splitAt = w.s[2]
    const t = ao3Suggest(w.story)
    expect(t.fandom).toBe('The Walking Dead (TV)')
    expect(t.characters[0]).toBe('Rick Grimes')
    expect(t.relationships).toEqual(['Daryl Dixon/Carol', 'Rick Grimes & Carol'])
    expect(t.warnings).toEqual(['Major Character Death'])
    expect(t.rating).toBe('Teen And Up Audiences')
    expect(t.freeform).toContain('Alternate Universe - Canon Divergence')
  })
})

describe('reader comments', () => {
  it('finds the lines readers quoted and who they talked about', () => {
    const w = walkers()
    const ch = w.story.chapters[1]
    ch.scenes[0].takes[0].text = 'Daryl knelt in the mud at the prison and read the tracks. It was quiet.'
    const heat = commentHeat(w.story, ch, [
      { id: 'c1', text: 'DARYL knelt in the mud and read the tracks??? love him. Daryl!!', at: 0 },
      { id: 'c2', text: '“knelt in the mud at the prison” my heart', at: 0 },
      { id: 'c3', text: 'Carol gasped and so did I', at: 0 }
    ])
    expect(heat.lines[0]).toMatchObject({ scene: ch.scenes[0].id, comments: ['c1', 'c2'], start: 0 })
    expect(heat.lines.some((l) => l.text === 'Carol gasped.')).toBe(false)
    expect(heat.names).toEqual([
      { entity: w.daryl, count: 1 },
      { entity: w.carol, count: 1 }
    ])
  })
})

describe('cutting room floor', () => {
  it('keeps deleted passages, not small edits or rewrites', () => {
    const para = 'The rain came down on the prison yard all night long without stopping. '
    expect(cutFrom(`Start. ${para}End.`, 'Start. End.')).toBe(para.trim())
    expect(cutFrom('The rain came down.', 'The rain fell.')).toBeNull()
    expect(cutFrom(`Start. ${para}End.`, `Start. ${para.replace('rain', 'snow')}End.`)).toBeNull()
  })
})

describe('story map', () => {
  it('moves characters from place to place in calendar order', () => {
    const w = walkers()
    const { steps, byCalendar } = mapSteps(w.story)
    expect(byCalendar).toBe(true)
    expect(steps.map((s) => s.label)).toEqual(['Day 1', 'Day 1', 'Day 2'])
    expect(steps[2].at).toEqual({ [w.rick]: w.cdc, [w.carol]: w.cdc, [w.daryl]: w.prison })
  })
})

describe('the shape', () => {
  it('scores action as tenser than description, and finds where the drawing drifts', () => {
    expect(tension('He ran! She grabbed the gun. Shots. Run!')).toBeGreaterThan(tension('The meadow stretched out under a slow and gentle afternoon sky, golden and wide and quiet.'))
    const w = walkers()
    w.story.chapters[0].scenes[0].takes[0].text = 'The meadow stretched out under a slow and gentle afternoon sky, golden and wide and quiet.'
    w.story.chapters[1].scenes[1].takes[0].text = 'He ran! She grabbed the gun. Shots. Run!'
    const pts = storyShape(w.story)
    expect(pts[0].y).toBe(0)
    expect(pts[pts.length - 1].y).toBe(1)
    const flat = Array.from({ length: SHAPE_POINTS }, () => 0)
    expect(shapeDrift(pts, flat)[0].scene).toBe(w.s[3])
    expect(shapeAt([0, 1], 0.5)).toBe(0.5)
    expect(presetShape('rise')).toHaveLength(SHAPE_POINTS)
  })
})

describe('read it to me and the stuck button', () => {
  it('splits a scene into bits to read', () => {
    expect(speechChunks('Hi. He ran to the gate.\nShe waited there quietly.').map((c) => c.text)).toEqual(['Hi. He ran to the gate.', 'She waited there quietly.'])
  })

  it('tells the AI what the brain knows about a scene', () => {
    const w = walkers()
    w.story.secrets = [{ id: 'x', text: 'Rick was bitten', cues: ['bite'], learns: [{ id: 'l', who: w.rick, scene: '' }] }]
    w.story.threads = [{ id: 't', label: 'The bite', setup: { scene: w.s[0], quote: 'bite' }, payoffs: [], dropped: false }]
    const ctx = sceneContext(w.story, w.s[1])
    expect(ctx).toContain('In the scene: Carol, Rick Grimes')
    expect(ctx).toContain('Set up earlier and not paid off yet: The bite')
    expect(ctx).toContain('Secret “Rick was bitten”: Rick Grimes knows; the reader doesn’t know yet')
    expect(ctx).toContain('The bite on his arm burned.')
  })
})

describe('the new story parts', () => {
  it('read back from a file, with anything broken filled in', () => {
    const w = walkers()
    w.story.pins = { [w.cdc]: { x: 0.2, y: 0.4 } }
    w.story.cuts = [{ id: 'c', text: 'gone', scene: w.s[0], from: 'Opening', at: 1 }]
    const back = readStory(JSON.parse(JSON.stringify({ ...w.story, pins: { ...w.story.pins, bad: { x: 9, y: 'no' } } })))
    expect(back.pins[w.cdc]).toEqual({ x: 0.2, y: 0.4 })
    expect(back.pins.bad).toEqual({ x: 1, y: 0.5 })
    expect(back.cuts[0].text).toBe('gone')
    const old = readStory({ title: 'Old story' })
    expect(old.threads).toEqual([])
    expect(old.canon).toEqual({ source: '', splitAt: '', splitNote: '', facts: [] })
    expect(old.tags.extra).toEqual([])
  })

  it('tells the AI who has died, even when the text never says', () => {
    const w = walkers()
    w.story.entities.find((e) => e.id === w.carol)!.diesIn = w.s[2]
    const summary = brainSummary(w.story, buildBrain(w.story), sceneLabels(w.story))
    expect(summary).toContain('- Carol (dies in [S3] Chapter 2 – Tracks)')
    expect(brainSummary(w.story, buildBrain(w.story, 0), sceneLabels(w.story), 1)).not.toContain('dies in')
  })
})
