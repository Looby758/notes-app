import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { MusicMiniCommand, MusicMiniState, NotesApi } from '@shared/types'

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
  studioStart: (folder, ext) => ipcRenderer.invoke('studio:start', folder, ext),
  studioChunk: (id, data) => ipcRenderer.invoke('studio:chunk', id, data),
  studioStop: (id) => ipcRenderer.invoke('studio:stop', id),
  studioReveal: (path) => ipcRenderer.invoke('studio:reveal', path),
  studioOpenFolder: (folder) => ipcRenderer.invoke('studio:openFolder', folder),
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
    const handler = (_e: unknown, url: string): void => callback(url)
    ipcRenderer.on('web:open', handler)
    return () => ipcRenderer.removeListener('web:open', handler)
  },
  onWebShortcut: (callback) => {
    const handler = (_e: unknown, shortcut: string): void => callback(shortcut)
    ipcRenderer.on('web:shortcut', handler)
    return () => ipcRenderer.removeListener('web:shortcut', handler)
  },
  openYouTube: (url, seconds) => ipcRenderer.invoke('youtube:open', url, seconds),
  youTubeState: () => ipcRenderer.invoke('youtube:state'),
  rememberYouTube: (url) => ipcRenderer.invoke('youtube:remember', url),
  pinYouTube: (on) => ipcRenderer.invoke('youtube:pin', on),
  setYouTubeVideoOnly: (on) => ipcRenderer.invoke('youtube:videoOnly', on),
  minimizeYouTube: () => ipcRenderer.invoke('youtube:minimize'),
  closeYouTube: () => ipcRenderer.invoke('youtube:close'),
  onYouTubeLoad: (callback) => {
    const handler = (_e: unknown, url: string, seconds?: number): void => callback(url, Number(seconds) || 0)
    ipcRenderer.on('youtube:load', handler)
    return () => ipcRenderer.removeListener('youtube:load', handler)
  },
  pickImport: (kind, extensions) => ipcRenderer.invoke('import:pick', kind, extensions),
  listImport: (root) => ipcRenderer.invoke('import:list', root),
  readImport: (path) => ipcRenderer.invoke('import:read', path),
  md5: (data) => ipcRenderer.invoke('import:md5', data),
  appleNotes: () => ipcRenderer.invoke('import:appleNotes'),
  onReminderOpen: (callback) => {
    const handler = (_e: unknown, path: string, line: number): void => callback(path, line)
    ipcRenderer.on('reminder:open', handler)
    return () => ipcRenderer.removeListener('reminder:open', handler)
  },

  updateStatus: () => ipcRenderer.invoke('update:status'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
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
  decodeHeic: (data) => ipcRenderer.invoke('convert:heic', data),
  comicsShelf: () => ipcRenderer.invoke('comics:shelf'),
  comicsAdd: (paths) => ipcRenderer.invoke('comics:add', paths),
  comicsAddFolder: () => ipcRenderer.invoke('comics:addFolder'),
  comicsRemove: (id) => ipcRenderer.invoke('comics:remove', id),
  comicsOpen: (id) => ipcRenderer.invoke('comics:open', id),
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
  stopVideoStream: (session) => ipcRenderer.invoke('video:stop', session),
  videoInVault: (path) => ipcRenderer.invoke('video:inVault', path),
  pickVideoFile: (kind, near) => ipcRenderer.invoke('video:pick', kind, near),

  startSnip: () => ipcRenderer.invoke('snip:start'),
  snipStatus: () => ipcRenderer.invoke('snip:status'),
  snipImage: () => ipcRenderer.invoke('snip:image'),
  snipRead: (png) => ipcRenderer.invoke('snip:read', png),
  snipClose: () => ipcRenderer.invoke('snip:close'),
  snipSend: (action, text) => ipcRenderer.invoke('snip:send', action, text),
  onSnipText: (callback) => {
    const handler = (_e: unknown, action: 'note' | 'ask', text: string): void => callback(action, text)
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
  musicTransfer: (deviceId) => ipcRenderer.invoke('music:transfer', deviceId),
  musicOpen: (what) => ipcRenderer.invoke('music:open', what),
  aiStatus: () => ipcRenderer.invoke('ai:status'),
  aiSetKey: (key) => ipcRenderer.invoke('ai:setKey', key),
  aiClearKey: () => ipcRenderer.invoke('ai:clearKey'),
  aiSummarise: (title, text) => ipcRenderer.invoke('ai:summarise', title, text),
  aiTidy: (text, kind) => ipcRenderer.invoke('ai:tidy', text, kind),
  aiInterpret: (text, context) => ipcRenderer.invoke('ai:interpret', text, context),
  aiAsk: (question, notes, history, extra) => ipcRenderer.invoke('ai:ask', question, notes, history, extra),
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
  terminalStart: (cols, rows) => ipcRenderer.invoke('term:start', cols, rows),
  terminalStop: () => ipcRenderer.invoke('term:stop'),
  terminalInput: (data) => ipcRenderer.send('term:input', data),
  terminalResize: (cols, rows) => ipcRenderer.send('term:resize', cols, rows),
  onTerminalData: (callback) => {
    const handler = (_e: unknown, data: string): void => callback(data)
    ipcRenderer.on('term:data', handler)
    return () => ipcRenderer.removeListener('term:data', handler)
  },
  onTerminalExit: (callback) => {
    const handler = (_e: unknown, code: number): void => callback(code)
    ipcRenderer.on('term:exit', handler)
    return () => ipcRenderer.removeListener('term:exit', handler)
  },
  aiChat: (messages) => ipcRenderer.invoke('ai:chat', messages),
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
  shareSendFiles: (paths) => ipcRenderer.invoke('share:sendFiles', paths),
  onShareReceived: (callback) => on('share:received', callback),
  onShareOpenSettings: (callback) => on('share:openSettings', callback),
  shareInput: (event) => ipcRenderer.send('share:input', event),
  shareComeBack: () => ipcRenderer.send('share:comeBack'),
  onShareCapture: (callback) => on('share:capture', callback),
  shareDropped: (paths) => ipcRenderer.send('share:dropped', paths),
  shareDropCancel: () => ipcRenderer.send('share:dropCancel'),
  onShareDrop: (callback) => on('share:drop', callback),
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
  writeSheet: (path, data) => ipcRenderer.invoke('fs:writeSheet', path, data),
  saveAttachment: (folder, name, data) => ipcRenderer.invoke('fs:saveAttachment', folder, name, data),
  pickAttachment: (folder, imagesOnly) => ipcRenderer.invoke('fs:pickAttachment', folder, imagesOnly),
  attachFromComputer: (folder, source) => ipcRenderer.invoke('fs:attachFromComputer', folder, source),
  explorerPlaces: () => ipcRenderer.invoke('explorer:places'),
  explorerList: (dir) => ipcRenderer.invoke('explorer:list', dir),
  explorerReadText: (path) => ipcRenderer.invoke('explorer:readText', path),
  explorerOpen: (path) => ipcRenderer.invoke('explorer:open', path),
  explorerReveal: (path) => ipcRenderer.invoke('explorer:reveal', path),
  explorerCreate: (dir, name, kind) => ipcRenderer.invoke('explorer:create', dir, name, kind),
  explorerRename: (path, name) => ipcRenderer.invoke('explorer:rename', path, name),
  explorerPaste: (paths, dir, mode) => ipcRenderer.invoke('explorer:paste', paths, dir, mode),
  explorerTrash: (paths) => ipcRenderer.invoke('explorer:trash', paths),
  explorerSearch: (dir, query, showHidden) => ipcRenderer.invoke('explorer:search', dir, query, showHidden),
  explorerToVault: (paths, folder) => ipcRenderer.invoke('explorer:toVault', paths, folder),
  explorerStartDrag: (paths) => ipcRenderer.send('explorer:startDrag', paths),
  openFile: (path) => ipcRenderer.invoke('fs:openFile', path),
  readNote: (path) => ipcRenderer.invoke('fs:read', path),
  writeNote: (path, content) => ipcRenderer.invoke('fs:write', path, content),

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
  undoMoveBack: (items) => ipcRenderer.invoke('undo:moveBack', items),
  onEditCommand: (callback) => {
    const handler = (_e: unknown, which: 'undo' | 'redo'): void => callback(which)
    ipcRenderer.on('edit:command', handler)
    return () => ipcRenderer.removeListener('edit:command', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
