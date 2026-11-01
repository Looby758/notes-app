import { describe, expect, it } from 'vitest'
import { compareVersions, notesSince, RELEASE_NOTES } from './whatsNew'
import pkg from '../../package.json'

const notes = [
  { version: '1.11.0', items: ['c'] },
  { version: '1.10.1', items: ['b'] },
  { version: '1.10.0', items: ['a'] }
]

describe("what's new", () => {
  it('compares version numbers as numbers', () => {
    expect(compareVersions('1.10.0', '1.9.3')).toBe(1)
    expect(compareVersions('1.10.0', '1.10')).toBe(0)
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1)
  })

  it('shows every release since the one this computer last saw', () => {
    expect(notesSince('1.10.0', '1.11.0', notes).map((n) => n.version)).toEqual(['1.11.0', '1.10.1'])
  })

  it('shows nothing when nothing changed or the app went back', () => {
    expect(notesSince('1.11.0', '1.11.0', notes)).toEqual([])
    expect(notesSince('1.11.0', '1.10.1', notes)).toEqual([])
  })

  it('still says it updated when a version has no notes', () => {
    expect(notesSince('1.11.0', '1.11.1', notes)).toEqual([{ version: '1.11.1', items: [] }])
  })

  it('keeps the notes newest first', () => {
    for (let i = 1; i < RELEASE_NOTES.length; i++) expect(compareVersions(RELEASE_NOTES[i - 1].version, RELEASE_NOTES[i].version)).toBe(1)
  })

  it('has notes for the current version or a newer one', () => {
    expect(compareVersions(RELEASE_NOTES[0].version, pkg.version)).toBeGreaterThanOrEqual(0)
  })
})
