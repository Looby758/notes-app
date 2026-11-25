import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { LocalAiState, MusicLinkProgress, MusicMiniCommand, MusicMiniLayout, MusicMiniState, NotesApi } from '@shared/types'
import type { MusicData } from '@shared/musicLibrary'
import type { LocalLibrary } from '@shared/localMusic'

/** Listens for a message from the main process; returns the way to stop. */
function on<T>(channel: string, callback: (value: T) => void): () => void {
  const handler = (_e: unknown, value: T): void => callback(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: NotesApi = {
  confirm: (options) => ipcRenderer.invoke('app:confirm', options),
  copySecret: (text, seconds) => ipcRenderer.invoke('clipboard:copySecret', text, seconds),

  getPrefs: () => ipcRenderer.invoke('prefs:get'),
  setPrefs: (patch) => ipcRenderer.invoke('prefs:set', patch),
  onPrefsChanged: (callback) => {
    const handler = (_e: unknown, prefs: Parameters<typeof callback>[0]): void => callback(prefs)
    ipcRenderer.on('prefs:changed', handler)
    return () => ipcRenderer.removeListener('prefs:changed', handler)
  },
  spellcheckLanguages: () => ipcRenderer.invoke('prefs:languages'),
  openSettingsFile: () => ipcRenderer.invoke('prefs:openFile'),
  listThemes: () => ipcRenderer.invoke('themes:list'),
  importTheme: () => ipcRenderer.invoke('themes:import'),
  removeTheme: (id) => ipcRenderer.invoke('themes:remove', id),
  makeTheme: (manifest, picture) => ipcRenderer.invoke('themes:make', manifest, picture),
  onThemesChanged: (callback) => {
    const handler = (_e: unknown, themes: Parameters<typeof callback>[0]): void => callback(themes)
    ipcRenderer.on('themes:changed', handler)
    return () => ipcRenderer.removeListener('themes:changed', handler)
  },
  showLog: () => ipcRenderer.invoke('app:showLog'),
  setFullScreen: (on) => ipcRenderer.invoke('app:fullscreen', on),
  showReminder: (r) => ipcRenderer.invoke('reminder:show', r),
  micAccess: () => ipcRenderer.invoke('voice:access'),
  studioSources: () => ipcRenderer.invoke('studio:sources'),
  studioAccess: (what) => ipcRenderer.invoke('studio:access', what),
  studioDefaultFolder: () => ipcRenderer.invoke('studio:defaultFolder'),
  studioPickFolder: () => ipcRenderer.invoke('studio:pickFolder'),
  studioStart: (folder, ext, kind, take) => ipcRenderer.invoke('studio:start', folder, ext, kind, take),
  studioReadTake: (path) => ipcRenderer.invoke('studio:readTake', path),
  studioJoinTakes: (parts, script) => ipcRenderer.invoke('studio:joinTakes', parts, script),
  studioTrim: (path, settings) => ipcRenderer.invoke('studio:trim', path, settings),
  studioWriteCues: (path, json) => ipcRenderer.invoke('studio:writeCues', path, json),
  studioChunk: (id, data) => ipcRenderer.invoke('studio:chunk', id, data),
  studioStop: (id) => ipcRenderer.invoke('studio:stop', id),
  studioReveal: (path) => ipcRenderer.invoke('studio:reveal', path),
  studioOpenFolder: (folder) => ipcRenderer.invoke('studio:openFolder', folder),
  replayStatus: () => ipcRenderer.invoke('replay:status'),
  replaySaveNow: () => ipcRenderer.invoke('replay:saveNow'),
  replayScreen: () => ipcRenderer.invoke('replay:screen'),
  replayRunning: (on) => ipcRenderer.invoke('replay:running', on),
  replaySave: (folder, parts, ext, seconds, kind) => ipcRenderer.invoke('replay:save', folder, parts, ext, seconds, kind),
  onReplaySave: (callback) => {
    const handler = (): void => callback()
    ipcRenderer.on('replay:save', handler)
    return () => ipcRenderer.removeListener('replay:save', handler)
  },
  onMusicDuck: (callback) => {
    const handler = (_e: unknown, level: number): void => callback(level)
    ipcRenderer.on('music:duck', handler)
    return () => ipcRenderer.removeListener('music:duck', handler)
  },
  onClipsOpen: (callback) => {
    const handler = (_e: unknown, path: string): void => callback(path)
    ipcRenderer.on('clips:open', handler)
    return () => ipcRenderer.removeListener('clips:open', handler)
  },
  clipsList: (folder) => ipcRenderer.invoke('clips:list', folder),
  clipsMeta: (folder) => ipcRenderer.invoke('clips:meta', folder),
  clipsStar: (folder, path, on) => ipcRenderer.invoke('clips:star', folder, path, on),
  clipsMove: (folder, path, to) => ipcRenderer.invoke('clips:move', folder, path, to),
  clipsRenameFolder: (folder, from, to) => ipcRenderer.invoke('clips:renameFolder', folder, from, to),
  clipsExport: (folder, request) => ipcRenderer.invoke('clips:export', folder, request),
  clipsCancel: () => ipcRenderer.invoke('clips:cancel'),
  onClipsProgress: (callback) => {
    const handler = (_e: unknown, done: number): void => callback(done)
    ipcRenderer.on('clips:progress', handler)
    return () => ipcRenderer.removeListener('clips:progress', handler)
  },
  clipsTrash: (folder, path) => ipcRenderer.invoke('clips:trash', folder, path),
  clipsReveal: (folder, path) => ipcRenderer.invoke('clips:reveal', folder, path),
  clipsDrag: (folder, path, icon) => ipcRenderer.send('clips:drag', folder, path, icon),
  discordHooks: () => ipcRenderer.invoke('discord:hooks'),
  discordAddHook: (name, url) => ipcRenderer.invoke('discord:addHook', name, url),
  discordRemoveHook: (id) => ipcRenderer.invoke('discord:removeHook', id),
  discordSend: (folder, hookId, path, message) => ipcRenderer.invoke('discord:send', folder, hookId, path, message),
  liveStatus: () => ipcRenderer.invoke('live:status'),
  onLiveStatus: (callback) => {
    const handler = (_e: unknown, s: Parameters<typeof callback>[0]): void => callback(s)
    ipcRenderer.on('live:status', handler)
    return () => ipcRenderer.removeListener('live:status', handler)
  },
  liveGetFfmpeg: () => ipcRenderer.invoke('live:getFfmpeg'),
  liveRemoveFfmpeg: () => ipcRenderer.invoke('live:removeFfmpeg'),
  liveSetKey: (service, key, customUrl) => ipcRenderer.invoke('live:setKey', service, key, customUrl),
  liveClearKey: (service) => ipcRenderer.invoke('live:clearKey', service),
  liveSetService: (service) => ipcRenderer.invoke('live:setService', service),
  liveStart: (service, quality) => ipcRenderer.invoke('live:start', service, quality),
  liveChunk: (data) => ipcRenderer.invoke('live:chunk', data),
  liveStop: () => ipcRenderer.invoke('live:stop'),
  onLiveStats: (callback) => {
    const handler = (_e: unknown, s: Parameters<typeof callback>[0]): void => callback(s)
    ipcRenderer.on('live:stats', handler)
    return () => ipcRenderer.removeListener('live:stats', handler)
  },
  onLiveEnded: (callback) => {
    const handler = (_e: unknown, err: string | null): void => callback(err)
    ipcRenderer.on('live:ended', handler)
    return () => ipcRenderer.removeListener('live:ended', handler)
  },
  onVoiceStart: (callback) => {
    const handler = (): void => callback()
    ipcRenderer.on('voice:start', handler)
    return () => ipcRenderer.removeListener('voice:start', handler)
  },
  onSketchStart: (callback) => {
    const handler = (): void => callback()
    ipcRenderer.on('sketch:start', handler)
    return () => ipcRenderer.removeListener('sketch:start', handler)
  },
  setFormatMenu: (items) => ipcRenderer.send('format:menu', items),
  onFormat: (callback) => {
    const handler = (_e: unknown, id: string): void => callback(id)
    ipcRenderer.on('format:run', handler)
    return () => ipcRenderer.removeListener('format:run', handler)
  },
  popupMenu: (items, x, y) => ipcRenderer.invoke('menu:popup', items, x, y),
  // Waits for the main process, so it has the word before it builds the right-click menu.
  setMenuWord: (word) => ipcRenderer.sendSync('dictionary:word', word),
  onShowDefinition: (callback) => {
    const handler = (_e: unknown, entry: Parameters<typeof callback>[0]): void => callback(entry)
    ipcRenderer.on('dictionary:show', handler)
    return () => ipcRenderer.removeListener('dictionary:show', handler)
  },
  onReplaceWord: (callback) => {
    const handler = (_e: unknown, text: string): void => callback(text)
    ipcRenderer.on('dictionary:replace', handler)
    return () => ipcRenderer.removeListener('dictionary:replace', handler)
  },
  webTitle: (url) => ipcRenderer.invoke('web:title', url),
  searchPlaces: (query) => ipcRenderer.invoke('places:search', query),
  mapTile: (z, x, y) => ipcRenderer.invoke('places:tile', z, x, y),
  zoneAt: (lat, lon) => ipcRenderer.invoke('places:zone', lat, lon),
  weather: (force) => ipcRenderer.invoke('weather:get', force),
  setWeatherPlace: (place) => ipcRenderer.invoke('weather:setPlace', place),
  clearWebData: () => ipcRenderer.invoke('web:clear'),
  clearMessagesData: () => ipcRenderer.invoke('messages:clear'),
  releaseMessages: () => ipcRenderer.invoke('messages:release'),
  setWebShortcuts: (shortcuts) => ipcRenderer.send('web:shortcuts', shortcuts),
  onWebOpen: (callback) => {
    const handler = (_e: unknown, url: string, privately?: boolean): void => callback(url, privately === true)
    ipcRenderer.on('web:open', handler)
    return () => ipcRenderer.removeListener('web:open', handler)
  },
  onWebShortcut: (callback) => {
    const handler = (_e: unknown, shortcut: string): void => callback(shortcut)
    ipcRenderer.on('web:shortcut', handler)
    return () => ipcRenderer.removeListener('web:shortcut', handler)
  },
  webTakePending: () => ipcRenderer.invoke('web:takePending'),
  webOpenOutside: (url) => ipcRenderer.invoke('web:openOutside', url),
  webDefaultBrowser: () => ipcRenderer.invoke('web:defaultBrowser'),
  webMakeDefault: () => ipcRenderer.invoke('web:makeDefault'),
  onWebKey: (callback) => on('web:key', callback),
  webBookmarks: () => ipcRenderer.invoke('web:bookmarks'),
  webFavicons: () => ipcRenderer.invoke('web:favicons'),
  onWebFavicons: (callback) => on('web:favicons', callback),
  webSetBookmarks: (list) => ipcRenderer.invoke('web:setBookmarks', list),
  onWebBookmarks: (callback) => on('web:bookmarks-changed', callback),
  webHistory: (query, limit) => ipcRenderer.invoke('web:history', query, limit),
  webHistoryRemove: (url) => ipcRenderer.invoke('web:historyRemove', url),
  webHistoryClear: () => ipcRenderer.invoke('web:historyClear'),
  webSuggest: (typed) => ipcRenderer.invoke('web:suggest', typed),
  webSites: () => ipcRenderer.invoke('web:sites'),
  webSiteSet: (site, patch) => ipcRenderer.invoke('web:siteSet', site, patch),
  webSiteForget: (site) => ipcRenderer.invoke('web:siteForget', site),
  onWebSites: (callback) => on('web:sites-changed', callback),
  webClearSite: (site) => ipcRenderer.invoke('web:clearSite', site),
  webDownloads: () => ipcRenderer.invoke('web:downloads'),
  onWebDownloads: (callback) => on('web:downloads', callback),
  onWebDownloadStarted: (callback) => on('web:download-started', callback),
  webDownloadTo: (id, folder, remember) => ipcRenderer.invoke('web:downloadTo', id, folder, remember),
  webDownloadCancel: (id) => ipcRenderer.invoke('web:downloadCancel', id),
  webDownloadPause: (id, paused) => ipcRenderer.invoke('web:downloadPause', id, paused),
  webDownloadForget: (id) => ipcRenderer.invoke('web:downloadForget', id),
  webDownloadsClear: () => ipcRenderer.invoke('web:downloadsClear'),
  webDownloadFolder: () => ipcRenderer.invoke('web:downloadFolder'),
  webSetDownloadFolder: (folder) => ipcRenderer.invoke('web:setDownloadFolder', folder),
  webAutofill: () => ipcRenderer.invoke('web:autofill'),
  onWebAutofill: (callback) => on('web:autofill-changed', callback),
  webSetAutofill: (profile) => ipcRenderer.invoke('web:setAutofill', profile),
  webZoom: (wcId, by) => ipcRenderer.invoke('web:zoom', wcId, by),
  onWebZoomed: (callback) => on('web:zoomed', callback),
  webMuteTab: (wcId, muted) => ipcRenderer.invoke('web:muteTab', wcId, muted),
  onWebAudio: (callback) => on('web:audio', callback),
  onWebPermissionAsk: (callback) => on('web:permission-ask', callback),
  webPermissionAnswer: (id, allow) => ipcRenderer.invoke('web:permissionAnswer', id, allow),
  onWebFocus: (callback) => on('web:focus', callback),
  onWebImageSaved: (callback) => {
    const handler = (_e: unknown, path: string | null, error?: string): void => callback(path, error)
    ipcRenderer.on('web:image-saved', handler)
    return () => ipcRenderer.removeListener('web:image-saved', handler)
  },
  webOperaFound: () => ipcRenderer.invoke('web:operaFound'),
  webImportOpera: () => ipcRenderer.invoke('web:importOpera'),
  webImportCsv: () => ipcRenderer.invoke('web:importCsv'),
  onWebMouseNav: (callback) => {
    const handler = (_e: unknown, contentsId: number, dir: 1 | -1): void => callback(contentsId, dir)
    ipcRenderer.on('web:mouseNav', handler)
    return () => ipcRenderer.removeListener('web:mouseNav', handler)
  },
  popOutWebPage: (url, seconds) => ipcRenderer.invoke('webWindow:open', url, seconds),
  pickImport: (kind, extensions) => ipcRenderer.invoke('import:pick', kind, extensions),
  listImport: (root) => ipcRenderer.invoke('import:list', root),
  readImport: (path) => ipcRenderer.invoke('import:read', path),
  md5: (data) => ipcRenderer.invoke('import:md5', data),
  appleNotes: () => ipcRenderer.invoke('import:appleNotes'),
  takeOpenedFiles: () => ipcRenderer.invoke('orbit:takeOpened'),
  onOpenFile: (callback) => {
    const handler = (_e: unknown, path: string): void => callback(path)
    ipcRenderer.on('orbit:open-path', handler)
    return () => ipcRenderer.removeListener('orbit:open-path', handler)
  },
  onReminderOpen: (callback) => {
    const handler = (_e: unknown, path: string, line: number): void => callback(path, line)
    ipcRenderer.on('reminder:open', handler)
    return () => ipcRenderer.removeListener('reminder:open', handler)
  },

  updateStatus: () => ipcRenderer.invoke('update:status'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  whatsNewPending: () => ipcRenderer.invoke('whatsNew:pending'),
  whatsNewAll: () => ipcRenderer.invoke('whatsNew:all'),
  whatsNewSeen: () => ipcRenderer.invoke('whatsNew:seen'),
  checkSettingsFiles: () => ipcRenderer.invoke('settingsHealth:check'),
  resetSettingsFile: (file) => ipcRenderer.invoke('settingsHealth:reset', file),
  onUpdateStatus: (callback) => {
    const handler = (_e: unknown, status: Parameters<typeof callback>[0]): void => callback(status)
    ipcRenderer.on('update:status', handler)
    return () => ipcRenderer.removeListener('update:status', handler)
  },

  readImage: (path) => ipcRenderer.invoke('fs:readImage', path),
  printToPdf: (html) => ipcRenderer.invoke('export:pdf', html),
  exportFile: (name, format, data) => ipcRenderer.invoke('export:file', name, format, data),
  exportFiles: (folderName, files) => ipcRenderer.invoke('export:files', folderName, files),
  showExported: (path) => ipcRenderer.invoke('export:show', path),
  readForConvert: (path) => ipcRenderer.invoke('export:readForConvert', path),
  saveBeside: (original, name, data) => ipcRenderer.invoke('export:beside', original, name, data),
  decodeHeic: (data) => ipcRenderer.invoke('convert:heic', data),
  comicsShelf: () => ipcRenderer.invoke('comics:shelf'),
  comicsAdd: (paths) => ipcRenderer.invoke('comics:add', paths),
  comicsAddFolder: () => ipcRenderer.invoke('comics:addFolder'),
  comicsRemove: (id) => ipcRenderer.invoke('comics:remove', id),
  comicsOpen: (id) => ipcRenderer.invoke('comics:open', id),
  comicsClose: (id) => ipcRenderer.invoke('comics:close', id),
  comicsProgress: (id, page, offset, finished) => ipcRenderer.invoke('comics:progress', id, page, offset, finished),
  comicsResetProgress: (id) => ipcRenderer.invoke('comics:resetProgress', id),
  comicsTurned: (pages) => ipcRenderer.invoke('comics:turned', pages),
  comicsSettings: (id, patch) => ipcRenderer.invoke('comics:settings', id, patch),
  comicsRename: (id, title) => ipcRenderer.invoke('comics:rename', id, title),
  comicsReveal: (id) => ipcRenderer.invoke('comics:reveal', id),
  comicsReadText: (png) => ipcRenderer.invoke('comics:readText', png),
  onComicsChanged: (callback) => {
    const handler = (): void => callback()
    ipcRenderer.on('comics:changed', handler)
    return () => ipcRenderer.removeListener('comics:changed', handler)
  },
  onComicsPreparing: (callback) => {
    const handler = (_e: unknown, p: Parameters<typeof callback>[0]): void => callback(p)
    ipcRenderer.on('comics:preparing', handler)
    return () => ipcRenderer.removeListener('comics:preparing', handler)
  },
  wikiList: () => ipcRenderer.invoke('wiki:list'),
  wikiCheck: (address) => ipcRenderer.invoke('wiki:check', address),
  wikiAdd: (address, pictures) => ipcRenderer.invoke('wiki:add', address, pictures),
  wikiPause: (id) => ipcRenderer.invoke('wiki:pause', id),
  wikiResume: (id) => ipcRenderer.invoke('wiki:resume', id),
  wikiRemove: (id) => ipcRenderer.invoke('wiki:remove', id),
  wikiTitles: (id) => ipcRenderer.invoke('wiki:titles', id),
  wikiPage: (id, title, showUnplaced) => ipcRenderer.invoke('wiki:page', id, title, showUnplaced),
  wikiSpoilers: (id) => ipcRenderer.invoke('wiki:spoilers', id),
  wikiSetSpoilers: (id, patch) => ipcRenderer.invoke('wiki:setSpoilers', id, patch),
  wikiSearch: (id, query) => ipcRenderer.invoke('wiki:search', id, query),
  wikiAsk: (question, ids) => ipcRenderer.invoke('wiki:ask', question, ids),
  onWikiChanged: (callback) => {
    const handler = (_e: unknown, wikis: Parameters<typeof callback>[0]): void => callback(wikis)
    ipcRenderer.on('wiki:changed', handler)
    return () => ipcRenderer.removeListener('wiki:changed', handler)
  },
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  videoConverterStatus: () => ipcRenderer.invoke('convert:ffmpeg-status'),
  getVideoConverter: () => ipcRenderer.invoke('convert:ffmpeg-get'),
  onVideoConverterStatus: (callback) => {
    const handler = (_e: unknown, state: Parameters<typeof callback>[0]): void => callback(state)
    ipcRenderer.on('convert:ffmpeg-status', handler)
    return () => ipcRenderer.removeListener('convert:ffmpeg-status', handler)
  },
  videoDownloaderState: () => ipcRenderer.invoke('vdl:state'),
  getVideoDownloader: () => ipcRenderer.invoke('vdl:get'),
  onVideoDownloaderState: (callback) => {
    const handler = (_e: unknown, state: Parameters<typeof callback>[0]): void => callback(state)
    ipcRenderer.on('vdl:state', handler)
    return () => ipcRenderer.removeListener('vdl:state', handler)
  },
  downloadVideo: (request) => ipcRenderer.invoke('vdl:start', request),
  videoDownloads: () => ipcRenderer.invoke('vdl:jobs'),
  onVideoDownloads: (callback) => {
    const handler = (_e: unknown, list: Parameters<typeof callback>[0]): void => callback(list)
    ipcRenderer.on('vdl:jobs', handler)
    return () => ipcRenderer.removeListener('vdl:jobs', handler)
  },
  cancelVideoDownload: (id) => ipcRenderer.invoke('vdl:cancel', id),
  forgetVideoDownload: (id) => ipcRenderer.invoke('vdl:forget', id),
  downloadsState: () => ipcRenderer.invoke('dm:state'),
  onDownloadsState: (callback) => on('dm:state', callback),
  downloadsAdd: (request) => ipcRenderer.invoke('dm:add', request),
  downloadsAct: (id, action) => ipcRenderer.invoke('dm:act', id, action),
  downloadsAll: (action) => ipcRenderer.invoke('dm:all', action),
  downloadsSettings: (patch) => ipcRenderer.invoke('dm:settings', patch),
  steamDownloads: () => ipcRenderer.invoke('dm:steam'),
  steamInstall: (appId) => ipcRenderer.invoke('dm:steamInstall', appId),
  steamOpenDownloads: () => ipcRenderer.invoke('dm:steamOpen'),
  epicDownloads: () => ipcRenderer.invoke('dm:epic'),
  epicOpenDownloads: () => ipcRenderer.invoke('dm:epicOpen'),
  convertVideo: (request) => ipcRenderer.invoke('convert:video', request),
  cancelVideo: (id) => ipcRenderer.invoke('convert:video-cancel', id),
  onVideoProgress: (callback) => {
    const handler = (_e: unknown, id: number, done: number): void => callback(id, done)
    ipcRenderer.on('convert:video-progress', handler)
    return () => ipcRenderer.removeListener('convert:video-progress', handler)
  },

  videoInfo: (path) => ipcRenderer.invoke('video:info', path),
  videoSubtitles: (path, source) => ipcRenderer.invoke('video:subtitles', path, source),
  videoKeyframe: (path, at, fileStart) => ipcRenderer.invoke('video:keyframe', path, at, fileStart),
  videoFrame: (path, at) => ipcRenderer.invoke('video:frame', path, at),
  stopVideoStream: (session) => ipcRenderer.invoke('video:stop', session),
  releaseVideo: (path) => ipcRenderer.invoke('video:release', path),
  releaseFile: (path) => ipcRenderer.invoke('files:release', path),
  popOutVideo: (path) => ipcRenderer.invoke('videoWindow:open', path),
  videoWindowCurrent: () => ipcRenderer.invoke('videoWindow:current'),
  videoWindowShowing: (path) => ipcRenderer.send('videoWindow:showing', path),
  popInVideo: (path) => ipcRenderer.invoke('videoWindow:popIn', path),
  onVideoWindow: (fn) => {
    const play = (_e: Electron.IpcRendererEvent, path: string): void => fn('play', path)
    const popIn = (_e: Electron.IpcRendererEvent, path: string): void => fn('popIn', path)
    ipcRenderer.on('videoWindow:play', play)
    ipcRenderer.on('videoWindow:popIn', popIn)
    return () => {
      ipcRenderer.removeListener('videoWindow:play', play)
      ipcRenderer.removeListener('videoWindow:popIn', popIn)
    }
  },
  videoInVault: (path) => ipcRenderer.invoke('video:inVault', path),
  pickVideoFile: (kind, near) => ipcRenderer.invoke('video:pick', kind, near),
  monitorsGet: () => ipcRenderer.invoke('monitors:get'),
  monitorsRescan: () => ipcRenderer.invoke('monitors:rescan'),
  monitorSet: (id, setting, value) => ipcRenderer.invoke('monitors:set', id, setting, value),
  monitorAction: (target, action) => ipcRenderer.invoke('monitors:action', target, action),
  monitorsSave: (saved) => ipcRenderer.invoke('monitors:save', saved),
  onMonitorsChanged: (callback) => {
    const handler = (_e: unknown, status: Parameters<typeof callback>[0]): void => callback(status)
    ipcRenderer.on('monitors:changed', handler)
    return () => ipcRenderer.removeListener('monitors:changed', handler)
  },
  mixerGet: () => ipcRenderer.invoke('mixer:get'),
  mixerVolume: (id, volume) => ipcRenderer.invoke('mixer:volume', id, volume),
  mixerMute: (id, muted) => ipcRenderer.invoke('mixer:mute', id, muted),
  tasksGet: () => ipcRenderer.invoke('tasks:get'),
  tasksEnd: (targets) => ipcRenderer.invoke('tasks:end', targets),
  tasksReveal: (pid) => ipcRenderer.invoke('tasks:reveal', pid),
  uninstallList: () => ipcRenderer.invoke('uninstall:list'),
  uninstallRun: (id) => ipcRenderer.invoke('uninstall:run', id),
  uninstallGone: (id) => ipcRenderer.invoke('uninstall:gone', id),
  uninstallScan: (id) => ipcRenderer.invoke('uninstall:scan', id),
  uninstallRemove: (scanId, ids) => ipcRenderer.invoke('uninstall:remove', scanId, ids),
  uninstallQuit: (id) => ipcRenderer.invoke('uninstall:quit', id),
  uninstallReveal: (path) => ipcRenderer.invoke('uninstall:reveal', path),
  soundboardGet: () => ipcRenderer.invoke('soundboard:get'),
  soundboardPick: () => ipcRenderer.invoke('soundboard:pick'),
  soundboardAddFiles: (paths) => ipcRenderer.invoke('soundboard:add-files', paths),
  soundboardUpdate: (id, patch) => ipcRenderer.invoke('soundboard:update', id, patch),
  soundboardSetBoardHotkey: (which, accel) => ipcRenderer.invoke('soundboard:board-hotkey', which, accel),
  soundboardRemove: (id) => ipcRenderer.invoke('soundboard:remove', id),
  soundboardMove: (id, to) => ipcRenderer.invoke('soundboard:move', id, to),
  soundboardOpenLink: (which) => ipcRenderer.invoke('soundboard:open-link', which),
  soundboardShowFolder: () => ipcRenderer.invoke('soundboard:show-folder'),
  soundLinkFetch: (id, link) => ipcRenderer.invoke('soundLink:fetch', id, link),
  soundLinkMake: (id, start, end, name) => ipcRenderer.invoke('soundLink:make', id, start, end, name),
  soundLinkForget: (id) => ipcRenderer.invoke('soundLink:forget', id),
  onSoundLinkProgress: (callback) => {
    const handler = (_e: unknown, id: string, done: number | null): void => callback(id, done)
    ipcRenderer.on('soundLink:progress', handler)
    return () => ipcRenderer.removeListener('soundLink:progress', handler)
  },
  onSoundboardHotkey: (callback) => {
    const handler = (_e: unknown, action: Parameters<typeof callback>[0]): void => callback(action)
    ipcRenderer.on('soundboard:hotkey', handler)
    return () => ipcRenderer.removeListener('soundboard:hotkey', handler)
  },
  onSoundboardChanged: (callback) => {
    const handler = (_e: unknown, status: Parameters<typeof callback>[0]): void => callback(status)
    ipcRenderer.on('soundboard:changed', handler)
    return () => ipcRenderer.removeListener('soundboard:changed', handler)
  },
  macrosGet: () => ipcRenderer.invoke('macros:get'),
  macrosRecord: () => ipcRenderer.invoke('macros:record'),
  macrosPlay: (id) => ipcRenderer.invoke('macros:play', id),
  macrosStop: () => ipcRenderer.invoke('macros:stop'),
  macrosClicker: (on) => ipcRenderer.invoke('macros:clicker', on),
  macrosUpdate: (id, patch) => ipcRenderer.invoke('macros:update', id, patch),
  macrosRemove: (id) => ipcRenderer.invoke('macros:remove', id),
  macrosSetCurrent: (id) => ipcRenderer.invoke('macros:current', id),
  macrosSettings: (patch) => ipcRenderer.invoke('macros:settings', patch),
  macrosDismiss: () => ipcRenderer.invoke('macros:dismiss'),
  macrosPointer: () => ipcRenderer.invoke('macros:pointer'),
  onMacrosChanged: (callback) => {
    const handler = (_e: unknown, status: Parameters<typeof callback>[0]): void => callback(status)
    ipcRenderer.on('macros:changed', handler)
    return () => ipcRenderer.removeListener('macros:changed', handler)
  },
  keyRemapGet: () => ipcRenderer.invoke('keyremap:get'),
  keyRemapSetOn: (on) => ipcRenderer.invoke('keyremap:on', on),
  keyRemapSetHotkey: (accel) => ipcRenderer.invoke('keyremap:hotkey', accel),
  keyRemapAddSet: (app, name) => ipcRenderer.invoke('keyremap:addSet', app, name),
  keyRemapUpdateSet: (id, patch) => ipcRenderer.invoke('keyremap:updateSet', id, patch),
  keyRemapRemoveSet: (id) => ipcRenderer.invoke('keyremap:removeSet', id),
  keyRemapSaveRule: (setId, rule) => ipcRenderer.invoke('keyremap:saveRule', setId, rule),
  keyRemapRemoveRule: (setId, ruleId) => ipcRenderer.invoke('keyremap:removeRule', setId, ruleId),
  keyRemapHold: (on) => ipcRenderer.invoke('keyremap:hold', on),
  onKeyRemapChanged: (callback) => {
    const handler = (_e: unknown, status: Parameters<typeof callback>[0]): void => callback(status)
    ipcRenderer.on('keyremap:changed', handler)
    return () => ipcRenderer.removeListener('keyremap:changed', handler)
  },

  discordGet: () => ipcRenderer.invoke('discord:get'),
  discordSaveApp: (clientId, secret) => ipcRenderer.invoke('discord:save-app', clientId, secret),
  discordSignIn: () => ipcRenderer.invoke('discord:sign-in'),
  discordRetry: () => ipcRenderer.invoke('discord:retry'),
  discordSignOut: () => ipcRenderer.invoke('discord:sign-out'),
  discordForget: () => ipcRenderer.invoke('discord:forget'),
  discordSet: (which, value) => ipcRenderer.invoke('discord:set', which, value),
  discordOpenPortal: () => ipcRenderer.invoke('discord:open-portal'),
  discordUserVoice: (userId, patch) => ipcRenderer.invoke('discord:user-voice', userId, patch),
  discordLeave: () => ipcRenderer.invoke('discord:leave'),
  discordPushToTalk: (down) => ipcRenderer.invoke('discord:push-to-talk', down),
  discordOpenChannel: () => ipcRenderer.invoke('discord:open-channel'),
  discordReauthorize: () => ipcRenderer.invoke('discord:reauthorize'),
  discordCalls: () => ipcRenderer.invoke('discord:calls'),
  discordRemoveCall: (id) => ipcRenderer.invoke('discord:remove-call', id),
  discordClearCalls: () => ipcRenderer.invoke('discord:clear-calls'),
  discordNote: () => ipcRenderer.invoke('discord:note'),
  discordSetNote: (text, channelId) => ipcRenderer.invoke('discord:set-note', text, channelId),
  discordSetCallNote: (id, text) => ipcRenderer.invoke('discord:set-call-note', id, text),
  onDiscordNote: (callback) => {
    const handler = (_e: Electron.IpcRendererEvent, text: string): void => callback(text)
    ipcRenderer.on('discord:note-changed', handler)
    return () => ipcRenderer.removeListener('discord:note-changed', handler)
  },
  onDiscordCalls: (callback) => {
    const handler = (_e: Electron.IpcRendererEvent, calls: Parameters<typeof callback>[0]): void => callback(calls)
    ipcRenderer.on('discord:calls-changed', handler)
    return () => ipcRenderer.removeListener('discord:calls-changed', handler)
  },
  openDiscordPopout: () => ipcRenderer.invoke('discord-popout:open'),
  closeDiscordPopout: () => ipcRenderer.invoke('discord-popout:close'),
  minimizeDiscordPopout: () => ipcRenderer.invoke('discord-popout:minimize'),
  discordPopoutOpen: () => ipcRenderer.invoke('discord-popout:is-open'),
  onDiscordPopoutOpen: (callback) => {
    const handler = (_e: Electron.IpcRendererEvent, open: boolean): void => callback(open)
    ipcRenderer.on('discord-popout:open-changed', handler)
    return () => ipcRenderer.removeListener('discord-popout:open-changed', handler)
  },
  watchDiscordStream: () => ipcRenderer.invoke('discord-popout:watch'),
  discordToastAnswer: (popOut) => ipcRenderer.invoke('discord-toast:answer', popOut),
  discordToastHover: (over) => ipcRenderer.invoke('discord-toast:hover', over),
  soundboardTrigger: (action) => ipcRenderer.invoke('soundboard:trigger', action),
  openRobloxDownload: () => ipcRenderer.invoke('discord-popout:roblox-download'),
  onDiscordChanged: (callback) => {
    const handler = (_e: unknown, status: Parameters<typeof callback>[0]): void => callback(status)
    ipcRenderer.on('discord:changed', handler)
    return () => ipcRenderer.removeListener('discord:changed', handler)
  },

  startSnip: (mode, delay) => ipcRenderer.invoke('snip:start', mode, delay),
  snipCopyPicture: (png) => ipcRenderer.invoke('snip:copyPicture', png),
  snipTaskbar: () => ipcRenderer.invoke('snip:taskbar'),
  snipShowShortcut: () => ipcRenderer.invoke('snip:showShortcut'),
  snipSaveInfo: () => ipcRenderer.invoke('snip:saveInfo'),
  snipPickFolder: () => ipcRenderer.invoke('snip:pickFolder'),
  snipOpenFolder: () => ipcRenderer.invoke('snip:openFolder'),
  snipShowLast: () => ipcRenderer.invoke('snip:showLast'),
  snipStatus: () => ipcRenderer.invoke('snip:status'),
  snipImage: () => ipcRenderer.invoke('snip:image'),
  snipRead: (png, lang) => ipcRenderer.invoke('snip:read', png, lang),
  snipOcrLangs: () => ipcRenderer.invoke('snip:ocrLangs'),
  snipGetOcrLang: (code) => ipcRenderer.invoke('snip:getOcrLang', code),
  snipTranslate: (text, target) => ipcRenderer.invoke('snip:translate', text, target),
  snipClose: () => ipcRenderer.invoke('snip:close'),
  snipBoxing: () => ipcRenderer.invoke('snip:boxing'),
  snipDrawn: () => ipcRenderer.invoke('snip:drawn'),
  snipPainted: () => ipcRenderer.invoke('snip:painted'),
  onSnipNew: (callback) => {
    const handler = (): void => callback()
    ipcRenderer.on('snip:new', handler)
    return () => ipcRenderer.removeListener('snip:new', handler)
  },
  onSnipVisible: (callback) => {
    const handler = (): void => callback()
    ipcRenderer.on('snip:visible', handler)
    return () => ipcRenderer.removeListener('snip:visible', handler)
  },
  onSnipReset: (callback) => {
    const handler = (): void => callback()
    ipcRenderer.on('snip:reset', handler)
    return () => ipcRenderer.removeListener('snip:reset', handler)
  },
  onSnipClear: (callback) => {
    const handler = (): void => callback()
    ipcRenderer.on('snip:clear', handler)
    return () => ipcRenderer.removeListener('snip:clear', handler)
  },
  snipReportBug: (png) => ipcRenderer.invoke('snip:bug', png),
  onAppStudioBug: (callback) => {
    const handler = (_e: unknown, png: Uint8Array): void => callback(png)
    ipcRenderer.on('appstudio:bug', handler)
    return () => ipcRenderer.removeListener('appstudio:bug', handler)
  },
  snipSend: (action, text, target) => ipcRenderer.invoke('snip:send', action, text, target),
  onSnipText: (callback) => {
    const handler = (_e: unknown, action: 'note' | 'ask' | 'setup-ai', text: string): void => callback(action, text)
    ipcRenderer.on('snip:text', handler)
    return () => ipcRenderer.removeListener('snip:text', handler)
  },
  onSnipFailed: (callback) => {
    const handler = (_e: unknown, message: string): void => callback(message)
    ipcRenderer.on('snip:failed', handler)
    return () => ipcRenderer.removeListener('snip:failed', handler)
  },

  openCapture: () => ipcRenderer.invoke('capture:open'),
  closeCapture: () => ipcRenderer.invoke('capture:close'),
  captureKeepOpen: (on) => ipcRenderer.invoke('capture:keepOpen', on),
  captureStatus: () => ipcRenderer.invoke('capture:status'),
  submitCapture: (request) => ipcRenderer.invoke('capture:submit', request),
  onCaptureReset: (callback) => {
    const handler = (): void => callback()
    ipcRenderer.on('capture:reset', handler)
    return () => ipcRenderer.removeListener('capture:reset', handler)
  },
  onCaptureRequest: (callback) => {
    const handler = (_e: unknown, id: number, request: Parameters<typeof callback>[1]): void => callback(id, request)
    ipcRenderer.on('capture:add', handler)
    return () => ipcRenderer.removeListener('capture:add', handler)
  },
  captureResult: (id, result) => ipcRenderer.invoke('capture:result', id, result),

  calendarSources: () => ipcRenderer.invoke('cal:status'),
  googleSetClient: (id, secret) => ipcRenderer.invoke('cal:setClient', id, secret),
  googleConnect: () => ipcRenderer.invoke('cal:connect'),
  googleDisconnect: () => ipcRenderer.invoke('cal:disconnect'),
  googleSetCalendarEnabled: (id, enabled) => ipcRenderer.invoke('cal:setEnabled', id, enabled),
  addCalendarFeed: (name, url) => ipcRenderer.invoke('cal:addFeed', name, url),
  removeCalendarFeed: (id) => ipcRenderer.invoke('cal:removeFeed', id),
  fetchCalendarEvents: (from, to) => ipcRenderer.invoke('cal:events', from, to),
  googleCreateEvent: (calendarId, event) => ipcRenderer.invoke('cal:create', calendarId, event),
  googleUpdateEvent: (calendarId, eventId, event) => ipcRenderer.invoke('cal:update', calendarId, eventId, event),
  googleDeleteEvent: (calendarId, eventId) => ipcRenderer.invoke('cal:delete', calendarId, eventId),
  emailStatus: () => ipcRenderer.invoke('email:status'),
  emailConnect: () => ipcRenderer.invoke('email:connect'),
  emailList: (folder, query, next) => ipcRenderer.invoke('email:list', folder, query, next),
  emailGet: (id) => ipcRenderer.invoke('email:get', id),
  emailSend: (email) => ipcRenderer.invoke('email:send', email),
  emailMarkRead: (id, read) => ipcRenderer.invoke('email:markRead', id, read),
  emailStar: (id, starred) => ipcRenderer.invoke('email:star', id, starred),
  emailArchive: (id) => ipcRenderer.invoke('email:archive', id),
  emailTrash: (id) => ipcRenderer.invoke('email:trash', id),
  readGoogleSheet: (path) => ipcRenderer.invoke('gsheet:read', path),
  musicStatus: () => ipcRenderer.invoke('music:status'),
  musicSetClient: (id) => ipcRenderer.invoke('music:setClient', id),
  musicConnect: () => ipcRenderer.invoke('music:connect'),
  musicDisconnect: () => ipcRenderer.invoke('music:disconnect'),
  musicNowPlaying: () => ipcRenderer.invoke('music:nowPlaying'),
  musicControl: (action) => ipcRenderer.invoke('music:control', action),
  musicSeek: (ms) => ipcRenderer.invoke('music:seek', ms),
  musicSkip: (count) => ipcRenderer.invoke('music:skip', count),
  musicPlay: (uri, context) => ipcRenderer.invoke('music:play', uri, context),
  musicSearch: (query) => ipcRenderer.invoke('music:search', query),
  musicPlaylists: () => ipcRenderer.invoke('music:playlists'),
  musicSetVolume: (percent) => ipcRenderer.invoke('music:setVolume', percent),
  musicIsLiked: (uri) => ipcRenderer.invoke('music:isLiked', uri),
  musicSetLiked: (uri, liked) => ipcRenderer.invoke('music:setLiked', uri, liked),
  musicQueue: () => ipcRenderer.invoke('music:queue'),
  musicAddToQueue: (uri) => ipcRenderer.invoke('music:addToQueue', uri),
  musicRecent: () => ipcRenderer.invoke('music:recent'),
  musicDevices: () => ipcRenderer.invoke('music:devices'),
  musicPlaylistSongs: (uri) => ipcRenderer.invoke('music:playlistSongs', uri),
  musicCreatePlaylist: (name) => ipcRenderer.invoke('music:createPlaylist', name),
  musicRenamePlaylist: (uri, name) => ipcRenderer.invoke('music:renamePlaylist', uri, name),
  musicDeletePlaylist: (uri) => ipcRenderer.invoke('music:deletePlaylist', uri),
  musicAddToPlaylist: (uri, songs, position) => ipcRenderer.invoke('music:addToPlaylist', uri, songs, position),
  musicRestorePlaylist: (uri) => ipcRenderer.invoke('music:restorePlaylist', uri),
  musicRemoveFromPlaylist: (uri, song) => ipcRenderer.invoke('music:removeFromPlaylist', uri, song),
  musicMoveInPlaylist: (uri, from, to) => ipcRenderer.invoke('music:moveInPlaylist', uri, from, to),
  localMusicLibrary: (fresh) => ipcRenderer.invoke('localMusic:library', fresh),
  localMusicChooseFolder: () => ipcRenderer.invoke('localMusic:chooseFolder'),
  localMusicDefaultFolder: () => ipcRenderer.invoke('localMusic:defaultFolder'),
  onLocalMusicChanged: (callback) => {
    const handler = (_e: unknown, library: LocalLibrary): void => callback(library)
    ipcRenderer.on('localMusic:changed', handler)
    return () => ipcRenderer.removeListener('localMusic:changed', handler)
  },
  musicTagsEdit: (changes) => ipcRenderer.invoke('musicTags:edit', changes),
  musicTagsFillFromNames: (paths) => ipcRenderer.invoke('musicTags:fillFromNames', paths),
  musicTagsSetCover: (paths, source) => ipcRenderer.invoke('musicTags:setCover', paths, source),
  musicTagsFindCovers: (artist, album) => ipcRenderer.invoke('musicTags:findCovers', artist, album),
  musicTagsChooseImage: () => ipcRenderer.invoke('musicTags:chooseImage'),
  localMusicImport: (files) => ipcRenderer.invoke('localMusic:import', files),
  localMusicChooseImport: () => ipcRenderer.invoke('localMusic:chooseImport'),
  localMusicMove: (moves) => ipcRenderer.invoke('localMusic:move', moves),
  localMusicTrash: (paths) => ipcRenderer.invoke('localMusic:trash', paths),
  localMusicQuality: (paths) => ipcRenderer.invoke('localMusic:quality', paths),
  musicLinkSave: (link, known) => ipcRenderer.invoke('musicLink:save', link, known),
  musicLinkCancel: (id) => ipcRenderer.invoke('musicLink:cancel', id),
  onMusicLinkProgress: (callback) => {
    const handler = (_e: unknown, p: MusicLinkProgress): void => callback(p)
    ipcRenderer.on('musicLink:progress', handler)
    return () => ipcRenderer.removeListener('musicLink:progress', handler)
  },
  musicDataGet: () => ipcRenderer.invoke('musicData:get'),
  songSearch: (query) => ipcRenderer.invoke('songSearch:search', query),
  songDiscover: (seeds) => ipcRenderer.invoke('songSearch:discover', seeds),
  spotifyList: (link) => ipcRenderer.invoke('songSearch:spotifyList', link),
  songYouTube: (artist, title) => ipcRenderer.invoke('songSearch:youtube', artist, title),
  musicDataEdit: (edits) => ipcRenderer.invoke('musicData:edit', edits),
  onMusicDataChanged: (callback) => {
    const handler = (_e: unknown, data: MusicData): void => callback(data)
    ipcRenderer.on('musicData:changed', handler)
    return () => ipcRenderer.removeListener('musicData:changed', handler)
  },
  openPopout: () => ipcRenderer.invoke('popout:open'),
  popoutSources: () => ipcRenderer.invoke('popout:sources'),
  popoutState: () => ipcRenderer.invoke('popout:state'),
  popoutHint: () => ipcRenderer.invoke('popout:hint'),
  onPopoutHint: (callback) => {
    const handler = (_e: Electron.IpcRendererEvent, hint: string): void => callback(hint)
    ipcRenderer.on('popout:hint', handler)
    return () => ipcRenderer.removeListener('popout:hint', handler)
  },
  fitPopout: (aspect) => ipcRenderer.invoke('popout:fit', aspect),
  popoutPicker: () => ipcRenderer.invoke('popout:picker'),
  setPopoutOpacity: (opacity) => ipcRenderer.invoke('popout:opacity', opacity),
  minimizePopout: () => ipcRenderer.invoke('popout:minimize'),
  closePopout: () => ipcRenderer.invoke('popout:close'),
  setMusicMini: (open) => ipcRenderer.invoke('musicMini:set', open),
  isMusicMiniOpen: () => ipcRenderer.invoke('musicMini:isOpen'),
  musicMiniWasOpen: () => ipcRenderer.invoke('musicMini:wasOpen'),
  onMusicMiniOpen: (callback) => {
    const handler = (_e: unknown, open: boolean): void => callback(open)
    ipcRenderer.on('musicMini:open', handler)
    return () => ipcRenderer.removeListener('musicMini:open', handler)
  },
  pushMusicMini: (state) => ipcRenderer.send('musicMini:push', state),
  musicMiniLast: () => ipcRenderer.invoke('musicMini:last'),
  onMusicMiniState: (callback) => {
    const handler = (_e: unknown, state: MusicMiniState): void => callback(state)
    ipcRenderer.on('musicMini:state', handler)
    return () => ipcRenderer.removeListener('musicMini:state', handler)
  },
  sendMusicMiniCommand: (command) => ipcRenderer.send('musicMini:command', command),
  onMusicMiniCommand: (callback) => {
    const handler = (_e: unknown, command: MusicMiniCommand): void => callback(command)
    ipcRenderer.on('musicMini:command', handler)
    return () => ipcRenderer.removeListener('musicMini:command', handler)
  },
  musicMiniLayout: () => ipcRenderer.invoke('musicMini:layout'),
  musicRemoteStatus: () => ipcRenderer.invoke('musicRemote:status'),
  setMusicRemote: (on, fresh) => ipcRenderer.invoke('musicRemote:set', on, fresh),
  claudeDesktopStatus: () => ipcRenderer.invoke('claude:status'),
  setClaudeDesktop: (on) => ipcRenderer.invoke('claude:set', on),
  setClaudeArea: (area, on) => ipcRenderer.invoke('claude:setArea', area, on),
  connectClaudeDesktop: () => ipcRenderer.invoke('claude:connect'),
  disconnectClaudeDesktop: () => ipcRenderer.invoke('claude:disconnect'),
  newClaudeDesktopToken: () => ipcRenderer.invoke('claude:newToken'),
  onClaudeAsk: (callback) => {
    const handler = (_e: unknown, ask: { id: number; name: string; args: Record<string, unknown> }): void => callback(ask)
    ipcRenderer.on('claude:ask', handler)
    return () => ipcRenderer.removeListener('claude:ask', handler)
  },
  claudeAnswer: (id, ok, value) => ipcRenderer.send('claude:answer', id, ok, value),
  localMusicLyrics: (path) => ipcRenderer.invoke('localMusic:lyrics', path),
  localMusicSaveLyrics: (path, text) => ipcRenderer.invoke('localMusic:saveLyrics', path, text),
  setMusicMiniLayout: (layout) => ipcRenderer.invoke('musicMini:setLayout', layout),
  onMusicMiniLayout: (callback) => {
    const handler = (_e: unknown, layout: MusicMiniLayout): void => callback(layout)
    ipcRenderer.on('musicMini:layout', handler)
    return () => ipcRenderer.removeListener('musicMini:layout', handler)
  },
  pushMusicMiniLevels: (levels) => ipcRenderer.send('musicMini:levels', levels),
  onMusicMiniLevels: (callback) => {
    const handler = (_e: unknown, levels: number[]): void => callback(levels)
    ipcRenderer.on('musicMini:levels', handler)
    return () => ipcRenderer.removeListener('musicMini:levels', handler)
  },
  musicTransfer: (deviceId) => ipcRenderer.invoke('music:transfer', deviceId),
  musicOpen: (what) => ipcRenderer.invoke('music:open', what),
  songIdStatus: () => ipcRenderer.invoke('songId:status'),
  songIdSetKey: (key) => ipcRenderer.invoke('songId:setKey', key),
  songIdIdentify: (clip) => ipcRenderer.invoke('songId:identify', clip),
  onSongIdListen: (callback) => on<void>('songId:listen', () => callback()),
  aiStatus: () => ipcRenderer.invoke('ai:status'),
  aiSetKey: (key) => ipcRenderer.invoke('ai:setKey', key),
  aiClearKey: () => ipcRenderer.invoke('ai:clearKey'),
  aiSummarise: (title, text) => ipcRenderer.invoke('ai:summarise', title, text),
  aiTidy: (text, kind) => ipcRenderer.invoke('ai:tidy', text, kind),
  aiInterpret: (text, context) => ipcRenderer.invoke('ai:interpret', text, context),
  aiAsk: (question, notes, history, extra, engine) => ipcRenderer.invoke('ai:ask', question, notes, history, extra, engine),
  aiEmailContext: (question, engine) => ipcRenderer.invoke('ai:emailContext', question, engine),
  aiSetEngine: (use) => ipcRenderer.invoke('ai:setEngine', use),
  aiSortMoney: (rows, categories) => ipcRenderer.invoke('ai:sortMoney', rows, categories),
  aiMeaning: (word, sentence) => ipcRenderer.invoke('ai:meaning', word, sentence),
  aiSuggest: (title, before) => ipcRenderer.invoke('ai:suggest', title, before),
  transcriberState: () => ipcRenderer.invoke('transcribe:state'),
  transcriberSetup: (model) => ipcRenderer.invoke('transcribe:setup', model),
  transcriberRemove: () => ipcRenderer.invoke('transcribe:remove'),
  transcribe: (path) => ipcRenderer.invoke('transcribe:run', path),
  transcribeCancel: () => ipcRenderer.invoke('transcribe:cancel'),
  transcribeExport: (req) => ipcRenderer.invoke('transcribe:export', req),
  transcribeShowExport: (dir) => ipcRenderer.invoke('transcribe:showExport', dir),
  transcribeReadCues: (path) => ipcRenderer.invoke('transcribe:readCues', path),
  onTranscriberState: (callback) => on('transcribe:state', callback),
  onTranscribeProgress: (callback) => on('transcribe:progress', callback),
  localAiState: () => ipcRenderer.invoke('localAi:state'),
  localAiInstall: (model) => ipcRenderer.invoke('localAi:install', model),
  localAiCancel: () => ipcRenderer.invoke('localAi:cancel'),
  localAiRemove: () => ipcRenderer.invoke('localAi:remove'),
  localAiUnload: () => ipcRenderer.invoke('localAi:unload'),
  localAiSetUnloadForGames: (on) => ipcRenderer.invoke('localAi:setUnloadForGames', on),
  onLocalAiState: (callback) => {
    const handler = (_e: Electron.IpcRendererEvent, state: LocalAiState): void => callback(state)
    ipcRenderer.on('localAi:state', handler)
    return () => ipcRenderer.removeListener('localAi:state', handler)
  },
  gamesList: (rescan) => ipcRenderer.invoke('games:list', rescan),
  gamesPlay: (id) => ipcRenderer.invoke('games:play', id),
  gamesLaunchArt: (id) => ipcRenderer.invoke('games:launchArt', id),
  gamesSetHidden: (id, hidden) => ipcRenderer.invoke('games:setHidden', id, hidden),
  gamesAdd: () => ipcRenderer.invoke('games:add'),
  gamesRemove: (id) => ipcRenderer.invoke('games:remove', id),
  gamesReveal: (id) => ipcRenderer.invoke('games:reveal', id),
  gamesCoversStatus: () => ipcRenderer.invoke('games:coversStatus'),
  gamesSetCoversKey: (key) => ipcRenderer.invoke('games:setCoversKey', key),
  gamesClearCoversKey: () => ipcRenderer.invoke('games:clearCoversKey'),
  gamesCovers: (ids) => ipcRenderer.invoke('games:covers', ids),
  onGamesChanged: (callback) => {
    const handler = (): void => callback()
    ipcRenderer.on('games:changed', handler)
    return () => ipcRenderer.removeListener('games:changed', handler)
  },
  skyblockStatus: () => ipcRenderer.invoke('skyblock:status'),
  skyblockSessions: () => ipcRenderer.invoke('skyblock:sessions'),
  skyblockSetup: (input) => ipcRenderer.invoke('skyblock:setup', input),
  skyblockSetProfile: (id) => ipcRenderer.invoke('skyblock:setProfile', id),
  skyblockSetLog: (readLog, folder) => ipcRenderer.invoke('skyblock:setLog', readLog, folder),
  skyblockPickLogFolder: () => ipcRenderer.invoke('skyblock:pickLogFolder'),
  skyblockForget: () => ipcRenderer.invoke('skyblock:forget'),
  skyblockStartNow: () => ipcRenderer.invoke('skyblock:startNow'),
  skyblockEndNow: () => ipcRenderer.invoke('skyblock:endNow'),
  skyblockDeleteSession: (id) => ipcRenderer.invoke('skyblock:deleteSession', id),
  onSkyblockSummary: (callback) => on('skyblock:summary', callback),
  onSkyblockUpdated: (callback) => on('skyblock:updated', callback),
  onSkyblockChanged: (callback) => on<void>('skyblock:changed', () => callback()),
  skyblockSetPersonalKey: (personal) => ipcRenderer.invoke('skyblock:setPersonalKey', personal),
  skyblockGoalsState: (page) => ipcRenderer.invoke('skyblockGoals:state', page),
  skyblockGoalsDownload: () => ipcRenderer.invoke('skyblockGoals:download'),
  skyblockProfileView: () => ipcRenderer.invoke('skyblockProfile:view'),
  skyblockProfilePage: () => ipcRenderer.invoke('skyblockProfile:page'),
  skyblockProfileChoose: (id) => ipcRenderer.invoke('skyblockProfile:choose', id),
  skyblockProfileSeen: (id) => ipcRenderer.invoke('skyblockProfile:seen', id),
  skyblockPlayersLookup: (who, profileId, fresh) => ipcRenderer.invoke('skyblockPlayers:lookup', who, profileId, fresh),
  skyblockPlayersList: () => ipcRenderer.invoke('skyblockPlayers:list'),
  skyblockPlayersStar: (uuid, on) => ipcRenderer.invoke('skyblockPlayers:star', uuid, on),
  skyblockPlayersForget: (uuid) => ipcRenderer.invoke('skyblockPlayers:forget', uuid),
  skyblockPlayersRefreshStarred: () => ipcRenderer.invoke('skyblockPlayers:refreshStarred'),
  skyblockHelpers: () => ipcRenderer.invoke('skyblockHelpers:get'),
  skyblockCalendar: () => ipcRenderer.invoke('skyblock:calendar'),
  skyblockGoalsRefresh: () => ipcRenderer.invoke('skyblockGoals:refresh'),
  skyblockGoalsSearch: (query) => ipcRenderer.invoke('skyblockGoals:search', query),
  skyblockGoalsAdd: (id, amount) => ipcRenderer.invoke('skyblockGoals:add', id, amount),
  skyblockGoalsUpdate: (id, change) => ipcRenderer.invoke('skyblockGoals:update', id, change),
  skyblockGoalsRemove: (id) => ipcRenderer.invoke('skyblockGoals:remove', id),
  onSkyblockGoalsChanged: (callback) => on<void>('skyblockGoals:changed', () => callback()),
  skyblockAddonState: () => ipcRenderer.invoke('skyblockAddon:state'),
  skyblockAddonInstall: (packs) => ipcRenderer.invoke('skyblockAddon:install', packs),
  skyblockAddonCancel: () => ipcRenderer.invoke('skyblockAddon:cancel'),
  skyblockAddonRemove: () => ipcRenderer.invoke('skyblockAddon:remove'),
  skyblockAddonPickVanilla: (folder) => ipcRenderer.invoke('skyblockAddon:pickVanilla', folder),
  skyblockAddonClearVanilla: () => ipcRenderer.invoke('skyblockAddon:clearVanilla'),
  skyblockAddonUseVanilla: (path) => ipcRenderer.invoke('skyblockAddon:useVanilla', path),
  skyblockAddonPackFolders: () => ipcRenderer.invoke('skyblockAddon:packFolders'),
  skyblockAddonIcons: () => ipcRenderer.invoke('skyblockAddon:icons'),
  onSkyblockAddonChanged: (callback) => on<void>('skyblockAddon:changed', () => callback()),
  terminalStart: (id, folder, cols, rows) => ipcRenderer.invoke('term:start', id, folder, cols, rows),
  terminalStop: (id) => ipcRenderer.invoke('term:stop', id),
  terminalInput: (id, data) => ipcRenderer.send('term:input', id, data),
  terminalResize: (id, cols, rows) => ipcRenderer.send('term:resize', id, cols, rows),
  onTerminalData: (callback) => {
    const handler = (_e: unknown, id: string, data: string): void => callback(id, data)
    ipcRenderer.on('term:data', handler)
    return () => ipcRenderer.removeListener('term:data', handler)
  },
  onTerminalExit: (callback) => {
    const handler = (_e: unknown, id: string, code: number): void => callback(id, code)
    ipcRenderer.on('term:exit', handler)
    return () => ipcRenderer.removeListener('term:exit', handler)
  },
  terminalPickFolder: () => ipcRenderer.invoke('term:pickFolder'),
  terminalHome: () => ipcRenderer.invoke('term:home'),
  terminalOpenIn: (folder, where) => ipcRenderer.invoke('term:openIn', folder, where),
  appsGithubStatus: () => ipcRenderer.invoke('apps:githubStatus'),
  appsIsTestCopy: () => ipcRenderer.invoke('apps:isTestCopy'),
  appsSetToken: (token) => ipcRenderer.invoke('apps:setToken', token),
  appsClearToken: () => ipcRenderer.invoke('apps:clearToken'),
  appsInfo: (folder) => ipcRenderer.invoke('apps:info', folder),
  appsPulls: (repos) => ipcRenderer.invoke('apps:pulls', repos),
  appsReleases: (repo) => ipcRenderer.invoke('apps:releases', repo),
  appsMerged: (repo, since) => ipcRenderer.invoke('apps:merged', repo, since),
  appsSetReleaseNotes: (repo, tag, body, title) => ipcRenderer.invoke('apps:setReleaseNotes', repo, tag, body, title),
  aiWhatsNew: (source) => ipcRenderer.invoke('ai:whatsNew', source),
  appsCopies: (folder) => ipcRenderer.invoke('apps:copies', folder),
  appsAddCopy: (folder, branch) => ipcRenderer.invoke('apps:addCopy', folder, branch),
  appsRemoveCopy: (folder, path) => ipcRenderer.invoke('apps:removeCopy', folder, path),
  appsPullStates: (repo, numbers) => ipcRenderer.invoke('apps:pullStates', repo, numbers),
  appsFetchImage: (url) => ipcRenderer.invoke('apps:fetchImage', url),
  appsSetPrerelease: (repo, tag, prerelease) => ipcRenderer.invoke('apps:setPrerelease', repo, tag, prerelease),
  appsCreateApp: (req) => ipcRenderer.invoke('apps:createApp', req),
  appsIssues: (repo) => ipcRenderer.invoke('apps:issues', repo),
  appsCloseIssue: (repo, number, comment) => ipcRenderer.invoke('apps:closeIssue', repo, number, comment),
  appsHealth: (folder) => ipcRenderer.invoke('apps:health', folder),
  appsPreflight: (folder, bump) => ipcRenderer.invoke('apps:preflight', folder, bump),
  appsReleaseTests: (folder) => ipcRenderer.invoke('apps:releaseTests', folder),
  appsRelease: (folder, bump, expected) => ipcRenderer.invoke('apps:release', folder, bump, expected),
  appsReleaseFix: (folder, fix, tag) => ipcRenderer.invoke('apps:releaseFix', folder, fix, tag),
  appsMainStatus: (folder) => ipcRenderer.invoke('apps:mainStatus', folder),
  appsGetLatestMain: (folder) => ipcRenderer.invoke('apps:getLatestMain', folder),
  onLatestMainStep: (callback) => on('apps:latestMainStep', callback),
  appsWriteNotes: (folder, version, items) => ipcRenderer.invoke('apps:writeNotes', folder, version, items),
  appsBuildStatus: (folder, repo, tag) => ipcRenderer.invoke('apps:buildStatus', folder, repo, tag),
  appsRerunBuild: (repo, runId) => ipcRenderer.invoke('apps:rerunBuild', repo, runId),
  appsOpenDeveloperSettings: () => ipcRenderer.invoke('apps:openDeveloperSettings'),
  appsMerge: (repo, number) => ipcRenderer.invoke('apps:merge', repo, number),
  appsClose: (repo, number) => ipcRenderer.invoke('apps:close', repo, number),
  aiChat: (messages, engine) => ipcRenderer.invoke('ai:chat', messages, engine),
  aiLoadChats: () => ipcRenderer.invoke('ai:loadChats'),
  aiSaveChats: (chats) => ipcRenderer.invoke('ai:saveChats', chats),
  readHandwriting: (png, reader) => ipcRenderer.invoke('handwriting:read', png, reader),
  getVault: () => ipcRenderer.invoke('vault:get'),
  pickVault: () => ipcRenderer.invoke('vault:pick'),
  closeVault: () => ipcRenderer.invoke('vault:close'),
  revealVault: () => ipcRenderer.invoke('vault:reveal'),

  listTree: () => ipcRenderer.invoke('fs:tree'),
  createNote: (folder) => ipcRenderer.invoke('fs:createNote', folder),
  createNoteAt: (path) => ipcRenderer.invoke('fs:createNoteAt', path),
  createBoard: (folder) => ipcRenderer.invoke('fs:createBoard', folder),
  readAllNotes: () => ipcRenderer.invoke('fs:readAll'),
  createFolder: (folder) => ipcRenderer.invoke('fs:createFolder', folder),
  rename: (path, newName) => ipcRenderer.invoke('fs:rename', path, newName),
  move: (path, folder) => ipcRenderer.invoke('fs:move', path, folder),
  trash: (path) => ipcRenderer.invoke('fs:trash', path),
  trashMany: (paths) => ipcRenderer.invoke('fs:trashMany', paths),
  reveal: (path) => ipcRenderer.invoke('fs:reveal', path),
  phoneShareFile: (path) => ipcRenderer.invoke('phone:shareFile', path),
  phoneShareLink: (url) => ipcRenderer.invoke('phone:shareLink', url),
  phoneStop: (token) => ipcRenderer.invoke('phone:stop', token),
  onPhoneDelivered: (callback) => {
    const handler = (_e: unknown, token: string): void => callback(token)
    ipcRenderer.on('phone:delivered', handler)
    return () => ipcRenderer.removeListener('phone:delivered', handler)
  },
  phonePair: (fresh) => ipcRenderer.invoke('phone:pair', fresh),
  phoneForget: () => ipcRenderer.invoke('phone:forget'),
  onPhoneEvent: (callback) => {
    const handler = (_e: unknown, event: Parameters<typeof callback>[0]): void => callback(event)
    ipcRenderer.on('phone:event', handler)
    return () => ipcRenderer.removeListener('phone:event', handler)
  },
  phoneWifi: () => ipcRenderer.invoke('phone:wifi'),
  shareStatus: () => ipcRenderer.invoke('share:status'),
  shareSet: (patch) => ipcRenderer.invoke('share:set', patch),
  onShareStatus: (callback) => on('share:status', callback),
  sharePair: (target) => ipcRenderer.invoke('share:pair', target),
  shareConfirmPairing: () => ipcRenderer.invoke('share:confirmPairing'),
  shareCancelPairing: () => ipcRenderer.invoke('share:cancelPairing'),
  shareUnpair: () => ipcRenderer.invoke('share:unpair'),
  shareAskAccessibility: () => ipcRenderer.invoke('share:askAccessibility'),
  shareResetAccessibility: () => ipcRenderer.invoke('share:resetAccessibility'),
  shareSendFiles: (paths) => ipcRenderer.invoke('share:sendFiles', paths),
  onShareReceived: (callback) => on('share:received', callback),
  onShareOpenSettings: (callback) => on('share:openSettings', callback),
  shareInput: (event) => ipcRenderer.send('share:input', event),
  shareComeBack: () => ipcRenderer.send('share:comeBack'),
  onShareCapture: (callback) => on('share:capture', callback),
  shareDropped: (paths) => ipcRenderer.send('share:dropped', paths),
  shareDropCancel: () => ipcRenderer.send('share:dropCancel'),
  onShareDrop: (callback) => on('share:drop', callback),
  screenStatus: () => ipcRenderer.invoke('screen:status'),
  onScreenStatus: (callback) => on('screen:status', callback),
  screenStart: (mode) => ipcRenderer.invoke('screen:start', mode),
  screenStop: () => ipcRenderer.invoke('screen:stop'),
  screenSetDisplay: (id) => ipcRenderer.invoke('screen:setDisplay', id),
  screenInstallVirtual: () => ipcRenderer.invoke('screen:installVirtual'),
  screenReady: () => ipcRenderer.invoke('screen:ready'),
  screenSignal: (data) => ipcRenderer.send('screen:signal', data),
  onScreenSignal: (callback) => on('screen:signal', callback),
  screenLive: () => ipcRenderer.send('screen:live'),
  screenInput: (input) => ipcRenderer.send('screen:input', input),
  screenFailed: (reason) => ipcRenderer.send('screen:failed', reason),
  screenClose: () => ipcRenderer.send('screen:close'),
  screenFullscreen: () => ipcRenderer.send('screen:fullscreen'),
  dropTargets: () => ipcRenderer.invoke('drop:targets'),
  onDropTargets: (callback) => on('drop:targets', callback),
  dropSend: (target, paths) => ipcRenderer.invoke('drop:send', target, paths),
  fileSendState: () => ipcRenderer.invoke('fsend:state'),
  onFileSendState: (callback) => on('fsend:state', callback),
  fileSendSetServer: (address) => ipcRenderer.invoke('fsend:setServer', address),
  fileSendSetUp: (token) => ipcRenderer.invoke('fsend:setUp', token),
  fileSendRelayOn: (keyId, apiToken) => ipcRenderer.invoke('fsend:relayOn', keyId, apiToken),
  fileSendOpen: (page) => ipcRenderer.invoke('fsend:open', page),
  fileSendPick: (kind) => ipcRenderer.invoke('fsend:pick', kind),
  fileSendStart: (paths) => ipcRenderer.invoke('fsend:send', paths),
  fileSendReceive: (code) => ipcRenderer.invoke('fsend:receive', code),
  fileSendAccept: (id, chooseFolder) => ipcRenderer.invoke('fsend:accept', id, chooseFolder),
  fileSendCancel: (id) => ipcRenderer.invoke('fsend:cancel', id),
  fileSendForget: (id) => ipcRenderer.invoke('fsend:forget', id),
  fileSendResume: (id) => ipcRenderer.invoke('fsend:resume', id),
  fileSendReveal: (id) => ipcRenderer.invoke('fsend:reveal', id),
  fileSendDrive: (paths) => ipcRenderer.invoke('fsend:drive', paths),
  fileSendDriveConnect: () => ipcRenderer.invoke('fsend:driveConnect'),
  fileSendDriveRemove: (id) => ipcRenderer.invoke('fsend:driveRemove', id),
  fileSendDriveForget: (id) => ipcRenderer.invoke('fsend:driveForget', id),
  onFileSendEvent: (callback) => on('fsend:event', callback),
  fileSendSignal: (id, signal) => ipcRenderer.invoke('fsend:signal', id, signal),
  fileSendUpdate: (id, patch) => ipcRenderer.invoke('fsend:update', id, patch),
  fileSendManifest: (id) => ipcRenderer.invoke('fsend:manifest', id),
  fileSendGotManifest: (id, manifest) => ipcRenderer.invoke('fsend:gotManifest', id, manifest),
  fileSendStarted: (id, pos) => ipcRenderer.invoke('fsend:started', id, pos),
  fileSendDeclined: (id) => ipcRenderer.invoke('fsend:declined', id),
  fileSendRead: (id, index, offset, length) => ipcRenderer.invoke('fsend:read', id, index, offset, length),
  fileSendWrite: (id, data) => ipcRenderer.invoke('fsend:write', id, data),
  camStatus: () => ipcRenderer.invoke('cam:status'),
  camOn: () => ipcRenderer.invoke('cam:on'),
  camOff: () => ipcRenderer.invoke('cam:off'),
  camRetry: () => ipcRenderer.invoke('cam:retry'),
  camSet: (patch) => ipcRenderer.invoke('cam:set', patch),
  camNewLink: () => ipcRenderer.invoke('cam:newLink'),
  camPreview: (on) => ipcRenderer.invoke('cam:preview', on),
  onCamStatus: (callback) => {
    const handler = (_e: unknown, status: Parameters<typeof callback>[0]): void => callback(status)
    ipcRenderer.on('cam:status', handler)
    return () => ipcRenderer.removeListener('cam:status', handler)
  },
  onCamFrame: (callback) => {
    const handler = (_e: unknown, jpeg: Uint8Array): void => callback(jpeg)
    ipcRenderer.on('cam:frame', handler)
    return () => ipcRenderer.removeListener('cam:frame', handler)
  },
  phoneSetDeck: (buttons) => ipcRenderer.invoke('phone:setDeck', buttons),
  phoneSetScreen: (screen) => ipcRenderer.invoke('phone:setScreen', screen),
  phoneNotify: (title, body) => ipcRenderer.invoke('phone:notify', title, body),
  readAppData: (name) => ipcRenderer.invoke('vault:readAppData', name),
  writeAppData: (name, content) => ipcRenderer.invoke('vault:writeAppData', name, content),
  readSafeFile: (id) => ipcRenderer.invoke('safe:read', id),
  writeSafeFile: (id, data) => ipcRenderer.invoke('safe:write', id, data),
  removeSafeFile: (id) => ipcRenderer.invoke('safe:remove', id),
  pickSafeFiles: () => ipcRenderer.invoke('safe:pick'),
  trashSafeOriginals: (paths) => ipcRenderer.invoke('safe:trashOriginals', paths),
  saveSafeCopy: (name, data) => ipcRenderer.invoke('safe:saveCopy', name, data),
  writeSketch: (path, svg) => ipcRenderer.invoke('fs:writeSketch', path, svg),
  writePicture: (path, data) => ipcRenderer.invoke('fs:writePicture', path, data),
  writeSheet: (path, data) => ipcRenderer.invoke('fs:writeSheet', path, data),
  saveAttachment: (folder, name, data) => ipcRenderer.invoke('fs:saveAttachment', folder, name, data),
  pickAttachment: (folder, imagesOnly) => ipcRenderer.invoke('fs:pickAttachment', folder, imagesOnly),
  attachFromComputer: (folder, source) => ipcRenderer.invoke('fs:attachFromComputer', folder, source),
  explorerPlaces: () => ipcRenderer.invoke('explorer:places'),
  explorerDriveSpace: () => ipcRenderer.invoke('explorer:driveSpace'),
  explorerList: (dir) => ipcRenderer.invoke('explorer:list', dir),
  explorerReadText: (path) => ipcRenderer.invoke('explorer:readText', path),
  explorerOpen: (path, ask) => ipcRenderer.invoke('explorer:open', path, ask),
  explorerReveal: (path) => ipcRenderer.invoke('explorer:reveal', path),
  explorerCreate: (dir, name, kind) => ipcRenderer.invoke('explorer:create', dir, name, kind),
  explorerRename: (path, name) => ipcRenderer.invoke('explorer:rename', path, name),
  explorerPaste: (paths, dir, mode) => ipcRenderer.invoke('explorer:paste', paths, dir, mode),
  explorerTrash: (paths) => ipcRenderer.invoke('explorer:trash', paths),
  explorerSearch: (dir, query, showHidden) => ipcRenderer.invoke('explorer:search', dir, query, showHidden),
  explorerSearchPc: (query, showHidden) => ipcRenderer.invoke('explorer:searchPc', query, showHidden),
  explorerIndexStatus: () => ipcRenderer.invoke('explorer:indexStatus'),
  onExplorerIndexStatus: (callback) => {
    const handler = (_e: unknown, status: Parameters<typeof callback>[0]): void => callback(status)
    ipcRenderer.on('explorer:indexStatus', handler)
    return () => ipcRenderer.removeListener('explorer:indexStatus', handler)
  },
  explorerFolderSizes: (paths, fresh) => ipcRenderer.invoke('explorer:folderSizes', paths, fresh),
  onExplorerFolderSize: (callback) => {
    const handler = (_e: unknown, ev: Parameters<typeof callback>[0]): void => callback(ev)
    ipcRenderer.on('explorer:folderSize', handler)
    return () => ipcRenderer.removeListener('explorer:folderSize', handler)
  },
  explorerReindex: () => ipcRenderer.invoke('explorer:reindex'),
  explorerTagged: (colour) => ipcRenderer.invoke('explorer:tagged', colour),
  binList: () => ipcRenderer.invoke('bin:list'),
  binRestore: (ids) => ipcRenderer.invoke('bin:restore', ids),
  binDelete: (ids) => ipcRenderer.invoke('bin:delete', ids),
  binEmpty: () => ipcRenderer.invoke('bin:empty'),
  binOpenSystem: () => ipcRenderer.invoke('bin:openSystem'),
  binMacPrivacy: () => ipcRenderer.invoke('bin:macPrivacy'),
  tagsGet: () => ipcRenderer.invoke('tags:get'),
  tagsSet: (paths, colour, on) => ipcRenderer.invoke('tags:set', paths, colour, on),
  tagsLabel: (colour, label) => ipcRenderer.invoke('tags:label', colour, label),
  tagsFavourites: (paths) => ipcRenderer.invoke('tags:favourites', paths),
  onTagsChanged: (callback) => {
    const handler = (_e: unknown, store: Parameters<typeof callback>[0]): void => callback(store)
    ipcRenderer.on('tags:changed', handler)
    return () => ipcRenderer.removeListener('tags:changed', handler)
  },
  explorerToVault: (paths, folder) => ipcRenderer.invoke('explorer:toVault', paths, folder),
  explorerStartDrag: (paths) => ipcRenderer.send('explorer:startDrag', paths),
  explorerArchiveList: (path, password) => ipcRenderer.invoke('explorer:archiveList', path, password),
  explorerExtract: (path, opts) => ipcRenderer.invoke('explorer:extract', path, opts),
  explorerCompress: (paths, format, password) => ipcRenderer.invoke('explorer:compress', paths, format, password),
  openFile: (path, ask) => ipcRenderer.invoke('fs:openFile', path, ask),
  readNote: (path) => ipcRenderer.invoke('fs:read', path),
  writeNote: (path, content) => ipcRenderer.invoke('fs:write', path, content),
  readTextFile: (path) => ipcRenderer.invoke('fs:readTextFile', path),

  onVaultChanged: (callback) => {
    const handler = (_e: unknown, paths: string[]): void => callback(paths)
    ipcRenderer.on('vault:changed', handler)
    return () => ipcRenderer.removeListener('vault:changed', handler)
  },
  onBeforeClose: (callback) => {
    const handler = (): void => callback()
    ipcRenderer.on('app:before-close', handler)
    return () => ipcRenderer.removeListener('app:before-close', handler)
  },
  readyToClose: () => ipcRenderer.invoke('app:ready-to-close'),
  undoHold: (paths, inVault) => ipcRenderer.invoke('undo:hold', paths, inVault),
  undoHeld: (paths, inVault) => ipcRenderer.invoke('undo:held', paths, inVault),
  undoRestore: (paths, inVault) => ipcRenderer.invoke('undo:restore', paths, inVault),
  undoRelease: (paths, inVault) => ipcRenderer.invoke('undo:release', paths, inVault),
  videoBinKeep: (folder, id) => ipcRenderer.invoke('videoBin:keep', folder, id),
  videoBinRestore: (id, folder) => ipcRenderer.invoke('videoBin:restore', id, folder),
  videoBinDrop: (id) => ipcRenderer.invoke('videoBin:drop', id),
  undoMoveBack: (items) => ipcRenderer.invoke('undo:moveBack', items),
  onEditCommand: (callback) => {
    const handler = (_e: unknown, which: 'undo' | 'redo'): void => callback(which)
    ipcRenderer.on('edit:command', handler)
    return () => ipcRenderer.removeListener('edit:command', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
