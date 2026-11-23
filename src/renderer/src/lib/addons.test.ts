import { describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ installed: [] as string[] }))
vi.mock('../store/prefs', () => ({
  usePrefs: Object.assign(() => undefined, { getState: () => ({ prefs: { installedAddons: env.installed } }) })
}))

const { commandFeature, commandOn, homeBoxOn, tabFeature, tabOn } = await import('./addons')
const { FEATURE_INFO } = await import('./featureInfo')
const { ADDON_IDS, withNeeds } = await import('@shared/addons')

const FEATURES = new Set(FEATURE_INFO.map((f) => f.id))

describe('commands', () => {
  it('belong to real features', () => {
    for (const id of ['music.play', 'macros.record', 'calendar.open', 'ai.chat', 'view.zen', 'web.open', 'note.random', 'chess.open', 'explorer.searchPc']) {
      expect(FEATURES.has(commandFeature(id)!), id).toBe(true)
    }
  })

  it('core commands always work', () => {
    for (const id of ['note.new', 'home.open', 'daily.prev', 'ai.summarise', 'view.reading', 'pane.split']) expect(commandOn(id, []), id).toBe(true)
  })

  it('add-on commands only when it’s added', () => {
    expect(commandOn('macros.record', [])).toBe(false)
    expect(commandOn('macros.record', ['macros'])).toBe(true)
    expect(commandOn('board.new', [])).toBe(false)
    expect(commandOn('board.new', ['canvas-board'])).toBe(true)
  })
})

describe('tabs', () => {
  it('belong to real features', () => {
    for (const id of ['calendar:', 'music:', 'skyblock-goals:', 'explorer:3', 'web:https://example.com', 'minigames:']) {
      expect(FEATURES.has(tabFeature(id)!), id).toBe(true)
    }
  })

  it('core tabs always open', () => {
    for (const id of ['home:', 'settings:', 'notes/today.md', null]) expect(tabOn(id, []), String(id)).toBe(true)
  })

  it('add-on tabs only when it’s added', () => {
    env.installed = []
    expect(tabOn('skyblock-goals:')).toBe(false)
    env.installed = withNeeds(['skyblock'])
    expect(tabOn('skyblock-goals:')).toBe(true)
  })
})

describe('Home boxes', () => {
  it('core boxes always show', () => {
    expect(homeBoxOn('today', [])).toBe(true)
    expect(homeBoxOn('recent', [])).toBe(true)
  })

  it('add-on boxes only when it’s added', () => {
    expect(homeBoxOn('skyblock-calendar', [])).toBe(false)
    expect(homeBoxOn('skyblock-calendar', ['skyblock'])).toBe(true)
    expect(homeBoxOn('weather', ADDON_IDS)).toBe(true)
  })
})
