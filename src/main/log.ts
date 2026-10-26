import { app } from 'electron'
import { appendFileSync, statSync, renameSync } from 'fs'
import { join } from 'path'

/**
 * A small log of things that went wrong in the background (notes.log next to settings.json), so
 * a problem on someone's computer can be looked into afterwards. Kept under ~1 MB.
 */

const file = (): string => join(app.getPath('userData'), 'notes.log')

export function logError(where: string, err: unknown): void {
  const text = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
  try {
    const f = file()
    try {
      if (statSync(f).size > 1_000_000) renameSync(f, `${f}.old`)
    } catch {
      // no log yet
    }
    appendFileSync(f, `[${new Date().toISOString()}] ${where} (v${app.getVersion()}, ${process.platform}): ${text}\n`)
  } catch {
    // Logging must never cause trouble itself.
  }
  console.error(`[${where}]`, err)
}

/** Runs one part of start-up; if it fails, the rest of the app still starts. */
export function safely(where: string, fn: () => void): void {
  try {
    fn()
  } catch (err) {
    logError(where, err)
  }
}

export function logCrashes(): void {
  process.on('uncaughtException', (err) => logError('uncaught', err))
  process.on('unhandledRejection', (err) => logError('unhandled promise', err))
}
