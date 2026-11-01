import { describe, expect, it } from 'vitest'
import { normaliseTitle } from './wiki'
import {
  allowed,
  buildTimeline,
  DEFAULT_SPOILERS,
  filterPage,
  forbiddenNames,
  mentionsHidden,
  pageAllowed,
  pagePart,
  placedChunks,
  spoilerSettings,
  timelineFact,
  type TimelineFact,
  type WikiSpoilerSettings
} from './wikiSpoilers'

const base = 'https://walkingdead.fandom.com'
const key = (t: string): string => normaliseTitle(t).toLowerCase()
const box = (fields: string): string => `<aside class="portable-infobox">${fields}</aside>`
const field = (source: string, label: string, value: string): string =>
  `<div class="pi-item pi-data" data-source="${source}"><h3 class="pi-data-label">${label}</h3><div class="pi-data-value">${value}</div></div>`
const episode = (s: number, e: number): string => box(field('number', 'Number', `Season ${s}, Episode ${e}`))
const TV = ['Television Universe', 'TV Series Episodes', `Season 1 Episodes`]

// A little Walking Dead: two seasons of the show, a spin-off and a few comics.
const facts: TimelineFact[] = [
  timelineFact('Days Gone Bye (TV Series)', TV, episode(1, 1), base)!,
  timelineFact('Guts', TV, episode(1, 2), base)!,
  timelineFact('What Lies Ahead', TV, episode(2, 1), base)!,
  timelineFact('Bloodletting', TV, episode(2, 2), base)!,
  timelineFact('Beside the Dying Fire', TV, episode(2, 13), base)!,
  timelineFact('Old Acquaintances', ['Television Universe', 'Dead City Episodes'], episode(1, 1), base)!,
  timelineFact('Issue 1', ['Comic Universe', 'Comic Series Issues'], '', base)!,
  timelineFact('Issue 7', ['Comic Universe', 'Comic Series Issues'], '', base)!,
  timelineFact('Volume 1: Days Gone Bye', ['Comic Universe', 'Volumes', 'Comic Series Issues'], box('<a href="/wiki/Issue_1">Issue 1</a>'), base)!,
  timelineFact('Volume 2: Miles Behind Us', ['Comic Universe', 'Volumes'], box('<a href="/wiki/Issue_7">Issue 7</a>'), base)!
]
const timeline = buildTimeline(facts, key)
const ctx = { timeline, key, base }
const at = (progress: Record<string, number>, extra: Partial<WikiSpoilerSettings> = {}): WikiSpoilerSettings => ({ ...DEFAULT_SPOILERS, limit: true, progress, ...extra })

const glenn = `<div class="mw-parser-output">
${box(
  field('name', 'Name', 'Glenn Rhee') +
    field('status', 'Status', 'Dead') +
    field('first', 'First Appearance', '<a href="/wiki/Days_Gone_Bye_(TV_Series)">Days Gone Bye</a>') +
    field('death episode', 'Death Episode', '<a href="/wiki/Beside_the_Dying_Fire">Beside the Dying Fire</a>')
)}
<p>Glenn is a pizza delivery boy who became a survivor.</p>
<h2><span class="mw-headline" id="Post-Apocalypse">Post-Apocalypse</span></h2>
<h3><span class="mw-headline" id="TV_Series">TV Series</span></h3>
<h4><span class="mw-headline" id="Season_1">Season 1</span></h4>
<dl><dt>"<a href="/wiki/Guts">Guts</a>"</dt></dl>
<p>Glenn saves Rick from the tank.</p>
<h4><span class="mw-headline" id="Season_2">Season 2</span></h4>
<dl><dt>"<a href="/wiki/What_Lies_Ahead">What Lies Ahead</a>"</dt></dl>
<p>Glenn waits on the highway.</p>
<dl><dt>"<a href="/wiki/Beside_the_Dying_Fire">Beside the Dying Fire</a>"</dt></dl>
<p>Glenn is killed by the Governor.</p>
<h3><span class="mw-headline" id="Dead_City">Dead City</span></h3>
<h4><span class="mw-headline" id="Season_1_2">Season 1</span></h4>
<p>Glenn appears in a flashback in New York.</p>
<h2><span class="mw-headline" id="Death">Death</span></h2>
<p>Killed by the Governor in <a href="/wiki/Beside_the_Dying_Fire">Beside the Dying Fire</a>.</p>
<div class="trfc161"><b>Quick answer: Glenn dies.</b></div>
<script>alert(1)</script>
</div>`
const glennCats = ['Characters', 'TV Series Characters', 'Television Universe', 'Deceased']
const show = (s: WikiSpoilerSettings): string => filterPage(glenn, 'Glenn Rhee (TV Series)', glennCats, ctx, s, false).html

describe('the timeline', () => {
  it('finds the episodes, issues and volumes, each show its own series', () => {
    expect(timeline.series.map((s) => [s.name, s.part, s.points.length])).toEqual([
      ['TV Series', 'show', 5],
      ['Dead City', 'show', 1],
      ['Comic Series', 'comics', 2]
    ])
    expect(timeline.entries['guts']).toEqual({ series: 'TV Series', part: 'show', order: 1002 })
    expect(timeline.entries['volume 2: miles behind us']).toEqual({ series: 'Comic Series', part: 'comics', order: 7 })
    expect(timeline.series[2].points[1].label).toBe('Issue 7 (Volume 2)')
    expect(timeline.series[0].points[0].label).toBe('Season 1, Episode 1')
  })
  it('sorts pages into show, comics and other', () => {
    expect(pagePart(['Television_Universe', 'TV_Series'])).toBe('show')
    expect(pagePart(['Comic_Universe'])).toBe('comics')
    expect(pagePart(['Video_Game_Universe'])).toBe('other')
    expect(pagePart(['Comic Universe', 'TV Series'])).toBe('other')
  })
})

describe('hiding what’s past where you are', () => {
  it('shows what you’ve seen and hides the rest, to the episode', () => {
    const html = show(at({ 'TV Series': 2001 }))
    expect(html).toContain('Glenn saves Rick from the tank.')
    expect(html).toContain('Glenn waits on the highway.')
    expect(html).not.toContain('killed by the Governor')
    expect(html).not.toContain('Killed by the Governor')
    expect(html).not.toContain('Beside the Dying Fire')
    expect(html).toContain('Hidden: this is past where you are.')
  })
  it('hides a spin-off you haven’t started, and headings with nothing left', () => {
    const html = show(at({ 'TV Series': 2013 }))
    expect(html).toContain('Glenn is killed by the Governor.')
    expect(html).not.toContain('New York')
    expect(html).not.toContain('Dead City')
    expect(show(at({ 'TV Series': 2013, 'Dead City': 1001 }))).toContain('New York')
  })
  it('hides what can’t be placed, unless you ask to see it', () => {
    const s = at({ 'TV Series': 2013 })
    expect(show(s)).not.toContain('pizza delivery boy')
    expect(filterPage(glenn, 'Glenn Rhee (TV Series)', glennCats, ctx, s, true).html).toContain('pizza delivery boy')
  })
  it('keeps safe info box fields and hides the telling ones', () => {
    const html = show(at({ 'TV Series': 1001 }))
    expect(html).toContain('Glenn Rhee')
    expect(html).not.toContain('Dead')
    expect(html).not.toContain('Death Episode')
  })
  it('shows a row label only when its value is shown', () => {
    const row = box(
      '<table class="pi-horizontal-group"><thead><tr><th class="pi-horizontal-group-item pi-data-label" data-source="first">First Appearance</th><th class="pi-horizontal-group-item pi-data-label" data-source="death">Death Episode</th></tr></thead>' +
        '<tbody><tr><td class="pi-horizontal-group-item pi-data-value" data-source="first"><a href="/wiki/Guts">Guts</a></td><td class="pi-horizontal-group-item pi-data-value" data-source="death"><a href="/wiki/Beside_the_Dying_Fire">Beside the Dying Fire</a></td></tr></tbody></table>'
    )
    const html = filterPage(row, 'Glenn Rhee (TV Series)', glennCats, ctx, at({ 'TV Series': 2001 }), false).html
    expect(html).toContain('First Appearance')
    expect(html).toContain('Guts')
    expect(html).not.toContain('Death Episode')
    expect(html).not.toContain('Dying Fire')
  })
  it('always takes out Fandom’s quick answers and scripts', () => {
    const html = show(at({ 'TV Series': 9999 }))
    expect(html).not.toContain('Quick answer')
    expect(html).not.toContain('alert(1)')
  })
  it('changes nothing with the limit off', () => {
    expect(show(DEFAULT_SPOILERS)).toContain('Glenn is killed by the Governor.')
  })
})

describe('whole pages', () => {
  const { facts: f } = placedChunks(glenn, 'Glenn Rhee (TV Series)', glennCats, ctx)
  it('knows when a page’s subject first appears', () => {
    expect(f).toEqual({ part: 'show', self: null, first: { 'TV Series': 1001 } })
    expect(pageAllowed(f, at({}))).toBe('later')
    expect(pageAllowed(f, at({ 'TV Series': 1001 }))).toBe('ok')
  })
  it('hides pages about the part you’ve switched off', () => {
    expect(pageAllowed(f, { ...DEFAULT_SPOILERS, parts: 'comics' })).toBe('part')
    expect(pageAllowed({ part: 'other', self: null, first: null }, { ...DEFAULT_SPOILERS, parts: 'comics' })).toBe('ok')
  })
  it('places a page with no first appearance by the earliest thing on it, and hides one with nothing placeable', () => {
    const place = '<p>The prison is first seen in <a href="/wiki/Bloodletting">Bloodletting</a>.</p><p>Later: <a href="/wiki/Beside_the_Dying_Fire">x</a></p>'
    const { facts: p } = placedChunks(place, 'The Prison (TV Series)', ['Television Universe'], ctx)
    expect(p.first).toEqual({ 'TV Series': 2002 })
    expect(pageAllowed(p, at({ 'TV Series': 2001 }))).toBe('later')
    expect(pageAllowed(p, at({ 'TV Series': 2002 }))).toBe('ok')
    const { facts: none } = placedChunks('<p>A writer.</p>', 'Robert Kirkman', ['Real People'], ctx)
    expect(pageAllowed(none, at({ 'TV Series': 9999 }))).toBe('unplaced')
    expect(pageAllowed(none, DEFAULT_SPOILERS)).toBe('ok')
  })
  it('places an episode’s own page at that episode', () => {
    const { facts: e } = placedChunks(episode(2, 2) + '<p>Plot.</p>', 'Bloodletting', TV, ctx)
    expect(e.self).toEqual({ 'TV Series': 2002 })
    expect(pageAllowed(e, at({ 'TV Series': 2001 }))).toBe('later')
  })
})

describe('search and the wiki brain', () => {
  it('places each piece of text for searching', () => {
    const { chunks } = placedChunks(glenn, 'Glenn Rhee (TV Series)', glennCats, ctx)
    const death = chunks.find((c) => c.text.includes('killed by the Governor'))!
    expect(death.req).toEqual({ 'TV Series': 2013 })
    expect(allowed(death.req, at({ 'TV Series': 2001 }))).toBe(false)
    expect(chunks.find((c) => c.text.includes('Status'))!.req).toBeNull()
    expect(chunks.find((c) => c.text.includes('Name'))!.req).toBe('safe')
    expect(chunks.some((c) => c.text.includes('Quick answer'))).toBe(false)
  })
  it('stops an answer that names something you haven’t reached', () => {
    const names = forbiddenNames(['Negan (TV Series)', 'Glenn Rhee (Comic Universe)', 'Issue 7', 'Lucille'], ['Glenn Rhee (TV Series)'])
    expect(names).toEqual(['Negan', 'Lucille'])
    expect(mentionsHidden('Glenn is killed by Negan.', names)).toBe('Negan')
    expect(mentionsHidden('Glenn meets Maggie. Renegade!', names)).toBeNull()
  })
  it('reads saved settings safely', () => {
    expect(spoilerSettings({ limit: true, parts: 'show', progress: { 'TV Series': 2003, bad: 'x' }, updated: 5 })).toEqual({ limit: true, parts: 'show', progress: { 'TV Series': 2003 }, updated: 5 })
    expect(spoilerSettings(null)).toEqual(DEFAULT_SPOILERS)
  })
})
