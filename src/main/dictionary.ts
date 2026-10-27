import { ipcMain, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { gunzip } from 'zlib'
import { promisify } from 'util'
import { lookUp, readDictionary, type DictionaryData } from '@shared/dictionary'
import type { MenuWord } from '@shared/types'
import { logError } from './log'

/**
 * The dictionary on a note's right-click menu: the word's meaning (click for all of them) and
 * synonyms to swap in. The note tells us which word was right-clicked just before the menu opens.
 */

let loading: Promise<DictionaryData | null> | null = null
let unloadTimer: ReturnType<typeof setTimeout> | undefined

/** The built-in WordNet data: read when first needed (a fraction of a second), let go of after a while unused. */
function load(): Promise<DictionaryData | null> {
  loading ??= readFile(join(__dirname, 'dictionary.json.gz'))
    .then((gz) => promisify(gunzip)(gz))
    .then((json) => readDictionary(JSON.parse(json.toString('utf8'))))
    .catch((err) => {
      logError('dictionary', err)
      return null
    })
  clearTimeout(unloadTimer)
  unloadTimer = setTimeout(() => (loading = null), 10 * 60_000)
  return loading
}

let menuWord: MenuWord | null = null

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

/** The meaning and synonyms of the right-clicked word, for the top of the menu (nothing if it isn't a word we know). */
export async function dictionaryMenu(win: BrowserWindow): Promise<MenuItemConstructorOptions[]> {
  const target = menuWord
  menuWord = null
  if (!target) return []
  const data = await load()
  const entry = data && lookUp(data, target.word)
  if (!entry) return []
  const items: MenuItemConstructorOptions[] = [
    {
      label: clip(`${entry.lemma}: ${entry.senses[0].definition}`, 64),
      toolTip: 'See all its meanings',
      click: () => win.webContents.send('dictionary:show', entry)
    }
  ]
  if (target.editable && entry.synonyms.length) {
    items.push({
      label: 'Synonyms',
      submenu: entry.synonyms.map((s) => ({ label: s.replacement!, click: () => win.webContents.send('dictionary:replace', s.replacement) }))
    })
  }
  items.push({ type: 'separator' })
  return items
}

export function setupDictionary(): void {
  // Sent (and waited for) as the right-click happens, so it's here before the menu is built.
  ipcMain.on('dictionary:word', (event, word: MenuWord | null) => {
    menuWord = word && typeof word.word === 'string' ? { word: word.word.slice(0, 60), editable: !!word.editable } : null
    event.returnValue = null
  })
}
