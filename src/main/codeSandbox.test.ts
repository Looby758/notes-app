import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { isRunnable } from '../renderer/src/lib/runCode'

const source = readFileSync(join(__dirname, 'codeSandbox/worker.js'), 'utf8')

type Msg = { type: string; kind?: string; text?: string }

/** Runs a block through the worker script, with a stand-in for the worker's `self`. */
async function run(code: string): Promise<Msg[]> {
  const sent: Msg[] = []
  const self: { postMessage: (m: Msg) => void; onmessage?: (e: { data: { code: string } }) => Promise<void> } = {
    postMessage: (m) => sent.push(m)
  }
  new Function('self', source)(self)
  await self.onmessage!({ data: { code } })
  return sent
}

const lines = (msgs: Msg[]): string[] => msgs.filter((m) => m.type === 'line').map((m) => `${m.kind}: ${m.text}`)

describe('running a code block', () => {
  it('shows what the code prints', async () => {
    const out = await run('console.log("hi", 1 + 1)\nconsole.warn("careful")')
    expect(lines(out)).toEqual(['log: hi 2', 'warn: careful'])
    expect(out.at(-1)).toEqual({ type: 'done' })
  })

  it('shows objects and arrays readably', async () => {
    const out = await run('const a = { name: "Ada", tags: ["x", 2], when: null }; a.self = a; console.log(a, new Map([[1, "one"]]))')
    expect(lines(out)).toEqual(['log: { name: "Ada", tags: ["x", 2], when: null, self: [Circular] } Map(1) {1 => "one"}'])
  })

  it('reports mistakes instead of breaking', async () => {
    expect(lines(await run('nope()'))).toEqual(['error: ReferenceError: nope is not defined'])
    expect(lines(await run('throw "oops"'))).toEqual(['error: Error: oops'])
    expect(lines(await run('let x = ;'))[0]).toMatch(/^error: SyntaxError/)
  })

  it('allows await, and shows a returned value', async () => {
    const out = await run('const n = await Promise.resolve(41)\nreturn n + 1')
    expect(lines(out)).toEqual(['result: 42'])
  })
})

describe('which blocks can run', () => {
  it('knows JavaScript by its usual names', () => {
    expect(isRunnable('js')).toBe(true)
    expect(isRunnable('JavaScript')).toBe(true)
    expect(isRunnable(' js title="x"')).toBe(true)
    expect(isRunnable('python')).toBe(false)
    expect(isRunnable('')).toBe(false)
    expect(isRunnable('json')).toBe(false)
  })
})
