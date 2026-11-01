/**
 * Screen controls: brightness, contrast and which input a monitor shows, sent to the monitor over
 * its cable (DDC/CI), like pressing the buttons on the monitor itself. This file is the plain logic
 * both sides share; main/monitors.ts talks to the screens.
 */

/** The DDC/CI (MCCS) codes Orbit uses. */
export const VCP = { brightness: 0x10, contrast: 0x12, input: 0x60 } as const
export type MonitorSetting = keyof typeof VCP

export interface Level {
  value: number
  max: number
}

export interface MonitorInput {
  /** The MCCS input number (0x0F DisplayPort 1, 0x11 HDMI 1…). */
  value: number
  /** Your name for it ("MacBook") or the standard one ("HDMI 1"). */
  label: string
}

export interface Monitor {
  /** Stays the same while the screen is plugged into the same port. */
  id: string
  name: string
  primary: boolean
  /** Whether the screen answers DDC/CI at all. */
  controllable: boolean
  brightness: Level | null
  contrast: Level | null
  /** The input showing now, when the screen says. */
  input: number | null
  /** The inputs you can switch to: what the screen says it has, or the usual ones. */
  inputs: MonitorInput[]
}

export type MonitorTarget = 'all' | string

export type MonitorAction =
  | { kind: 'brightness' | 'contrast'; mode: 'up' | 'down' | 'set'; amount: number }
  | { kind: 'input'; value: number }

export interface MonitorHotkey {
  id: string
  /** Electron accelerator ("Control+Alt+Up"). */
  keys: string
  monitor: MonitorTarget
  action: MonitorAction
}

export interface MonitorSaved {
  /** Names you gave screens, by id. */
  names: Record<string, string>
  /** Names you gave inputs, by screen id then input number. */
  inputNames: Record<string, Record<string, string>>
  hotkeys: MonitorHotkey[]
}

export interface MonitorsStatus {
  monitors: MonitorInfoState
  saved: MonitorSaved
  hotkeyErrors: Record<string, string>
}

export interface MonitorInfoState {
  list: Monitor[]
  /** Why nothing can be controlled (e.g. a Mac without the m1ddc helper), if so. */
  problem?: string
  /** A command that fixes the problem, for a copy button. */
  fix?: string
}

export const MAX_HOTKEYS = 40

/** The MCCS names for input numbers. 0x1B is USB-C on most monitors that have it. */
const INPUT_NAMES: Record<number, string> = {
  0x01: 'VGA 1',
  0x02: 'VGA 2',
  0x03: 'DVI 1',
  0x04: 'DVI 2',
  0x05: 'Composite 1',
  0x06: 'Composite 2',
  0x07: 'S-Video 1',
  0x08: 'S-Video 2',
  0x09: 'Tuner 1',
  0x0a: 'Tuner 2',
  0x0b: 'Tuner 3',
  0x0c: 'Component 1',
  0x0d: 'Component 2',
  0x0e: 'Component 3',
  0x0f: 'DisplayPort 1',
  0x10: 'DisplayPort 2',
  0x11: 'HDMI 1',
  0x12: 'HDMI 2',
  0x13: 'HDMI 3',
  0x1b: 'USB-C'
}

/** Offered when a screen doesn't list its inputs. */
export const COMMON_INPUTS = [0x0f, 0x10, 0x11, 0x12, 0x1b]

export function inputName(value: number): string {
  return INPUT_NAMES[value] ?? `Input ${value.toString(16).toUpperCase().padStart(2, '0')}`
}

/**
 * The input number in a reply. Some monitors put other bits in the high byte, so only the low byte
 * counts.
 */
export const inputFromReply = (value: number): number => value & 0xff

export interface Capabilities {
  model?: string
  /** Codes the screen supports, each with the values it lists (if any). */
  vcp: Map<number, number[]>
}

/**
 * Reads a monitor's capabilities string, e.g.
 * "(prot(monitor)type(LCD)model(U2720Q)vcp(02 10 12 60(0F 11 12 1B) …)mccs_ver(2.1))".
 */
export function parseCapabilities(text: string): Capabilities {
  const vcp = new Map<number, number[]>()
  const caps: Capabilities = { vcp }
  const section = (name: string): string | null => {
    const m = new RegExp(`${name}\\(`, 'i').exec(text)
    if (!m) return null
    let depth = 1
    let i = m.index + m[0].length
    const start = i
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === '(') depth++
      else if (text[i] === ')') depth--
    }
    return text.slice(start, depth === 0 ? i - 1 : i)
  }
  const model = section('model')?.trim()
  if (model) caps.model = model
  const body = section('vcp')
  if (body) {
    // Codes are hex pairs, sometimes run together ("1012"), each optionally followed by "(values)".
    const re = /([0-9A-Fa-f]{2})|\(([^()]*)\)/g
    let last: number | null = null
    for (let m = re.exec(body); m; m = re.exec(body)) {
      if (m[1]) {
        last = parseInt(m[1], 16)
        if (!vcp.has(last)) vcp.set(last, [])
      } else if (last !== null) {
        const values = (m[2].match(/[0-9A-Fa-f]{2}/g) ?? []).map((h) => parseInt(h, 16))
        vcp.set(last, [...new Set([...(vcp.get(last) ?? []), ...values])])
      }
    }
  }
  return caps
}

/** The inputs to offer: the ones the screen lists, else the usual ones, plus the one showing now. */
export function inputChoices(caps: Capabilities | null, current: number | null, names: Record<string, string> = {}): MonitorInput[] {
  const listed = caps?.vcp.get(VCP.input) ?? []
  const values = [...new Set([...(listed.length ? listed : COMMON_INPUTS), ...(current ? [current] : [])])].filter((v) => v > 0)
  return values.map((value) => ({ value, label: names[String(value)]?.trim() || inputName(value) }))
}

export const clampLevel = (value: number, max: number): number => Math.max(0, Math.min(max > 0 ? max : 100, Math.round(Number(value) || 0)))

/** The level after a hotkey: `amount` is in percent of the screen's range. */
export function nextLevel(level: Level, mode: 'up' | 'down' | 'set', amount: number): number {
  const max = level.max > 0 ? level.max : 100
  const step = (Math.abs(amount) * max) / 100
  if (mode === 'set') return clampLevel(step, max)
  return clampLevel(level.value + (mode === 'up' ? step : -step), max)
}

export const percent = (level: Level): number => Math.round((level.value / (level.max > 0 ? level.max : 100)) * 100)

/** What a hotkey does, in words. */
export function actionText(action: MonitorAction): string {
  if (action.kind === 'input') return `Switch to ${inputName(action.value)}`
  const what = action.kind === 'brightness' ? 'Brightness' : 'Contrast'
  if (action.mode === 'set') return `${what} to ${action.amount}%`
  return `${what} ${action.mode} ${action.amount}%`
}

/** Lines of `m1ddc display list`, e.g. "[1] DELL U2720Q (37D8832A-2D66-…)". */
export function parseM1ddcList(text: string): { index: number; name: string; uuid?: string }[] {
  const out: { index: number; name: string; uuid?: string }[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*\[(\d+)\]\s*(.*?)\s*(?:\(([0-9A-Fa-f-]{8,})\))?\s*$/.exec(line)
    if (!m) continue
    out.push({ index: Number(m[1]), name: m[2] || `Screen ${m[1]}`, uuid: m[3] })
  }
  return out
}

/** The number m1ddc printed, or null. */
export function parseNumber(text: string): number | null {
  const m = /-?\d+/.exec(text)
  return m ? Number(m[0]) : null
}

const cleanId = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 200) : '')

function cleanAction(raw: unknown): MonitorAction | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Record<string, unknown>
  if (a.kind === 'input') {
    const value = Math.round(Number(a.value))
    return value > 0 && value < 256 ? { kind: 'input', value } : null
  }
  if (a.kind !== 'brightness' && a.kind !== 'contrast') return null
  if (a.mode !== 'up' && a.mode !== 'down' && a.mode !== 'set') return null
  const amount = Math.max(1, Math.min(100, Math.round(Number(a.amount) || 10)))
  return { kind: a.kind, mode: a.mode, amount }
}

/** Turns a saved file (hand-edited, or from an older version) into valid settings. */
export function cleanSaved(raw: unknown): MonitorSaved {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const names: Record<string, string> = {}
  if (input.names && typeof input.names === 'object') {
    for (const [id, name] of Object.entries(input.names as Record<string, unknown>)) {
      if (typeof name === 'string' && name.trim()) names[cleanId(id)] = name.trim().slice(0, 60)
    }
  }
  const inputNames: Record<string, Record<string, string>> = {}
  if (input.inputNames && typeof input.inputNames === 'object') {
    for (const [id, map] of Object.entries(input.inputNames as Record<string, unknown>)) {
      if (!map || typeof map !== 'object') continue
      const clean: Record<string, string> = {}
      for (const [value, name] of Object.entries(map as Record<string, unknown>)) {
        if (/^\d{1,3}$/.test(value) && typeof name === 'string' && name.trim()) clean[value] = name.trim().slice(0, 40)
      }
      if (Object.keys(clean).length) inputNames[cleanId(id)] = clean
    }
  }
  const hotkeys: MonitorHotkey[] = []
  for (const h of Array.isArray(input.hotkeys) ? input.hotkeys : []) {
    if (!h || typeof h !== 'object') continue
    const r = h as Record<string, unknown>
    const action = cleanAction(r.action)
    const id = cleanId(r.id)
    if (!action || !id || hotkeys.some((x) => x.id === id)) continue
    hotkeys.push({ id, keys: typeof r.keys === 'string' ? r.keys.slice(0, 60) : '', monitor: cleanId(r.monitor) || 'all', action })
    if (hotkeys.length >= MAX_HOTKEYS) break
  }
  return { names, inputNames, hotkeys }
}

/** Starting hotkeys, so it works straight away: brightness up and down on every screen. */
export function defaultHotkeys(): MonitorHotkey[] {
  return [
    { id: 'bright-up', keys: 'Control+Alt+PageUp', monitor: 'all', action: { kind: 'brightness', mode: 'up', amount: 10 } },
    { id: 'bright-down', keys: 'Control+Alt+PageDown', monitor: 'all', action: { kind: 'brightness', mode: 'down', amount: 10 } }
  ]
}
