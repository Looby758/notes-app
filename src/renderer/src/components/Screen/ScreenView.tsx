import './screen.css'
import { useEffect, useRef, useState } from 'react'
import { Maximize2, X } from 'lucide-react'
import { pictureFraction, type ScreenInput } from '@shared/screenLink'
import type { ScreenSetup } from '@shared/types'
import { IS_MAC } from '@shared/platform'
import { newPeer, type Signal } from './rtc'

const STOP_KEYS = IS_MAC ? '⌃⌥Esc' : 'Ctrl+Alt+Esc'

/**
 * The window showing the other computer's screen: full screen on the Mac when it's the PC's second
 * screen, or an ordinary window on the PC for seeing and using the Mac. The mouse and keyboard in it
 * work the other computer.
 */
export default function ScreenView() {
  const [setup, setSetup] = useState<ScreenSetup | null>(null)
  const [live, setLive] = useState(false)
  const [problem, setProblem] = useState('')
  const [bar, setBar] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const box = useRef<HTMLDivElement>(null)

  // The picture.
  useEffect(() => {
    let pc: RTCPeerConnection | null = null
    let stopped = false
    const fail = (reason: string): void => {
      if (stopped) return
      setProblem(reason)
      window.api.screenFailed(reason)
    }
    const onSignal = async (data: unknown): Promise<void> => {
      const m = data as Signal
      try {
        if (m?.kind === 'offer') {
          pc?.close()
          const peer = newPeer(fail)
          pc = peer
          peer.ontrack = (e) => {
            const v = video.current
            if (!v) return
            v.srcObject = e.streams[0] ?? new MediaStream([e.track])
            // Show each frame as soon as it arrives: less lag beats smoothness for a screen you're using.
            for (const r of peer.getReceivers()) (r as RTCRtpReceiver & { jitterBufferTarget?: number }).jitterBufferTarget = 0
          }
          await peer.setRemoteDescription({ type: 'offer', sdp: m.sdp })
          const answer = await peer.createAnswer()
          await peer.setLocalDescription(answer)
          window.api.screenSignal({ kind: 'answer', sdp: answer.sdp ?? '' } satisfies Signal)
        }
        if (m?.kind === 'candidate' && pc) await pc.addIceCandidate(m.candidate).catch(() => undefined)
      } catch (err) {
        fail(`Couldn’t set up the picture (${err instanceof Error ? err.message : String(err)}).`)
      }
    }
    const off = window.api.onScreenSignal((d) => void onSignal(d))
    void window.api.screenReady().then((s) => {
      if (!s) return
      setSetup(s)
      window.api.screenSignal({ kind: 'hello' } satisfies Signal)
    })
    return () => {
      stopped = true
      off()
      pc?.close()
    }
  }, [])

  // The mouse and keyboard.
  useEffect(() => {
    if (!setup) return
    const send = (e: ScreenInput): void => window.api.screenInput(e)
    const held = new Set<string>()
    let queued: { x: number; y: number } | null = null
    let frame = 0

    const where = (e: MouseEvent): { x: number; y: number } | null => {
      const v = video.current
      const b = box.current
      if (!v || !b || !v.videoWidth) return null
      const r = b.getBoundingClientRect()
      return pictureFraction({ width: r.width, height: r.height }, { width: v.videoWidth, height: v.videoHeight }, { x: e.clientX - r.left, y: e.clientY - r.top })
    }
    const move = (e: MouseEvent): void => {
      const at = where(e)
      if (!at) return
      queued = at
      // Mice report far more often than the screen can show: one position a frame is plenty.
      frame ||= requestAnimationFrame(() => {
        frame = 0
        if (queued) send({ t: 'pos', ...queued })
        queued = null
      })
    }
    const button = (down: boolean) => (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.screen-bar')) return
      e.preventDefault()
      const at = where(e)
      if (down && !at) return
      if (at) send({ t: 'pos', ...at })
      if (e.button >= 0 && e.button <= 2) send({ t: 'btn', b: e.button as 0 | 1 | 2, down })
    }
    const wheel = (e: WheelEvent): void => {
      e.preventDefault()
      const k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1
      send({ t: 'wheel', dx: e.deltaX * k, dy: e.deltaY * k })
    }
    const key = (down: boolean) => (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (down && e.code === 'Escape' && e.ctrlKey && e.altKey) return window.api.screenClose()
      if (!e.code) return
      if (down) held.add(e.code)
      else held.delete(e.code)
      send({ t: 'key', code: e.code, down })
    }
    // Switching away with a key held (e.g. Alt+Tab) would leave it stuck down on the other computer.
    const letGo = (): void => {
      for (const code of held) send({ t: 'key', code, down: false })
      held.clear()
    }
    const stop = (e: Event): void => e.preventDefault()
    const down = button(true)
    const up = button(false)
    const keyDown = key(true)
    const keyUp = key(false)
    const el = box.current!
    el.addEventListener('mousemove', move)
    el.addEventListener('mousedown', down)
    window.addEventListener('mouseup', up)
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('contextmenu', stop)
    el.addEventListener('auxclick', stop)
    window.addEventListener('keydown', keyDown, true)
    window.addEventListener('keyup', keyUp, true)
    window.addEventListener('blur', letGo)
    return () => {
      cancelAnimationFrame(frame)
      letGo()
      el.removeEventListener('mousemove', move)
      el.removeEventListener('mousedown', down)
      window.removeEventListener('mouseup', up)
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('contextmenu', stop)
      el.removeEventListener('auxclick', stop)
      window.removeEventListener('keydown', keyDown, true)
      window.removeEventListener('keyup', keyUp, true)
      window.removeEventListener('blur', letGo)
    }
  }, [setup])

  const extend = setup?.mode === 'extend'
  const name = setup?.peerName ?? 'the other computer'
  return (
    <div
      className={`screen-view ${extend ? 'extend' : ''} ${live ? 'live' : ''} ${bar ? 'bar' : ''}`}
      ref={box}
      onMouseMove={(e) => setBar(e.clientY < (bar ? 48 : 6))}
      onMouseLeave={() => setBar(false)}
    >
      <video
        ref={video}
        autoPlay
        muted
        playsInline
        onPlaying={() => {
          setLive(true)
          window.api.screenLive()
        }}
      />
      {!live && (
        <div className="screen-wait">
          {problem ? (
            <p>{problem}</p>
          ) : (
            <p>{extend ? `Waiting for ${name}’s screen…` : `Connecting to ${name}…`}</p>
          )}
        </div>
      )}
      <div className="screen-bar">
        <span>
          {extend ? `Second screen for ${name}` : name} · {STOP_KEYS} to stop
        </span>
        {!extend && (
          <button title="Full screen" onClick={() => window.api.screenFullscreen()}>
            <Maximize2 size={14} />
          </button>
        )}
        <button title="Stop" onClick={() => window.api.screenClose()}>
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
