/**
 * Orbit's big file sender: the intro server. It only introduces two computers. Each send has a
 * room number; the sender waits in the room ("host"), the friend joins ("guest"), and the server
 * passes their setting-up messages between them. Those messages are locked with a key made from
 * the words in the code, which never reach this server, so it can't read or change them. The file
 * itself never comes here.
 *
 * When both are in the room, each is handed relay details (Cloudflare TURN) for the times the two
 * computers can't reach each other directly. Relayed data is still locked end to end.
 *
 * Secrets (optional, for the relay): TURN_KEY_ID and TURN_KEY_API_TOKEN. Without them the computers
 * can still connect directly; only the relay is missing.
 */

const MAX_MESSAGE = 64 * 1024
const STUN_ONLY = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }]
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ ok: true, app: 'orbit-file-sender', relay: !!(env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN) })
    }
    const m = /^\/room\/(\d{4})$/.exec(url.pathname)
    if (!m) return json({ error: 'not found' }, 404)
    if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected a websocket' }, 426)
    const role = url.searchParams.get('as')
    if (role !== 'host' && role !== 'guest') return json({ error: 'as=host or as=guest' }, 400)
    const room = env.ROOMS.get(env.ROOMS.idFromName(m[1]))
    return room.fetch(request)
  }
}

async function iceServers(env) {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return STUN_ONLY
  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
      // Long enough for a very big send; Orbit asks again when it reconnects.
      body: JSON.stringify({ ttl: 24 * 60 * 60 })
    })
    if (!res.ok) return STUN_ONLY
    const body = await res.json()
    const list = Array.isArray(body.iceServers) ? body.iceServers : [body.iceServers]
    // Port 53 addresses time out in browsers (Cloudflare's advice is to leave them out).
    return list
      .filter(Boolean)
      .map((s) => ({ ...s, urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)) }))
      .filter((s) => s.urls.length)
  } catch {
    return STUN_ONLY
  }
}

export class Room {
  constructor(state, env) {
    this.state = state
    this.env = env
  }

  async fetch(request) {
    const role = new URL(request.url).searchParams.get('as')
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    const host = this.state.getWebSockets('host')
    const guest = this.state.getWebSockets('guest')
    let refuse = null
    if (role === 'host' && host.length) refuse = 'taken'
    if (role === 'guest' && !host.length) refuse = 'nohost'
    if (role === 'guest' && guest.length) refuse = 'full'
    if (refuse) {
      // Accept just long enough to say why, so the app can tell the person.
      server.accept()
      server.send(JSON.stringify({ sys: refuse }))
      server.close(4000, refuse)
      return new Response(null, { status: 101, webSocket: client })
    }
    this.state.acceptWebSocket(server, [role])
    const other = role === 'host' ? guest[0] : host[0]
    if (other) await this.introduce(server, other)
    else server.send(JSON.stringify({ sys: 'alone' }))
    return new Response(null, { status: 101, webSocket: client })
  }

  async introduce(a, b) {
    const ice = await iceServers(this.env)
    for (const ws of [a, b]) {
      try {
        ws.send(JSON.stringify({ sys: 'peer', ice }))
      } catch {
        // Gone already; its close tells the other one.
      }
    }
  }

  otherOf(ws) {
    const [role] = this.state.getTags(ws)
    return this.state.getWebSockets(role === 'host' ? 'guest' : 'host')[0]
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== 'string' || message.length > MAX_MESSAGE) return
    const other = this.otherOf(ws)
    if (message === '{"sys":"ice"}') {
      // Fresh relay details (e.g. after a long send).
      ws.send(JSON.stringify({ sys: 'ice', ice: await iceServers(this.env) }))
      return
    }
    if (other) other.send(message)
  }

  async webSocketClose(ws) {
    const other = this.otherOf(ws)
    if (other) other.send(JSON.stringify({ sys: 'gone' }))
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws)
  }
}
