// The go-between for code blocks run from notes: it starts a fresh worker for each run, collects
// what the code prints, and stops it if it takes too long. The code itself never runs on this page.
'use strict'

const TIME_LIMIT = 5000
const MAX_LINES = 500

window.addEventListener('message', (e) => {
  if (e.source !== window.parent) return
  const { id, code } = e.data || {}
  if (typeof id !== 'number' || typeof code !== 'string') return

  const lines = []
  const started = performance.now()
  const worker = new Worker('worker.js')
  let finished = false
  const finish = (status) => {
    if (finished) return
    finished = true
    clearTimeout(timer)
    worker.terminate()
    window.parent.postMessage({ id, status, lines, ms: Math.round(performance.now() - started) }, '*')
  }
  const timer = setTimeout(() => finish('timeout'), TIME_LIMIT)

  worker.onmessage = (m) => {
    const msg = m.data || {}
    if (msg.type === 'line') {
      if (lines.length < MAX_LINES) lines.push({ kind: String(msg.kind), text: String(msg.text) })
      else if (lines.length === MAX_LINES) lines.push({ kind: 'warn', text: '…the rest of the output was cut off.' })
    } else if (msg.type === 'clear') lines.length = 0
    else if (msg.type === 'done') finish('done')
  }
  worker.onerror = (err) => {
    err.preventDefault()
    lines.push({ kind: 'error', text: err.message || 'The code stopped with an error.' })
    finish('done')
  }
  worker.postMessage({ code })
})

window.parent.postMessage({ ready: true }, '*')
