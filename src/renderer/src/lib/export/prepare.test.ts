import { describe, expect, it } from 'vitest'
import { NoteLookup } from '../links'
import { imagesIn, notesUnder, parseNoteHref, prepareNote, rewriteMarkdown } from './prepare'

const notes: Record<string, string> = {
  'Plan.md': '---\nstatus: done\ntags: [a, b]\nempty:\n---\n# Plan\n\n## Goals\n\nShip it.\n\n## Later\n\nRest.\n',
  'Work/Spec.md': 'See [[Plan#Goals|the goals]] and [[Nope]].\n\n![[Plan#Goals]]\n\n![](../img/a.png) and [file](doc.pdf) and [plan](../Plan.md)\n\n`[[Plan]] in code`\n',
  'img/a.png': '',
  'Loop.md': '![[Loop]]\n'
}
const ctx = { lookup: new NoteLookup(Object.keys(notes)), textOf: (p: string) => notes[p] }

describe('rewriteMarkdown', () => {
  const out = rewriteMarkdown(notes['Work/Spec.md'], 'Work/Spec.md', ctx)
  it('turns wikilinks into note: links, and missing ones into text', () => {
    expect(out).toContain('[the goals](note:Plan.md#Goals)')
    expect(out).toContain('and Nope.')
  })
  it('fills in embeds as quotes', () => {
    expect(out).toContain('> **Plan › Goals**\n>\n> ## Goals\n>\n> Ship it.')
    expect(out).not.toContain('Rest.')
  })
  it('points images at the vault and keeps attachment names', () => {
    expect(out).toContain('![](vault:img/a.png)')
    expect(out).toContain('and file and [plan](note:Plan.md)')
  })
  it('leaves code alone', () => {
    expect(out).toContain('`[[Plan]] in code`')
  })
  it('stops embedding a note in itself', () => {
    expect(rewriteMarkdown(notes['Loop.md'], 'Loop.md', ctx)).toContain('[Loop](note:Loop.md)')
  })
})

describe('prepareNote', () => {
  it('pulls out non-empty properties', () => {
    const item = prepareNote('Plan.md', ctx, true)
    expect(item.properties).toEqual([
      ['status', 'done'],
      ['tags', 'a, b']
    ])
    expect(item.markdown.startsWith('# Plan')).toBe(true)
    expect(prepareNote('Plan.md', ctx, false).properties).toEqual([])
  })
})

describe('helpers', () => {
  it('lists notes in a folder, top level first', () => {
    const all = ['B.md', 'A/Z.md', 'A/B/C.md', 'A/A.md']
    expect(notesUnder(all, 'A', true, true)).toEqual(['A/A.md', 'A/Z.md', 'A/B/C.md'])
    expect(notesUnder(all, 'A', true, false)).toEqual(['A/A.md', 'A/Z.md'])
    expect(notesUnder(all, '', true, true)).toEqual(['B.md', 'A/A.md', 'A/Z.md', 'A/B/C.md'])
  })
  it('finds images and reads note: links', () => {
    const item = prepareNote('Work/Spec.md', ctx, true)
    expect(imagesIn([item])).toEqual(['img/a.png'])
    expect(parseNoteHref('note:Work%2FSpec.md#My%20Heading')).toEqual({ path: 'Work/Spec.md', heading: 'My Heading' })
  })
})
