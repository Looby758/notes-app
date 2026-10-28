import { afterEach, describe, expect, it } from 'vitest'
import { cleanThemePath, pageOfTab, pictureFor, readThemeManifest, themeFileUrl } from '@shared/themePack'
import { getTheme, setImportedThemes, type Theme } from '@shared/themes'
import { normalizePrefs } from '@shared/prefs'

const colors = {
  bg: '#14161A',
  bgPanel: '#1a1c20',
  bgRaised: '#202227',
  bgHover: '#272a30',
  bgCode: '#1b1d22',
  border: '#2a2d33',
  borderStrong: '#3a3e46',
  textStrong: '#f1efe9',
  text: '#d8d5cc',
  textMuted: '#8f8a7e',
  textFaint: '#5f5b52'
}

const files = new Set(['pictures/daryl.jpg', 'pictures/enid.jpg', 'icons/wings.png', 'icons/hat.png', 'fonts/head.woff2', 'notes.txt'])
const read = (raw: unknown) => readThemeManifest(raw, (p) => files.has(p))
const theme = (raw: unknown): Theme => {
  const result = read(raw)
  if ('error' in result) throw new Error(result.error)
  return result.theme
}

describe('readThemeManifest', () => {
  it('reads a full theme', () => {
    const t = theme({
      format: 1,
      id: 'Walking Dead',
      name: 'The Walking Dead',
      author: 'Looby',
      accent: '#C46A3B',
      colors,
      pictures: { home: { file: 'pictures/daryl.jpg', position: 'center top', accent: '#7D9A6A' }, all: 'pictures/enid.jpg' },
      pictureStrength: 0.4,
      loading: { text: 'JSS', picture: 'pictures/enid.jpg', font: 'fonts/head.woff2', color: '#E8E2D4' },
      starIcon: 'icons/wings.png',
      appIcon: 'icons/hat.png',
      fonts: { headings: 'fonts/head.woff2' }
    })
    expect(t.id).toBe('imported-walking-dead')
    expect(t.name).toBe('The Walking Dead')
    expect(t.accent).toBe('#c46a3b')
    expect(t.colors.bg).toBe('#14161a')
    expect(t.light).toBe(false)
    expect(t.pack?.pictures.home).toEqual({ file: 'pictures/daryl.jpg', position: 'center top', accent: '#7d9a6a' })
    expect(t.pack?.pictures.all).toEqual({ file: 'pictures/enid.jpg', position: 'center' })
    expect(t.pack?.pictureStrength).toBe(0.4)
    expect(t.pack?.loading).toEqual({ text: 'JSS', picture: 'pictures/enid.jpg', color: '#e8e2d4' })
    expect(t.pack?.starIcon).toBe('icons/wings.png')
    expect(t.pack?.appIcon).toBe('icons/hat.png')
    expect(t.pack?.fonts).toEqual({ headings: 'fonts/head.woff2', loading: 'fonts/head.woff2' })
    expect(t.pack?.files.sort()).toEqual(['fonts/head.woff2', 'icons/hat.png', 'icons/wings.png', 'pictures/daryl.jpg', 'pictures/enid.jpg'])
  })

  it('needs a name and every colour', () => {
    expect(read({ colors })).toEqual({ error: 'The theme has no name.' })
    expect(read({ name: 'X' })).toEqual({ error: 'The theme has no colours.' })
    const result = read({ name: 'X', colors: { ...colors, bg: 'red', text: undefined } })
    expect('error' in result && result.error).toMatch(/bg, text/)
    expect(read({ name: 'X', colors, format: 99 })).toEqual({ error: 'This theme needs a newer version of Notes.' })
    expect(read('nonsense')).toEqual({ error: 'theme.json isn’t a theme.' })
  })

  it('leaves out files that are missing, outside the theme or the wrong kind', () => {
    const t = theme({
      name: 'X',
      colors,
      pictures: { home: '../secret.jpg', money: 'pictures/missing.jpg', games: 'notes.txt', nowhere: 'pictures/daryl.jpg', calendar: '/etc/a.png' },
      starIcon: 'C:\\\\Windows\\\\a.png',
      fonts: { ui: 'pictures/daryl.jpg' }
    })
    expect(t.pack?.pictures).toEqual({})
    expect(t.pack?.starIcon).toBeUndefined()
    expect(t.pack?.fonts).toEqual({})
    expect(t.pack?.files).toEqual([])
  })

  it('keeps picture positions to plain CSS words and limits strength', () => {
    const t = theme({ name: 'X', colors, pictures: { home: { file: 'pictures/daryl.jpg', position: 'url(https://x) top' } }, pictureStrength: 5 })
    expect(t.pack?.pictures.home.position).toBe('center')
    expect(t.pack?.pictureStrength).toBe(0.6)
    expect(theme({ name: 'X', colors, pictures: { home: { file: 'pictures/daryl.jpg', position: '30% Top' } } }).pack?.pictures.home.position).toBe('30% top')
  })

  it('makes the id from the name when there is none', () => {
    expect(theme({ name: 'Season 9!', colors }).id).toBe('imported-season-9')
  })
})

describe('cleanThemePath', () => {
  it('allows plain paths inside the theme only', () => {
    expect(cleanThemePath('pictures/a b (1).jpg')).toBe('pictures/a b (1).jpg')
    expect(cleanThemePath('./a.png')).toBe('a.png')
    expect(cleanThemePath('pictures\\a.png')).toBe('pictures/a.png')
    for (const bad of ['../a.png', 'a/../../b.png', '/a.png', 'a//b.png', 'C:/a.png', '', 42, 'a?.png']) expect(cleanThemePath(bad)).toBeNull()
  })
})

describe('pictures for parts of the app', () => {
  it('names the part of the app a tab shows', () => {
    expect(pageOfTab('money:')).toBe('money')
    expect(pageOfTab('Notes/a.md')).toBe('notes')
    expect(pageOfTab('file:attachments/a.png')).toBe('files')
    expect(pageOfTab('blank:123')).toBe('home')
    expect(pageOfTab(null)).toBe('home')
  })

  it('falls back to the picture for everywhere', () => {
    const t = theme({ name: 'X', colors, pictures: { home: 'pictures/daryl.jpg', all: 'pictures/enid.jpg' } })
    expect(pictureFor(t.pack, 'home')?.file).toBe('pictures/daryl.jpg')
    expect(pictureFor(t.pack, 'money')?.file).toBe('pictures/enid.jpg')
    expect(pictureFor(undefined, 'money')).toBeUndefined()
  })

  it('serves files from the theme’s own address', () => {
    expect(themeFileUrl('imported-walking-dead', 'pictures/a b.jpg')).toBe('notestheme://walking-dead/pictures/a%20b.jpg')
  })
})

describe('imported themes in settings', () => {
  afterEach(() => setImportedThemes([]))

  it('can be chosen once imported, and fall back when gone', () => {
    const dark = theme({ name: 'Dark one', colors })
    const light = theme({ name: 'Light one', colors, light: true })
    expect(normalizePrefs({ theme: dark.id }).theme).toBe('midnight')
    setImportedThemes([dark, light])
    expect(normalizePrefs({ theme: dark.id, darkTheme: dark.id, lightTheme: light.id })).toMatchObject({ theme: dark.id, darkTheme: dark.id, lightTheme: light.id })
    expect(normalizePrefs({ darkTheme: light.id }).darkTheme).toBe('midnight')
    expect(getTheme(dark.id).name).toBe('Dark one')
    setImportedThemes([])
    expect(getTheme(dark.id).id).toBe('midnight')
  })
})
