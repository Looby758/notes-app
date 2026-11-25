import { describe, expect, it } from 'vitest'
import { FEATURE_INFO } from '@renderer/lib/featureInfo'
import {
  ADDONS,
  ADDON_IDS,
  CORE_FEATURES,
  addAddon,
  addonOfFeature,
  cleanInstalledAddons,
  hasFeature,
  neededBy,
  removeAddon,
  withNeeds
} from './addons'
import { normalizePrefs } from './prefs'
import { cleanPrefsPart, DEVICE_PREFS, prefsPart } from './orbitSync'

describe('add-on list', () => {
  it('puts every feature in the core or in exactly one add-on', () => {
    for (const f of FEATURE_INFO) {
      const inCore = (CORE_FEATURES as readonly string[]).includes(f.id)
      const homes = ADDONS.filter((a) => a.features.includes(f.id))
      expect(inCore || homes.length === 1, f.id).toBe(true)
      expect(inCore && homes.length > 0, f.id).toBe(false)
    }
  })

  it('only names features and add-ons that exist', () => {
    const features = new Set(FEATURE_INFO.map((f) => f.id))
    for (const a of ADDONS) {
      for (const f of a.features) expect(features.has(f), `${a.id}: ${f}`).toBe(true)
      for (const n of a.needs ?? []) expect(ADDON_IDS.includes(n), `${a.id} needs ${n}`).toBe(true)
    }
    expect(new Set(ADDON_IDS).size).toBe(ADDON_IDS.length)
  })

  it('keeps Looby’s core picks as core', () => {
    for (const id of ['home', 'today', 'new-note', 'search', 'reading', 'settings']) {
      expect(addonOfFeature(id)).toBeNull()
      expect(hasFeature(id, [])).toBe(true)
    }
    expect(addonOfFeature('calendar')).toBe('calendar')
    expect(addonOfFeature('explorer')).toBe('files')
    expect(addonOfFeature('skyblock-goals')).toBe('skyblock')
  })
})

describe('adding and removing', () => {
  it('adds what an add-on needs', () => {
    expect(addAddon([], 'music')).toEqual(['video-tools', 'link-tools', 'music'])
    expect(hasFeature('musiclibrary', addAddon([], 'music'))).toBe(true)
    expect(hasFeature('skyblock-goals', addAddon([], 'music'))).toBe(false)
  })

  it('removes the add-ons that need it, and shared tools nothing needs', () => {
    const installed = withNeeds(['music', 'downloads', 'studio'])
    expect(neededBy('link-tools', installed)).toEqual(['music', 'downloads'])
    expect(removeAddon(installed, 'music')).toEqual(['video-tools', 'link-tools', 'downloads', 'studio'])
    expect(removeAddon(removeAddon(installed, 'music'), 'downloads')).toEqual(['video-tools', 'studio'])
    expect(removeAddon(['video-tools', 'studio'], 'studio')).toEqual([])
  })

  it('removing Macros takes it off the list completely', () => {
    expect(hasFeature('macros', removeAddon([...ADDON_IDS], 'macros'))).toBe(false)
  })
})

describe('saved settings', () => {
  it('gives Orbit from before add-ons every add-on', () => {
    expect(cleanInstalledAddons(undefined)).toEqual(ADDON_IDS)
    expect(normalizePrefs({}).installedAddons).toEqual(ADDON_IDS)
  })

  it('drops unknown ids and fills in what’s needed', () => {
    expect(cleanInstalledAddons(['nope', 'clips', 'clips', 3])).toEqual(['video-tools', 'clips'])
    expect(normalizePrefs({ installedAddons: [] }).installedAddons).toEqual([])
  })

  it('adds add-ons that came in an update after the list was saved', () => {
    const seen = ADDON_IDS.filter((id) => id !== 'skyblock')
    expect(cleanInstalledAddons([], seen)).toEqual(['skyblock'])
    expect(normalizePrefs({ installedAddons: ['music'], addonsSeen: seen }).installedAddons).toEqual(['video-tools', 'link-tools', 'music', 'skyblock'])
    expect(normalizePrefs({ installedAddons: ['music'], addonsSeen: ADDON_IDS }).installedAddons).toEqual(['video-tools', 'link-tools', 'music'])
  })

  it('saves the added add-ons in the notes folder with the rest of Settings', () => {
    expect(DEVICE_PREFS).not.toContain('installedAddons')
    const prefs = normalizePrefs({ installedAddons: ['skyblock'] })
    expect(prefsPart(prefs, 'settings').installedAddons).toEqual(['skyblock'])
    expect(cleanPrefsPart({ installedAddons: ['macros'] }, 'settings').installedAddons).toEqual(['macros'])
  })

  it('a notes folder saved before add-ons leaves every add-on added', () => {
    const fromFolder = cleanPrefsPart({ theme: 'dark' }, 'settings')
    expect(normalizePrefs(fromFolder).installedAddons).toEqual(ADDON_IDS)
  })
})

describe('the store’s details', async () => {
  const { ADDON_ABOUT, ADDON_CATEGORIES } = await import('./addonDetails')
  const shown = ADDONS.filter((a) => !a.helper).map((a) => a.id)
  it('has a description for every add-on it shows', () => {
    for (const id of shown) expect(ADDON_ABOUT[id], id).toBeTruthy()
    for (const id of Object.keys(ADDON_ABOUT)) expect(shown, id).toContain(id)
  })
  it('puts every add-on it shows in exactly one category', () => {
    const listed = ADDON_CATEGORIES.flatMap((c) => c.addons)
    expect([...listed].sort()).toEqual([...shown].sort())
  })
})
