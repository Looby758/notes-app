import { spawn } from 'child_process'
import { createServer, request, type Server } from 'http'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { BRIDGE_SCRIPT, cleanAreas, type ClaudeArea } from '@shared/claudeDesktop'
import type { Check, Preflight } from '@shared/releaseCheck'

/**
 * The Claude Desktop connection end to end: a real server on 127.0.0.1, Claude's side played by
 * the MCP SDK's own client (and by the bridge script, run with Node as Claude Desktop runs it).
 */

const home = mkdtempSync(join(tmpdir(), 'orbit-claude-'))

vi.mock('electron', () => ({
  app: { getPath: () => home, getAppPath: () => home, isPackaged: true, getVersion: () => '9.9.9', on: () => undefined },
  ipcMain: { handle: () => undefined, on: () => undefined },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() }
}))
vi.mock('./log', () => ({ logError: vi.fn() }))
vi.mock('./releaseHelper', () => ({ lookAtRelease: vi.fn() }))

const { handleRequest, orbitMcpServer } = await import('./claudeDesktop')
const { recordStudioError, resetStudioErrorsForTests, sawPreflight, studioErrors, nameApp, knownFolders, releaseMemory } = await import('./studioErrors')
type Deps = Parameters<typeof orbitMcpServer>[0]

const TOKEN = 'test-token-1234567890'
const asked: { name: string; args: Record<string, unknown> }[] = []
let areas: Record<ClaudeArea, boolean> = cleanAreas({})

const deps = (): Deps => ({
  areas,
  ask: async (name, args) => {
    asked.push({ name, args })
    if (name === 'apps.list') return JSON.stringify([{ name: 'notes-app', folder: '/code/notes-app', repo: 'Looby758/notes-app' }])
    if (name === 'board.update') return `moved ${String(args.id)} to ${String(args.column)}`
    if (name === 'read_note') return 'Shopping.md\n\nmilk, eggs, and my password=hunter2'
    return `answer for ${name}`
  },
  errors: studioErrors,
  knownFolders,
  memory: releaseMemory,
  look: async () => ({ info: { ok: true, version: '1.14.0', branch: 'main', repo: 'Looby758/notes-app' }, main: { main: 'main', branch: 'main', onMain: true, dirty: 0, linked: true, behind: 2, ahead: 0 } })
})

let server: Server
let port = 0

beforeAll(async () => {
  server = createServer((req, res) => void handleRequest(req, res, TOKEN, () => orbitMcpServer(deps())))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as { port: number }).port
})
afterAll(() => server.close())
beforeEach(() => {
  resetStudioErrorsForTests()
  asked.length = 0
  areas = cleanAreas({})
})

async function connect(token = TOKEN): Promise<Client> {
  const client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  return client
}

const textOf = (r: unknown): string => ((r as { content: { text: string }[] }).content ?? []).map((c) => c.text).join('\n')

function post(headers: Record<string, string>, body = '{}'): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('error', reject)
    req.end(body)
  })
}

describe('safety', () => {
  it('turns away a wrong or missing token', async () => {
    expect(await post({})).toBe(401)
    expect(await post({ Authorization: 'Bearer nope' })).toBe(401)
    await expect(connect('wrong')).rejects.toThrow()
  })

  it('turns away web pages (they send an Origin) even with the token', async () => {
    expect(await post({ Authorization: `Bearer ${TOKEN}`, Origin: 'https://evil.example' })).toBe(403)
  })

  it('only offers the parts that are switched on, and email is off at first', async () => {
    const client = await connect()
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['get_recent_errors', 'get_release_status', 'get_board', 'update_card', 'search_notes', 'get_calendar', 'get_money', 'play_music']))
    expect(names).not.toContain('search_email')
    areas = { ...areas, email: true, money: false }
    const again = (await (await connect()).listTools()).tools.map((t) => t.name)
    expect(again).toContain('search_email')
    expect(again).not.toContain('get_money')
  })

  it('marks everything but the few changes as read-only', async () => {
    const tools = (await (await connect()).listTools()).tools
    const writes = tools.filter((t) => t.annotations?.readOnlyHint === false).map((t) => t.name)
    expect(writes.sort()).toEqual(['add_calendar_event', 'add_card', 'add_countdown', 'add_flashcards', 'add_to_note', 'add_to_playlist', 'control_music', 'create_note', 'create_playlist', 'delete_note', 'download_song', 'edit_note', 'move_note', 'play_music', 'rename_note', 'update_card'])
  })

  it('blanks out secrets in what the window answers', async () => {
    const r = await (await connect()).callTool({ name: 'read_note', arguments: { path: 'Shopping' } })
    expect(textOf(r)).toContain('password=[hidden]')
    expect(textOf(r)).not.toContain('hunter2')
  })
})

describe('App Studio tools', () => {
  it('get_recent_errors gives the newest problems first with their output', async () => {
    recordStudioError('/code/notes-app', 'tests', 'Type check and tests', '2 tests failed', 'whatsNew.test.ts', 'FAIL whatsNew.test.ts\nwith ghp_abcdefghijklmnopqrstuvwxyz0123456789')
    nameApp('/code/orbit-music', 'Looby758/orbit-music')
    recordStudioError('/code/orbit-music', 'git', 'Pushing', 'GitHub turned the push away', 'Get the latest first.', '! [rejected] main -> main (fetch first)')
    const client = await connect()
    const all = textOf(await client.callTool({ name: 'get_recent_errors', arguments: {} }))
    expect(all.indexOf('GitHub turned the push away')).toBeLessThan(all.indexOf('2 tests failed'))
    expect(all).toContain('! [rejected] main -> main')
    expect(all).not.toContain('ghp_')
    const one = textOf(await client.callTool({ name: 'get_recent_errors', arguments: { app: 'notes-app' } }))
    expect(one).toContain('2 tests failed')
    expect(one).not.toContain('push away')
  })

  it('get_release_status says what the release helper found', async () => {
    const check = (id: Check['id'], state: Check['state'], text: string): Check => ({ id, label: id, state, text })
    const pre: Preflight = { version: '1.14.0', next: '1.14.1', tag: 'v1.14.1', checks: [check('tree', 'pass', 'Nothing is waiting to be committed.'), check('latest', 'fail', 'GitHub has 2 commits this computer doesn’t. Get the latest first.')] }
    sawPreflight('/code/notes-app', pre)
    const text = textOf(await (await connect()).callTool({ name: 'get_release_status', arguments: { app: 'Looby758/notes-app' } }))
    expect(text).toContain('Version in package.json: 1.14.0')
    expect(text).toContain('2 commit(s) behind')
    expect(text).toContain('[fail] latest: GitHub has 2 commits')
    // The failed check went into the history too.
    expect(studioErrors()[0]).toMatchObject({ kind: 'preflight', title: 'GitHub has 2 commits this computer doesn’t' })
  })

  it('get_release_status says which apps there are when it can’t find one', async () => {
    const r = await (await connect()).callTool({ name: 'get_release_status', arguments: { app: 'calculator' } })
    expect(r.isError).toBe(true)
    expect(textOf(r)).toContain('notes-app (Looby758/notes-app)')
  })

  it('update_card asks the window, and needs a column or a pull request', async () => {
    const client = await connect()
    expect(textOf(await client.callTool({ name: 'update_card', arguments: { id: 'i1', column: 'done' } }))).toBe('moved i1 to done')
    expect(asked.at(-1)).toEqual({ name: 'board.update', args: { id: 'i1', column: 'done', pull: undefined } })
    const none = await client.callTool({ name: 'update_card', arguments: { id: 'i1' } })
    expect(none.isError).toBe(true)
    const bad = await client.callTool({ name: 'update_card', arguments: { id: 'i1', column: 'bin' } })
    expect(bad.isError).toBe(true)
  })
})

describe('the bridge Claude Desktop runs', () => {
  it('passes Claude’s messages to Orbit and the answers back', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbit-bridge-'))
    const script = join(dir, 'bridge.cjs')
    const portFile = join(dir, 'port.json')
    writeFileSync(script, BRIDGE_SCRIPT)
    writeFileSync(portFile, JSON.stringify({ port }))
    const child = spawn(process.execPath, [script], { env: { ...process.env, ORBIT_PORT_FILE: portFile, ORBIT_TOKEN: TOKEN }, stdio: ['pipe', 'pipe', 'inherit'] })
    const lines: string[] = []
    let buffer = ''
    child.stdout.on('data', (d: Buffer) => {
      buffer += d.toString()
      const parts = buffer.split('\n')
      buffer = parts.pop() ?? ''
      lines.push(...parts.filter(Boolean))
    })
    const send = (m: unknown): boolean => child.stdin.write(JSON.stringify(m) + '\n')
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-desktop', version: '1' } } })
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    child.stdin.end()
    await new Promise((resolve) => child.on('exit', resolve))
    const answers = lines.map((l) => JSON.parse(l) as { id: number; result?: { serverInfo?: { name: string }; tools?: { name: string }[] } })
    expect(answers.map((a) => a.id)).toEqual([1, 2])
    expect(answers[0].result?.serverInfo?.name).toBe('orbit')
    expect(answers[1].result?.tools?.map((t) => t.name)).toContain('get_recent_errors')
  })

  it('says Orbit isn’t open when there’s no port file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbit-bridge-'))
    const script = join(dir, 'bridge.cjs')
    writeFileSync(script, BRIDGE_SCRIPT)
    const child = spawn(process.execPath, [script], { env: { ...process.env, ORBIT_PORT_FILE: join(dir, 'missing.json'), ORBIT_TOKEN: TOKEN }, stdio: ['pipe', 'pipe', 'inherit'] })
    let out = ''
    child.stdout.on('data', (d: Buffer) => (out += d.toString()))
    child.stdin.end(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' }) + '\n')
    await new Promise((resolve) => child.on('exit', resolve))
    const reply = JSON.parse(out.trim()) as { id: number; error: { message: string } }
    expect(reply.id).toBe(7)
    expect(reply.error.message).toMatch(/Orbit isn’t open/)
  })
})
