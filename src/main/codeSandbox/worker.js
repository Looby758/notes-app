// Runs one code block from a note. It's served with a policy that blocks the network and loading
// other scripts, and the worker has no way to reach the app, your notes or your files.
'use strict'

/** Turns a value into readable text, roughly the way a browser's console shows it. */
function show(value, depth, seen) {
  if (typeof value === 'string') return depth === 0 ? value : JSON.stringify(value)
  if (typeof value === 'bigint') return `${value}n`
  if (typeof value === 'symbol') return value.toString()
  if (typeof value === 'function') return `[Function${value.name ? `: ${value.name}` : ''}]`
  if (value === null || typeof value !== 'object') return String(value)
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`
  if (value instanceof Date) return isNaN(value) ? 'Invalid Date' : value.toISOString()
  if (value instanceof RegExp) return String(value)
  if (seen.has(value)) return '[Circular]'
  if (depth > 3) return Array.isArray(value) ? '[Array]' : '[Object]'
  seen.add(value)
  try {
    const inner = (v) => show(v, depth + 1, seen)
    if (Array.isArray(value)) return `[${value.map(inner).join(', ')}]`
    if (value instanceof Map) return `Map(${value.size}) {${[...value].map(([k, v]) => `${inner(k)} => ${inner(v)}`).join(', ')}}`
    if (value instanceof Set) return `Set(${value.size}) {${[...value].map(inner).join(', ')}}`
    const entries = Object.keys(value).map((k) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${inner(value[k])}`)
    const name = value.constructor && value.constructor !== Object ? `${value.constructor.name} ` : ''
    return entries.length ? `${name}{ ${entries.join(', ')} }` : `${name}{}`
  } finally {
    seen.delete(value)
  }
}

const say = (kind) => (...args) =>
  self.postMessage({ type: 'line', kind, text: args.map((a) => show(a, 0, new Set())).join(' ') })

const notesConsole = {
  log: say('log'),
  info: say('log'),
  debug: say('log'),
  warn: say('warn'),
  error: say('error'),
  table: say('log'),
  dir: say('log'),
  clear: () => self.postMessage({ type: 'clear' })
}

// The policy already blocks these; this just says so plainly.
const offline = () => {
  throw new Error("Code in notes can't use the internet.")
}
for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts']) {
  try {
    self[name] = offline
  } catch {
    // Some can't be replaced; the policy still stops them.
  }
}

self.onmessage = async (e) => {
  const AsyncFunction = (async () => {}).constructor
  try {
    // Wrapped in an async function so `await` works at the top of a block.
    const run = new AsyncFunction('console', String(e.data.code))
    const value = await run(notesConsole)
    if (value !== undefined) self.postMessage({ type: 'line', kind: 'result', text: show(value, 0, new Set()) })
  } catch (err) {
    self.postMessage({ type: 'line', kind: 'error', text: err instanceof Error ? `${err.name}: ${err.message}` : `Error: ${show(err, 0, new Set())}` })
  }
  self.postMessage({ type: 'done' })
}
