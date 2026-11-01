/**
 * The WebRTC part of sharing a screen between the two paired computers. The setting-up messages
 * (offer, answer, network candidates) go over the encrypted mouse-sharing line; the picture goes
 * straight across the home network. No outside servers: both computers are on the same Wi-Fi.
 */

export type Signal =
  | { kind: 'hello' }
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'candidate'; candidate: RTCIceCandidateInit }

export function newPeer(onFailed: (reason: string) => void, onConnected?: () => void): RTCPeerConnection {
  const pc = new RTCPeerConnection({ iceServers: [] })
  pc.onicecandidate = (e) => {
    if (e.candidate) window.api.screenSignal({ kind: 'candidate', candidate: e.candidate.toJSON() } satisfies Signal)
  }
  let lostTimer: ReturnType<typeof setTimeout> | undefined
  pc.onconnectionstatechange = () => {
    clearTimeout(lostTimer)
    if (pc.connectionState === 'connected') onConnected?.()
    if (pc.connectionState === 'failed') onFailed('The picture couldn’t get through. Check both computers are on the same Wi-Fi.')
    // A short drop (Wi-Fi hiccup) often comes back by itself.
    if (pc.connectionState === 'disconnected') lostTimer = setTimeout(() => onFailed('The picture stopped coming through.'), 8000)
  }
  return pc
}

/** Puts H.264 first where both computers have it (the graphics chip encodes it, so less lag and fan). */
export function preferH264(transceiver: RTCRtpTransceiver): void {
  try {
    const caps = RTCRtpSender.getCapabilities?.('video')?.codecs
    if (!caps || !transceiver.setCodecPreferences) return
    const h264 = caps.filter((c) => c.mimeType.toLowerCase() === 'video/h264')
    const rest = caps.filter((c) => c.mimeType.toLowerCase() !== 'video/h264')
    if (h264.length) transceiver.setCodecPreferences([...h264, ...rest])
  } catch {
    // Keep the browser's own order.
  }
}
