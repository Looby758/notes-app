import { Worker } from 'worker_threads'
import workerPath from './rarWorker?modulePath'
import type { RarJob, RarProgress } from './rar'

type WorkerMessage = { result?: unknown; progress?: RarProgress; error?: { reason?: string; message: string } }

const unpacked = (path: string): string => path.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')

/** Runs a job in a worker thread of its own. `onProgress` hears each file unpacked; `cancelled` is asked as it goes. */
export function runInThread<T>(job: RarJob, onProgress?: (p: RarProgress) => void, cancelled?: () => boolean): Promise<T> {
  const modulePath = unpacked(require.resolve('node-unrar-js'))
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(unpacked(workerPath), { workerData: { modulePath, job } })
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearInterval(watch)
      fn()
      void worker.terminate()
    }
    const watch = setInterval(() => cancelled?.() && worker.postMessage({ cancel: true }), 200)
    worker.on('message', (m: WorkerMessage) => {
      if (m.progress) onProgress?.(m.progress)
      else if (m.error) finish(() => reject(m.error))
      else finish(() => resolve(m.result as T))
    })
    worker.once('error', (err) => finish(() => reject(err)))
    worker.once('exit', () => finish(() => reject(new Error('Unpacking the RAR stopped unexpectedly.'))))
  })
}

