import { net, safeStorage } from 'electron'
import { randomBytes } from 'crypto'
import workerCode from '../../server/file-sender/worker.js?raw'
import { logError } from './log'

/**
 * Sets up the big file sender's intro server for you, on your own free Cloudflare account: you
 * make a key on Cloudflare's site (Orbit opens the page with the right setting ticked) and paste
 * it; Orbit puts the server (server/file-sender/worker.js, built into Orbit) on your account, gives
 * it a workers.dev address, and turns on the relay if the key allows it.
 */

// Overridable for tests, which point it at a local fake Cloudflare.
const API = process.env.NOTES_CLOUDFLARE_API_URL ?? 'https://api.cloudflare.com/client/v4'
export const SCRIPT_NAME = 'orbit-file-sender'

/** Cloudflare's API tokens page (the "Edit Cloudflare Workers" template is on it). */
export const TOKEN_PAGE = 'https://dash.cloudflare.com/profile/api-tokens'

interface CfReply<T> {
  success?: boolean
  result?: T
  errors?: { code?: number; message?: string }[]
}

class CfError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly codes: number[]
  ) {
    super(message)
  }
}

async function cf<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await net.fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body instanceof FormData ? {} : body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined
    })
  } catch {
    throw new CfError('Couldn’t reach Cloudflare. Check the internet and try again.', 0, [])
  }
  const json = (await res.json().catch(() => ({}))) as CfReply<T>
  if (!res.ok || json.success === false) {
    const errors = json.errors ?? []
    const message = errors.map((e) => e.message).filter(Boolean).join(' ') || `Cloudflare said ${res.status}.`
    throw new CfError(message, res.status, errors.map((e) => Number(e.code)).filter(Boolean))
  }
  return json.result as T
}

export interface SetupStep {
  text: string
  state: 'doing' | 'done' | 'failed' | 'skipped'
}

export interface SetupResult {
  address: string
  relay: boolean
  /** Why the relay isn't on, if it isn't. */
  relayNote?: string
}

const encrypt = (text: string): string => (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text).toString('base64') : '')
export function decryptKey(saved: string | undefined): string | null {
  if (!saved) return null
  try {
    return safeStorage.decryptString(Buffer.from(saved, 'base64'))
  } catch {
    return null
  }
}

function upload(token: string, account: string, migrations: unknown): Promise<unknown> {
  const form = new FormData()
  const metadata: Record<string, unknown> = {
    main_module: 'worker.js',
    compatibility_date: '2026-01-01',
    bindings: [{ type: 'durable_object_namespace', name: 'ROOMS', class_name: 'Room' }],
    // Keep the relay's secrets when updating the server.
    keep_bindings: ['secret_text']
  }
  if (migrations) metadata.migrations = migrations
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.append('worker.js', new Blob([workerCode], { type: 'application/javascript+module' }), 'worker.js')
  return cf(token, 'PUT', `/accounts/${account}/workers/scripts/${SCRIPT_NAME}`, form)
}

/** Puts the server on Cloudflare. Different ways of saying "make the Room class", newest first. */
async function deployWorker(token: string, account: string): Promise<void> {
  const tries: unknown[] = [{ new_tag: 'v1', new_sqlite_classes: ['Room'] }, { new_tag: 'v1', steps: [{ new_sqlite_classes: ['Room'] }] }, null]
  const errors: CfError[] = []
  for (const migrations of tries) {
    try {
      await upload(token, account, migrations)
      return
    } catch (err) {
      errors.push(err instanceof CfError ? err : new CfError((err as Error).message, 0, []))
      logError('file sender setup: upload', `${errors[errors.length - 1].status} ${errors[errors.length - 1].codes.join(',')} ${(err as Error).message}`)
    }
  }
  // The most useful complaint: one that isn't just "not allowed", if there is one.
  throw errors.find((e) => e.status !== 401 && e.status !== 403) ?? errors[0]
}

async function waitForHealth(address: string, ms: number): Promise<boolean> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    try {
      const res = await net.fetch(`${address}/health`)
      const body = (await res.json()) as { app?: string }
      if (body.app === 'orbit-file-sender') return true
    } catch {
      // A new workers.dev address can take a minute to start working.
    }
    await new Promise((r) => setTimeout(r, 3000))
  }
  return false
}

export async function turnOnRelay(token: string, account: string): Promise<void> {
  const key = await cf<{ uid?: string; key?: string }>(token, 'POST', `/accounts/${account}/calls/turn_keys`, { name: 'Orbit file sender' })
  if (!key.uid || !key.key) throw new Error('Cloudflare didn’t give a relay key back.')
  await setRelaySecrets(token, account, key.uid, key.key)
}

export async function setRelaySecrets(token: string, account: string, keyId: string, apiToken: string): Promise<void> {
  await cf(token, 'PUT', `/accounts/${account}/workers/scripts/${SCRIPT_NAME}/secrets`, { name: 'TURN_KEY_ID', text: keyId.trim(), type: 'secret_text' })
  await cf(token, 'PUT', `/accounts/${account}/workers/scripts/${SCRIPT_NAME}/secrets`, { name: 'TURN_KEY_API_TOKEN', text: apiToken.trim(), type: 'secret_text' })
}

/**
 * The whole setup. `progress` is told each step as it goes. Returns the address, and the key and
 * account (encrypted) so the relay can be turned on later.
 */
export async function setUpServer(
  rawToken: string,
  progress: (steps: SetupStep[]) => void
): Promise<SetupResult & { savedKey: string; account: string; token: string }> {
  const token = String(rawToken ?? '').trim()
  if (!/^[\w-]{30,}$/.test(token)) throw new Error('That doesn’t look like a Cloudflare key. Copy the whole key from the page Cloudflare shows after “Create Token”.')
  const steps: SetupStep[] = []
  const step = (text: string): SetupStep => {
    const s: SetupStep = { text, state: 'doing' }
    steps.push(s)
    progress([...steps])
    return s
  }
  const end = (s: SetupStep, state: SetupStep['state'], text?: string): void => {
    s.state = state
    if (text) s.text = text
    progress([...steps])
  }

  let s = step('Checking the key…')
  let accounts: { id: string; name?: string }[]
  try {
    accounts = await cf<{ id: string; name?: string }[]>(token, 'GET', '/accounts?per_page=5')
  } catch (err) {
    end(s, 'failed', 'Cloudflare didn’t accept that key.')
    throw new Error(err instanceof CfError && err.status === 0 ? err.message : 'Cloudflare didn’t accept that key. Make a new one and copy all of it.')
  }
  if (!accounts?.length) {
    end(s, 'failed', 'That key can’t see your account.')
    throw new Error('That key can’t see your Cloudflare account. On the key page, set “Account Resources” to include your account, then make the key again.')
  }
  const account = accounts[0].id
  end(s, 'done', 'Key works')

  s = step('Putting the intro server on your Cloudflare account…')
  try {
    await deployWorker(token, account)
  } catch (err) {
    end(s, 'failed', 'Couldn’t put the server on Cloudflare.')
    const e = err as CfError
    const said = `Cloudflare said: “${e.message}”${e.codes.length ? ` (code ${e.codes.join(', ')})` : ''}.`
    if (e.status === 401 || e.status === 403) {
      throw new Error(`${said} The key isn’t allowed to make Workers. Make a new key with the “Edit Cloudflare Workers” policy (step 2), with your account picked.`)
    }
    throw new Error(said)
  }
  end(s, 'done', 'Intro server is on your account')

  s = step('Giving it a web address…')
  let sub: string | undefined
  try {
    sub = (await cf<{ subdomain?: string }>(token, 'GET', `/accounts/${account}/workers/subdomain`))?.subdomain
  } catch {
    // New accounts have no workers.dev name yet.
  }
  if (!sub) {
    for (let i = 0; i < 3 && !sub; i++) {
      const name = `orbit-${randomBytes(4).toString('hex')}`
      try {
        sub = (await cf<{ subdomain?: string }>(token, 'PUT', `/accounts/${account}/workers/subdomain`, { subdomain: name }))?.subdomain ?? name
      } catch {
        // Taken: try another.
      }
    }
  }
  if (!sub) {
    end(s, 'failed', 'Couldn’t get a web address.')
    throw new Error('Cloudflare wouldn’t give the server a web address. Open Workers & Pages on Cloudflare once (it sets up your workers.dev name), then try again.')
  }
  await cf(token, 'POST', `/accounts/${account}/workers/scripts/${SCRIPT_NAME}/subdomain`, { enabled: true, previews_enabled: false }).catch(() => undefined)
  const address = `https://${SCRIPT_NAME}.${sub}.workers.dev`
  end(s, 'done', `Address: ${address.replace('https://', '')}`)

  s = step('Turning on the relay (for friends whose internet blocks direct connections)…')
  let relay = false
  let relayNote: string | undefined
  try {
    await turnOnRelay(token, account)
    relay = true
    end(s, 'done', 'Relay is on')
  } catch (err) {
    const e = err as CfError
    relayNote =
      e.status === 401 || e.status === 403
        ? 'The key isn’t allowed to make a relay. Sending still works for most friends; press “Turn on the relay” to add it.'
        : `The relay couldn’t be turned on (${e.message}). Sending still works for most friends.`
    end(s, 'skipped', 'Relay not on yet')
  }

  s = step('Waiting for the address to start working (can take a minute)…')
  const ok = await waitForHealth(address, Number(process.env.NOTES_CLOUDFLARE_WAIT_MS) || 120_000)
  end(s, ok ? 'done' : 'skipped', ok ? 'All set' : 'The address isn’t answering yet. It usually starts within a few minutes.')
  return { address, relay, relayNote, savedKey: encrypt(token), account, token }
}
