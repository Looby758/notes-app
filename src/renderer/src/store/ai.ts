import { create } from 'zustand'
import type { AiEngine, AiStatus } from '@shared/types'
import { useEditor } from './editor'
import { getNoteText, notesForQuestion } from './noteIndex'
import { useUI } from './ui'
import { applyText, getOpenText, isNoteTab, noteLockOf, openSpecialTab, AI_TAB } from '../lib/editorController'
import { pickContext, splitFrontmatter, withSummary, withTidiedBody } from '../lib/ai'
import { errorMessage, noteTitle } from '../lib/paths'
import { isLockedText } from '../lib/lock/crypto'
import { calendarContext, moneyContext } from '../lib/askContext'
import { dayOf } from '../lib/money'
import { ensureMoney, useMoney } from './money'

/** The AI helper: the summary / tidy-up dialog for a note, and the "Ask my notes" conversation. */

export interface NoteJob {
  kind: 'summary' | 'tidy'
  path: string
  state: 'working' | 'done' | 'error' | 'nokey'
  result?: string
  error?: string
}

export interface AskTurn {
  question: string
  answer?: string
  error?: string
  /** Answered by the offline AI. */
  offline?: boolean
  /** The offline AI thinks Claude would answer this better. */
  hard?: boolean
  /** Asked privately (money questions): stays on the offline AI, never offered to Claude. */
  private?: boolean
}

export interface AskOptions {
  /** Which AI to ask; unset means the one chosen in Settings. */
  engine?: AiEngine
  /** Keep it on this computer (the offline AI only). */
  private?: boolean
}

/** What "Ask everything" may look at. Notes always; the rest can be switched off on the page. */
export interface AskSources {
  email: boolean
  calendar: boolean
  money: boolean
}

interface AiState {
  status: AiStatus | null
  job: NoteJob | null
  turns: AskTurn[]
  sources: AskSources
}

const SOURCES_KEY = 'ask:sources'
const savedSources = ((): AskSources => {
  try {
    return { email: true, calendar: true, money: true, ...JSON.parse(localStorage.getItem(SOURCES_KEY) ?? '{}') }
  } catch {
    return { email: true, calendar: true, money: true }
  }
})()

export const useAi = create<AiState>(() => ({ status: null, job: null, turns: [], sources: savedSources }))

export function setAskSource(key: keyof AskSources, on: boolean): void {
  const sources = { ...useAi.getState().sources, [key]: on }
  useAi.setState({ sources })
  try {
    localStorage.setItem(SOURCES_KEY, JSON.stringify(sources))
  } catch {
    // not fatal
  }
}

export async function refreshAiStatus(): Promise<AiStatus> {
  const status = await window.api.aiStatus()
  useAi.setState({ status })
  return status
}

const activeNote = (): string | null => {
  const { active } = useEditor.getState()
  return isNoteTab(active) ? active : null
}

const textOf = (path: string): string => getOpenText(path) ?? getNoteText(path) ?? ''

/** Summarises or tidies the open note, showing the result in a dialog before anything changes. */
export async function runNoteJob(kind: NoteJob['kind'], path = activeNote()): Promise<void> {
  if (!path) return
  useUI.setState({ modal: 'ai' })
  const text = textOf(path)
  if (noteLockOf(path) || isLockedText(text)) {
    useAi.setState({ job: { kind, path, state: 'error', error: 'This note is locked, so it isn’t sent to the AI helper.' } })
    return
  }
  const { body } = splitFrontmatter(text)
  if (!body.trim()) {
    useAi.setState({ job: { kind, path, state: 'error', error: 'This note is empty.' } })
    return
  }
  const status = await refreshAiStatus()
  if (!status.ready) {
    useAi.setState({ job: { kind, path, state: 'nokey' } })
    return
  }
  const job: NoteJob = { kind, path, state: 'working' }
  useAi.setState({ job })
  try {
    const result = kind === 'summary' ? await window.api.aiSummarise(noteTitle(path), body) : await window.api.aiTidy(body, 'note')
    if (useAi.getState().job === job) useAi.setState({ job: { ...job, state: 'done', result } })
  } catch (err) {
    if (useAi.getState().job === job) useAi.setState({ job: { ...job, state: 'error', error: errorMessage(err) } })
  }
}

/** Applies a finished summary (added at the top) or tidy-up (replaces the text). Undo with Ctrl+Z. */
export function applyNoteJob(): boolean {
  const job = useAi.getState().job
  if (!job?.result) return false
  const text = textOf(job.path)
  const next = job.kind === 'summary' ? withSummary(text, job.result) : withTidiedBody(text, job.result)
  const ok = applyText(job.path, next)
  if (ok) useAi.setState({ job: null })
  return ok
}

export function openAsk(): void {
  openSpecialTab(AI_TAB)
}

/** Whether asking now would use the offline AI. */
export const usesOffline = (status: AiStatus | null, engine?: AiEngine): boolean =>
  (engine ?? status?.use) === 'offline' && status?.offline.state === 'ready'

export async function askNotes(question: string, opts: AskOptions = {}): Promise<void> {
  const q = question.trim()
  if (!q) return
  const status = useAi.getState().status ?? (await refreshAiStatus())
  const privately = !!opts.private && status.offline.state === 'ready'
  const engine: AiEngine | undefined = privately ? 'offline' : opts.engine
  const offline = usesOffline(status, engine) || engine === 'offline'
  const earlier = useAi.getState().turns.filter((t) => t.answer).slice(-4)
  const turn: AskTurn = { question: q, private: privately }
  useAi.setState((s) => ({ turns: [...s.turns, turn] }))
  const update = (patch: Partial<AskTurn>): void =>
    useAi.setState((s) => ({ turns: s.turns.map((t) => (t === turn ? { ...t, ...patch } : t)) }))
  try {
    // Follow-ups like "and when is it?" find little on their own, so earlier questions help pick notes.
    const searchText = [...earlier.map((t) => t.question), q].join(' ')
    // The offline AI reads less at once, so it gets fewer notes.
    const notes = pickContext(notesForQuestion(searchText), offline ? 16000 : 60000, offline ? 8 : 25).map(({ title, text }) => ({ title, text }))
    const extra = await gatherContext(searchText, engine)
    const reply = await window.api.aiAsk(
      q,
      notes,
      earlier.map((t) => ({ question: t.question, answer: t.answer! })),
      extra,
      engine
    )
    update({ answer: reply.text, offline: reply.offline, hard: reply.hard })
  } catch (err) {
    update({ error: errorMessage(err) })
  }
}

/** Opens Ask everything and asks a question (from Ctrl+K or the summon bar). */
export async function askEverything(question: string, opts: AskOptions = {}): Promise<void> {
  openAsk()
  await askNotes(question, opts)
}

/** Asks Claude the same question an offline answer was for (only when you press the button). */
export function askOnline(turn: AskTurn): Promise<void> {
  return askNotes(turn.question, { engine: 'online' })
}

/** Offline AI or Claude for the AI features. */
export async function setAiEngine(use: AiEngine): Promise<void> {
  useAi.setState({ status: await window.api.aiSetEngine(use) })
}

/** Money, calendar and email as text for the AI, for the sources that are switched on. Anything unavailable is skipped. */
async function gatherContext(question: string, engine?: AiEngine): Promise<{ money?: string; calendar?: string; email?: string }> {
  const { sources } = useAi.getState()
  const today = dayOf(new Date())
  const out: { money?: string; calendar?: string; email?: string } = {}
  const jobs: Promise<void>[] = []
  if (sources.money) {
    jobs.push(
      ensureMoney().then(() => {
        out.money = moneyContext(useMoney.getState(), today, question) || undefined
      })
    )
  }
  if (sources.calendar) {
    const from = new Date(Date.now() - 60 * 86400000).toISOString()
    const to = new Date(Date.now() + 120 * 86400000).toISOString()
    jobs.push(
      window.api.fetchCalendarEvents(from, to).then(
        (r) => {
          out.calendar = calendarContext(r.events) || undefined
        },
        () => undefined
      )
    )
  }
  if (sources.email) {
    // The emails that match best, the top few in full, from Gmail or the copy kept on this computer.
    jobs.push(
      window.api.aiEmailContext(question, engine).then(
        (text) => {
          out.email = text || undefined
        },
        () => undefined
      )
    )
  }
  await Promise.all(jobs)
  return out
}

export function clearAsk(): void {
  useAi.setState({ turns: [] })
}
