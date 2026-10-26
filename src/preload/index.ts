import { contextBridge, ipcRenderer } from 'electron'
import type { NotesApi } from '@shared/types'

const api: NotesApi = {
  confirm: (options) => ipcRenderer.invoke('app:confirm', options),

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

  openCapture: () => ipcRenderer.invoke('capture:open'),
  closeCapture: () => ipcRenderer.invoke('capture:close'),
  captureStatus: () => ipcRenderer.invoke('capture:status'),
  submitCapture: (text) => ipcRenderer.invoke('capture:submit', text),
  onCaptureReset: (callback) => {
    const handler = (): void => callback()
    ipcRenderer.on('capture:reset', handler)
    return () => ipcRenderer.removeListener('capture:reset', handler)
  },
  onCaptureRequest: (callback) => {
    const handler = (_e: unknown, id: number, text: string): void => callback(id, text)
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
  getVault: () => ipcRenderer.invoke('vault:get'),
  pickVault: () => ipcRenderer.invoke('vault:pick'),
  closeVault: () => ipcRenderer.invoke('vault:close'),
  revealVault: () => ipcRenderer.invoke('vault:reveal'),

  listTree: () => ipcRenderer.invoke('fs:tree'),
  createNote: (folder) => ipcRenderer.invoke('fs:createNote', folder),
  createNoteAt: (path) => ipcRenderer.invoke('fs:createNoteAt', path),
  readAllNotes: () => ipcRenderer.invoke('fs:readAll'),
  createFolder: (folder) => ipcRenderer.invoke('fs:createFolder', folder),
  rename: (path, newName) => ipcRenderer.invoke('fs:rename', path, newName),
  move: (path, folder) => ipcRenderer.invoke('fs:move', path, folder),
  trash: (path) => ipcRenderer.invoke('fs:trash', path),
  trashMany: (paths) => ipcRenderer.invoke('fs:trashMany', paths),
  reveal: (path) => ipcRenderer.invoke('fs:reveal', path),
  readAppData: (name) => ipcRenderer.invoke('vault:readAppData', name),
  writeAppData: (name, content) => ipcRenderer.invoke('vault:writeAppData', name, content),
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
