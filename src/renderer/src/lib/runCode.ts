/**
 * Runs JavaScript code blocks from notes in a sealed-off page (coderun://box, served by the main
 * process). The code gets no access to the app, your notes, your files or the internet, and it's
 * stopped after 5 seconds.
 */

export type RunLine = { kind: 'log' | 'warn' | 'error' | 'result'; text: string }
export type RunResult = { status: 'done' | 'timeout'; lines: RunLine[]; ms: number }

const RUNNABLE = new Set(['js', 'javascript', 'mjs', 'cjs', 'node'])

/** Whether a code block with this info text (what follows the ```) can be run. */
export function isRunnable(info: string): boolean {
  return RUNNABLE.has(info.trim().split(/\s+/)[0]?.toLowerCase() ?? '')
}

const SANDBOX_URL = 'coderun://box/'

let frame: Promise<HTMLIFrameElement> | null = null
let nextId = 1
const waiting = new Map<number, (r: RunResult) => void>()

function onResult(e: MessageEvent): void {
  const id = e.data?.id
  if (typeof id !== 'number' || !waiting.has(id)) return
  frame?.then((el) => {
    if (e.source !== el.contentWindow) return
    const resolve = waiting.get(id)
    waiting.delete(id)
    resolve?.({ status: e.data.status === 'timeout' ? 'timeout' : 'done', lines: Array.isArray(e.data.lines) ? e.data.lines : [], ms: Number(e.data.ms) || 0 })
  })
}

function sandbox(): Promise<HTMLIFrameElement> {
  if (frame) return frame
  window.removeEventListener('message', onResult)
  window.addEventListener('message', onResult)
  frame = new Promise((resolve, reject) => {
    const el = document.createElement('iframe')
    // Its own origin, so it can start workers, but it can't reach this page or open anything.
    el.setAttribute('sandbox', 'allow-scripts allow-same-origin')
    el.style.display = 'none'
    el.src = SANDBOX_URL
    const failed = setTimeout(() => {
      window.removeEventListener('message', onReady)
      el.remove()
      frame = null
      reject(new Error("The code runner couldn't start."))
    }, 5000)
    function onReady(e: MessageEvent): void {
      if (e.source !== el.contentWindow || !e.data?.ready) return
      clearTimeout(failed)
      window.removeEventListener('message', onReady)
      resolve(el)
    }
    window.addEventListener('message', onReady)
    document.body.appendChild(el)
  })
  return frame
}

export async function runCode(code: string): Promise<RunResult> {
  const el = await sandbox()
  const id = nextId++
  return new Promise((resolve) => {
    // The runner stops code itself after 5 seconds; this is in case the runner itself goes away.
    const lost = setTimeout(() => {
      waiting.delete(id)
      resolve({ status: 'done', lines: [{ kind: 'error', text: "The code runner didn't answer. Try again." }], ms: 0 })
    }, 8000)
    waiting.set(id, (r) => {
      clearTimeout(lost)
      resolve(r)
    })
    el.contentWindow?.postMessage({ id, code }, '*')
  })
}
