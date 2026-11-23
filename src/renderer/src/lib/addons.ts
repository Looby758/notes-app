import { addonById, addonOfFeature, hasFeature } from '@shared/addons'
import { usePrefs } from '../store/prefs'

/**
 * The add-ons you've added (shared/addons.ts), for the window: features from add-ons you haven't
 * added are left out of menus, shortcuts, Home and Settings, and their pages don't open.
 */

/** Whether a feature (lib/featureInfo.ts id) is here: core, or its add-on is added. */
export const featureOn = (featureId: string): boolean => hasFeature(featureId, usePrefs.getState().prefs.installedAddons)

/** The same, as a hook, so the page redraws when add-ons are added or removed. */
export const useFeatureOn = (featureId: string): boolean => usePrefs((s) => hasFeature(featureId, s.prefs.installedAddons))

/** Whether an add-on is added. */
export const addonOn = (id: string): boolean => usePrefs.getState().prefs.installedAddons.includes(id)

export const useAddonOn = (id: string): boolean => usePrefs((s) => s.prefs.installedAddons.includes(id))

/** The added add-ons, as a hook. */
export const useInstalledAddons = (): string[] => usePrefs((s) => s.prefs.installedAddons)

/** "Music isn't added…" for a feature that isn't here. */
export function notAddedText(featureId: string): string {
  const addon = addonOfFeature(featureId)
  return `${(addon && addonById(addon)?.name) || 'That'} isn’t added. Add it in Settings → Add-ons.`
}

/**
 * Which add-on each command belongs to, by the start of its id (lib/commands.ts). Commands not
 * listed are core. Some ids are listed whole where one group mixes core and add-on commands.
 */
const COMMAND_FEATURES: Record<string, string> = {
  music: 'musiclibrary',
  studio: 'studio',
  takes: 'studio',
  teleprompter: 'studio',
  discord: 'discord-voice',
  snip: 'snip',
  screens: 'screens',
  messages: 'messages',
  macros: 'macros',
  explorer: 'explorer',
  videos: 'videos',
  timeline: 'timeline',
  terminal: 'terminal',
  soundboard: 'soundboard',
  replay: 'replay',
  phone: 'phone',
  grok: 'grok',
  claude: 'claude',
  calendar: 'calendar',
  appstudio: 'appstudio',
  wiki: 'wiki',
  video: 'video',
  tasks: 'tasks',
  uninstall: 'uninstall',
  skyblockGoals: 'skyblock-goals',
  screenshots: 'screenshots',
  publishing: 'publishing',
  pdf: 'pdf-editor',
  passwords: 'passwords',
  money: 'money',
  mixer: 'mixer',
  minigames: 'mini-games',
  sudoku: 'mini-games',
  minesweeper: 'mini-games',
  nonogram: 'mini-games',
  jigsaw: 'mini-games',
  wordle: 'mini-games',
  wordsearch: 'mini-games',
  hangman: 'mini-games',
  solitaire: 'mini-games',
  blackjack: 'mini-games',
  chess: 'mini-games',
  breakout: 'mini-games',
  keyremap: 'keyremap',
  graph: 'graph',
  games: 'games',
  flashcards: 'flashcards',
  filesender: 'filesender',
  email: 'email',
  downloads: 'downloads',
  countdowns: 'countdowns',
  convert: 'convert',
  comics: 'comics',
  clocks: 'clocks',
  clips: 'clips',
  capture: 'capture',
  'ai.chat': 'chat',
  'ai.ask': 'ask',
  'view.zen': 'zen',
  'view.streamer': 'streamer',
  'note.random': 'random',
  web: 'web'
}

/** Add-ons with no feature button of their own, so commands name the add-on directly. */
const COMMAND_ADDONS: Record<string, string> = {
  'board.new': 'canvas-board'
}

/** The feature a command belongs to, or null for a core command. */
export function commandFeature(commandId: string): string | null {
  if (COMMAND_FEATURES[commandId]) return COMMAND_FEATURES[commandId]
  const group = commandId.split('.')[0]
  return COMMAND_FEATURES[group] ?? null
}

/** Whether a command's add-on is here (core commands always are). */
export function commandOn(commandId: string, installed: readonly string[] = usePrefs.getState().prefs.installedAddons): boolean {
  const addon = COMMAND_ADDONS[commandId]
  if (addon) return installed.includes(addon)
  const feature = commandFeature(commandId)
  return !feature || hasFeature(feature, installed)
}

/** The feature each kind of tab belongs to, by how its id starts (lib/editorController.ts). Tabs not listed are core. */
const TAB_FEATURES: [prefix: string, feature: string][] = [
  ['calendar:', 'calendar'],
  ['graph:', 'graph'],
  ['chat:', 'chat'],
  ['flashcards:', 'flashcards'],
  ['screenshots:', 'screenshots'],
  ['timeline:', 'timeline'],
  ['terminal:', 'terminal'],
  ['passwords:', 'passwords'],
  ['email:', 'email'],
  ['money:', 'money'],
  ['convert:', 'convert'],
  ['filesender:', 'filesender'],
  ['comics:', 'comics'],
  ['pdf-editor:', 'pdf-editor'],
  ['wiki:', 'wiki'],
  ['minigames:', 'mini-games'],
  ['clocks:', 'clocks'],
  ['countdowns:', 'countdowns'],
  ['publishing:', 'publishing'],
  ['screens:', 'screens'],
  ['music:', 'musiclibrary'],
  ['mixer:', 'mixer'],
  ['tasks:', 'tasks'],
  ['uninstall:', 'uninstall'],
  ['downloads:', 'downloads'],
  ['studio:', 'studio'],
  ['appstudio:', 'appstudio'],
  ['clips:', 'clips'],
  ['videos:', 'videos'],
  ['soundboard:', 'soundboard'],
  ['macros:', 'macros'],
  ['keyremap:', 'keyremap'],
  ['discord-voice:', 'discord-voice'],
  ['messages:', 'messages'],
  ['grok:', 'grok'],
  ['claude:', 'claude'],
  ['games:', 'games'],
  ['skyblock-goals:', 'skyblock-goals'],
  ['video:', 'video'],
  ['explorer:', 'explorer'],
  ['web:', 'web']
]

/** The feature a tab belongs to, or null for a core tab (notes, Home, Settings…). */
export function tabFeature(tabId: string | null): string | null {
  if (!tabId) return null
  return TAB_FEATURES.find(([prefix]) => tabId.startsWith(prefix))?.[1] ?? null
}

/** Whether a tab can show: core, or its add-on is added. */
export function tabOn(tabId: string | null, installed: readonly string[] = usePrefs.getState().prefs.installedAddons): boolean {
  const feature = tabFeature(tabId)
  return !feature || hasFeature(feature, installed)
}

/** The add-on each Home box comes with (lib/home.ts and the Home page). Boxes not listed are core. */
const HOME_BOX_ADDONS: Record<string, string> = {
  weather: 'weather',
  flashcards: 'flashcards',
  music: 'music',
  mixer: 'mixer',
  money: 'money',
  budget: 'money',
  'discord-voice': 'discord-voice',
  countdowns: 'countdowns',
  'skyblock-goals': 'skyblock',
  'skyblock-calendar': 'skyblock',
  screens: 'screens',
  email: 'email',
  clocks: 'clocks'
}

/** Whether a Home box shows: core, or its add-on is added. */
export function homeBoxOn(id: string, installed: readonly string[] = usePrefs.getState().prefs.installedAddons): boolean {
  const addon = HOME_BOX_ADDONS[id]
  return !addon || installed.includes(addon)
}
