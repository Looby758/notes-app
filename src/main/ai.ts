import { app, safeStorage } from 'electron'
import { readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import Anthropic from '@anthropic-ai/sdk'
import type { AiAskTurn, AiNote, AiStatus } from '@shared/types'

/**
 * The AI helper: summarise a note, tidy a quick capture, and answer questions from your notes,
 * using Claude with your own Anthropic API key. The key is stored encrypted with the system's own
 * protection (Electron safeStorage, like calendar sign-ins) in `ai.json` in the settings folder.
 *
 * Nothing is sent anywhere unless you ask: each call below runs only when you press a button.
 */

const MODEL = 'claude-opus-5-5'
// Overridable for tests, which point it at a local fake server.
const BASE_URL = process.env.NOTES_ANTHROPIC_BASE_URL

interface Stored {
  /** Encrypted. */
  apiKey?: string
}

let stored: Stored | null = null
let client: Anthropic | null = null

const file = (name: string): string => join(app.getPath('userData'), name)

function load(): Stored {
  if (stored) return stored
  try {
    stored = JSON.parse(readFileSync(file('ai.json'), 'utf8')) as Stored
  } catch {
    stored = {}
  }
  return stored!
}

function save(): void {
  const tmp = file('ai.json.tmp')
  writeFileSync(tmp, JSON.stringify(stored, null, 2), 'utf8')
  renameSync(tmp, file('ai.json'))
}

const encrypt = (text: string): string => safeStorage.encryptString(text).toString('base64')
const decrypt = (text: string): string => safeStorage.decryptString(Buffer.from(text, 'base64'))

export function status(): AiStatus {
  return { hasKey: !!load().apiKey, canEncrypt: safeStorage.isEncryptionAvailable() }
}

function getClient(): Anthropic {
  if (client) return client
  const s = load()
  if (!s.apiKey) throw new Error('Add your Anthropic API key in Settings → AI helper first.')
  client = new Anthropic({ apiKey: decrypt(s.apiKey), baseURL: BASE_URL })
  return client
}

/** Turns API errors into something a person can act on. */
function friendly(err: unknown): Error {
  if (err instanceof Anthropic.AuthenticationError) return new Error('Anthropic didn’t accept your API key. Check it in Settings → AI helper.')
  if (err instanceof Anthropic.PermissionDeniedError) return new Error('Your Anthropic account isn’t allowed to use this. Check your account at console.anthropic.com.')
  if (err instanceof Anthropic.RateLimitError) return new Error('Too many requests right now. Wait a minute and try again.')
  if (err instanceof Anthropic.BadRequestError && /credit|billing|balance/i.test(err.message)) {
    return new Error('Your Anthropic account is out of credit. Add some at console.anthropic.com → Billing.')
  }
  if (err instanceof Anthropic.APIConnectionError) return new Error('Couldn’t reach Anthropic. Check your internet connection.')
  if (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500) return new Error('Anthropic is having trouble right now. Try again in a moment.')
  return err instanceof Error ? err : new Error(String(err))
}

/** Saves the key after checking it works (looking up the model is free). */
export async function setKey(key: string): Promise<AiStatus> {
  const trimmed = key.trim()
  if (!trimmed) throw new Error('Paste your API key first.')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer can’t store the key securely, so it wasn’t saved.')
  const test = new Anthropic({ apiKey: trimmed, baseURL: BASE_URL })
  try {
    await test.models.retrieve(MODEL)
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('Anthropic didn’t accept that key. Check you copied all of it, starting with sk-ant-.')
    throw friendly(err)
  }
  load().apiKey = encrypt(trimmed)
  client = null
  save()
  return status()
}

export function clearKey(): AiStatus {
  load().apiKey = undefined
  client = null
  save()
  return status()
}

async function ask(system: string, messages: Anthropic.Beta.BetaMessageParam[], effort: 'low' | 'medium'): Promise<string> {
  let response: Anthropic.Beta.BetaMessage
  try {
    response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort },
      // If Claude declines a request by mistake, Anthropic retries it on another Claude model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages
    })
  } catch (err) {
    throw friendly(err)
  }
  if (response.stop_reason === 'refusal') throw new Error('Claude couldn’t help with this one.')
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
  if (!text) throw new Error('Claude didn’t send anything back. Try again.')
  return text
}

const SUMMARY_SYSTEM = `You summarise a person's markdown note for them.
Write a short summary in plain markdown: one sentence on what the note is about, then up to five bullet points with the key facts, decisions and to-dos.
Write in the same language as the note. Don't add anything that isn't in the note. Reply with only the summary, no preamble or heading.`

export function summarise(title: string, text: string): Promise<string> {
  return ask(SUMMARY_SYSTEM, [{ role: 'user', content: `<note title="${title.replace(/"/g, "'")}">\n${text}\n</note>` }], 'low')
}

const TIDY_SYSTEM = `You tidy up a quickly written note (often typed in a hurry) without changing what it says.
Fix spelling, grammar and punctuation, and give it light markdown structure where it helps: short headings, bullet points, "- [ ] " checkboxes for things to do.
Keep every fact, name, date, time, link, #tag and [[link]] exactly. Don't add new information, opinions or a title. Keep it about as long as it was, in the same language.
Reply with only the tidied text.`

// A quick capture is saved as one list item (extra lines indented under it), so no headings.
const TIDY_CAPTURE_SYSTEM = `You tidy up a thought someone typed in a hurry into a quick-capture box, without changing what it says.
Fix spelling, grammar and punctuation. Keep it short. The first line is the main point; if there are several details or to-dos, put them on the following lines as "- " bullets. No headings.
Keep every fact, name, date, time ("at 8 tomorrow" stays as written), link, #tag and [[link]] exactly. Don't add new information. Keep the same language.
Reply with only the tidied text.`

export function tidy(text: string, kind: 'note' | 'capture'): Promise<string> {
  return ask(kind === 'capture' ? TIDY_CAPTURE_SYSTEM : TIDY_SYSTEM, [{ role: 'user', content: `<text>\n${text}\n</text>` }], 'low')
}

const askSystem = (): string => `You answer a person's questions using their own notes, which are given to you in <note> tags.
Answer briefly and plainly, from the notes only. When you use a note, name it as a wiki link with its exact title, like [[Trip plans]].
If the notes don't contain the answer, say so in one sentence and don't guess.
Today's date is ${new Date().toISOString().slice(0, 10)}.`

export function askNotes(question: string, notes: AiNote[], history: AiAskTurn[]): Promise<string> {
  const context = notes.length
    ? notes.map((n) => `<note title="${n.title.replace(/"/g, "'")}">\n${n.text}\n</note>`).join('\n\n')
    : '(No notes matched this question.)'
  const messages: Anthropic.Beta.BetaMessageParam[] = []
  for (const turn of history) {
    messages.push({ role: 'user', content: turn.question }, { role: 'assistant', content: turn.answer })
  }
  messages.push({ role: 'user', content: `<notes>\n${context}\n</notes>\n\n${question}` })
  return ask(askSystem(), messages, 'medium')
}
