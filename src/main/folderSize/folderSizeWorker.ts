import { parentPort } from 'worker_threads'
import { countFolder } from './count'

/** The worker thread that adds up folder sizes (see count.ts and main/folderSize/index.ts). */

type Message = { type: 'count'; path: string } | { type: 'cancel'; path: string }

const cancelled = new Set<string>()
const waiting: string[] = []
let running = 0
/** Two folders are counted at once; the rest wait their turn (in the order they're shown). */
const AT_ONCE = 2

function pump(): void {
  while (running < AT_ONCE && waiting.length) {
    const path = waiting.shift()!
    if (cancelled.delete(path)) continue
    running++
    countFolder(path, {
      cancelled: () => cancelled.has(path),
      onProgress: (size) => parentPort!.postMessage({ type: 'progress', path, size })
    })
      .then((size) => {
        const wasCancelled = cancelled.delete(path)
        parentPort!.postMessage({ type: 'done', path, size: wasCancelled ? null : size, cancelled: wasCancelled })
      })
      .catch(() => parentPort!.postMessage({ type: 'done', path, size: null, cancelled: false }))
      .finally(() => {
        running--
        pump()
      })
  }
}

parentPort!.on('message', (m: Message) => {
  if (m.type === 'count') {
    cancelled.delete(m.path)
    if (!waiting.includes(m.path)) waiting.push(m.path)
    pump()
  } else {
    const i = waiting.indexOf(m.path)
    if (i >= 0) waiting.splice(i, 1)
    else cancelled.add(m.path)
  }
})
