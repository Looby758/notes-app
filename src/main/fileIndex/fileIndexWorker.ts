import { parentPort, workerData } from 'worker_threads'
import { IndexService, type ServiceOptions } from './service'
import type { SearchOptions } from './core'

/** The worker thread that keeps the Whole PC list (see service.ts and fileIndex/index.ts). */

type Message = { type: 'search'; id: number; query: string; opts: SearchOptions } | { type: 'touched'; paths: string[] } | { type: 'rebuild' } | { type: 'stop' }

const opts = workerData as Omit<ServiceOptions, 'onStatus'>
const service = new IndexService({ ...opts, onStatus: (status) => parentPort!.postMessage({ type: 'status', status }) })

parentPort!.on('message', (m: Message) => {
  if (m.type === 'search') {
    let hits = null
    try {
      hits = service.search(m.query, m.opts)
    } catch {
      hits = null
    }
    parentPort!.postMessage({ type: 'result', id: m.id, hits })
  } else if (m.type === 'touched') service.touched(m.paths)
  else if (m.type === 'rebuild') void service.rebuild()
  else if (m.type === 'stop') {
    service.stop()
    process.exit(0)
  }
})

void service.start()
