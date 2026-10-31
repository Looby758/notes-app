import { useState } from 'react'
import { Radio, X } from 'lucide-react'
import { formatDuration, qualityById } from '@shared/studio'
import { LIVE_SERVICES, streamHealth, type LiveService } from '@shared/live'
import { useStudio } from '../../store/studio'
import { endLive, goLive } from '../../lib/studio'
import { FfmpegSetup, StreamKeys, useLiveStatus } from './LiveSetup'
import { useNow } from './StudioPage'

/** The Studio's Go live button: set up (ffmpeg, stream key) and start; while live, the timer, health and End. */
export function GoLive() {
  const live = useStudio((s) => s.live)
  const [open, setOpen] = useState(false)
  if (live) return <LiveReadout />
  return (
    <>
      <button className="btn studio-live" onClick={() => setOpen(true)} data-studio-golive>
        <Radio size={14} /> Go live
      </button>
      {open && <GoLiveDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function LiveReadout() {
  const live = useStudio((s) => s.live)!
  const stats = useStudio((s) => s.liveStats)
  const quality = useStudio((s) => s.quality)
  const now = useNow(true)
  const health = streamHealth(stats, qualityById(quality).fps)
  const label = LIVE_SERVICES.find((s) => s.id === live.service)?.label
  return (
    <div className="studio-live-on" data-studio-live>
      <span className={`live-health ${health.level}`} title={stats ? `${Math.round(stats.kbps)} kbps · ${Math.round(stats.fps)} fps · ${stats.dropped} dropped frames` : undefined}>
        {health.text}
        {stats && ` · ${Math.round(stats.kbps / 100) / 10} Mbps`}
      </span>
      <button
        className="btn studio-live on"
        onClick={async () => {
          if (await window.api.confirm({ message: `End your ${label} stream?`, ok: 'End stream' })) endLive()
        }}
        title="End the stream"
      >
        <Radio size={14} /> LIVE · {formatDuration(now - live.startedAt)}
      </button>
    </div>
  )
}

function GoLiveDialog({ onClose }: { onClose: () => void }) {
  const status = useLiveStatus()
  const [service, setService] = useState<LiveService | null>(null)
  const [starting, setStarting] = useState(false)
  if (!status) return null
  const current = service ?? status.service
  const ready = status.ffmpeg.state === 'ready' && status.keys[current] && (current !== 'custom' || !!status.customUrl)
  return (
    <div className="studio-picker-back" onClick={onClose}>
      <div className="studio-picker live-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Go live">
        <header>
          <h3>Go live</h3>
          <button className="icon-btn" title="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </header>
        {status.ffmpeg.state !== 'ready' ? (
          <FfmpegSetup status={status} compact />
        ) : (
          <>
            <StreamKeys
              status={status}
              service={current}
              onService={(s) => {
                setService(s)
                void window.api.liveSetService(s)
              }}
            />
            <p className="studio-hint">Whatever is on the Studio preview goes out live, with your mic and desktop sound. You can keep recording at the same time.</p>
            <div className="studio-row live-actions">
              <span className="studio-top-gap" />
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn studio-live go"
                disabled={!ready || starting}
                onClick={async () => {
                  setStarting(true)
                  await goLive(current)
                  setStarting(false)
                  if (useStudio.getState().live) onClose()
                }}
                data-live-start
              >
                <Radio size={14} /> {starting ? 'Starting…' : `Go live on ${LIVE_SERVICES.find((s) => s.id === current)?.label}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
