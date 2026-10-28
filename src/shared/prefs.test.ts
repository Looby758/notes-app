import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS, normalizePrefs } from './prefs'

describe('motion setting', () => {
  it('defaults to full', () => {
    expect(normalizePrefs({}).motion).toBe('full')
    expect(DEFAULT_PREFS.motion).toBe('full')
  })
  it('keeps a valid level and drops anything else', () => {
    expect(normalizePrefs({ motion: 'subtle' }).motion).toBe('subtle')
    expect(normalizePrefs({ motion: 'off' }).motion).toBe('off')
    expect(normalizePrefs({ motion: 'wobbly' }).motion).toBe('full')
  })
  it('turns the old "Reduce motion" switch into Off', () => {
    expect(normalizePrefs({ reduceMotion: true }).motion).toBe('off')
    expect(normalizePrefs({ reduceMotion: false }).motion).toBe('full')
    // Once there is a Motion level, the old switch no longer counts.
    expect(normalizePrefs({ reduceMotion: true, motion: 'subtle' }).motion).toBe('subtle')
  })
})
