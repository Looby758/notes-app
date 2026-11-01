import { describe, expect, it } from 'vitest'
import { cleanPrefsPart, cleanSyncPath, decideSync, prefsPart, readManifest, stableJson } from './orbitSync'
import { normalizePrefs } from './prefs'

const H = (c: string): string => c.repeat(64)

describe('which way to sync a part', () => {
  it('puts it in the notes folder when nothing is there yet', () => {
    expect(decideSync(H('a'), undefined, undefined)).toBe('push')
    expect(decideSync(null, undefined, undefined)).toBe('same')
  })

  it('sends changes made here, takes in changes made there', () => {
    const agreed = { local: H('a'), remote: H('a') }
    expect(decideSync(H('b'), H('a'), agreed)).toBe('push')
    expect(decideSync(H('a'), H('c'), agreed)).toBe('pull')
    expect(decideSync(H('a'), H('a'), agreed)).toBe('same')
  })

  it('asks when both computers changed it differently', () => {
    expect(decideSync(H('b'), H('c'), { local: H('a'), remote: H('a') })).toBe('ask')
    // Both made the same change: nothing to ask.
    expect(decideSync(H('b'), H('b'), { local: H('a'), remote: H('a') })).toBe('same')
  })

  it('on a new computer, takes the other one’s if there’s nothing here, else asks', () => {
    expect(decideSync(null, H('c'), undefined)).toBe('pull')
    expect(decideSync(H('b'), null, undefined)).toBe('push')
    expect(decideSync(H('b'), H('c'), undefined)).toBe('ask')
  })

  it('doesn’t go back and forth when two versions of Orbit tidy settings a little differently', () => {
    // Pulled remote "c", which became "d" here: agreed is { d, c }, so nothing changed on either side.
    expect(decideSync(H('d'), H('c'), { local: H('d'), remote: H('c') })).toBe('same')
  })

  it('passes on a deletion', () => {
    expect(decideSync(null, H('a'), { local: H('a'), remote: H('a') })).toBe('push')
    expect(decideSync(H('a'), null, { local: H('a'), remote: H('a') })).toBe('pull')
  })
})

describe('settings and Home layout', () => {
  const prefs = normalizePrefs({ zoom: 1.2, launchAtStartup: false, homeOrder: ['money'], editorFontSize: 18 })

  it('splits the Home layout from the rest, and keeps this computer’s own settings out', () => {
    const settings = prefsPart(prefs, 'settings')
    const home = prefsPart(prefs, 'home')
    expect(settings.editorFontSize).toBe(18)
    expect(settings).not.toHaveProperty('zoom')
    expect(settings).not.toHaveProperty('launchAtStartup')
    expect(settings).not.toHaveProperty('homeOrder')
    expect(home.homeOrder).toEqual(['money'])
    expect(home).not.toHaveProperty('editorFontSize')
  })

  it('never lets a synced file change this computer’s own settings', () => {
    expect(cleanPrefsPart({ zoom: 3, syncOrbit: false, editorFontSize: 20 }, 'settings')).toEqual({ editorFontSize: 20 })
    expect(cleanPrefsPart({ homeHidden: ['x'], editorFontSize: 20 }, 'home')).toEqual({ homeHidden: ['x'] })
  })
})

describe('the files in the notes folder', () => {
  it('gives the same text for the same value, whatever the key order', () => {
    expect(stableJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(stableJson({ a: [{ c: 3, d: 2 }], b: 1 }))
  })

  it('reads a part’s file, and refuses broken or unsafe ones', () => {
    const ok = { version: 1, hash: H('a'), device: 'MacBook', updated: 5, files: { 'walking-dead/theme.json': H('b') } }
    expect(readManifest(ok)?.files).toEqual({ 'walking-dead/theme.json': H('b') })
    expect(readManifest({ ...ok, hash: 'nope' })).toBeNull()
    expect(readManifest({ ...ok, files: { '../evil': H('b') } })).toBeNull()
    expect(readManifest('{')).toBeNull()
  })

  it('only allows plain paths inside the folder', () => {
    expect(cleanSyncPath('clips/abc.mp3')).toBe('clips/abc.mp3')
    expect(cleanSyncPath('../x')).toBeNull()
    expect(cleanSyncPath('a//b')).toBeNull()
    expect(cleanSyncPath('C:/x')).toBeNull()
    expect(cleanSyncPath('.hidden')).toBeNull()
  })
})
