import { create } from 'zustand'
import type { AiStatus } from '@shared/types'
import { useEditor } from './editor'
import { getNoteText, notesForQuestion } from './noteIndex'
import { useUI } from './ui'
import { applyText, getOpenText, isNoteTab, noteLockOf, openSpecialTab, AI_TAB } from '../lib/editorController'
import { pickContext, splitFrontmatter, withSummary, withTidiedBody } from '../lib/ai'
import { errorMessage, noteTitle } from '../lib/paths'
import { isLockedText } from '../lib/lock/crypto'
import { calendarContext, emailContext, moneyContext, questionWords } from '../lib/askContext'
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
  if (!status.hasKey) {
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

export async function askNotes(question: string): Promise<void> {
  const q = question.trim()
  if (!q) return
  const earlier = useAi.getState().turns.filter((t) => t.answer).slice(-4)
  const turn: AskTurn = { question: q }
  useAi.setState((s) => ({ turns: [...s.turns, turn] }))
  const update = (patch: Partial<AskTurn>): void =>
    useAi.setState((s) => ({ turns: s.turns.map((t) => (t === turn ? { ...t, ...patch } : t)) }))
  try {
    // Follow-ups like "and when is it?" find little on their own, so earlier questions help pick notes.
    const searchText = [...earlier.map((t) => t.question), q].join(' ')
    const notes = pickContext(notesForQuestion(searchText)).map(({ title, text }) => ({ title, text }))
    const extra = await gatherContext(searchText)
    const answer = await window.api.aiAsk(
      q,
      notes,
      earlier.map((t) => ({ question: t.question, answer: t.answer! })),
      extra
    )
    update({ answer })
  } catch (err) {
    update({ error: errorMessage(err) })
  }
}

/** Opens Ask everything and asks a question (from Ctrl+K or the summon bar). */
export async function askEverything(question: string): Promise<void> {
  openAsk()
  await askNotes(question)
}

/** Money, calendar and email as text for the AI, for the sources that are switched on. Anything unavailable is skipped. */
async function gatherContext(question: string): Promise<{ money?: string; calendar?: string; email?: string }> {
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
    jobs.push(
      (async () => {
        const status = await window.api.emailStatus()
        if (!status.gmail) return
        const words = questionWords(question).slice(0, 4)
        const [recent, found] = await Promise.all([
          window.api.emailList('inbox', '', undefined).catch(() => null),
          words.length ? window.api.emailList('all', words.join(' OR '), undefined).catch(() => null) : null
        ])
        out.email = emailContext([...(found?.emails ?? []), ...(recent?.emails ?? [])]) || undefined
      })().catch(() => undefined)
    )
  }
  await Promise.all(jobs)
  return out
}

export function clearAsk(): void {
  useAi.setState({ turns: [] })
}
