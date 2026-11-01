import { Worker } from 'worker_threads'
import workerPath from './sevenZipWorker?modulePath'
import type { SevenZipJob, SevenZipResult } from './sevenZipRun'

/**
 * Runs a 7-Zip command in a worker thread of its own, so even a huge archive never freezes Orbit.
 * Worker threads can't load files from inside app.asar, so 7z-wasm is unpacked next to it
 * (electron-builder.yml) and loaded from there.
 */

const unpacked = (path: string): string => path.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')

export function runInWorker(job: SevenZipJob): Promise<SevenZipResult> {
  const modulePath = unpacked(require.resolve('7z-wasm'))
  return new Promise((resolve, reject) => {
    const worker = new Worker(unpacked(workerPath), { workerData: { modulePath, job } })
    let settled = false
    worker.once('message', (msg: { result?: SevenZipResult; error?: string }) => {
      settled = true
      if (msg.result) resolve(msg.result)
      else reject(new Error(msg.error ?? '7-Zip stopped.'))
      void worker.terminate()
    })
    worker.once('error', (err) => {
      if (!settled) reject(err)
      settled = true
    })
    worker.once('exit', () => {
      if (!settled) reject(new Error('7-Zip stopped unexpectedly.'))
      settled = true
    })
  })
}
