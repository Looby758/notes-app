import { app, safeStorage } from 'electron'
import { readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import Anthropic from '@anthropic-ai/sdk'
import type { AiAskTurn, AiEngine, AiExtraContext, AiChat, AiChatMessage, AiNote, AiReply, AiSortRow, AiStatus } from '@shared/types'
import { cleanReply, fitTexts, HARD_NOTE, LOCAL_CONTEXT_CHARS, MEANING_SYSTEM, meaningPrompt, MONEY_SORT_SYSTEM, moneySortPrompt, parseMoneySort } from '@shared/localAi'
import { parseRelatedWords } from '@shared/emailSearch'
import { localAiInstalled, localAiState, localComplete, type LocalMessage } from './localAi'
import * as emailAsk from './emailAsk'

/**
 * The AI helper: summarise a note, tidy a quick capture, answer questions from your notes and read
 * the handwriting in a sketch, using Claude with your own Anthropic API key. The key is stored
 * encrypted with the system's own protection (Electron safeStorage, like calendar sign-ins) in
 * `ai.json` in the settings folder.
 *
 * Nothing is sent anywhere unless you ask: each call below runs only when you press a button.
 *
 * With the offline AI downloaded (src/main/localAi.ts), the same features can run on this
 * computer instead, and do unless you choose Claude in Settings. Offline answers to questions say
 * when Claude would do better, and Orbit then offers (never switches by itself) to ask Claude.
 */

const MODEL = 'claude-opus-5-5'
// Overridable for tests, which point it at a local fake server.
const BASE_URL = process.env.NOTES_ANTHROPIC_BASE_URL

interface Stored {
  /** Encrypted. */
  apiKey?: string
  /** Which AI the features use; unset means the offline one once it's downloaded. */
  use?: AiEngine
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

function writeJson(name: string, data: unknown): void {
  const tmp = file(`${name}.tmp`)
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, file(name))
}

function save(): void {
  writeJson('ai.json', stored)
}

const encrypt = (text: string): string => safeStorage.encryptString(text).toString('base64')
const decrypt = (text: string): string => safeStorage.decryptString(Buffer.from(text, 'base64'))

const using = (): AiEngine => load().use ?? (localAiInstalled() ? 'offline' : 'online')

export function status(): AiStatus {
  const hasKey = !!load().apiKey
  const use = using()
  return { hasKey, canEncrypt: safeStorage.isEncryptionAvailable(), use, ready: use === 'offline' ? localAiInstalled() : hasKey, offline: localAiState() }
}

export function setEngine(use: AiEngine): AiStatus {
  load().use = use === 'offline' ? 'offline' : 'online'
  save()
  return status()
}

/** The engine for a call: the one asked for, or the one chosen in Settings. */
const engineFor = (asked?: AiEngine): AiEngine => (asked === 'offline' || asked === 'online' ? asked : using())

/** The offline AI's answer, with Anthropic-style messages turned into plain ones. */
async function askOffline(system: string, messages: { role: 'user' | 'assistant'; content: string }[], maxTokens?: number): Promise<{ text: string; hard: boolean }> {
  const all: LocalMessage[] = [{ role: 'system', content: system }, ...messages]
  return cleanReply(await localComplete(all, { maxTokens }))
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

/** Text-only messages run on the offline AI when that's the choice; anything with a picture always goes to Claude. */
async function ask(system: string, messages: Anthropic.Beta.BetaMessageParam[], effort: 'low' | 'medium', engine?: AiEngine): Promise<string> {
  if (engineFor(engine) === 'offline' && messages.every((m) => typeof m.content === 'string')) {
    return (await askOffline(system, messages as { role: 'user' | 'assistant'; content: string }[])).text
  }
  return askClaude(system, messages, effort)
}

async function askClaude(system: string, messages: Anthropic.Beta.BetaMessageParam[], effort: 'low' | 'medium'): Promise<string> {
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

const askSystem = (offline = false): string => `You answer a person's questions using their own things: notes (in <note> tags) and, when given, digests of their money tracker (<money>), calendar (<calendar>) and email inbox (<email>). Amounts are in pounds.
Answer briefly and plainly, from what you're given only. When you use a note, name it as a wiki link with its exact title, like [[Trip plans]]. When you use an email, say who it's from and the date.
If none of it contains the answer, say so in one sentence and don't guess.${offline ? `\n${HARD_NOTE}` : ''}
Today's date is ${new Date().toISOString().slice(0, 10)}.`

export async function askNotes(question: string, notes: AiNote[], history: AiAskTurn[], extra: AiExtraContext = {}, engine?: AiEngine): Promise<AiReply> {
  const offline = engineFor(engine) === 'offline'
  if (offline) {
    // The offline AI reads less at once: the best-matching notes and shorter digests.
    notes = fitTexts(notes, Math.round(LOCAL_CONTEXT_CHARS * 0.55))
    history = history.slice(-2)
  }
  const extraMax = offline ? 3500 : 30000
  // Email gets more room offline than the others, for the full text of the best matches (emailAsk.ts).
  const max = (key: string): number => (offline && key === 'email' ? 9000 : extraMax)
  const context = notes.length
    ? notes.map((n) => `<note title="${n.title.replace(/"/g, "'")}">\n${n.text}\n</note>`).join('\n\n')
    : '(No notes matched this question.)'
  let others = ''
  for (const key of ['money', 'calendar', 'email'] as const) {
    const text = typeof extra?.[key] === 'string' ? extra[key]!.slice(0, max(key)) : ''
    if (text) others += `\n\n<${key}>\n${text}\n</${key}>`
  }
  const messages: Anthropic.Beta.BetaMessageParam[] = []
  for (const turn of history) {
    messages.push({ role: 'user', content: turn.question }, { role: 'assistant', content: turn.answer })
  }
  messages.push({ role: 'user', content: `<notes>\n${context}\n</notes>${others}\n\n${question}` })
  if (offline) return { ...(await askOffline(askSystem(true), messages as { role: 'user' | 'assistant'; content: string }[])), offline: true }
  return { text: await askClaude(askSystem(), messages, 'medium'), offline: false, hard: false }
}

const chatSystem = (): string => `You are Claude, chatting with someone inside their notes app. Help with whatever they ask: questions, explanations, writing, ideas, planning, maths, code.
Be clear and friendly, and match the length of your answer to the question. Use markdown (headings, lists, tables, code blocks) when it makes an answer easier to read.
You can't see their notes or browse the web here, so if they need something from their notes, suggest the "Ask everything" page.
Today's date is ${new Date().toISOString().slice(0, 10)}.`

const RELATED_SYSTEM = `Someone is searching their own email inbox to answer a question. List words and short phrases the email they need would probably contain, that aren't already in the question: other words for the same thing, the kind of company or sender that would send it, and words such emails usually use. For example, for "when is my flight?": booking, boarding pass, itinerary, airline, departure, Ryanair, easyJet, British Airways.
Reply with up to 12, one per line, nothing else.`

/** Words an email answering the question would probably use, so Ask everything can match emails by meaning. Empty if the AI can't be reached. */
async function relatedWords(question: string, engine: AiEngine): Promise<string[]> {
  try {
    const messages = [{ role: 'user' as const, content: question.slice(0, 500) }]
    const reply =
      engine === 'offline'
        ? await localComplete([{ role: 'system', content: RELATED_SYSTEM }, ...messages], { maxTokens: 120, temperature: 0 })
        : await askClaude(RELATED_SYSTEM, messages, 'low')
    return parseRelatedWords(reply)
  } catch {
    return []
  }
}

/** The email part of Ask everything (see emailAsk.ts), for the AI that will answer. */
export async function emailContext(question: string, engine?: AiEngine): Promise<string> {
  const use = engineFor(engine)
  return emailAsk.contextFor(question, await relatedWords(question, use), use)
}

const offlineChatSystem = (): string => `You are Orbit's offline AI, running privately on this person's own computer inside their notes app. Help with whatever they ask: questions, explanations, writing, ideas, planning, maths, code.
Be clear and friendly, and keep answers fairly short. Use markdown when it makes an answer easier to read.
You can't see their notes or browse the web here, so if they need something from their notes, suggest the "Ask everything" page.
${HARD_NOTE}
Today's date is ${new Date().toISOString().slice(0, 10)}.`

/** The AI chat page: a reply to a conversation that can be about anything. */
export async function chat(messages: AiChatMessage[], engine?: AiEngine): Promise<AiReply> {
  const turns = messages.map((m) => ({ role: m.role, content: m.text }))
  if (engineFor(engine) === 'offline') {
    // The latest messages that fit, oldest first, starting with one of theirs.
    const kept = fitTexts([...turns].reverse().map((t) => ({ ...t, text: t.content })), LOCAL_CONTEXT_CHARS * 0.7)
      .reverse()
      .map(({ role, text }) => ({ role, content: text }))
    while (kept.length > 1 && kept[0].role !== 'user') kept.shift()
    return { ...(await askOffline(offlineChatSystem(), kept, 3000)), offline: true }
  }
  return { text: await askClaude(chatSystem(), turns, 'medium'), offline: false, hard: false }
}

/** Money tracker: sorts statement lines into categories, on the offline AI only (bank details never leave the computer). */
export async function sortMoney(rows: AiSortRow[], categories: { id: string; name: string; income?: boolean }[]): Promise<Record<number, string>> {
  if (!localAiInstalled()) throw new Error('Sorting payments needs the offline AI. Get it in Settings → AI helper.')
  const out: Record<number, string> = {}
  // In batches, so each answer stays short and in step.
  for (let at = 0; at < rows.length; at += 40) {
    const batch = rows.slice(at, at + 40)
    const reply = await localComplete(
      [
        { role: 'system', content: MONEY_SORT_SYSTEM },
        { role: 'user', content: moneySortPrompt(batch, categories) }
      ],
      { maxTokens: 600, temperature: 0 }
    )
    for (const [i, id] of Object.entries(parseMoneySort(reply, batch, categories))) out[at + Number(i)] = id
  }
  return out
}

/** The dictionary card: the word as it's used in its sentence, on the offline AI. */
export async function meaning(word: string, sentence: string): Promise<string> {
  const reply = await localComplete(
    [
      { role: 'system', content: MEANING_SYSTEM },
      { role: 'user', content: meaningPrompt(word.slice(0, 60), sentence.slice(0, 600)) }
    ],
    { maxTokens: 200, temperature: 0.2 }
  )
  return cleanReply(reply).text
}

// Chats are kept in the settings folder (not the notes folder), so they stay on this computer.
const CHATS = 'ai-chats.json'

export function loadChats(): AiChat[] {
  try {
    const data = JSON.parse(readFileSync(file(CHATS), 'utf8')) as { chats?: AiChat[] }
    return Array.isArray(data.chats) ? data.chats : []
  } catch {
    return []
  }
}

export function saveChats(chats: AiChat[]): void {
  writeJson(CHATS, { chats })
}

const NO_WRITING = '(no writing)'

const HANDWRITING_SYSTEM = `You read the handwriting in a picture of a person's sketch and type it out for their notes.
Write exactly what they wrote, in the same language, keeping their line breaks. Fix nothing and add nothing, but where a word is hard to read, give your best reading rather than a placeholder.
Use plain markdown only where the writing already has that shape: "- " for a written list, "- [ ] " for to-do boxes (and "- [x] " for ticked ones), "# " for a clearly underlined or larger title. Write maths as plain text, like 3x + 2 = 11.
Leave out drawings, arrows and doodles that aren't words. If there's no writing at all, reply with exactly ${NO_WRITING}.
Reply with only the text.`

export async function readHandwriting(png: Uint8Array): Promise<string> {
  const image = Buffer.from(png).toString('base64')
  const text = await askClaude(
    HANDWRITING_SYSTEM,
    [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image } },
          { type: 'text', text: 'Type out the writing in this sketch.' }
        ]
      }
    ],
    'low'
  )
  if (text === NO_WRITING) throw new Error('Claude couldn’t find any writing in this sketch.')
  return text
}

const interpretSystem = (context: string): string => `You turn a sentence someone typed into the command box of their notes app (Orbit) into one action, as JSON.
Today is ${new Date().toISOString().slice(0, 10)} (${new Date().toLocaleDateString('en-GB', { weekday: 'long' })}). Money is in pounds; amounts in the JSON are whole pence.

Reply with only one JSON object, one of:
{"kind":"money","income":false,"amount":1200,"category":"<category id>","note":"what it was","date":"YYYY-MM-DD"}
{"kind":"event","date":"YYYY-MM-DD","time":"HH:MM","title":"...","remind":true}   (time optional; remind true for "remind me")
{"kind":"note","title":"..."}             a new note
{"kind":"jot","text":"..."}               a line added to today's note
{"kind":"convert","format":"pdf|docx|html|md|txt|jpg|png|webp|mp3|wav"}
{"kind":"play","query":"song or artist"}
{"kind":"music","action":"toggle|next|previous"}
{"kind":"open","feature":"<feature id>"}
{"kind":"search","query":"..."}           search their notes
{"kind":"web","query":"..."}              search the web
{"kind":"goal","name":"...","amount":120000}   a savings goal
{"kind":"ask","question":"..."}           a question about their own notes, email, calendar or money
{"kind":"none","reason":"one short sentence"}   if it isn't something the app can do

${context}`

/** Ctrl+K: what a sentence the built-in patterns didn't understand is asking for. Only called after the person agrees. */
export async function interpret(text: string, context: string): Promise<unknown> {
  const reply = await ask(interpretSystem(context), [{ role: 'user', content: text }], 'low')
  const json = /\{[\s\S]*\}/.exec(reply)?.[0]
  const who = using() === 'offline' ? 'The offline AI' : 'Claude'
  if (!json) throw new Error(`${who} didn’t understand that one.`)
  try {
    return JSON.parse(json)
  } catch {
    throw new Error(`${who} didn’t understand that one.`)
  }
}
