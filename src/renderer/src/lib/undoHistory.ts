/**
 * The undo list behind Ctrl+Z for everything that isn't typing (lib/undo.ts wires it up): moved and
 * deleted files, playlist changes, settings, stars… Kept free of the app so it can be tested.
 */

export interface UndoStep {
  /** What was done, e.g. "Moved “Plan” to Ideas" (shown as "Undone: …"). */
  label: string
  undo: () => void | Promise<void>
  redo: () => void | Promise<void>
  /**
   * It's left the list (too old, or a new change replaced what could be redone). `done` says whether
   * the change is in place: a delete that's done can now go on to the Recycle Bin, say.
   */
  forget?: (done: boolean) => void
  /** Steps with the same key a moment apart become one (dragging a slider is one change, not fifty). */
  mergeKey?: string
}

interface Entry extends UndoStep {
  at: number
}

export const UNDO_LIMIT = 100
export const MERGE_MS = 1500

export class UndoHistory {
  private done: Entry[] = []
  private undone: Entry[] = []
  /** Changes made while undoing or redoing aren't new steps. */
  private replaying = 0
  /** One undo or redo at a time, in order. */
  private queue: Promise<unknown> = Promise.resolve()
  /** Steps being gathered into one (see `group`). */
  private grouping: UndoStep[] | null = null

  constructor(
    private readonly limit = UNDO_LIMIT,
    private readonly now: () => number = Date.now
  ) {}

  get canUndo(): boolean {
    return this.done.length > 0
  }
  get canRedo(): boolean {
    return this.undone.length > 0
  }
  get nextUndo(): string | undefined {
    return this.done.at(-1)?.label
  }
  get nextRedo(): string | undefined {
    return this.undone.at(-1)?.label
  }
  get isReplaying(): boolean {
    return this.replaying > 0
  }

  /** Adds something you just did. Ignored while undoing or redoing. */
  record(step: UndoStep): void {
    if (this.replaying) return
    if (this.grouping) return void this.grouping.push(step)
    for (const e of this.undone.splice(0)) e.forget?.(false)
    const at = this.now()
    const top = this.done.at(-1)
    if (step.mergeKey && top?.mergeKey === step.mergeKey && at - top.at < MERGE_MS) {
      // Undo goes all the way back to before the first one; redo to after the last.
      top.redo = step.redo
      top.label = step.label
      top.at = at
      return
    }
    this.done.push({ ...step, at })
    while (this.done.length > this.limit) this.done.shift()!.forget?.(true)
  }

  /**
   * Everything `fn` records becomes one step (moving five files is one Ctrl+Z). `label` names it
   * from how many there were.
   */
  async group<T>(label: (count: number) => string, fn: () => Promise<T>): Promise<T> {
    if (this.grouping || this.replaying) return fn()
    const steps: UndoStep[] = []
    this.grouping = steps
    try {
      return await fn()
    } finally {
      this.grouping = null
      if (steps.length === 1) this.record(steps[0])
      else if (steps.length > 1) {
        this.record({
          label: label(steps.length),
          undo: async () => {
            for (const s of [...steps].reverse()) await s.undo()
          },
          redo: async () => {
            for (const s of steps) await s.redo()
          },
          forget: (done) => steps.forEach((s) => s.forget?.(done))
        })
      }
    }
  }

  /** Undoes the last step. Resolves to its label, or null with nothing to undo. Throws if undoing failed. */
  undo(): Promise<string | null> {
    return this.step(this.done, this.undone, 'undo')
  }

  redo(): Promise<string | null> {
    return this.step(this.undone, this.done, 'redo')
  }

  /** Forgets everything (another notes folder was opened, say). */
  clear(): void {
    for (const e of this.done.splice(0)) e.forget?.(true)
    for (const e of this.undone.splice(0)) e.forget?.(false)
  }

  private step(from: Entry[], to: Entry[], which: 'undo' | 'redo'): Promise<string | null> {
    const run = this.queue.then(async () => {
      const entry = from.pop()
      if (!entry) return null
      this.replaying++
      try {
        await entry[which]()
      } finally {
        this.replaying--
      }
      // A step that failed is dropped: what's on screen may no longer match it.
      entry.at = 0
      to.push(entry)
      return entry.label
    })
    this.queue = run.catch(() => undefined)
    return run
  }
}
