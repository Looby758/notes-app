import { protocol } from 'electron'
import page from './codeSandbox/index.html?raw'
import host from './codeSandbox/host.js?raw'
import worker from './codeSandbox/worker.js?raw'

/**
 * Code blocks in notes run in coderun://box, an origin of their own: the page can't see the app
 * (or its preload API), and the policy below stops the code reaching the network or loading scripts.
 * `unsafe-eval` is what lets the worker run the block's text as code.
 */
const POLICY = "default-src 'none'; script-src 'self' 'unsafe-eval'; worker-src 'self'"

const FILES: Record<string, { body: string; type: string }> = {
  '/': { body: page, type: 'text/html' },
  '/host.js': { body: host, type: 'text/javascript' },
  '/worker.js': { body: worker, type: 'text/javascript' }
}

export const CODE_SANDBOX_SCHEME = { scheme: 'coderun', privileges: { standard: true, secure: true } }

export function registerCodeSandbox(): void {
  protocol.handle('coderun', (request) => {
    const url = new URL(request.url)
    const file = url.host === 'box' ? FILES[url.pathname] : undefined
    if (!file) return new Response('Not found', { status: 404 })
    return new Response(file.body, {
      headers: { 'content-type': file.type, 'content-security-policy': POLICY, 'cache-control': 'no-store' }
    })
  })
}
