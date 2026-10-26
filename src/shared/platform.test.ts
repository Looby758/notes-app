import { describe, expect, it, vi } from 'vitest'

/** Loads a fresh copy of a module as if running on `platform`. */
async function on<T>(platform: string, load: () => Promise<T>): Promise<T> {
  vi.resetModules()
  const original = process.platform
  Object.defineProperty(process, 'platform', { value: platform })
  try {
    return await load()
  } finally {
    Object.defineProperty(process, 'platform', { value: original })
  }
}

describe('on Windows', () => {
  it('shows shortcuts as written', async () => {
    const p = await on('win32', () => import('./platform'))
    expect(p.showKeys('Ctrl+Shift+K')).toBe('Ctrl+Shift+K')
    expect(p.acceleratorLabel('Super+Shift+N')).toBe('Win+Shift+N')
    expect(p.acceleratorLabel('Control+Alt+Space')).toBe('Ctrl+Alt+Space')
    expect(p.FILE_MANAGER).toBe('File Explorer')
  })
  it('keeps Win+Shift+N for quick capture', async () => {
    const { DEFAULT_PREFS, normalizePrefs } = await on('win32', () => import('./prefs'))
    expect(DEFAULT_PREFS.captureShortcut).toBe('Super+Shift+N')
    expect(normalizePrefs({ captureShortcut: 'Alt+Shift+N' }).captureShortcut).toBe('Alt+Shift+N')
  })
})

describe('on a Mac', () => {
  it('shows shortcuts with Mac symbols, Ctrl as ⌘', async () => {
    const p = await on('darwin', () => import('./platform'))
    expect(p.IS_MAC).toBe(true)
    expect(p.showKeys('Ctrl+Shift+K')).toBe('⇧⌘K')
    expect(p.showKeys('Ctrl+Alt+Left')).toBe('⌥⌘←')
    expect(p.showKeys('Ctrl+,')).toBe('⌘,')
    // ⌘Tab is the app switcher, so tab cycling stays on the real Control key.
    expect(p.showKeys('Ctrl+Shift+Tab')).toBe('⌃⇧⇥')
    expect(p.CLICK_MOD).toBe('⌘-click')
  })
  it('labels system-wide shortcuts, where Control is the real Control key', async () => {
    const p = await on('darwin', () => import('./platform'))
    expect(p.acceleratorLabel('Control+Alt+Space')).toBe('⌃⌥Space')
    expect(p.acceleratorLabel('Super+Alt+N')).toBe('⌥⌘N')
  })
  it('uses a quick capture shortcut that does not clash with ⌘⇧N', async () => {
    const { DEFAULT_PREFS, normalizePrefs } = await on('darwin', () => import('./prefs'))
    expect(DEFAULT_PREFS.captureShortcut).toBe('Control+Alt+Space')
    expect(normalizePrefs({ captureShortcut: 'Super+Shift+N' }).captureShortcut).toBe('Control+Alt+Space')
  })
})
