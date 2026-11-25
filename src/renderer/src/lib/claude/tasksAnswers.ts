import { perfText, tasksText, type TaskSort } from '@shared/claudeFormat'
import type { TaskSnapshot } from '@shared/taskManager'
import { IS_MAC } from '@shared/platform'
import { pickOne, str, num, type Answer, type Args } from './common'

/**
 * The task manager for Claude Desktop: what's running and how much it uses, and closing a program
 * that's stuck (Orbit always asks the user first).
 */

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Use comes from the difference between two looks, so the first one is always 0%: look twice. */
async function look(): Promise<TaskSnapshot> {
  await window.api.tasksGet()
  await wait(1500)
  const snap = await window.api.tasksGet()
  if (snap.problem) throw new Error(snap.problem)
  return snap
}

async function runningFor(args: Args): Promise<string> {
  const snap = await look()
  const sort = (['cpu', 'memory', 'disk', 'name'].includes(str(args.sort)) ? str(args.sort) : 'cpu') as TaskSort
  return tasksText(snap.groups, sort, Math.min(100, num(args.limit, 25)), str(args.search))
}

async function usageFor(): Promise<string> {
  const snap = await look()
  const top = tasksText(snap.groups, 'cpu', 5)
  return `${perfText(snap.perf)}\n\nBusiest now:\n${top}`
}

async function endAppFor(args: Args): Promise<string> {
  const snap = await window.api.tasksGet()
  const group = pickOne(snap.groups, str(args.app), (g) => g.name, 'program running')
  if (group.self) throw new Error('That’s Orbit itself, so it can’t be closed from here.')
  if (group.kind === 'system') throw new Error(`${group.name} is part of ${IS_MAC ? 'macOS' : 'Windows'}, so Orbit won’t close it.`)
  const ok = await window.api.confirm({
    message: `Close ${group.name}?`,
    detail: `Claude asked to close it${group.procs.length > 1 ? ` (${group.procs.length} processes)` : ''}. Anything not saved in it will be lost.`,
    ok: 'Close it',
    type: 'warning'
  })
  if (!ok) return `The user chose not to close ${group.name}.`
  const result = await window.api.tasksEnd(group.procs.map((p) => ({ pid: p.pid, name: p.name })))
  if (!result.ended) throw new Error(`${group.name} didn’t close. ${result.failed.join(' ')}`)
  return `Closed ${group.name}${result.failed.length ? `, but some of it didn’t close: ${result.failed.join(' ')}` : ''}.`
}

export const TASK_ANSWERS: Record<string, Answer> = {
  get_running_apps: runningFor,
  get_computer_usage: usageFor,
  close_app: endAppFor
}
