import { describe, expect, it } from 'vitest'
import {
  chunkSections,
  citedNumbers,
  decodeEntities,
  findImages,
  htmlToSections,
  imageExtension,
  normaliseTitle,
  pageUrl,
  parseWikiAddress,
  picturesToGet,
  searchTerm,
  wikiAskPrompt,
  wikiLink
} from './wiki'

describe('parseWikiAddress', () => {
  it('reads a bare address and a page link', () => {
    expect(parseWikiAddress('walkingdead.fandom.com')).toMatchObject({ base: 'https://walkingdead.fandom.com', api: 'https://walkingdead.fandom.com/api.php', id: 'walkingdead', lang: '' })
    expect(parseWikiAddress('https://hypixel-skyblock.fandom.com/wiki/Hyperion')?.id).toBe('hypixel-skyblock')
  })
  it('keeps the language', () => {
    expect(parseWikiAddress('https://walkingdead.fandom.com/es/wiki/Rick_Grimes')).toMatchObject({ base: 'https://walkingdead.fandom.com/es', id: 'walkingdead-es' })
    expect(parseWikiAddress('https://minecraft.fandom.com/pt-br')?.lang).toBe('pt-br')
  })
  it('moves old Wikia addresses to Fandom', () => {
    expect(parseWikiAddress('http://walkingdead.wikia.com/wiki/Glenn')?.base).toBe('https://walkingdead.fandom.com')
  })
  it('turns down anything that isn’t a Fandom wiki', () => {
    expect(parseWikiAddress('https://en.wikipedia.org/wiki/Cat')).toBeNull()
    expect(parseWikiAddress('https://www.fandom.com/')).toBeNull()
    expect(parseWikiAddress('evilfandom.com')).toBeNull()
    expect(parseWikiAddress('')).toBeNull()
    expect(parseWikiAddress('javascript:alert(1)')).toBeNull()
  })
})

describe('titles and links', () => {
  const base = 'https://walkingdead.fandom.com'
  it('normalises titles', () => {
    expect(normaliseTitle('rick_Grimes ')).toBe('Rick Grimes')
  })
  it('makes page addresses', () => {
    expect(pageUrl(base, 'Rick Grimes (TV Series)')).toBe('https://walkingdead.fandom.com/wiki/Rick_Grimes_(TV_Series)')
  })
  it('sorts links into pages, headings and the web', () => {
    expect(wikiLink('/wiki/Rick_Grimes_(TV_Series)#Season_1', base)).toEqual({ kind: 'page', title: 'Rick Grimes (TV Series)', fragment: 'Season_1' })
    expect(wikiLink('https://walkingdead.fandom.com/wiki/Glenn%27s_Hat', base)).toEqual({ kind: 'page', title: "Glenn's Hat", fragment: '' })
    expect(wikiLink('#Death', base)).toEqual({ kind: 'anchor', fragment: 'Death' })
    expect(wikiLink('https://www.amc.com/', base)).toEqual({ kind: 'external', url: 'https://www.amc.com/' })
    expect(wikiLink('/wiki/File:Rick.png', base)).toBeNull()
    expect(wikiLink('/wiki/Category:Characters', base)).toBeNull()
    expect(wikiLink('/index.php?title=Nobody&action=edit&redlink=1', base)).toBeNull()
    expect(wikiLink('javascript:alert(1)', base)).toBeNull()
  })
  it('keeps a language wiki’s links to itself', () => {
    const es = 'https://walkingdead.fandom.com/es'
    expect(wikiLink('/es/wiki/Glenn', es)).toEqual({ kind: 'page', title: 'Glenn', fragment: '' })
    expect(wikiLink('/wiki/Glenn', es)?.kind).toBe('external')
  })
})

describe('page text', () => {
  const html = `<div class="mw-parser-output">
<aside class="portable-infobox"><h2 class="pi-item pi-title">Glenn Rhee</h2>
<figure class="pi-image"><a href="x"><img src="data:image/gif;base64,R0lG" data-src="https://static.wikia.nocookie.net/walkingdead/images/a/ab/Glenn.png/revision/latest/scale-to-width-down/270?cb=1" width="270" height="400"></a></figure>
<section><h2 class="pi-header">Status</h2>
<div class="pi-item pi-data"><h3 class="pi-data-label pi-secondary-font">Status</h3><div class="pi-data-value">Deceased</div></div></section></aside>
<p><b>Glenn Rhee</b> is a main character&nbsp;&amp; survivor.<sup class="reference" id="cite_ref-1"><a href="#cite_note-1">[1]</a></sup></p>
<img src="https://static.wikia.nocookie.net/walkingdead/images/f/flag.png" width="20">
<h2><span class="mw-headline" id="Season_1">Season 1</span></h2>
<p>He saves Rick in Atlanta.</p>
<script>alert(1)</script>
<h2><span class="mw-headline" id="References">References</span></h2>
<ol class="references"><li>Episode 1</li></ol>
<p>Leftover</p>
</div>`
  it('splits into sections, with info box fields and without references', () => {
    const s = htmlToSections(html)
    expect(s.map((x) => x.heading)).toEqual(['', 'Season 1'])
    expect(s[0].text).toContain('Status: Deceased')
    expect(s[0].text).toContain('Glenn Rhee is a main character & survivor.')
    expect(s[0].text).not.toContain('[1]')
    expect(s[1].text).toBe('He saves Rick in Atlanta.')
    expect(JSON.stringify(s)).not.toContain('alert')
  })
  it('finds the main picture and skips icons', () => {
    const f = findImages(html)
    expect(f.main).toBe('https://static.wikia.nocookie.net/walkingdead/images/a/ab/Glenn.png/revision/latest/scale-to-width-down/270?cb=1')
    expect(f.all).toHaveLength(1)
    expect(imageExtension(f.main!)).toBe('png')
  })
  it('picks pictures by your choice', () => {
    const found = { all: ['a', 'b'], main: 'a' }
    expect(picturesToGet(found, [], { main: true, categories: [] })).toEqual(['a'])
    expect(picturesToGet(found, [], { main: false, categories: [] })).toEqual([])
    expect(picturesToGet(found, ['Main_characters'], { main: false, categories: ['Main characters'] })).toEqual(['a', 'b'])
  })
  it('decodes entities', () => {
    expect(decodeEntities('&lt;b&gt; &#39;hi&#x27; &rsquo; &bogus;')).toBe("<b> 'hi' ’ &bogus;")
  })
  it('cuts long sections into chunks', () => {
    const text = Array.from({ length: 30 }, (_, i) => `Line ${i} `.repeat(10)).join('\n')
    const chunks = chunkSections([{ heading: 'A', text }], 300)
    expect(chunks.length).toBeGreaterThan(5)
    expect(chunks.every((c) => c.text.length <= 300 && c.section === 'A')).toBe(true)
    expect(chunks.map((c) => c.n)).toEqual(chunks.map((_, i) => i))
  })
})

describe('the wiki brain', () => {
  it('drops words not worth searching', () => {
    expect(searchTerm('When')).toBeNull()
    expect(searchTerm("Glenn's")).toBe('glenn')
  })
  it('numbers the extracts', () => {
    const p = wikiAskPrompt('Who is Glenn?', [{ wikiName: 'TWD Wiki', title: 'Glenn Rhee', section: '', text: 'A survivor.' }])
    expect(p).toContain('[1] Glenn Rhee (TWD Wiki)\nA survivor.')
    expect(p).toContain('Question: Who is Glenn?')
  })
  it('reads which extracts an answer used', () => {
    expect(citedNumbers('He dies [2]. He was a delivery boy [1, 2] [9].', 3)).toEqual([2, 1])
    expect(citedNumbers('No idea.', 3)).toEqual([])
  })
})
