import { parentPort, workerData } from 'worker_threads'
import type { RarJob } from './rar'
import { runRar, type Unrar } from './rarRun'

/** A worker thread that runs one RAR job (see rar.ts) and posts back what happened. */

const { modulePath, job } = workerData as { modulePath: string; job: RarJob }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const unrar = require(modulePath) as Unrar
const port = parentPort!

let cancelled = false
port.on('message', (m: { cancel?: boolean }) => {
  if (m.cancel) cancelled = true
})

runRar(unrar, job, (progress) => port.postMessage({ progress }), () => cancelled).then(
  (result) => port.postMessage({ result }),
  (e: unknown) => port.postMessage({ error: { reason: (e as { reason?: string })?.reason, message: e instanceof Error ? e.message : String(e) } })
)
