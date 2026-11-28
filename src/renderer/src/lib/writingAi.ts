import {
  activeTake,
  allScenes,
  answerLinks,
  brainSummary,
  buildBrain,
  chapterPlain,
  entityById,
  fingerprint,
  lastOrderOf,
  newId,
  pairKey,
  parseGhost,
  parseHows,
  rankScenesFor,
  sceneLabels,
  sceneText,
  splitForAi,
  AI_BUDGET,
  parseStuck,
  type GhostNote,
  type Story
} from '@shared/writing'
import type { WritingAiJob } from '@shared/types'
import { sceneContext } from '@shared/writingTools'
import { change, useWriting } from '../store/writingStudio'
import { notify } from '../store/notify'
import { useUI } from '../store/ui'
import { openSpecialTab, SETTINGS_TAB } from './editorController'

/**
 * The Writing Studio's AI jobs: the ghost reader, the "how" notes in the who-met-who grid, asking
 * the story brain and the stuck button. They run on the offline AI (main/ai.ts → writing), so the
 * story never leaves this computer, unless you pick Claude in the studio.
 */

/** The AI isn't ready: the offline one isn't downloaded, or Claude has no API key. */
export class NeedsOfflineAi extends Error {}

async function run(job: WritingAiJob): Promise<string> {
  const reply = await window.api.aiWriting({ ...job, engine: useWriting.getState().ai })
  if ('text' in reply) return reply.text
  throw reply.missing ? new NeedsOfflineAi(reply.problem) : new Error(reply.problem)
}

/** A line for the AI panels saying which AI reads the story. */
export function aiWhere(ai: 'offline' | 'claude'): string {
  return ai === 'claude' ? 'It uses Claude, so the parts it reads are sent to Anthropic.' : 'It runs on the offline AI, so your story stays on this computer.'
}

/** Shows why an AI job didn't work; for a missing offline AI, with a button that opens where to get it. */
export function showAiProblem(err: unknown): void {
  if (err instanceof NeedsOfflineAi)
    notify(err.message, 'info', {
      label: 'Set it up',
      run: () => {
        openSpecialTab(SETTINGS_TAB)
        useUI.setState({ settingsSection: 'ai' })
      }
    })
  else notify(err)
}

/** A first-time reader's reactions to a chapter, saved with the story. Long chapters are read in parts. */
export async function runGhostReader(story: Story, chapterId: string, onPart?: (done: number, of: number) => void): Promise<GhostNote[]> {
  const ci = story.chapters.findIndex((c) => c.id === chapterId)
  const chapter = story.chapters[ci]
  if (!chapter) return []
  const text = chapterPlain(chapter)
  if (!text.trim()) throw new Error('This chapter has nothing in it yet.')
  // Characters met in earlier chapters: the reader knows them already.
  const brain = buildBrain(story, ci - 1)
  const known = story.entities.filter((e) => e.kind === 'character' && brain.appearances.has(e.id)).map((e) => e.name)
  const parts = splitForAi(text, AI_BUDGET)
  const notes: GhostNote[] = []
  for (let i = 0; i < parts.length; i++) {
    onPart?.(i, parts.length)
    const reply = await run({ kind: 'ghost', storyTitle: story.title, chapterTitle: chapter.title, part: parts[i], known, partNo: i + 1, parts: parts.length })
    for (const g of parseGhost(reply, parts[i])) notes.push({ id: newId(), ...g })
  }
  change(null, (s) => {
    s.ghost[chapterId] = notes
  })
  return notes
}

/** Scenes with pairs of characters whose "how" note is missing or out of date. */
export function scenesNeedingHows(story: Story, upTo = Infinity): { scene: string; pairs: [string, string][] }[] {
  const brain = buildBrain(story, upTo)
  const out: { scene: string; pairs: [string, string][] }[] = []
  for (const s of brain.scenes) {
    const placed = allScenes(story).find((p) => p.scene.id === s.id)!
    const print = fingerprint(sceneText(placed.scene))
    const pairs: [string, string][] = []
    for (let i = 0; i < s.cast.length; i++)
      for (let j = i + 1; j < s.cast.length; j++) {
        const how = placed.scene.hows[pairKey(s.cast[i], s.cast[j])]
        // A note you've checked, or typed yourself, is never written over.
        if (how && (how.checked || !how.ai)) continue
        if (how && how.of === print) continue
        pairs.push([s.cast[i], s.cast[j]])
      }
    if (pairs.length) out.push({ scene: s.id, pairs })
  }
  return out
}

/** Writes the "how" notes for one scene's pairs. */
export async function writeHows(story: Story, sceneId: string, pairs: [string, string][]): Promise<number> {
  const placed = allScenes(story).find((p) => p.scene.id === sceneId)
  if (!placed || !pairs.length) return 0
  const text = activeTake(placed.scene).text
  const name = (id: string): string => entityById(story, id)?.name ?? 'Someone'
  const reply = await run({ kind: 'hows', sceneTitle: placed.scene.title, text, pairs: pairs.map(([a, b]) => [name(a), name(b)]) })
  const lines = parseHows(reply, pairs.length)
  const print = fingerprint(text)
  let n = 0
  change(null, (s) => {
    for (const c of s.chapters)
      for (const sc of c.scenes) {
        if (sc.id !== sceneId) continue
        pairs.forEach(([a, b], i) => {
          const line = lines[i]
          if (!line) return
          sc.hows[pairKey(a, b)] = { text: line, ai: true, checked: false, of: print }
          n++
        })
      }
  })
  return n
}

/** Asks the story brain a question, using only what's happened up to `upTo` (a chapter index). */
export async function askBrain(story: Story, question: string, upTo = Infinity) {
  const brain = buildBrain(story, upTo)
  const labels = sceneLabels(story)
  const limit = upTo === Infinity ? Infinity : lastOrderOf(story, upTo)
  const summary = brainSummary(story, brain, labels, limit)
  const ranked = rankScenesFor(question, story, brain).slice(0, 6)
  let budget = Math.max(2000, 26_000 - summary.length)
  const excerpts: { label: string; title: string; text: string }[] = []
  for (const id of ranked) {
    const placed = allScenes(story).find((p) => p.scene.id === id)
    if (!placed || budget <= 0) break
    const text = sceneText(placed.scene).slice(0, Math.min(budget, 6000))
    budget -= text.length
    excerpts.push({ label: labels.get(id)!, title: `${placed.chapter.title} – ${placed.scene.title}`, text })
  }
  const reply = await run({ kind: 'ask', question, summary, excerpts })
  return answerLinks(reply, labels)
}

/** The stuck button: three questions about the scene (never any writing), from the scene and what the brain knows. */
export async function stuckQuestions(story: Story, sceneId: string): Promise<string[]> {
  const placed = allScenes(story).find((p) => p.scene.id === sceneId)
  if (!placed) return []
  const text = sceneText(placed.scene)
  const reply = await run({ kind: 'stuck', chapterTitle: placed.chapter.title, sceneTitle: placed.scene.title, context: sceneContext(story, sceneId), text: text.slice(-AI_BUDGET) })
  const qs = parseStuck(reply)
  if (!qs.length) throw new Error('The AI didn’t come up with questions this time. Try again.')
  return qs
}
