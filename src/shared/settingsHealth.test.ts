import { describe, expect, it } from 'vitest'
import { brokenCopyName, checkSettingsText, lockedValues, SETTINGS_FILES } from './settingsHealth'

const calendars = SETTINGS_FILES.find((f) => f.file === 'calendars.json')!
const live = SETTINGS_FILES.find((f) => f.file === 'live.json')!

describe('settings files', () => {
  it('finds locked values however deep they are', () => {
    const json = { clientId: 'x', clientSecret: 'A', refreshToken: 'B', feeds: [{ id: '1', name: 'n', url: 'C' }] }
    expect(lockedValues(json, calendars.secrets!)).toEqual(['A', 'B', 'C'])
    expect(lockedValues({ keys: { twitch: 'T', youtube: 'Y' }, customUrl: 'rtmp://x' }, live.secrets!)).toEqual(['T', 'Y'])
  })

  it('is fine with good or empty files', () => {
    expect(checkSettingsText(calendars, '{"clientId":"x","refreshToken":"ok"}', () => undefined)).toBeNull()
    expect(checkSettingsText(calendars, '', () => undefined)).toBeNull()
  })

  it('spots a damaged file', () => {
    const r = checkSettingsText(calendars, '{"clientId": "x", ', () => undefined)
    expect(r?.problem).toBe('unreadable')
    expect(r?.label).toBe('calendar settings')
  })

  it('spots sign-ins locked by an older copy of the app', () => {
    const r = checkSettingsText(calendars, '{"refreshToken":"old"}', () => {
      throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.')
    })
    expect(r?.problem).toBe('locked')
    expect(r?.detail).toMatch(/older copy/)
  })

  it("can't check locks without the computer's protection", () => {
    expect(checkSettingsText(calendars, '{"refreshToken":"old"}')).toBeNull()
  })

  it('keeps the old file under a dated name', () => {
    expect(brokenCopyName('calendars.json', new Date(2026, 10, 1, 16, 43, 5))).toBe('calendars.broken-2026-11-01-164305.json')
  })
})
