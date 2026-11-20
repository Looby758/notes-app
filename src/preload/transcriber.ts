import { ipcRenderer } from 'electron'

/**
 * The hidden transcriber page's only way to talk to Orbit: the main process hands it one message
 * port, which this passes on to the page. The page gets nothing else (no files, no notes).
 */
ipcRenderer.once('transcriber:port', (e) => {
  window.postMessage('transcriber-port', '*', e.ports)
})
