import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS, normalizePrefs } from '@shared/prefs'

describe('normalizePrefs', () => {
  it('fills in defaults for missing or garbage input', () => {
    expect(normalizePrefs(undefined)).toEqual(DEFAULT_PREFS)
    expect(normalizePrefs('nonsense')).toEqual(DEFAULT_PREFS)
  })

  it('keeps valid values', () => {
    const p = normalizePrefs({ theme: 'nord', accent: '#FF8800', editorFontSize: 20, noteWidth: 'wide', vimMode: true })
    expect(p.theme).toBe('nord')
    expect(p.accent).toBe('#ff8800')
    expect(p.editorFontSize).toBe(20)
    expect(p.noteWidth).toBe('wide')
    expect(p.vimMode).toBe(true)
  })

  it('clamps numbers and rejects wrong types or unknown choices', () => {
    const p = normalizePrefs({ editorFontSize: 400, zoom: 0.1, noteWidth: 'giant', vimMode: 'yes', theme: 'pink', accent: 'red' })
    expect(p.editorFontSize).toBe(28)
    expect(p.zoom).toBe(0.8)
    expect(p.noteWidth).toBe('medium')
    expect(p.vimMode).toBe(false)
    expect(p.theme).toBe('midnight')
    expect(p.accent).toBe('')
  })

  it('keeps the Home page layout as a clean list of box ids', () => {
    const p = normalizePrefs({ homeOrder: ['recent', 'today', 'recent', 42, 'Bad Id!'], homeHidden: 'weather' })
    expect(p.homeOrder).toEqual(['recent', 'today'])
    expect(p.homeHidden).toEqual([])
  })

  it('strips characters that could break CSS from font names', () => {
    expect(normalizePrefs({ editorFont: 'Fira Code"; } body { display: none' }).editorFont).toBe('Fira Code  body  display none')
  })

  it('cleans folder settings and refuses ones that leave the vault', () => {
    expect(normalizePrefs({ attachmentFolder: '\\Media\\Images\\' }).attachmentFolder).toBe('Media/Images')
    expect(normalizePrefs({ attachmentFolder: '../outside' }).attachmentFolder).toBe('attachments')
    expect(normalizePrefs({ templatesFolder: 'Bad:Name' }).templatesFolder).toBe('Templates')
    expect(normalizePrefs({ attachmentFolder: '' }).attachmentFolder).toBe('')
  })

  it('keeps shortcut overrides, including removed ones', () => {
    expect(normalizePrefs({ shortcuts: { 'tab.new': 'Ctrl+Alt+T', 'save': null, bad: 42 } }).shortcuts).toEqual({
      'tab.new': 'Ctrl+Alt+T',
      save: null
    })
  })
})
