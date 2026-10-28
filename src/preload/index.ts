import { contextBridge, ipcRenderer } from 'electron'
import type { NotesApi } from '@shared/types'

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
  aiStatus: () => ipcRenderer.invoke('ai:status'),
  aiSetKey: (key) => ipcRenderer.invoke('ai:setKey', key),
  aiClearKey: () => ipcRenderer.invoke('ai:clearKey'),
  aiSummarise: (title, text) => ipcRenderer.invoke('ai:summarise', title, text),
  aiTidy: (text, kind) => ipcRenderer.invoke('ai:tidy', text, kind),
  aiAsk: (question, notes, history) => ipcRenderer.invoke('ai:ask', question, notes, history),
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
  readAppData: (name) => ipcRenderer.invoke('vault:readAppData', name),
  writeAppData: (name, content) => ipcRenderer.invoke('vault:writeAppData', name, content),
  writeSketch: (path, svg) => ipcRenderer.invoke('fs:writeSketch', path, svg),
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
