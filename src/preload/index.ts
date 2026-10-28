import { contextBridge, ipcRenderer } from 'electron'
import type { MusicMiniCommand, MusicMiniState, NotesApi } from '@shared/types'

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
  openYouTube: (url) => ipcRenderer.invoke('youtube:open', url),
  youTubeState: () => ipcRenderer.invoke('youtube:state'),
  rememberYouTube: (url) => ipcRenderer.invoke('youtube:remember', url),
  pinYouTube: (on) => ipcRenderer.invoke('youtube:pin', on),
  setYouTubeVideoOnly: (on) => ipcRenderer.invoke('youtube:videoOnly', on),
  minimizeYouTube: () => ipcRenderer.invoke('youtube:minimize'),
  closeYouTube: () => ipcRenderer.invoke('youtube:close'),
  onYouTubeLoad: (callback) => {
    const handler = (_e: unknown, url: string): void => callback(url)
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
  musicAddToPlaylist: (uri, songs) => ipcRenderer.invoke('music:addToPlaylist', uri, songs),
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
  aiAsk: (question, notes, history) => ipcRenderer.invoke('ai:ask', question, notes, history),
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
  readAppData: (name) => ipcRenderer.invoke('vault:readAppData', name),
  writeAppData: (name, content) => ipcRenderer.invoke('vault:writeAppData', name, content),
  writeSketch: (path, svg) => ipcRenderer.invoke('fs:writeSketch', path, svg),
  writeSheet: (path, data) => ipcRenderer.invoke('fs:writeSheet', path, data),
  saveAttachment: (folder, name, data) => ipcRenderer.invoke('fs:saveAttachment', folder, name, data),
  pickAttachment: (folder, imagesOnly) => ipcRenderer.invoke('fs:pickAttachment', folder, imagesOnly),
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
  readyToClose: () => ipcRenderer.invoke('app:ready-to-close')
}

contextBridge.exposeInMainWorld('api', api)
