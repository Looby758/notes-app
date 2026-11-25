import { clipboard } from 'electron'
import { redactSecrets } from '@shared/claudeDesktop'

/**
 * Clipboard history for Claude Desktop ("what did I copy earlier?"). Only kept while the Clipboard
 * part of the Claude Desktop connection is switched on, only text, only in memory (gone when Orbit
 * closes), and never a password Orbit copied or anything that looks like a password or key.
 */

export interface Copied {
  text: string
  at: number
}

const MAX = 50
let items: Copied[] = []
let timer: ReturnType<typeof setInterval> | null = null
let last = ''
let isSecret: (text: string) => boolean = () => false

function check(): void {
  let now: string
  try {
    now = clipboard.readText()
  } catch {
    return
  }
  if (!now || now === last) return
  last = now
  if (!now.trim() || now.length > 20_000 || isSecret(now) || redactSecrets(now) !== now) return
  items = [{ text: now, at: Date.now() }, ...items.filter((i) => i.text !== now)].slice(0, MAX)
}

/** Starts (or stops, and forgets) keeping the history. `secret` says if a text is a password Orbit copied. */
export function watchClipboard(on: boolean, secret?: (text: string) => boolean): void {
  if (secret) isSecret = secret
  if (on && !timer) {
    try {
      last = clipboard.readText()
    } catch {
      last = ''
    }
    timer = setInterval(check, 1500)
  } else if (!on && timer) {
    clearInterval(timer)
    timer = null
    items = []
    last = ''
  }
}

export const clipboardHistory = (): Copied[] => items

export function copyText(text: string): void {
  clipboard.writeText(text)
  last = text
  items = [{ text, at: Date.now() }, ...items.filter((i) => i.text !== text)].slice(0, MAX)
}
