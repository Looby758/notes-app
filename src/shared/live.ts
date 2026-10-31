import type { StudioQuality } from './studio'

/** Going live from the Studio (main/live.ts). Plain helpers, so they can be tested. */

export type LiveService = 'twitch' | 'youtube' | 'custom'

export const LIVE_SERVICES: { id: LiveService; label: string; keyHelp: string; keyUrl?: string }[] = [
  { id: 'twitch', label: 'Twitch', keyHelp: 'Twitch → Creator Dashboard → Settings → Stream → Primary Stream key', keyUrl: 'https://dashboard.twitch.tv/settings/stream' },
  { id: 'youtube', label: 'YouTube', keyHelp: 'YouTube Studio → Create → Go live → Stream key', keyUrl: 'https://studio.youtube.com' },
  { id: 'custom', label: 'Other (RTMP)', keyHelp: 'Your server’s address and stream key' }
]

export interface LiveStatus {
  ffmpeg: { state: 'ready' | 'missing' | 'downloading' | 'unsupported'; progress?: number; error?: string }
  /** Which services have a key saved (the keys themselves never leave the main process). */
  keys: Record<LiveService, boolean>
  customUrl: string
  service: LiveService
  canEncrypt: boolean
  live: boolean
}

export interface LiveStats {
  fps: number
  kbps: number
  /** How fast ffmpeg keeps up: 1 is real time; well under 1 means the computer is struggling. */
  speed: number
  dropped: number
}

/** Where to send the stream, with the key on the end. Null if a custom address is missing or wrong. */
export function ingestUrl(service: LiveService, key: string, customUrl = ''): string | null {
  if (service === 'twitch') return `rtmp://live.twitch.tv/app/${key}`
  if (service === 'youtube') return `rtmp://a.rtmp.youtube.com/live2/${key}`
  const base = customUrl.trim().replace(/\/+$/, '')
  if (!/^rtmps?:\/\/[^/\s]+/i.test(base)) return null
  return `${base}/${key}`
}

/** Video kbit/s for streaming: Twitch tops out at 6000; YouTube takes more for 1080p60. */
export function liveBitrate(q: StudioQuality, service: LiveService): number {
  if (q.height <= 720) return 3500
  if (q.fps >= 60) return service === 'twitch' ? 6000 : 9000
  return service === 'twitch' ? 6000 : 6800
}

/** Reads ffmpeg's progress line: "frame= 120 fps= 30 q=21.0 size= 1024kB time=00:00:04.00 bitrate=2097.2kbits/s drop=2 speed=1.01x" */
export function parseFfmpegStats(line: string): LiveStats | null {
  if (!/frame=\s*\d+/.test(line) || !/speed=/.test(line)) return null
  const num = (re: RegExp): number => {
    const m = re.exec(line)
    return m ? Number(m[1]) : 0
  }
  return {
    fps: num(/fps=\s*([\d.]+)/),
    kbps: num(/bitrate=\s*([\d.]+)kbits/),
    speed: num(/speed=\s*([\d.]+)x/),
    dropped: num(/drop=\s*(\d+)/)
  }
}

/** A short health summary for the readout. */
export function streamHealth(s: LiveStats | null, targetFps: number): { level: 'good' | 'ok' | 'bad'; text: string } {
  if (!s) return { level: 'ok', text: 'Connecting…' }
  if (s.speed > 0 && s.speed < 0.9) return { level: 'bad', text: 'Your computer can’t keep up. Try 720p.' }
  if (s.fps > 0 && s.fps < targetFps * 0.8) return { level: 'ok', text: 'A little choppy' }
  return { level: 'good', text: 'Healthy' }
}
