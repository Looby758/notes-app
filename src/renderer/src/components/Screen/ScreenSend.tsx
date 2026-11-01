import { useEffect } from 'react'
import { newPeer, preferH264, type Signal } from './rtc'

/**
 * The hidden window on the computer whose screen is being shown on the other one (the PC, for the
 * MacBook as a second screen; the Mac, when the PC is controlling it). It records the screen and
 * sends the picture across.
 */
export default function ScreenSend() {
  useEffect(() => {
    let pc: RTCPeerConnection | null = null
    let stream: MediaStream | null = null
    let stopped = false
    const fail = (reason: string): void => {
      if (!stopped) window.api.screenFailed(reason)
    }

    let resolveMedia: (s: MediaStream | null) => void = () => undefined
    const media = new Promise<MediaStream | null>((r) => (resolveMedia = r))

    const offer = async (): Promise<void> => {
      const s = await media
      if (!s || stopped) return
      pc?.close()
      const peer = newPeer(fail, () => window.api.screenLive())
      pc = peer
      const track = s.getVideoTracks()[0]
      const transceiver = peer.addTransceiver(track, { direction: 'sendonly', streams: [s] })
      preferH264(transceiver)
      const description = await peer.createOffer()
      await peer.setLocalDescription(description)
      window.api.screenSignal({ kind: 'offer', sdp: description.sdp ?? '' } satisfies Signal)
    }

    const onSignal = async (data: unknown): Promise<void> => {
      const m = data as Signal
      try {
        if (m?.kind === 'hello') return await offer()
        if (!pc) return
        if (m.kind === 'answer') {
          await pc.setRemoteDescription({ type: 'answer', sdp: m.sdp })
          // A home network has plenty of room: keep text sharp and movement smooth.
          for (const sender of pc.getSenders()) {
            const p = sender.getParameters()
            if (!p.encodings?.length) continue
            p.encodings[0].maxBitrate = 25_000_000
            p.encodings[0].maxFramerate = 60
            ;(p as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = 'maintain-resolution'
            await sender.setParameters(p).catch(() => undefined)
          }
        }
        if (m.kind === 'candidate') await pc.addIceCandidate(m.candidate).catch(() => undefined)
      } catch (err) {
        fail(`Couldn’t set up the picture (${err instanceof Error ? err.message : String(err)}).`)
      }
    }

    const off = window.api.onScreenSignal((d) => void onSignal(d))
    void (async () => {
      const setup = await window.api.screenReady()
      if (!setup?.sourceId) return resolveMedia(null)
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: setup.sourceId,
              maxWidth: setup.width ?? 3840,
              maxHeight: setup.height ?? 2160,
              maxFrameRate: 60
            }
          } as unknown as MediaTrackConstraints
        })
        const track = stream.getVideoTracks()[0]
        if (track) track.contentHint = 'detail'
        track?.addEventListener('ended', () => fail('The screen stopped being shared.'))
        resolveMedia(stream)
      } catch (err) {
        resolveMedia(null)
        fail(`Couldn’t record the screen (${err instanceof Error ? err.message : String(err)}).`)
      }
    })()

    return () => {
      stopped = true
      off()
      pc?.close()
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return null
}
