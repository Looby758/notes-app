import { parentPort, workerData } from 'worker_threads'
import { runSevenZip, type SevenZipFactory, type SevenZipJob } from './sevenZipRun'

/** A worker thread that runs one 7-Zip command (see sevenZip.ts) and posts back what happened. */

const { modulePath, job } = workerData as { modulePath: string; job: SevenZipJob }

// eslint-disable-next-line @typescript-eslint/no-require-imports
const factory = require(modulePath) as SevenZipFactory
runSevenZip(factory, job).then(
  (result) => parentPort!.postMessage({ result }),
  (e) => parentPort!.postMessage({ error: e instanceof Error ? e.message : String(e) })
)
