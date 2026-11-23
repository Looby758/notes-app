import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { ADDON_IDS, addonById } from '@shared/addons'

/**
 * Keeps add-ons you haven't added from doing anything (shared/addons.ts).
 *
 * Every message the window sends to an add-on's part of Orbit (like "macros:play") is checked here
 * first, and turned away if that add-on isn't added. So even if something still tried to use it,
 * a missing add-on can't run. Each add-on's background work (timers, keyboard hooks) checks
 * `addonOn` as well, and `onAddonsChanged` lets it stop straight away when it's removed.
 */

let installed: () => readonly string[] = () => ADDON_IDS
const listeners = new Set<(installed: readonly string[]) => void>()

/** Which add-on each group of messages belongs to, by the part before the colon. Anything not listed is core. */
const CHANNEL_ADDONS: Record<string, string> = {
  skyblock: 'skyblock',
  skyblockAddon: 'skyblock',
  skyblockGoals: 'skyblock',
  skyblockPlayers: 'skyblock',
  skyblockProfile: 'skyblock',
  skyblockHelpers: 'skyblock',
  macros: 'macros',
  keyremap: 'keyremap',
  discord: 'discord-voice',
  fsend: 'filesender',
  comics: 'comics',
  wiki: 'wiki',
  games: 'games',
  cal: 'calendar',
  soundboard: 'soundboard',
  soundLink: 'soundboard',
  music: 'music',
  localMusic: 'music',
  musicMini: 'music',
  musicTags: 'music',
  musicRemote: 'music',
  musicLink: 'music',
  musicData: 'music',
  songSearch: 'music',
  songId: 'songid',
  dm: 'downloads',
  vdl: 'link-tools',
  clips: 'clips',
  replay: 'clips',
  screen: 'second-screen',
  cam: 'phone',
  studio: 'studio',
  live: 'studio',
  email: 'email',
  term: 'terminal',
  apps: 'appstudio',
  localAi: 'offline-ai',
  monitors: 'screens',
  mixer: 'mixer',
  tasks: 'task-manager',
  weather: 'weather',
  messages: 'messages',
  videoWindow: 'video-player',
  videoBin: 'video-player'
}

/**
 * Single messages that differ from their group: parts other features share (picking a folder,
 * dragging a file, a video's details, the video tools), or that core features ask about.
 */
const CHANNEL_OVERRIDES: Record<string, string | null> = {
  // The Files page's whole-PC search; the rest of explorer: is shared (folder pickers, dragging files out).
  'explorer:search': 'files',
  'explorer:searchPc': 'files',
  'explorer:indexStatus': 'files',
  'explorer:reindex': 'files',
  'explorer:tagged': 'files',
  'explorer:folderSizes': 'files',
  // The video tools (ffmpeg), shared by Clips, Studio, the video player and Convert files.
  'convert:video': 'video-tools',
  'convert:video-cancel': 'video-tools',
  'convert:ffmpeg-get': 'video-tools',
  // Asked by notes (autocomplete, meanings) to see whether offline AI is there.
  'localAi:state': null,
  // Closing any tab lets go of the messages page, added or not.
  'messages:release': null,
  // Sending a clip to a Discord channel (a webhook) is part of Clips, not Discord voice.
  'discord:hooks': 'clips',
  'discord:addHook': 'clips',
  'discord:removeHook': 'clips',
  'discord:send': 'clips',
  // Opening a recordings folder, from Clips as well as the Studio.
  'studio:openFolder': null
}

/** The add-on a message belongs to, or null for a core one. */
export function addonForChannel(channel: string): string | null {
  if (channel in CHANNEL_OVERRIDES) return CHANNEL_OVERRIDES[channel]
  const i = channel.indexOf(':')
  return i > 0 ? (CHANNEL_ADDONS[channel.slice(0, i)] ?? null) : null
}

/** Whether an add-on is added on this computer. */
export const addonOn = (id: string): boolean => installed().includes(id)

/** Runs `fn` whenever the added add-ons change (for stopping or starting background work). */
export function onAddonsChanged(fn: (installed: readonly string[]) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

let last = ''
/** Call when settings change: tells everything listening if the added add-ons did. */
export function addonsMaybeChanged(): void {
  const now = installed()
  const key = now.join(',')
  if (key === last) return
  last = key
  for (const fn of listeners) {
    try {
      fn(now)
    } catch {
      // One add-on failing to stop mustn't stop the others.
    }
  }
}

/**
 * Whether Orbit starts with only the core features: a brand new Orbit (no settings saved on this
 * computer yet) opening a brand new notes folder (nothing Orbit keeps in it yet). Anyone who
 * already used Orbit, here or with that notes folder, keeps every add-on.
 */
export function startsCoreOnly(hasSavedPrefs: boolean, notesFolder: string): boolean {
  return !hasSavedPrefs && !existsSync(join(notesFolder, '.notesapp'))
}

const notAdded = (id: string): Error => new Error(`${addonById(id)?.name ?? 'That'} isn’t added. Add it in Settings → Add-ons.`)

/**
 * Starts checking messages. Call before anything registers its handlers, so every one is covered.
 */
export function setupAddonGate(getInstalled: () => readonly string[]): void {
  installed = getInstalled
  last = installed().join(',')
  const handle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown): void => {
    const addon = addonForChannel(channel)
    if (!addon) return handle(channel, listener)
    handle(channel, (event, ...args) => {
      if (!addonOn(addon)) throw notAdded(addon)
      return listener(event, ...args)
    })
  }
  const on = ipcMain.on.bind(ipcMain)
  ipcMain.on = (channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void) => {
    const addon = addonForChannel(channel)
    if (!addon) return on(channel, listener)
    return on(channel, (event, ...args) => {
      if (addonOn(addon)) listener(event, ...args)
    })
  }
}
