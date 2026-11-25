import { create } from 'zustand'
import {
  ACK_EVERY,
  CHUNK,
  MAX_AHEAD,
  bytesDone,
  routeOf,
  type FileSendState,
  type FsControl,
  type FsSignal,
  type Manifest,
  type Position,
  type Transfer
} from '@shared/fileSend'

/**
 * The big file sender's state (from main/fileSend.ts) and its WebRTC side. The connection lives
 * here, in the main window, not in the page, so a send carries on when you go to another tab.
 *
 * Sender: when the friend joins the room, make an offer with a data channel; on open, send the list
 * of files; when they Accept, read pieces from main and send them, never more than MAX_AHEAD past
 * what they've said they've saved. Receiver: answer, show the list, and on Accept hand each piece
 * to main in order. If the connection drops, both sides make a new one and carry on from what's on
 * the receiver's disk.
 */

export const useFileSend = create<FileSendState | null>(() => null)

interface Session {
  id: string
  session: number
  pc: RTCPeerConnection
  dc?: RTCDataChannel
  closed: boolean
  /** ICE candidates that came before the other side's description. */
  early: RTCIceCandidateInit[]
  lostTimer?: ReturnType<typeof setTimeout>
  /** Sender: what the receiver last said it had saved. */
  acked: number
  wake?: () => void
}

const sessions = new Map<string, Session>()
const iceFor = new Map<string, RTCIceServer[]>()
/** Receiver: every piece and list goes through this, one after another. */
const chains = new Map<string, Promise<unknown>>()

const transfer = (id: string): Transfer | undefined => useFileSend.getState()?.transfers.find((t) => t.id === id)

function chain(id: string, work: () => Promise<unknown>): void {
  const next = (chains.get(id) ?? Promise.resolve()).then(work).catch((err) => {
    // Pieces still queued when it was stopped.
    if (/Not receiving/.test((err as Error).message)) return
    void window.api.fileSendUpdate(id, { status: 'failed', error: (err as Error).message })
    stop(id, true)
  })
  chains.set(id, next)
}

function stop(id: string, tellThem: boolean): void {
  const s = sessions.get(id)
  if (!s) return
  sessions.delete(id)
  s.closed = true
  clearTimeout(s.lostTimer)
  if (tellThem) void window.api.fileSendSignal(id, { t: 'cancel' })
  if (tellThem && s.dc?.readyState === 'open') {
    try {
      s.dc.send(JSON.stringify({ t: 'cancel' } satisfies FsControl))
    } catch {
      // Closing anyway.
    }
  }
  s.wake?.()
  // Give a last message a moment to go.
  setTimeout(() => s.pc.close(), tellThem ? 300 : 0)
}

const control = (s: Session, msg: FsControl): void => {
  if (s.dc?.readyState === 'open') s.dc.send(JSON.stringify(msg))
}

function newSession(id: string, session: number): Session {
  stop(id, false)
  const pc = new RTCPeerConnection({ iceServers: iceFor.get(id) ?? [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }] })
  const s: Session = { id, session, pc, closed: false, early: [], acked: 0 }
  sessions.set(id, s)
  pc.onicecandidate = (e) => {
    if (e.candidate && !s.closed) void window.api.fileSendSignal(id, { t: 'ice', candidate: e.candidate.toJSON(), session })
  }
  pc.onconnectionstatechange = () => {
    if (s.closed) return
    clearTimeout(s.lostTimer)
    if (pc.connectionState === 'connected') void noteRoute(s)
    if (pc.connectionState === 'failed') lost(s)
    // A short drop (Wi-Fi hiccup) often comes back by itself.
    if (pc.connectionState === 'disconnected') s.lostTimer = setTimeout(() => lost(s), 8000)
  }
  return s
}

/** The connection broke: start a new one (the sender offers; the receiver asks for an offer). */
function lost(s: Session): void {
  if (s.closed) return
  stop(s.id, false)
  const t = transfer(s.id)
  if (!t || t.status === 'done' || t.status === 'cancelled' || t.status === 'failed') return
  void window.api.fileSendUpdate(s.id, { status: 'reconnecting' })
  setTimeout(() => {
    if (sessions.has(s.id)) return
    if (t.direction === 'send') void offer(s.id)
    else void window.api.fileSendSignal(s.id, { t: 'ready' })
  }, 2000)
}

async function noteRoute(s: Session): Promise<void> {
  try {
    const stats = await s.pc.getStats()
    let pairId: string | undefined
    stats.forEach((r) => {
      if (r.type === 'transport' && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId
    })
    let pair: { localCandidateId?: string; remoteCandidateId?: string } | undefined
    stats.forEach((r) => {
      if (r.type === 'candidate-pair' && (r.id === pairId || (!pairId && r.nominated && r.state === 'succeeded'))) pair = r
    })
    const route = routeOf(pair && stats.get(pair.localCandidateId!), pair && stats.get(pair.remoteCandidateId!))
    if (route) void window.api.fileSendUpdate(s.id, { route })
  } catch {
    // Not important.
  }
}

// ---------- Sending ----------

async function offer(id: string): Promise<void> {
  const s = newSession(id, Date.now())
  const dc = s.pc.createDataChannel('file', { ordered: true })
  setupSenderChannel(s, dc)
  const desc = await s.pc.createOffer()
  await s.pc.setLocalDescription(desc)
  if (!s.closed) void window.api.fileSendSignal(id, { t: 'offer', sdp: desc.sdp ?? '', session: s.session })
}

function setupSenderChannel(s: Session, dc: RTCDataChannel): void {
  s.dc = dc
  dc.binaryType = 'arraybuffer'
  dc.bufferedAmountLowThreshold = 1024 * 1024
  dc.onbufferedamountlow = () => s.wake?.()
  dc.onopen = async () => {
    const manifest = await window.api.fileSendManifest(s.id)
    if (!manifest || s.closed) return
    control(s, { t: 'manifest', manifest })
    const t = transfer(s.id)
    if (t && (t.status === 'waiting' || t.status === 'connecting')) void window.api.fileSendUpdate(s.id, { status: 'asking' })
  }
  dc.onmessage = async (e) => {
    if (typeof e.data !== 'string') return
    let msg: FsControl
    try {
      msg = JSON.parse(e.data)
    } catch {
      return
    }
    if (msg.t === 'start') {
      const manifest = await window.api.fileSendManifest(s.id)
      const pos = await window.api.fileSendStarted(s.id, msg.pos)
      if (!pos || !manifest || s.closed) return
      pump(s, manifest, pos).catch((err) => {
        if (s.closed) return
        void window.api.fileSendUpdate(s.id, { status: 'failed', error: (err as Error).message })
        stop(s.id, true)
      })
    } else if (msg.t === 'ack') {
      if (typeof msg.bytes === 'number') {
        s.acked = msg.bytes
        void window.api.fileSendUpdate(s.id, { done: msg.bytes })
        s.wake?.()
      }
    } else if (msg.t === 'decline') {
      stop(s.id, false)
      void window.api.fileSendDeclined(s.id)
    } else if (msg.t === 'cancel') {
      void theyStopped(s.id)
    } else if (msg.t === 'done') {
      void window.api.fileSendUpdate(s.id, { status: 'done' })
      stop(s.id, false)
    }
  }
}

const waitABit = (s: Session): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(done, 200)
    function done(): void {
      clearTimeout(timer)
      if (s.wake === done) s.wake = undefined
      resolve()
    }
    s.wake = done
  })

async function pump(s: Session, manifest: Manifest, from: Position): Promise<void> {
  const dc = s.dc!
  let sent = bytesDone(manifest.files, from)
  s.acked = sent
  for (let index = from.index; index < manifest.files.length; index++) {
    const size = manifest.files[index].size
    let offset = index === from.index ? from.offset : 0
    while (offset < size) {
      while (!s.closed && (dc.bufferedAmount > 8 * 1024 * 1024 || sent - s.acked > MAX_AHEAD)) await waitABit(s)
      if (s.closed || dc.readyState !== 'open') return
      const piece = await window.api.fileSendRead(s.id, index, offset, Math.min(1024 * 1024, size - offset))
      if (s.closed || dc.readyState !== 'open') return
      for (let k = 0; k < piece.byteLength; k += CHUNK) dc.send(piece.subarray(k, Math.min(k + CHUNK, piece.byteLength)) as Uint8Array<ArrayBuffer>)
      offset += piece.byteLength
      sent += piece.byteLength
    }
  }
  // Everything's gone; the receiver says "done" once it's all saved.
}

// ---------- Receiving ----------

async function answer(id: string, sig: Extract<FsSignal, { t: 'offer' }>): Promise<void> {
  const s = newSession(id, sig.session)
  s.pc.ondatachannel = (e) => setupReceiverChannel(s, e.channel)
  await s.pc.setRemoteDescription({ type: 'offer', sdp: sig.sdp })
  for (const c of s.early.splice(0)) await s.pc.addIceCandidate(c).catch(() => undefined)
  const desc = await s.pc.createAnswer()
  await s.pc.setLocalDescription(desc)
  if (!s.closed) void window.api.fileSendSignal(id, { t: 'answer', sdp: desc.sdp ?? '', session: s.session })
}

function setupReceiverChannel(s: Session, dc: RTCDataChannel): void {
  s.dc = dc
  dc.binaryType = 'arraybuffer'
  let sinceAck = 0
  dc.onmessage = (e) => {
    if (typeof e.data !== 'string') {
      const data = new Uint8Array(e.data as ArrayBuffer)
      chain(s.id, async () => {
        const r = await window.api.fileSendWrite(s.id, data)
        sinceAck += data.byteLength
        if (sinceAck >= ACK_EVERY || r.finished) {
          sinceAck = 0
          control(s, { t: 'ack', bytes: r.done })
        }
        if (r.finished) {
          control(s, { t: 'done' })
          setTimeout(() => stop(s.id, false), 1000)
        }
      })
      return
    }
    let msg: FsControl
    try {
      msg = JSON.parse(e.data)
    } catch {
      return
    }
    if (msg.t === 'manifest') {
      chain(s.id, async () => {
        const pos = await window.api.fileSendGotManifest(s.id, msg.manifest)
        // Already accepted (this is a reconnect): carry on by itself.
        if (pos && !s.closed) control(s, { t: 'start', pos })
      })
    } else if (msg.t === 'cancel') {
      void theyStopped(s.id)
    }
  }
}

/** The other computer pressed Stop. */
async function theyStopped(id: string): Promise<void> {
  const t = transfer(id)
  if (!t || t.status === 'done' || t.status === 'cancelled' || t.status === 'failed') return
  stop(id, false)
  await window.api.fileSendCancel(id)
  await window.api.fileSendUpdate(id, { error: t.direction === 'send' ? 'They stopped it.' : 'They stopped sending.' })
}

/** The Accept button. `chooseFolder` asks where to save first. */
export async function acceptReceive(id: string, chooseFolder: boolean): Promise<void> {
  const pos = await window.api.fileSendAccept(id, chooseFolder)
  const s = sessions.get(id)
  if (s) control(s, { t: 'start', pos })
}

export async function declineReceive(id: string): Promise<void> {
  const s = sessions.get(id)
  if (s) control(s, { t: 'decline' })
  stop(id, false)
  await window.api.fileSendDeclined(id)
}

// ---------- From main ----------

async function onSignal(id: string, sig: FsSignal): Promise<void> {
  const t = transfer(id)
  if (!t) return
  if (sig.t === 'offer' && t.direction === 'receive') return answer(id, sig)
  if (sig.t === 'ready' && t.direction === 'send') return offer(id)
  if (sig.t === 'cancel') return theyStopped(id)
  const s = sessions.get(id)
  if (!s) return
  if (sig.t === 'answer' && t.direction === 'send' && sig.session === s.session) {
    await s.pc.setRemoteDescription({ type: 'answer', sdp: sig.sdp })
    for (const c of s.early.splice(0)) await s.pc.addIceCandidate(c).catch(() => undefined)
  } else if (sig.t === 'ice' && sig.session === s.session) {
    if (s.pc.remoteDescription) await s.pc.addIceCandidate(sig.candidate).catch(() => undefined)
    else s.early.push(sig.candidate)
  }
}

let started = false

/** Called once by the main window. */
export function startFileSend(): void {
  if (started) return
  started = true
  void window.api.fileSendState().then((s) => useFileSend.setState(s, true))
  window.api.onFileSendState((s) => useFileSend.setState(s, true))
  window.api.onFileSendEvent((e) => {
    if (e.kind === 'peer') {
      if (e.ice?.length) iceFor.set(e.id, e.ice)
      // Both are in the room: the sender starts things off.
      if (transfer(e.id)?.direction === 'send') void offer(e.id).catch((err) => console.error('[file sender]', err))
    } else if (e.kind === 'signal' && e.signal) {
      void onSignal(e.id, e.signal).catch((err) => console.error('[file sender]', err))
    } else if (e.kind === 'gone') {
      stop(e.id, false)
    } else if (e.kind === 'stop') {
      stop(e.id, true)
    }
  })
}
